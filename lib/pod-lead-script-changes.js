import { createRequire } from "node:module";
import {
  createGoogleDriveClient,
  createGoogleSheetsClient,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
} from "./google-service.js";
import { LIVE_TAB_NAME, LIVE_TAB_SHEET_URL } from "./live-tab.js";
import {
  normalizePodLeadMatchName,
  normalizeShowName,
  normalizeWhitespace,
} from "./pod-lead-script-changes-config.js";
import { readJsonObject, writeJsonObject } from "./storage.js";

const require = createRequire(import.meta.url);
const { parseGoogleSheetId } = require("./ops/cjs/_lib.cjs");

const LIVE_TAB_RANGE = `${LIVE_TAB_NAME}!F:O`;
const CACHE_PATH = "cache/pod-lead-script-changes.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REVISION_PAGE_SIZE = 200;
const REVISION_CONCURRENCY = 5;

const reportCache = {
  expiresAt: 0,
  payload: null,
  pending: null,
};

function isUsableCellValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

function makeOutcome({
  rowNumber,
  showName,
  podLeadName,
  docLabel = "",
  docUrl = "",
  docFileId = "",
  status,
  reason = "",
}) {
  return {
    rowNumber,
    showName,
    podLeadName,
    docLabel,
    docUrl,
    docFileId,
    status,
    reason,
  };
}

function parseHyperlinkFormula(formula) {
  const value = String(formula || "");
  const match = value.match(/HYPERLINK\("([^"]+)"/i);
  return match ? match[1].trim() : "";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractCellLink(cell) {
  const directHyperlink = normalizeWhitespace(cell?.hyperlink);
  if (isHttpUrl(directHyperlink)) {
    return directHyperlink;
  }

  const formattedValue = normalizeWhitespace(cell?.formattedValue);
  if (isHttpUrl(formattedValue)) {
    return formattedValue;
  }

  const stringValue = normalizeWhitespace(cell?.userEnteredValue?.stringValue);
  if (isHttpUrl(stringValue)) {
    return stringValue;
  }

  const formulaLink = parseHyperlinkFormula(cell?.userEnteredValue?.formulaValue);
  if (isHttpUrl(formulaLink)) {
    return formulaLink;
  }

  return "";
}

function extractGoogleDocFileId(docUrl) {
  const value = normalizeWhitespace(docUrl);

  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (!hostname.endsWith("google.com")) {
      return "";
    }

    const directMatch = url.pathname.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    if (directMatch) {
      return directMatch[1];
    }

    const searchId = url.searchParams.get("id");
    if (searchId && /^[a-zA-Z0-9-_]+$/.test(searchId)) {
      return searchId;
    }

    return "";
  } catch {
    return "";
  }
}

function getTrackerSpreadsheetId() {
  const spreadsheetId = parseGoogleSheetId(LIVE_TAB_SHEET_URL);

  if (!spreadsheetId) {
    throw new Error("Live tab spreadsheet ID is invalid.");
  }

  return spreadsheetId;
}

async function fetchLiveTabScriptRows() {
  const sheets = createGoogleSheetsClient([GOOGLE_SHEETS_READONLY_SCOPE]);
  const spreadsheetId = getTrackerSpreadsheetId();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [LIVE_TAB_RANGE],
    includeGridData: true,
    fields: "sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue))))",
  });

  const rowData = response.data.sheets?.[0]?.data?.[0]?.rowData || [];

  return {
    spreadsheetId,
    rows: rowData
      .slice(1)
      .map((row, index) => {
        const values = row?.values || [];
        const showName = normalizeShowName(values[0]?.formattedValue);
        const podLeadName = normalizePodLeadMatchName(values[2]?.formattedValue);
        const docCell = values[9] || {};
        const docLabel = normalizeWhitespace(docCell.formattedValue);
        const docUrl = extractCellLink(docCell);

        return {
          rowNumber: index + 2,
          showName,
          podLeadName,
          docLabel,
          docUrl,
        };
      })
      .filter((row) =>
        [row.showName, row.podLeadName, row.docLabel, row.docUrl].some((value) => isUsableCellValue(value))
      ),
  };
}

