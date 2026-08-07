# Cloud Storage CORS — why a shared report showed no photographs

Uploading works. The object is in the bucket, correct and complete. The
downloaded export is right. The **shared** report still shows no photographs
of its own. That combination has exactly one cause, and it is not the rules.

## Why rules were never the problem here

Storage **rules** and Storage **CORS** are unrelated systems:

| | Rules (`storage.rules`) | CORS (`cors.json`) |
| --- | --- | --- |
| Answers | *May this identity touch this object?* | *May this web page read the response?* |
| Enforced by | Firebase | The browser |
| Configured in | Firebase console → Storage → Rules | `gcloud` / `gsutil`, **not** the console |
| Scope | Per path | **Whole bucket** |
| Default | Deny | **No policy at all** |

A bucket with no CORS policy still accepts uploads, still serves the download
URL if you paste it into the address bar, and still refuses a `fetch()` from a
web page — because the browser blocks the response before the page ever sees
it. Firebase's own "Download files on Web" documentation calls this out: to
read bytes in a browser you must configure CORS on the bucket.

`src/view-report.js` rebuilds a shared report by fetching each picture's
download URL and handing the bytes to `pdf-lib`. That is a cross-origin
`fetch`, so it is exactly the case CORS governs. The upload path is not: the
Firebase SDK uploads through an endpoint that already permits it.

## The symptom pattern

| Local export | Shared link | Object in bucket | Diagnosis |
| --- | --- | --- | --- |
| wrong | wrong | — | Extraction. See `workbook-picture-identification.md`. |
| correct | wrong | **absent** | Storage rules refused the write. |
| correct | wrong | **present** | **CORS.** This document. |

The third row is the one that wastes days, because every check you would think
to make says the system is healthy.

## Applying the policy

CORS cannot be set from the Firebase console. Use `cors.json` at the repository
root:

```sh
# Preferred (gcloud):
gcloud storage buckets update gs://crewhub-43647.firebasestorage.app \
  --cors-file=cors.json

# Or with the older gsutil:
gsutil cors set cors.json gs://crewhub-43647.firebasestorage.app

# Verify:
gcloud storage buckets describe gs://crewhub-43647.firebasestorage.app \
  --format="default(cors_config)"
```

> [!CAUTION]
> **CORS is bucket-wide, not per-prefix.** `crewhub-43647` is shared with
> WorkGrid and CubeSync. Setting a policy REPLACES the whole bucket's policy —
> it does not merge. If either app has one, read the existing config first and
> add these origins to it rather than overwriting. `cors.json` here assumes the
> bucket currently has none, which is the default.

Origins are exact strings; GCS does not pattern-match them. Vercel preview
deployments therefore get their own hostname
(`docu-align-git-<branch>-<team>.vercel.app`) and are **not** covered. Test
photographs on production, or add the preview origin temporarily.

`method` is `GET` only. The upload path does not need CORS, and granting more
would let a page mutate objects it can already reach.

## Why the origin list is not `*`

The objects are already protected by the unguessable token in their download
URL, so `"*"` would not widen who can reach them, and Firebase's examples use
it freely. It is avoided here for one reason: the policy applies to the whole
shared bucket, including WorkGrid's and CubeSync's objects. Naming origins
keeps a leaked URL from being readable by an arbitrary page.

## If photographs are still missing after this

Check the share page console, which distinguishes every remaining case:

- `PhotoFetchFailure` — the fetch still failed. Confirm the policy applied,
  that the origin matches **exactly** (scheme, host, no trailing slash), and
  that you are not on a preview deployment.
- `SharePublishedWithoutPictures` — the payload has no URLs at all. The share
  was published while uploads were failing, or predates them. Re-save the
  report; the dashboard cannot add photographs to an existing one.
- Neither, and the boxes read "Photograph unavailable" — extraction found no
  photographs. See `workbook-picture-identification.md`.
