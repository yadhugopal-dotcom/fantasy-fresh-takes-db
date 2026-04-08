
import { readJsonObject, writeJsonObject } from "./storage.js";

import { createRequire } from "node:module";
import { buildDateRangeSelection, formatWeekRangeLabel, getWeekSelection, normalizeWeekView, shiftYmd, todayInIstYmd } from "./week-view.js";


const require = createRequire(import.meta.url);
const {
  makeError,
  parseGoogleSheetId,
  parseCsv,
  parseWorkDate,
  round2,
} = require("./ops/cjs/_lib.cjs");

export const LIVE_TAB_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1N2gdkRi3uEaJneHAZatIVZ5YEBXpBEkC-Kbt0eut2Lg/edit?gid=270769039#gid=270769039";
export const LIVE_TAB_NAME = "Live";
export const EDITORIAL_TAB_NAME = "Editorial";
export const READY_FOR_PRODUCTION_TAB_NAME = "Ready for Production";
export const PRODUCTION_TAB_NAME = "Production";
export const IDEATION_TAB_NAME = "Ideation tracker";
export const WRITER_TARGET_PER_WEEK = 1.5;
export const TARGET_FLOOR = 22;
export const GOOD_TO_GO_BEATS_TARGET = 30;
export const POD_LEAD_ORDER = ["Paul", "Josh", "Nishant", "Dan"];

function normalizeAliasKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const POD_LEAD_ALIASES = new Map(
  [
    ["Paul", ["paul", "paul lee", "paul s lee", "lee"]],
    ["Josh", ["josh", "josh roth", "joshua", "joshua roth", "roth"]],
    ["Nishant", ["nishant", "nishant gilatar", "gilatar"]],
    ["Dan", ["dan", "dan woodward", "woodward"]],
  ].flatMap(([canonicalName, aliases]) => aliases.map((alias) => [normalizeAliasKey(alias), canonicalName]))
);

const LIVE_TAB_COL_INDEX = {
  assetCode: 1,       // B (0-based)
  showName: 6,        // G
  beatName: 7,        // H
  baseAssetCode: 16,  // Q
  podLead: 2,         // C
  writer: 8,          // I — unchanged from original
  productionType: 8,  // I
  reworkType: 9,      // J (0-based)
  tatStartDate: 24,   // Y — date picked for production
  cdName: 27,         // AB — unchanged from original
  uploadDate: 75,     // BX
};

const ANALYTICS_LIVE_TAB_COL_INDEX = {
  assetCode: 1,        // B (0-based)
  showName: 6,         // G
  beatName: 7,         // H
  podLead: 2,          // C
  productionType: 8,   // I

  assetLink: 74,       // BW
  uploadDate: 75,      // BX
  threeSecPlayPct: 80, // CC
  thruPlaysPct: 81,    // CD
  video0To25Pct: 82,   // CE
  video25To50Pct: 83,  // CF
  video50To75Pct: 84,  // CG
  video75To95Pct: 85,  // CH
  video0To95Pct: 86,   // CI
  thruPlayTo3sRatio: 87, // CJ
  absoluteCompletionPct: 88, // CK
  cpmUsd: 90,          // CM
  cpiUsd: 91,          // CN
  ctrPct: 92,          // CO
  amountSpentUsd: 93,  // CP
  outboundClicksToCompletionPct: 94, // CQ
  reach: 95,           // CR
  impressions: 96,     // CS
  clickToInstall: 97,  // CT
};

const PRODUCTION_TAB_COL_INDEX = {
  assetCode: 1,
  status: 4,
  showName: 5,
  beatName: 6,
  podLead: 7,
  writer: 8,
  productionType: 9,
  iteration: 11,
  reworkType: 12,
  productionPickedDate: 24,
};

const EDITORIAL_TAB_COL_INDEX = {
  assetCode: 1,
  submittedDate: 3,
  status: 4,
  showName: 5,
  beatName: 6,
  podLead: 7,
  writer: 8,
  productionType: 9,
  iteration: 11,
  reworkType: 12,
};

const IDEATION_TAB_COL_INDEX = {
  showName: 0,           // A
  beatName: 1,           // B
  podLead: 2,            // C — POD lead name
  beatCode: 3,           // D — beat/code reference when available
  beatsAssignedDate: 6,  // G — Beats completed date (dates or "Mar week 3" labels)
  assignedDate: 5,       // F — best-effort assigned date
  completedDate: 6,      // G — best-effort completed / bucket date
  beatsStatus: 4,        // E — Beats status (Review pending, Approved, Iterate, etc.)
  status: 4,             // E — same column, used for GTG filtering
};

const SHOW_NAME_ALIAS_GROUPS = [
  ["first legendary beast master", ["flbm", "first legendary beast master"]],
  ["my vampire system", ["mvs", "my vampire system"]],
  ["weakest beast tamer", ["wbt", "weakest beast tamer"]],
];

const SHOW_NAME_ALIASES = new Map(
  SHOW_NAME_ALIAS_GROUPS.flatMap(([canonicalName, aliases]) =>
    aliases.map((alias) => [normalizeAliasKey(alias), canonicalName])
  )
);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeHeaderKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeBeatMatchKey(value) {
  return normalizeKey(value);
}

export function normalizeShowMatchKey(value) {
  const normalized = normalizeAliasKey(value);
  if (!normalized) {
    return "";
  }

  return SHOW_NAME_ALIASES.get(normalized) || normalized;
}

export function makeBeatShowMatchKey(showName, beatName) {
  const showKey = normalizeShowMatchKey(showName);
  const beatKey = normalizeBeatMatchKey(beatName);
  if (!showKey || !beatKey) {
    return "";
  }

  return `${showKey}|${beatKey}`;
}

export function buildBeatShowMatchIndex(rows, options = {}) {
  const showField = String(options.showField || "showName");
  const beatField = String(options.beatField || "beatName");
  const index = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = makeBeatShowMatchKey(row?.[showField], row?.[beatField]);
    if (!key) {
      continue;
    }

    if (!index.has(key)) {
      index.set(key, []);
    }

    index.get(key).push(row);
  }

  return index;
}

