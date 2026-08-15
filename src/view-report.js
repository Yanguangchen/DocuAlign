/**
 * @file view-report.js
 * @description Controller for the public share viewer (`view.html`). This page is
 * intentionally unauthenticated: the unguessable token in the `share` query
 * parameter is the only credential, and it grants read access to exactly one
 * published report snapshot plus its PDF output. Invalid, revoked, or missing
 * tokens render a status message instead of report data.
 */
import { db } from "./lib/firebase.js";
import { logWarn, trackOperation } from "./lib/logger.js";
import { initObservability } from "./lib/observability.js";
import {
  fetchSharedBundle,
  fetchSharedReport,
  isValidShareToken,
  PUBLIC_PDF_PATH,
} from "./lib/share.js";

const status = document.querySelector("#share-status");
const reportPanel = document.querySelector("#share-report");
const reportTitle = document.querySelector("#share-report-name");
const reportSubtitle = document.querySelector("#share-report-subtitle");
const reportStatus = document.querySelector("#share-report-status");
const reportReference = document.querySelector("#share-reference");
const reportSourceDetails = document.querySelector("#share-source-details");
const reportSource = document.querySelector("#share-source");
const reportPublished = document.querySelector("#share-published");
const reportSizeRow = document.querySelector("#share-size-row");
const reportSize = document.querySelector("#share-size");
const reportPagesRow = document.querySelector("#share-pages-row");
const reportPages = document.querySelector("#share-pages");
const pdfLink = document.querySelector("#share-pdf-link");
const downloadLink = document.querySelector("#share-download-link");
const previewFrame = document.querySelector("#share-preview-frame");
const previewOverlay = document.querySelector("#share-preview-overlay");
const previewCaption = document.querySelector("#share-preview-caption");

// Shown when the share document carries no extracted title of its own.
const FALLBACK_REPORT_TITLE = "RAK Concrete Test Report";
const bundlePanel = document.querySelector("#share-bundle");
const bundleName = document.querySelector("#share-bundle-name");
const bundleCount = document.querySelector("#share-bundle-count");
const bundlePublished = document.querySelector("#share-bundle-published");
const bundleList = document.querySelector("#share-bundle-list");
const bundleDownload = document.querySelector("#share-bundle-download");
const bundlePrint = document.querySelector("#share-bundle-print");
const bundleDownloadNote = document.querySelector("#share-bundle-download-note");

/** Grace period before a download's object URL is released. */
const REVOKE_DELAY_MS = 60000;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Extract a well-formed share token from a URL query string.
 * @param {string} search - The query string (e.g. `location.search`).
 * @returns {string|null} The token, or null when absent or malformed.
 */
export function getShareTokenFromUrl(search) {
  const token = new URLSearchParams(search).get("share");
  return isValidShareToken(token) ? token : null;
}

/**
 * Extract a well-formed bundle (group link) token from a URL query string.
 * @param {string} search - The query string (e.g. `location.search`).
 * @returns {string|null} The token, or null when absent or malformed.
 */
export function getBundleTokenFromUrl(search) {
  const token = new URLSearchParams(search).get("bundle");
  return isValidShareToken(token) ? token : null;
}

/**
 * Constrain a stored PDF URL to safe destinations. Share documents are written
 * by staff and validated by rules, but the viewer still refuses script/data
 * schemes and protocol-relative URLs, falling back to the bundled report PDF.
 * @param {unknown} url - The pdfUrl field from the share document.
 * @returns {string} A relative path or https URL that is safe to link.
 */
/**
 * Resolve the PDF URL for one shared document.
 *
 * Every published document is rebuilt here into a blob URL using the same
 * renderers the workspace export uses, so the recipient gets a real PDF
 * without the file ever being hosted. Test reports rebuild by overlaying the
 * report's own mapped values onto the approved reference pages; other
 * documents rebuild from their published worksheet grid. Shares published
 * before a renderer existed carry no data and fall back to the static asset.
 * @param {Object} share - A public share document.
 * @returns {string|Promise<string>} A URL safe to hand to the viewer and download link.
 */
export function resolveDocumentUrl(share) {
  const rebuilt = rebuildDocument(share);
  if (!rebuilt) return safePdfUrl(share?.pdfUrl);

  return rebuilt
    .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })))
    .catch((error) => {
      logDocumentRebuildFailure(error);
      return safePdfUrl(share?.pdfUrl);
    });
}

