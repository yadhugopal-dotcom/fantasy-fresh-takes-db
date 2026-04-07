import { NextResponse } from "next/server";
import { readJsonObject } from "../../../../lib/storage.js";
import {
  POD_LEAD_ORDER,
  WRITER_TARGET_PER_WEEK,
  buildReleasedRowsForPeriod,
  buildTatSummaryFromRows,
  fetchLiveTabRows,
  isFreshTakesLabel,
} from "../../../../lib/live-tab.js";
import {
  buildPlannerBeatInventory,
  buildPlannerStageMetrics,
  buildPodsModel,
  createDefaultWriterConfig,
  getCurrentWeekKey,
  isVisiblePlannerPodLeadName,
  mergeWeekData,
  mergeWriterConfig,
} from "../../../../lib/tracker-data.js";
import { formatWeekRangeLabel, getWeekSelection, normalizeWeekView } from "../../../../lib/week-view.js";

const CONFIG_PATH = "config/writer-config.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makePlannerWeekPath(weekKey) {
  return `weeks/${weekKey}.json`;
}

async function loadPlannerWeek(period) {
  const weekSelection = getWeekSelection(period);
  const storedConfig = await readJsonObject(CONFIG_PATH);
  const currentConfig = mergeWriterConfig(storedConfig || createDefaultWriterConfig());
  const storedWeek = await readJsonObject(makePlannerWeekPath(weekSelection.weekKey));
  const mergedWeek = mergeWeekData(currentConfig, storedWeek, weekSelection.weekKey);
  const rosterConfig =
    weekSelection.weekKey < getCurrentWeekKey()
      ? mergeWriterConfig(mergedWeek?.rosterSnapshot || currentConfig)
      : currentConfig;
  const weekData = mergeWeekData(rosterConfig, storedWeek, weekSelection.weekKey);
  const pods = buildPodsModel(rosterConfig, weekData).filter((pod) => isVisiblePlannerPodLeadName(pod?.cl));

  return {
    weekSelection,
    writerConfig: rosterConfig,
    weekData,
    pods,
  };
}

function buildPodRosterMeta(pods) {
  const podOrder = POD_LEAD_ORDER.filter((podLeadName) => isVisiblePlannerPodLeadName(podLeadName));
  const podWriterCounts = Object.fromEntries(podOrder.map((podLeadName) => [podLeadName, 0]));

  for (const pod of Array.isArray(pods) ? pods : []) {
    if (!Object.prototype.hasOwnProperty.call(podWriterCounts, pod?.cl)) {
      continue;
    }

    podWriterCounts[pod.cl] = (Array.isArray(pod?.writers) ? pod.writers : []).filter(
      (writer) => writer?.active !== false
    ).length;
  }

  return {
    podOrder,
    podWriterCounts,
    podTargetCounts: Object.fromEntries(
      Object.entries(podWriterCounts).map(([podLeadName, writerCount]) => [
        podLeadName,
        Number((Number(writerCount || 0) * WRITER_TARGET_PER_WEEK).toFixed(2)),
      ])
    ),
  };
}