function looksLikeHtml(text) {
  const start = String(text || "").trim().slice(0, 40).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function isValidYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

const MONTH_ABBR = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonthDayNoYear(text) {
  const normalized = String(text || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  // "Mar 16" or "March 16"
  let match = normalized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (!match) {
    // "16 Mar" or "16 March"
    match = normalized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
    if (match) match = [match[0], match[2], match[1]]; // swap to [_, month, day]
  }
  if (!match) return "";

  const monthKey = match[1].slice(0, 3).toLowerCase();
  const month = MONTH_ABBR[monthKey];
  const day = Number(match[2]);
  if (!month) return "";

  const year = Number(todayInIstYmd().slice(0, 4));
  if (!isValidYmd(year, month, day)) return "";

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCompactDateDdmmyyyy(text) {
  const value = normalizeText(text).replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(value)) return "";

  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const year = Number(value.slice(4, 8));
  if (!isValidYmd(year, month, day)) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCompactDateYyyymmdd(text) {
  const value = normalizeText(text).replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(value)) return "";

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (!isValidYmd(year, month, day)) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseLiveDate(rawValue) {
  if (rawValue instanceof Date || typeof rawValue === "number") {
    const parsed = parseWorkDate(rawValue);
    if (parsed) return parsed;
  }

  const text = normalizeText(rawValue);
  if (!text) return "";

  const ddmmyyyy = parseCompactDateDdmmyyyy(text);
  if (ddmmyyyy) return ddmmyyyy;

  const yyyymmdd = parseCompactDateYyyymmdd(text);
  if (yyyymmdd) return yyyymmdd;

  const workDate = parseWorkDate(text);
  if (workDate) return workDate;

  return parseMonthDayNoYear(text);
}

function makeAssetKey(row) {
  return row.assetCode || row.baseAssetCode || `row-${row.rowIndex}`;
}

function getReleasedDate(row) {
  return row?.liveDate || row?.uploadDate || "";
}

export function getReleasedDateForRow(row) {
  return getReleasedDate(row);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function toDisplayName(value, fallback = "") {
  const cleaned = normalizeText(value);
  if (!cleaned) return fallback;

  return cleaned
    .split(" ")
    .map((part) => {
      if (!part) return "";
      if (/^[A-Z0-9]+$/.test(part) || /^[a-z0-9]+$/.test(part)) {
        return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

function normalizeProductionType(value) {
  return normalizeKey(value);
}

function parseMetricNumber(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const normalized = text.replace(/[$,%\s,]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

function parseMetricPercent(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const parsed = parseMetricNumber(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (text.includes("%")) {
    return parsed;
  }

  return Math.abs(parsed) <= 1 ? round2(parsed * 100) : parsed;
}

function countAnalyticsMetricFields(row) {
  return [
    row?.threeSecPlayPct,
    row?.thruPlaysPct,
    row?.video0To25Pct,
    row?.video25To50Pct,
    row?.video50To75Pct,
    row?.video75To95Pct,
    row?.video0To95Pct,
    row?.thruPlayTo3sRatio,
    row?.cpmUsd,
    row?.cpiUsd,
    row?.ctrPct,
    row?.amountSpentUsd,
    row?.outboundClicksToCompletionPct,
    row?.reach,
    row?.impressions,
    row?.clickToInstall,
  ].filter((value) => value !== null && value !== undefined && value !== "").length;
}

export function isAnalyticsEligibleProductionType(value) {
  const normalized = normalizeProductionType(value);
  return normalized === "q1 manual + thumbnail" || normalized === "q1 auto ai + thumbnail";
}

function normalizeIterationType(value) {
  return normalizeKey(value);
}

function normalizeProductionStatus(value) {
  return normalizeKey(value);
}

export function normalizeIdeationWeekLabel(value) {
  return normalizeText(value)
    .replace(/\bweek\b/gi, "Week")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getIdeationWeekBucket(weekSelection) {
  const weekStart = String(weekSelection?.weekStart || "");
  if (!weekStart) return "";

  const [year, month, day] = weekStart.split("-").map(Number);
  if (!year || !month || !day) return "";

  const weekDate = new Date(Date.UTC(year, month - 1, day, 12));
  const monthLabel = weekDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const weekNumber = Math.floor((day - 1) / 7) + 1;
  return `${monthLabel} Week ${weekNumber}`;
}

export function isQ1ManualThumbnailProductionType(value) {
  return normalizeProductionType(value) === "q1 manual + thumbnail";
}

export function isTatEligibleProductionType(value) {
  const normalized = normalizeProductionType(value);
  return Boolean(normalized) && normalized !== "genai-cinematic-still";
}

function isScriptIteration(value) {
  return normalizeIterationType(value) === "script iteration";
}

function isCompletedProductionStatus(value) {
  const normalized = normalizeProductionStatus(value);
  return normalized === "uploaded" || normalized.startsWith("meta upload pending");
}

export function normalizePodLeadName(value) {
  const cleaned = normalizeText(value);
  if (!cleaned) {
    return "";
  }

  return POD_LEAD_ALIASES.get(normalizeAliasKey(cleaned)) || toDisplayName(cleaned);
}

function isBetterLiveRowCandidate(nextRow, currentRow) {
  const nextScore =
    (getReleasedDate(nextRow) ? 4 : 0) +
    (nextRow.podLeadName ? 2 : 0) +
    (nextRow.writerName ? 1 : 0) +
    (nextRow.baseAssetCode ? 1 : 0);
  const currentScore =
    (getReleasedDate(currentRow) ? 4 : 0) +
    (currentRow.podLeadName ? 2 : 0) +
    (currentRow.writerName ? 1 : 0) +
    (currentRow.baseAssetCode ? 1 : 0);

  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  return String(getReleasedDate(nextRow) || "") > String(getReleasedDate(currentRow) || "");
}

function uniqueReleasedRows(rows, weekSelection, filterFn = () => true) {
  const selection = weekSelection || getWeekSelection("current");
  const deduped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const releasedDate = getReleasedDate(row);
    if (!releasedDate || releasedDate < selection.weekStart || releasedDate > selection.weekEnd) {
      continue;
    }

    if (!filterFn(row)) {
      continue;
    }

    const assetKey = makeAssetKey(row);
    if (!assetKey) {
      continue;
    }

    if (!deduped.has(assetKey) || isBetterLiveRowCandidate(row, deduped.get(assetKey))) {
      deduped.set(assetKey, row);
    }
  }

  return Array.from(deduped.values());
}

function uniqueReleasedFreshTakeAngles(rows, weekSelection) {
  const selection = weekSelection || getWeekSelection("current");
  const deduped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const releasedDate = getReleasedDate(row);
    if (!releasedDate || releasedDate < selection.weekStart || releasedDate > selection.weekEnd) {
      continue;
    }

    const reworkType = normalizeKey(row?.reworkType);
    const isFreshTakeUniverse = isFreshTakesLabel(row?.reworkType) || reworkType === "new q1" || reworkType.startsWith("new q1 ");
    if (!isFreshTakeUniverse) {
      continue;
    }

    const angleKey = normalizeBeatMatchKey(row?.beatName);
    if (!angleKey) {
      continue;
    }

    if (!deduped.has(angleKey) || isBetterLiveRowCandidate(row, deduped.get(angleKey))) {
      deduped.set(angleKey, row);
    }
  }

  return Array.from(deduped.values());
}

function isThroughputFreshTakeRow(row) {
  const reworkType = normalizeKey(row?.reworkType);
  return isFreshTakesLabel(row?.reworkType) || reworkType === "new q1";
}

export function buildReleasedFreshTakeAttemptsForPeriod(rows, period = "current") {
  const weekSelection = getWeekSelection(normalizeWeekView(period));

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const releasedDate = getReleasedDate(row);
    return (
      Boolean(releasedDate) &&
      releasedDate >= weekSelection.weekStart &&
      releasedDate <= weekSelection.weekEnd &&
      isThroughputFreshTakeRow(row) &&
      normalizeShowMatchKey(row?.showName) &&
      normalizeBeatMatchKey(row?.beatName)
    );
  });
}

export function buildReleasedFreshTakeAttemptsForRange(rows, startDate, endDate) {
  const rangeSelection = buildDateRangeSelection({ startDate, endDate });

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const releasedDate = getReleasedDate(row);
    return (
      Boolean(releasedDate) &&
      releasedDate >= rangeSelection.startDate &&
      releasedDate <= rangeSelection.endDate &&
      isThroughputFreshTakeRow(row) &&
      normalizeShowMatchKey(row?.showName) &&
      normalizeBeatMatchKey(row?.beatName)
    );
  });
}

export function buildShowAngleAttemptBreakdownFromRows(rows) {
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const showKey = normalizeShowMatchKey(row?.showName);
    const angleKey = normalizeBeatMatchKey(row?.beatName);
    if (!showKey || !angleKey) {
      continue;
    }

    if (!grouped.has(showKey)) {
      grouped.set(showKey, {
        showKey,
        showName: row?.showName || "Unknown show",
        totalAttempts: 0,
        angles: new Map(),
      });
    }

    const showGroup = grouped.get(showKey);
    showGroup.totalAttempts += 1;

    if (!showGroup.angles.has(angleKey)) {
      showGroup.angles.set(angleKey, {
        angleKey,
        angleName: row?.beatName || "Unknown angle",
        attempts: 0,
      });
    }

    showGroup.angles.get(angleKey).attempts += 1;
  }

  return Array.from(grouped.values())
    .map((group) => ({
      showName: group.showName,
      totalAttempts: group.totalAttempts,
      angles: Array.from(group.angles.values()).sort(
        (a, b) => b.attempts - a.attempts || a.angleName.localeCompare(b.angleName)
      ),
    }))
    .sort((a, b) => b.totalAttempts - a.totalAttempts || a.showName.localeCompare(b.showName));
}

export function buildReleasedRowsForPeriod(rows, period = "current", filterFn = () => true) {
  const weekSelection = getWeekSelection(normalizeWeekView(period));
  return uniqueReleasedRows(rows, weekSelection, filterFn);
}

export function buildUniqueFreshTakeAnglesForPeriod(rows, period = "current") {
  const weekSelection = getWeekSelection(normalizeWeekView(period));
  return uniqueReleasedFreshTakeAngles(rows, weekSelection);
}

function getLiveDataStatus(rows, weekSelection) {
  const liveRows = Array.isArray(rows) ? rows.filter((row) => getReleasedDate(row)) : [];
  return {
    hasLiveData: liveRows.length > 0,
    hasWeekData: liveRows.some(
      (row) => {
        const releasedDate = getReleasedDate(row);
        return releasedDate >= weekSelection.weekStart && releasedDate <= weekSelection.weekEnd;
      }
    ),
  };
}

function normalizeLiveTabRow(rawRow, rowIndex) {
  const row = Array.isArray(rawRow) ? rawRow : [];

  return {
    rowIndex,
    assetCode: normalizeText(row[LIVE_TAB_COL_INDEX.assetCode]),
    showName: normalizeText(row[LIVE_TAB_COL_INDEX.showName]),
    beatName: normalizeText(row[LIVE_TAB_COL_INDEX.beatName]),
    baseAssetCode: normalizeText(row[LIVE_TAB_COL_INDEX.baseAssetCode]),
    podLeadName: normalizePodLeadName(row[LIVE_TAB_COL_INDEX.podLead]),
    writerName: normalizeText(row[LIVE_TAB_COL_INDEX.writer]),
    productionType: normalizeText(row[LIVE_TAB_COL_INDEX.productionType]),
    reworkType: normalizeText(row[LIVE_TAB_COL_INDEX.reworkType]),
    tatStartDate: parseLiveDate(row[LIVE_TAB_COL_INDEX.tatStartDate]),
    cdName: normalizeText(row[LIVE_TAB_COL_INDEX.cdName]),
    uploadDate: parseWorkDate(row[LIVE_TAB_COL_INDEX.uploadDate]),
    liveDate: parseLiveDate(row[LIVE_TAB_COL_INDEX.uploadDate]),
  };
}

function normalizeAnalyticsLiveTabRow(rawRow, rowIndex) {
  const row = Array.isArray(rawRow) ? rawRow : [];
  const normalizedRow = {
    rowIndex,
    assetCode: normalizeText(row[ANALYTICS_LIVE_TAB_COL_INDEX.assetCode]),
    showName: normalizeText(row[ANALYTICS_LIVE_TAB_COL_INDEX.showName]),
    beatName: normalizeText(row[ANALYTICS_LIVE_TAB_COL_INDEX.beatName]),
    podLeadName: normalizePodLeadName(row[ANALYTICS_LIVE_TAB_COL_INDEX.podLead]),
    productionType: normalizeText(row[ANALYTICS_LIVE_TAB_COL_INDEX.productionType]),
    assetLink: normalizeText(row[ANALYTICS_LIVE_TAB_COL_INDEX.assetLink]),
    liveDate: parseLiveDate(row[ANALYTICS_LIVE_TAB_COL_INDEX.uploadDate]),
    threeSecPlayPct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.threeSecPlayPct]),
    thruPlaysPct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.thruPlaysPct]),
    video0To25Pct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.video0To25Pct]),
    video25To50Pct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.video25To50Pct]),
    video50To75Pct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.video50To75Pct]),
    video75To95Pct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.video75To95Pct]),
    video0To95Pct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.video0To95Pct]),
    thruPlayTo3sRatio: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.thruPlayTo3sRatio]),
    absoluteCompletionPct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.absoluteCompletionPct]),
    cpmUsd: parseMetricNumber(row[ANALYTICS_LIVE_TAB_COL_INDEX.cpmUsd]),
    cpiUsd: parseMetricNumber(row[ANALYTICS_LIVE_TAB_COL_INDEX.cpiUsd]),
    ctrPct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.ctrPct]),
    amountSpentUsd: parseMetricNumber(row[ANALYTICS_LIVE_TAB_COL_INDEX.amountSpentUsd]),
    outboundClicksToCompletionPct: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.outboundClicksToCompletionPct]),
    reach: parseMetricNumber(row[ANALYTICS_LIVE_TAB_COL_INDEX.reach]),
    impressions: parseMetricNumber(row[ANALYTICS_LIVE_TAB_COL_INDEX.impressions]),
    clickToInstall: parseMetricPercent(row[ANALYTICS_LIVE_TAB_COL_INDEX.clickToInstall]),
  };

  return {
    ...normalizedRow,
    metricsCompletenessScore: countAnalyticsMetricFields(normalizedRow),
  };
}

