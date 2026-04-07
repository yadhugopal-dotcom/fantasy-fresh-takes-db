import { createRequire } from "node:module";
import { NextResponse } from "next/server";
import { buildProductionMetricsFromLiveTab, fetchLiveTabRows } from "../../../../lib/live-tab.js";
import { formatWeekRangeLabel, getWeekSelection, normalizeWeekView } from "../../../../lib/week-view.js";

const require = createRequire(import.meta.url);
const {
  aggregateAcdFromRecords,
  convertImagesToMinutes,
  normalizeAcdName,
  normalizeAssetId,
  normalizeCdName,
  normalizeUrl,
  round4,
  supabaseFetchAll,
} = require("../../../../lib/ops/cjs/_lib.cjs");

const LIVE_TAB_DATA_SOURCE = "live_tab_sync";
const LIVE_SYNC_CUTOFF_DATE = "2026-03-10";

function isMissingDataSourceColumnError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("data_source") && (message.includes("column") || message.includes("does not exist"));
}

function filterRowsFromLiveSyncCutoff(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const createdDate = String(row && row.created_at ? row.created_at : "").slice(0, 10);
    return Boolean(createdDate) && createdDate >= LIVE_SYNC_CUTOFF_DATE;
  });
}

async function fetchAcdProductivityRows() {
  try {
    const rows = await supabaseFetchAll(
      `acd_productivity?select=*&data_source=eq.${encodeURIComponent(LIVE_TAB_DATA_SOURCE)}`
    );
    return {
      rows: Array.isArray(rows) ? rows : [],
      sourceFilterWarning: "",
    };
  } catch (error) {
    if (!isMissingDataSourceColumnError(error)) {
      throw error;
    }

    const fallbackRows = await supabaseFetchAll("acd_productivity?select=*");
    return {
      rows: filterRowsFromLiveSyncCutoff(fallbackRows),
      sourceFilterWarning:
        "data_source column is missing; using created_at fallback until migration 2026-03-11-acd-data-source.sql is applied.",
    };
  }
}

async function fetchAcdLiveSyncRows() {
  const rows = await supabaseFetchAll(
    `acd_live_sync_rows?select=live_date,asset_code,base_asset_code,cd_name,eligible,successful_links&live_date=gte.${encodeURIComponent(
      LIVE_SYNC_CUTOFF_DATE
    )}`
  );
  return Array.isArray(rows) ? rows : [];
}

function getScopeKey(row) {
  return normalizeAssetId(row.base_asset_code || row.parent_asset_id) || normalizeAssetId(row.asset_code || row.video_code);
}

