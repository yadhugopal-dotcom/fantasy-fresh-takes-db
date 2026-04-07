import { NextResponse } from "next/server";
import { readJsonObject } from "../../../../lib/storage.js";
import {
  GOOD_TO_GO_BEATS_TARGET,
  TARGET_FLOOR,
  buildGoodToGoBeatsMetricsFromIdeationTab,
  buildReleasedFreshTakeAttemptsForPeriod,
  buildTatSummaryFromRows,
  fetchAnalyticsLiveTabRows,
  fetchIdeationTabRows,
  fetchLiveTabRows,
  isAnalyticsEligibleProductionType,
} from "../../../../lib/live-tab.js";
import {
  buildPlannerBeatInventory,
  buildPlannerStageMetrics,
  buildPodsModel,
  countActiveWritersInPods,
  countAllAssetsWithStage,
  countAssetsSubmittedByDay,
  createDefaultWriterConfig,
  getCurrentWeekKey,
  isNonBauPodLeadName,
  isVisiblePlannerPodLeadName,
  mergeWeekData,
  mergeWriterConfig,
} from "../../../../lib/tracker-data.js";
import { formatWeekRangeLabel, getWeekSelection, getWeekWindowFromReference, normalizeWeekView } from "../../../../lib/week-view.js";

const CONFIG_PATH = "config/writer-config.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makePlannerWeekPath(weekKey) {
  return `weeks/${weekKey}.json`;
}

function makeCommittedPlannerWeekPath(weekKey) {
  return `weeks/${weekKey}-committed.json`;
}

function makePodFilter(includeNewShowsPod) {
  return (pod) => {
    if (!isVisiblePlannerPodLeadName(pod?.cl)) return false;
    if (!includeNewShowsPod && isNonBauPodLeadName(pod?.cl)) return false;
    return true;
  };
}

async function loadPlannerWeek(period, { includeNewShowsPod = false } = {}) {
  const weekSelection = getWeekSelection(period);
  const storedConfig = await readJsonObject(CONFIG_PATH);
  const currentConfig = mergeWriterConfig(storedConfig || createDefaultWriterConfig());
  const [storedWeek, committedSnapshot] = await Promise.all([
    readJsonObject(makePlannerWeekPath(weekSelection.weekKey)),
    period === "next" ? readJsonObject(makeCommittedPlannerWeekPath(weekSelection.weekKey)) : Promise.resolve(null),
  ]);
  const mergedWeek = mergeWeekData(currentConfig, storedWeek, weekSelection.weekKey);
  const rosterConfig =
    weekSelection.weekKey < getCurrentWeekKey()
      ? mergeWriterConfig(mergedWeek?.rosterSnapshot || currentConfig)
      : currentConfig;
  const weekData = mergeWeekData(rosterConfig, storedWeek, weekSelection.weekKey);
  const podFilter = makePodFilter(includeNewShowsPod);
  const pods = buildPodsModel(rosterConfig, weekData).filter(podFilter);
  const plannerBeats = buildPlannerBeatInventory(pods, { dedupeScope: "global" });
  const hasCommittedSnapshot = Boolean(committedSnapshot?.weekData && committedSnapshot?.rosterSnapshot);

  if (period === "next" && hasCommittedSnapshot) {
    const committedConfig = mergeWriterConfig(committedSnapshot.rosterSnapshot);
    const committedWeekData = mergeWeekData(committedConfig, committedSnapshot.weekData, weekSelection.weekKey);
    const committedPods = buildPodsModel(committedConfig, committedWeekData).filter(podFilter);

    return {
      weekSelection,
      writerConfig: committedConfig,
      weekData: committedWeekData,
      pods: committedPods,
      plannerBeats: buildPlannerBeatInventory(committedPods, { dedupeScope: "global" }),
      plannerSource: "committed",
    };
  }

  return {
    weekSelection,
    writerConfig: rosterConfig,
    weekData,
    pods,
    plannerBeats,
    plannerSource: "board",
  };
}