export function isFreshTakesLabel(value) {
  const normalized = normalizeKey(value);
  return normalized === "fresh take" || normalized === "fresh takes";
}

export function isProductionReworkLabel(value) {
  const normalized = normalizeKey(value);
  return normalized.includes("production") && normalized.includes("rework");
}

export async function fetchLiveTabRows() {
  return fetchTrackerTabRows(LIVE_TAB_NAME, normalizeLiveTabRow);
}

export async function fetchAnalyticsLiveTabRows() {
  return fetchTrackerTabRows(LIVE_TAB_NAME, normalizeAnalyticsLiveTabRow);
}


function normalizeProductionTabRow(rawRow, rowIndex) {
  const row = Array.isArray(rawRow) ? rawRow : [];

  return {
    rowIndex,
    assetCode: normalizeText(row[PRODUCTION_TAB_COL_INDEX.assetCode]),
    status: normalizeText(row[PRODUCTION_TAB_COL_INDEX.status]),
    showName: normalizeText(row[PRODUCTION_TAB_COL_INDEX.showName]),
    beatName: normalizeText(row[PRODUCTION_TAB_COL_INDEX.beatName]),
    podLeadName: normalizePodLeadName(row[PRODUCTION_TAB_COL_INDEX.podLead]),
    writerName: normalizeText(row[PRODUCTION_TAB_COL_INDEX.writer]),
    productionType: normalizeText(row[PRODUCTION_TAB_COL_INDEX.productionType]),
    iteration: normalizeText(row[PRODUCTION_TAB_COL_INDEX.iteration]),
    reworkType: normalizeText(row[PRODUCTION_TAB_COL_INDEX.reworkType]),
    productionPickedDate: parseLiveDate(row[PRODUCTION_TAB_COL_INDEX.productionPickedDate]),
  };
}

