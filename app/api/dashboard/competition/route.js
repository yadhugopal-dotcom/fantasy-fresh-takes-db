import { NextResponse } from "next/server";
import { readJsonObject } from "../../../../lib/storage.js";
import {
  POD_LEAD_ORDER,
  fetchLiveTabRows,
  fetchAnalyticsLiveTabRows,
  fetchEditorialTabRows,
  fetchProductionTabRows,
  buildLifetimeScriptsPerPod,
  buildLwEditorialOutputPerPod,
  isAnalyticsEligibleProductionType,
  isTatEligibleProductionType,
} from "../../../../lib/live-tab.js";
import {
  buildLifetimeBeatsPerPod,
  buildPodsModel,
  createDefaultWriterConfig,
  generateWeekKeysSince,
  getCurrentWeekKey,
  isVisiblePlannerPodLeadName,
  mergeWeekData,
  mergeWriterConfig,
} from "../../../../lib/tracker-data.js";
import { formatWeekRangeLabel, getWeekSelection, normalizeWeekView } from "../../../../lib/week-view.js";

const CONFIG_PATH = "config/writer-config.json";
const LIFETIME_SINCE = "2026-03-10";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makePlannerWeekPath(weekKey) {
  return `weeks/${weekKey}.json`;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMetricCell(value, benchmarkCheck) {
  const numericValue = toFiniteNumber(value);
  return {
    value: numericValue,
    meetsBenchmark: numericValue !== null && Number.isFinite(numericValue) && benchmarkCheck(numericValue),
  };
}

const BASELINE_THRESHOLD_CHECKS = {
  threeSecPlays: (value) => value >= 35,
  thruplaysTo3s: (value) => value >= 40,
  q1Completion: (value) => value > 10,
  cpi: (value) => value < 10,
  absoluteCompletion: (value) => value > 1.5,
  cti: (value) => value >= 12,
  amountSpent: (value) => value > 100,
};

function countBenchmarkMisses(metricMap, keys) {
  return keys.reduce((sum, key) => sum + (metricMap?.[key]?.meetsBenchmark ? 0 : 1), 0);
}

function computeHitRatePerPod(analyticsRows, sinceDate) {
  const validRows = (Array.isArray(analyticsRows) ? analyticsRows : []).filter((row) => {
    const liveDate = String(row?.liveDate || "").trim();
    if (!liveDate || liveDate < sinceDate) return false;
    if (!isTatEligibleProductionType(row?.productionType)) return false;
    const assetCode = String(row?.assetCode || "").trim();
    if (!assetCode) return false;
    return true;
  });

  // Dedupe by assetCode per pod — keep best row (highest completeness score then spend)
  const podAssetMap = new Map();
  for (const row of validRows) {
    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    const assetCode = String(row?.assetCode || "").trim().toLowerCase();
    const key = `${podName}|${assetCode}`;

    if (!podAssetMap.has(key)) {
      podAssetMap.set(key, row);
    } else {
      const existing = podAssetMap.get(key);
      const nextScore = Number(row?.metricsCompletenessScore || 0);
      const existingScore = Number(existing?.metricsCompletenessScore || 0);
      if (nextScore > existingScore || (nextScore === existingScore && Number(row?.amountSpentUsd || 0) > Number(existing?.amountSpentUsd || 0))) {
        podAssetMap.set(key, row);
      }
    }
  }

  // Classify each deduped row — denominator is ALL live scripts, not just qualifying
  const podStats = new Map();
  for (const row of podAssetMap.values()) {
    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    if (!podStats.has(podName)) {
      podStats.set(podName, { totalLive: 0, hits: 0 });
    }
    const stats = podStats.get(podName);
    stats.totalLive += 1;

    const amountSpent = toFiniteNumber(row?.amountSpentUsd);
    // Only scripts with $100+ spend can qualify for Gen AI / P1 Rework
    if (!Number.isFinite(amountSpent) || amountSpent < 100) continue;

    const metrics = {
      threeSecPlays: buildMetricCell(row?.threeSecPlaysPct, BASELINE_THRESHOLD_CHECKS.threeSecPlays),
      thruplaysTo3s: buildMetricCell(row?.thruplaysTo3sPct, BASELINE_THRESHOLD_CHECKS.thruplaysTo3s),
      q1Completion: buildMetricCell(row?.q1CompletionPct, BASELINE_THRESHOLD_CHECKS.q1Completion),
      cpi: buildMetricCell(row?.cpiUsd, BASELINE_THRESHOLD_CHECKS.cpi),
      absoluteCompletion: buildMetricCell(row?.absoluteCompletionPct, BASELINE_THRESHOLD_CHECKS.absoluteCompletion),
      cti: buildMetricCell(row?.clickToInstall, BASELINE_THRESHOLD_CHECKS.cti),
      amountSpent: buildMetricCell(row?.amountSpentUsd, BASELINE_THRESHOLD_CHECKS.amountSpent),
    };

    const baselineKeys = Object.keys(BASELINE_THRESHOLD_CHECKS);
    const baselineMissCount = countBenchmarkMisses(metrics, baselineKeys);
    const cpiValue = toFiniteNumber(row?.cpiUsd);
    const ctiValue = toFiniteNumber(row?.clickToInstall);
    const cpiPass = Number.isFinite(cpiValue) && cpiValue < 10;

    // Gen AI: CPI < $10 AND <= 2 baseline benchmark misses
    if (cpiPass && baselineMissCount <= 2) {
      stats.hits += 1;
    }
    // P1 Rework: CTI >= 12%
    else if (Number.isFinite(ctiValue) && ctiValue >= 12) {
      stats.hits += 1;
    }
  }

  return podStats;
}

function computeHitRatePerPodForWeek(analyticsRows, weekSelection) {
  const weekStart = String(weekSelection?.weekStart || "");
  const weekEnd = String(weekSelection?.weekEnd || "");
  if (!weekStart || !weekEnd) return new Map();

  const validRows = (Array.isArray(analyticsRows) ? analyticsRows : []).filter((row) => {
    const liveDate = String(row?.liveDate || "").trim();
    if (!liveDate || liveDate < weekStart || liveDate > weekEnd) return false;
    if (!isTatEligibleProductionType(row?.productionType)) return false;
    const assetCode = String(row?.assetCode || "").trim();
    if (!assetCode) return false;
    return true;
  });

  const podAssetMap = new Map();
  for (const row of validRows) {
    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    const assetCode = String(row?.assetCode || "").trim().toLowerCase();
    const key = `${podName}|${assetCode}`;

    if (!podAssetMap.has(key)) {
      podAssetMap.set(key, row);
    } else {
      const existing = podAssetMap.get(key);
      const nextScore = Number(row?.metricsCompletenessScore || 0);
      const existingScore = Number(existing?.metricsCompletenessScore || 0);
      if (
        nextScore > existingScore ||
        (nextScore === existingScore && Number(row?.amountSpentUsd || 0) > Number(existing?.amountSpentUsd || 0))
      ) {
        podAssetMap.set(key, row);
      }
    }
  }

  const podStats = new Map();
  for (const row of podAssetMap.values()) {
    const podName = String(row?.podLeadName || "").trim();
    if (!podName) continue;

    if (!podStats.has(podName)) {
      podStats.set(podName, { totalLive: 0, hits: 0 });
    }
    const stats = podStats.get(podName);
    stats.totalLive += 1;

    const amountSpent = toFiniteNumber(row?.amountSpentUsd);
    if (!Number.isFinite(amountSpent) || amountSpent < 100) continue;

    const metrics = {
      threeSecPlays: buildMetricCell(row?.threeSecPlaysPct, BASELINE_THRESHOLD_CHECKS.threeSecPlays),
      thruplaysTo3s: buildMetricCell(row?.thruplaysTo3sPct, BASELINE_THRESHOLD_CHECKS.thruplaysTo3s),
      q1Completion: buildMetricCell(row?.q1CompletionPct, BASELINE_THRESHOLD_CHECKS.q1Completion),
      cpi: buildMetricCell(row?.cpiUsd, BASELINE_THRESHOLD_CHECKS.cpi),
      absoluteCompletion: buildMetricCell(row?.absoluteCompletionPct, BASELINE_THRESHOLD_CHECKS.absoluteCompletion),
      cti: buildMetricCell(row?.clickToInstall, BASELINE_THRESHOLD_CHECKS.cti),
      amountSpent: buildMetricCell(row?.amountSpentUsd, BASELINE_THRESHOLD_CHECKS.amountSpent),
    };

    const baselineKeys = Object.keys(BASELINE_THRESHOLD_CHECKS);
    const baselineMissCount = countBenchmarkMisses(metrics, baselineKeys);
    const cpiValue = toFiniteNumber(row?.cpiUsd);
    const ctiValue = toFiniteNumber(row?.clickToInstall);
    const cpiPass = Number.isFinite(cpiValue) && cpiValue < 10;

    if (cpiPass && baselineMissCount <= 2) {
      stats.hits += 1;
    } else if (Number.isFinite(ctiValue) && ctiValue >= 12) {
      stats.hits += 1;
    }
  }

  return podStats;
}

function buildScriptsPerPodForWeek(liveRows, weekSelection) {
  const weekStart = String(weekSelection?.weekStart || "");
  const weekEnd = String(weekSelection?.weekEnd || "");
  if (!weekStart || !weekEnd) return new Map();

  const podAssets = new Map();
  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    const liveDate = String(row?.liveDate || "").trim();
    if (!liveDate || liveDate < weekStart || liveDate > weekEnd) continue;

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

function buildPodRosterMeta(pods) {
  const podOrder = POD_LEAD_ORDER.filter((podLeadName) => isVisiblePlannerPodLeadName(podLeadName));
  const podWriterCounts = Object.fromEntries(podOrder.map((podLeadName) => [podLeadName, 0]));

  for (const pod of Array.isArray(pods) ? pods : []) {
    if (!Object.prototype.hasOwnProperty.call(podWriterCounts, pod?.cl)) continue;
    podWriterCounts[pod.cl] = (Array.isArray(pod?.writers) ? pod.writers : []).filter(
      (writer) => writer?.active !== false
    ).length;
  }

  return { podOrder, podWriterCounts };
}

async function loadLifetimeCompetitionData(rosterMeta) {
  const weekKeys = generateWeekKeysSince(LIFETIME_SINCE);
  const lastWeekSelection = getWeekSelection("last");

  const [weekDataEntries, liveResult, analyticsResult, editorialResult, productionResult] = await Promise.all([
    Promise.all(
      weekKeys.map(async (key) => {
        const data = await readJsonObject(makePlannerWeekPath(key));
        return [key, data];
      })
    ),
    fetchLiveTabRows(),
    fetchAnalyticsLiveTabRows(),
    fetchEditorialTabRows(),
    fetchProductionTabRows(),
  ]);

  const weekDataMap = Object.fromEntries(weekDataEntries.filter(([, data]) => data !== null));
  const lifetimeBeatsMap = buildLifetimeBeatsPerPod(weekDataMap);
  const lifetimeScriptsMap = buildLifetimeScriptsPerPod(liveResult.rows, LIFETIME_SINCE);
  const hitRateMap = computeHitRatePerPod(analyticsResult.rows, LIFETIME_SINCE);
  const lwEditorialMap = buildLwEditorialOutputPerPod(editorialResult.rows, productionResult.rows, lastWeekSelection);

  const podRows = [];
  for (const podLeadName of rosterMeta.podOrder) {
    const hitStats = hitRateMap.get(podLeadName) || { totalLive: 0, hits: 0 };
    podRows.push({
      podLeadName,
      lifetimeBeats: lifetimeBeatsMap.get(podLeadName) || 0,
      lifetimeScripts: lifetimeScriptsMap.get(podLeadName) || 0,
      hitRateNumerator: hitStats.hits,
      hitRateDenominator: hitStats.totalLive,
      hitRate: hitStats.totalLive > 0 ? Number(((hitStats.hits / hitStats.totalLive) * 100).toFixed(1)) : null,
      lwEditorialOutput: lwEditorialMap.get(podLeadName) || 0,
      writerCount: Number(rosterMeta.podWriterCounts[podLeadName] || 0),
    });
  }

  return podRows;
}

async function loadWeeklyCompetitionData(rosterMeta, period) {
  const weekSelection = getWeekSelection(period);
  const [liveResult, analyticsResult, editorialResult, productionResult] = await Promise.all([
    fetchLiveTabRows(),
    fetchAnalyticsLiveTabRows(),
    fetchEditorialTabRows(),
    fetchProductionTabRows(),
  ]);

  const scriptsMap = buildScriptsPerPodForWeek(liveResult.rows, weekSelection);
  const hitRateMap = computeHitRatePerPodForWeek(analyticsResult.rows, weekSelection);
  const beatsMap = buildLwEditorialOutputPerPod(editorialResult.rows, productionResult.rows, weekSelection);

  const podRows = [];
  for (const podLeadName of rosterMeta.podOrder) {
    const hitStats = hitRateMap.get(podLeadName) || { totalLive: 0, hits: 0 };
    podRows.push({
      podLeadName,
      lifetimeBeats: beatsMap.get(podLeadName) || 0,
      lifetimeScripts: scriptsMap.get(podLeadName) || 0,
      hitRateNumerator: hitStats.hits,
      hitRateDenominator: hitStats.totalLive,
      hitRate: hitStats.totalLive > 0 ? Number(((hitStats.hits / hitStats.totalLive) * 100).toFixed(1)) : null,
      lwEditorialOutput: beatsMap.get(podLeadName) || 0,
      writerCount: Number(rosterMeta.podWriterCounts[podLeadName] || 0),
    });
  }

  return {
    podRows,
    period,
    weekKey: weekSelection.weekKey,
    weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const rawPeriod = String(url.searchParams.get("period") || "").trim().toLowerCase();
  const hasPeriodFilter = rawPeriod === "last" || rawPeriod === "current" || rawPeriod === "next";
  const period = normalizeWeekView(rawPeriod || "current");

  try {
    const storedConfig = await readJsonObject(CONFIG_PATH);
    const currentConfig = mergeWriterConfig(storedConfig || createDefaultWriterConfig());
    const currentWeekKey = getCurrentWeekKey();
    const storedWeek = await readJsonObject(makePlannerWeekPath(currentWeekKey));
    const weekData = mergeWeekData(currentConfig, storedWeek, currentWeekKey);
    const pods = buildPodsModel(currentConfig, weekData).filter((pod) => isVisiblePlannerPodLeadName(pod?.cl));
    const rosterMeta = buildPodRosterMeta(pods);

    if (hasPeriodFilter) {
      const weekly = await loadWeeklyCompetitionData(rosterMeta, period);
      return NextResponse.json({
        ok: true,
        podRows: weekly.podRows,
        period: weekly.period,
        weekKey: weekly.weekKey,
        weekLabel: weekly.weekLabel,
        selectionMode: "week",
      });
    }

    const podRows = await loadLifetimeCompetitionData(rosterMeta);

    return NextResponse.json({ ok: true, podRows, selectionMode: "lifetime" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load competition data." },
      { status: 500 }
    );
  }
}
