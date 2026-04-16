"use client";

import { useEffect, useMemo, useState } from "react";
import GanttTracker from "./GanttTracker.jsx";
import { copyNodeImageToClipboard } from "../lib/clipboard-share.js";
import {
  buildPlannerBeatInventory,
  buildPlannerStageMetrics,
  getCurrentWeekKey,
  isVisiblePlannerPodLeadName,
  shiftWeekKey,
} from "../lib/tracker-data.js";
import { buildDateRangeSelection, MIN_DASHBOARD_DATE, WEEK_VIEW_OPTIONS, buildMonthWeekFilterOptions, formatWeekRangeLabel, getMonthWeekSelectionByDate, getWeekSelection, getWeekViewLabel, normalizeWeekView } from "../lib/week-view.js";

// ─── View imports ─────────────────────────────────────────────────────────────
import DetailsContent from "./views/DetailsView.jsx";
import OverviewContent from "./views/OverviewView.jsx";
import LeadershipOverviewContent from "./views/LeadershipOverviewView.jsx";
import AnalyticsContent from "./views/AnalyticsView.jsx";
import PodWiseContent, { PodTasksContent } from "./views/PodWiseView.jsx";
import BeatsPerformanceContent from "./views/BeatsPerformanceView.jsx";
import ProductionContent from "./views/ProductionView.jsx";
import Planner2Content from "./views/Planner2View.jsx";
import { PlannerErrorBoundary } from "./views/shared.jsx";

// ─── Shared utilities ─────────────────────────────────────────────────────────
import {
  WRITER_TARGET_PER_WEEK,
  BEATS_PERFORMANCE_CLIENT_CACHE_KEY,
  BEATS_PERFORMANCE_CLIENT_CACHE_TTL_MS,
  formatNumber,
  formatDateLabel,
  getAcdTimeViewLabel,
  getAcdViewLabel,
} from "./views/shared.jsx";

// ─── Shell-only constants ─────────────────────────────────────────────────────

const THEME_STORAGE_KEY = "fresh-takes-theme-mode";
const EMPTY_ACD_MESSAGE = "No valid ACD output data available yet from Live tab sync.";
const DEFAULT_DASHBOARD_RANGE = buildDateRangeSelection({ period: "current", minDate: MIN_DASHBOARD_DATE });
const DASHBOARD_CLIENT_REFRESH_MS = 5 * 60 * 1000;
const DASHBOARD_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Shell-only helpers ───────────────────────────────────────────────────────

function buildNextWeekPlannerBoardMetrics(snapshot) {
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!safeSnapshot || safeSnapshot.isLoading || safeSnapshot.plannerRenderError) {
    return null;
  }

  const hasCommittedSnapshot = Boolean(safeSnapshot?.committedSnapshotMeta?.snapshotTimestamp);
  const visiblePods = (Array.isArray(safeSnapshot.pods) ? safeSnapshot.pods : []).filter((pod) =>
    isVisiblePlannerPodLeadName(pod?.cl)
  );
  const committedPods = (Array.isArray(safeSnapshot.committedPods) ? safeSnapshot.committedPods : []).filter((pod) =>
    isVisiblePlannerPodLeadName(pod?.cl)
  );
  const sourcePods = hasCommittedSnapshot ? committedPods : visiblePods;
  const podOrder = sourcePods.map((pod) => String(pod?.cl || "").trim()).filter(Boolean);
  const podWriterCounts = Object.fromEntries(
    podOrder.map((podLeadName) => {
      const pod = sourcePods.find((candidate) => String(candidate?.cl || "").trim() === podLeadName);
      const writerCount = (Array.isArray(pod?.writers) ? pod.writers : []).filter((writer) => writer?.active !== false).length;
      return [podLeadName, writerCount];
    })
  );
  const podTargetCounts = Object.fromEntries(
    podOrder.map((podLeadName) => [
      podLeadName,
      Number((Number(podWriterCounts[podLeadName] || 0) * WRITER_TARGET_PER_WEEK).toFixed(2)),
    ])
  );
  const targetFloor = Number(
    Object.values(podTargetCounts).reduce((sum, value) => sum + Number(value || 0), 0).toFixed(2)
  );
  const overallBeatRows = buildPlannerBeatInventory(sourcePods, { dedupeScope: "global" });
  const overallMetrics = buildPlannerStageMetrics(overallBeatRows, {
    targetFloor,
    targetTatDays: 1,
  });
  const podRows = podOrder.map((podLeadName) => {
    const pod = sourcePods.find((candidate) => String(candidate?.cl || "").trim() === podLeadName);
    const podBeatRows = buildPlannerBeatInventory(pod ? [pod] : [], { dedupeScope: "pod" });
    const metrics = buildPlannerStageMetrics(podBeatRows, {
      targetFloor: Number(podTargetCounts[podLeadName] || 0),
      targetTatDays: 1,
    });

    return {
      podLeadName,
      uniqueBeatCount: metrics.uniqueBeatCount,
      plannedLiveCount: metrics.liveOnMetaBeatCount,
      liveCount: metrics.liveOnMetaBeatCount,
      inProductionCount: 0,
      output: metrics.liveOnMetaBeatCount,
      expectedProductionTatDays: metrics.expectedProductionTatDays,
      averageWritingDays: metrics.averageWritingDays,
      averageClReviewDays: metrics.averageClReviewDays,
      writerCount: Number(podWriterCounts[podLeadName] || 0),
      targetCount: Number(podTargetCounts[podLeadName] || 0),
      isBelowTarget: metrics.liveOnMetaBeatCount < Number(podTargetCounts[podLeadName] || 0),
    };
  });

  return {
    overview: {
      ok: true,
      period: "next",
      selectionMode: "planned",
      weekKey: String(safeSnapshot.weekKey || ""),
      weekLabel: String(safeSnapshot.weekLabel || ""),
      hasPlannerData: true,
      hasWeekData: overallBeatRows.length > 0,
      emptyStateMessage: overallBeatRows.length > 0 ? "" : "No planner beats are assigned for next week yet.",
      plannerBeatCount: overallMetrics.uniqueBeatCount,
      freshTakeCount: overallMetrics.liveOnMetaBeatCount,
      plannedReleaseCount: overallMetrics.liveOnMetaBeatCount,
      targetFloor,
      tatSummary: {
        averageTatDays: overallMetrics.expectedProductionTatDays,
        medianTatDays: null,
        eligibleAssetCount: overallMetrics.productionBeatCount,
        skippedMissingTatDates: 0,
        skippedInvalidTatRows: 0,
        targetTatDays: overallMetrics.targetTatDays,
        tatRows: [],
      },
      tatEmptyMessage:
        overallMetrics.expectedProductionTatDays === null
          ? "Planner allocations are not sufficient yet to estimate production TAT."
          : "",
      averageWritingDays: overallMetrics.averageWritingDays,
      averageClReviewDays: overallMetrics.averageClReviewDays,
      writingEmptyMessage:
        overallMetrics.uniqueBeatCount > 0 ? "" : "No planner beats are assigned for the selected week yet.",
      clReviewEmptyMessage:
        overallMetrics.uniqueBeatCount > 0 ? "" : "No planner beats are assigned for the selected week yet.",
    },
    writing: {
      ok: true,
      period: "next",
      selectionMode: "planned",
      weekKey: String(safeSnapshot.weekKey || ""),
      weekLabel: String(safeSnapshot.weekLabel || ""),
      uniqueBeatCount: overallMetrics.uniqueBeatCount,
      plannedLiveCount: overallMetrics.liveOnMetaBeatCount,
      liveCount: overallMetrics.liveOnMetaBeatCount,
      inProductionCount: 0,
      outputCount: overallMetrics.liveOnMetaBeatCount,
      expectedProductionTatDays: overallMetrics.expectedProductionTatDays,
      averageWritingDays: overallMetrics.averageWritingDays,
      averageClReviewDays: overallMetrics.averageClReviewDays,
      releasedCount: overallMetrics.liveOnMetaBeatCount,
      targetFloor,
      onTrack: overallMetrics.liveOnMetaBeatCount >= targetFloor,
      shortfall: Math.max(0, targetFloor - overallMetrics.liveOnMetaBeatCount),
      surplus: Math.max(0, overallMetrics.liveOnMetaBeatCount - targetFloor),
      skippedMissingPodLeadCount: 0,
      skippedMissingProductionPodLeadCount: 0,
      writerTarget: WRITER_TARGET_PER_WEEK,
      podRows,
      hasLiveData: false,
      hasWeekData: overallBeatRows.length > 0,
      emptyStateMessage: overallBeatRows.length > 0 ? "" : "No planner beats are assigned for the selected week yet.",
      productionTabError: "",
    },
  };
}

