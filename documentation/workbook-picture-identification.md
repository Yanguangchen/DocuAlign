# Never Identify Workbook Content By Absolute Cell Coordinates

This document exists because the same defect shipped three times in a row, each
fix a slightly wider version of the thing that was already wrong. It records the
rule, the reasoning behind it, and the guard that now enforces it.

> [!CAUTION]
> **The rule:** nothing in this codebase may identify a report's pictures by an
> absolute row or column. Pictures are identified by their **structure** — what
> repeats, and what order they appear in down the sheet. Any patch that
> reintroduces a hard-coded anchor as the *primary* rule is a regression, no
> matter how much tolerance it carries.

## 1. Why this one matters more than it looks

The visible symptom is mild: a photograph on page 5 of a PDF. The actual failure
is that **a lab report presents another vessel's sample as its own evidence**.

A confirmed production case: a report for `ZHOU SHUN 9`, job `X-2024-002-1`,
rendered its cover, client, vessel, voyage and full PSD table correctly from the
uploaded workbook — and carried appendix photographs of a bag labelled
`Vessel: JIAHE 99 / CH: 3-A`. Those are the bundled sample's photographs
(`SampleOutput.pdf` is group 2 of `SampleInput.xlsx`, cargo hold `3-A`).

Nothing about that document looks wrong. It has no missing image, no error
badge, no console error, and every other field on the page is right. It is
signed off by a lab engineer and a managing director, and it can be forwarded
to a client. That is the whole problem: **this defect is invisible at every
point where a human would normally catch it.**

## 2. The failure mechanism

Three pieces combine, and each is individually reasonable:

1. `report-mapping.js` selects the appendix photographs from the report sheet.
   If its predicate matches nothing, it returns an empty list.
2. `rak-report-pdf.js` builds each page by copying the reference PDF page and
   overlaying this report's values. For pictures it skips the whiteout when
   there are no replacement bytes — a deliberate guard (see
   `report-export-static-asset-fix.md` §3) so that a workbook with no images
   keeps the approved signatures rather than blanking them.
3. The reference page it copied is `SampleOutput.pdf` page 5, which contains the
   sample's own photographs.

So "extraction found nothing" renders as "the reference sample's photographs",
silently. **An empty extraction is not a blank space; it is the wrong content.**

## 3. Why coordinates cannot work

The sample workbook anchors its appendix photographs at row 147 and row 169,
column 5. Those numbers are not a specification — they are wherever *that*
workbook's rows happened to end. A client report with a different number of
result rows, a different address block, or one extra remark line puts its
appendix somewhere else entirely.

The confirmed case makes this concrete. In the uploaded workbook's `TR1 (4)`
sheet the photographs sit at approximately rows 147 and 170 — the rows matched
— but anchored around **column 2–3, not column 5**. A single column of drift
was enough to extract nothing and ship another vessel's evidence.

Widening the window does not fix the class of defect. It only moves the
boundary at which the same silent failure returns.

### The second-order trap

Positional rules also corrupt *each other*. Signature detection used
`row >= 129 && row <= 131`. When the appendix moves, so does everything else —
and in testing, a shifted photograph landed inside the signature band, was
claimed as the prepared signature, and was therefore excluded from the
appendix. One positional rule quietly consumed the input of another. Fixing
only the photograph predicate would have left this in place.

## 4. The structural rule

Two facts hold across every layout, and neither is a coordinate:

1. **The letterhead is the only picture a report sheet repeats.** It is anchored
   once per printed page; the report's own content appears once.
2. **The report's pictures run in document order.** The sign-off block comes
   before the appendix, always, because that is the order of the printed
   report.

`reportPictures` in `src/report-mapping.js` therefore:

1. Drops every image whose bytes appear more than once on the sheet.
2. Sorts what remains by row.
3. Takes the **bottom two** as the appendix photographs.
4. Takes the **two above those** as the signatures — the smaller column is
   `preparedSignature`, the larger is `authorisedSignature`.

Repetition is detected by **`bytes` object identity**, not by hashing.
`readSheetImages` inflates each media part once through `mediaCache` and hands
every anchor the same array, so one letterhead is one object however many times
it is anchored. Hashing would work too but would be slower and would need a
reason.

The sample's exact anchor (`row >= 147 && column === 5`) is still tried first,
so a workbook laid out like the sample cannot change behaviour at all. It is a
fast path, **not** the rule.

## 5. The guard

`src/report-mapping.test.js` → `"recovers the real workbook's own pictures at
any anchor"`.

It parses the real `SampleInput.xlsx`, then re-maps it three times with every
picture anchor shifted (`-40/-3`, `+25/+2`, `-60/0`) so the positional fast path
cannot match, and asserts each group still recovers **its own** two photographs
and both signatures, by bytes, identical to the unshifted result.

This guard has been verified to fail against the old behaviour: forcing the
positional path produces `expected [] to have a length of 2`. It is the
regression test for the entire class of defect, not for one predicate.

## 6. Before changing picture handling

- Never make an absolute row or column the primary selector. If you need one as
  a fast path, a structural fallback must sit behind it.
- Never treat "extraction returned nothing" as a benign no-op. Downstream it
  renders as the reference sample's content. Emit the
  `MissingReportPictures` warning (`reportPictureExtraction` in
  `src/workspace.js`) so the console can say what the page cannot.
- Do not change one picture predicate in isolation. Signatures and photographs
  are selected from the same list and can steal each other's images.
- Run the shift guard. If a change passes on `SampleInput.xlsx` but fails
  shifted, it has hard-coded that workbook's layout again.
- Verify by bytes, not by eye. A rendered page that "looks right" is exactly
  what this defect produces — the reference artwork is a real, plausible
  photograph.

## 7. Two independent causes, one identical symptom

Extraction is only half the path. A shared report shows the reference sample's
photographs whenever it has no bytes to draw, and there are **two unrelated
ways** to arrive there:

| Cause | Local export | Shared link |
| --- | --- | --- |
| Extraction found nothing (§1–4) | wrong | wrong |
| Cloud Storage upload or fetch failed (§13 of the incident record) | **correct** | wrong |

So the first question when photographs are wrong is always: *is the downloaded
PDF wrong too?* If the download is right and only the share is wrong,
extraction is fine and nothing in this document applies — the fault is in the
Storage round-trip.

Three warnings separate every case without needing the workbook:

| Console warning | Meaning |
| --- | --- |
| `MissingReportPictures` (on save) | Extraction found nothing. This document applies. |
| `1 of N photographs could not be uploaded` (in the save feedback line) | The Storage **write** was refused. Check the bucket's rules. |
| `SharePublishedWithoutPictures` (on the share page) | The share was published with no URLs at all — it was saved while uploads were failing, or saved before uploads existed. Re-save the report. |
| `PhotoFetchFailure` (on the share page) | Upload worked; the **read** is failing now. Suspect CORS or a deleted object. |

The upload warning is surfaced in the UI, not only the console, because
whoever shares the link is the one person who cannot see that the shared copy
is wrong.

## 8. Known remaining assumption

Furniture below the appendix is excluded only if it repeats. A one-off footer
image anchored beneath the photographs, with no other copy on the sheet, would
be taken for a photograph. Nothing in the sample workbook does this, and a
letterhead repeats by nature, but this is the first thing to check if wrong
photographs are reported again.