/**
 * Refetch one uploaded picture into the bytes the renderer draws with.
 *
 * A share carries each picture's URL rather than its bytes, because the bytes
 * are far past the payload's 100,000-character bound. A picture that cannot be
 * refetched is left without bytes, which the renderer treats as "nothing to
 * draw here" and keeps the reference page's own artwork for that one image.
 * @param {Object|null} asset - Described picture, possibly carrying a `url`.
 * @returns {Promise<Object|null>} The picture with `bytes`, or as it arrived.
 */
async function withPictureBytes(asset) {
  if (!asset?.url) return asset;

  try {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Picture unavailable (${response.status}).`);
    return { ...asset, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    logWarn("Could not load a shared report picture", {
      feature: "ReportPhotos",
      function: "withPictureBytes",
      operation: "fetch",
      category: "PhotoFetchFailure",
      errorMessage: String(error),
    });
    return asset;
  }
}

/**
 * Restore a shared report's signatures and appendix photographs before it is
 * rendered, so a recipient sees the uploaded workbook's own artwork.
 * @param {Object} report - The published report model.
 * @returns {Promise<Object>} The report with picture bytes restored.
 */
async function withRestoredPictures(report) {
  const published = report.appendix?.photos ?? [];
  // A photograph published without a URL was never uploaded, which is a
  // different fault from one that fails to download -- the first is a Storage
  // write that was refused when the report was saved, the second a read that
  // is failing now. Both render identically (the reference sample's artwork),
  // so the distinction only exists if it is logged.
  if (published.length > 0 && published.every((photo) => !photo?.url)) {
    logWarn("This share carries no uploaded photographs", {
      feature: "ReportPhotos",
      function: "withRestoredPictures",
      operation: "share.rebuild",
      category: "SharePublishedWithoutPictures",
      errorMessage: `${published.length} photographs have no download URL`,
    });
  }

  const [preparedSignature, authorisedSignature, ...photos] = await Promise.all([
    withPictureBytes(report.assets?.preparedSignature),
    withPictureBytes(report.assets?.authorisedSignature),
    ...published.map(withPictureBytes),
  ]);

  return {
    ...report,
    assets: { preparedSignature, authorisedSignature },
    appendix: { ...report.appendix, photos },
  };
}

/**
 * Rebuild one shared document into PDF bytes.
 *
 * Returns null -- rather than throwing or resolving to a fallback -- when the
 * share carries nothing to rebuild from, so the caller can choose between
 * linking to the static asset and fetching it.
 * @param {Object} share - A public share document.
 * @returns {Promise<Uint8Array>|null} The rebuilt PDF, or null when there is no data.
 */
function rebuildDocument(share) {
  if (typeof share?.documentData !== "string" || share.documentData === "") return null;

  let payload;
  try {
    payload = JSON.parse(share.documentData);
  } catch (error) {
    logDocumentRebuildFailure(error);
    return null;
  }

  if (payload?.renderer === "report" && payload.report) {
    return withRestoredPictures(payload.report)
      .then((report) => globalThis.docuAlignRakReportPdf.createRakReportPdf([report]))
      .then(async (blob) => new Uint8Array(await blob.arrayBuffer()));
  }

  const isCurrentSummary = payload?.renderer === "summary" && Array.isArray(payload.cells);
  const isLegacySummary = share?.documentSlug === "Summary" && Array.isArray(payload);
  if (isCurrentSummary || isLegacySummary) {
    const cells = isCurrentSummary
      ? new Map(payload.cells)
      : globalThis.docuAlignSummaryPdf.cellsFromDocumentData(payload);
    return Promise.resolve(globalThis.docuAlignSummaryPdf.createDocument(cells));
  }

  return Promise.resolve().then(() => globalThis.docuAlignPdf.createDocument({
    title: share.reportName || FALLBACK_REPORT_TITLE,
    subtitle: share.clientName ?? "",
    sections: Array.isArray(payload) ? payload : [],
  }));
}

/**
 * Rebuild one shared document into PDF bytes for the merged bundle.
 *
 * A share with nothing to rebuild from -- or one whose rebuild fails -- falls
 * back to fetching the static asset it points at, so an older share still
 * contributes its pages to the merge instead of dropping out of it.
 * @param {Object} share - A public share document.
 * @returns {Promise<Uint8Array>} The document's PDF bytes.
 */
async function sharedDocumentBytes(share) {
  const rebuilt = rebuildDocument(share);
  if (rebuilt) {
    try {
      return await rebuilt;
    } catch (error) {
      logDocumentRebuildFailure(error);
    }
  }

  const response = await fetch(safePdfUrl(share?.pdfUrl));
  if (!response.ok) {
    throw new Error(`Could not read the shared document (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Record a generated-document rendering failure without exposing share data.
 * @param {unknown} error - Rendering or payload error.
 * @returns {void}
 */
function logDocumentRebuildFailure(error) {
  logWarn("Could not rebuild the shared document", error, {
    feature: "PublicShare",
    function: "resolveDocumentUrl",
    category: "Rendering",
  });
}

export function safePdfUrl(url) {
  if (typeof url === "string") {
    if (/^[\w][\w./-]*$/.test(url)) return url;
    if (/^https:\/\//.test(url)) return url;
  }
  return PUBLIC_PDF_PATH;
}

/**
 * Recipient-facing wording for each report state. Saved snapshots are complete
 * outputs, so they read as complete; every failure state names a next action
 * instead of relying on a colour-coded badge.
 */
export const SHARE_STATUS_PRESENTATION = new Map([
  ["complete", { icon: "✓", label: "Report complete" }],
  ["saved", { icon: "✓", label: "Report complete" }],
  ["processing", { label: "Processing", hint: "The PDF is still being generated. Check back shortly." }],
  ["expired", { label: "Link expired", hint: "Ask the report owner for a new link." }],
  ["revoked", { label: "Access revoked", hint: "Ask the report owner for a new link." }],
  ["unavailable", { label: "Report unavailable", hint: "Ask the report owner for a new link." }],
  ["failed", { label: "Generation failed", hint: "Ask the report owner to regenerate the report." }],
]);

/**
 * Map a stored report status onto its viewer presentation. Unknown statuses
 * degrade to showing the raw value so nothing is silently hidden.
 * @param {unknown} value - The status field from the share document.
 * @returns {{icon?: string, label: string, hint?: string}} Display descriptor.
 */
export function formatShareStatus(value) {
  const key = typeof value === "string" && value ? value.toLowerCase() : "saved";
  return SHARE_STATUS_PRESENTATION.get(key) ?? { label: key };
}

function renderStatusLine(element, value) {
  const { icon, label, hint } = formatShareStatus(value);
  element.replaceChildren();
  if (icon) {
    const mark = document.createElement("span");
    mark.className = "share-status-check";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = icon;
    element.append(mark);
  }
  const text = document.createElement("strong");
  text.textContent = label;
  element.append(text);
  if (hint) {
    const help = document.createElement("span");
    help.className = "share-status-hint";
    help.textContent = hint;
    element.append(help);
  }
}

/**
 * Format a byte count for the trust section (e.g. "1.8 MB").
 * @param {number} bytes - File size in bytes.
 * @returns {string} Human-readable size.
 */
export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Count the pages of a PDF by scanning its raw bytes for page objects.
 * @param {string} rawPdf - The PDF file decoded as latin1/binary text.
 * @returns {number} Page count, or 0 when none could be identified.
 */
export function countPdfPages(rawPdf) {
  return (rawPdf.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

// The share document records neither file size nor page count, so derive both
// from the PDF itself. Each detail only appears when it is genuinely known.
async function loadPdfDetails(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 0) {
      reportSize.textContent = formatFileSize(buffer.byteLength);
      reportSizeRow.hidden = false;
    }
    const pages = countPdfPages(new TextDecoder("latin1").decode(buffer));
    if (pages > 0) {
      reportPages.textContent = `${pages} ${pages === 1 ? "page" : "pages"}`;
      reportPagesRow.hidden = false;
      previewCaption.textContent = `Page 1 of ${pages}`;
    }
  } catch {
    // Details stay hidden; they are a nicety, not a load failure.
  }
}

/**
 * Show a viewer state (loading or error) in place of the report panel.
 * A title makes failure states scannable; the message carries the next action.
 * @param {string} message - Explanation and next action, or "" to clear.
 * @param {string} [title] - Optional short heading for the state.
 */
function setStatus(message, title) {
  status.replaceChildren();
  if (title) {
    const heading = document.createElement("strong");
    heading.textContent = title;
    status.append(heading);
  }
  if (message) {
    const detail = document.createElement("span");
    detail.textContent = message;
    status.append(detail);
  }
  status.hidden = !message;
  reportPanel.hidden = true;
  bundlePanel.hidden = true;
}

async function renderSharedReport(share) {
  reportTitle.textContent = share.reportTitle || FALLBACK_REPORT_TITLE;
  const subtitle = [share.clientName, share.jobRef ? `Job reference ${share.jobRef}` : null]
    .filter(Boolean)
    .join(" · ");
  reportSubtitle.textContent = subtitle;
  reportSubtitle.hidden = !subtitle;
  reportReference.textContent = share.reportName || "Untitled report";
  renderStatusLine(reportStatus, share.status);
  reportSourceDetails.hidden = !share.sourceFileName;
  reportSource.textContent = share.sourceFileName
    ? `Source spreadsheet: ${share.sourceFileName}`
    : "";
  reportPublished.textContent = share.publishedAt
    ? dateFormatter.format(share.publishedAt)
    : "Date unavailable";
  const pdfUrl = await Promise.resolve(resolveDocumentUrl(share));
  pdfLink.setAttribute("href", pdfUrl);
  downloadLink.setAttribute("href", pdfUrl);
  previewOverlay.setAttribute("href", pdfUrl);
  // Ask the browser's PDF viewer for a clean first-page render.
  previewFrame.setAttribute("src", `${pdfUrl}#page=1&toolbar=0&navpanes=0&scrollbar=0`);
  loadPdfDetails(pdfUrl);
  setStatus("");
  reportPanel.hidden = false;
}

/**
 * The document kind and sampling date a share carries, for ordering.
 *
 * Read back off the published payload, which is the same data the workspace
 * planned the export from, so a link orders its pages exactly as the
 * downloaded export does.
 * @param {Object} share - A public share document.
 * @returns {{kind: string, samplingDate: string}} Sort inputs for one share.
 */
function shareSortKey(share) {
  try {
    const payload = JSON.parse(share?.documentData ?? "null");
    if (payload?.renderer === "summary" || share?.documentSlug === "Summary") {
      return { kind: "summary", samplingDate: "" };
    }
    return {
      kind: "report",
      samplingDate: payload?.report?.cover?.samplingDate ?? "",
    };
  } catch {
    // An unreadable payload still belongs in the package; it just cannot say
    // where, so it takes a report's place with no date and sorts last.
    return { kind: "report", samplingDate: "" };
  }
}

/**
 * Order a bundle's shares the way the workspace orders its export: the
 * Summary first, then the test reports oldest sampling date first.
 * @param {Array<Object>} shares - The bundle's resolved share documents.
 * @returns {Array<Object>} A new list in the order the package lists them.
 */
export function bundleOrder(shares) {
  const keyed = shares.map((share) => ({ share, ...shareSortKey(share) }));
  return keyed
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "summary" ? -1 : 1;
      const leftDate = samplingOrder(left.samplingDate);
      const rightDate = samplingOrder(right.samplingDate);
      if (leftDate === rightDate) return 0;
      return leftDate < rightDate ? -1 : 1;
    })
    .map((entry) => entry.share);
}

/**
 * Convert a cover sheet's sampling date into a sortable number.
 *
 * Mirrors the workspace's own rule: day-first `dd/mm/yyyy` and ISO
 * `yyyy-mm-dd` parse; anything else sorts last rather than being guessed at.
 * @param {string} value - The sampling date.
 * @returns {number} A comparable `yyyymmdd` number, or Infinity when unparsed.
 */
export function samplingOrder(value) {
  const text = String(value ?? "").trim();
  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    return Number(year) * 10000 + Number(month) * 100 + Number(day);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return Number(year) * 10000 + Number(month) * 100 + Number(day);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Strip what no file name may carry, while keeping the spaces, brackets and
 * underscores the lab's naming convention is written with.
 *
 * (The workspace sanitises its own archive entries the same way; the two pages
 * share no code because this one is an ES module and the workspace is a
 * classic script that has to keep working over `file://`.)
 * @param {unknown} value - Raw label.
 * @returns {string} A name safe to save under, possibly empty.
 */
function safeFileName(value) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 80)
    .trim();
}

/**
 * The file name one document is archived under.
 *
 * A document carries the name the lab gave it -- `X-2026-1338 (AV-2620N_RAK1)`
 * -- so a package unzips to the same names the staff who exported it see. A
 * name left with nothing savable falls back to its position in the package,
 * and a name another document already claimed is numbered, so no entry can
 * quietly overwrite another inside the archive.
 * @param {Object} share - A public share document.
 * @param {number} index - Zero-based position in the package.
 * @param {Set<string>} [used] - Names already claimed by this archive.
 * @returns {string} A file name safe to save under, unique within the archive.
 */
function packageEntryName(share, index, used = new Set()) {
  const preferred = safeFileName(share?.reportName)
    || `document-${String(index + 1).padStart(2, "0")}`;
  let name = preferred;
  let attempt = 1;
  while (used.has(name)) {
    attempt += 1;
    name = `${preferred} (${attempt})`;
  }
  used.add(name);
  return `${name}.pdf`;
}

/**
 * The name the package's archive downloads under, and of the folder inside it.
 *
 * Every document in an exported package is named for the package it belongs to
 * -- `X-2026-1338 (AV-2620N_RAK1)` -- so the archive takes that same name
 * without the per-document `_RAK…` part. A package whose documents were not
 * named that way falls back to the name the sender gave it.
 * @param {Array<Object>} shares - The package's documents.
 * @param {string|null} bundleName - The name the sender gave the package.
 * @returns {string} A file name safe to save under.
 */
function packageArchiveName(shares, bundleName) {
  for (const share of shares) {
    const named = /^(.*)_RAK[^)]*\)$/.exec(String(share?.reportName ?? "").trim());
    if (named) return safeFileName(`${named[1]})`) || "documents";
  }
  return safeFileName(bundleName) || "documents";
}