function buildAnalyticsSubtitle(data) {
  const parts = [
    data?.selectedWeekLabel,
    data?.selectedWeekRangeLabel,
    data?.rowCount ? `${formatNumber(data.rowCount)} attempts` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function buildDemoOverviewPayload(rangeSelection) {
  return {
    ok: true,
    period: "range",
    selectionMode: "editorial_funnel",
    weekStart: rangeSelection.startDate,
    weekEnd: rangeSelection.endDate,
    weekLabel: formatWeekRangeLabel(rangeSelection.startDate, rangeSelection.endDate),
    hasWeekData: true,
    plannerBeatCount: 18,
    inProductionBeatCount: 11,
    scriptsPerWriter: 1.7,
    averageClReviewDays: 1.2,
    tatSummary: { averageTatDays: 2.6, eligibleAssetCount: 14 },
    podThroughputRows: [
      {
        podLeadName: "Woodward",
        lwProductionCount: 5,
        thisWeekBeatsCount: 7,
        wipCount: 2,
        reviewWithClCount: 1,
        onTrackCount: 4,
        readinessStage: "On Track",
        thuStatusMessage: "Thu update sent",
        writerRows: [{ writerName: "Writer A", lwProductionCount: 3, thisWeekBeatsCount: 4, wipCount: 1, reviewWithClCount: 1, onTrackCount: 2, readinessStage: "On Track" }],
      },
      {
        podLeadName: "Berman",
        lwProductionCount: 4,
        thisWeekBeatsCount: 6,
        wipCount: 2,
        reviewWithClCount: 1,
        onTrackCount: 3,
        readinessStage: "WIP",
        thuStatusMessage: "Needs Thursday update",
        writerRows: [{ writerName: "Writer B", lwProductionCount: 2, thisWeekBeatsCount: 3, wipCount: 1, reviewWithClCount: 0, onTrackCount: 2, readinessStage: "WIP" }],
      },
    ],
    beatsFunnel: [
      { showName: "MVS", beatName: "Prom", attempts: 4, successfulAttempts: 2 },
      { showName: "WBT", beatName: "Hydra", attempts: 3, successfulAttempts: 1 },
    ],
    hitRate: 42.9,
    hitRateNumerator: 3,
    hitRateDenominator: 7,
  };
}

function buildDemoLeadershipPayload(rangeSelection) {
  return {
    ok: true,
    selectedWeekRangeLabel: formatWeekRangeLabel(rangeSelection.startDate, rangeSelection.endDate),
    beatRows: [
      { id: "1", statusCategory: "approved", podLeadName: "Woodward", showName: "MVS", beatName: "Prom", monthKey: "2026-04", weekInMonth: 2 },
      { id: "2", statusCategory: "review_pending", podLeadName: "Berman", showName: "WBT", beatName: "Hydra", monthKey: "2026-04", weekInMonth: 2 },
    ],
    allBeatRows: [],
    workflowRows: [
      { id: "w1", source: "production", podLeadName: "Woodward", writerName: "Writer A", showName: "MVS", beatName: "Prom", stageDate: rangeSelection.startDate },
      { id: "w2", source: "ready_for_production", podLeadName: "Berman", writerName: "Writer B", showName: "WBT", beatName: "Hydra", stageDate: rangeSelection.startDate },
    ],
    allWorkflowRows: [],
    approvedMatchedRows: [],
    fullGenAiRows: [
      { id: "g1", showName: "MVS", beatName: "Prom", success: true },
      { id: "g2", showName: "WBT", beatName: "Hydra", success: false },
    ],
    currentWeekUpdateRows: [
      { podLeadName: "Woodward", writerName: "Writer A", beats: 4, editorial: 2, readyForProduction: 1, production: 1, live: 1 },
      { podLeadName: "Berman", writerName: "Writer B", beats: 3, editorial: 1, readyForProduction: 1, production: 0, live: 0 },
    ],
  };
}

function buildDemoAnalyticsPayload(rangeSelection) {
  return {
    ok: true,
    selectedWeekKey: rangeSelection.startDate,
    selectedWeekLabel: "Custom",
    selectedWeekRangeLabel: formatWeekRangeLabel(rangeSelection.startDate, rangeSelection.endDate),
    rowCount: 2,
    legend: [
      { label: "Potential Gen AI", tone: "gen-ai" },
      { label: "Potential P1 Rework", tone: "rework-p1" },
      { label: "Testing / Drop", tone: "testing-drop" },
    ],
    metricColumns: [
      { key: "amountSpent", label: "Spend", format: "currency" },
      { key: "cpi", label: "CPI", format: "currency" },
      { key: "cti", label: "CTI", format: "percent" },
    ],
    rows: [
      {
        assetCode: "GA123",
        rowIndex: 1,
        showName: "MVS",
        beatName: "Prom",
        nextStep: "Potential Gen AI",
        rowTone: "gen-ai",
        actioned: false,
        metrics: {
          amountSpent: { value: 180, meetsBenchmark: true },
          cpi: { value: 8.2, meetsBenchmark: true },
          cti: { value: 14.1, meetsBenchmark: true },
        },
      },
      {
        assetCode: "GI901",
        rowIndex: 2,
        showName: "WBT",
        beatName: "Hydra",
        nextStep: "Potential P1 Rework",
        rowTone: "rework-p1",
        actioned: false,
        metrics: {
          amountSpent: { value: 145, meetsBenchmark: true },
          cpi: { value: 11.4, meetsBenchmark: false },
          cti: { value: 12.6, meetsBenchmark: true },
        },
      },
    ],
  };
}

function buildDemoProductionPayload(rangeSelection) {
  return {
    ok: true,
    period: "range",
    weekStart: rangeSelection.startDate,
    weekEnd: rangeSelection.endDate,
    weekLabel: formatWeekRangeLabel(rangeSelection.startDate, rangeSelection.endDate),
    latestWorkDate: rangeSelection.endDate,
    emptyStateMessage: "",
    acdChartRows: [
      { acdName: "ACD 1", totalMinutes: 420, totalImages: 24 },
      { acdName: "ACD 2", totalMinutes: 360, totalImages: 19 },
    ],
    rolling7Rows: [
      { acdName: "ACD 1", totalMinutes: 420, totalImages: 24 },
      { acdName: "ACD 2", totalMinutes: 360, totalImages: 19 },
    ],
    rolling14Rows: [],
    rolling30Rows: [],
    rolling7CdRows: [],
    rolling14CdRows: [],
    rolling30CdRows: [],
    syncStatus: {
      latestRun: { createdAt: new Date().toISOString(), processedLiveRows: 120, eligibleLiveRows: 85, sheetLinksAttempted: 60, sheetLinksFailed: 6 },
      adherenceIssueRows: [{ cdName: "CD 1", acdName: "ACD 1", totalAssetsNotAdhering: 2, assets: [{ assetCode: "GA123", imageSheetLink: "" }] }],
      adherenceRows: [{ cdName: "CD 1", totalAssetsNotAdhering: 2 }],
      totalFailedSheets: 6,
      cutoffDate: "2026-03-16",
      sourceFilterWarning: "",
      syncError: "",
    },
    failureReasonRows: [{ failureReason: "sheet_inaccessible", count: 4 }],
  };
}

function Notice({ notice }) {
  if (!notice) {
    return null;
  }

  return <div className={`floating-notice tone-${notice.tone || "info"}`}>{notice.text}</div>;
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  return response.json();
}

function readClientCache(key, ttlMs = DASHBOARD_CLIENT_CACHE_TTL_MS) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > ttlMs) return null;
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writeClientCache(key, payload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        payload,
      })
    );
  } catch {}
}

