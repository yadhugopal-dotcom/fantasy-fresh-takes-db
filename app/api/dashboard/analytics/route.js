import { NextResponse } from "next/server";
import { hasEditSession } from "../../../../lib/auth.js";
import { fetchAnalyticsLiveTabRows, isAnalyticsEligibleProductionType } from "../../../../lib/live-tab.js";
import { readJsonObject, writeJsonObject } from "../../../../lib/storage.js";
import {
  buildDateRangeSelection,
  formatWeekRangeLabel,
  getWeekSelection,
  getWeekWindowFromReference,
  parseYmdToUtcDate,
  shiftYmd,
} from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const ACTIONED_STATE_PATH = "analytics/actioned-state.json";
const ANALYTICS_METRIC_COLUMNS = [
  { key: "cpi", label: "CPI", format: "currency", hiddenByDefault: false },
  { key: "amountSpent", label: "Amount spent", format: "currency", hiddenByDefault: false },
  { key: "cpm", label: "CPM", format: "currency", hiddenByDefault: false },
  { key: "threeSecPlays", label: "3 sec plays", format: "percent", hiddenByDefault: false },
  { key: "thruplaysTo3s", label: "Thruplays / 3s plays", format: "percent", hiddenByDefault: false },
  { key: "q1Completion", label: "Q1 completion", format: "percent", hiddenByDefault: false },
  { key: "q2Completion", label: "Q2 completion", format: "percent", hiddenByDefault: true },
  { key: "q3Completion", label: "Q3 completion", format: "percent", hiddenByDefault: true },
  { key: "q4Completion", label: "Q4 completion", format: "percent", hiddenByDefault: true },
  { key: "netCompletion", label: "Net completion", format: "percent", hiddenByDefault: false },
  { key: "absoluteCompletion", label: "Absolute completion", format: "percent", hiddenByDefault: false },
  { key: "ctr", label: "CTR", format: "percent", hiddenByDefault: false },
  { key: "cti", label: "CTI", format: "percent", hiddenByDefault: false },
];

const BASELINE_THRESHOLD_CHECKS = {
  threeSecPlays: (value) => value >= 35,
  thruplaysTo3s: (value) => value >= 40,
  q1Completion: (value) => value > 10,
  cpi: (value) => value < 10,
  absoluteCompletion: (value) => value > 1.5,
  cti: (value) => value >= 12,
  amountSpent: (value) => value > 100,
};

const STRONG_THRESHOLD_CHECKS = {
  threeSecPlays: (value) => value >= 35,
  thruplaysTo3s: (value) => value >= 40,
  q1Completion: (value) => value > 10,
  cpi: (value) => value < 8,
  absoluteCompletion: (value) => value > 2.5,
  cti: (value) => value >= 12,
  amountSpent: (value) => value > 100,
};

const REWORK_COMPLETION_CHECKS = {
  q1Completion: (value) => value > 10,
  q2Completion: (value) => value >= 60,
  q3Completion: (value) => value >= 80,
  q4Completion: (value) => value >= 80,
  netCompletion: (value) => value >= 1.8,
  absoluteCompletion: (value) => value > 1.5,
};

const LEGEND_ITEMS = [
  { label: "Gen AI", tone: "gen-ai" },
  { label: "P1 Rework", tone: "rework-p1" },
  { label: "P2 Rework", tone: "rework-p2" },
  { label: "Testing / Drop", tone: "testing-drop" },
  { label: "Metric not meeting", tone: "metric-miss" },
];

const NEXT_STEP_SORT_ORDER = new Map([
  ["Gen AI", 0],
  ["P1 Rework", 1],
  ["P2 Rework", 2],
  ["Testing / Drop", 3],
]);

