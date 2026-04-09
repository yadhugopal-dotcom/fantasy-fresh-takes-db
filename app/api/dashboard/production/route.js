import { createRequire } from "node:module";
import { NextResponse } from "next/server";
import { buildProductionMetricsFromLiveTab, buildProductionMetricsFromLiveTabRange, fetchEditorialWorkflowRows, fetchLiveTabRows, fetchProductionWorkflowRows, fetchReadyForProductionWorkflowRows, normalizePodLeadName } from "../../../../lib/live-tab.js";
import { buildDateRangeSelection, formatWeekRangeLabel, getWeekSelection, normalizeWeekView } from "../../../../lib/week-view.js";

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

function classifyFtRw(reworkType) {
  const rt = String(reworkType || "").trim().toLowerCase();
  if (!rt) return null;
  if (rt === "fresh take" || rt === "fresh takes" || rt.startsWith("new q1") || rt.startsWith("ft")) return "ft";
  return "rw";
}

function buildPipelineSummary(editorialRows, rfpRows, productionRows, liveAssetCount, { startDate, endDate } = {}) {
  const inRange = (date) => {
    if (!date) return false;
    const d = String(date).slice(0, 10);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  const tally = (rows, dateField) => {
    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!startDate) return true;
      return inRange(row?.[dateField]);
    });
    let ft = 0, rw = 0;
    for (const row of filtered) {
      const type = classifyFtRw(row?.reworkType);
      if (type === "ft") ft++;
      else if (type === "rw") rw++;
    }
    return { total: filtered.length, ft, rw };
  };

  return {
    editorial: tally(editorialRows, "dateAssigned"),
    readyForProd: tally(rfpRows, "etaToStartProd"),
    inProduction: tally(productionRows, "etaToStartProd"),
    live: Number(liveAssetCount || 0),
  };
}

const POD_ORDER = ["Dan", "Josh", "Nishant", "Paul"];

