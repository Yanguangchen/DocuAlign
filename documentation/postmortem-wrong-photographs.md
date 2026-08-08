# Post-mortem: six deployments to fix one wrong photograph

A shared lab report for vessel `ZHOU SHUN 9` displayed appendix photographs of a
different vessel's sample bag. Four separate changes shipped as "the fix" before
the report was correct. Every one of them fixed a real defect. None of the first
four resolved the symptom.

This document exists because the failure was not in the code. It was in how the
code was diagnosed. A future session that reads only the fix documents
(`workbook-picture-identification.md`, `storage-cors.md`) will learn what the
bugs were; this one is about why finding them took six rounds.

---

## 1. What was actually wrong

Four independent causes, discovered in this order:

| # | Cause | Fixed in |
| --- | --- | --- |
| 1 | Reports sharing a `job_ref` overwrote each other's stored documents | `78af547` |
| 2 | Picture bytes exceeded the 100,000-char share payload bound and were dropped | `8c04eb1` |
| 3 | Extraction anchored on absolute cells that no second workbook shares | `0c05424` |
| 4 | The bucket had **no CORS policy**, so the viewer's `fetch` was blocked | `305412d` |

Plus two configuration prerequisites that were not code at all: the Storage
rules block had never been published, and the DocuAlign staff allowlist in those
rules had to match `firestore.rules` rather than WorkGrid's `isActiveUser()`.

**All six produce the identical symptom.** A shared report showing another
vessel's photographs, with every other field correct, and no error anywhere.

---

## 2. Why each attempt failed

### Attempt A — slug collision and Cloud Storage upload

Both defects were real and correctly diagnosed. The static-versus-mismatched
question was settled properly, by rastering page 5 and pixel-diffing the photo
boxes: shared copies differed from the reference by **0 px** while downloads
differed by ~344,000. That is good evidence and it identified cause 2.

It still did not fix the report, and it was announced as though it would.

> **Error: treating "I found a real bug" as "I found *the* bug."** Two defects
> can share one symptom. Finding one explains the symptom, which feels like
> proof, and is not.

### Attempt B — widening the anchor window

`appendixPhotos` selected `row >= 147 && column === 5`. When that missed, the
window was widened to `row >= 140 && column >= 1`.

This is the worst change in the sequence, and the most instructive. The sample's
photographs sit at rows 147 and 169 *because of where that workbook's rows
happen to end*. A client report with a different number of result rows puts its
appendix somewhere else entirely. No constant can work, so no wider constant can
work either.

Worse: the widened window probably *would* have matched the user's sheet (their
photographs were at rows 147/170, column 2–3). Had the deploy landed before they
tested, it would have appeared to succeed, and the positional approach would
have survived to break on the next workbook.

> **Error: widening a constant instead of asking whether a constant can be
> right.** If you are adding tolerance to a hard-coded coordinate, stop. The
> question is not "how much slack?" but "what property identifies this thing
> without coordinates?"

### Attempt C — structural extraction

The correct, durable fix for cause 3: drop the pictures a sheet repeats (the
letterhead), sort the rest by row, take the bottom two. It fixed the local
export. It did not fix the shared link, because by then the remaining cause was
downstream of extraction entirely.

> **Error: fixing a half of the pipeline before establishing which half was
> broken.** Extraction and delivery were never distinguished; each fix was
> aimed at whichever one had most recently been on my mind.

### Attempt D — Storage rules

Necessary — uploads genuinely were refused — and it turned up a real trap: six
DocuAlign staff, including the lab engineer who signs the reports, are on the
CubeSync allowlist but absent from WorkGrid's `isHardcodedMaster` and have no
`users/{uid}` profile. Gating on `isActiveUser()` would have locked them out
silently.

But it was still not the last cause.

> **Error: assuming write permission was the only gate between the bytes and
> the page.** Rules govern the write. CORS governs whether the browser will let
> the page read the response. They are different systems on the same bucket,
> and only one of them is visible in the Firebase console.

### What actually broke it open

The user wrote:

> *"the export documents, local, is fixed but the online share link, the images
> is wrong"*

That single sentence partitions the problem: local export never touches Cloud
Storage, so a correct download with a broken share means extraction works and
delivery does not. Everything after it took one round.

**It should have been the first question asked.** Instead it arrived, unprompted,
in round five.

---

## 3. The five habits that caused this

### 3.1 A silent fallback made every cause look identical

`rak-report-pdf.js` skipped the whiteout for a picture with no bytes, so the
reference page kept its own artwork. That guard was written for a good reason —
a workbook with no images should keep its approved signatures — but it meant
*extraction failure*, *upload refusal*, *CORS block*, and *stale share* all
rendered as one pixel-identical page.

A defect you cannot tell apart from three other defects cannot be diagnosed, only
guessed at. Six rounds of guessing is the arithmetic consequence.

This is now fixed at the source: appendix images are marked `evidence: true` and
their box is cleared to "Photograph unavailable" rather than inheriting the
reference's.