/**
 * Split a bundle's documents into the packages they were exported as.
 *
 * A package is one saved report's document set -- its Summary and its test
 * reports -- and a group link can hold several. `reportId` travels on every
 * share payload, so the split is exact rather than inferred from names, which
 * matters because two reports can carry the same job reference.
 *
 * First appearance decides order, so the packages come out in the order
 * `bundleOrder` already put their documents in.
 * @param {Array<Object>} shares - The bundle's documents, already ordered.
 * @returns {Array<Array<Object>>} One list of documents per package.
 */
/**
 * How long a joined list of job references may run before the parent archive
 * counts the remainder instead of naming every one.
 */
const PARENT_NAME_LIMIT = 60;

function packagesOf(shares) {
  const byReport = new Map();
  for (const share of shares) {
    // Shares predating `reportId` are gathered under one key rather than each
    // standing alone: splitting on absent information would turn one package
    // into an archive per document, which is worse than not splitting at all.
    // `undefined` is a perfectly good Map key, so they group without a default.
    const key = share?.reportId;
    if (!byReport.has(key)) byReport.set(key, []);
    byReport.get(key).push(share);
  }
  return [...byReport.values()];
}

/**
 * The job reference a package was exported under.
 *
 * The lab's own name is `X-2026-1338 (AV-2620N_RAK1)`, whose leading part is
 * the job reference. A package named some other way has none to give.
 * @param {Array<Object>} shares - The package's documents.
 * @returns {string} The job reference, or an empty string.
 */
