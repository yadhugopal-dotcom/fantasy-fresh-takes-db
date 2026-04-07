import {
  createGoogleSheetsClient,
  GOOGLE_SHEETS_READONLY_SCOPE,
} from "./google-service.js";

const SPREADSHEET_ID = "1N2gdkRi3uEaJneHAZatIVZ5YEBXpBEkC-Kbt0eut2Lg";
const SHEET_TAB = "Ideation tracker";
const SHEET_RANGE = `${SHEET_TAB}!A:Z`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_STATUSES = new Set(["GTG", "GTG - minor changes", "Approved", "Review pending", "Iterate"]);
let beatDocsCache = {
  expiresAt: 0,
  items: null,
};

const HEADER_ALIASES = {
  showName: ["show", "showname"],
  beatName: ["beatname", "beat", "beats"],
  podName: ["pod", "podname", "podlead"],
  beatDoc: ["beatdoc", "beatdocforalleditsandfreshbeats", "beatdoclink", "sheeturl", "sheetlink"],
  status: ["beatsstatus", "beatstatus", "status"],
};

function getFormattedValue(cell) {
  return typeof cell?.formattedValue === "string" ? cell.formattedValue.trim() : "";
}

function normalizeHeaderValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function matchesAlias(value, aliases) {
  const normalized = normalizeHeaderValue(value);
  return aliases.includes(normalized);
}

function findHeaderIndexes(headerCells = []) {
  const headerValues = headerCells.map((cell) => getFormattedValue(cell));

  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
      key,
      headerValues.findIndex((value) => matchesAlias(value, aliases)),
    ])
  );
}

function getCellAt(values, index) {
  return Number.isInteger(index) && index >= 0 ? values[index] || {} : {};
}

function hasRequiredHeaderIndexes(indexes) {
  return ["showName", "beatName", "podName", "beatDoc", "status"].every(
    (key) => Number.isInteger(indexes[key]) && indexes[key] >= 0
  );
}

async function fetchBeatDocsFromSheet() {
  const sheets = createGoogleSheetsClient([GOOGLE_SHEETS_READONLY_SCOPE]);
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [SHEET_RANGE],
    includeGridData: true,
    fields: "sheets(data(rowData(values(formattedValue,hyperlink))))",
  });

  const rows = response.data.sheets?.[0]?.data?.[0]?.rowData || [];

  let headerRowIndex = -1;
  let headerIndexes = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const candidate = findHeaderIndexes(rows[i]?.values || []);
    if (hasRequiredHeaderIndexes(candidate)) {
      headerRowIndex = i;
      headerIndexes = candidate;
      break;
    }
  }

  if (headerRowIndex === -1 || !headerIndexes) {
    throw new Error("Beat doc sheet is missing one or more required columns.");
  }

  const items = [];

  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const values = row.values || [];
    const showName = getFormattedValue(getCellAt(values, headerIndexes.showName));
    const beatName = getFormattedValue(getCellAt(values, headerIndexes.beatName));
    const podName = getFormattedValue(getCellAt(values, headerIndexes.podName));
    const docCell = getCellAt(values, headerIndexes.beatDoc);
    const status = getFormattedValue(getCellAt(values, headerIndexes.status));
    const beatTitle = getFormattedValue(docCell) || beatName;
    const beatDocUrl = typeof docCell.hyperlink === "string" ? docCell.hyperlink.trim() : "";
    const sheetRowId = `sheet-row-${index + 2}`;

    if (!ALLOWED_STATUSES.has(status)) {
      return;
    }

    if (!beatTitle && !showName) {
      return;
    }

    items.push({
      id: sheetRowId,
      sheetRowId,
      showName,
      beatName,
      beatTitle,
      podName,
      status,
      beatDocUrl,
    });
  });

  return items.sort((left, right) => {
    const leftKey = `${left.beatTitle} ${left.showName} ${left.beatName}`.toLowerCase();
    const rightKey = `${right.beatTitle} ${right.showName} ${right.beatName}`.toLowerCase();
    return leftKey.localeCompare(rightKey);
  });
}

export async function listBeatDocs({ force = false } = {}) {
  const now = Date.now();

  if (!force && beatDocsCache.items && beatDocsCache.expiresAt > now) {
    return {
      items: beatDocsCache.items,
      cached: true,
      expiresAt: beatDocsCache.expiresAt,
    };
  }

  const items = await fetchBeatDocsFromSheet();
  beatDocsCache = {
    items,
    expiresAt: now + CACHE_TTL_MS,
  };

  return {
    items,
    cached: false,
    expiresAt: beatDocsCache.expiresAt,
  };
}