function sortRevisionsAscending(revisions) {
  return [...revisions]
    .map((revision, index) => ({ ...revision, originalIndex: index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.modifiedTime || "");
      const rightTime = Date.parse(right.modifiedTime || "");

      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      if (Number.isNaN(leftTime) !== Number.isNaN(rightTime)) {
        return Number.isNaN(leftTime) ? 1 : -1;
      }

      return left.originalIndex - right.originalIndex;
    });
}

function buildDocRevisionMetrics(doc, revisions) {
  if (!Array.isArray(revisions) || revisions.length === 0) {
    return null;
  }

  const orderedRevisions = sortRevisionsAscending(revisions);
  const postInitialRevisions = orderedRevisions.slice(1);
  const podLeadMatchName = normalizePodLeadMatchName(doc.podLeadName);
  const leadChanges = postInitialRevisions.filter(
    (revision) => normalizePodLeadMatchName(revision?.lastModifyingUser?.displayName) === podLeadMatchName
  ).length;
  const unknownUserRevisionCount = postInitialRevisions.filter(
    (revision) => !normalizeWhitespace(revision?.lastModifyingUser?.displayName)
  ).length;

  return {
    revisionCount: orderedRevisions.length,
    totalChanges: Math.max(orderedRevisions.length - 1, 0),
    leadChanges,
    unknownUserRevisionCount,
  };
}

function classifyDriveError(error) {
  const message = String(error?.message || "");
  const lowered = message.toLowerCase();

  if (
    lowered.includes("drive api has not been used") ||
    lowered.includes("api drive.googleapis.com is not enabled")
  ) {
    return {
      code: "drive_api_unavailable",
      reason: "Google Drive API is unavailable for the configured service account project",
    };
  }

  if (
    lowered.includes("requested entity was not found") ||
    lowered.includes("file not found") ||
    lowered.includes("not found")
  ) {
    return {
      code: "doc_not_found",
      reason: "Google Doc not found or no longer accessible",
    };
  }

  if (
    lowered.includes("insufficient permissions") ||
    lowered.includes("the caller does not have permission") ||
    lowered.includes("forbidden")
  ) {
    return {
      code: "doc_permission_denied",
      reason: "Google Doc is not shared with the service account",
    };
  }

  if (lowered.includes("login required") || lowered.includes("unauthorized")) {
    return {
      code: "drive_auth_error",
      reason: "Google Drive credentials are not authorized for revisions access",
    };
  }

  return {
    code: "drive_request_failed",
    reason: "Drive revisions request failed",
  };
}