export async function GET(request) {
  const period = normalizeWeekView(new URL(request.url).searchParams.get("period"));

  try {
    const plannerState = await loadPlannerWeek(period);
    const rosterMeta = buildPodRosterMeta(plannerState.pods);

    if (period === "last") {
      const { rows: liveRows } = await fetchLiveTabRows();
      const releasedRows = buildReleasedRowsForPeriod(liveRows, "last", (row) => isFreshTakesLabel(row?.reworkType));
      const podRows = rosterMeta.podOrder.map((podLeadName) => {
        const podLiveRows = releasedRows.filter((row) => String(row?.podLeadName || "").trim() === podLeadName);
        const tatSummary = buildTatSummaryFromRows(podLiveRows);
        return {
          podLeadName,
          uniqueBeatCount: podLiveRows.length,
          output: podLiveRows.length,
          expectedProductionTatDays: tatSummary.averageTatDays,
          writerCount: Number(rosterMeta.podWriterCounts[podLeadName] || 0),
          targetCount: Number(rosterMeta.podTargetCounts[podLeadName] || 0),
        };
      });

      return NextResponse.json({
        ok: true,
        period,
        selectionMode: "throughput",
        weekStart: plannerState.weekSelection.weekStart,
        weekEnd: plannerState.weekSelection.weekEnd,
        weekKey: plannerState.weekSelection.weekKey,
        weekLabel: formatWeekRangeLabel(plannerState.weekSelection.weekStart, plannerState.weekSelection.weekEnd),
        uniqueBeatCount: releasedRows.length,
        plannedLiveCount: releasedRows.length,
        liveCount: releasedRows.length,
        inProductionCount: 0,
        outputCount: releasedRows.length,
        expectedProductionTatDays: buildTatSummaryFromRows(releasedRows).averageTatDays,
        averageWritingDays: null,
        averageClReviewDays: null,
        releasedCount: releasedRows.length,
        targetFloor: Number(
          Object.values(rosterMeta.podTargetCounts).reduce((sum, value) => sum + Number(value || 0), 0).toFixed(2)
        ),
        onTrack:
          releasedRows.length >=
          Number(Object.values(rosterMeta.podTargetCounts).reduce((sum, value) => sum + Number(value || 0), 0)),
        shortfall: Math.max(
          0,
          Number(Object.values(rosterMeta.podTargetCounts).reduce((sum, value) => sum + Number(value || 0), 0)) -
            releasedRows.length
        ),
        surplus: Math.max(
          0,
          releasedRows.length -
            Number(Object.values(rosterMeta.podTargetCounts).reduce((sum, value) => sum + Number(value || 0), 0))
        ),
        skippedMissingPodLeadCount: 0,
        skippedMissingProductionPodLeadCount: 0,
        writerTarget: WRITER_TARGET_PER_WEEK,
        podRows,
        hasLiveData: releasedRows.length > 0,
        hasWeekData: releasedRows.length > 0,
        emptyStateMessage:
          releasedRows.length > 0
            ? ""
            : "No released fresh-take Live-tab rows were found for the selected completed week.",
        productionTabError: "",
      });
    }

    const overallBeatRows = buildPlannerBeatInventory(plannerState.pods, { dedupeScope: "global" });
    const overallTargetFloor = Number(
      Object.values(rosterMeta.podTargetCounts).reduce((sum, value) => sum + Number(value || 0), 0).toFixed(2)
    );
    const overallMetrics = buildPlannerStageMetrics(overallBeatRows, {
      targetFloor: overallTargetFloor,
      targetTatDays: 1,
    });

    const podRows = rosterMeta.podOrder.map((podLeadName) => {
      const pod = plannerState.pods.find((candidate) => String(candidate?.cl || "").trim() === podLeadName);
      const podBeatRows = buildPlannerBeatInventory(pod ? [pod] : [], { dedupeScope: "pod" });
      const metrics = buildPlannerStageMetrics(podBeatRows, {
        targetFloor: Number(rosterMeta.podTargetCounts[podLeadName] || 0),
        targetTatDays: 1,
      });
      return {
        podLeadName,
        uniqueBeatCount: metrics.uniqueBeatCount,
        output: metrics.liveOnMetaBeatCount,
        expectedProductionTatDays: metrics.expectedProductionTatDays,
        averageWritingDays: metrics.averageWritingDays,
        averageClReviewDays: metrics.averageClReviewDays,
        writerCount: Number(rosterMeta.podWriterCounts[podLeadName] || 0),
        targetCount: Number(rosterMeta.podTargetCounts[podLeadName] || 0),
      };
    });

    return NextResponse.json({
      ok: true,
      period,
      selectionMode: period === "next" ? "planned" : "editorial_funnel",
      weekStart: plannerState.weekSelection.weekStart,
      weekEnd: plannerState.weekSelection.weekEnd,
      weekKey: plannerState.weekSelection.weekKey,
      weekLabel: formatWeekRangeLabel(plannerState.weekSelection.weekStart, plannerState.weekSelection.weekEnd),
      uniqueBeatCount: overallMetrics.uniqueBeatCount,
      plannedLiveCount: overallMetrics.plannedLiveCount,
      liveCount: overallMetrics.plannedLiveCount,
      inProductionCount: 0,
      outputCount: overallMetrics.plannedLiveCount,
      expectedProductionTatDays: overallMetrics.expectedProductionTatDays,
      averageWritingDays: overallMetrics.averageWritingDays,
      averageClReviewDays: overallMetrics.averageClReviewDays,
      releasedCount: overallMetrics.plannedLiveCount,
      targetFloor: overallMetrics.targetFloor,
      onTrack: overallMetrics.plannedLiveCount >= overallMetrics.targetFloor,
      shortfall: Math.max(0, overallMetrics.targetFloor - overallMetrics.plannedLiveCount),
      surplus: Math.max(0, overallMetrics.plannedLiveCount - overallMetrics.targetFloor),
      skippedMissingPodLeadCount: 0,
      skippedMissingProductionPodLeadCount: 0,
      writerTarget: WRITER_TARGET_PER_WEEK,
      podRows,
      hasLiveData: false,
      hasWeekData: overallBeatRows.length > 0,
      emptyStateMessage: overallBeatRows.length > 0 ? "" : "No planner beats are assigned for the selected week yet.",
      productionTabError: "",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load POD Wise dashboard." },
      { status: 500 }
    );
  }
}