function packageJobRef(shares) {
  for (const share of shares) {
    // An absent name stringifies to something the pattern cannot match, so it
    // needs no default of its own.
    const named = /^([^(]+?)\s*\(.*_RAK[^)]*\)$/.exec(String(share?.reportName).trim());
    if (named) return named[1].trim();
  }
  return "";
}

/**
 * The name a multi-package parent archive downloads under.
 *
 * Named for the job references it carries, so the download says which jobs are
 * inside without being opened. Beyond a few that would run past what a file
 * name can usefully hold, the rest are counted instead of listed.
 * @param {Array<Array<Object>>} packages - The packages going into the archive.
 * @param {string|null} bundleName - The name the sender gave the group link.
 * @returns {string} A file name safe to save under.
 */
function parentArchiveName(packages, bundleName) {
  const refs = packages.map(packageJobRef).filter(Boolean);
  const joined = refs.join(" + ");
  let preferred = bundleName;
  if (refs.length > 0) {
    preferred = joined.length <= PARENT_NAME_LIMIT
      ? joined
      : `${refs[0]} + ${packages.length - 1} more`;
  }
  return safeFileName(preferred) || "reports";
}

/**
 * Save one built file under a name of its own.
 * @param {Uint8Array} bytes - The file's bytes.
 * @param {string} name - File name to save it under.
 * @param {string} mimeType - The file's media type.
 * @returns {void}
 */