function buildPlannerTimingSummary(plannerBeats) {
  const metrics = buildPlannerStageMetrics(plannerBeats, {
    targetFloor: TARGET_FLOOR,
    targetTatDays: 1,
  });

  return {
    plannedLiveCount: metrics.plannedLiveCount,
    plannedLiveAnywhereCount: metrics.liveOnMetaBeatCount,
    inProductionBeatCount: metrics.productionBeatCount,
    averageWritingDays: metrics.averageWritingDays,
    averageClReviewDays: metrics.averageClReviewDays,
    scriptsPerWriter: metrics.scriptsPerWriter,
    tatSummary: {
      averageTatDays: metrics.expectedProductionTatDays,
      medianTatDays: null,
      eligibleAssetCount: metrics.productionBeatCount,
      skippedMissingTatDates: 0,
      skippedInvalidTatRows: 0,
      targetTatDays: metrics.targetTatDays,
      tatRows: [],
    },
    writingEmptyMessage:
      metrics.uniqueBeatCount > 0 ? "" : "No planner beats are assigned for the selected week yet.",
    clReviewEmptyMessage:
      metrics.uniqueBeatCount > 0 ? "" : "No planner beats are assigned for the selected week yet.",
  };
}

function buildCurrentWeekPayload(plannerState) {
  const timing = buildPlannerTimingSummary(plannerState.plannerBeats);
  const allProductionAssetCount = countAllAssetsWithStage(plannerState.pods, "production");
  const allLiveOnMetaAssetCount = countAllAssetsWithStage(plannerState.pods, "live_on_meta");
  const activeWriterCount = countActiveWritersInPods(plannerState.pods);
  const submittedByThursday = countAssetsSubmittedByDay(plannerState.pods, 3); // Thu = index 3

  return {
    ok: true,
    period: "current",
    selectionMode: "editorial_funnel",
    weekStart: plannerState.weekSelection.weekStart,
    weekEnd: plannerState.weekSelection.weekEnd,
    weekKey: plannerState.weekSelection.weekKey,
    weekLabel: formatWeekRangeLabel(plannerState.weekSelection.weekStart, plannerState.weekSelection.weekEnd),
    hasPlannerData: true,
    hasWeekData: plannerState.plannerBeats.length > 0,
    emptyStateMessage:
      plannerState.plannerBeats.length > 0 ? "" : "No planner beats are assigned for the selected week yet.",
    plannerBeatCount: plannerState.plannerBeats.length,
    freshTakeCount: timing.plannedLiveCount,
    plannedReleaseCount: allLiveOnMetaAssetCount,
    inProductionBeatCount: allProductionAssetCount,
    submittedByThursday,
    productionOutputCount: null,
    goodToGoBeatsCount: null,
    goodToGoTarget: GOOD_TO_GO_BEATS_TARGET,
    ideationWeekBucket: "",
    targetFloor: TARGET_FLOOR,
    tatSummary: timing.tatSummary,
    tatEmptyMessage:
      timing.tatSummary.eligibleAssetCount > 0
        ? ""
        : "No planner beats are assigned for the selected week yet.",
    averageWritingDays: timing.averageWritingDays,
    averageClReviewDays: timing.averageClReviewDays,
    scriptsPerWriter: activeWriterCount > 0 ? Number((allProductionAssetCount / activeWriterCount).toFixed(1)) : null,
    writingEmptyMessage: timing.writingEmptyMessage,
    clReviewEmptyMessage: timing.clReviewEmptyMessage,
  };
}