// ─── Main component ───────────────────────────────────────────────────────────

const MORE_VIEWS = new Set(["details", "planner", "pod-wise"]);

export default function UnifiedOpsApp() {
  const [activeView, setActiveView] = useState("leadership-overview");
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [themeMode, setThemeMode] = useState("light");
  const [dashboardDateRange, setDashboardDateRange] = useState({
    startDate: DEFAULT_DASHBOARD_RANGE.startDate,
    endDate: DEFAULT_DASHBOARD_RANGE.endDate,
  });
  const [plannerBoardSnapshot, setPlannerBoardSnapshot] = useState(null);
  const [overviewData, setOverviewData] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [leadershipOverviewData, setLeadershipOverviewData] = useState(null);
  const [leadershipOverviewLoading, setLeadershipOverviewLoading] = useState(true);
  const [leadershipOverviewError, setLeadershipOverviewError] = useState("");
  const [competitionData, setCompetitionData] = useState(null);
  const [competitionLoading, setCompetitionLoading] = useState(true);
  const [v2CompetitionData, setV2CompetitionData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsActionedBusyKey, setAnalyticsActionedBusyKey] = useState("");
  const [acdMetricsData, setAcdMetricsData] = useState(null);
  const [acdMetricsLoading, setAcdMetricsLoading] = useState(true);
  const [acdMetricsError, setAcdMetricsError] = useState("");
  const [productionPipelineData, setProductionPipelineData] = useState(null);
  const [productionPipelineLoading, setProductionPipelineLoading] = useState(false);
  const [acdTimeView, setAcdTimeView] = useState("rolling7");
  const [acdViewType, setAcdViewType] = useState("acd");
  const [busyAction, setBusyAction] = useState("");
  const [copyingSection, setCopyingSection] = useState("");
  const [includeNewShowsPod, setIncludeNewShowsPod] = useState(false);
  const [notice, setNotice] = useState(null);
  const [podWiseView, setPodWiseView] = useState("performance");
  const [podPerformanceRangeMode, setPodPerformanceRangeMode] = useState("selected");
  const [podPerformanceScope, setPodPerformanceScope] = useState("bau");
  const [podTasksData, setPodTasksData] = useState(null);
  const [podTasksLoading, setPodTasksLoading] = useState(false);
  const [beatsPerformanceData, setBeatsPerformanceData] = useState(null);
  const [beatsPerformanceLoading, setBeatsPerformanceLoading] = useState(false);
  const [beatsPerformanceError, setBeatsPerformanceError] = useState("");
  const [dashboardLoadingMessage, setDashboardLoadingMessage] = useState("");
  const [planner2Data, setPlanner2Data] = useState(null);
  const [planner2Loading, setPlanner2Loading] = useState(false);
  const [planner2Error, setPlanner2Error] = useState("");
  const [lastNonQuickRange, setLastNonQuickRange] = useState(DEFAULT_DASHBOARD_RANGE);
  const [weekFilterSelection, setWeekFilterSelection] = useState(
    getMonthWeekSelectionByDate(DEFAULT_DASHBOARD_RANGE.startDate).id
  );
  const [dateFilterMode, setDateFilterMode] = useState("custom");
  const normalizedHeaderRange = useMemo(
    () => buildDateRangeSelection({ ...dashboardDateRange, minDate: MIN_DASHBOARD_DATE }),
    [dashboardDateRange]
  );
  const headerSupportsDateRange =
    activeView === "overview" ||
    activeView === "leadership-overview" ||
    activeView === "pod-wise" ||
    activeView === "analytics" ||
    activeView === "production" ||
    activeView === "beats-performance" ||
    activeView === "beats-performance-v2" ||
    activeView === "planner2";
  const headerDateRangeDisabled =
    (activeView === "overview" && overviewLoading) ||
    (activeView === "leadership-overview" && leadershipOverviewLoading) ||
    (activeView === "pod-wise" && competitionLoading) ||
    (activeView === "analytics" && analyticsLoading && !analyticsData) ||
    (activeView === "production" && acdMetricsLoading && !acdMetricsData) ||
    (activeView === "beats-performance" && beatsPerformanceLoading && !beatsPerformanceData) ||
    (activeView === "beats-performance-v2" && beatsPerformanceLoading && !beatsPerformanceData) ||
    (activeView === "planner2" && planner2Loading && !planner2Data);
  const weekFilterSourceRows = leadershipOverviewData?.allBeatRows || overviewData?.allBeatRows || beatsPerformanceData?.rows || [];
  const monthWeekOptions = useMemo(() => buildMonthWeekFilterOptions(weekFilterSourceRows), [weekFilterSourceRows]);
  const selectedMonthWeekOption = useMemo(
    () => monthWeekOptions.find((option) => option.id === weekFilterSelection) || monthWeekOptions[0] || null,
    [monthWeekOptions, weekFilterSelection]
  );
  const selectedWeekMatchesRange =
    Boolean(selectedMonthWeekOption) &&
    selectedMonthWeekOption.weekStart === normalizedHeaderRange.startDate &&
    selectedMonthWeekOption.weekEnd === normalizedHeaderRange.endDate;
  const headerDateRangeUsesWeekPreset = headerSupportsDateRange && activeView !== "planner2" && selectedWeekMatchesRange;
  const headerDateRangeUsesManualDates = headerSupportsDateRange && activeView !== "planner2" && !selectedWeekMatchesRange;

  useEffect(() => {
    if (monthWeekOptions.length === 0) {
      return;
    }

    const dateBasedSelection = getMonthWeekSelectionByDate(normalizedHeaderRange.startDate);
    const matchedOption =
      monthWeekOptions.find((option) => option.id === weekFilterSelection) ||
      monthWeekOptions.find((option) => option.id === dateBasedSelection.id) ||
      monthWeekOptions[0];

    if (matchedOption && matchedOption.id !== weekFilterSelection) {
      setWeekFilterSelection(matchedOption.id);
    }
  }, [monthWeekOptions, weekFilterSelection, normalizedHeaderRange.startDate]);
  const lastWeekQuickRange = useMemo(
    () =>
      buildDateRangeSelection({
        startDate: getWeekSelection("last").weekStart,
        endDate: getWeekSelection("last").weekEnd,
        minDate: MIN_DASHBOARD_DATE,
      }),
    []
  );
  const currentWeekQuickRange = useMemo(
    () =>
      buildDateRangeSelection({
        startDate: getWeekSelection("current").weekStart,
        endDate: getWeekSelection("current").weekEnd,
        minDate: MIN_DASHBOARD_DATE,
      }),
    []
  );
  const nextWeekQuickRange = useMemo(
    () =>
      buildDateRangeSelection({
        startDate: getWeekSelection("next").weekStart,
        endDate: getWeekSelection("next").weekEnd,
        minDate: MIN_DASHBOARD_DATE,
      }),
    []
  );
  const isLastWeekSelected = dateFilterMode === "last-week";
  const isCurrentWeekSelected = dateFilterMode === "current-week";
  const isNextWeekSelected = dateFilterMode === "next-week";
  const isCustomRangeSelected = dateFilterMode === "custom";

  const setPeriodLoadingState = (setter, period, value) => {
    setter((current) => ({ ...current, [period]: value }));
  };

  const setPeriodErrorState = (setter, period, value) => {
    setter((current) => ({ ...current, [period]: value }));
  };

  const setPeriodDataState = (setter, period, value) => {
    setter((current) => ({ ...current, [period]: value }));
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeMode(storedTheme);
      return;
    }

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setThemeMode(prefersDark ? "dark" : "light");
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.setAttribute("data-theme", themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  const productionSubtitle = useMemo(
    () =>
      [
        "ACD productivity",
        `${getAcdTimeViewLabel(acdTimeView)} ${getAcdViewLabel(acdViewType)}`,
        acdMetricsData?.latestWorkDate ? `Latest synced work date ${formatDateLabel(acdMetricsData.latestWorkDate)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    [acdMetricsData, acdTimeView, acdViewType]
  );
  const analyticsSubtitle = useMemo(() => buildAnalyticsSubtitle(analyticsData), [analyticsData]);
  const dashboardIsRefreshing = Boolean(dashboardLoadingMessage);

  useEffect(() => {
    if (activeView !== "overview") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);
    const cacheKey = `overview:${rangeSelection.startDate}:${rangeSelection.endDate}:${includeNewShowsPod ? "with-new" : "bau"}`;

    const cachedPayload = readClientCache(cacheKey);
    if (cachedPayload) {
      setOverviewData(cachedPayload);
      setOverviewLoading(false);
      setOverviewError("");
    }

    async function loadOverviewSection({ forceLoading = false } = {}) {
      setDashboardLoadingMessage("Refreshing Overview…");
      if (forceLoading || (!overviewData && !cachedPayload)) {
        setOverviewLoading(true);
      }
      setOverviewError("");

      try {
        const overviewResponse = await fetch(
          `/api/dashboard/overview?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}&includeNewShowsPod=${includeNewShowsPod}`,
          { cache: "no-store" }
        );
        const overviewPayload = await readJson(overviewResponse);
        if (!overviewResponse.ok) {
          throw new Error(overviewPayload.liveTabError || overviewPayload.error || "Unable to load Overview metrics.");
        }

        if (!cancelled) {
          setOverviewData(overviewPayload);
          setOverviewLoading(false);
          setDashboardLoadingMessage("");
          writeClientCache(cacheKey, overviewPayload);
        }
      } catch (error) {
        if (!cancelled) {
          if (!overviewData && !cachedPayload) {
            setOverviewError(error.message || "Unable to load Overview metrics.");
          }
          setOverviewLoading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadOverviewSection({ forceLoading: !cachedPayload && !overviewData });
    const intervalId = window.setInterval(() => {
      void loadOverviewSection({ forceLoading: false });
    }, DASHBOARD_CLIENT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView, dashboardDateRange, includeNewShowsPod]);

  useEffect(() => {
    if (activeView !== "leadership-overview") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);
    const cacheKey = `leadership-overview:${rangeSelection.startDate}:${rangeSelection.endDate}`;

    const cachedPayload = readClientCache(cacheKey);
    if (cachedPayload) {
      setLeadershipOverviewData(cachedPayload);
      setLeadershipOverviewLoading(false);
      setLeadershipOverviewError("");
    }

    async function loadLeadershipOverview({ forceLoading = false } = {}) {
      setDashboardLoadingMessage("Refreshing Overview…");
      if (forceLoading || (!leadershipOverviewData && !cachedPayload)) {
        setLeadershipOverviewLoading(true);
      }
      setLeadershipOverviewError("");

      try {
        const response = await fetch(`/api/dashboard/leadership-overview?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}`, {
          cache: "no-store",
        });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Overview.");
        }

        if (!cancelled) {
          setLeadershipOverviewData(payload);
          setLeadershipOverviewLoading(false);
          setDashboardLoadingMessage("");
          writeClientCache(cacheKey, payload);
        }
      } catch (error) {
        if (!cancelled) {
          if (!leadershipOverviewData && !cachedPayload) {
            setLeadershipOverviewError(error?.message || "Unable to load Overview.");
          }
          setLeadershipOverviewLoading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadLeadershipOverview({ forceLoading: !cachedPayload && !leadershipOverviewData });
    const intervalId = window.setInterval(() => {
      void loadLeadershipOverview({ forceLoading: false });
    }, DASHBOARD_CLIENT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView, dashboardDateRange]);


  useEffect(() => {
    if (activeView !== "pod-wise" || podWiseView !== "performance") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);
    const cacheKey = `pod-wise-performance:${podPerformanceRangeMode}:${podPerformanceScope}:${rangeSelection.startDate}:${rangeSelection.endDate}`;
    const cachedPayload = readClientCache(cacheKey);
    if (cachedPayload) {
      setCompetitionData(cachedPayload);
      setCompetitionLoading(false);
    }

    async function loadCompetition({ forceLoading = false } = {}) {
      setDashboardLoadingMessage("Refreshing Pod Wise…");
      if (forceLoading || (!competitionData && !cachedPayload)) {
        setCompetitionLoading(true);
      }
      try {
        const response = await fetch(
          podPerformanceRangeMode === "lifetime"
            ? `/api/dashboard/competition?mode=lifetime&scope=${encodeURIComponent(podPerformanceScope)}`
            : `/api/dashboard/competition?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}&scope=${encodeURIComponent(podPerformanceScope)}`,
          { cache: "no-store" }
        );
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load competition data.");
        }

        if (!cancelled) {
          setCompetitionData(payload);
          setDashboardLoadingMessage("");
          writeClientCache(cacheKey, payload);
        }
      } catch {
        if (!cancelled) {
          if (!competitionData && !cachedPayload) {
            setCompetitionData(null);
          }
        }
      } finally {
        if (!cancelled) {
          setCompetitionLoading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadCompetition({ forceLoading: !cachedPayload && !competitionData });
    const intervalId = window.setInterval(() => {
      void loadCompetition({ forceLoading: false });
    }, DASHBOARD_CLIENT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView, podWiseView, dashboardDateRange, podPerformanceRangeMode, podPerformanceScope]);

  useEffect(() => {
    if (activeView !== "beats-performance-v2") return undefined;
    const V2_CACHE_KEY = "beats-performance-v2-competition";
    const cachedPayload = readClientCache(V2_CACHE_KEY);
    if (cachedPayload) {
      setV2CompetitionData(cachedPayload);
    }
    let cancelled = false;
    async function loadV2Competition() {
      try {
        const response = await fetch("/api/dashboard/competition?mode=lifetime&scope=bau", { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error || "Unable to load competition data.");
        if (!cancelled) {
          setV2CompetitionData(payload);
          writeClientCache(V2_CACHE_KEY, payload);
        }
      } catch {}
    }
    void loadV2Competition();
    return () => { cancelled = true; };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "pod-wise" || podWiseView !== "tasks") {
      return undefined;
    }
    if (podTasksData) {
      return undefined;
    }

    let cancelled = false;

    async function loadPodTasks() {
      setDashboardLoadingMessage("Refreshing Pod Tasks…");
      setPodTasksLoading(true);
      try {
        const response = await fetch("/api/dashboard/pod-tasks", { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load POD tasks.");
        }
        if (!cancelled) {
          setPodTasksData(payload);
          setDashboardLoadingMessage("");
        }
      } catch {
        if (!cancelled) {
          setPodTasksData(null);
        }
      } finally {
        if (!cancelled) {
          setPodTasksLoading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadPodTasks();
    return () => {
      cancelled = true;
    };
  }, [activeView, podWiseView, podTasksData]);

  useEffect(() => {
    if (activeView !== "beats-performance" && activeView !== "beats-performance-v2") {
      return undefined;
    }

    let cancelled = false;

    async function loadBeatsPerformance() {
      setDashboardLoadingMessage("Refreshing Beats Performance…");
      let hasCachedPayload = false;

      try {
        const cachedPayload = window.localStorage.getItem(BEATS_PERFORMANCE_CLIENT_CACHE_KEY);
        if (cachedPayload) {
          const parsedCache = JSON.parse(cachedPayload);
          if (
            parsedCache &&
            typeof parsedCache === "object" &&
            parsedCache.payload &&
            Number.isFinite(parsedCache.savedAt) &&
            Date.now() - parsedCache.savedAt < BEATS_PERFORMANCE_CLIENT_CACHE_TTL_MS
          ) {
            hasCachedPayload = true;
            if (!cancelled) {
              setBeatsPerformanceData({ ...parsedCache.payload, warnings: [] });
              setBeatsPerformanceError("");
              setBeatsPerformanceLoading(true);
            }
          }
        }
      } catch {}

      if (!hasCachedPayload) {
        setBeatsPerformanceError("");
      }
      setBeatsPerformanceLoading(true);

      try {
        const response = await fetch("/api/dashboard/beats-performance");
        const payload = await readJson(response);
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Unable to load beats performance dashboard.");
        }

        if (!cancelled) {
          setBeatsPerformanceData(payload);
          setBeatsPerformanceError("");
          setBeatsPerformanceLoading(false);
          setDashboardLoadingMessage("");
        }

        try {
          window.localStorage.setItem(
            BEATS_PERFORMANCE_CLIENT_CACHE_KEY,
            JSON.stringify({
              savedAt: Date.now(),
              payload,
            })
          );
        } catch {}
      } catch (error) {
        if (!cancelled) {
          if (!hasCachedPayload) {
            setBeatsPerformanceData(null);
            setBeatsPerformanceError(error.message || "Unable to load beats performance dashboard.");
          }
        }
      } finally {
        if (!cancelled) {
          setBeatsPerformanceLoading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadBeatsPerformance();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "planner2") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);
    const cacheKey = `planner2:${rangeSelection.startDate}:${rangeSelection.endDate}`;
    const cachedPayload = readClientCache(cacheKey);
    if (cachedPayload) {
      setPlanner2Data(cachedPayload);
      setPlanner2Loading(false);
      setPlanner2Error("");
    }

    async function loadPlanner2({ forceLoading = false } = {}) {
      setDashboardLoadingMessage("Refreshing Planner…");
      if (forceLoading || (!planner2Data && !cachedPayload)) {
        setPlanner2Loading(true);
      }
      setPlanner2Error("");

      try {
        const response = await fetch(
          `/api/dashboard/planner2?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}`,
          { cache: "no-store" }
        );
        const payload = await readJson(response);
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Unable to load Planner2.");
        }

        if (!cancelled) {
          setPlanner2Data(payload);
          setDashboardLoadingMessage("");
          writeClientCache(cacheKey, payload);
        }
      } catch (error) {
        if (!cancelled) {
          if (!planner2Data && !cachedPayload) {
            setPlanner2Data({
              ok: true,
              weekLabel: formatWeekRangeLabel(rangeSelection.startDate, rangeSelection.endDate),
              lastUpdatedAt: new Date().toISOString(),
              totals: { committedTaskCount: 18, completedTaskCount: 9, laggingTaskCount: 9 },
              ownerRows: [
                { ownerName: "Owner A", podLeadName: "Woodward", committedTaskCount: 5, completedTaskCount: 3, laggingTaskCount: 2, activeDays: 4 },
                { ownerName: "Owner B", podLeadName: "Berman", committedTaskCount: 4, completedTaskCount: 1, laggingTaskCount: 3, activeDays: 4 },
              ],
              dayRows: [
                { date: rangeSelection.startDate, items: [{ committedTaskCount: 6, completedTaskCount: 2, laggingTaskCount: 4 }] },
                { date: rangeSelection.endDate, items: [{ committedTaskCount: 4, completedTaskCount: 3, laggingTaskCount: 1 }] },
              ],
            });
            setPlanner2Error(`Demo mode: ${error.message || "Unable to load Planner2."}`);
          }
        }
      } finally {
        if (!cancelled) {
          setPlanner2Loading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadPlanner2({ forceLoading: !cachedPayload && !planner2Data });
    const intervalId = window.setInterval(() => {
      void loadPlanner2({ forceLoading: false });
    }, DASHBOARD_CLIENT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView, dashboardDateRange]);

  useEffect(() => {
    if (activeView !== "analytics") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);
    const cacheKey = `analytics:${rangeSelection.startDate}:${rangeSelection.endDate}`;
    const cachedPayload = readClientCache(cacheKey);
    if (cachedPayload) {
      setAnalyticsData(cachedPayload);
      setAnalyticsLoading(false);
      setAnalyticsError("");
    }

    async function loadAnalytics({ forceLoading = false } = {}) {
      setDashboardLoadingMessage("Refreshing Analytics…");
      if (forceLoading || (!analyticsData && !cachedPayload)) {
        setAnalyticsLoading(true);
      }
      setAnalyticsError("");

      try {
        const analyticsUrl = `/api/dashboard/analytics?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}`;
        const response = await fetch(analyticsUrl, { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Analytics dashboard.");
        }

        if (!cancelled) {
          setAnalyticsData(payload);
          setDashboardLoadingMessage("");
          writeClientCache(cacheKey, payload);
        }
      } catch (error) {
        if (!cancelled) {
          if (!analyticsData && !cachedPayload) {
            setAnalyticsError(error.message || "Unable to load Analytics dashboard.");
          }
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
          setDashboardLoadingMessage("");
        }
      }
    }

    void loadAnalytics({ forceLoading: !cachedPayload && !analyticsData });
    const intervalId = window.setInterval(() => {
      void loadAnalytics({ forceLoading: false });
    }, DASHBOARD_CLIENT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView, dashboardDateRange]);

  async function requestAcdMetrics(cancelState = null) {
    if (!cancelState?.cancelled) {
      setAcdMetricsLoading(true);
      setDashboardLoadingMessage("Refreshing ACD productivity…");
      setAcdMetricsError("");
    }

    try {
      const response = await fetch("/api/acd-metrics", { cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load ACD productivity.");
      }

      if (!cancelState?.cancelled) {
        setAcdMetricsData(payload);
        setDashboardLoadingMessage("");
      }

      return payload;
    } catch (error) {
      if (!cancelState?.cancelled) {
        setAcdMetricsError(error.message || "Unable to load ACD productivity.");
      }
      throw error;
    } finally {
      if (!cancelState?.cancelled) {
        setAcdMetricsLoading(false);
        setDashboardLoadingMessage("");
      }
    }
  }

  async function ensureEditAccess() {
    const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
    const sessionPayload = await readJson(sessionResponse);

    if (!sessionResponse.ok) {
      throw new Error(sessionPayload.error || "Unable to verify sync access.");
    }

    if (sessionPayload.unlocked) {
      return true;
    }

    if (sessionPayload.configured === false) {
      throw new Error("Edit access is not configured right now.");
    }

    const password = window.prompt("Enter the edit password");
    if (!password) {
      return false;
    }

    const unlockResponse = await fetch("/api/auth/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    const unlockPayload = await readJson(unlockResponse);

    if (!unlockResponse.ok) {
      throw new Error(unlockPayload.error || "Incorrect password.");
    }

    return true;
  }

  useEffect(() => {
    if (activeView !== "production" && activeView !== "details" && activeView !== "overview" && activeView !== "leadership-overview") {
      return undefined;
    }
    if (acdMetricsData) {
      return undefined;
    }

    const cancelState = { cancelled: false };
    void requestAcdMetrics(cancelState);
    return () => {
      cancelState.cancelled = true;
    };
  }, [activeView, acdMetricsData]);

  useEffect(() => {
    if (activeView !== "production") return undefined;
    let cancelled = false;
    setDashboardLoadingMessage("Refreshing Production…");
    setProductionPipelineLoading(true);
    fetch("/api/dashboard/production", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setProductionPipelineData(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setProductionPipelineLoading(false); setDashboardLoadingMessage(""); } });
    return () => { cancelled = true; };
  }, [activeView]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function copySection(node, label) {
    setCopyingSection(label);

    try {
      await copyNodeImageToClipboard(
        node,
        label === "Production troubleshooting"
          ? { captureMode: "production-troubleshooting" }
          : undefined
      );
      setNotice({ tone: "success", text: "Copied to clipboard." });
    } catch (error) {
      setNotice({ tone: "error", text: error.message || `Unable to copy ${label}.` });
    } finally {
      setCopyingSection((current) => (current === label ? "" : current));
    }
  }

  async function updateAnalyticsActioned(row, actioned) {
    const assetCode = String(row?.assetCode || "").trim();
    const weekKey = String(row?.analyticsWeekKey || analyticsData?.selectedWeekKey || "").trim();
    const busyKey = `${weekKey}:${assetCode}`;

    if (!assetCode || !weekKey) {
      setNotice({ tone: "error", text: "Missing asset code or week for Actioned." });
      return;
    }

    const canEdit = await ensureEditAccess().catch((error) => {
      setNotice({ tone: "error", text: error.message || "Unable to unlock edits." });
      return false;
    });

    if (!canEdit) {
      return;
    }

    setAnalyticsActionedBusyKey(busyKey);

    try {
      const response = await fetch("/api/dashboard/analytics", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          weekKey,
          assetCode,
          actioned,
        }),
      });
      const payload = await readJson(response);

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Unable to update Actioned.");
      }

      setAnalyticsData((current) => {
        if (!current || !Array.isArray(current.rows)) {
          return current;
        }

        return {
          ...current,
          rows: current.rows.map((currentRow) =>
            String(currentRow?.assetCode || "").trim() === assetCode
              ? { ...currentRow, actioned }
              : currentRow
          ),
        };
      });
      setNotice({ tone: "success", text: actioned ? "Marked actioned." : "Returned to active queue." });
    } catch (error) {
      setNotice({ tone: "error", text: error.message || "Unable to update Actioned." });
    } finally {
      setAnalyticsActionedBusyKey("");
    }
  }

  async function runAcdSync() {
    const canRunSync = await ensureEditAccess().catch((error) => {
      setNotice({ tone: "error", text: error.message || "Unable to unlock sync." });
      return false;
    });

    if (!canRunSync) {
      return;
    }

    setBusyAction("acd-sync");
    try {
      const response = await fetch("/api/acd-live-sync", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await readJson(response);

      if (!response.ok || payload.ok === false || payload.schemaReady === false) {
        throw new Error(payload.error || "ACD daily sync failed.");
      }

      await requestAcdMetrics();
      setNotice({
        tone: "success",
        text: `ACD sync complete. Eligible: ${formatNumber(payload.eligibleLiveRows)} | Sheets attempted: ${formatNumber(
          payload.sheetLinksAttempted
        )} | Failed: ${formatNumber(payload.sheetLinksFailed)}`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: error.message || "ACD daily sync failed." });
    } finally {
      setBusyAction("");
    }
  }

  const activeViewLabelMap = {
    "leadership-overview": "Overview",
    overview: "Editorial Funnel",
    "beats-performance": "Beats Performance",
    "beats-performance-v2": "Beats Performance V2",
    "pod-wise": "POD Wise",
    planner: "Planner",
    planner2: "Planner",
    analytics: "Analytics",
    production: "Production",
    details: "Details",
  };



  return (
    <>
      <div className="app-shell">
        <nav className="sidebar" aria-label="Dashboard navigation">
          <div className="sidebar-brand">
            <span className="sidebar-brand-name">Fresh Takes</span>
            <span className="sidebar-brand-sub">Pocket FM</span>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-label">VIEWS</div>
            <div className="sidebar-more-items">
              {[
                ["leadership-overview", "Overview"],
                ["overview", "Editorial Funnel"],
                ["beats-performance", "Beats Performance"],
                ["beats-performance-v2", "Beats Performance V2"],
                ["planner2", "Planner"],
                ["analytics", "Analytics"],
                ["production", "Production"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`sidebar-link${activeView === id ? " active" : ""}`}
                  onClick={() => setActiveView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <button
              type="button"
              className={`sidebar-section-label sidebar-more-toggle${MORE_VIEWS.has(activeView) ? " has-active" : ""}`}
              onClick={() => setMoreExpanded((prev) => !prev)}
              aria-expanded={moreExpanded || MORE_VIEWS.has(activeView)}
            >
              <span>MORE</span>
              <span className="sidebar-more-chevron" style={{ transform: (moreExpanded || MORE_VIEWS.has(activeView)) ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
            </button>
            {(moreExpanded || MORE_VIEWS.has(activeView)) && (
              <div className="sidebar-more-items">
                {[
                  ["details", "Details"],
                  ["planner", "Planner"],
                  ["pod-wise", "POD Wise"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`sidebar-link${activeView === id ? " active" : ""}`}
                    onClick={() => setActiveView(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        <main className="ops-main">
          <div className="app-topbar">
            <div className="app-topbar-copy">
              <h1 className="app-topbar-title">{activeViewLabelMap[activeView] || "Dashboard"}</h1>
            </div>
            <div className="app-topbar-right">
              {headerSupportsDateRange ? (
                <div className="app-topbar-range" data-share-ignore="true">
                  {activeView === "planner2" ? (
                  <>
                    <button
                      type="button"
                      className={`app-topbar-quick-btn${isLastWeekSelected ? " is-active" : ""}`}
                      disabled={headerDateRangeDisabled}
                      onClick={() => {
                        setLastNonQuickRange({ startDate: normalizedHeaderRange.startDate, endDate: normalizedHeaderRange.endDate });
                        setDateFilterMode("last-week");
                        setDashboardDateRange(lastWeekQuickRange);
                      }}
                    >
                      Last week
                    </button>
                    <button
                      type="button"
                      className={`app-topbar-quick-btn${isCurrentWeekSelected ? " is-active" : ""}`}
                      disabled={headerDateRangeDisabled}
                      onClick={() => {
                        if (!isCurrentWeekSelected) {
                          setLastNonQuickRange({ startDate: normalizedHeaderRange.startDate, endDate: normalizedHeaderRange.endDate });
                        }
                        setDateFilterMode("current-week");
                        setDashboardDateRange(currentWeekQuickRange);
                      }}
                    >
                      Current week
                    </button>
                    <button
                      type="button"
                      className={`app-topbar-quick-btn${isNextWeekSelected ? " is-active" : ""}`}
                      disabled={headerDateRangeDisabled}
                      onClick={() => {
                        if (!isNextWeekSelected) {
                          setLastNonQuickRange({ startDate: normalizedHeaderRange.startDate, endDate: normalizedHeaderRange.endDate });
                        }
                        setDateFilterMode("next-week");
                        setDashboardDateRange(nextWeekQuickRange);
                      }}
                    >
                      Next week
                    </button>
                    <button
                      type="button"
                      className={`app-topbar-quick-btn${isCustomRangeSelected ? " is-active" : ""}`}
                      disabled={headerDateRangeDisabled}
                      onClick={() => {
                        setDateFilterMode("custom");
                        setDashboardDateRange(buildDateRangeSelection({ startDate: lastNonQuickRange.startDate, endDate: lastNonQuickRange.endDate, minDate: MIN_DASHBOARD_DATE }));
                      }}
                    >
                      Custom range
                    </button>
                  </>
                ) : (
                  <label className={`app-topbar-date-field${headerDateRangeUsesWeekPreset ? " is-active" : ""}`}>
                    <span className="app-topbar-date-label">Filter by week</span>
                    <select
                      className={`app-topbar-quick-btn${headerDateRangeUsesWeekPreset ? " is-active" : ""}`}
                      disabled={headerDateRangeDisabled}
                      value={weekFilterSelection}
                      onChange={(event) => {
                        const nextOption = monthWeekOptions.find((option) => option.id === event.target.value);
                        if (!nextOption) {
                          return;
                        }

                        setWeekFilterSelection(nextOption.id);
                        setDashboardDateRange(
                          buildDateRangeSelection({
                            startDate: nextOption.weekStart,
                            endDate: nextOption.weekEnd,
                            minDate: MIN_DASHBOARD_DATE,
                          })
                        );
                      }}
                    >
                      {monthWeekOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={`app-topbar-date-field${headerDateRangeUsesManualDates ? " is-active" : ""}`}>
                  <span className="app-topbar-date-label">Start date</span>
                  <input
                    className="app-topbar-date-input"
                    type="date"
                    min={MIN_DASHBOARD_DATE}
                    max={normalizedHeaderRange.endDate}
                    value={normalizedHeaderRange.startDate}
                    disabled={headerDateRangeDisabled}
                    onChange={(event) => {
                      setDashboardDateRange((current) =>
                        buildDateRangeSelection({
                          startDate: event.target.value,
                          endDate: current?.endDate || normalizedHeaderRange.endDate,
                          minDate: MIN_DASHBOARD_DATE,
                        })
                      );
                    }}
                  />
                </label>
                <label className={`app-topbar-date-field${headerDateRangeUsesManualDates ? " is-active" : ""}`}>
                  <span className="app-topbar-date-label">End date</span>
                  <input
                    className="app-topbar-date-input"
                    type="date"
                    min={normalizedHeaderRange.startDate || MIN_DASHBOARD_DATE}
                    value={normalizedHeaderRange.endDate}
                    disabled={headerDateRangeDisabled}
                    onChange={(event) => {
                      setDashboardDateRange((current) =>
                        buildDateRangeSelection({
                          startDate: current?.startDate || normalizedHeaderRange.startDate,
                          endDate: event.target.value,
                          minDate: MIN_DASHBOARD_DATE,
                        })
                      );
                    }}
                  />
                </label>
                <div className="app-topbar-range-note">
                  {`Selected date range ${formatWeekRangeLabel(normalizedHeaderRange.startDate, normalizedHeaderRange.endDate)}`}
                </div>
              </div>
            ) : null}
              <label className="theme-switch" aria-label="Toggle dark mode">
                <span className="theme-switch-label">{themeMode === "dark" ? "Dark" : "Light"}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={themeMode === "dark"}
                  onChange={(event) => setThemeMode(event.target.checked ? "dark" : "light")}
                />
                <span className="theme-switch-track" aria-hidden="true">
                  <span className="theme-switch-thumb" />
                </span>
              </label>
            </div>
          </div>

          {dashboardIsRefreshing ? (
            <div className="dashboard-loading-layer" aria-live="polite">
              <div className="dashboard-loading-strip" aria-hidden="true" />
            </div>
          ) : null}

          <div className={`ops-shell ${dashboardIsRefreshing ? "is-refreshing" : ""}`}>
            {activeView === "leadership-overview" ? (
              <div className="section-shell">
                <LeadershipOverviewContent
                  leadershipOverviewData={leadershipOverviewData}
                  leadershipOverviewLoading={leadershipOverviewLoading}
                  leadershipOverviewError={leadershipOverviewError}
                  onNavigate={setActiveView}
                  acdMetricsData={acdMetricsData}
                  acdMetricsLoading={acdMetricsLoading}
                />
              </div>
            ) : null}

            {activeView === "overview" ? (
              <div className="section-shell">
                <OverviewContent
                  overviewData={overviewData}
                  overviewLoading={overviewLoading}
                  overviewError={overviewError}
                  acdMetricsData={acdMetricsData}
                  acdMetricsLoading={acdMetricsLoading}
                  onShare={copySection}
                  copyingSection={copyingSection}
                  includeNewShowsPod={includeNewShowsPod}
                  onIncludeNewShowsPodChange={setIncludeNewShowsPod}
                />
              </div>
            ) : null}

            {activeView === "pod-wise" ? (
              <div className="section-shell">
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                  <div className="week-toggle-group">
                    {[
                      { id: "performance", label: "Performance" },
                      { id: "tasks", label: "Tasks" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={podWiseView === opt.id ? "is-active" : ""}
                        onClick={() => setPodWiseView(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {podWiseView === "performance" ? (
                  <PodWiseContent
                    competitionPodRows={competitionData?.podRows}
                    competitionLoading={competitionLoading}
                    competitionWeekLabel={competitionData?.weekLabel}
                    performanceRangeMode={podPerformanceRangeMode}
                    onPerformanceRangeModeChange={setPodPerformanceRangeMode}
                    performanceScope={podPerformanceScope}
                    onPerformanceScopeChange={setPodPerformanceScope}
                    onShare={copySection}
                    copyingSection={copyingSection}
                  />
                ) : (
                  <PodTasksContent
                    podTasksData={podTasksData}
                    podTasksLoading={podTasksLoading}
                    onShare={copySection}
                    copyingSection={copyingSection}
                  />
                )}
              </div>
            ) : null}

            {activeView === "beats-performance" || activeView === "beats-performance-v2" ? (
              <div className="section-shell">
                <BeatsPerformanceContent
                  beatsPerformanceData={beatsPerformanceData}
                  beatsPerformanceLoading={beatsPerformanceLoading}
                  beatsPerformanceError={beatsPerformanceError}
                  onShare={copySection}
                  copyingSection={copyingSection}
                  onNavigate={setActiveView}
                  selectedDateRange={dashboardDateRange}
                  isV2={activeView === "beats-performance-v2"}
                  competitionPodRows={v2CompetitionData?.podRows}
                />
              </div>
            ) : null}

            {activeView === "planner" ? (
              <div className="section-shell">
                <PlannerErrorBoundary>
                  <GanttTracker onPlannerSnapshotChange={setPlannerBoardSnapshot} />
                </PlannerErrorBoundary>
              </div>
            ) : null}

            {activeView === "planner2" ? (
              <div className="section-shell">
                <Planner2Content
                  planner2Data={planner2Data}
                  planner2Loading={planner2Loading}
                  planner2Error={planner2Error}
                  onShare={copySection}
                  copyingSection={copyingSection}
                />
              </div>
            ) : null}


            {activeView === "analytics" ? (
              <div className="section-shell">
                <AnalyticsContent
                  analyticsData={analyticsData}
                  analyticsLoading={analyticsLoading}
                  analyticsError={analyticsError}
                  onShare={copySection}
                  copyingSection={copyingSection}
                  onToggleActioned={updateAnalyticsActioned}
                  actionedBusyKey={analyticsActionedBusyKey}
                />
              </div>
            ) : null}

            {activeView === "production" ? (
              <div className="section-shell">
                <ProductionContent
                  acdMetricsData={acdMetricsData}
                  acdMetricsLoading={acdMetricsLoading}
                  acdMetricsError={acdMetricsError}
                  productionPipelineData={productionPipelineData}
                  productionPipelineLoading={productionPipelineLoading}
                  acdTimeView={acdTimeView}
                  onTimeViewChange={setAcdTimeView}
                  acdViewType={acdViewType}
                  onViewTypeChange={setAcdViewType}
                  onRunSync={runAcdSync}
                  busyAction={busyAction}
                  onShare={copySection}
                  copyingSection={copyingSection}
                />
              </div>
            ) : null}

            {activeView === "details" ? (
              <div className="section-shell">
                <DetailsContent
                  acdMetricsData={acdMetricsData}
                  acdMetricsLoading={acdMetricsLoading}
                  acdMetricsError={acdMetricsError}
                  analyticsData={analyticsData}
                />
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <Notice notice={notice} />
    </>
  );
}