function buildAcdMetricsForWeek(syncRows, acdRows, weekSelection) {
  const assetScopeMap = new Map();

  for (const row of Array.isArray(syncRows) ? syncRows : []) {
    const liveDate = String(row.live_date || "").slice(0, 10);
    if (!liveDate || liveDate < weekSelection.weekStart || liveDate > weekSelection.weekEnd) {
      continue;
    }

    if (row.eligible === false || Number(row.successful_links || 0) <= 0) {
      continue;
    }

    const scopeKey =
      normalizeAssetId(row.base_asset_code) || normalizeAssetId(row.asset_code);
    if (!scopeKey) {
      continue;
    }

    const nextValue = {
      scopeKey,
      liveDate,
      assetCode: normalizeAssetId(row.asset_code) || scopeKey,
      cdName: normalizeCdName(row.cd_name) || "Unknown",
    };

    const currentValue = assetScopeMap.get(scopeKey);
    if (!currentValue || liveDate > currentValue.liveDate) {
      assetScopeMap.set(scopeKey, nextValue);
    }
  }

  const seenImages = new Set();
  const perAssetAcdMap = new Map();

  for (const row of Array.isArray(acdRows) ? acdRows : []) {
    const scopeKey = getScopeKey(row);
    if (!scopeKey || !assetScopeMap.has(scopeKey)) {
      continue;
    }

    const acdName = normalizeAcdName(row.normalized_acd_name || row.acd_name || row.raw_acd_name);
    const imageUrl = normalizeUrl(row.image_url);
    if (!acdName || !imageUrl) {
      continue;
    }

    const imageKey = `${scopeKey}|${String(acdName).toLowerCase()}|${String(imageUrl).toLowerCase()}`;
    if (seenImages.has(imageKey)) {
      continue;
    }
    seenImages.add(imageKey);

    const assetInfo = assetScopeMap.get(scopeKey);
    const assetAcdKey = `${scopeKey}|${String(acdName).toLowerCase()}`;
    if (!perAssetAcdMap.has(assetAcdKey)) {
      perAssetAcdMap.set(assetAcdKey, {
        assetCode: assetInfo.assetCode,
        cdName: assetInfo.cdName,
        acdName,
        liveDate: assetInfo.liveDate,
        imageCount: 0,
      });
    }

    perAssetAcdMap.get(assetAcdKey).imageCount += 1;
  }

  const chartMap = new Map();
  const pairMap = new Map();

  for (const row of perAssetAcdMap.values()) {
    const minutes = convertImagesToMinutes(row.imageCount);

    if (!chartMap.has(row.acdName)) {
      chartMap.set(row.acdName, {
        acdName: row.acdName,
        totalMinutes: 0,
        totalImages: 0,
        assetCount: 0,
      });
    }

    const chartTarget = chartMap.get(row.acdName);
    chartTarget.totalMinutes += minutes;
    chartTarget.totalImages += row.imageCount;
    chartTarget.assetCount += 1;

    const pairKey = `${row.cdName}|${row.acdName}`;
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        cdName: row.cdName,
        acdName: row.acdName,
        totalMinutes: 0,
        totalImages: 0,
        assetCount: 0,
      });
    }

    const pairTarget = pairMap.get(pairKey);
    pairTarget.totalMinutes += minutes;
    pairTarget.totalImages += row.imageCount;
    pairTarget.assetCount += 1;
  }

  const acdChartRows = Array.from(chartMap.values())
    .map((row) => ({
      acdName: row.acdName,
      totalMinutes: round4(row.totalMinutes),
      totalImages: row.totalImages,
      assetCount: row.assetCount,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.acdName.localeCompare(b.acdName));

  const acdPairRows = Array.from(pairMap.values())
    .map((row) => ({
      cdName: row.cdName,
      acdName: row.acdName,
      totalMinutes: round4(row.totalMinutes),
      totalImages: row.totalImages,
      assetCount: row.assetCount,
    }))
    .sort(
      (a, b) =>
        b.totalMinutes - a.totalMinutes ||
        a.cdName.localeCompare(b.cdName) ||
        a.acdName.localeCompare(b.acdName)
    );

  return { acdChartRows, acdPairRows };
}

function buildAcdFallbackMetrics(acdRows, weekSelection) {
  const aggregated = aggregateAcdFromRecords(acdRows || []);
  const chartMap = new Map();
  const pairMap = new Map();

  for (const row of aggregated.dailyRows || []) {
    if (!row.workDate || row.workDate < weekSelection.weekStart || row.workDate > weekSelection.weekEnd) {
      continue;
    }

    if (!chartMap.has(row.acdName)) {
      chartMap.set(row.acdName, {
        acdName: row.acdName,
        totalMinutes: 0,
        totalImages: 0,
        assetCount: 0,
      });
    }

    const chartTarget = chartMap.get(row.acdName);
    chartTarget.totalMinutes += Number(row.totalMinutes || 0);
    chartTarget.totalImages += Number(row.totalImages || 0);

    const pairKey = `${row.cdName}|${row.acdName}`;
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        cdName: row.cdName,
        acdName: row.acdName,
        totalMinutes: 0,
        totalImages: 0,
        assetCount: 0,
      });
    }

    const pairTarget = pairMap.get(pairKey);
    pairTarget.totalMinutes += Number(row.totalMinutes || 0);
    pairTarget.totalImages += Number(row.totalImages || 0);
  }

  return {
    acdChartRows: Array.from(chartMap.values())
      .map((row) => ({
        ...row,
        totalMinutes: round4(row.totalMinutes),
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes || a.acdName.localeCompare(b.acdName)),
    acdPairRows: Array.from(pairMap.values())
      .map((row) => ({
        ...row,
        totalMinutes: round4(row.totalMinutes),
      }))
      .sort(
        (a, b) =>
          b.totalMinutes - a.totalMinutes ||
          a.cdName.localeCompare(b.cdName) ||
          a.acdName.localeCompare(b.acdName)
      ),
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const period = normalizeWeekView(new URL(request.url).searchParams.get("period"));
  const weekSelection = getWeekSelection(period);

  try {
    if (period === "next") {
      return NextResponse.json({
        ok: true,
        period,
        weekStart: weekSelection.weekStart,
        weekEnd: weekSelection.weekEnd,
        weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
        sourceFilterWarning: "",
        acdError: "",
        liveTabError: "",
        hasLiveData: false,
        hasWeekData: false,
        emptyStateMessage: "Next week production release metrics will populate from the Live tab after assets are released.",
        acdChartRows: [],
        acdPairRows: [],
        productionTeamOutput: { liveAssetCount: null },
        tatSummary: {
          averageTatDays: null,
          medianTatDays: null,
          eligibleAssetCount: 0,
          skippedMissingTatDates: 0,
          skippedInvalidTatRows: 0,
          targetTatDays: 1,
        },
        tatRows: [],
      });
    }

    const [liveTabResult, acdRowsResult, acdSyncRowsResult] = await Promise.allSettled([
      fetchLiveTabRows(),
      fetchAcdProductivityRows(),
      fetchAcdLiveSyncRows(),
    ]);

    let sourceFilterWarning = "";
    let acdError = "";
    let acdChartRows = [];
    let acdPairRows = [];

    if (acdRowsResult.status === "fulfilled" && acdSyncRowsResult.status === "fulfilled") {
      sourceFilterWarning = acdRowsResult.value.sourceFilterWarning || "";
      let acdMetrics = buildAcdMetricsForWeek(
        acdSyncRowsResult.value,
        acdRowsResult.value.rows || [],
        weekSelection
      );
      if (acdMetrics.acdChartRows.length === 0 && acdMetrics.acdPairRows.length === 0) {
        acdMetrics = buildAcdFallbackMetrics(acdRowsResult.value.rows || [], weekSelection);
      }
      acdChartRows = acdMetrics.acdChartRows;
      acdPairRows = acdMetrics.acdPairRows;
    } else {
      acdError =
        (acdRowsResult.status === "rejected" ? acdRowsResult.reason?.message : "") ||
        (acdSyncRowsResult.status === "rejected" ? acdSyncRowsResult.reason?.message : "") ||
        "Unable to load ACD productivity details.";
    }

    let liveTabError = "";
    let productionMetrics = {
      weekStart: weekSelection.weekStart,
      weekEnd: weekSelection.weekEnd,
      weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
      hasLiveData: false,
      hasWeekData: false,
      emptyStateMessage: "No usable Live-tab rows with a release date are available yet.",
      productionTeamOutput: { liveAssetCount: null },
      tatSummary: {
        averageTatDays: null,
        medianTatDays: null,
        eligibleAssetCount: 0,
        skippedMissingTatDates: 0,
        skippedInvalidTatRows: 0,
        targetTatDays: 1,
      },
      tatRows: [],
    };

    if (liveTabResult.status === "fulfilled") {
      productionMetrics = buildProductionMetricsFromLiveTab(liveTabResult.value.rows, period);
    } else {
      liveTabError = liveTabResult.reason?.message || "Unable to load Live-tab production metrics.";
    }

    if (acdError && liveTabError) {
      throw new Error("Unable to load Production dashboard data.");
    }

    return NextResponse.json({
      ok: true,
      period,
      weekStart: productionMetrics.weekStart,
      weekEnd: productionMetrics.weekEnd,
      weekLabel: productionMetrics.weekLabel,
      sourceFilterWarning,
      acdError,
      liveTabError,
      hasLiveData: productionMetrics.hasLiveData,
      hasWeekData: productionMetrics.hasWeekData,
      emptyStateMessage: productionMetrics.emptyStateMessage,
      acdChartRows,
      acdPairRows,
      productionTeamOutput: productionMetrics.productionTeamOutput,
      tatSummary: productionMetrics.tatSummary,
      tatRows: productionMetrics.tatRows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load Production dashboard." },
      { status: error.statusCode || 500 }
    );
  }
}