> **Rule: a fallback must never render plausible wrong content.** Failing
> visibly is worth more than degrading invisibly, and in a signed lab report
> misattributed evidence is worse than a blank box.

### 3.2 Diagnostics shipped last instead of first

The warnings that finally made each cause identifiable — `MissingReportPictures`,
`PhotoUploadFailure`, `SharePublishedWithoutPictures`, `PhotoFetchFailure`, and
the save-time UI message — were built in rounds three and five. Built first,
they would have named the cause on the first test.

> **Rule: when a symptom has more than one candidate cause and each test costs a
> deploy plus a human, ship the discriminator before the fix.** Instrumentation
> is not overhead in that situation; it is the cheapest possible round.

### 3.3 No reproduction, so every fix was a hypothesis shipped to production

The failing workbook was never in hand. Each round cost: a commit, a PR, a merge,
a Vercel build, a manual re-drop by the user, and a screenshot. That is an
extraordinarily expensive way to test a guess, and it was repeated four times.

> **Rule: ask for the failing input early and explicitly.** One request for the
> workbook in round one would have replaced four rounds. When the input cannot
> be shared, say plainly that you are testing a hypothesis, not shipping a fix.

### 3.4 Config claims were taken at face value

"I updated firestore rules and enabled object storage" was read as *the Storage
rules are in place*. Firestore rules and Storage rules are different files in
different products; `firestore.rules` correctly contains no photo block, so
whatever was pasted there did nothing.

Similarly, the presence of `fleet_claims/` and `job-completion-signatures/` in
the bucket looked like proof that writes were permitted — but those apps write
server-side through the Admin SDK, which bypasses rules entirely. DocuAlign was
the only one of the three that the rules actually applied to.

> **Rule: verify the specific artefact, not the reported action.** "Does
> `docuAlignReportPhotos/` exist in the bucket?" is answerable in five seconds
> and cannot be misread.

### 3.5 Coverage was mistaken for validation

The suite was at 100% statements/branches/functions/lines throughout, and every
fix shipped green. It proved only that the code did what it did on
`SampleInput.xlsx` — the one workbook whose layout the constants were derived
from. A test suite anchored entirely on the reference input cannot detect a
constant that only fits the reference input.

The guard that closes this is `"recovers the real workbook's own pictures at any
anchor"`, which re-maps the real workbook three times with every anchor shifted.
It was verified to fail against the old behaviour before being trusted.

> **Rule: for any rule derived from a sample, write the test that perturbs the
> sample.** 100% coverage of a wrong assumption is 100% coverage of a wrong
> assumption.

---

## 4. The decision table this should have started from

Ask these in order. Each answer removes half the search space.

| Question | If yes | If no |
| --- | --- | --- |
| Is the **downloaded** PDF also wrong? | Extraction. See `workbook-picture-identification.md`. | Delivery — continue below. |
| Is the object present in `docuAlignReportPhotos/{reportId}/`? | Continue below. | Storage **rules** refused the write. |
| Does the share payload carry `url` on its photos? | Continue below. | Published before uploads worked. **Re-save**; the dashboard cannot add photographs to an existing report. |
| Does `gcloud storage buckets describe … --format="default(cors_config)"` return `null`? | **CORS.** See `storage-cors.md`. | Check the origin matches exactly, including scheme and preview-vs-production host. |

The console now answers rows 3 and 4 directly:
`SharePublishedWithoutPictures` versus `PhotoFetchFailure`.

---

## 5. Checklist for the next session

Before claiming a picture-related defect is fixed:

- [ ] Can you state which of extraction, upload, fetch, or staleness failed, and
      name the evidence? "I fixed a bug in the area" is not that.
- [ ] Have you reproduced the failure, or are you shipping a hypothesis? Say
      which, out loud, to the user.
- [ ] If a hard-coded coordinate is involved, have you replaced it with a
      structural property rather than widening it?
- [ ] Does the failure mode render *nothing* rather than *something plausible*?
- [ ] Does a console warning distinguish this cause from its neighbours?
- [ ] Does a test perturb the sample workbook, or only confirm it?
- [ ] Have you verified the deploy is actually live before asking for a retest?
      Two rounds here were spent testing builds that predated the fix.
- [ ] For config: have you checked the artefact (bucket listing, rules text,
      CORS config) rather than trusting a description of it?

---

## 6. What the codebase now enforces

- `AGENTS.md` §2a — pictures identified structurally, never by coordinates;
  rules and CORS distinguished.
- `documentation/workbook-picture-identification.md` — the extraction rule and
  its shift guard.
- `documentation/storage-cors.md` — the rules-versus-CORS distinction and the
  symptom table.
- `src/report-mapping.test.js` — the anchor-shift regression guard.
- `src/rak-report-pdf.test.js` — asserts the reference photograph bytes are
  absent from a report that has none of its own.
- Four console warnings plus one UI message, one per distinguishable cause.

The single most valuable change in the whole sequence was not any of the four
fixes. It was making the four causes tell themselves apart.