function buildNextWeekPayload(plannerState, ideationRows) {
  const gtgMetrics = buildGoodToGoBeatsMetricsFromIdeationTab(ideationRows, "next", {
    sourceWeekOffsetWeeks: -1,
  });
  const timing = buildPlannerTimingSummary(plannerState.plannerBeats);
  const allLiveOnMetaAssetCount = countAllAssetsWithStage(plannerState.pods, "live_on_meta");
  const allProductionAssetCount = countAllAssetsWithStage(plannerState.pods, "production");
  const activeWriterCount = countActiveWritersInPods(plannerState.pods);
  const plannedReleaseCount = allLiveOnMetaAssetCount;

  return {
    ok: true,
    period: "next",
    selectionMode: "planned",
    weekStart: plannerState.weekSelection.weekStart,
    weekEnd: plannerState.weekSelection.weekEnd,
    weekKey: plannerState.weekSelection.weekKey,
    weekLabel: formatWeekRangeLabel(plannerState.weekSelection.weekStart, plannerState.weekSelection.weekEnd),
    hasPlannerData: true,
    hasWeekData: plannerState.plannerBeats.length > 0 || Number(gtgMetrics.goodToGoBeatsCount || 0) > 0,
    emptyStateMessage:
      plannerState.plannerBeats.length > 0 || Number(gtgMetrics.goodToGoBeatsCount || 0) > 0
        ? ""
        : "No planner beats or GTG beats are available for next week yet.",
    plannerSource: plannerState.plannerSource || "board",
    plannerBeatCount: plannerState.plannerBeats.length,
    goodToGoBeatsCount: gtgMetrics.goodToGoBeatsCount,
    reviewPendingCount: gtgMetrics.reviewPendingCount || 0,
    iterateCount: gtgMetrics.iterateCount || 0,
    goodToGoTarget: gtgMetrics.goodToGoTarget,
    ideationWeekBucket: gtgMetrics.ideationWeekBucket,
    freshTakeCount: plannedReleaseCount,
    plannedReleaseCount,
    inProductionBeatCount: allProductionAssetCount,
    productionOutputCount: null,
    targetFloor: TARGET_FLOOR,
    tatSummary: timing.tatSummary,
    tatEmptyMessage:
      timing.tatSummary.averageTatDays === null
        ? "Planner allocations are not sufficient yet to estimate production TAT."
        : "",
    averageWritingDays: timing.averageWritingDays,
    averageClReviewDays: timing.averageClReviewDays,
    scriptsPerWriter: activeWriterCount > 0 ? Number((allProductionAssetCount / activeWriterCount).toFixed(1)) : null,
    writingEmptyMessage: timing.writingEmptyMessage,
    clReviewEmptyMessage: timing.clReviewEmptyMessage,
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFunnelSuccess(row) {
  const amountSpent = toFiniteNumber(row?.amountSpentUsd);
  const q1Completion = toFiniteNumber(row?.video0To25Pct);
  const cti = toFiniteNumber(row?.clickToInstall);
  const absoluteCompletion = toFiniteNumber(row?.absoluteCompletionPct);
  const cpi = toFiniteNumber(row?.cpiUsd);

  // ALL criteria must be met for success:
  // 1. Amount spent >= $100
  // 2. Q1 completion > 10%
  // 3. CTI >= 12%
  // 4. Absolute completion >= 1.8%
  // 5. CPI <= $12
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

function buildLastWeekHitRateAndFunnel(analyticsRows, { includeNewShowsPod = false } = {}) {
  const lastWeek = getWeekSelection("last");
  const lastWeekKey = lastWeek.weekKey;

  // Filter to rows with live dates in last week, respecting POD toggle
  const weekFiltered = (Array.isArray(analyticsRows) ? analyticsRows : []).filter((row) => {
    if (!row?.liveDate) return false;
    const window = getWeekWindowFromReference(row.liveDate);
    if (window.weekStart !== lastWeekKey) return false;
    if (!includeNewShowsPod && isNonBauPodLeadName(row?.podLeadName)) return false;
    return true;
  });

  // Deduplicate by asset code
  const dedupMap = new Map();
  for (const row of weekFiltered) {
    const key = String(row?.assetCode || "").trim().toLowerCase();
    if (!key) continue;
    if (!dedupMap.has(key) || isBetterAttemptRow(row, dedupMap.get(key))) {
      dedupMap.set(key, row);
    }
  }

  const dedupedRows = Array.from(dedupMap.values());

  // Hit rate and funnel use only analytics-eligible production types
  // Success = ALL criteria met: $100+ spent, Q1 > 10%, CTI >= 12%, Abs completion >= 1.8%
  const eligibleRows = dedupedRows.filter((r) => isAnalyticsEligibleProductionType(r?.productionType));
  let successCount = 0;

  const funnelMap = new Map();
  for (const row of eligibleRows) {
    const isSuccess = isFunnelSuccess(row);
    if (isSuccess) successCount += 1;

    const showName = String(row?.showName || "").trim() || "Unknown show";
    const beatName = String(row?.beatName || "").trim() || "Unknown beat";
    const funnelKey = `${showName.toLowerCase()}|${beatName.toLowerCase()}`;
    if (!funnelMap.has(funnelKey)) {
      funnelMap.set(funnelKey, { showName, beatName, attempts: 0, successfulAttempts: 0 });
    }
    const entry = funnelMap.get(funnelKey);
    entry.attempts += 1;
    if (isSuccess) entry.successfulAttempts += 1;
  }

  return {
    hitRate: eligibleRows.length > 0 ? Number(((successCount / eligibleRows.length) * 100).toFixed(1)) : null,
    hitRateNumerator: successCount,
    hitRateDenominator: eligibleRows.length,
    beatsFunnel: (() => {
      const funnelRows = Array.from(funnelMap.values());
      const showSuccessMap = new Map();
      for (const r of funnelRows) {
        showSuccessMap.set(r.showName, (showSuccessMap.get(r.showName) || 0) + r.successfulAttempts);
      }
      funnelRows.sort((a, b) => {
        const sDiff = (showSuccessMap.get(b.showName) || 0) - (showSuccessMap.get(a.showName) || 0);
        if (sDiff !== 0) return sDiff;
        const nameComp = a.showName.localeCompare(b.showName);
        if (nameComp !== 0) return nameComp;
        return a.beatName.localeCompare(b.beatName);
      });
      return funnelRows;
    })(),
  };
}

function buildLastWeekPayload(liveRows, analyticsRows, { includeNewShowsPod = false } = {}) {
  const weekSelection = getWeekSelection("last");
  const weekLabel = formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd);
  const allFreshTakeRows = buildReleasedFreshTakeAttemptsForPeriod(liveRows, "last");
  const freshTakeRows = includeNewShowsPod
    ? allFreshTakeRows
    : allFreshTakeRows.filter((row) => !isNonBauPodLeadName(row?.podLeadName));
  const tatSummary = buildTatSummaryFromRows(freshTakeRows);
  const hitRateData = buildLastWeekHitRateAndFunnel(analyticsRows, { includeNewShowsPod });

  return {
    ok: true,
    period: "last",
    selectionMode: "throughput",
    weekStart: weekSelection.weekStart,
    weekEnd: weekSelection.weekEnd,
    weekKey: weekSelection.weekKey,
    weekLabel,
    hasPlannerData: false,
    hasWeekData: freshTakeRows.length > 0,
    emptyStateMessage:
      freshTakeRows.length > 0 ? "" : `No released fresh takes were found in the Live tab for ${weekLabel}.`,
    plannerBeatCount: null,
    throughputBeatCount: freshTakeRows.length,
    goodToGoBeatsCount: null,
    goodToGoTarget: GOOD_TO_GO_BEATS_TARGET,
    ideationWeekBucket: "",
    freshTakeCount: freshTakeRows.length,
    plannedReleaseCount: null,
    inProductionBeatCount: null,
    productionOutputCount: null,
    targetFloor: TARGET_FLOOR,
    tatSummary,
    tatEmptyMessage:
      tatSummary.eligibleAssetCount > 0 ? "" : `No eligible production TAT rows were found in ${weekLabel}.`,
    hitRate: hitRateData.hitRate,
    hitRateNumerator: hitRateData.hitRateNumerator,
    hitRateDenominator: hitRateData.hitRateDenominator,
    beatsFunnel: hitRateData.beatsFunnel,
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const period = normalizeWeekView(url.searchParams.get("period"));
  const includeNewShowsPod = url.searchParams.get("includeNewShowsPod") === "true";

  try {
    if (period === "last") {
      const [{ rows: liveRows }, { rows: analyticsRows }] = await Promise.all([
        fetchLiveTabRows(),
        fetchAnalyticsLiveTabRows(),
      ]);
      return NextResponse.json(buildLastWeekPayload(liveRows, analyticsRows, { includeNewShowsPod }));
    }

    const plannerState = await loadPlannerWeek(period, { includeNewShowsPod });

    if (period === "current") {
      return NextResponse.json(buildCurrentWeekPayload(plannerState));
    }

    if (period === "next") {
      const { rows: ideationRows } = await fetchIdeationTabRows();
      return NextResponse.json(buildNextWeekPayload(plannerState, ideationRows));
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        period,
        liveTabError: error.message || "Unable to load editorial funnel metrics.",
        targetFloor: TARGET_FLOOR,
      },
      { status: error.statusCode || 500 }
    );
  }
}