function normalizeIdeationTabRow(rawRow, rowIndex) {
  const row = Array.isArray(rawRow) ? rawRow : [];
  const rawPodLeadName = normalizeText(row[IDEATION_TAB_COL_INDEX.podLead]);

  return {
    rowIndex,
    showName: normalizeText(row[IDEATION_TAB_COL_INDEX.showName]),
    beatName: normalizeText(row[IDEATION_TAB_COL_INDEX.beatName]),
    podLeadRaw: rawPodLeadName,
    podLeadName: normalizePodLeadName(rawPodLeadName),
    beatCode: normalizeText(row[IDEATION_TAB_COL_INDEX.beatCode]),
    assignedDate: normalizeText(row[IDEATION_TAB_COL_INDEX.assignedDate]),
    completedDate: normalizeText(row[IDEATION_TAB_COL_INDEX.completedDate]),
    beatsAssignedDate: normalizeText(row[IDEATION_TAB_COL_INDEX.beatsAssignedDate]),
    beatsStatus: normalizeText(row[IDEATION_TAB_COL_INDEX.beatsStatus]),
    status: normalizeText(row[IDEATION_TAB_COL_INDEX.status]),
  };
}

const CSV_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const CSV_FETCH_TIMEOUT_MS = 15000;
const csvCache = new Map();

function getNextFiveAmIstTs(nowTs = Date.now()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const now = new Date(nowTs + istOffsetMs);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const nextFiveAmIst = Date.UTC(year, month, day, 5, 0, 0, 0) - istOffsetMs;
  return nowTs < nextFiveAmIst ? nextFiveAmIst : nextFiveAmIst + 24 * 60 * 60 * 1000;
}

function getSheetCacheExpiryTs(sheetName, nowTs = Date.now()) {
  if (sheetName === LIVE_TAB_NAME) {
    return getNextFiveAmIstTs(nowTs);
  }
  return nowTs + CSV_CACHE_TTL_MS;
}