function normalizeWeekKey(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeAssetCodeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeActionedState(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const safeWeeks = safePayload.weeks && typeof safePayload.weeks === "object" ? safePayload.weeks : {};
  const normalizedWeeks = {};

  for (const [rawWeekKey, rawEntries] of Object.entries(safeWeeks)) {
    const weekKey = normalizeWeekKey(rawWeekKey);
    if (!weekKey || !rawEntries || typeof rawEntries !== "object") {
      continue;
    }

    const normalizedEntries = {};
    for (const [rawAssetCodeKey, rawEntry] of Object.entries(rawEntries)) {
      const assetCodeKey = normalizeAssetCodeKey(rawAssetCodeKey);
      if (!assetCodeKey) {
        continue;
      }

      const entryIsObject = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry);
      const actioned = entryIsObject ? Boolean(rawEntry.actioned) : Boolean(rawEntry);
      if (!actioned) {
        continue;
      }

      normalizedEntries[assetCodeKey] = {
        actioned: true,
        assetCode:
          entryIsObject && typeof rawEntry.assetCode === "string" && rawEntry.assetCode.trim()
            ? rawEntry.assetCode.trim()
            : String(rawAssetCodeKey || "").trim(),
        updatedAt:
          entryIsObject && typeof rawEntry.updatedAt === "string" && rawEntry.updatedAt.trim()
            ? rawEntry.updatedAt.trim()
            : null,
      };
    }

    if (Object.keys(normalizedEntries).length > 0) {
      normalizedWeeks[weekKey] = normalizedEntries;
    }
  }

  // Normalize global assets map
  const safeAssets = safePayload.assets && typeof safePayload.assets === "object" ? safePayload.assets : {};
  const normalizedAssets = {};
  for (const [rawKey, rawEntry] of Object.entries(safeAssets)) {
    const assetCodeKey = normalizeAssetCodeKey(rawKey);
    if (!assetCodeKey) continue;
    const entryIsObject = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry);
    const actioned = entryIsObject ? Boolean(rawEntry.actioned) : Boolean(rawEntry);
    if (!actioned) continue;
    normalizedAssets[assetCodeKey] = {
      actioned: true,
      assetCode:
        entryIsObject && typeof rawEntry.assetCode === "string" && rawEntry.assetCode.trim()
          ? rawEntry.assetCode.trim()
          : String(rawKey || "").trim(),
      updatedAt:
        entryIsObject && typeof rawEntry.updatedAt === "string" && rawEntry.updatedAt.trim()
          ? rawEntry.updatedAt.trim()
          : null,
    };
  }

  return {
    updatedAt:
      typeof safePayload.updatedAt === "string" && safePayload.updatedAt.trim() ? safePayload.updatedAt.trim() : null,
    weeks: normalizedWeeks,
    assets: normalizedAssets,
  };
}

async function readActionedState() {
  return normalizeActionedState(await readJsonObject(ACTIONED_STATE_PATH));
}

function getActionedValue(actionedState, weekKey, assetCode) {
  const assetCodeKey = normalizeAssetCodeKey(assetCode);
  if (!assetCodeKey) {
    return false;
  }

  // Check global (week-independent) actioned state first
  if (actionedState?.assets?.[assetCodeKey]?.actioned) {
    return true;
  }

  // Fall back to legacy per-week state for backwards compatibility
  const safeWeekKey = normalizeWeekKey(weekKey);
  if (safeWeekKey && actionedState?.weeks?.[safeWeekKey]?.[assetCodeKey]?.actioned) {
    return true;
  }

  return false;
}