async function listAllRevisions(drive, fileId) {
  const revisions = [];
  let pageToken = undefined;

  do {
    const response = await drive.revisions.list({
      fileId,
      pageSize: REVISION_PAGE_SIZE,
      pageToken,
      fields: "nextPageToken,revisions(id,modifiedTime,lastModifyingUser(displayName))",
    });

    if (Array.isArray(response.data?.revisions)) {
      revisions.push(...response.data.revisions);
    }

    pageToken = response.data?.nextPageToken || undefined;
  } while (pageToken);

  return revisions;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function buildPodLeadScriptChangesReport() {
  const { spreadsheetId, rows } = await fetchLiveTabScriptRows();
  const shows = new Set();
  const outcomes = [];
  const candidates = [];
  const seenKeys = new Set();

  for (const row of rows) {
    if (row.showName) {
      shows.add(row.showName);
    }

    if (!row.podLeadName) {
      outcomes.push(
        makeOutcome({
          ...row,
          status: "ignored",
          reason: "Missing POD lead",
        })
      );
      continue;
    }

    if (!row.docUrl) {
      outcomes.push(
        makeOutcome({
          ...row,
          status: "ignored",
          reason: "Missing script URL",
        })
      );
      continue;
    }

    const docFileId = extractGoogleDocFileId(row.docUrl);
    if (!docFileId) {
      outcomes.push(
        makeOutcome({
          ...row,
          status: "skipped",
          reason: "Invalid or non-Docs script URL",
        })
      );
      continue;
    }

    const dedupeKey = [row.podLeadName.toLowerCase(), row.showName.toLowerCase(), docFileId].join("::");
    if (seenKeys.has(dedupeKey)) {
      outcomes.push(
        makeOutcome({
          ...row,
          docFileId,
          status: "ignored",
          reason: "Duplicate POD lead + show + doc",
        })
      );
      continue;
    }

    seenKeys.add(dedupeKey);
    candidates.push({
      ...row,
      docFileId,
    });
  }

  const drive = createGoogleDriveClient([GOOGLE_DRIVE_READONLY_SCOPE]);
  let globalDriveFailure = "";
  const candidateResults = await mapWithConcurrency(candidates, REVISION_CONCURRENCY, async (candidate) => {
    if (globalDriveFailure) {
      return {
        validEntry: null,
        outcome: makeOutcome({
          ...candidate,
          status: "skipped",
          reason: globalDriveFailure,
        }),
      };
    }

    try {
      const revisions = await listAllRevisions(drive, candidate.docFileId);
      const metrics = buildDocRevisionMetrics(candidate, revisions);

      if (!metrics) {
        return {
          validEntry: null,
          outcome: makeOutcome({
            ...candidate,
            status: "skipped",
            reason: "Revision history unavailable",
          }),
        };
      }

      return {
        validEntry: {
          rowNumber: candidate.rowNumber,
          showName: candidate.showName,
          podLeadName: candidate.podLeadName,
          docLabel: candidate.docLabel,
          docUrl: candidate.docUrl,
          docFileId: candidate.docFileId,
          ...metrics,
        },
        outcome: makeOutcome({
          ...candidate,
          status: "valid",
        }),
      };
    } catch (error) {
      const failure = classifyDriveError(error);
      if (failure.code === "drive_api_unavailable" || failure.code === "drive_auth_error") {
        globalDriveFailure = failure.reason;
      }

      return {
        validEntry: null,
        outcome: makeOutcome({
          ...candidate,
          status: "skipped",
          reason: failure.reason,
        }),
      };
    }
  });

  const validEntries = candidateResults
    .map((result) => result?.validEntry)
    .filter(Boolean)
    .sort((left, right) => left.rowNumber - right.rowNumber);

  outcomes.push(
    ...candidateResults
      .map((result) => result?.outcome)
      .filter(Boolean)
      .sort((left, right) => left.rowNumber - right.rowNumber)
  );

  return {
    generatedAt: new Date().toISOString(),
    cacheTtlHours: CACHE_TTL_MS / 3600000,
    source: {
      spreadsheetId,
      tabName: LIVE_TAB_NAME,
      range: LIVE_TAB_RANGE,
      revisionConcurrency: REVISION_CONCURRENCY,
    },
    shows: Array.from(shows).sort((left, right) => left.localeCompare(right)),
    validEntries,
    outcomes: outcomes.sort((left, right) => left.rowNumber - right.rowNumber),
  };
}

function makeCacheEnvelope(payload) {
  return {
    cachedAt: new Date().toISOString(),
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  };
}

function updateMemoryCache(cacheEnvelope) {
  reportCache.payload = cacheEnvelope.payload;
  reportCache.expiresAt = Number(cacheEnvelope.expiresAt || 0);
}

function isFreshCache(cacheEnvelope) {
  return (
    cacheEnvelope &&
    typeof cacheEnvelope === "object" &&
    cacheEnvelope.payload &&
    Number(cacheEnvelope.expiresAt || 0) > Date.now()
  );
}

async function readPersistedCache() {
  try {
    const cacheEnvelope = await readJsonObject(CACHE_PATH);
    return isFreshCache(cacheEnvelope) ? cacheEnvelope : null;
  } catch {
    return null;
  }
}

async function persistCache(cacheEnvelope) {
  try {
    await writeJsonObject(CACHE_PATH, cacheEnvelope);
  } catch {
    // Persisted cache is optional. The page can still rely on in-memory caching.
  }
}

export async function getPodLeadScriptChangesReport({ force = false } = {}) {
  if (!force && reportCache.payload && reportCache.expiresAt > Date.now()) {
    return reportCache.payload;
  }

  if (!force && reportCache.pending) {
    return reportCache.pending;
  }

  const pending = (async () => {
    if (!force) {
      const persistedCache = await readPersistedCache();

      if (persistedCache) {
        updateMemoryCache(persistedCache);
        return persistedCache.payload;
      }
    }

    const payload = await buildPodLeadScriptChangesReport();
    const cacheEnvelope = makeCacheEnvelope(payload);
    updateMemoryCache(cacheEnvelope);
    await persistCache(cacheEnvelope);
    return payload;
  })();

  reportCache.pending = pending;

  try {
    return await pending;
  } finally {
    reportCache.pending = null;
  }
}