function saveFile(bytes, name, mimeType) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const download = document.createElement("a");
  download.href = url;
  download.download = name;
  download.rel = "noopener";
  document.body.appendChild(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Download every document in the package as one ZIP archive.
 *
 * Each document stays its own PDF -- nothing is merged -- and the archive is
 * only a wrapper, so the recipient gets one download and one browser prompt
 * rather than the burst of them a browser throttles and asks to allow. Entries
 * are named into a folder so the archive unpacks tidily, which is what the
 * workspace's own export does. A document that cannot be rebuilt is left out
 * and named in the button's status line rather than failing the rest of the
 * package.
 * @param {Object} sharedBundle - The resolved bundle.
 * @returns {Promise<{saved: number, failed: string[], archiveName: string}>} What was downloaded.
 */
async function downloadEveryDocument(sharedBundle) {
  const ordered = bundleOrder(sharedBundle.reports);
  const packages = packagesOf(ordered);
  const failed = [];

  // Build each package's own entries once. A single package keeps the layout
  // it has always had -- its documents inside a folder named for it -- while
  // several are each sealed into an archive of their own below, where that
  // folder would only repeat the archive's name.
  const nested = packages.length > 1;
  const built = [];
  for (const shares of packages) {
    const baseName = packageArchiveName(shares, sharedBundle.bundleName);
    const claimed = new Set();
    const entries = [];
    for (const [index, share] of shares.entries()) {
      try {
        const data = await sharedDocumentBytes(share);
        const entryName = packageEntryName(share, index, claimed);
        entries.push({ name: nested ? entryName : `${baseName}/${entryName}`, data });
      } catch (error) {
        logDocumentRebuildFailure(error);
        failed.push(share?.reportName || "Untitled report");
      }
    }
    if (entries.length > 0) built.push({ baseName, entries });
  }

  if (built.length === 0) throw new Error("No document in this package could be rebuilt.");
  const saved = built.reduce((total, entry) => total + entry.entries.length, 0);

  if (!nested || built.length === 1) {
    // One package's worth of documents, however many packages were asked for:
    // wrapping a lone archive inside another would add a click and tell the
    // recipient nothing.
    const [only] = built;
    const flat = nested
      ? only.entries.map((entry) => ({ ...entry, name: `${only.baseName}/${entry.name}` }))
      : only.entries;
    const archiveName = `${only.baseName}.zip`;
    saveFile(globalThis.docuAlignZip.createArchive(flat), archiveName, "application/zip");
    return { saved, failed, archiveName };
  }

  // Each package becomes an archive of its own, and those go into the parent,
  // so the recipient still takes one download but unpacks the packages apart.
  const claimedArchives = new Set();
  const children = built.map(({ baseName, entries }) => {
    let name = `${baseName}.zip`;
    let attempt = 1;
    while (claimedArchives.has(name)) {
      attempt += 1;
      name = `${baseName} (${attempt}).zip`;
    }
    claimedArchives.add(name);
    return { name, data: globalThis.docuAlignZip.createArchive(entries) };
  });

  const archiveName = `${parentArchiveName(packages, sharedBundle.bundleName)}.zip`;
  saveFile(globalThis.docuAlignZip.createArchive(children), archiveName, "application/zip");
  return { saved, failed, archiveName };
}

/**
 * Rebuild every document in the package for one print job.
 *
 * Unlike the download button, this merges: a print job is one document by
 * definition, so printing six reports separately would mean six print
 * dialogs. The merged document is sent to the printer and never saved.
 * @param {Object} sharedBundle - The resolved bundle.
 * @returns {Promise<{bytes: Uint8Array, printed: number, failed: string[]}>} The print job.
 */
async function buildPrintJob(sharedBundle) {
  const rendered = [];
  const failed = [];

  for (const share of bundleOrder(sharedBundle.reports)) {
    try {
      rendered.push(await sharedDocumentBytes(share));
    } catch (error) {
      logDocumentRebuildFailure(error);
      failed.push(share?.reportName || "Untitled report");
    }
  }

  if (rendered.length === 0) throw new Error("No document in this package could be rebuilt.");
  return {
    bytes: await globalThis.docuAlignPdfMerge.mergePdfs(rendered),
    printed: rendered.length,
    failed,
  };
}

/**
 * Hand a PDF to the browser's print dialog without navigating away.
 *
 * The frame stays in the document while the dialog is open -- removing it
 * cancels the job in some browsers -- and is cleared on the same grace period
 * a download's object URL gets.
 * @param {Uint8Array} bytes - The PDF to print.
 * @returns {void}
 */
function printDocument(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.className = "print-frame";
  frame.addEventListener("load", () => {
    // Absent when the browser refuses to expose the frame's document, or when
    // it renders PDFs without an embedded viewer. Nothing to do then -- the
    // recipient still has the per-document links to print from.
    if (typeof frame.contentWindow?.print !== "function") return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  });
  document.body.appendChild(frame);
  frame.src = url;
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}

// Build each grouped report entry with DOM APIs (not innerHTML) so report
// names and file names from the share document can never inject markup.
async function bundleReportItem(report) {
  const item = document.createElement("li");
  item.className = "bundle-report";

  const head = document.createElement("div");
  head.className = "report-card-head";
  const title = document.createElement("strong");
  title.textContent = report.reportName || "Untitled report";
  const statusLabel = document.createElement("span");
  statusLabel.className = "report-status";
  statusLabel.textContent = formatShareStatus(report.status).label;
  head.append(title, statusLabel);
  item.append(head);

  if (report.sourceFileName) {
    const source = document.createElement("p");
    source.className = "report-source";
    source.textContent = `Source: ${report.sourceFileName}`;
    item.append(source);
  }

  const anchor = document.createElement("a");
  anchor.className = "google-button share-pdf-button";
  anchor.href = await Promise.resolve(resolveDocumentUrl(report));
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.textContent = "View document";
  item.append(anchor);

  return item;
}

/**
 * Render a package link: every document listed separately, plus one button
 * that downloads all of them as one ZIP and one that prints them all.
 * @param {Object} sharedBundle - The resolved bundle.
 * @returns {Promise<void>} Settles once the panel has rendered.
 */
async function renderSharedBundle(sharedBundle) {
  const ordered = bundleOrder(sharedBundle.reports);
  bundleName.textContent = sharedBundle.bundleName || "Shared reports";
  bundleCount.textContent = `${ordered.length} ${
    ordered.length === 1 ? "document" : "documents"
  }`;
  bundlePublished.textContent = sharedBundle.publishedAt
    ? dateFormatter.format(sharedBundle.publishedAt)
    : "Date unavailable";
  const reportItems = await Promise.all(ordered.map(bundleReportItem));
  bundleList.replaceChildren(...reportItems);

  bundleDownloadNote.textContent = "";
  bundleDownloadNote.hidden = true;
  bundleDownload.disabled = false;
  bundleDownload.textContent = `Download all ${ordered.length} documents (ZIP)`;
  bundleDownload.onclick = () => downloadAllDocuments(sharedBundle);
  bundlePrint.disabled = false;
  bundlePrint.textContent = `Print all ${ordered.length} documents`;
  bundlePrint.onclick = () => printAllDocuments(sharedBundle);

  setStatus("");
  bundlePanel.hidden = false;
}

/**
 * Drive the print-all button: disable it while the print job is assembled,
 * then report what reached the printer and anything that could not.
 * @param {Object} sharedBundle - The resolved bundle.
 * @returns {Promise<void>} Settles once the print dialog has been opened.
 */
async function printAllDocuments(sharedBundle) {
  const label = bundlePrint.textContent;
  bundlePrint.disabled = true;
  bundlePrint.textContent = "Preparing print…";
  bundleDownloadNote.hidden = true;

  try {
    const { bytes, printed, failed } = await buildPrintJob(sharedBundle);
    printDocument(bytes);
    const printedCount = `${printed} ${printed === 1 ? "document" : "documents"}`;
    bundleDownloadNote.textContent = failed.length === 0
      ? `Sent ${printedCount} to your printer as one job.`
      : `Sent ${printedCount} to your printer; could not prepare ${failed.join(", ")}.`;
  } catch (error) {
    logDocumentRebuildFailure(error);
    bundleDownloadNote.textContent =
      "These documents could not be prepared. Ask the sender for a new link.";
  } finally {
    bundleDownloadNote.hidden = false;
    bundlePrint.textContent = label;
    bundlePrint.disabled = false;
  }
}

/**
 * Drive the download-all button: disable it while the documents are prepared,
 * then report what the archive holds and anything that could not go into it.
 * @param {Object} sharedBundle - The resolved bundle.
 * @returns {Promise<void>} Settles once the archive has been offered.
 */
async function downloadAllDocuments(sharedBundle) {
  const label = bundleDownload.textContent;
  bundleDownload.disabled = true;
  bundleDownload.textContent = "Preparing download…";
  bundleDownloadNote.hidden = true;

  try {
    const { saved, failed, archiveName } = await downloadEveryDocument(sharedBundle);
    const savedCount = `${saved} ${saved === 1 ? "document" : "documents"}`;
    bundleDownloadNote.textContent = failed.length === 0
      ? `Downloaded ${archiveName} with ${savedCount}.`
      : `Downloaded ${archiveName} with ${savedCount}; could not prepare ${failed.join(", ")}.`;
  } catch (error) {
    logDocumentRebuildFailure(error);
    bundleDownloadNote.textContent =
      "These documents could not be prepared. Ask the sender for a new link.";
  } finally {
    bundleDownloadNote.hidden = false;
    bundleDownload.textContent = label;
    bundleDownload.disabled = false;
  }
}

/**
 * Resolve the share token from the URL and render the shared report,
 * or an explanatory status message when the link cannot be honoured.
 * @param {string} [search] - Query string override; defaults to the page URL.
 * @returns {Promise<void>} Settles once the viewer has rendered.
 */
export async function initViewer(search = globalThis.location?.search ?? "") {
  const bundleToken = getBundleTokenFromUrl(search);
  const shareToken = getShareTokenFromUrl(search);
  if (!bundleToken && !shareToken) {
    setStatus("This share link is not valid. Check the URL and try again.", "Link not valid");
    logWarn("Share link rejected: missing or malformed token", {
      feature: "PublicShare",
      function: "initViewer",
      operation: "validateShareToken",
      category: "InvalidShareLink",
    });
    return;
  }

  setStatus("Loading shared report…");

  if (bundleToken) {
    try {
      const sharedBundle = await trackOperation(
        "Load shared bundle",
        {
          feature: "PublicShare",
          function: "initViewer",
          operation: "firestore.getDoc",
          collection: "docuAlignPublicBundles",
        },
        () => fetchSharedBundle(db, bundleToken),
      );
      if (!sharedBundle) {
        setStatus(
          "This share link is no longer available. Ask the report owner for a new link.",
          "Report unavailable",
        );
        return;
      }
      await renderSharedBundle(sharedBundle);
    } catch {
      // Failure already logged by trackOperation; show the recovery message.
      setStatus(
        "Could not load this shared report. Check your connection and try again.",
        "Something went wrong",
      );
    }
    return;
  }

  try {
    const share = await trackOperation(
      "Load shared report",
      {
        feature: "PublicShare",
        function: "initViewer",
        operation: "firestore.getDoc",
        collection: "docuAlignPublicShares",
      },
      () => fetchSharedReport(db, shareToken),
    );
    if (!share) {
      setStatus(
        "This share link is no longer available. Ask the report owner for a new link.",
        "Report unavailable",
      );
      return;
    }
    await renderSharedReport(share);
  } catch {
    // Failure already logged by trackOperation; show the recovery message.
    setStatus("Could not load this shared report. Check your connection and try again.");
  }
}

initObservability();
initViewer();