function buildUpdatedActionedState(actionedState, weekKey, assetCode, actioned) {
  const safeAssetCode = String(assetCode || "").trim();
  const assetCodeKey = normalizeAssetCodeKey(safeAssetCode);

  // Preserve existing state
  const nextWeeks = {
    ...(actionedState?.weeks && typeof actionedState.weeks === "object" ? actionedState.weeks : {}),
  };
  const nextAssets = {
    ...(actionedState?.assets && typeof actionedState.assets === "object" ? actionedState.assets : {}),
  };

  if (!assetCodeKey) {
    return { ...normalizeActionedState({ weeks: nextWeeks }), assets: nextAssets };
  }

  // Write to global assets map (week-independent)
  if (actioned) {
    nextAssets[assetCodeKey] = {
      actioned: true,
      assetCode: safeAssetCode,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextAssets[assetCodeKey];
  }

  return {
    ...normalizeActionedState({ weeks: nextWeeks }),
    updatedAt: new Date().toISOString(),
    assets: nextAssets,
  };
}

function formatMonthWeekLabel(weekStart) {
  const date = parseYmdToUtcDate(weekStart);
  const monthLabel = date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const weekNumber = Math.floor((date.getUTCDate() - 1) / 7) + 1;
  return `${monthLabel} Week ${weekNumber}`;
}

function buildAnalyticsWeekOption(weekKey, count = 0) {
  const weekEnd = shiftYmd(weekKey, 6);
  return {
    id: weekKey,
    weekKey,
    label: `${formatMonthWeekLabel(weekKey)} · ${formatWeekRangeLabel(weekKey, weekEnd)}`,
    shortLabel: formatMonthWeekLabel(weekKey),
    weekLabel: formatWeekRangeLabel(weekKey, weekEnd),
    count: Number(count || 0),
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasReadableCpi(value) {
  return Number.isFinite(toFiniteNumber(value));
}

function passesThreshold(value, check) {
  if (!Number.isFinite(value)) {
    return false;
  }

  return Boolean(check(value));
}

function buildMetricCell(value, benchmarkCheck, strongCheck = null) {
  const numericValue = toFiniteNumber(value);
  return {
    value: numericValue,
    meetsBenchmark: passesThreshold(numericValue, benchmarkCheck),
    meetsStrongBenchmark: strongCheck ? passesThreshold(numericValue, strongCheck) : null,
  };
}

function countBenchmarkMisses(metricMap, keys) {
  return keys.reduce((sum, key) => sum + (metricMap?.[key]?.meetsBenchmark ? 0 : 1), 0);
}

function isBetterAttemptRow(nextRow, currentRow) {
  const nextScore = Number(nextRow?.metricsCompletenessScore || 0);
  const currentScore = Number(currentRow?.metricsCompletenessScore || 0);
  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  const nextSpend = Number(nextRow?.amountSpentUsd || 0);
  const currentSpend = Number(currentRow?.amountSpentUsd || 0);
  if (Number.isFinite(nextSpend) && Number.isFinite(currentSpend) && nextSpend !== currentSpend) {
    return nextSpend > currentSpend;
  }

  return Number(nextRow?.rowIndex || 0) > Number(currentRow?.rowIndex || 0);
}

function buildAttemptKey(row, weekKey) {
  const assetCode = String(row?.assetCode || "").trim().toLowerCase();
  return `${weekKey}|${assetCode}`;
}

function getNextStepSortIndex(nextStep) {
  const safeNextStep = String(nextStep || "").trim();
  return NEXT_STEP_SORT_ORDER.has(safeNextStep)
    ? NEXT_STEP_SORT_ORDER.get(safeNextStep)
    : Number.MAX_SAFE_INTEGER;
}

function getRowSortCpi(row) {
  const value = toFiniteNumber(row?.metrics?.cpi?.value);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}


function buildWeekOptions(rows, ...forcedWeekKeys) {
  const counts = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const weekKey = normalizeWeekKey(row?.analyticsWeekKey);
    if (!weekKey) {
      continue;
    }

    counts.set(weekKey, (counts.get(weekKey) || 0) + 1);
  }

  for (const weekKey of forcedWeekKeys) {
    if (weekKey && !counts.has(weekKey)) {
      counts.set(weekKey, 0);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .map(([weekKey, count]) => buildAnalyticsWeekOption(weekKey, count));
}

function buildDecoratedAnalyticsRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        row?.liveDate &&
        isAnalyticsEligibleProductionType(row?.productionType) &&
        String(row?.assetCode || "").trim() &&
        String(row?.showName || "").trim() &&
        String(row?.beatName || "").trim()
    )
    .map((row) => {
      const window = getWeekWindowFromReference(row.liveDate);
      return {
        ...row,
        analyticsWeekKey: window.weekStart,
      };
    });
}

function buildDedupedAttemptRows(rows, selectedWeekKeys = []) {
  const keySet = new Set(Array.isArray(selectedWeekKeys) ? selectedWeekKeys : [selectedWeekKeys].filter(Boolean));
  const dedupedRows = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (keySet.size > 0 && !keySet.has(row?.analyticsWeekKey)) {
      continue;
    }

    const rowKey = buildAttemptKey(row, row?.analyticsWeekKey || "");
    if (!dedupedRows.has(rowKey) || isBetterAttemptRow(row, dedupedRows.get(rowKey))) {
      dedupedRows.set(rowKey, row);
    }
  }

  return Array.from(dedupedRows.values());
}

function classifyNextStep(metricMap) {
  const baselineKeys = Object.keys(BASELINE_THRESHOLD_CHECKS);
  const baselineMissCount = countBenchmarkMisses(metricMap, baselineKeys);
  const amountSpent = toFiniteNumber(metricMap?.amountSpent?.value);
  const cpiValue = toFiniteNumber(metricMap?.cpi?.value);
  const ctiValue = toFiniteNumber(metricMap?.cti?.value);

  // Prerequisite: amount spent must be >= $100
  if (!Number.isFinite(amountSpent) || amountSpent < 100) {
    return {
      nextStep: "Testing / Drop",
      rowTone: "testing-drop",
      benchmarkMissCount: baselineMissCount,
    };
  }

  // Gen AI: CPI < $10 AND <= 2 baseline benchmark misses
  const cpiPass = Number.isFinite(cpiValue) && cpiValue < 10;
  if (cpiPass && baselineMissCount <= 2) {
    return {
      nextStep: "Gen AI",
      rowTone: "gen-ai",
      benchmarkMissCount: baselineMissCount,
    };
  }

  // P1 Rework: CTI >= 12%
  if (Number.isFinite(ctiValue) && ctiValue >= 12) {
    return {
      nextStep: "P1 Rework",
      rowTone: "rework-p1",
      benchmarkMissCount: baselineMissCount,
    };
  }

  // P2 Rework: CTI < 12%
  return {
    nextStep: "P2 Rework",
    rowTone: "rework-p2",
    benchmarkMissCount: baselineMissCount,
  };
}

function buildAnalyticsRow(row, actioned = false) {
  const metrics = {
    cpi: buildMetricCell(row?.cpiUsd, BASELINE_THRESHOLD_CHECKS.cpi, STRONG_THRESHOLD_CHECKS.cpi),
    amountSpent: buildMetricCell(
      row?.amountSpentUsd,
      BASELINE_THRESHOLD_CHECKS.amountSpent,
      STRONG_THRESHOLD_CHECKS.amountSpent
    ),
    cpm: { value: toFiniteNumber(row?.cpmUsd), meetsBenchmark: null, meetsStrongBenchmark: null },
    threeSecPlays: buildMetricCell(
      row?.threeSecPlayPct,
      BASELINE_THRESHOLD_CHECKS.threeSecPlays,
      STRONG_THRESHOLD_CHECKS.threeSecPlays
    ),
    thruplaysTo3s: buildMetricCell(
      row?.thruPlayTo3sRatio,
      BASELINE_THRESHOLD_CHECKS.thruplaysTo3s,
      STRONG_THRESHOLD_CHECKS.thruplaysTo3s
    ),
    q1Completion: buildMetricCell(
      row?.video0To25Pct,
      BASELINE_THRESHOLD_CHECKS.q1Completion,
      STRONG_THRESHOLD_CHECKS.q1Completion
    ),
    q2Completion: buildMetricCell(row?.video25To50Pct, REWORK_COMPLETION_CHECKS.q2Completion),
    q3Completion: buildMetricCell(row?.video50To75Pct, REWORK_COMPLETION_CHECKS.q3Completion),
    q4Completion: buildMetricCell(row?.video75To95Pct, REWORK_COMPLETION_CHECKS.q4Completion),
    netCompletion: buildMetricCell(row?.video0To95Pct, REWORK_COMPLETION_CHECKS.netCompletion),
    absoluteCompletion: buildMetricCell(
      row?.absoluteCompletionPct,
      BASELINE_THRESHOLD_CHECKS.absoluteCompletion,
      STRONG_THRESHOLD_CHECKS.absoluteCompletion
    ),
    ctr: { value: toFiniteNumber(row?.ctrPct), meetsBenchmark: null, meetsStrongBenchmark: null },
    cti: buildMetricCell(row?.clickToInstall, BASELINE_THRESHOLD_CHECKS.cti, STRONG_THRESHOLD_CHECKS.cti),
  };

  const classification = classifyNextStep(metrics);

  return {
    rowIndex: Number(row?.rowIndex || 0),
    analyticsWeekKey: String(row?.analyticsWeekKey || "").trim(),
    showName: String(row?.showName || "").trim() || "Unknown show",
    beatName: String(row?.beatName || "").trim() || "Unknown beat",
    assetCode: String(row?.assetCode || "").trim(),
    assetLink: String(row?.assetLink || "").trim(),
    actioned: Boolean(actioned),
    nextStep: classification.nextStep,
    rowTone: classification.rowTone,
    benchmarkMissCount: classification.benchmarkMissCount,
    metrics,
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const requestedWeekKey = normalizeWeekKey(url.searchParams.get("week"));
  const requestedWeeks = url.searchParams.get("weeks");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const currentWeekKey = getWeekSelection("current").weekKey;
  const lastWeekKey = getWeekSelection("last").weekKey;

  try {
    const [{ rows }, actionedState] = await Promise.all([fetchAnalyticsLiveTabRows(), readActionedState()]);
    const eligibleRows = buildDecoratedAnalyticsRows(rows);
    const analyticsRows = eligibleRows.filter((row) => hasReadableCpi(row?.cpiUsd));

    // Support multi-week: "weeks=2" means current + last week
    let selectedWeekKeys;
    let selectedWeekKey;
    let selectedWeekEnd;
    let selectedLabel;
    let filteredRows = analyticsRows;

    if (startDate || endDate) {
      const rangeSelection = buildDateRangeSelection({ startDate, endDate, period: "current" });
      filteredRows = analyticsRows.filter((row) => {
        const liveDate = String(row?.liveDate || "").trim();
        return liveDate && liveDate >= rangeSelection.startDate && liveDate <= rangeSelection.endDate;
      });
      selectedWeekKeys = [];
      selectedWeekKey = `${rangeSelection.startDate}:${rangeSelection.endDate}`;
      selectedWeekEnd = rangeSelection.endDate;
      selectedLabel = "Selected date range";
    } else if (requestedWeeks) {
      const weekCount = Math.min(Math.max(Number(requestedWeeks) || 2, 1), 8);
      selectedWeekKeys = [];
      let wk = currentWeekKey;
      for (let i = 0; i < weekCount; i++) {
        selectedWeekKeys.push(wk);
        wk = shiftYmd(wk, -7);
      }
      selectedWeekKey = selectedWeekKeys.join(",");
      selectedWeekEnd = shiftYmd(currentWeekKey, 6);
      const oldestWeek = selectedWeekKeys[selectedWeekKeys.length - 1];
      selectedLabel = `Last ${weekCount} weeks`;
    } else {
      selectedWeekKey = requestedWeekKey || lastWeekKey;
      selectedWeekKeys = [selectedWeekKey];
      selectedWeekEnd = shiftYmd(selectedWeekKey, 6);
      selectedLabel = buildAnalyticsWeekOption(selectedWeekKey).shortLabel;
    }

    const weekOptions = buildWeekOptions(analyticsRows, lastWeekKey, selectedWeekKeys[0]);

    // Add multi-week options at the top
    const multiWeekOptions = [
      { id: "last-2-weeks", label: "Last 2 weeks (incl. current)" },
      { id: "last-4-weeks", label: "Last 4 weeks" },
    ];

    const tableRows = buildDedupedAttemptRows(filteredRows, selectedWeekKeys)
      .map((row) => buildAnalyticsRow(row, getActionedValue(actionedState, selectedWeekKeys[0], row?.assetCode)))
      .sort(
        (a, b) =>
          getNextStepSortIndex(a.nextStep) - getNextStepSortIndex(b.nextStep) ||
          getRowSortCpi(a) - getRowSortCpi(b) ||
          String(a.showName || "").localeCompare(String(b.showName || "")) ||
          String(a.beatName || "").localeCompare(String(b.beatName || "")) ||
          String(a.assetCode || "").localeCompare(String(b.assetCode || ""))
      );

    return NextResponse.json({
      ok: true,
      selectedWeekKey,
      selectedWeekLabel: selectedLabel,
      selectedWeekRangeLabel: requestedWeeks
        ? `${formatWeekRangeLabel(selectedWeekKeys[selectedWeekKeys.length - 1], selectedWeekEnd)}`
        : startDate || endDate
          ? formatWeekRangeLabel(buildDateRangeSelection({ startDate, endDate }).startDate, selectedWeekEnd)
          : formatWeekRangeLabel(selectedWeekKeys[0], selectedWeekEnd),
      multiWeekOptions,
      weekOptions,
      rowCount: tableRows.length,
      legend: LEGEND_ITEMS,
      metricColumns: ANALYTICS_METRIC_COLUMNS,
      hiddenMetricKeys: ANALYTICS_METRIC_COLUMNS.filter((column) => column.hiddenByDefault).map((column) => column.key),
      emptyStateMessage:
        tableRows.length > 0
          ? ""
          : `No analytics rows are available for ${formatWeekRangeLabel(selectedWeekKey, selectedWeekEnd)} yet.`,
      rows: tableRows,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      error: error.message || "Unable to load analytics data.",
      selectedWeekKey: "",
      selectedWeekLabel: "Unavailable",
      selectedWeekRangeLabel: "",
      multiWeekOptions: [],
      weekOptions: [],
      rowCount: 0,
      legend: LEGEND_ITEMS,
      metricColumns: ANALYTICS_METRIC_COLUMNS,
      hiddenMetricKeys: ANALYTICS_METRIC_COLUMNS.filter((column) => column.hiddenByDefault).map((column) => column.key),
      emptyStateMessage: "Analytics is temporarily unavailable. Check Supabase and sheet credentials.",
      rows: [],
    });
  }
}

export async function PUT(request) {
  if (!hasEditSession(request)) {
    return NextResponse.json({ error: "Unlock edit mode before updating Actioned." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const weekKey = normalizeWeekKey(body?.weekKey || new URL(request.url).searchParams.get("week"));
    const assetCode = String(body?.assetCode || "").trim();
    const actioned = body?.actioned;

    if (!weekKey) {
      return NextResponse.json({ error: "A valid week key is required." }, { status: 400 });
    }

    if (!assetCode) {
      return NextResponse.json({ error: "A valid asset code is required." }, { status: 400 });
    }

    if (typeof actioned !== "boolean") {
      return NextResponse.json({ error: "Actioned must be true or false." }, { status: 400 });
    }

    const currentState = await readActionedState();
    const nextState = buildUpdatedActionedState(currentState, weekKey, assetCode, actioned);
    const payload = {
      updatedAt: nextState.updatedAt || new Date().toISOString(),
      weeks: nextState.weeks,
      assets: nextState.assets || {},
    };

    await writeJsonObject(ACTIONED_STATE_PATH, payload);

    return NextResponse.json({
      ok: true,
      weekKey,
      assetCode,
      actioned,
      updatedAt: payload.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Unable to update Actioned.",
      },
      { status: 500 }
    );
  }
}
