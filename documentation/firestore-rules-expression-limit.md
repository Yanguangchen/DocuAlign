# Firestore Rules Expression Limit

## What it is

Firestore security rules are not evaluated without limits. Every read, write, or
delete runs the matching rules against that request, and Firebase counts each
boolean check, comparison, function call, and loop iteration as a rule
**expression**.

**Hard cap: 1,000 expressions per request.**

If evaluation exceeds that budget, Firestore rejects the request with:

```text
FirebaseError: Missing or insufficient permissions.
```

That is the **same error as a genuine authorization failure**. There is no
separate "expression limit exceeded" error on the client.

Official reference: [Firestore rules structure & limits](https://firebase.google.com/docs/firestore/security/rules-structure).

## What it is not

- Not "the rules file is too long" — file size in the editor does not matter.
- Not a Firebase crash — the service rejects one write; the app keeps running.
- Not an auth/allowlist bug — staff with correct permissions can still be denied.
- Not something boolean rule logic alone can explain — real permission rules
  cannot produce "batch save fails, same fields one-by-one pass."

## Symptoms (how to recognize it)

| Signal | Meaning |
| --- | --- |
| `Missing or insufficient permissions` on a save | Could be real denial or expression cap |
| Several fields/rows saved at once → fails | Classic cap pattern |
| Same fields/rows saved one at a time → works | Strong indicator it's the cap, not auth |
| Appears after records grow (more rows/entries) | Data-dependent; fresh records stay under budget |
| User is on the staff allowlist, keys look allowed | Suspect the cap before rewriting auth |
| Emulator error mentions "maximum of 1000 expressions" | Definitive confirmation |

## How to confirm it locally

Run the write against the Firestore emulator (not production) so the real error
text is visible instead of a generic client-side permission rejection:

```bash
npx firebase-tools emulators:exec --only firestore --project demo-docualign \
  "RUN_FIRESTORE_RULE_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 npm run test:rules"
```

The emulator surfaces the exact expression-budget error, e.g.:

```text
Unable to evaluate the expression as the maximum of 1000 expressions to
evaluate has been reached. for 'create' @ L1537
```

## Cost drivers to watch for

1. **Recomputing `diff()` per field.** A helper like
   `changed(field) { return request.resource.data.diff(resource.data).affectedKeys().hasAny([field]); }`
   recomputes the full document diff on every call. Calling it once per field
   guard (dozens of times in a large schema) multiplies the cost. Bind the diff
   once instead:
   ```
   let changed = request.resource.data.diff(resource.data).affectedKeys();
   ```
   and reuse `changed.hasAny([...])` from there. This is the fix applied in
   `isValidCubeRequestUpdate()` in this repo's `firestore.rules`.
2. **Deep-validating every row/entry in a list.** A per-row validator with many
   field checks (~18 keys × validators in CubeSync's `isValidCubeResult`, for
   example) costs roughly that many expressions **per row**. Validating all 25
   or 50 allowed rows on every write can single-handedly blow the budget.
3. **Repeating expensive validation on update when it already ran on create.**
   Content that was already validated at `create` time doesn't need the same
   deep validation on every subsequent `update` — a shape/size check is often
   enough, with the client (which already normalizes/caps data before saving)
   as the practical backstop.

## Real incidents in this codebase

### CubeSync (2026-07-02)

The human dashboard's multi-field edits on `cubeRequests` with 5–6 populated
result rows started failing with "Missing or insufficient permissions."
Single-field edits on the same records worked. Root cause in
`isValidCubeRequestUpdate()`:

1. `cubeRequestChanged(field)` recomputed the full diff on every call — dozens
   of times per save (~150 expressions).
2. Any edit that touched `results` re-ran deep per-row validation
   (`isValidCubeResults` → `isValidCubeResult`, ~130 expressions per row) even
   on `update`, where the content was already validated at `create`.
3. `extraFields` / `customFields` validation added another ~230 expressions.

Budget math for a few text fields plus 6 result rows:
`~150 (diff) + (6 × ~130) (results) + ~200 (extras) ≈ 1,100+` — over the cap.
A single-field save stayed around ~300 expressions and passed, which is why
the bug looked like a data-dependent permissions bug rather than a budget one.

**Fix:** bind the diff once via `let changed = ...`, and validate `results` on
`update` with a shape/size check only (`is list && size() <= 50`), keeping deep
per-row content validation on `create` and in the client. See the `let changed`
block and the comment above `isValidCubeRequestUpdate()` in `firestore.rules`.

The same pattern (recomputing the diff per field) previously existed in
WorkGrid's `isValidBookingUpdate()` — see the "DIFF-ONLY" comment above the
`bookings` rules for the equivalent fix (bind the diff once, validate only
changed enum fields).

### DocuAlign group links / bundles (2026-07-02)

While designing public "group link" share bundles (`docuAlignPublicBundles`),
the first implementation embedded a full sanitized report snapshot
(`reportId`, `reportName`, `sourceFileName`, `status`, `pdfUrl`) per grouped
report directly inside the bundle document, validated by a per-entry function
called up to `MAX_BUNDLE_REPORTS` times.

Probing against the Firestore emulator showed writes were denied at as few as
10 embedded entries with:

```text
Unable to evaluate the expression as the maximum of 1000 expressions to
evaluate has been reached. for 'create' @ L1534
```

**Fix (shipped design):** bundles store only the **share tokens** (32-character
strings, already-validated pattern match) referencing existing
`docuAlignPublicShares` documents, not embedded report content. Validating
short token strings costs a small fraction of the budget that validating
embedded snapshots did, and per-report content is validated exactly once, by
the `docuAlignPublicShares` create rule. See
`isValidDocuAlignBundleTokens` and `isValidDocuAlignPublicBundle` in
`firestore.rules`, and `publishBundle`/`fetchSharedBundle` in
`src/lib/share.js`.

### DocuAlign package cap: the unrolled validator (2026-08-20)

The token-only design above kept bundles well inside the budget, but the
validator it shipped with spent expressions **in proportion to the cap**: it
unrolled one `(value.size() > n ? isValidDocuAlignBundleToken(value[n]) : true)`
branch per allowed member, 25 of them. That is affordable but not free, and it
made the cap a rules-budget number rather than a product one.

Staff hit the consequence from the other side. A saved report expands to about
seven documents, so ticking a fifth report pushed a package past 25 members and
`publishBundle` refused it client-side — reported as *"I'm not able to create a
package link when I select more than 4 reports"*. Nothing was broken; the cap
was simply set by what the validator cost.

**Fix:** validate the whole list as one joined string, at constant cost:

```
value.join(',').size() == value.size() * 33 - 1 &&
value.join(',').matches('^[A-Za-z0-9]{32}(,[A-Za-z0-9]{32})*$')
```

Both halves are required. The regex forces the joined string into groups of
exactly 32 alphanumerics separated by commas; the length check pins the number
of groups to the list size, so no single member can smuggle a separator and
pass as two tokens on its own. A non-string member makes `join()` error, which
denies the write. Emulator probing found no rules ceiling worth calling one:
10,000 members validate as fast as 250, in the same ~130ms. The shipped cap of
250 is therefore a product choice about how much the customer's browser is asked
to rebuild, not a rules-budget one.

## Guidance for future rules changes

1. **Static rule-text tests do not catch this.** `src/firestore.rules.test.js`
   checks allow/deny outcomes; it does not measure expression cost. If you add
   or change a validator that runs in a loop (per-row, per-entry, per-field),
   test it against the emulator with a **realistic maximum-size payload**, not
   just a minimal one.
2. **Prefer shape checks over deep re-validation on `update`** when the same
   content was already deep-validated on `create`.
3. **Bind `diff()` once** with `let` and reuse the result; never call a
   per-field helper that recomputes the diff internally.
4. **Prefer references (tokens/IDs) over embedded copies** for anything that
   can repeat inside a document (rows, grouped items, extra fields). Referenced
   content only needs to be validated once, at its own write.
5. If a change could plausibly run close to the cap, probe it: write a
   temporary emulator test that attempts increasing sizes (e.g. 10, 15, 20, 25
   entries) and confirms the largest allowed size still succeeds.
6. **Watch for a cap that exists only to pay for its own validator.** An
   unrolled per-index check makes the limit a function of rules cost, so the
   product limit drifts down to whatever the budget affords. Where a list's
   members share one shape, collapse the check into a single `join()` + regex
   whose cost is flat — and pin the joined length to the list size, or one
   member can impersonate several.
