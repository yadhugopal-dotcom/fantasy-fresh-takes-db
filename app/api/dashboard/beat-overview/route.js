import { NextResponse } from "next/server";
import {
  fetchAnalyticsLiveTabRows,
  fetchEditorialTabRows,
  fetchLiveTabRows,
  fetchProductionTabRows,
} from "../../../../lib/live-tab.js";
import { formatWeekRangeLabel, getWeekSelection, getWeekWindowFromReference, parseYmdToUtcDate, shiftYmd } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeWeekKey(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeBeatKey(showName, beatName) {
  return `${normalizeKey(showName)}|${normalizeKey(beatName)}`;
}

function makeAssetKey(assetCode) {
  return normalizeKey(assetCode);
}

function daysBetween(startYmd, endYmd) {
  const start = normalizeWeekKey(startYmd);
  const end = normalizeWeekKey(endYmd);
  if (!start || !end) return null;
  const startDate = parseYmdToUtcDate(start);
  const endDate = parseYmdToUtcDate(end);
  const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  if (!Number.isFinite(diffDays) || diffDays < 0) return null;
  return diffDays;
}

function average(values) {
  const safe = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (safe.length === 0) return null;
  return Number((safe.reduce((sum, value) => sum + value, 0) / safe.length).toFixed(1));
}

function isFunnelSuccess(row) {
  const amountSpent = toFiniteNumber(row?.amountSpentUsd);
  const q1Completion = toFiniteNumber(row?.video0To25Pct);
  const cti = toFiniteNumber(row?.clickToInstall);
  const absoluteCompletion = toFiniteNumber(row?.absoluteCompletionPct);
  const cpi = toFiniteNumber(row?.cpiUsd);

  return (
    Number.isFinite(amountSpent) && amountSpent >= 100 &&
    Number.isFinite(q1Completion) && q1Completion > 10 &&
    Number.isFinite(cti) && cti >= 12 &&
    Number.isFinite(absoluteCompletion) && absoluteCompletion >= 1.8 &&
    Number.isFinite(cpi) && cpi <= 12
  );
}

function isBetterAttemptRow(nextRow, currentRow) {
  const nextScore = Number(nextRow?.metricsCompletenessScore || 0);
  const currentScore = Number(currentRow?.metricsCompletenessScore || 0);
  if (nextScore !== currentScore) return nextScore > currentScore;

  const nextSpend = Number(nextRow?.amountSpentUsd || 0);
  const currentSpend = Number(currentRow?.amountSpentUsd || 0);
  if (Number.isFinite(nextSpend) && Number.isFinite(currentSpend) && nextSpend !== currentSpend) {
    return nextSpend > currentSpend;
  }

  return Number(nextRow?.rowIndex || 0) > Number(currentRow?.rowIndex || 0);
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

function buildWeekOption(weekKey, count = 0) {
  const weekEnd = shiftYmd(weekKey, 6);
  return {
    id: weekKey,
    weekKey,
    label: `${formatMonthWeekLabel(weekKey)} · ${formatWeekRangeLabel(weekKey, weekEnd)}`,
    weekLabel: formatWeekRangeLabel(weekKey, weekEnd),
    count: Number(count || 0),
  };
}

function buildWeekOptions(liveRows) {
  const counts = new Map();
  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    const liveDate = normalizeWeekKey(row?.liveDate);
    if (!liveDate) continue;
    const weekKey = getWeekWindowFromReference(liveDate).weekStart;
    counts.set(weekKey, (counts.get(weekKey) || 0) + 1);
  }

  const safeLastWeek = getWeekSelection("last").weekKey;
  if (!counts.has(safeLastWeek)) {
    counts.set(safeLastWeek, 0);
  }

  return Array.from(counts.entries())
    .map(([weekKey, count]) => ({ weekKey, count }))
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
    .map((entry) => buildWeekOption(entry.weekKey, entry.count));
}

export async function GET(request) {
  const url = new URL(request.url);
  const requestedWeekKey = normalizeWeekKey(url.searchParams.get("week"));

  try {
    const [liveResult, editorialResult, productionResult, analyticsResult] = await Promise.all([
      fetchLiveTabRows(),
      fetchEditorialTabRows(),
      fetchProductionTabRows(),
      fetchAnalyticsLiveTabRows(),
    ]);

    const liveRows = Array.isArray(liveResult?.rows) ? liveResult.rows : [];
    const editorialRows = Array.isArray(editorialResult?.rows) ? editorialResult.rows : [];
    const productionRows = Array.isArray(productionResult?.rows) ? productionResult.rows : [];
    const analyticsRows = Array.isArray(analyticsResult?.rows) ? analyticsResult.rows : [];

    const weekOptions = buildWeekOptions(liveRows);
    const selectedWeekKey =
      requestedWeekKey && weekOptions.some((option) => option.weekKey === requestedWeekKey)
        ? requestedWeekKey
        : String(weekOptions[0]?.weekKey || getWeekSelection("last").weekKey);
    const selectedWeek = buildWeekOption(selectedWeekKey, 0);

    const editorialByAsset = new Map();
    for (const row of editorialRows) {
      const assetKey = makeAssetKey(row?.assetCode);
      if (!assetKey) continue;
      editorialByAsset.set(assetKey, row);
    }

    const productionByAsset = new Map();
    for (const row of productionRows) {
      const assetKey = makeAssetKey(row?.assetCode);
      if (!assetKey) continue;
      productionByAsset.set(assetKey, row);
    }

    const analyticsByAsset = new Map();
    for (const row of analyticsRows) {
      const liveDate = normalizeWeekKey(row?.liveDate);
      if (!liveDate) continue;
      const weekKey = getWeekWindowFromReference(liveDate).weekStart;
      if (weekKey !== selectedWeekKey) continue;

      const assetKey = makeAssetKey(row?.assetCode);
      if (!assetKey) continue;
      const current = analyticsByAsset.get(assetKey);
      if (!current || isBetterAttemptRow(row, current)) {
        analyticsByAsset.set(assetKey, row);
      }
    }

    const beatMap = new Map();
    for (const row of liveRows) {
      const liveDate = normalizeWeekKey(row?.liveDate);
      if (!liveDate) continue;
      const weekKey = getWeekWindowFromReference(liveDate).weekStart;
      if (weekKey !== selectedWeekKey) continue;

      const beatKey = makeBeatKey(row?.showName, row?.beatName);
      if (!beatKey || beatKey === "|") continue;

      if (!beatMap.has(beatKey)) {
        beatMap.set(beatKey, {
          showName: String(row?.showName || "").trim(),
          beatName: String(row?.beatName || "").trim(),
          assetCodes: new Set(),
          writerNames: new Set(),
          scriptingDaysValues: [],
          productionDaysValues: [],
          passCount: 0,
          failCount: 0,
        });
      }

      const beat = beatMap.get(beatKey);
      const assetCode = String(row?.assetCode || "").trim();
      const assetKey = makeAssetKey(assetCode);
      if (assetCode) beat.assetCodes.add(assetCode);
      if (row?.writerName) beat.writerNames.add(String(row.writerName).trim());

      const editorialRow = editorialByAsset.get(assetKey);
      const productionRow = productionByAsset.get(assetKey);
      if (editorialRow?.writerName) beat.writerNames.add(String(editorialRow.writerName).trim());
      if (productionRow?.writerName) beat.writerNames.add(String(productionRow.writerName).trim());

      const scriptingStart = normalizeWeekKey(editorialRow?.submittedDate || editorialRow?.leadSubmittedDate);
      const scriptingEnd = normalizeWeekKey(productionRow?.productionPickedDate || row?.tatStartDate);
      const scriptingDays = daysBetween(scriptingStart, scriptingEnd);
      if (Number.isFinite(scriptingDays)) {
        beat.scriptingDaysValues.push(scriptingDays);
      }

      const productionStart = normalizeWeekKey(productionRow?.productionPickedDate || row?.tatStartDate);
      const productionEnd = normalizeWeekKey(row?.liveDate);
      const productionDays = daysBetween(productionStart, productionEnd);
      if (Number.isFinite(productionDays)) {
        beat.productionDaysValues.push(productionDays);
      }

      const analyticsRow = analyticsByAsset.get(assetKey);
      if (analyticsRow) {
        if (isFunnelSuccess(analyticsRow)) beat.passCount += 1;
        else beat.failCount += 1;
      }
    }

    const rows = Array.from(beatMap.values())
      .map((beat) => {
        const hasPass = beat.passCount > 0;
        return {
          showName: beat.showName || "Unknown show",
          beatName: beat.beatName || "Unknown beat",
          beatLabel: `${beat.showName || "Unknown show"} - ${beat.beatName || "Unknown beat"}`,
          contributors: Array.from(beat.writerNames).filter(Boolean).sort((a, b) => a.localeCompare(b)).join(", "),
          scriptingDays: average(beat.scriptingDaysValues),
          productionDays: average(beat.productionDaysValues),
          outcome: hasPass ? "Pass" : "Fail",
          assetCount: beat.assetCodes.size,
          passCount: beat.passCount,
          failCount: beat.failCount,
        };
      })
      .sort((a, b) => {
        if (a.outcome !== b.outcome) return a.outcome === "Pass" ? -1 : 1;
        if (a.showName !== b.showName) return a.showName.localeCompare(b.showName);
        return a.beatName.localeCompare(b.beatName);
      });

    return NextResponse.json({
      ok: true,
      selectedWeekKey,
      selectedWeekLabel: selectedWeek.label,
      selectedWeekRangeLabel: selectedWeek.weekLabel,
      weekOptions,
      rows,
      rowCount: rows.length,
      emptyStateMessage: "No released beats found for this week yet.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load beat overview." },
      { status: 500 }
    );
  }
}