function buildPodBreakdownForPipeline(editorialRows, rfpRows, productionRows, { startDate, endDate } = {}) {
  const podMap = new Map();

  const inRange = (date) => {
    if (!startDate) return true;
    const d = String(date || "").slice(0, 10);
    if (!d) return false;
    if (d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  const getOrCreate = (rawName) => {
    const pod = normalizePodLeadName(rawName) || String(rawName || "").trim();
    if (!pod) return null;
    if (!podMap.has(pod)) {
      podMap.set(pod, {
        podLeadName: pod,
        editorial: { total: 0, ft: 0, rw: 0 },
        readyForProd: { total: 0, ft: 0, rw: 0 },
        production: { total: 0, ft: 0, rw: 0 },
      });
    }
    return podMap.get(pod);
  };

  const inc = (bucket, reworkType) => {
    bucket.total++;
    const type = classifyFtRw(reworkType);
    if (type === "ft") bucket.ft++;
    else if (type === "rw") bucket.rw++;
  };

  for (const row of Array.isArray(editorialRows) ? editorialRows : []) {
    const entry = getOrCreate(row?.podLeadName || row?.podLeadRaw);
    if (!entry) continue;
    inc(entry.editorial, row?.reworkType);
  }

  for (const row of Array.isArray(rfpRows) ? rfpRows : []) {
    if (!inRange(row?.etaToStartProd)) continue;
    const entry = getOrCreate(row?.podLeadName || row?.podLeadRaw);
    if (!entry) continue;
    inc(entry.readyForProd, row?.reworkType);
  }

  for (const row of Array.isArray(productionRows) ? productionRows : []) {
    if (!inRange(row?.etaToStartProd)) continue;
    const pod = normalizePodLeadName(row?.podLeadName || row?.podLeadRaw) || String(row?.podLeadName || "").trim();
    if (!pod) continue;
    if (!podMap.has(pod)) {
      podMap.set(pod, {
        podLeadName: pod,
        editorial: { total: 0, ft: 0, rw: 0 },
        readyForProd: { total: 0, ft: 0, rw: 0 },
        production: { total: 0, ft: 0, rw: 0 },
      });
    }
    inc(podMap.get(pod).production, row?.reworkType);
  }

  return [...podMap.values()].sort((a, b) => {
    const ai = POD_ORDER.indexOf(a.podLeadName);
    const bi = POD_ORDER.indexOf(b.podLeadName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.podLeadName.localeCompare(b.podLeadName);
  });
}

function buildProductionPipelineRows(workflowRows) {
  const podMap = new Map();

  for (const row of Array.isArray(workflowRows) ? workflowRows : []) {
    const pod = normalizePodLeadName(row?.podLeadName || row?.podLeadRaw) || String(row?.podLeadName || "").trim();
    if (!pod) continue;

    if (!podMap.has(pod)) {
      podMap.set(pod, { podLeadName: pod, total: 0, ft: 0, rw: 0, unknown: 0, scripts: [] });
    }
    const entry = podMap.get(pod);
    entry.total += 1;

    const type = classifyFtRw(row?.reworkType);
    if (type === "ft") entry.ft += 1;
    else if (type === "rw") entry.rw += 1;
    else entry.unknown += 1;

    entry.scripts.push({
      showName: String(row?.showName || "").trim(),
      beatName: String(row?.beatName || "").trim(),
      writerName: String(row?.writerName || "").trim(),
      reworkType: String(row?.reworkType || "").trim(),
      status: String(row?.status || "").trim(),
      etaToStartProd: row?.etaToStartProd || "",
      assetCode: String(row?.assetCode || "").trim(),
    });
  }

  return [...podMap.values()]
    .sort((a, b) => {
      const ai = POD_ORDER.indexOf(a.podLeadName);
      const bi = POD_ORDER.indexOf(b.podLeadName);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.podLeadName.localeCompare(b.podLeadName);
    })
    .map((pod) => ({ ...pod, scripts: pod.scripts }));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const period = normalizeWeekView(url.searchParams.get("period"));
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const rangeSelection = buildDateRangeSelection({ startDate, endDate, period });
  const useExplicitRange = Boolean(startDate || endDate);
  const weekSelection = useExplicitRange ? rangeSelection : getWeekSelection(period);

  try {
    if (!useExplicitRange && period === "next") {
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
        pipelineRows: [],
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

    const [liveTabResult, acdRowsResult, acdSyncRowsResult, workflowResult, editorialResult, rfpResult] = await Promise.allSettled([
      fetchLiveTabRows(),
      fetchAcdProductivityRows(),
      fetchAcdLiveSyncRows(),
      fetchProductionWorkflowRows(),
      fetchEditorialWorkflowRows(),
      fetchReadyForProductionWorkflowRows(),
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
      productionMetrics = useExplicitRange
        ? buildProductionMetricsFromLiveTabRange(liveTabResult.value.rows, rangeSelection.startDate, rangeSelection.endDate)
        : buildProductionMetricsFromLiveTab(liveTabResult.value.rows, period);
    } else {
      liveTabError = liveTabResult.reason?.message || "Unable to load Live-tab production metrics.";
    }

    if (acdError && liveTabError) {
      throw new Error("Unable to load Production dashboard data.");
    }

    const prodWorkflowRows = workflowResult.status === "fulfilled" ? (workflowResult.value?.rows || []) : [];
    const editorialWorkflowRows = editorialResult.status === "fulfilled" ? (editorialResult.value?.rows || []) : [];
    const rfpWorkflowRows = rfpResult.status === "fulfilled" ? (rfpResult.value?.rows || []) : [];
    const dateOpts = { startDate: useExplicitRange ? rangeSelection.startDate : weekSelection.weekStart, endDate: useExplicitRange ? rangeSelection.endDate : weekSelection.weekEnd };
    const pipelineRows = buildProductionPipelineRows(prodWorkflowRows);
    const pipelineSummary = buildPipelineSummary(editorialWorkflowRows, rfpWorkflowRows, prodWorkflowRows, productionMetrics.productionTeamOutput?.liveAssetCount, dateOpts);
    const podBreakdownRows = buildPodBreakdownForPipeline(editorialWorkflowRows, rfpWorkflowRows, prodWorkflowRows);

    return NextResponse.json({
      ok: true,
      period: useExplicitRange ? "range" : period,
      selectionMode: useExplicitRange ? "date-range" : "week",
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
      pipelineRows,
      pipelineSummary,
      podBreakdownRows,
      productionTeamOutput: productionMetrics.productionTeamOutput,
      tatSummary: productionMetrics.tatSummary,
      tatRows: productionMetrics.tatRows,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      error: error.message || "Unable to load Production dashboard.",
      period: useExplicitRange ? "range" : period,
      selectionMode: useExplicitRange ? "date-range" : "week",
      weekStart: weekSelection.weekStart,
      weekEnd: weekSelection.weekEnd,
      weekLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
      sourceFilterWarning: "",
      acdError: "ACD source unavailable.",
      liveTabError: "Live-tab source unavailable.",
      hasLiveData: false,
      hasWeekData: false,
      emptyStateMessage: "Production data is temporarily unavailable. Please verify sheet and backend access.",
      acdChartRows: [],
      acdPairRows: [],
      pipelineRows: [],
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
}
