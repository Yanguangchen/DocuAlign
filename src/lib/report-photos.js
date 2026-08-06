/**
 * @file report-photos.js
 * @description Uploads a report's embedded pictures (appendix photographs and
 * both signatures) to Cloud Storage so a public share can show the uploaded
 * workbook's own artwork instead of the reference sample's.
 *
 * Why this exists: a share's `documentData` is capped at 100,000 characters by
 * the Firestore rules, and two appendix photographs are roughly 335 KB raw
 * (~446 KB once base64-encoded). The bytes cannot travel in the payload, so
 * they are uploaded once at save time and the payload carries a URL instead.
 *
 * Security: the URL returned by `getDownloadURL` carries its own access token
 * and is unguessable, which is the same capability-URL model the share tokens
 * already use. Storage rules therefore only need to permit staff *writes* --
 * no public read rule is required, and none should be added.
 */
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { logWarn } from "./logger.js";

/** Root prefix for everything this app writes to the shared bucket. */
export const REPORT_PHOTO_PREFIX = "docuAlignReportPhotos";

/**
 * Storage path for one of a report's pictures.
 * @param {string} reportId - Saved report id.
 * @param {string} key - Stable asset key, e.g. `2:photo:0`.
 * @returns {string} A bucket path scoped to this app.
 */
export function reportPhotoPath(reportId, key) {
  return `${REPORT_PHOTO_PREFIX}/${reportId}/${key.replace(/[^\w.-]+/g, "_")}`;
}

/**
 * Upload every picture a report carries and map each to its download URL.
 *
 * Uploading is best-effort per asset: a picture that fails to upload is left
 * out of the map, so its share simply falls back to the reference artwork for
 * that one image rather than failing the whole save.
 * @param {object} storage - Firebase Storage instance.
 * @param {string} reportId - Saved report id, used to scope the upload path.
 * @param {Array<{key: string, mimeType?: string, bytes: Uint8Array}>} assets - Pictures to upload.
 * @returns {Promise<Map<string, string>>} Asset key to download URL.
 */
export async function uploadReportPhotos(storage, reportId, assets) {
  const urls = new Map();
  if (!reportId || assets.length === 0) return urls;

  await Promise.all(assets.map(async (asset) => {
    try {
      const target = ref(storage, reportPhotoPath(reportId, asset.key));
      await uploadBytes(target, asset.bytes, {
        contentType: asset.mimeType || "application/octet-stream",
        // Pictures are immutable once written: the path already carries the
        // report id and the asset's own key.
        cacheControl: "public, max-age=31536000, immutable",
      });
      urls.set(asset.key, await getDownloadURL(target));
    } catch (error) {
      logWarn("Could not upload a report picture", {
        feature: "ReportPhotos",
        function: "uploadReportPhotos",
        operation: "storage.uploadBytes",
        category: "PhotoUploadFailure",
        safeIdentifier: asset.key,
        errorMessage: String(error),
      });
    }
  }));

  return urls;
}