async function fetchCsvWithCache(csvUrl, sheetName) {
  const cached = csvCache.get(sheetName);
  const nowTs = Date.now();
  if (cached && Number(cached.expiresAt || 0) > nowTs) {
    return cached.text;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CSV_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(csvUrl, { cache: "no-store", signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      const lower = String(text || "").toLowerCase();
      if (lower.includes("unable to parse range") || lower.includes("does not exist")) {
        throw makeError(400, `The "${sheetName}" tab was not found in the configured tracker sheet.`);
      }
      throw makeError(400, `The ${sheetName} tab is not accessible. Check the sheet sharing settings.`);
    }

    if (!text || looksLikeHtml(text)) {
      throw makeError(400, `The ${sheetName} tab is not accessible. Check the sheet sharing settings.`);
    }

    csvCache.set(sheetName, {
      text,
      expiresAt: getSheetCacheExpiryTs(sheetName, nowTs),
    });
    return text;
  } catch (error) {
    // Stale fallback: if we have any previous text for this tab, use it instead of blanking the dashboard.
    if (cached?.text) {
      return cached.text;
    }
    if (error?.name === "AbortError") {
      throw makeError(504, `The ${sheetName} tab timed out while loading. Please retry.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTrackerTabRows(sheetName, mapRow) {
  const spreadsheetId = parseGoogleSheetId(LIVE_TAB_SHEET_URL);
  if (!spreadsheetId) {
    throw makeError(500, `${sheetName} tab sheet ID is invalid.`);
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  const text = await fetchCsvWithCache(csvUrl, sheetName);

  const parsedRows = parseCsv(text);
  const rows = (parsedRows || [])
    .slice(1)
    .map((row, index) => mapRow(row, index + 2))
    .filter((row) =>
      Object.entries(row).some(
        ([key, value]) => key !== "rowIndex" && value !== "" && value !== null && value !== undefined
      )
    );

  return {
    spreadsheetId,
    sheetName,
    rows,
  };
}

function findHeaderIndex(headers, candidates) {
  const normalizedHeaders = Array.isArray(headers) ? headers.map((header) => normalizeHeaderKey(header)) : [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const index = normalizedHeaders.indexOf(normalizeHeaderKey(candidate));
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

function getHeaderCell(row, headers, candidates) {
  const index = findHeaderIndex(headers, candidates);
  if (index === -1) {
    return "";
  }
  return Array.isArray(row) ? row[index] : "";
}

async function fetchTrackerTabRowsByHeaders(sheetName, mapRow) {
  const spreadsheetId = parseGoogleSheetId(LIVE_TAB_SHEET_URL);
  if (!spreadsheetId) {
    throw makeError(500, `${sheetName} tab sheet ID is invalid.`);
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const text = await fetchCsvWithCache(csvUrl, sheetName);
  const parsedRows = parseCsv(text) || [];
  const headers = Array.isArray(parsedRows[0]) ? parsedRows[0] : [];
  const rows = parsedRows
    .slice(1)
    .map((row, index) => mapRow(row, index + 2, headers))
    .filter((row) =>
      Object.entries(row).some(
        ([key, value]) => key !== "rowIndex" && value !== "" && value !== null && value !== undefined
      )
    );

  return {
    spreadsheetId,
    sheetName,
    headers,
    rows,
  };
}

export async function fetchProductionTabRows() {
  return fetchTrackerTabRows(PRODUCTION_TAB_NAME, normalizeProductionTabRow);
}

function normalizeEditorialTabRow(rawRow, rowIndex) {
  const row = Array.isArray(rawRow) ? rawRow : [];

  return {
    rowIndex,
    assetCode: normalizeText(row[EDITORIAL_TAB_COL_INDEX.assetCode]),
    submittedDate: parseLiveDate(row[EDITORIAL_TAB_COL_INDEX.submittedDate]),
    status: normalizeText(row[EDITORIAL_TAB_COL_INDEX.status]),
    showName: normalizeText(row[EDITORIAL_TAB_COL_INDEX.showName]),
    beatName: normalizeText(row[EDITORIAL_TAB_COL_INDEX.beatName]),
    podLeadName: normalizePodLeadName(row[EDITORIAL_TAB_COL_INDEX.podLead]),
    writerName: normalizeText(row[EDITORIAL_TAB_COL_INDEX.writer]),
    productionType: normalizeText(row[EDITORIAL_TAB_COL_INDEX.productionType]),
    iteration: normalizeText(row[EDITORIAL_TAB_COL_INDEX.iteration]),
    reworkType: normalizeText(row[EDITORIAL_TAB_COL_INDEX.reworkType]),
  };
}

export async function fetchEditorialTabRows() {
  return fetchTrackerTabRows(EDITORIAL_TAB_NAME, normalizeEditorialTabRow);
}

export async function fetchReadyForProductionTabRows() {
  return fetchTrackerTabRowsByHeaders(READY_FOR_PRODUCTION_TAB_NAME, (rawRow, rowIndex, headers) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const assetCodeIndex = findHeaderIndex(headers, ["AD Code", "Asset Code", "Code"]);
    const showNameIndex = findHeaderIndex(headers, ["Show"]);
    const beatNameIndex = findHeaderIndex(headers, ["Angle", "Beat name", "Beat"]);
    const podLeadIndex = findHeaderIndex(headers, ["POD", "POD Lead", "POD Name"]);
    const productionTypeIndex = findHeaderIndex(headers, ["Production Type", "Prod Type"]);
    const approvedForProdDateIndex = findHeaderIndex(headers, [
      "Date approved for prod",
      "Date Approved for Prod",
      "Approved for prod",
      "Approved for production",
      "Date approved for production",
    ]);

    return {
      rowIndex,
      assetCode: normalizeText(row[assetCodeIndex]),
      showName: normalizeText(row[showNameIndex]),
      beatName: normalizeText(row[beatNameIndex]),
      podLeadName: normalizePodLeadName(row[podLeadIndex]),
      productionType: normalizeText(row[productionTypeIndex]),
      approvedForProdDate: parseLiveDate(row[approvedForProdDateIndex]),
    };
  });
}

export async function fetchEditorialWorkflowRows() {
  return fetchTrackerTabRowsByHeaders(EDITORIAL_TAB_NAME, (rawRow, rowIndex, headers) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const rawPodLeadName = normalizeText(getHeaderCell(row, headers, ["POD", "POD Lead", "POD Name"]));
    return {
      rowIndex,
      assetCode: normalizeText(getHeaderCell(row, headers, ["AD Code", "Asset Code", "Code"])),
      scriptCode: normalizeText(getHeaderCell(row, headers, ["Script code (Please add from the editorial tab)", "Script code", "Script Code"])),
      podLeadRaw: rawPodLeadName,
      podLeadName: rawPodLeadName,
      writerName: normalizeText(getHeaderCell(row, headers, ["Writer", "Writer Name"])),
      showName: normalizeText(getHeaderCell(row, headers, ["Show"])),
      beatName: normalizeText(getHeaderCell(row, headers, ["Angle name", "Angle", "Beat name", "Beat"])),
      productionType: normalizeText(getHeaderCell(row, headers, ["Production Type", "Prod Type"])),
      dateAssigned: parseLiveDate(getHeaderCell(row, headers, ["Date assigned", "Assigned date", "Assign date"])),
      dateSubmittedByLead: parseLiveDate(
        getHeaderCell(row, headers, ["Date submitted by Lead", "Submitted by Lead", "Date Submitted by Lead"])
      ),
    };
  });
}

export async function fetchReadyForProductionWorkflowRows() {
  return fetchTrackerTabRowsByHeaders(READY_FOR_PRODUCTION_TAB_NAME, (rawRow, rowIndex, headers) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const rawPodLeadName = normalizeText(getHeaderCell(row, headers, ["POD", "POD Lead", "POD Name"]));
    return {
      rowIndex,
      assetCode: normalizeText(getHeaderCell(row, headers, ["AD Code", "Asset Code", "Code"])),
      scriptCode: normalizeText(getHeaderCell(row, headers, ["Script code (Please add from the editorial tab)", "Script code", "Script Code"])),
      podLeadRaw: rawPodLeadName,
      podLeadName: rawPodLeadName,
      writerName: normalizeText(getHeaderCell(row, headers, ["Writer", "Writer Name"])),
      showName: normalizeText(getHeaderCell(row, headers, ["Show"])),
      beatName: normalizeText(getHeaderCell(row, headers, ["Angle name", "Angle", "Beat name", "Beat"])),
      productionType: normalizeText(getHeaderCell(row, headers, ["Production Type", "Prod Type"])),
      dateSubmittedByLead: parseLiveDate(
        getHeaderCell(row, headers, ["Date submitted by Lead", "Submitted by Lead", "Date Submitted by Lead"])
      ),
      etaToStartProd: parseLiveDate(
        getHeaderCell(row, headers, ["ETA to start prod", "ETA to start production", "Date approved for prod"])
      ),
    };
  });
}

export async function fetchProductionWorkflowRows() {
  return fetchTrackerTabRowsByHeaders(PRODUCTION_TAB_NAME, (rawRow, rowIndex, headers) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const rawPodLeadName = normalizeText(getHeaderCell(row, headers, ["POD", "POD Lead", "POD Name"])) || normalizeText(row[PRODUCTION_TAB_COL_INDEX.podLead]);
    return {
      rowIndex,
      assetCode: normalizeText(getHeaderCell(row, headers, ["AD Code", "Asset Code", "Code"])) || normalizeText(row[PRODUCTION_TAB_COL_INDEX.assetCode]),
      scriptCode: normalizeText(getHeaderCell(row, headers, ["Script code (Please add from the editorial tab)", "Script code", "Script Code"])),
      podLeadRaw: rawPodLeadName,
      podLeadName: rawPodLeadName,
      writerName: normalizeText(getHeaderCell(row, headers, ["Writer", "Writer Name"])) || normalizeText(row[PRODUCTION_TAB_COL_INDEX.writer]),
      showName: normalizeText(getHeaderCell(row, headers, ["Show"])) || normalizeText(row[PRODUCTION_TAB_COL_INDEX.showName]),
      beatName:
        normalizeText(getHeaderCell(row, headers, ["Angle name", "Angle", "Beat name", "Beat"])) ||
        normalizeText(row[PRODUCTION_TAB_COL_INDEX.beatName]),
      productionType:
        normalizeText(getHeaderCell(row, headers, ["Production Type", "Prod Type"])) ||
        normalizeText(row[PRODUCTION_TAB_COL_INDEX.productionType]),
      etaToStartProd: parseLiveDate(
        getHeaderCell(row, headers, ["ETA to start prod", "ETA to start production", "Date assigned", "Production picked date"]) ||
          row[PRODUCTION_TAB_COL_INDEX.productionPickedDate]
      ),
      etaPromoCompletion: parseLiveDate(
        getHeaderCell(row, headers, ["ETA for promo completion", "ETA promo completion"])
      ),
      cl: normalizeText(getHeaderCell(row, headers, ["CL"])),
      cd: normalizeText(getHeaderCell(row, headers, ["CD"])),
      acd1WorkedOnWorldSettings: normalizeText(
        getHeaderCell(row, headers, ["ACD 1 Worked on world settings", "ACD 1", "ACD1 Worked on world settings"])
      ),
      acdMultipleSelections: normalizeText(
        getHeaderCell(row, headers, ["ACD Multiple selections allowed.", "ACD Multiple selections allowed", "ACD"])
      ),
      status: normalizeText(getHeaderCell(row, headers, ["Status"])) || normalizeText(row[PRODUCTION_TAB_COL_INDEX.status]),
    };
  });
}

export async function fetchLiveWorkflowRows() {
  return fetchTrackerTabRowsByHeaders(LIVE_TAB_NAME, (rawRow, rowIndex, headers) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const rawPodLeadName = normalizeText(getHeaderCell(row, headers, ["POD", "POD Lead", "POD Name"]));
    return {
      rowIndex,
      assetCode: normalizeText(getHeaderCell(row, headers, ["AD Code", "Asset Code", "Code"])),
      scriptCode: normalizeText(getHeaderCell(row, headers, ["Script code (Please add from the editorial tab)", "Script code", "Script Code"])),
      podLeadRaw: rawPodLeadName,
      podLeadName: rawPodLeadName,
      writerName: normalizeText(getHeaderCell(row, headers, ["Writer", "Writer Name"])),
      showName: normalizeText(getHeaderCell(row, headers, ["Show"])),
      beatName: normalizeText(getHeaderCell(row, headers, ["Angle name", "Angle", "Beat name", "Beat"])),
      productionType: normalizeText(getHeaderCell(row, headers, ["Production Type", "Prod Type"])),
      dateAssigned: parseLiveDate(getHeaderCell(row, headers, ["Date assigned", "Assigned date", "Assign date"])),
      dateSubmittedByLead: parseLiveDate(
        getHeaderCell(row, headers, ["Date submitted by Lead", "Submitted by Lead", "Date Submitted by Lead"])
      ),
      etaToStartProd: parseLiveDate(
        getHeaderCell(row, headers, ["ETA to start prod", "ETA to start production", "Date approved for prod"])
      ),
      etaPromoCompletion: parseLiveDate(
        getHeaderCell(row, headers, ["ETA for promo completion", "ETA promo completion"])
      ),
      cl: normalizeText(getHeaderCell(row, headers, ["CL"])),
      cd: normalizeText(getHeaderCell(row, headers, ["CD"])),
      acd1WorkedOnWorldSettings: normalizeText(
        getHeaderCell(row, headers, ["ACD 1 Worked on world settings", "ACD 1", "ACD1 Worked on world settings"])
      ),
      acdMultipleSelections: normalizeText(
        getHeaderCell(row, headers, ["ACD Multiple selections allowed.", "ACD Multiple selections allowed", "ACD"])
      ),
      finalUploadDate: parseLiveDate(getHeaderCell(row, headers, ["Final Upload Date", "Final upload date", "Upload Date"])),
    };
  });
}

export async function fetchEditorialScriptStatusRows() {
  return fetchTrackerTabRows(EDITORIAL_TAB_NAME, (rawRow, rowIndex) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    return {
      rowIndex,
      podLeadName: normalizePodLeadName(row[2]),   // Column C
      scriptStatus: normalizeText(row[13]),          // Column N
    };
  });
}

export async function fetchIdeationTabRows() {
  return fetchTrackerTabRows(IDEATION_TAB_NAME, normalizeIdeationTabRow);
}

export function buildOverviewMetricsFromLiveTab(rows, period = "current") {
  const weekSelection = getWeekSelection(normalizeWeekView(period));
  const releasedRows = uniqueReleasedRows(rows, weekSelection);
  const freshTakeRows = releasedRows.filter((row) => isFreshTakesLabel(row.reworkType));
  const anyRowHasReworkType = releasedRows.some((row) => normalizeKey(row?.reworkType));
  const status = getLiveDataStatus(rows, weekSelection);

  return {
    ...weekSelection,
    weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
    hasLiveData: status.hasLiveData,
    hasWeekData: status.hasWeekData,
    emptyStateMessage: status.hasLiveData
      ? `No released Live-tab rows were found for ${formatWeekRangeLabel(
          weekSelection.weekStart,
          weekSelection.weekEnd
        )}.`
      : "No usable Live-tab rows with a release date are available yet.",
    freshTakeCount: anyRowHasReworkType ? freshTakeRows.length : releasedRows.length,
    productionOutputCount: releasedRows.length,
  };
}

export function buildGoodToGoBeatsMetricsFromIdeationTab(rows, period = "current", options = {}) {
  const weekSelection = getWeekSelection(normalizeWeekView(period));
  const sourceWeekOffsetWeeks = Number(options?.sourceWeekOffsetWeeks || 0);
  const sourceWeekSelection =
    sourceWeekOffsetWeeks === 0
      ? weekSelection
      : {
          ...weekSelection,
          weekStart: shiftYmd(weekSelection.weekStart, sourceWeekOffsetWeeks * 7),
        };
  const targetStart = sourceWeekSelection.weekStart;
  const targetEnd = shiftYmd(sourceWeekSelection.weekStart, 6);
  const bucketLabel = getIdeationWeekBucket(sourceWeekSelection);
  let goodToGoBeatsCount = 0;
  let reviewPendingCount = 0;
  let iterateCount = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = normalizeKey(row?.status);
    if (!status) continue;

    // Match by date in column F, or by week label like "Mar week 3"
    const rawDate = row?.beatsAssignedDate || "";
    const parsedDate = parseLiveDate(rawDate);
    const weekLabel = normalizeIdeationWeekLabel(rawDate);
    const normalizedBucket = normalizeIdeationWeekLabel(bucketLabel);

    const dateInRange = parsedDate && parsedDate >= targetStart && parsedDate <= targetEnd;
    const weekLabelMatch = weekLabel && weekLabel === normalizedBucket;

    if (!dateInRange && !weekLabelMatch) {
      continue;
    }

    if (status === "gtg" || status === "gtg - minor changes" || status === "approved") {
      goodToGoBeatsCount += 1;
    } else if (status.includes("review") && status.includes("pend")) {
      reviewPendingCount += 1;
    } else if (status === "iterate" || status.includes("iteration")) {
      iterateCount += 1;
    }
  }

  return {
    ...weekSelection,
    ideationWeekBucket: bucketLabel,
    goodToGoBeatsCount,
    reviewPendingCount,
    iterateCount,
    goodToGoTarget: GOOD_TO_GO_BEATS_TARGET,
  };
}

export function buildTatSummaryFromRows(rows) {
  const tatRows = [];
  let skippedMissingTatDates = 0;
  let skippedInvalidTatRows = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isTatEligibleProductionType(row?.productionType)) {
      continue;
    }

    const releasedDate = getReleasedDate(row);
    if (!row?.tatStartDate || !releasedDate) {
      skippedMissingTatDates += 1;
      continue;
    }

    const tatDays = daysBetween(row.tatStartDate, releasedDate);
    if (!Number.isFinite(tatDays) || tatDays < 0) {
      skippedInvalidTatRows += 1;
      continue;
    }

    tatRows.push({
      rowIndex: row.rowIndex,
      assetCode: row.assetCode || row.baseAssetCode || `Row ${row.rowIndex}`,
      cdName: row.cdName || "Unknown",
      writerName: row.writerName ? toDisplayName(row.writerName) : "Unknown writer",
      productionType: row.productionType || "Unknown",
      tatStartDate: row.tatStartDate,
      liveDate: releasedDate,
      tatDays,
    });
  }

  tatRows.sort(
    (a, b) =>
      b.tatDays - a.tatDays ||
      String(b.liveDate || "").localeCompare(String(a.liveDate || "")) ||
      String(a.assetCode).localeCompare(String(b.assetCode))
  );

  const tatValues = tatRows.map((row) => row.tatDays);
  return {
    averageTatDays:
      tatValues.length > 0 ? round2(tatValues.reduce((sum, value) => sum + value, 0) / tatValues.length) : null,
    medianTatDays: tatValues.length > 0 ? round2(median(tatValues)) : null,
    eligibleAssetCount: tatRows.length,
    skippedMissingTatDates,
    skippedInvalidTatRows,
    targetTatDays: 1,
    tatRows,
  };
}

export function buildShowWiseBreakdownFromRows(rows) {
  const breakdownMap = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const showKey = normalizeShowMatchKey(row?.showName) || "__unknown__";
    if (!breakdownMap.has(showKey)) {
      breakdownMap.set(showKey, {
        showName: normalizeText(row?.showName) || "Unknown show",
        count: 0,
      });
    }

    breakdownMap.get(showKey).count += 1;
  }

  return Array.from(breakdownMap.values()).sort(
    (a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.showName || "").localeCompare(String(b.showName || ""))
  );
}

export function buildProductionMetricsFromLiveTab(rows, period = "current") {
  const weekSelection = getWeekSelection(normalizeWeekView(period));
  const releasedRows = uniqueReleasedRows(rows, weekSelection);
  const status = getLiveDataStatus(rows, weekSelection);
  const tatSummary = buildTatSummaryFromRows(releasedRows);

  return {
    ...weekSelection,
    weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
    hasLiveData: status.hasLiveData,
    hasWeekData: status.hasWeekData,
    emptyStateMessage: status.hasLiveData
      ? `No released Live-tab rows were found for ${formatWeekRangeLabel(
          weekSelection.weekStart,
          weekSelection.weekEnd
        )}.`
      : "No usable Live-tab rows with a release date are available yet.",
    productionTeamOutput: {
      liveAssetCount: releasedRows.length,
    },
    tatSummary: {
      averageTatDays: tatSummary.averageTatDays,
      medianTatDays: tatSummary.medianTatDays,
      eligibleAssetCount: tatSummary.eligibleAssetCount,
      skippedMissingTatDates: tatSummary.skippedMissingTatDates,
      skippedInvalidTatRows: tatSummary.skippedInvalidTatRows,
      targetTatDays: tatSummary.targetTatDays,
    },
    tatRows: tatSummary.tatRows,
  };
}

export function buildProductionMetricsFromLiveTabRange(rows, startDate, endDate) {
  const rangeSelection = buildDateRangeSelection({ startDate, endDate });
  const releasedRows = uniqueReleasedRows(rows, rangeSelection);
  const status = getLiveDataStatus(rows, rangeSelection);
  const tatSummary = buildTatSummaryFromRows(releasedRows);

  return {
    ...rangeSelection,
    weekLabel: rangeSelection.rangeLabel,
    hasLiveData: status.hasLiveData,
    hasWeekData: status.hasWeekData,
    emptyStateMessage: status.hasLiveData
      ? `No released Live-tab rows were found for ${rangeSelection.rangeLabel}.`
      : "No usable Live-tab rows with a release date are available yet.",
    productionTeamOutput: {
      liveAssetCount: releasedRows.length,
    },
    tatSummary: {
      averageTatDays: tatSummary.averageTatDays,
      medianTatDays: tatSummary.medianTatDays,
      eligibleAssetCount: tatSummary.eligibleAssetCount,
      skippedMissingTatDates: tatSummary.skippedMissingTatDates,
      skippedInvalidTatRows: tatSummary.skippedInvalidTatRows,
      targetTatDays: tatSummary.targetTatDays,
    },
    tatRows: tatSummary.tatRows,
  };
}

function buildWriterResolver(liveRows, plannerWriterNames = []) {
  const exactMap = new Map();
  const prefixCandidates = [];
  const firstTokenMap = new Map();

  function register(value) {
    const displayName = toDisplayName(value);
    const key = normalizeKey(displayName);
    if (!displayName || !key || exactMap.has(key)) {
      return;
    }

    exactMap.set(key, displayName);
    prefixCandidates.push({ key, displayName });

    const firstToken = key.split(" ")[0];
    if (!firstToken) {
      return;
    }

    if (!firstTokenMap.has(firstToken)) {
      firstTokenMap.set(firstToken, []);
    }

    firstTokenMap.get(firstToken).push(displayName);
  }

  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    if (normalizeText(row.writerName).includes(" ")) {
      register(row.writerName);
    }
  }

  for (const value of Array.isArray(plannerWriterNames) ? plannerWriterNames : []) {
    register(value);
  }

  return function resolveWriterName(rawValue) {
    const cleaned = normalizeText(rawValue);
    if (!cleaned) {
      return "Unknown writer";
    }

    const displayName = toDisplayName(cleaned);
    const key = normalizeKey(displayName);

    if (exactMap.has(key)) {
      return exactMap.get(key);
    }

    const prefixMatches = prefixCandidates.filter((candidate) => candidate.key.startsWith(key));
    if (prefixMatches.length === 1) {
      return prefixMatches[0].displayName;
    }

    const firstToken = key.split(" ")[0];
    const firstTokenMatches = firstTokenMap.get(firstToken) || [];
    if (firstTokenMatches.length === 1) {
      return firstTokenMatches[0];
    }

    return displayName;
  };
}

export function buildWritingMetricsFromLiveTab(rows, period = "current", options = {}) {
  const weekSelection = getWeekSelection(normalizeWeekView(period));
  const releasedRows = uniqueReleasedRows(rows, weekSelection, (row) => isFreshTakesLabel(row.reworkType));
  const status = getLiveDataStatus(rows, weekSelection);
  const targetFloor = Number(options.targetFloor || TARGET_FLOOR);
  const writerTarget = Number(options.writerTarget || WRITER_TARGET_PER_WEEK);
  const podOrder = Array.isArray(options.podOrder) && options.podOrder.length > 0 ? options.podOrder : POD_LEAD_ORDER;
  const podOrderIndex = new Map(podOrder.map((name, index) => [name, index]));
  const podWriterCounts = options.podWriterCounts && typeof options.podWriterCounts === "object" ? options.podWriterCounts : {};
  const podTargetCounts = options.podTargetCounts && typeof options.podTargetCounts === "object" ? options.podTargetCounts : {};
  const resolveWriterName = buildWriterResolver(releasedRows, options.plannerWriterNames || []);
  const detailMap = new Map();
  const podMap = new Map();
  let skippedMissingPodLeadCount = 0;

  for (const row of releasedRows) {
    if (!row.podLeadName) {
      skippedMissingPodLeadCount += 1;
      continue;
    }

    const podLeadName = normalizePodLeadName(row.podLeadName);
    const writerName = resolveWriterName(row.writerName);
    const detailKey = `${normalizeKey(podLeadName)}|${normalizeKey(writerName)}`;

    if (!detailMap.has(detailKey)) {
      detailMap.set(detailKey, {
        podLeadName,
        writerName: writerName || "Unknown writer",
        output: 0,
      });
    }

    detailMap.get(detailKey).output += 1;

    if (!podMap.has(podLeadName)) {
      podMap.set(podLeadName, {
        podLeadName,
        output: 0,
        writers: new Set(),
      });
    }

    const podTarget = podMap.get(podLeadName);
    podTarget.output += 1;
    podTarget.writers.add(normalizeKey(writerName));
  }

  const detailRows = Array.from(detailMap.values())
    .map((row) => ({
      ...row,
      targetCount: writerTarget,
      isBelowTarget: row.output <= 1,
    }))
    .sort(
      (a, b) =>
        (podOrderIndex.has(a.podLeadName) ? podOrderIndex.get(a.podLeadName) : Number.MAX_SAFE_INTEGER) -
          (podOrderIndex.has(b.podLeadName) ? podOrderIndex.get(b.podLeadName) : Number.MAX_SAFE_INTEGER) ||
        b.output - a.output ||
        a.writerName.localeCompare(b.writerName)
    );

  for (const podLeadName of podOrder) {
    if (!podMap.has(podLeadName)) {
      podMap.set(podLeadName, {
        podLeadName,
        output: 0,
        writers: new Set(),
      });
    }
  }

  const podRows = Array.from(podMap.values())
    .map((row) => {
      const configuredWriterCount = Number(podWriterCounts[row.podLeadName]);
      const writerCount = Number.isFinite(configuredWriterCount) ? configuredWriterCount : row.writers.size;
      const configuredTargetCount = Number(podTargetCounts[row.podLeadName]);
      const targetCount = Number.isFinite(configuredTargetCount) ? round2(configuredTargetCount) : round2(writerCount * writerTarget);
      return {
        podLeadName: row.podLeadName,
        output: row.output,
        writerCount,
        targetCount,
        isBelowTarget: row.output < targetCount,
      };
    })
    .sort((a, b) => {
      const indexDiff =
        (podOrderIndex.has(a.podLeadName) ? podOrderIndex.get(a.podLeadName) : Number.MAX_SAFE_INTEGER) -
        (podOrderIndex.has(b.podLeadName) ? podOrderIndex.get(b.podLeadName) : Number.MAX_SAFE_INTEGER);
      if (indexDiff !== 0) {
        return indexDiff;
      }

      return b.output - a.output || a.podLeadName.localeCompare(b.podLeadName);
    });

  return {
    ...weekSelection,
    weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
    hasLiveData: status.hasLiveData,
    hasWeekData: status.hasWeekData,
    emptyStateMessage: status.hasLiveData
      ? `No Fresh takes rows were released in ${formatWeekRangeLabel(
          weekSelection.weekStart,
          weekSelection.weekEnd
        )}.`
      : "No usable Live-tab rows with a release date are available yet.",
    releasedCount: releasedRows.length,
    targetFloor,
    onTrack: releasedRows.length >= targetFloor,
    shortfall: Math.max(0, targetFloor - releasedRows.length),
    surplus: Math.max(0, releasedRows.length - targetFloor),
    skippedMissingPodLeadCount,
    writerTarget,
    podRows,
    detailRows,
  };
}

export function buildPodInProductionCountsFromProductionTab(rows, options = {}) {
  const podOrder = Array.isArray(options.podOrder) && options.podOrder.length > 0 ? options.podOrder : POD_LEAD_ORDER;
  const counts = Object.fromEntries(podOrder.map((podLeadName) => [podLeadName, 0]));
  const seenAssetKeys = new Set();
  let skippedMissingPodLeadCount = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isQ1ManualThumbnailProductionType(row.productionType)) {
      continue;
    }

    if (!isScriptIteration(row.iteration)) {
      continue;
    }

    if (!isFreshTakesLabel(row.reworkType)) {
      continue;
    }

    if (isCompletedProductionStatus(row.status)) {
      continue;
    }

    const assetKey = row.assetCode || `row-${row.rowIndex}`;
    if (seenAssetKeys.has(assetKey)) {
      continue;
    }
    seenAssetKeys.add(assetKey);

    const podLeadName = normalizePodLeadName(row.podLeadName);
    if (!podLeadName) {
      skippedMissingPodLeadCount += 1;
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(counts, podLeadName)) {
      continue;
    }

    counts[podLeadName] += 1;
  }

  return {
    counts,
    skippedMissingPodLeadCount,
  };
}

export function buildLifetimeScriptsPerPod(rows, sinceDate) {
  const podAssets = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const liveDate = String(row?.liveDate || "");
    if (!liveDate || liveDate < sinceDate) continue;

    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    const assetCode = String(row?.assetCode || "").trim();
    if (!assetCode) continue;

    if (!podAssets.has(podName)) {
      podAssets.set(podName, new Set());
    }
    podAssets.get(podName).add(assetCode);
  }

  const result = new Map();
  for (const [podName, assetSet] of podAssets) {
    result.set(podName, assetSet.size);
  }
  return result;
}

export function buildLwEditorialOutputPerPod(editorialRows, productionRows, lastWeekSelection) {
  const weekStart = String(lastWeekSelection?.weekStart || "");
  const weekEnd = String(lastWeekSelection?.weekEnd || "");
  if (!weekStart || !weekEnd) return new Map();

  const podAssets = new Map();

  for (const row of Array.isArray(editorialRows) ? editorialRows : []) {
    const status = String(row?.status || "").trim().toLowerCase();
    if (status !== "approved for production by cl") continue;

    const submittedDate = String(row?.submittedDate || "");
    if (!submittedDate || submittedDate < weekStart || submittedDate > weekEnd) continue;

    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    const assetCode = String(row?.assetCode || "").trim();
    if (!assetCode) continue;

    if (!podAssets.has(podName)) {
      podAssets.set(podName, new Set());
    }
    podAssets.get(podName).add(assetCode);
  }

  for (const row of Array.isArray(productionRows) ? productionRows : []) {
    const pickedDate = String(row?.productionPickedDate || "");
    if (!pickedDate || pickedDate < weekStart || pickedDate > weekEnd) continue;

    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    const assetCode = String(row?.assetCode || "").trim();
    if (!assetCode) continue;

    if (!podAssets.has(podName)) {
      podAssets.set(podName, new Set());
    }
    podAssets.get(podName).add(assetCode);
  }

  const result = new Map();
  for (const [podName, assetSet] of podAssets) {
    result.set(podName, assetSet.size);
  }
  return result;
}

const DASHBOARD_OVERRIDES_PATH = "config/dashboard-overrides.json";

export async function fetchDashboardOverrides() {
  const stored = await readJsonObject(DASHBOARD_OVERRIDES_PATH);
  return stored && typeof stored === "object" ? stored : {};
}

export async function writeDashboardOverride(adCode, classification) {
  const current = await fetchDashboardOverrides();
  const next = {
    ...current,
    [String(adCode || "").trim()]: String(classification || "").trim().toLowerCase(),
  };

  await writeJsonObject(DASHBOARD_OVERRIDES_PATH, next);
  return { ok: true, overrides: next };
}
