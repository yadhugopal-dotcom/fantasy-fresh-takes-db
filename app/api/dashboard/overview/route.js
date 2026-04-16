import { NextResponse } from "next/server";
import { readJsonObject } from "../../../../lib/storage.js";
import {
  GOOD_TO_GO_BEATS_TARGET,
  TARGET_FLOOR,
  buildGoodToGoBeatsMetricsFromIdeationTab,
  buildReleasedFreshTakeAttemptsForPeriod,
  buildReleasedFreshTakeAttemptsForRange,
  buildTatSummaryFromRows,
  fetchAnalyticsLiveTabRows,
  fetchEditorialWorkflowRows,
  fetchIdeationTabRows,
  fetchLiveTabRows,
  fetchProductionWorkflowRows,
  fetchReadyForProductionWorkflowRows,
  isAnalyticsEligibleProductionType,
  isFreshTakesLabel,
  normalizePodLeadName,
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
import { buildDateRangeSelection, formatWeekRangeLabel, getWeekSelection, getWeekWindowFromReference, normalizeWeekView } from "../../../../lib/week-view.js";

const CONFIG_PATH = "config/writer-config.json";
export const runtime = "nodejs";
export const maxDuration = 120;
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

function countFreshTakesInProduction(productionRows, startDate, endDate) {
  return (Array.isArray(productionRows) ? productionRows : []).filter((row) => {
    const eta = String(row?.etaToStartProd || "").slice(0, 10);
    if (!eta) return false;
    if (startDate && eta < startDate) return false;
    if (endDate && eta > endDate) return false;
    return true;
  }).length;
}

const BREAKDOWN_POD_ORDER = ["Dan", "Josh", "Nishant", "Paul"];

function classifyFtRw(reworkType) {
  const rt = String(reworkType || "").trim().toLowerCase();
  if (!rt) return null; // unknown — don't count in either bucket
  if (rt === "fresh take" || rt === "fresh takes" || rt.startsWith("new q1") || rt.startsWith("ft")) return "ft";
  return "rw";
}

function buildPodBreakdownRows(editorialRows, rfpRows, productionRows, { startDate, endDate, liveRows = [] } = {}) {
  const podMap = new Map();

  const getOrCreate = (rawName) => {
    const pod = normalizePodLeadName(rawName);
    if (!pod) return null;
    if (!podMap.has(pod)) {
      podMap.set(pod, {
        podLeadName: pod,
        editorial: { ft: 0, rw: 0 },
        readyForProd: { ft: 0, rw: 0 },
        production: { ft: 0, rw: 0 },
        productionPipeline: { ft: 0, rw: 0 },
        live: { ft: 0, rw: 0 },
      });
    }
    return podMap.get(pod);
  };

  const inc = (bucket, type) => {
    if (type === "ft") bucket.ft++;
    else if (type === "rw") bucket.rw++;
  };

  const inRange = (date) => {
    if (!date) return false;
    const d = String(date).slice(0, 10);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  // Editorial: no date filter — always show full pipeline state
  for (const row of Array.isArray(editorialRows) ? editorialRows : []) {
    const entry = getOrCreate(row?.podLeadName || row?.podLeadRaw);
    if (!entry) continue;
    inc(entry.editorial, classifyFtRw(row?.reworkType));
  }

  // RFP: filter by etaToStartProd if dates provided
  for (const row of Array.isArray(rfpRows) ? rfpRows : []) {
    if (startDate && !inRange(row?.etaToStartProd)) continue;
    const entry = getOrCreate(row?.podLeadName || row?.podLeadRaw);
    if (!entry) continue;
    inc(entry.readyForProd, classifyFtRw(row?.reworkType));
  }

  // Production: always populate the map from editorial/rfp first, then count production
  // productionPipeline = all items (no date filter), production = date-filtered throughput
  for (const row of Array.isArray(productionRows) ? productionRows : []) {
    const pod = normalizePodLeadName(row?.podLeadName || row?.podLeadRaw);
    if (!pod) continue;
    // Ensure pod entry exists (even if not in editorial/rfp)
    if (!podMap.has(pod)) {
      podMap.set(pod, {
        podLeadName: pod,
        editorial: { ft: 0, rw: 0 },
        readyForProd: { ft: 0, rw: 0 },
        production: { ft: 0, rw: 0 },
        productionPipeline: { ft: 0, rw: 0 },
        live: { ft: 0, rw: 0 },
      });
    }
    const entry = podMap.get(pod);
    const type = classifyFtRw(row?.reworkType);
    // Pipeline: all items
    inc(entry.productionPipeline, type);
    // Throughput: date-filtered
    if (!startDate || inRange(row?.etaToStartProd)) {
      inc(entry.production, type);
    }
  }

  // Live: filter by liveDate (Final Upload Date) within the date range
  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    const liveDateStr = String(row?.liveDate || row?.uploadDate || "").slice(0, 10);
    if (!liveDateStr) continue;
    if (startDate && liveDateStr < startDate) continue;
    if (endDate && liveDateStr > endDate) continue;
    const entry = getOrCreate(row?.podLeadName || row?.podLeadRaw);
    if (!entry) continue;
    inc(entry.live, classifyFtRw(row?.reworkType));
  }

  return [...podMap.values()].sort((a, b) => {
    const ai = BREAKDOWN_POD_ORDER.indexOf(a.podLeadName);
    const bi = BREAKDOWN_POD_ORDER.indexOf(b.podLeadName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.podLeadName.localeCompare(b.podLeadName);
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function makeBeatKey(showName, beatName) {
  const show = normalizeKey(showName);
  const beat = normalizeKey(beatName);
  return show && beat ? `${show}|${beat}` : "";
}

// Fuzzy beat name: strips leading articles, trailing version suffixes, punctuation
// "The Thor" ≈ "Thor", "Phoenix v2" ≈ "Phoenix", "Spider-Man" ≈ "Spider Man"
function fuzzyBeatNormalize(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+v\d+(\.\d+)?$/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Fuzzy show name: strips subtitles after ":" or "–" so
// "My Vampire System: A Dragon's Revenge" ≈ "My Vampire System"
function fuzzyShowNormalize(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s*[:\u2013\u2014]\s*.*$/, "")  // strip subtitle after : – —
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeFuzzyBeatKey(showName, beatName) {
  const show = fuzzyShowNormalize(showName);
  const beat = fuzzyBeatNormalize(beatName);
  return beat ? `${show}|${beat}` : "";
}

// FT = Fresh Take / new q1, RW_L = large rework, RW_S = small rework, RW = other
function classifyScriptType(reworkType) {
  const rt = String(reworkType || "").trim().toLowerCase();
  if (rt === "fresh take" || rt === "fresh takes" || rt.startsWith("new q1")) return "FT";
  if (rt.includes("large")) return "RW_L";
  if (rt.includes("small")) return "RW_S";
  return "RW";
}

function isApprovedIdeationStatus(statusLabel) {
  const status = normalizeKey(statusLabel);
  return status === "gtg" || status === "gtg - minor changes" || status === "approved";
}

function getAssetTypeFromAssetCode(assetCode) {
  const code = normalizeText(assetCode).toUpperCase();
  if (code.startsWith("GA")) return "GA";
  if (code.startsWith("GI")) return "GI";
  if (code.startsWith("GU")) return "GU";
  return "OTHER";
}

function getLatestAssetStage(asset) {
  const days = Array.isArray(asset?.days) ? asset.days : [];
  for (let idx = days.length - 1; idx >= 0; idx -= 1) {
    const stage = normalizeKey(days[idx]);
    if (stage) return stage;
  }
  return "";
}

function buildPodThroughputForRange(liveRows, ideationRows, startDate, endDate) {
  // Two-tier ideation lookup:
  // 1. Full key (show|beat) — most precise
  // 2. Beat-only key — fallback when show names differ across sheets (e.g. "MVS" vs "My Vampire System: A Dragon's Revenge")
  const ideationFullKeys = new Set();
  const ideationBeatOnlyKeys = new Set();
  for (const row of Array.isArray(ideationRows) ? ideationRows : []) {
    const fullKey = makeFuzzyBeatKey(row?.showName, row?.beatName);
    const beatOnly = fuzzyBeatNormalize(row?.beatName || "");
    if (fullKey) ideationFullKeys.add(fullKey);
    if (beatOnly) ideationBeatOnlyKeys.add(beatOnly);
  }

  // Filter live rows: date range + GA only (Q1 manual + thumbnail)
  const filtered = (Array.isArray(liveRows) ? liveRows : []).filter((row) => {
    const liveDate = String(row?.liveDate || "").slice(0, 10);
    if (!liveDate || liveDate < startDate || liveDate > endDate) return false;
    return getAssetTypeFromAssetCode(row?.assetCode) === "GA";
  });

  // Group by pod → writer → beat, tracking FT/RW type counts
  const podMap = new Map();
  const ensurePod = (name) => {
    const pod = normalizeText(name) || "Unknown POD";
    if (!podMap.has(pod)) {
      podMap.set(pod, { podLeadName: pod, totalScripts: 0, ftCount: 0, rwCount: 0, writers: new Map(), beats: new Map() });
    }
    return podMap.get(pod);
  };
  const ensureWriter = (pod, name) => {
    const writer = normalizeText(name) || "Unknown Writer";
    if (!pod.writers.has(writer)) {
      pod.writers.set(writer, { writerName: writer, totalScripts: 0, ftCount: 0, rwCount: 0 });
    }
    return pod.writers.get(writer);
  };

  for (const row of filtered) {
    const pod = ensurePod(row?.podLeadName);
    pod.totalScripts += 1;
    const writer = ensureWriter(pod, row?.writerName);
    writer.totalScripts += 1;

    const scriptType = classifyScriptType(row?.reworkType);
    if (scriptType === "FT") { pod.ftCount += 1; writer.ftCount += 1; }
    else { pod.rwCount += 1; writer.rwCount += 1; }

    const beatName = normalizeText(row?.beatName) || "Unknown Beat";
    const showName = normalizeText(row?.showName) || "";
    const fuzzyKey = makeFuzzyBeatKey(showName, beatName);
    const beatOnlyKey = fuzzyBeatNormalize(beatName);
    const inIdeation = Boolean(
      (fuzzyKey && ideationFullKeys.has(fuzzyKey)) ||
      (beatOnlyKey && ideationBeatOnlyKeys.has(beatOnlyKey))
    );

    const beatMapKey = fuzzyKey || normalizeKey(beatName);
    if (!pod.beats.has(beatMapKey)) {
      pod.beats.set(beatMapKey, {
        beatName, showName,
        scriptCount: 0, ftCount: 0, rwLargeCount: 0, rwSmallCount: 0, rwOtherCount: 0,
        inIdeation,
      });
    }
    const beat = pod.beats.get(beatMapKey);
    beat.scriptCount += 1;
    if (scriptType === "FT") beat.ftCount += 1;
    else if (scriptType === "RW_L") beat.rwLargeCount += 1;
    else if (scriptType === "RW_S") beat.rwSmallCount += 1;
    else beat.rwOtherCount += 1;
  }

  return Array.from(podMap.values())
    .sort((a, b) => b.totalScripts - a.totalScripts || a.podLeadName.localeCompare(b.podLeadName))
    .map((pod) => ({
      podLeadName: pod.podLeadName,
      totalScripts: pod.totalScripts,
      ftCount: pod.ftCount,
      rwCount: pod.rwCount,
      writerRows: Array.from(pod.writers.values()).sort((a, b) => b.totalScripts - a.totalScripts || a.writerName.localeCompare(b.writerName)),
      beats: Array.from(pod.beats.values()).sort((a, b) => {
        if (a.inIdeation !== b.inIdeation) return a.inIdeation ? 1 : -1;
        return b.scriptCount - a.scriptCount;
      }),
    }));
}

function buildCurrentEditorialPodRows(plannerState, liveRows, ideationRows) {
  const approvedBeatKeys = new Set(
    (Array.isArray(ideationRows) ? ideationRows : [])
      .filter((row) => isApprovedIdeationStatus(row?.status || row?.beatsStatus))
      .map((row) => makeBeatKey(row?.showName, row?.beatName))
      .filter(Boolean)
  );

  const lwRows = buildReleasedFreshTakeAttemptsForPeriod(liveRows, "last").filter((row) => {
    if (!isFreshTakesLabel(row?.reworkType) && normalizeKey(row?.reworkType) !== "new q1") return false;
    if (getAssetTypeFromAssetCode(row?.assetCode) !== "GA") return false;
    const beatKey = makeBeatKey(row?.showName, row?.beatName);
    return beatKey && approvedBeatKeys.has(beatKey);
  });

  const podMap = new Map();
  const resolveReadinessStage = ({ wipCount = 0, reviewWithClCount = 0, onTrackCount = 0 } = {}) => {
    const pairs = [
      ["WIP", Number(wipCount || 0)],
      ["Review with CL", Number(reviewWithClCount || 0)],
      ["On Track", Number(onTrackCount || 0)],
    ].sort((a, b) => b[1] - a[1]);
    if ((pairs[0]?.[1] || 0) <= 0) return "No stage yet";
    return pairs[0][0];
  };
  const ensurePod = (podLeadName) => {
    const podName = normalizeText(podLeadName) || "Unknown POD";
    if (!podMap.has(podName)) {
      podMap.set(podName, {
        podLeadName: podName,
        lwProductionCount: 0,
        thisWeekBeatsCount: 0,
        wipCount: 0,
        reviewWithClCount: 0,
        onTrackCount: 0,
        readinessStage: "No stage yet",
        thuStatusMessage: "Needs Thursday update",
        writerRows: [],
      });
    }
    return podMap.get(podName);
  };

  const writerMap = new Map();
  const ensureWriter = (podLeadName, writerName) => {
    const podName = normalizeText(podLeadName) || "Unknown POD";
    const safeWriter = normalizeText(writerName) || "Unknown writer";
    const key = `${normalizeKey(podName)}|${normalizeKey(safeWriter)}`;
    if (!writerMap.has(key)) {
      writerMap.set(key, {
        podLeadName: podName,
        writerName: safeWriter,
        lwProductionCount: 0,
        thisWeekBeatsCount: 0,
        wipCount: 0,
        reviewWithClCount: 0,
        onTrackCount: 0,
        readinessStage: "No stage yet",
      });
    }
    return writerMap.get(key);
  };

  for (const row of lwRows) {
    const pod = ensurePod(row?.podLeadName);
    const writer = ensureWriter(row?.podLeadName, row?.writerName);
    pod.lwProductionCount += 1;
    writer.lwProductionCount += 1;
  }

  const pods = Array.isArray(plannerState?.pods) ? plannerState.pods : [];
  for (const pod of pods) {
    const podName = normalizeText(pod?.cl);
    const podEntry = ensurePod(podName);
    let submittedByThu = 0;

    for (const writer of Array.isArray(pod?.writers) ? pod.writers : []) {
      const writerEntry = ensureWriter(podName, writer?.name);
      for (const beat of Array.isArray(writer?.beats) ? writer.beats : []) {
        writerEntry.thisWeekBeatsCount += 1;
        podEntry.thisWeekBeatsCount += 1;

        let beatHasSubmittedByThu = false;
        let bestStageRank = -1;
        let bestStageKey = "";
        for (const asset of Array.isArray(beat?.assets) ? beat.assets : []) {
          const latestStage = getLatestAssetStage(asset);
          const rank =
            latestStage.includes("live") ? 4 :
            latestStage.includes("production") ? 3 :
            latestStage.includes("cl") ? 2 :
            latestStage.includes("write") || latestStage.includes("ideation") ? 1 : 0;
          if (rank > bestStageRank) {
            bestStageRank = rank;
            bestStageKey = latestStage;
          }

          const days = Array.isArray(asset?.days) ? asset.days : [];
          const reachedByThu = days.slice(0, 4).some((value) => {
            const stage = normalizeKey(value);
            return stage.includes("production") || stage.includes("live");
          });
          if (reachedByThu) {
            beatHasSubmittedByThu = true;
          }
        }

        if (beatHasSubmittedByThu) {
          submittedByThu += 1;
        }

        if (bestStageKey.includes("production") || bestStageKey.includes("live")) {
          podEntry.onTrackCount += 1;
          writerEntry.onTrackCount += 1;
        } else if (bestStageKey.includes("cl")) {
          podEntry.reviewWithClCount += 1;
          writerEntry.reviewWithClCount += 1;
        } else {
          podEntry.wipCount += 1;
          writerEntry.wipCount += 1;
        }
      }
    }

    podEntry.thuStatusMessage = submittedByThu > 0 ? "Thu update sent" : "Needs Thursday update";
  }

  for (const writer of writerMap.values()) {
    const pod = ensurePod(writer.podLeadName);
    pod.writerRows.push(writer);
  }

  for (const pod of podMap.values()) {
    pod.readinessStage = resolveReadinessStage(pod);
    pod.writerRows.sort(
      (a, b) =>
        b.lwProductionCount - a.lwProductionCount ||
        b.onTrackCount - a.onTrackCount ||
        a.writerName.localeCompare(b.writerName)
    );
    pod.writerRows = pod.writerRows.map((writer) => ({
      ...writer,
      readinessStage: resolveReadinessStage(writer),
    }));
  }

  return Array.from(podMap.values()).sort(
    (a, b) =>
      b.lwProductionCount - a.lwProductionCount ||
      b.onTrackCount - a.onTrackCount ||
      a.podLeadName.localeCompare(b.podLeadName)
  );
}

function buildCurrentWeekPayload(plannerState, { liveRows = [], ideationRows = [], productionRows = [], ideationSourceError = "" } = {}) {
  const timing = buildPlannerTimingSummary(plannerState.plannerBeats);
  const allProductionAssetCount = countAllAssetsWithStage(plannerState.pods, "production");
  const allLiveOnMetaAssetCount = countAllAssetsWithStage(plannerState.pods, "live_on_meta");
  const activeWriterCount = countActiveWritersInPods(plannerState.pods);
  const submittedByThursday = countAssetsSubmittedByDay(plannerState.pods, 3);
  const podThroughputRows = buildPodThroughputForRange(
    liveRows,
    ideationRows,
    plannerState.weekSelection.weekStart,
    plannerState.weekSelection.weekEnd
  );
  const editorialPodRows = buildCurrentEditorialPodRows(plannerState, liveRows, ideationRows);

  // Previous period comparison: use last week's actual releases as baseline
  const lwFreshTakeRows = buildReleasedFreshTakeAttemptsForPeriod(liveRows, "last");
  const prevFreshTakeCount = lwFreshTakeRows.length;
  const freshTakeInProductionCount = countFreshTakesInProduction(
    productionRows,
    plannerState.weekSelection.weekStart,
    plannerState.weekSelection.weekEnd
  );

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
    freshTakeInProductionCount,
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
    podThroughputRows,
    editorialPodRows,
    prevFreshTakeCount,
    ideationSourceError,
  };
}

function buildNextWeekPayload(plannerState, ideationRows, productionRows, { ideationSourceError = "", prevFreshTakeCount = null } = {}) {
  const gtgMetrics = buildGoodToGoBeatsMetricsFromIdeationTab(ideationRows, "next", {
    sourceWeekOffsetWeeks: -1,
  });
  const timing = buildPlannerTimingSummary(plannerState.plannerBeats);
  const allLiveOnMetaAssetCount = countAllAssetsWithStage(plannerState.pods, "live_on_meta");
  const allProductionAssetCount = countAllAssetsWithStage(plannerState.pods, "production");
  const activeWriterCount = countActiveWritersInPods(plannerState.pods);
  const plannedReleaseCount = allLiveOnMetaAssetCount;
  const freshTakeInProductionCount = countFreshTakesInProduction(
    productionRows,
    plannerState.weekSelection.weekStart,
    plannerState.weekSelection.weekEnd
  );

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
    freshTakeInProductionCount,
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
    prevFreshTakeCount,
    ideationSourceError,
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

function buildHitRateAndFunnelForSelection(analyticsRows, selection, { includeNewShowsPod = false } = {}) {
  const selectionStart = selection?.startDate || selection?.weekStart || "";
  const selectionEnd = selection?.endDate || selection?.weekEnd || selectionStart;

  const weekFiltered = (Array.isArray(analyticsRows) ? analyticsRows : []).filter((row) => {
    if (!row?.liveDate) return false;
    if (row.liveDate < selectionStart || row.liveDate > selectionEnd) return false;
    if (!includeNewShowsPod && isNonBauPodLeadName(row?.podLeadName)) return false;
    return true;
  });

  const dedupMap = new Map();
  for (const row of weekFiltered) {
    const key = String(row?.assetCode || "").trim().toLowerCase();
    if (!key) continue;
    if (!dedupMap.has(key) || isBetterAttemptRow(row, dedupMap.get(key))) {
      dedupMap.set(key, row);
    }
  }

  const dedupedRows = Array.from(dedupMap.values());
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

function buildLastWeekPayload(liveRows, analyticsRows, ideationRows, productionRows, { includeNewShowsPod = false } = {}) {
  const weekSelection = getWeekSelection("last");
  const weekLabel = formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd);
  const allFreshTakeRows = buildReleasedFreshTakeAttemptsForPeriod(liveRows, "last");
  const freshTakeRows = includeNewShowsPod
    ? allFreshTakeRows
    : allFreshTakeRows.filter((row) => !isNonBauPodLeadName(row?.podLeadName));
  const tatSummary = buildTatSummaryFromRows(freshTakeRows);
  const hitRateData = buildHitRateAndFunnelForSelection(analyticsRows, weekSelection, { includeNewShowsPod });
  const podThroughputRows = buildPodThroughputForRange(liveRows, ideationRows, weekSelection.weekStart, weekSelection.weekEnd);

  // Previous week comparison (week before last)
  const prevWeekStart = addDays(weekSelection.weekStart, -7);
  const prevWeekEnd = addDays(weekSelection.weekEnd, -7);
  const allPrevFreshTakeRows = buildReleasedFreshTakeAttemptsForRange(liveRows, prevWeekStart, prevWeekEnd);
  const prevFreshTakeCount = (includeNewShowsPod
    ? allPrevFreshTakeRows
    : allPrevFreshTakeRows.filter((r) => !isNonBauPodLeadName(r?.podLeadName))
  ).length;
  const freshTakeInProductionCount = countFreshTakesInProduction(
    productionRows,
    weekSelection.weekStart,
    weekSelection.weekEnd
  );

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
    freshTakeInProductionCount,
    productionOutputCount: null,
    targetFloor: TARGET_FLOOR,
    tatSummary,
    tatEmptyMessage:
      tatSummary.eligibleAssetCount > 0 ? "" : `No eligible production TAT rows were found in ${weekLabel}.`,
    hitRate: hitRateData.hitRate,
    hitRateNumerator: hitRateData.hitRateNumerator,
    hitRateDenominator: hitRateData.hitRateDenominator,
    beatsFunnel: hitRateData.beatsFunnel,
    podThroughputRows,
    prevFreshTakeCount,
    analyticsSourceError: "",
  };
}

function buildRangePayload(liveRows, analyticsRows, ideationRows, productionRows, rangeSelection, { includeNewShowsPod = false } = {}) {
  const rangeLabel = rangeSelection.rangeLabel || formatWeekRangeLabel(rangeSelection.startDate, rangeSelection.endDate);
  const allFreshTakeRows = buildReleasedFreshTakeAttemptsForRange(
    liveRows,
    rangeSelection.startDate,
    rangeSelection.endDate
  );
  const freshTakeRows = includeNewShowsPod
    ? allFreshTakeRows
    : allFreshTakeRows.filter((row) => !isNonBauPodLeadName(row?.podLeadName));
  const tatSummary = buildTatSummaryFromRows(freshTakeRows);
  const filteredAnalyticsRows = (Array.isArray(analyticsRows) ? analyticsRows : []).filter((row) => {
    const liveDate = String(row?.liveDate || "").trim();
    return liveDate && liveDate >= rangeSelection.startDate && liveDate <= rangeSelection.endDate;
  });
  const hitRateData = buildHitRateAndFunnelForSelection(filteredAnalyticsRows, rangeSelection, { includeNewShowsPod });
  const podThroughputRows = buildPodThroughputForRange(liveRows, ideationRows, rangeSelection.startDate, rangeSelection.endDate);
  const freshTakeInProductionCount = countFreshTakesInProduction(
    productionRows,
    rangeSelection.startDate,
    rangeSelection.endDate
  );

  return {
    ok: true,
    period: "range",
    selectionMode: "date-range",
    startDate: rangeSelection.startDate,
    endDate: rangeSelection.endDate,
    weekStart: rangeSelection.startDate,
    weekEnd: rangeSelection.endDate,
    weekKey: rangeSelection.startDate,
    weekLabel: rangeLabel,
    hasPlannerData: false,
    hasWeekData: freshTakeRows.length > 0,
    emptyStateMessage: freshTakeRows.length > 0 ? "" : `No released fresh takes were found in the Live tab for ${rangeLabel}.`,
    plannerBeatCount: null,
    throughputBeatCount: freshTakeRows.length,
    goodToGoBeatsCount: null,
    goodToGoTarget: GOOD_TO_GO_BEATS_TARGET,
    ideationWeekBucket: "",
    freshTakeCount: freshTakeRows.length,
    plannedReleaseCount: null,
    inProductionBeatCount: null,
    freshTakeInProductionCount,
    productionOutputCount: null,
    targetFloor: TARGET_FLOOR,
    tatSummary,
    tatEmptyMessage: tatSummary.eligibleAssetCount > 0 ? "" : `No eligible production TAT rows were found in ${rangeLabel}.`,
    hitRate: hitRateData.hitRate,
    hitRateNumerator: hitRateData.hitRateNumerator,
    hitRateDenominator: hitRateData.hitRateDenominator,
    beatsFunnel: hitRateData.beatsFunnel,
    podThroughputRows,
    analyticsSourceError: "",
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const period = normalizeWeekView(url.searchParams.get("period"));
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const includeNewShowsPod = url.searchParams.get("includeNewShowsPod") === "true";

  try {
    // Fetch editorial + RFP workflow rows for the breakdown table (shared across all periods)
    const [editorialWorkflowResult, rfpWorkflowResult] = await Promise.all([
      fetchEditorialWorkflowRows()
        .then((result) => ({ rows: result?.rows || [] }))
        .catch(() => ({ rows: [] })),
      fetchReadyForProductionWorkflowRows()
        .then((result) => ({ rows: result?.rows || [] }))
        .catch(() => ({ rows: [] })),
    ]);

    if (startDate || endDate) {
      const [{ rows: liveRows }, analyticsResult, ideationResult, productionResult] = await Promise.all([
        fetchLiveTabRows(),
        fetchAnalyticsLiveTabRows()
          .then((result) => ({ rows: result?.rows || [], error: "" }))
          .catch((error) => ({ rows: [], error: error?.message || "Analytics source unavailable." })),
        fetchIdeationTabRows()
          .then((result) => ({ rows: result?.rows || [], error: "" }))
          .catch(() => ({ rows: [], error: "" })),
        fetchProductionWorkflowRows()
          .then((result) => ({ rows: result?.rows || [] }))
          .catch(() => ({ rows: [] })),
      ]);
      const rangeSelection = buildDateRangeSelection({ startDate, endDate });
      return NextResponse.json({
        ...buildRangePayload(liveRows, analyticsResult.rows, ideationResult.rows, productionResult.rows, rangeSelection, { includeNewShowsPod }),
        analyticsSourceError: analyticsResult.error,
        podBreakdownRows: buildPodBreakdownRows(editorialWorkflowResult.rows, rfpWorkflowResult.rows, productionResult.rows, { startDate: rangeSelection.startDate, endDate: rangeSelection.endDate, liveRows }),
      });
    }

    if (period === "last") {
      const [{ rows: liveRows }, analyticsResult, ideationResult, productionResult] = await Promise.all([
        fetchLiveTabRows(),
        fetchAnalyticsLiveTabRows()
          .then((result) => ({ rows: result?.rows || [], error: "" }))
          .catch((error) => ({ rows: [], error: error?.message || "Analytics source unavailable." })),
        fetchIdeationTabRows()
          .then((result) => ({ rows: result?.rows || [], error: "" }))
          .catch(() => ({ rows: [], error: "" })),
        fetchProductionWorkflowRows()
          .then((result) => ({ rows: result?.rows || [] }))
          .catch(() => ({ rows: [] })),
      ]);
      const lastWeekSelection = getWeekSelection("last");
      return NextResponse.json({
        ...buildLastWeekPayload(liveRows, analyticsResult.rows, ideationResult.rows, productionResult.rows, { includeNewShowsPod }),
        analyticsSourceError: analyticsResult.error,
        podBreakdownRows: buildPodBreakdownRows(editorialWorkflowResult.rows, rfpWorkflowResult.rows, productionResult.rows, { startDate: lastWeekSelection.weekStart, endDate: lastWeekSelection.weekEnd, liveRows }),
      });
    }

    const plannerState = await loadPlannerWeek(period, { includeNewShowsPod });

    if (period === "current") {
      const [{ rows: liveRows }, ideationResult, productionResult] = await Promise.all([
        fetchLiveTabRows(),
        fetchIdeationTabRows()
          .then((result) => ({ rows: result?.rows || [], error: "" }))
          .catch((error) => ({
            rows: [],
            error:
              error?.message ||
              "The Ideation tracker tab is not accessible. Check the sheet sharing settings.",
          })),
        fetchProductionWorkflowRows()
          .then((result) => ({ rows: result?.rows || [] }))
          .catch(() => ({ rows: [] })),
      ]);
      return NextResponse.json({
        ...buildCurrentWeekPayload(plannerState, {
          liveRows,
          ideationRows: ideationResult.rows,
          productionRows: productionResult.rows,
          ideationSourceError: ideationResult.error,
        }),
        podBreakdownRows: buildPodBreakdownRows(editorialWorkflowResult.rows, rfpWorkflowResult.rows, productionResult.rows, { startDate: plannerState.weekSelection.weekStart, endDate: plannerState.weekSelection.weekEnd, liveRows }),
      });
    }

    if (period === "next") {
      const [ideationResult, liveResult, productionResult] = await Promise.all([
        fetchIdeationTabRows()
          .then((result) => ({ rows: result?.rows || [], error: "" }))
          .catch((error) => ({
            rows: [],
            error: error?.message || "The Ideation tracker tab is not accessible. Check the sheet sharing settings.",
          })),
        fetchLiveTabRows()
          .then((result) => ({ rows: result?.rows || [] }))
          .catch(() => ({ rows: [] })),
        fetchProductionWorkflowRows()
          .then((result) => ({ rows: result?.rows || [] }))
          .catch(() => ({ rows: [] })),
      ]);
      const lwFreshTakeRows = buildReleasedFreshTakeAttemptsForPeriod(liveResult.rows, "last");
      return NextResponse.json({
        ...buildNextWeekPayload(plannerState, ideationResult.rows, productionResult.rows, {
          ideationSourceError: ideationResult.error,
          prevFreshTakeCount: lwFreshTakeRows.length,
        }),
        podBreakdownRows: buildPodBreakdownRows(editorialWorkflowResult.rows, rfpWorkflowResult.rows, productionResult.rows, { startDate: plannerState.weekSelection.weekStart, endDate: plannerState.weekSelection.weekEnd, liveRows: liveResult.rows }),
      });
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
