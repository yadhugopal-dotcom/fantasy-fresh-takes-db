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
import { buildDateRangeSelection, MIN_DASHBOARD_DATE, WEEK_VIEW_OPTIONS, formatWeekRangeLabel, getWeekSelection, getWeekViewLabel, normalizeWeekView } from "../lib/week-view.js";

// ─── View imports ─────────────────────────────────────────────────────────────
import DetailsContent from "./views/DetailsView.jsx";
import OverviewContent from "./views/OverviewView.jsx";
import LeadershipOverviewContent from "./views/LeadershipOverviewView.jsx";
import AnalyticsContent from "./views/AnalyticsView.jsx";
import PodWiseContent, { PodTasksContent } from "./views/PodWiseView.jsx";
import BeatsPerformanceContent from "./views/BeatsPerformanceView.jsx";
import ProductionContent from "./views/ProductionView.jsx";
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function UnifiedOpsApp() {
  const [activeView, setActiveView] = useState("leadership-overview");
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
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsActionedBusyKey, setAnalyticsActionedBusyKey] = useState("");
  const [acdMetricsData, setAcdMetricsData] = useState(null);
  const [acdMetricsLoading, setAcdMetricsLoading] = useState(true);
  const [acdMetricsError, setAcdMetricsError] = useState("");
  const [acdTimeView, setAcdTimeView] = useState("rolling7");
  const [acdViewType, setAcdViewType] = useState("acd");
  const [busyAction, setBusyAction] = useState("");
  const [copyingSection, setCopyingSection] = useState("");
  const [includeNewShowsPod, setIncludeNewShowsPod] = useState(false);
  const [notice, setNotice] = useState(null);
  const [podWiseView, setPodWiseView] = useState("performance");
  const [podTasksData, setPodTasksData] = useState(null);
  const [podTasksLoading, setPodTasksLoading] = useState(false);
  const [beatsPerformanceData, setBeatsPerformanceData] = useState(null);
  const [beatsPerformanceLoading, setBeatsPerformanceLoading] = useState(false);
  const [beatsPerformanceError, setBeatsPerformanceError] = useState("");
  const normalizedHeaderRange = useMemo(
    () => buildDateRangeSelection({ ...dashboardDateRange, minDate: MIN_DASHBOARD_DATE }),
    [dashboardDateRange]
  );
  const headerSupportsDateRange =
    activeView === "overview" ||
    activeView === "leadership-overview" ||
    activeView === "pod-wise" ||
    activeView === "analytics";
  const headerDateRangeDisabled =
    (activeView === "overview" && overviewLoading) ||
    (activeView === "leadership-overview" && leadershipOverviewLoading) ||
    (activeView === "pod-wise" && competitionLoading) ||
    (activeView === "analytics" && analyticsLoading && !analyticsData);
  const lastWeekQuickRange = useMemo(
    () =>
      buildDateRangeSelection({
        startDate: getWeekSelection("last").weekStart,
        endDate: getWeekSelection("last").weekEnd,
        minDate: MIN_DASHBOARD_DATE,
      }),
    []
  );
  const isLastWeekSelected =
    normalizedHeaderRange.startDate === lastWeekQuickRange.startDate &&
    normalizedHeaderRange.endDate === lastWeekQuickRange.endDate;

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

  useEffect(() => {
    if (activeView !== "overview") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);

    async function loadOverviewSection() {
      setOverviewLoading(true);
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
        }
      } catch (error) {
        if (!cancelled) {
          setOverviewData(null);
          setOverviewError(error.message || "Unable to load Overview metrics.");
          setOverviewLoading(false);
        }
      }
    }

    void loadOverviewSection();
    return () => {
      cancelled = true;
    };
  }, [activeView, dashboardDateRange, includeNewShowsPod]);

  useEffect(() => {
    if (activeView !== "leadership-overview") {
      return undefined;
    }

    let cancelled = false;
    const rangeSelection = buildDateRangeSelection(dashboardDateRange);

    async function loadLeadershipOverview() {
      setLeadershipOverviewLoading(true);
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
        }
      } catch (error) {
        if (!cancelled) {
          setLeadershipOverviewData(null);
          setLeadershipOverviewError(error?.message || "Unable to load Overview.");
          setLeadershipOverviewLoading(false);
        }
      }
    }

    void loadLeadershipOverview();
    return () => {
      cancelled = true;
    };
  }, [activeView, dashboardDateRange]);

  useEffect(() => {
    if (activeView !== "pod-wise" || podWiseView !== "performance") {
      return undefined;
    }

    let cancelled = false;

    async function loadCompetition() {
      setCompetitionLoading(true);
      try {
        const rangeSelection = buildDateRangeSelection(dashboardDateRange);
        const response = await fetch(
          `/api/dashboard/competition?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}`,
          { cache: "no-store" }
        );
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load competition data.");
        }

        if (!cancelled) {
          setCompetitionData(payload);
        }
      } catch {
        if (!cancelled) {
          setCompetitionData(null);
        }
      } finally {
        if (!cancelled) {
          setCompetitionLoading(false);
        }
      }
    }

    void loadCompetition();
    return () => {
      cancelled = true;
    };
  }, [activeView, podWiseView, dashboardDateRange]);

  useEffect(() => {
    if (activeView !== "pod-wise" || podWiseView !== "tasks") {
      return undefined;
    }
    if (podTasksData) {
      return undefined;
    }

    let cancelled = false;

    async function loadPodTasks() {
      setPodTasksLoading(true);
      try {
        const response = await fetch("/api/dashboard/pod-tasks", { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load POD tasks.");
        }
        if (!cancelled) {
          setPodTasksData(payload);
        }
      } catch {
        if (!cancelled) {
          setPodTasksData(null);
        }
      } finally {
        if (!cancelled) {
          setPodTasksLoading(false);
        }
      }
    }

    void loadPodTasks();
    return () => {
      cancelled = true;
    };
  }, [activeView, podWiseView, podTasksData]);

  useEffect(() => {
    if (activeView !== "beats-performance") {
      return undefined;
    }

    let cancelled = false;

    async function loadBeatsPerformance() {
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
              setBeatsPerformanceData(parsedCache.payload);
              setBeatsPerformanceError("");
              setBeatsPerformanceLoading(false);
            }
          }
        }
      } catch {}

      if (!hasCachedPayload) {
        setBeatsPerformanceLoading(true);
        setBeatsPerformanceError("");
      }

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
        }
      }
    }

    void loadBeatsPerformance();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "analytics") {
      return undefined;
    }

    let cancelled = false;

    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError("");

      try {
        const rangeSelection = buildDateRangeSelection(dashboardDateRange);
        const analyticsUrl = `/api/dashboard/analytics?startDate=${encodeURIComponent(rangeSelection.startDate)}&endDate=${encodeURIComponent(rangeSelection.endDate)}`;
        const response = await fetch(analyticsUrl, { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Analytics dashboard.");
        }

        if (!cancelled) {
          setAnalyticsData(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setAnalyticsData(null);
          setAnalyticsError(error.message || "Unable to load Analytics dashboard.");
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
        }
      }
    }

    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [activeView, dashboardDateRange]);

  async function requestAcdMetrics(cancelState = null) {
    if (!cancelState?.cancelled) {
      setAcdMetricsLoading(true);
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
      }

      return payload;
    } catch (error) {
      if (!cancelState?.cancelled) {
        setAcdMetricsData(null);
        setAcdMetricsError(error.message || "Unable to load ACD productivity.");
      }
      throw error;
    } finally {
      if (!cancelState?.cancelled) {
        setAcdMetricsLoading(false);
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
    if (activeView !== "production" && activeView !== "details") {
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
    "pod-wise": "POD Wise",
    planner: "Planner",
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
            {[
              ["leadership-overview", "Overview"],
              ["overview", "Editorial Funnel"],
              ["beats-performance", "Beats Performance"],
              ["pod-wise", "POD Wise"],
              ["planner", "Planner"],
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

          <div className="sidebar-section">
            <div className="sidebar-section-label">MORE</div>
            <button
              type="button"
              className={`sidebar-link${activeView === "details" ? " active" : ""}`}
              onClick={() => setActiveView("details")}
            >
              Details
            </button>
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
                  <button
                    type="button"
                    className={`app-topbar-quick-btn${isLastWeekSelected ? " is-active" : ""}`}
                    disabled={headerDateRangeDisabled}
                    onClick={() => setDashboardDateRange(lastWeekQuickRange)}
                  >
                    Last week
                  </button>
                  <label className="app-topbar-date-field">
                    <span className="app-topbar-date-label">Start date</span>
                    <input
                      className="app-topbar-date-input"
                      type="date"
                      min={MIN_DASHBOARD_DATE}
                      max={normalizedHeaderRange.endDate}
                      value={normalizedHeaderRange.startDate}
                      disabled={headerDateRangeDisabled}
                      onChange={(event) =>
                        setDashboardDateRange((current) =>
                          buildDateRangeSelection({
                            startDate: event.target.value,
                            endDate: current?.endDate || normalizedHeaderRange.endDate,
                            minDate: MIN_DASHBOARD_DATE,
                          })
                        )
                      }
                    />
                  </label>
                  <label className="app-topbar-date-field">
                    <span className="app-topbar-date-label">End date</span>
                    <input
                      className="app-topbar-date-input"
                      type="date"
                      min={normalizedHeaderRange.startDate || MIN_DASHBOARD_DATE}
                      value={normalizedHeaderRange.endDate}
                      disabled={headerDateRangeDisabled}
                      onChange={(event) =>
                        setDashboardDateRange((current) =>
                          buildDateRangeSelection({
                            startDate: current?.startDate || normalizedHeaderRange.startDate,
                            endDate: event.target.value,
                            minDate: MIN_DASHBOARD_DATE,
                          })
                        )
                      }
                    />
                  </label>
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

          <div className="ops-shell">
            {activeView === "leadership-overview" ? (
              <div className="section-shell">
                <LeadershipOverviewContent
                  leadershipOverviewData={leadershipOverviewData}
                  leadershipOverviewLoading={leadershipOverviewLoading}
                  leadershipOverviewError={leadershipOverviewError}
                  onNavigate={setActiveView}
                />
              </div>
            ) : null}

            {activeView === "overview" ? (
              <div className="section-shell">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none", color: "var(--ink)" }}>
                    <input
                      type="checkbox"
                      checked={includeNewShowsPod}
                      onChange={(e) => setIncludeNewShowsPod(e.target.checked)}
                      style={{ accentColor: "var(--forest)" }}
                    />
                    Include new shows POD
                  </label>
                </div>
                <OverviewContent
                  overviewData={overviewData}
                  overviewLoading={overviewLoading}
                  overviewError={overviewError}
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

            {activeView === "beats-performance" ? (
              <div className="section-shell">
                <BeatsPerformanceContent
                  beatsPerformanceData={beatsPerformanceData}
                  beatsPerformanceLoading={beatsPerformanceLoading}
                  beatsPerformanceError={beatsPerformanceError}
                  onShare={copySection}
                  copyingSection={copyingSection}
                />
              </div>
            ) : null}

            {activeView === "planner" ? (
              <PlannerErrorBoundary>
                <GanttTracker onPlannerSnapshotChange={setPlannerBoardSnapshot} />
              </PlannerErrorBoundary>
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
