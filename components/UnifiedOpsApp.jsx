"use client";

import { Component, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import GanttTracker from "./GanttTracker.jsx";
import { copyNodeImageToClipboard } from "../lib/clipboard-share.js";
import { matchAngleName } from "../lib/fuzzy-match.js";
import {
  buildPlannerBeatInventory,
  buildPlannerStageMetrics,
  getCurrentWeekKey,
  isVisiblePlannerPodLeadName,
  shiftWeekKey,
} from "../lib/tracker-data.js";
import { WEEK_VIEW_OPTIONS, getWeekSelection, getWeekViewLabel, normalizeWeekView } from "../lib/week-view.js";

const OVERVIEW_PERIODS = ["current", "last", "next"];
const ACD_TIME_OPTIONS = [
  { id: "rolling7", label: "Rolling 7D" },
  { id: "rolling14", label: "Rolling 14D" },
  { id: "rolling30", label: "Rolling 30D" },
];
const ACD_VIEW_OPTIONS = [
  { id: "acd", label: "ACD" },
  { id: "cd", label: "CD" },
];
const EMPTY_ACD_MESSAGE = "No valid ACD output data available yet from Live tab sync.";
const CHART_TONE_POSITIVE = "#2d5a3d";
const CHART_TONE_WARNING = "#c2703e";
const CHART_TONE_DANGER = "#9f2e2e";
const WRITER_TARGET_PER_WEEK = 1.5;
const ANALYTICS_LEGEND_FALLBACK = [
  { label: "Gen AI", tone: "gen-ai" },
  { label: "P1 Rework", tone: "rework-p1" },
  { label: "P2 Rework", tone: "rework-p2" },
  { label: "Testing / Drop", tone: "testing-drop" },
  { label: "Metric not meeting", tone: "metric-miss" },
];
const BEATS_PERFORMANCE_CLIENT_CACHE_KEY = "beats-performance-dashboard-v1";
const BEATS_PERFORMANCE_CLIENT_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function formatDateLabel(value) {
  if (!value) return "-";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTimeLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function formatTat(value) {
  return value === null || value === undefined ? "-" : `${formatNumber(value)} d`;
}

function formatMetricValue(value) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function formatCurrency(value) {
  return value === null || value === undefined ? "-" : `$${Number(value).toFixed(2)}`;
}

function formatPercent(value) {
  return value === null || value === undefined ? "-" : `${formatNumber(value)}%`;
}

function formatRatioValue(value) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function getDeltaMeta(currentValue, previousValue, noun = "vs last week") {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const delta = current - previous;

  if (delta === 0) {
    return {
      text: `No change ${noun}`,
      color: "var(--subtle)",
    };
  }

  const direction = delta > 0 ? "+" : "-";
  return {
    text: `${direction}${formatMetricValue(Math.abs(delta))} ${noun}`,
    color: delta > 0 ? "#2d8a57" : "#c74a3a",
  };
}

function normalizePodFilterKey(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeStageMatchKey(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatAnalyticsMetricValue(metric, format) {
  const value = metric?.value;
  if (format === "text") {
    return value === null || value === undefined || value === "" ? "-" : String(value);
  }

  if (format === "currency") {
    return formatCurrency(value);
  }

  if (format === "percent") {
    return formatPercent(value);
  }

  return formatMetricValue(value);
}

function getAnalyticsLegendToneClass(tone) {
  if (tone === "gen-ai") return "legend-gen-ai";
  if (tone === "rework-p1") return "legend-rework-p1";
  if (tone === "rework-p2") return "legend-rework-p2";
  if (tone === "testing-drop") return "legend-testing-drop";
  if (tone === "metric-miss") return "legend-metric-miss";
  return "legend-neutral";
}

function getAnalyticsNextStepToneClass(rowTone) {
  if (rowTone === "gen-ai") return "tone-gen-ai";
  if (rowTone === "rework-p1") return "tone-rework-p1";
  if (rowTone === "rework-p2") return "tone-rework-p2";
  if (rowTone === "testing-drop") return "tone-testing-drop";
  return "tone-neutral";
}

function getPodOrderIndex(podLeadName, podOrder) {
  const index = Array.isArray(podOrder) ? podOrder.indexOf(podLeadName) : -1;
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

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

function getTargetCardTone(actualValue, targetValue) {
  const actual = Number(actualValue);
  const target = Number(targetValue);

  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) {
    return "default";
  }

  // Explicit completion bands:
  // < 60% = deep red
  // 60% to < 85% = red
  // 85% to < 100% = brown
  // >= 100% = green
  const ratio = actual / target;

  if (ratio < 0.6) {
    return "danger-strong";
  }

  if (ratio < 0.85) {
    return "danger";
  }

  if (ratio < 1) {
    return "warning";
  }

  return ratio >= 1.15 ? "positive-strong" : "positive";
}

function getTatCardTone(value, target) {
  const actual = Number(value);
  const safeTarget = Number(target || 1);

  if (!Number.isFinite(actual) || !Number.isFinite(safeTarget) || safeTarget <= 0) {
    return "default";
  }

  // TAT north star is 1 day. Lower is better:
  // <= 1 day = green
  // > 1 and <= 1.5 days = brown
  // > 1.5 and <= 2.5 days = red
  // > 2.5 days = deeper red
  if (actual <= safeTarget) {
    return "positive";
  }

  if (actual <= safeTarget * 1.5) {
    return "warning";
  }

  if (actual <= safeTarget * 2.5) {
    return "danger";
  }

  return "danger-strong";
}

function getWritingDaysTone(value) {
  const actual = Number(value);
  if (!Number.isFinite(actual)) {
    return "default";
  }

  return actual > 3 ? "warning" : "default";
}

function getClReviewDaysTone(value) {
  const actual = Number(value);
  if (!Number.isFinite(actual)) {
    return "default";
  }

  return actual > 1 ? "warning" : "default";
}

function getChartBarColor(index, totalCount) {
  const safeTotalCount = Number(totalCount || 0);
  if (!Number.isFinite(safeTotalCount) || safeTotalCount <= 0) {
    return CHART_TONE_POSITIVE;
  }

  const topCutoff = Math.ceil(safeTotalCount / 3);
  const middleCutoff = Math.ceil((safeTotalCount * 2) / 3);
  if (index < topCutoff) return CHART_TONE_POSITIVE;
  if (index < middleCutoff) return CHART_TONE_WARNING;
  return CHART_TONE_DANGER;
}

function MetricCard({ label, value, hint, tone = "default", body = null, className = "", unit = "" }) {
  return (
    <article className={`metric-card tone-${tone} ${className}`.trim()}>
      <div className="metric-label">{label}</div>
      {body ? (
        <div className="metric-body">{body}</div>
      ) : (
        <div className="metric-value">
          {value}
          {unit ? <span className="metric-unit">{unit}</span> : null}
        </div>
      )}
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </article>
  );
}

function ProgressBar({ value, target, color = "var(--terracotta)" }) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div className="metric-progress-bar">
      <div className="metric-progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function ReadinessRow({ color, label, value }) {
  return (
    <div className="readiness-row">
      <span className="readiness-dot" style={{ background: color }} />
      <span className="readiness-label">{label}</span>
      <span className="readiness-value" style={{ color }}>{value}</span>
    </div>
  );
}

function getReadinessColor(ratio) {
  if (ratio >= 1) return "#2d5a3d";
  if (ratio >= 0.5) return "#9f6b15";
  return "#9f2e2e";
}

function getHitRateColor(rate) {
  if (rate >= 50) return "#2d5a3d";
  if (rate >= 30) return "#9f6b15";
  return "#9f2e2e";
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function DetailsContent({ acdMetricsData, acdMetricsLoading, acdMetricsError, analyticsData }) {
  const trackedTeams = Array.isArray(acdMetricsData?.trackedTeams) ? acdMetricsData.trackedTeams : [];
  const legendItems = Array.isArray(analyticsData?.legend) && analyticsData.legend.length > 0
    ? analyticsData.legend
    : ANALYTICS_LEGEND_FALLBACK;

  return (
    <div className="section-stack">
      <div className="panel-grid two-col">
        <section className="panel-card">
          <div className="panel-title">Teams currently being tracked</div>
          <div className="section-subtitle">
            ACD sync reads from the Live tab only, processes Final image sheet links from column AZ, and reports only
            rows stored as <code>live_tab_sync</code>.
          </div>
          <div className="section-stack" style={{ marginTop: 16 }}>
            {acdMetricsLoading ? (
              <div className="details-panel-empty">Loading tracked teams...</div>
            ) : acdMetricsError ? (
              <div className="details-panel-empty">{acdMetricsError}</div>
            ) : trackedTeams.length === 0 ? (
              <div className="details-panel-empty">No tracked team data is available yet.</div>
            ) : (
              <div className="details-team-grid">
                {trackedTeams.map((team) => {
                  const acdNames = Array.isArray(team?.acdNames) ? team.acdNames.filter(Boolean) : [];
                  return (
                    <article key={team.cdName || "unknown-cd"} className="details-team-card">
                      <div className="details-team-name">{team.cdName || "Unknown CD"}</div>
                      {acdNames.length > 0 ? (
                        <div className="details-team-acds">
                          {acdNames.map((acdName) => (
                            <span key={`${team.cdName}-${acdName}`} className="pill pill-neutral">
                              {acdName}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="details-panel-empty">No live synced ACDs yet.</div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-title">Analytics legend</div>
          <div className="section-subtitle">Use this to decide which attempts are ready for Full Gen AI, need rework, or should be dropped.</div>
          <div className="details-legend-list">
            {legendItems.map((item) => (
              <div key={item.label} className="details-legend-item">
                <span className={`details-legend-swatch ${getAnalyticsLegendToneClass(item.tone)}`.trim()} />
                <div>
                  <strong>{item.label}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel-card">
        <div className="panel-title">Next step logic</div>
        <div className="section-subtitle">
          Amount spent is a hard gate. Assets with less than $100 spend are classified as Testing / Drop.
          Attempts without a readable CPI are excluded from Analytics entirely.
        </div>
        <div className="details-logic-grid">
          <article className="details-logic-card">
            <div className="details-panel-subtitle">Gen AI</div>
            <ul className="rules-list">
              <li>
                <strong>Gen AI</strong>: Amount spent must be at least $100, CPI must be below $10, and no more than
                two baseline benchmark checks can miss across 3 sec plays, Thruplays / 3s plays, Q1 completion,
                Absolute completion, CTI, and Amount spent.
              </li>
            </ul>
          </article>
          <article className="details-logic-card">
            <div className="details-panel-subtitle">Rework</div>
            <ul className="rules-list">
              <li>
                <strong>P1 Rework</strong>: Amount spent is at least $100, does not qualify for Gen AI, and CTI is 12% or above.
              </li>
              <li>
                <strong>P2 Rework</strong>: Amount spent is at least $100, does not qualify for Gen AI, and CTI is below 12%.
              </li>
            </ul>
          </article>
          <article className="details-logic-card">
            <div className="details-panel-subtitle">Testing / Drop</div>
            <ul className="rules-list">
              <li>
                <strong>Testing / Drop</strong>: Amount spent is below $100. Shown at the bottom of the table.
              </li>
            </ul>
          </article>
        </div>
        <div className="details-panel-copy">
          <strong>Actioned</strong> is a shared saved checkbox for each week and asset code. It requires unlocked edit
          access to change, and actioned rows are hidden by default in Analytics until you choose to show them.
        </div>
      </section>
    </div>
  );
}

class PlannerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Planner render failed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="section-shell">
          <div className="panel-card">
            <div className="section-kicker">Planner</div>
            <div className="section-subtitle" style={{ marginTop: 6 }}>
              Planner hit a client-side error while loading this week. Refresh the page or switch weeks; if the data is
              incomplete, the Planner will fall back safely once reloaded.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function WeekToggleGroup({ value, onChange, disabled = false }) {
  return (
    <div className="week-toggle-group" role="tablist" aria-label="Week filter">
      {WEEK_VIEW_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? "is-active" : ""}
          onClick={() => onChange(option.id)}
          disabled={disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toolbar({ title, subtitle, actions, children }) {
  return (
    <div className="section-shell">
      <div className="section-toolbar">
        <div>
          <div className="section-kicker">{title}</div>
          {subtitle ? <div className="section-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ShareButton({ onClick, busy = false }) {
  return (
    <button
      type="button"
      className="share-button"
      onClick={onClick}
      disabled={busy}
      data-share-ignore="true"
    >
      {busy ? "Copying..." : "Copy to clipboard"}
    </button>
  );
}

function ShareablePanel({ shareLabel, onShare, isSharing = false, className = "", children }) {
  const panelRef = useRef(null);

  return (
    <section ref={panelRef} className={`panel-card shareable-panel ${className}`.trim()}>
      <div className="share-panel-top" data-share-ignore="true">
        <ShareButton onClick={() => void onShare(panelRef.current, shareLabel)} busy={isSharing} />
      </div>
      {children}
    </section>
  );
}

function ToggleGroup({ label, options, value, onChange, disabled = false }) {
  return (
    <div className="toggle-stack" role="group" aria-label={label}>
      <div className="toggle-label">{label}</div>
      <div className="toggle-row">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`ghost-button toggle-chip ${value === option.id ? "is-active" : ""}`}
            onClick={() => onChange(option.id)}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function getAcdViewLabel(viewType) {
  return viewType === "cd" ? "CD" : "ACD";
}

function getAcdTimeViewLabel(mode) {
  if (mode === "rolling7") return "Rolling 7D";
  if (mode === "rolling14") return "Rolling 14D";
  if (mode === "rolling30") return "Rolling 30D";
  return "Rolling 7D";
}

function normalizeAcdMetrics(input) {
  const data = input && typeof input === "object" ? input : {};

  return {
    latestWorkDate: String(data.latestWorkDate || ""),
    dailyRows: Array.isArray(data.dailyRows) ? data.dailyRows : [],
    rolling7Rows: Array.isArray(data.rolling7Rows) ? data.rolling7Rows : [],
    rolling14Rows: Array.isArray(data.rolling14Rows) ? data.rolling14Rows : [],
    rolling30Rows: Array.isArray(data.rolling30Rows) ? data.rolling30Rows : [],
    rolling7CdRows: Array.isArray(data.rolling7CdRows) ? data.rolling7CdRows : [],
    rolling14CdRows: Array.isArray(data.rolling14CdRows) ? data.rolling14CdRows : [],
    rolling30CdRows: Array.isArray(data.rolling30CdRows) ? data.rolling30CdRows : [],
    trackedTeams: Array.isArray(data.trackedTeams) ? data.trackedTeams : [],
    syncStatus: data.syncStatus && typeof data.syncStatus === "object" ? data.syncStatus : {},
    failureReasonRows: Array.isArray(data.failureReasonRows) ? data.failureReasonRows : [],
    emptyStateMessage: String(data.emptyStateMessage || EMPTY_ACD_MESSAGE),
  };
}

function getAcdLeaderboardDataset(metricsInput, mode, viewType) {
  const metrics = normalizeAcdMetrics(metricsInput);
  const safeMode = mode === "rolling14" || mode === "rolling30" ? mode : "rolling7";
  const safeViewType = viewType === "cd" ? "cd" : "acd";

  let rows = [];
  let meta = "Rolling 7D chart by total minutes.";

  if (safeMode === "rolling7") {
    const source = safeViewType === "cd" ? metrics.rolling7CdRows : metrics.rolling7Rows;
    rows = (source || []).map((row) => ({
      name: safeViewType === "cd" ? String(row.cdName || "") : String(row.acdName || ""),
      totalMinutes: Number(row.totalMinutes || 0),
      totalImages: Number(row.totalImages || 0),
    }));
    meta = "Rolling 7D chart by total minutes.";
  } else if (safeMode === "rolling14") {
    const source = safeViewType === "cd" ? metrics.rolling14CdRows : metrics.rolling14Rows;
    rows = (source || []).map((row) => ({
      name: safeViewType === "cd" ? String(row.cdName || "") : String(row.acdName || ""),
      totalMinutes: Number(row.totalMinutes || 0),
      totalImages: Number(row.totalImages || 0),
    }));
    meta = "Rolling 14D chart by total minutes.";
  } else {
    const source = safeViewType === "cd" ? metrics.rolling30CdRows : metrics.rolling30Rows;
    rows = (source || []).map((row) => ({
      name: safeViewType === "cd" ? String(row.cdName || "") : String(row.acdName || ""),
      totalMinutes: Number(row.totalMinutes || 0),
      totalImages: Number(row.totalImages || 0),
    }));
    meta = "Rolling 30D chart by total minutes.";
  }

  rows = rows
    .filter((row) => row.name)
    .sort((a, b) => Number(b.totalMinutes || 0) - Number(a.totalMinutes || 0) || a.name.localeCompare(b.name));

  return {
    viewType: safeViewType,
    mode: safeMode,
    latestWorkDate: metrics.latestWorkDate,
    meta,
    rows,
  };
}

function buildAcdSyncMeta(syncStatus) {
  const latest = syncStatus?.latestRun;
  if (!latest?.createdAt) {
    return "No ACD sync runs found yet. Daily cron will populate this.";
  }

  return `Last ACD sync: ${formatDateTimeLabel(latest.createdAt)} | Live rows: ${formatNumber(
    latest.processedLiveRows
  )} | Eligible: ${formatNumber(latest.eligibleLiveRows)} | Sheets attempted: ${formatNumber(
    latest.sheetLinksAttempted
  )} | Failed: ${formatNumber(latest.sheetLinksFailed)}`;
}

function buildAcdAdherenceMeta(syncStatus) {
  const cutoffDate = syncStatus?.cutoffDate ? formatDateLabel(syncStatus.cutoffDate) : "2026-03-16";
  const totalFailedSheets = Number(syncStatus?.totalFailedSheets || 0);
  const rows = Array.isArray(syncStatus?.adherenceIssueRows) ? syncStatus.adherenceIssueRows : [];

  if (!rows.length) {
    return `Unread or invalid image sheets since ${cutoffDate}. No adherence failures logged.`;
  }

  return `Unread or invalid image sheets since ${cutoffDate}. Failed sheets logged: ${formatNumber(
    totalFailedSheets
  )}. Grouped by CD and ACD.`;
}

function AcdChartTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const row = payload[0]?.payload || {};
  return (
    <div className="acd-chart-tooltip">
      <div className="acd-chart-tooltip-title">{label || row.name || "-"}</div>
      <div className="acd-chart-tooltip-row">
        <span>Minutes</span>
        <strong>{formatNumber(row.totalMinutes)}</strong>
      </div>
      <div className="acd-chart-tooltip-row">
        <span>Total images</span>
        <strong>{formatNumber(row.totalImages)}</strong>
      </div>
    </div>
  );
}

function AcdLeaderboardChart({ rows, viewLabel, emptyText = EMPTY_ACD_MESSAGE }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const chartRows = safeRows.map((row) => ({
    ...row,
    name: String(row.name || ""),
    totalMinutes: Number(row.totalMinutes || 0),
    totalImages: Number(row.totalImages || 0),
  }));
  const chartHeight = Math.max(280, chartRows.length * 44 + 28);
  const yAxisWidth = Math.min(
    220,
    Math.max(
      120,
      chartRows.reduce((max, row) => Math.max(max, String(row.name || "").length * 7), 0)
    )
  );

  if (chartRows.length === 0) {
    return <EmptyState text={emptyText} />;
  }

  return (
    <div className="acd-chart-canvas" role="img" aria-label={`${viewLabel} productivity bar chart`}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartRows}
          layout="vertical"
          margin={{ top: 8, right: 28, left: 8, bottom: 8 }}
          barCategoryGap={12}
        >
          <CartesianGrid horizontal={false} stroke="#ddd6c9" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tick={{ fill: "#a39e93", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            label={{ value: "Minutes", position: "insideBottomRight", offset: -2, fill: "#a39e93", fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={yAxisWidth}
            tick={{ fill: "#1c1917", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgba(20, 107, 101, 0.08)" }} content={<AcdChartTooltip />} />
          <Bar dataKey="totalMinutes" radius={[0, 10, 10, 0]}>
            <LabelList
              dataKey="totalMinutes"
              position="right"
              formatter={(value) => `${formatNumber(value)} min`}
              fill="#1c1917"
              fontSize={12}
            />
            {chartRows.map((row, index) => (
              <Cell key={`${row.name}-${index}`} fill={getChartBarColor(index, chartRows.length)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AcdAdherenceTable({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <div className="table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>CD</th>
            <th>ACD</th>
            <th>Total Assets Not Adhering</th>
            <th>Asset Codes</th>
          </tr>
        </thead>
        <tbody>
          {safeRows.length > 0 ? (
            safeRows.map((row) => {
              const totalAssets = Number(row.totalAssetsNotAdhering || 0);
              const severityClass =
                totalAssets >= 3 ? "adherence-row-high" : totalAssets === 2 ? "adherence-row-medium" : "adherence-row-low";
              const severityLabel = totalAssets >= 3 ? "High" : totalAssets === 2 ? "Medium" : "Low";

              return (
                <tr key={`${row.cdName}-${row.acdName}`} className={severityClass}>
                  <td>{row.cdName || "Unknown"}</td>
                  <td>{row.acdName || "Unknown ACD"}</td>
                  <td>
                    <div className="adherence-count-cell">
                      <span className={`severity-pill ${severityClass}`}>{severityLabel}</span>
                      <strong>{formatNumber(totalAssets)}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="adherence-asset-list">
                      {(Array.isArray(row.assets) ? row.assets : []).length > 0
                        ? row.assets.map((asset) => {
                            const label = asset.assetCode || "-";
                            const href = String(asset.imageSheetLink || "").trim();
                            return href ? (
                              <a
                                key={`${row.cdName}-${row.acdName}-${label}`}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="adherence-asset-link"
                              >
                                {label}
                              </a>
                            ) : (
                              <span key={`${row.cdName}-${row.acdName}-${label}`}>{label}</span>
                            );
                          })
                        : "-"}
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan="4" className="empty-cell">
                No adherence issues found for the selected sync window.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatFailureReasonLabel(reason) {
  const key = String(reason || "")
    .split(":")[0]
    .trim()
    .toLowerCase();

  if (key === "sheet_inaccessible") return "Sheet inaccessible";
  if (key === "missing_final_image_sheet_tab") return "Missing Final image sheet tab";
  if (key === "required_columns_missing") return "Required columns missing";
  if (key === "work_date_parse_failure") return "Work date parse failure";
  if (key === "no_valid_rows_found") return "No valid rows found";
  if (key === "invalid_creative_director") return "Invalid creative director";
  if (key === "missing_asset_code") return "Missing asset code";
  if (!key) return "Other format issue";

  return key
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}

function buildOverviewNotes({ overviewError, overviewData }) {
  const notes = [];

  if (overviewError) {
    notes.push(overviewError);
  } else if (overviewData && overviewData.hasWeekData === false && overviewData.emptyStateMessage) {
    notes.push(overviewData.emptyStateMessage);
  }

  if (overviewData?.goodToGoError) {
    notes.push(overviewData.goodToGoError);
  }

  return notes.filter(Boolean);
}

function getPipelineCardTone(actualValue, targetValue) {
  const actual = Number(actualValue);
  const target = Number(targetValue);
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return "default";
  const ratio = actual / target;
  if (ratio < 0.7) return "danger-strong";
  if (ratio < 0.85) return "danger";
  if (ratio < 1) return "warning";
  return ratio >= 1.15 ? "positive-strong" : "positive";
}

function OverviewCurrentWeek({ overviewData, overviewLoading, overviewError }) {
  const unavailableMetricValue = overviewError ? "-" : null;
  const tatSummary = overviewData?.tatSummary || {};
  const tatDays = tatSummary?.averageTatDays;

  const beatsCount = overviewData?.plannerBeatCount ?? 0;
  const beatsTarget = 25;
  const productionCount = overviewData?.inProductionBeatCount ?? 0;
  const productionTarget = 22;

  return (
    <div className="section-stack">
      <div className="metric-grid three-col">
        <MetricCard
          label="Unique beats this week"
          className="hero-card"
          tone={getPipelineCardTone(beatsCount, beatsTarget)}
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(beatsCount)}
          hint={`Target: ${beatsTarget}+`}
        />
        <MetricCard
          label="Moving to production"
          className="hero-card"
          tone={getPipelineCardTone(productionCount, productionTarget)}
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(productionCount)}
          hint={`Target: ${productionTarget}`}
        />
      </div>
      <div className="metric-grid three-col">
        <MetricCard
          label="Expected production TAT"
          value={overviewLoading ? "..." : unavailableMetricValue || (tatDays !== null && tatDays !== undefined ? formatNumber(tatDays) : "-")}
          unit="days"
          hint="Production cells / unique beats"
          tone={getTatCardTone(tatDays, tatSummary?.targetTatDays)}
        />
        <MetricCard
          label="Scripts per writer"
          value={overviewLoading ? "..." : unavailableMetricValue || (overviewData?.scriptsPerWriter != null ? String(overviewData.scriptsPerWriter) : "-")}
          hint="Beats entering production / writers"
        />
        <MetricCard
          label="Avg CL review days"
          value={overviewLoading ? "..." : unavailableMetricValue || (overviewData?.averageClReviewDays != null ? formatNumber(overviewData.averageClReviewDays) : "-")}
          unit="days"
          hint="CL review cells / unique beats"
          tone={getClReviewDaysTone(overviewData?.averageClReviewDays)}
        />
      </div>
    </div>
  );
}

function OverviewLastWeek({ overviewData, overviewLoading, overviewError }) {
  const unavailableMetricValue = overviewError ? "-" : null;
  const tatSummary = overviewData?.tatSummary || {};
  const tatDays = tatSummary?.averageTatDays;
  const hitRate = overviewData?.hitRate;
  const hitColor = hitRate != null ? getHitRateColor(hitRate) : undefined;

  return (
    <div className="section-stack">
      <div className="metric-grid three-col">
        <MetricCard
          label="Fresh takes released"
          className="hero-card"
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(overviewData?.freshTakeCount)}
          hint="Unique attempts from Live tab"
          tone={getTargetCardTone(overviewData?.freshTakeCount, overviewData?.targetFloor)}
        />
        <MetricCard
          label="Production TAT"
          value={overviewLoading ? "..." : unavailableMetricValue || (tatDays != null ? formatNumber(tatDays) : "-")}
          unit="days"
          hint="From last week's Live tab"
          tone={getTatCardTone(tatDays, tatSummary?.targetTatDays)}
        />
        <MetricCard
          label="Hit rate"
          className="hero-card"
          body={
            <>
              <div className="metric-value" style={hitColor ? { color: hitColor } : undefined}>
                {overviewLoading ? "..." : unavailableMetricValue || (hitRate != null ? `${hitRate.toFixed(1)}%` : "-")}
              </div>
              <div className="metric-hint" style={hitColor ? { color: hitColor } : undefined}>
                {overviewData?.hitRateNumerator ?? 0} of {overviewData?.hitRateDenominator ?? 0} analytics-eligible assets
              </div>
            </>
          }
        />
      </div>

      {Array.isArray(overviewData?.beatsFunnel) && overviewData.beatsFunnel.length > 0 && (
        <>
          <hr className="section-divider" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Beats funnel</div>
            <div style={{ fontSize: 11, color: "var(--subtle)", marginBottom: 12 }}>Show and beat level breakdown for last week</div>
            <table className="beats-funnel-table">
              <colgroup>
                <col className="col-show" />
                <col className="col-beat" />
                <col className="col-attempts" />
                <col className="col-success" />
              </colgroup>
              <thead>
                <tr>
                  <th>SHOW</th>
                  <th>BEAT</th>
                  <th className="col-right">ATTEMPTS</th>
                  <th className="col-right">SUCCESSFUL</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const rows = overviewData.beatsFunnel;
                  const rendered = [];
                  let i = 0;
                  while (i < rows.length) {
                    const showName = rows[i].showName;
                    let j = i;
                    while (j < rows.length && rows[j].showName === showName) j++;
                    const span = j - i;
                    for (let k = i; k < j; k++) {
                      const row = rows[k];
                      const isSuccess = row.successfulAttempts > 0;
                      rendered.push(
                        <tr key={`${row.showName}-${row.beatName}`} className={isSuccess ? "beats-funnel-success" : ""}>
                          {k === i && (
                            <td rowSpan={span} style={{ fontSize: 12, fontWeight: 500, color: "var(--subtle)" }}>
                              {row.showName}
                            </td>
                          )}
                          <td>{row.beatName}</td>
                          <td className="col-right" style={{ fontWeight: 500 }}>{row.attempts}</td>
                          <td
                            className="col-right"
                            style={{
                              fontWeight: 500,
                              color: row.successfulAttempts > 0 ? "#2d5a3d" : "var(--gray-light, #D3D1C7)",
                            }}
                          >
                            {row.successfulAttempts}
                          </td>
                        </tr>
                      );
                    }
                    i = j;
                  }
                  return rendered;
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function OverviewNextWeek({ overviewData, overviewLoading, overviewError }) {
  const unavailableMetricValue = overviewError ? "-" : null;
  const tatSummary = overviewData?.tatSummary || {};
  const tatDays = tatSummary?.averageTatDays;
  const plannedLive = overviewData?.plannedReleaseCount ?? 0;
  const target = overviewData?.targetFloor || 22;
  const shortfall = Math.max(0, target - Number(plannedLive || 0));
  const beatsCount = overviewData?.goodToGoBeatsCount ?? overviewData?.plannerBeatCount ?? 0;
  const reviewPendingCount = overviewData?.reviewPendingCount ?? 0;
  const iterateCount = overviewData?.iterateCount ?? 0;
  const wipCount = reviewPendingCount + iterateCount;

  // Readiness checklist data
  const liveOnMetaCount = Number(overviewData?.plannedReleaseCount || 0);
  const inProductionCount = Number(overviewData?.inProductionBeatCount || 0);
  const uniqueShowCount = Number(overviewData?.uniqueShowCount || 0);

  return (
    <div className="section-stack">
      <div className="metric-grid three-col">
        <MetricCard
          label="Beats locked GTG"
          className="hero-card"
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(beatsCount)}
          hint="Confirmed and ready to go"
          tone="positive"
        />
        {wipCount > 0 ? (
          <MetricCard
            label="Work in Progress"
            className="hero-card"
            value={overviewLoading ? "..." : formatMetricValue(wipCount)}
            hint={`${reviewPendingCount} review pending · ${iterateCount} in iteration`}
            tone="warning"
          />
        ) : null}
        <MetricCard
          label="Assets planned to go live"
          className="hero-card"
          tone={getTargetCardTone(plannedLive, target)}
          body={
            <>
              <div className="metric-value">
                {overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(plannedLive)}
                <span className="metric-unit">/ {target}</span>
              </div>
              <ProgressBar value={Number(plannedLive || 0)} target={target} />
              {!overviewLoading && shortfall > 0 && (
                <div style={{ fontSize: 11, color: "#9f2e2e", marginTop: 4 }}>{shortfall} short of target</div>
              )}
            </>
          }
        />
      </div>
      <div className="metric-grid three-col">
        <MetricCard
          label="Expected production TAT"
          value={overviewLoading ? "..." : unavailableMetricValue || (tatDays != null ? formatNumber(tatDays) : "...")}
          hint={tatDays == null ? "Not enough data yet" : "Production cells / unique beats"}
          tone={tatDays != null ? getTatCardTone(tatDays, tatSummary?.targetTatDays) : "default"}
        />
        <MetricCard
          label="Avg writing days"
          value={overviewLoading ? "..." : unavailableMetricValue || (overviewData?.averageWritingDays != null ? formatNumber(overviewData.averageWritingDays) : "...")}
          hint={overviewData?.averageWritingDays == null ? "Not enough allocations yet" : "Writing cells / unique beats"}
          tone={getWritingDaysTone(overviewData?.averageWritingDays)}
        />
        <MetricCard
          label="Avg CL review days"
          value={overviewLoading ? "..." : unavailableMetricValue || (overviewData?.averageClReviewDays != null ? formatNumber(overviewData.averageClReviewDays) : "...")}
          hint={overviewData?.averageClReviewDays == null ? "Not enough allocations yet" : "CL review cells / unique beats"}
          tone={getClReviewDaysTone(overviewData?.averageClReviewDays)}
        />
      </div>

      <hr className="section-divider" />

      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Readiness checklist</div>
        <div className="readiness-checklist">
          <ReadinessRow
            color={beatsCount > 0 ? getReadinessColor(1) : "#a39e93"}
            label="Beats locked and assigned to writers"
            value={beatsCount > 0 ? `${beatsCount} of ${beatsCount}` : "Pending"}
          />
          <ReadinessRow
            color={liveOnMetaCount > 0 ? getReadinessColor(inProductionCount / Math.max(liveOnMetaCount, 1)) : "#9f6b15"}
            label="Scripts in CL review pipeline"
            value={liveOnMetaCount > 0 ? `${inProductionCount} of ${liveOnMetaCount}` : "Pending"}
          />
          <ReadinessRow
            color={liveOnMetaCount > 0 ? getReadinessColor(liveOnMetaCount / Math.max(Number(target), 1)) : "#9f2e2e"}
            label="Scripts cleared for production"
            value={liveOnMetaCount > 0 ? `${liveOnMetaCount} of ${target}` : "Pending"}
          />
          <ReadinessRow
            color="#a39e93"
            label="Production slots booked"
            value="Pending"
          />
          <ReadinessRow
            color={uniqueShowCount > 0 ? "#2d5a3d" : "#a39e93"}
            label="Show coverage (shows with at least 1 beat)"
            value={uniqueShowCount > 0 ? String(uniqueShowCount) : "Pending"}
          />
        </div>
      </div>
    </div>
  );
}

function OverviewContent({
  overviewDataByPeriod,
  overviewLoadingByPeriod,
  overviewErrorByPeriod,
  productionDataByPeriod,
  productionLoadingByPeriod,
  productionErrorByPeriod,
  onShare,
  copyingSection,
  editorialPeriod,
  includeNewShowsPod,
  onIncludeNewShowsPodChange,
}) {
  const period = editorialPeriod;
  const overviewData = overviewDataByPeriod[period];
  const overviewLoading = Boolean(overviewLoadingByPeriod[period]);
  const overviewError = overviewErrorByPeriod[period] || "";
  const notes = buildOverviewNotes({ overviewError, overviewData });
  const sectionTitle = period === "current" ? "Editorial funnel" : period === "next" ? "Plan for next week" : "Output from last week";
  const contextLine = period === "current"
    ? "Where we are this week: planning and production status."
    : period === "next"
      ? "Readiness check: are we set up to hit target next week?"
      : "What shipped last week and how it performed.";
  const weekLabel = overviewData?.weekLabel || productionDataByPeriod[period]?.weekLabel || "";

  return (
    <ShareablePanel
      shareLabel={`Editorial Funnel ${getWeekViewLabel(period)}`}
      onShare={onShare}
      isSharing={copyingSection === `Editorial Funnel ${getWeekViewLabel(period)}`}
    >
      <div className="section-stack">
        {notes.map((note) => (
          <div key={note} className="warning-note">{note}</div>
        ))}

        <div style={{ fontSize: 14, fontWeight: 500 }}>{sectionTitle}</div>
        {weekLabel && <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: -10 }}>{weekLabel}</div>}
        <div style={{ fontSize: 13, color: "var(--subtle)", fontStyle: "italic", marginTop: -8 }}>{contextLine}</div>

        {period === "current" && (
          <OverviewCurrentWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} />
        )}
        {period === "last" && (
          <OverviewLastWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} />
        )}
        {period === "next" && (
          <OverviewNextWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} />
        )}
      </div>
    </ShareablePanel>
  );
}

function LeadershipOverviewContent({
  leadershipOverviewDataByPeriod,
  leadershipOverviewLoadingByPeriod,
  leadershipOverviewErrorByPeriod,
  onNavigate,
}) {
  const overviewData =
    leadershipOverviewDataByPeriod?.current ||
    leadershipOverviewDataByPeriod?.last ||
    leadershipOverviewDataByPeriod?.next ||
    null;
  const overviewLoading = Boolean(
    leadershipOverviewLoadingByPeriod?.current ||
      leadershipOverviewLoadingByPeriod?.last ||
      leadershipOverviewLoadingByPeriod?.next
  );
  const overviewError =
    leadershipOverviewErrorByPeriod?.current ||
    leadershipOverviewErrorByPeriod?.last ||
    leadershipOverviewErrorByPeriod?.next ||
    "";
  const [selectedFilterId, setSelectedFilterId] = useState("");
  const [outputMode, setOutputMode] = useState("pod");
  const filterOptions = Array.isArray(overviewData?.filters) ? overviewData.filters : [];
  const beatRows = Array.isArray(overviewData?.beatRows) ? overviewData.beatRows : [];
  const workflowRows = Array.isArray(overviewData?.workflowRows) ? overviewData.workflowRows : [];
  const approvedMatchedRows = Array.isArray(overviewData?.approvedMatchedRows) ? overviewData.approvedMatchedRows : [];
  const fullGenAiRows = Array.isArray(overviewData?.fullGenAiRows) ? overviewData.fullGenAiRows : [];
  const currentWeekUpdateRows = Array.isArray(overviewData?.currentWeekUpdateRows) ? overviewData.currentWeekUpdateRows : [];

  useEffect(() => {
    if (filterOptions.length === 0) {
      return;
    }
    if (!selectedFilterId || !filterOptions.some((option) => option.id === selectedFilterId)) {
      setSelectedFilterId(filterOptions[filterOptions.length - 1]?.id || "");
    }
  }, [filterOptions, selectedFilterId]);

  const selectedFilterOption = filterOptions.find((option) => option.id === selectedFilterId) || filterOptions[filterOptions.length - 1];
  const previousFilterOption = selectedFilterOption
    ? filterOptions[Math.max(0, filterOptions.findIndex((option) => option.id === selectedFilterOption.id) - 1)]
    : null;

  const matchesSelectedFilter = (row, option) => {
    if (!row || !option) {
      return false;
    }
    return row.monthKey === option.monthKey && Number(row.weekInMonth || 0) === Number(option.weekInMonth || 0);
  };

  const scopedBeatRows = beatRows.filter((row) => matchesSelectedFilter(row, selectedFilterOption));
  const previousBeatRows =
    previousFilterOption && previousFilterOption.id !== selectedFilterOption?.id
      ? beatRows.filter((row) => matchesSelectedFilter(row, previousFilterOption))
      : [];
  const scopedWorkflowRows = workflowRows.filter((row) => matchesSelectedFilter(row, selectedFilterOption));
  const scopedApprovedMatchedRows = approvedMatchedRows.filter((row) => matchesSelectedFilter(row, selectedFilterOption));
  const scopedFullGenAiRows = fullGenAiRows.filter((row) => matchesSelectedFilter(row, selectedFilterOption));
  const selectedRangeLabel = selectedFilterOption ? getSelectedPeriodRangeLabel(selectedFilterOption, scopedBeatRows) : "";

  const countByStatus = (rows, statusCategory) => rows.filter((row) => row.statusCategory === statusCategory).length;
  const totalBeats = scopedBeatRows.length;
  const approvedBeats = countByStatus(scopedBeatRows, "approved");
  const reviewPendingBeats = countByStatus(scopedBeatRows, "review_pending");
  const iterateBeats = countByStatus(scopedBeatRows, "iterate");
  const abandonedBeats = countByStatus(scopedBeatRows, "abandoned");
  const deliveredBeats = approvedBeats;

  const deltaMetaFor = (currentValue, previousValue) => {
    if (!previousFilterOption || previousFilterOption.id === selectedFilterOption?.id) {
      return { text: "No previous week", color: "var(--subtle)" };
    }
    return getDeltaMeta(currentValue, previousValue, `vs ${previousFilterOption.label}`);
  };

  const totalBeatsDelta = deltaMetaFor(totalBeats, previousBeatRows.length);
  const approvedBeatsDelta = deltaMetaFor(approvedBeats, countByStatus(previousBeatRows, "approved"));
  const reviewPendingDelta = deltaMetaFor(reviewPendingBeats, countByStatus(previousBeatRows, "review_pending"));
  const iterateDelta = deltaMetaFor(iterateBeats, countByStatus(previousBeatRows, "iterate"));
  const abandonedDelta = deltaMetaFor(abandonedBeats, countByStatus(previousBeatRows, "abandoned"));
  const deliveredDelta = deltaMetaFor(deliveredBeats, countByStatus(previousBeatRows, "approved"));

  const buildOutputRows = () => {
    const grouped = new Map();

    const ensureRow = (podLeadName, writerName) => {
      const safePod = normalizePodFilterKey(podLeadName || "Unassigned");
      const safeWriter = normalizePodFilterKey(writerName || "Unassigned");
      const key = outputMode === "pod" ? safePod : `${safePod}|${safeWriter}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          podLeadName: podLeadName || "Unassigned",
          writerName: writerName || "Unassigned",
          ideationCount: 0,
          deliveredCount: 0,
          editorialCount: 0,
          readyForProductionCount: 0,
          productionCount: 0,
          liveCount: 0,
        });
      }

      return grouped.get(key);
    };

    if (outputMode === "pod") {
      for (const row of scopedBeatRows) {
        ensureRow(row.podLeadName, "").ideationCount += 1;
      }
      for (const row of scopedApprovedMatchedRows) {
        ensureRow(row.podLeadName, row.writerName).deliveredCount += 1;
      }
      for (const row of scopedWorkflowRows) {
        const entry = ensureRow(row.podLeadName, row.writerName);
        if (row.source === "editorial") entry.editorialCount += 1;
        if (row.source === "ready_for_production") entry.readyForProductionCount += 1;
        if (row.source === "production") entry.productionCount += 1;
        if (row.source === "live") entry.liveCount += 1;
      }
    } else {
      for (const row of scopedApprovedMatchedRows) {
        const entry = ensureRow(row.podLeadName, row.writerName);
        entry.ideationCount += 1;
        entry.deliveredCount += 1;
      }
      for (const row of scopedWorkflowRows) {
        const entry = ensureRow(row.podLeadName, row.writerName);
        if (row.source === "editorial") entry.editorialCount += 1;
        if (row.source === "ready_for_production") entry.readyForProductionCount += 1;
        if (row.source === "production") entry.productionCount += 1;
        if (row.source === "live") entry.liveCount += 1;
      }
    }

    return Array.from(grouped.values()).sort((a, b) => {
      const totalA =
        a.ideationCount + a.editorialCount + a.readyForProductionCount + a.productionCount + a.liveCount + a.deliveredCount;
      const totalB =
        b.ideationCount + b.editorialCount + b.readyForProductionCount + b.productionCount + b.liveCount + b.deliveredCount;
      if (totalA !== totalB) return totalB - totalA;
      if (a.podLeadName !== b.podLeadName) return a.podLeadName.localeCompare(b.podLeadName);
      return a.writerName.localeCompare(b.writerName);
    });
  };

  const outputRows = buildOutputRows();

  const throughputByAcd = Array.from(
    scopedWorkflowRows
      .filter((row) => row.source === "production" || row.source === "live")
      .reduce((map, row) => {
        const acdNames = Array.isArray(row?.acdNames) && row.acdNames.length > 0 ? row.acdNames : ["Unassigned"];
        for (const acdName of acdNames) {
          const key = normalizePodFilterKey(acdName || "Unassigned");
          if (!map.has(key)) {
            map.set(key, {
              acdName: acdName || "Unassigned",
              productionAssets: new Set(),
              liveAssets: new Set(),
            });
          }
          const entry = map.get(key);
          const assetCode = String(row?.assetCode || row?.scriptCode || `${row?.showName}-${row?.beatName}`).trim();
          if (row.source === "production") entry.productionAssets.add(assetCode);
          else entry.liveAssets.add(assetCode);
        }
        return map;
      }, new Map())
      .values()
  )
    .map((entry) => {
      const productionCount = entry.productionAssets.size;
      const liveCount = entry.liveAssets.size;
      const totalCount = productionCount + liveCount;
      return {
        acdName: entry.acdName,
        productionCount,
        liveCount,
        totalCount,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount || a.acdName.localeCompare(b.acdName))
    .slice(0, 8);

  const fullGenAiByBeat = Array.from(
    scopedFullGenAiRows.reduce((map, row) => {
      const key = `${row.showName}|${row.beatName}`;
      if (!map.has(key)) {
        map.set(key, {
          showName: row.showName,
          beatName: row.beatName,
          attempts: 0,
          successCount: 0,
        });
      }
      const entry = map.get(key);
      entry.attempts += 1;
      if (row.success) entry.successCount += 1;
      return map;
    }, new Map()).values()
  )
    .map((entry) => ({
      ...entry,
      hitRate: entry.attempts > 0 ? Number(((entry.successCount / entry.attempts) * 100).toFixed(1)) : null,
    }))
    .sort((a, b) => b.attempts - a.attempts || a.showName.localeCompare(b.showName) || a.beatName.localeCompare(b.beatName));

  const renderLinkMetricCard = ({ label, value, delta, onClick }) => (
    <button type="button" className="metric-card hero-card overview-link-card" onClick={onClick} title="Click to open">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint overview-card-delta" style={{ color: delta.color }}>
        {delta.text}
      </div>
    </button>
  );

  return (
    <div className="section-stack">
      {overviewError ? <div className="warning-note">{overviewError}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div className="week-toggle-group">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={selectedFilterId === option.id ? "is-active" : ""}
              onClick={() => setSelectedFilterId(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: -8 }}>{selectedRangeLabel || "Select a week"}</div>

      <hr className="section-divider" />

      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Section 1. Beats</div>
        <div className="metric-grid four-col">
          {renderLinkMetricCard({ label: "Total Beats", value: overviewLoading ? "..." : formatMetricValue(totalBeats), delta: totalBeatsDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Approved Beats", value: overviewLoading ? "..." : formatMetricValue(approvedBeats), delta: approvedBeatsDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Review Pending", value: overviewLoading ? "..." : formatMetricValue(reviewPendingBeats), delta: reviewPendingDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Iterate", value: overviewLoading ? "..." : formatMetricValue(iterateBeats), delta: iterateDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Abandoned", value: overviewLoading ? "..." : formatMetricValue(abandonedBeats), delta: abandonedDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Delivered Beats", value: overviewLoading ? "..." : formatMetricValue(deliveredBeats), delta: deliveredDelta, onClick: () => onNavigate?.("beats-performance") })}
        </div>
      </div>

      <hr className="section-divider" />

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Section 2. Writer and POD output</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="week-toggle-group">
              {[
                ["pod", "POD"],
                ["writer", "Writer"],
              ].map(([id, label]) => (
                <button key={id} type="button" className={outputMode === id ? "is-active" : ""} onClick={() => setOutputMode(id)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="ghost-button overview-section-link" onClick={() => onNavigate?.("pod-wise")}>
              Open POD Wise
            </button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>{outputMode === "pod" ? "POD" : "POD"}</th>
                {outputMode === "writer" ? <th>Writer</th> : null}
                <th>Ideation</th>
                <th>Editorial</th>
                <th>Ready for Production</th>
                <th>Production</th>
                <th>Live</th>
                <th>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {outputRows.length > 0 ? (
                outputRows.map((row) => (
                  <tr key={`${row.podLeadName}-${row.writerName}`}>
                    <td>{row.podLeadName || "-"}</td>
                    {outputMode === "writer" ? <td>{row.writerName || "-"}</td> : null}
                    <td>{formatMetricValue(row.ideationCount)}</td>
                    <td>{formatMetricValue(row.editorialCount)}</td>
                    <td>{formatMetricValue(row.readyForProductionCount)}</td>
                    <td>{formatMetricValue(row.productionCount)}</td>
                    <td>{formatMetricValue(row.liveCount)}</td>
                    <td>{formatMetricValue(row.deliveredCount)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={outputMode === "writer" ? "8" : "7"}>No output rows available for this filter yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <hr className="section-divider" />

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Section 3. Production</div>
          <button type="button" className="ghost-button overview-section-link" onClick={() => onNavigate?.("production")}>
            Open Production
          </button>
        </div>
        <div className="panel-card">
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="panel-title">ACD productivity</div>
              <div className="panel-statline">Smaller rolling view for the selected week’s production and live movement.</div>
            </div>
          </div>
          <div style={{ width: "100%", height: 280 }}>
            {throughputByAcd.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={throughputByAcd} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="acdName" width={140} />
                  <Tooltip />
                  <Bar dataKey="totalCount" fill={CHART_TONE_POSITIVE} radius={[0, 8, 8, 0]}>
                    <LabelList dataKey="totalCount" position="right" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="No throughput rows available for this filter yet." />
            )}
          </div>
        </div>
      </div>

      <hr className="section-divider" />

      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Section 4. Full Gen AI</div>
        <div className="metric-grid three-col">
          <MetricCard label="Assets passed to Full Gen AI" value={overviewLoading ? "..." : formatMetricValue(scopedFullGenAiRows.length)} />
          <MetricCard label="Success" value={overviewLoading ? "..." : formatMetricValue(scopedFullGenAiRows.filter((row) => row.success).length)} />
          <MetricCard
            label="Overall hit rate"
            value={
              overviewLoading
                ? "..."
                : scopedFullGenAiRows.length > 0
                  ? formatPercent((scopedFullGenAiRows.filter((row) => row.success).length / scopedFullGenAiRows.length) * 100)
                  : "-"
            }
          />
        </div>
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Show</th>
                <th>Beat</th>
                <th>Attempts</th>
                <th>Success</th>
                <th>Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {fullGenAiByBeat.length > 0 ? (
                fullGenAiByBeat.map((row) => (
                  <tr key={`${row.showName}-${row.beatName}`}>
                    <td>{row.showName || "-"}</td>
                    <td>{row.beatName || "-"}</td>
                    <td>{formatMetricValue(row.attempts)}</td>
                    <td>{formatMetricValue(row.successCount)}</td>
                    <td>{row.hitRate != null ? formatPercent(row.hitRate) : "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5">No Full Gen AI rows for this filter yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <hr className="section-divider" />

      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Section 5. Current week update</div>
        <div style={{ overflowX: "auto" }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>POD</th>
                <th>Writer</th>
                <th>Beats</th>
                <th>Editorial</th>
                <th>Ready for Production</th>
                <th>Production</th>
                <th>Live</th>
              </tr>
            </thead>
            <tbody>
              {currentWeekUpdateRows.length > 0 ? (
                currentWeekUpdateRows.map((row) => (
                  <tr key={`${row.podLeadName}-${row.writerName}`}>
                    <td>{row.podLeadName || "-"}</td>
                    <td>{row.writerName || "-"}</td>
                    <td>{formatMetricValue(row.beats)}</td>
                    <td>{formatMetricValue(row.editorial)}</td>
                    <td>{formatMetricValue(row.readyForProduction)}</td>
                    <td>{formatMetricValue(row.production)}</td>
                    <td>{formatMetricValue(row.live)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7">No current week update rows available yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function buildAnalyticsSubtitle(data) {
  const parts = [
    data?.selectedWeekLabel,
    data?.selectedWeekRangeLabel,
    data?.rowCount ? `${formatNumber(data.rowCount)} attempts` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function classifyPromising(metrics) {
  const cpiValue = Number(metrics?.cpi?.value);
  const ctiValue = Number(metrics?.cti?.value);
  const baselineKeys = ["threeSecPlays", "thruplaysTo3s", "q1Completion", "cpi", "absoluteCompletion", "cti"];
  let missCount = 0;
  for (const key of baselineKeys) {
    const cell = metrics?.[key];
    if (cell && cell.meetsBenchmark === false) missCount += 1;
  }

  if (Number.isFinite(cpiValue) && cpiValue < 10 && missCount <= 2) {
    return { nextStep: "Potential Gen AI", rowTone: "gen-ai" };
  }
  if (Number.isFinite(ctiValue) && ctiValue >= 12) {
    return { nextStep: "Potential P1 Rework", rowTone: "rework-p1" };
  }
  return { nextStep: "Not Promising", rowTone: "testing-drop" };
}

function AnalyticsContent({
  analyticsData,
  analyticsLoading,
  analyticsError,
  onShare,
  copyingSection,
  onToggleActioned,
  actionedBusyKey,
}) {
  const [showCompletionBreakdown, setShowCompletionBreakdown] = useState(false);
  const [hideActioned, setHideActioned] = useState(true);
  const [showPromising, setShowPromising] = useState(false);
  const rows = Array.isArray(analyticsData?.rows) ? analyticsData.rows : [];
  const legendItems =
    Array.isArray(analyticsData?.legend) && analyticsData.legend.length > 0
      ? analyticsData.legend
      : ANALYTICS_LEGEND_FALLBACK;
  const metricColumns = Array.isArray(analyticsData?.metricColumns) ? analyticsData.metricColumns : [];
  const visibleMetricColumns = metricColumns.filter((column) => showCompletionBreakdown || !column.hiddenByDefault);
  const hiddenCompletionCount = metricColumns.filter((column) => column.hiddenByDefault).length;
  const actionedCount = rows.filter((row) => Boolean(row?.actioned)).length;
  const visibleRows = useMemo(() => {
    let safeRows = Array.isArray(rows) ? rows : [];

    if (showPromising) {
      safeRows = safeRows
        .filter((row) => row?.rowTone === "testing-drop")
        .map((row) => {
          const reclassified = classifyPromising(row?.metrics);
          return { ...row, nextStep: reclassified.nextStep, rowTone: reclassified.rowTone };
        });
    }

    if (hideActioned) {
      return safeRows.filter((row) => !row?.actioned);
    }

    const activeRows = [];
    const completedRows = [];
    safeRows.forEach((row) => {
      if (row?.actioned) {
        completedRows.push(row);
      } else {
        activeRows.push(row);
      }
    });
    return [...activeRows, ...completedRows];
  }, [hideActioned, showPromising, rows]);
  const analyticsSubtitle = buildAnalyticsSubtitle({
    ...analyticsData,
    rowCount: visibleRows.length,
  });

  return (
    <ShareablePanel
      shareLabel={`Analytics ${analyticsData?.selectedWeekLabel || "selected week"}`}
      onShare={onShare}
      isSharing={copyingSection === `Analytics ${analyticsData?.selectedWeekLabel || "selected week"}`}
      className="analytics-panel"
    >
      <div className="panel-head">
        <div>
          <div className="panel-title">Weekly script test results</div>
          <div className="panel-statline">{analyticsSubtitle}</div>
        </div>
      </div>

      <div className="section-stack">
        {analyticsError ? <div className="warning-note">{analyticsError}</div> : null}

        {analyticsLoading && !analyticsData ? (
          <EmptyState text="Loading Analytics dashboard..." />
        ) : (
          <>
            {rows.length > 0 ? (
              <>
                <div className="analytics-legend-row">
                  {(showPromising
                    ? [
                        { label: "Potential Gen AI", tone: "gen-ai" },
                        { label: "Potential P1 Rework", tone: "rework-p1" },
                        { label: "Not Promising", tone: "testing-drop" },
                      ]
                    : legendItems
                  ).map((item) => (
                    <div key={item.label} className="analytics-legend-chip">
                      <span className={`details-legend-swatch ${getAnalyticsLegendToneClass(item.tone)}`.trim()} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>

                <div className="analytics-controls-row" data-share-ignore="true">
                  <button
                    type="button"
                    className={showPromising ? "primary-button" : "ghost-button"}
                    onClick={() => setShowPromising((current) => !current)}
                  >
                    {showPromising ? "Showing what's promising" : "Show what's promising right now"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setHideActioned((current) => !current)}
                  >
                    {hideActioned
                      ? `Show actioned items${actionedCount > 0 ? ` (${formatNumber(actionedCount)})` : ""}`
                      : "Hide actioned items"}
                  </button>
                  {hiddenCompletionCount > 0 ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setShowCompletionBreakdown((current) => !current)}
                    >
                      {showCompletionBreakdown ? "Hide Q2 / Q3 / Q4 completion metrics" : "Show Q2 / Q3 / Q4 completion metrics"}
                    </button>
                  ) : null}
                </div>

                <div className="table-wrap">
                  <table className="ops-table analytics-table">
                    <thead>
                      <tr className="analytics-header-group-row">
                        <th colSpan="5" className="analytics-header-spacer" aria-hidden="true" />
                        <th colSpan={visibleMetricColumns.length} className="analytics-grouped-results-header">
                          Test results
                        </th>
                      </tr>
                      <tr className="analytics-header-metric-row">
                        <th>Show Name</th>
                        <th>Beat</th>
                        <th>Attempt asset code</th>
                        <th>Next step</th>
                        <th>Actioned</th>
                        {visibleMetricColumns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => {
                        const rowActionedKey = `${analyticsData?.selectedWeekKey || ""}:${row.assetCode || ""}`;
                        return (
                          <tr
                            key={`${row.assetCode}-${row.rowIndex}`}
                            className={`analytics-row tone-${row.rowTone || "neutral"}${row.actioned ? " analytics-row-actioned" : ""}`.trim()}
                          >
                            <td>{row.showName || "Unknown show"}</td>
                            <td>{row.beatName || "Unknown beat"}</td>
                            <td>
                              {row.assetLink ? (
                                <a
                                  href={row.assetLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="analytics-asset-link"
                                >
                                  {row.assetCode || "-"}
                                </a>
                              ) : (
                                row.assetCode || "-"
                              )}
                            </td>
                            <td>
                              <span className={`analytics-next-step ${getAnalyticsNextStepToneClass(row.rowTone)}`.trim()}>
                                {row.nextStep || "-"}
                              </span>
                            </td>
                            <td className="analytics-actioned-cell">
                              <label className="analytics-actioned-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.actioned)}
                                  disabled={actionedBusyKey === rowActionedKey}
                                  onChange={(event) => onToggleActioned?.(row, event.target.checked)}
                                />
                              </label>
                            </td>
                            {visibleMetricColumns.map((column) => {
                              const metric = row?.metrics?.[column.key];
                              const isMiss = metric?.meetsBenchmark === false;
                              return (
                                <td key={`${row.assetCode}-${column.key}`} className={isMiss ? "analytics-metric-miss" : ""}>
                                  {formatAnalyticsMetricValue(metric, column.format)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {visibleRows.length === 0 ? (
                        <tr className="analytics-empty-row">
                          <td colSpan={5 + visibleMetricColumns.length}>
                            All rows for this week are marked actioned. Use “Show actioned items” to review them.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState text={analyticsData?.emptyStateMessage || "No analytics rows are available for this week yet."} />
            )}
          </>
        )}
      </div>
    </ShareablePanel>
  );
}

const POD_TIER_GREEN_MIN = 35;
const POD_TIER_AMBER_MIN = 20;

function getPodTierColor(conversionRate) {
  if (conversionRate >= POD_TIER_GREEN_MIN) return "#2d5a3d";
  if (conversionRate >= POD_TIER_AMBER_MIN) return "#c2703e";
  return "#9f2e2e";
}

function PodFunnelBar({ label, value, maxValue, color }) {
  const pct = maxValue > 0 ? Math.max((value / maxValue) * 100, 2) : 0;
  return (
    <div className="pod-funnel-row">
      <span className="pod-funnel-label">{label}</span>
      <div className="pod-funnel-track">
        <div className="pod-funnel-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="pod-funnel-count">{value}</span>
    </div>
  );
}

function PodWiseContent({ competitionPodRows, competitionLoading, onShare, copyingSection }) {
  if (competitionLoading) {
    return <EmptyState text="Loading POD Wise dashboard..." />;
  }

  const competitionRows = Array.isArray(competitionPodRows) ? competitionPodRows : [];
  if (competitionRows.length === 0) {
    return <EmptyState text="POD Wise data is not available right now." />;
  }

  const sorted = [...competitionRows]
    .map((row) => {
      const beats = row.lifetimeBeats || 0;
      const scripts = row.lifetimeScripts || 0;
      const successful = row.hitRateNumerator || 0;
      const conversion = scripts > 0 ? Math.round((successful / scripts) * 100) : 0;
      return { ...row, beats, scripts, successful, conversion };
    })
    .sort((a, b) => b.conversion - a.conversion || b.successful - a.successful);

  const totalBeats = sorted.reduce((s, r) => s + r.beats, 0);
  const totalScripts = sorted.reduce((s, r) => s + r.scripts, 0);
  const totalSuccessful = sorted.reduce((s, r) => s + r.successful, 0);
  const avgConversion = totalScripts > 0 ? Math.round((totalSuccessful / totalScripts) * 100) : 0;

  const maxBeats = Math.max(...sorted.map((r) => r.beats), 1);
  const maxScripts = Math.max(...sorted.map((r) => r.scripts), 1);
  const maxSuccessful = Math.max(...sorted.map((r) => r.successful), 1);

  return (
    <ShareablePanel
      shareLabel="POD Wise leaderboard"
      onShare={onShare}
      isSharing={copyingSection === "POD Wise leaderboard"}
    >
      <div className="section-stack">
        {/* Summary row */}
        <div className="pod-summary-grid">
          {[
            { label: "Total beats", value: totalBeats },
            { label: "Total scripts", value: totalScripts },
            { label: "Successful", value: totalSuccessful },
            { label: "Avg conversion", value: `${avgConversion}%` },
          ].map((card) => (
            <div key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
            </div>
          ))}
        </div>

        {/* Section header */}
        <div className="pod-section-header">
          <span className="pod-section-title">POD performance</span>
          <span className="pod-section-subtitle">Ranked by successful scripts as % of total attempted scripts</span>
        </div>

        {/* POD cards */}
        <div className="pod-cards-stack">
          {sorted.map((pod, i) => {
            const rank = i + 1;
            const tierColor = getPodTierColor(pod.conversion);
            return (
              <div key={pod.podLeadName} className="pod-rank-card" style={{ borderLeftColor: tierColor }}>
                <div className="pod-rank-col">
                  <div className="pod-rank-number" style={{ color: tierColor }}>{rank}</div>
                  <div className="pod-rank-label">RANK</div>
                </div>
                <div className="pod-info-col">
                  <div className="pod-lead-name">{pod.podLeadName}</div>
                  <div className="pod-conversion" style={{ color: tierColor }}>{pod.conversion}%</div>
                  <div className="pod-rate-label">SCRIPT HIT RATE</div>
                </div>
                <div className="pod-bars-col">
                  <PodFunnelBar label="Beats" value={pod.beats} maxValue={maxBeats} color="#2d5a3d" />
                  <PodFunnelBar label="Scripts" value={pod.scripts} maxValue={maxScripts} color="#c2703e" />
                  <PodFunnelBar label="Success" value={pod.successful} maxValue={maxSuccessful} color="#2d5a3d" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="pod-legend">
          {[
            { color: "#2d5a3d", label: "Beats written" },
            { color: "#c2703e", label: "Scripts produced" },
            { color: "#2d5a3d", label: "Successful scripts" },
          ].map((item) => (
            <div key={item.label} className="pod-legend-item">
              <span className="pod-legend-swatch" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </ShareablePanel>
  );
}

function getBeatsStatusMeta(statusCategory) {
  if (statusCategory === "approved") {
    return { label: "Approved", color: "#2d5a3d", bg: "rgba(45, 90, 61, 0.14)" };
  }
  if (statusCategory === "abandoned") {
    return { label: "Abandoned", color: "#7d5a3a", bg: "rgba(125, 90, 58, 0.14)" };
  }
  if (statusCategory === "review_pending") {
    return { label: "Review pending", color: "#c2703e", bg: "rgba(194, 112, 62, 0.14)" };
  }
  if (statusCategory === "iterate") {
    return { label: "Iterate", color: "#9f2e2e", bg: "rgba(159, 46, 46, 0.14)" };
  }
  return { label: "To be ideated", color: "#6e6457", bg: "rgba(110, 100, 87, 0.14)" };
}

function formatMonthWeekLabel(monthKey, weekInMonth) {
  if (!monthKey || !weekInMonth) {
    return "";
  }

  const [year, month] = String(monthKey).split("-").map(Number);
  if (!year || !month) {
    return "";
  }

  const monthLabel = new Date(Date.UTC(year, month - 1, 1, 12)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

  return `${monthLabel} Wk${weekInMonth}`;
}

function getMonthWeekDateRange(monthKey, weekInMonth) {
  if (!monthKey || !weekInMonth) {
    return null;
  }

  const [year, month] = String(monthKey).split("-").map(Number);
  if (!year || !month) {
    return null;
  }

  const safeWeek = Number(weekInMonth);
  if (!Number.isFinite(safeWeek) || safeWeek < 1) {
    return null;
  }

  const startDay = (safeWeek - 1) * 7 + 1;
  const monthEndDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const endDay = safeWeek >= 4 ? monthEndDay : Math.min(startDay + 6, monthEndDay);

  return {
    start: `${year}-${String(month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function getSelectedPeriodRangeLabel(selectedPeriodOption, beatRows) {
  if (!selectedPeriodOption || selectedPeriodOption.id === "overall") {
    const datedRows = (Array.isArray(beatRows) ? beatRows : [])
      .map((row) => String(row?.primaryDate || row?.completedDate || row?.assignedDate || ""))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    if (datedRows.length === 0) {
      return "All available Ideation tracker data";
    }

    return `${formatDateLabel(datedRows[0])} - ${formatDateLabel(datedRows[datedRows.length - 1])}`;
  }

  const range = getMonthWeekDateRange(selectedPeriodOption.monthKey, selectedPeriodOption.weekInMonth);
  if (!range) {
    return selectedPeriodOption.label || "";
  }

  return `${formatDateLabel(range.start)} - ${formatDateLabel(range.end)}`;
}

function getSelectedPeriodRange(selectedPeriodOption, beatRows) {
  if (!selectedPeriodOption || selectedPeriodOption.id === "overall") {
    const datedRows = (Array.isArray(beatRows) ? beatRows : [])
      .map((row) => String(row?.primaryDate || row?.completedDate || row?.assignedDate || ""))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    if (datedRows.length === 0) {
      return null;
    }

    return { start: datedRows[0], end: datedRows[datedRows.length - 1] };
  }

  return getMonthWeekDateRange(selectedPeriodOption.monthKey, selectedPeriodOption.weekInMonth);
}

function uniqueSortedCodes(rows) {
  return Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => String(row?.assetCode || "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function filterWorkflowRows(rows, selectedPod, selectedPodKey) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (selectedPod !== "all") {
      const rowCanonicalKey = normalizePodFilterKey(row?.podMatchKey || row?.podLeadName);
      const rowRawKey = normalizePodFilterKey(row?.podLeadName);
      const selectedRawKey = normalizePodFilterKey(selectedPod);

      if (rowCanonicalKey !== selectedPodKey && rowRawKey !== selectedRawKey) {
        return false;
      }
    }
    return true;
  });
}

function sortWorkflowRows(rows, sortState) {
  const safeRows = Array.isArray(rows) ? [...rows] : [];
  return safeRows.sort((left, right) => {
    const comparison = compareDetailedTableValues(left?.[sortState.key] ?? "", right?.[sortState.key] ?? "");
    if (comparison !== 0) {
      return sortState.direction === "asc" ? comparison : -comparison;
    }
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

function paginateRows(rows, page, pageSize) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const count = Math.max(1, Math.ceil(safeRows.length / pageSize));
  const safePage = Math.min(page, count - 1);
  const paginatedRows = safeRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const options = Array.from({ length: count }, (_, index) => {
    const start = index * pageSize + 1;
    const end = Math.min((index + 1) * pageSize, safeRows.length);
    return { index, label: `${start}-${end}` };
  });

  return { safePage, count, paginatedRows, options };
}

function compareDetailedTableValues(leftValue, rightValue) {
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);
  const leftIsNumber = leftValue !== "" && leftValue !== null && leftValue !== undefined && Number.isFinite(leftNumber);
  const rightIsNumber = rightValue !== "" && rightValue !== null && rightValue !== undefined && Number.isFinite(rightNumber);

  if (leftIsNumber && rightIsNumber) {
    return leftNumber - rightNumber;
  }

  return String(leftValue || "").localeCompare(String(rightValue || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function daysBetweenYmd(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.round(diffMs / 86_400_000);
}

function BeatsPerformanceContent({
  beatsPerformanceData,
  beatsPerformanceLoading,
  beatsPerformanceError,
  onShare,
  copyingSection,
}) {
  const [selectedPeriod, setSelectedPeriod] = useState("overall");
  const [selectedPod, setSelectedPod] = useState("all");
  const [drilldownPod, setDrilldownPod] = useState("all");
  const [detailSort, setDetailSort] = useState({ key: "assignedDate", direction: "desc" });
  const [detailPage, setDetailPage] = useState(0);
  const [workflowSorts, setWorkflowSorts] = useState({
    editorial: { key: "assetCode", direction: "asc" },
    readyForProduction: { key: "assetCode", direction: "asc" },
    production: { key: "assetCode", direction: "asc" },
    live: { key: "assetCode", direction: "asc" },
  });
  const [workflowPages, setWorkflowPages] = useState({
    editorial: 0,
    readyForProduction: 0,
    production: 0,
    live: 0,
  });

  const podOptions = Array.isArray(beatsPerformanceData?.filters?.pods) ? beatsPerformanceData.filters.pods : [];
  const beatRows = Array.isArray(beatsPerformanceData?.rows) ? beatsPerformanceData.rows : [];
  const freshTakeRows = Array.isArray(beatsPerformanceData?.freshTakeRows) ? beatsPerformanceData.freshTakeRows : [];
  const workflowTables = beatsPerformanceData?.workflowTables || {};
  const periodOptions = useMemo(() => {
    const optionMap = new Map();

    for (const row of beatRows) {
      if (!row?.monthKey || !row?.weekInMonth) {
        continue;
      }

      const id = `${row.monthKey}::${row.weekInMonth}`;
      if (!optionMap.has(id)) {
        optionMap.set(id, {
          id,
          monthKey: row.monthKey,
          weekInMonth: Number(row.weekInMonth),
          label: formatMonthWeekLabel(row.monthKey, row.weekInMonth),
        });
      }
    }

    return [
      { id: "overall", label: "Till now (overall data)", monthKey: "", weekInMonth: null },
      ...Array.from(optionMap.values()).sort((left, right) => {
        if (left.monthKey !== right.monthKey) {
          return left.monthKey.localeCompare(right.monthKey);
        }
        return left.weekInMonth - right.weekInMonth;
      }),
    ];
  }, [beatRows]);

  useEffect(() => {
    if (!selectedPeriod || !periodOptions.some((option) => option.id === selectedPeriod)) {
      setSelectedPeriod(periodOptions[0]?.id || "overall");
    }
  }, [periodOptions, selectedPeriod]);

  useEffect(() => {
    if (selectedPod !== "all" && !podOptions.includes(selectedPod)) {
      setSelectedPod("all");
    }
  }, [podOptions, selectedPod]);

  useEffect(() => {
    if (drilldownPod !== "all" && !podOptions.includes(drilldownPod)) {
      setDrilldownPod("all");
    }
  }, [podOptions, drilldownPod]);

  useEffect(() => {
    setDetailPage(0);
  }, [selectedPeriod, selectedPod, detailSort]);

  useEffect(() => {
    setDrilldownPod("all");
  }, [selectedPeriod, selectedPod]);

  useEffect(() => {
    setWorkflowPages({
      editorial: 0,
      readyForProduction: 0,
      production: 0,
      live: 0,
    });
  }, [selectedPeriod, selectedPod, workflowSorts]);

  if (beatsPerformanceLoading) {
    return <EmptyState text="Loading beats performance..." />;
  }

  if (beatsPerformanceError) {
    return <div className="warning-note">{beatsPerformanceError}</div>;
  }

  if (!selectedPeriod) {
    return <EmptyState text="Beats performance data is not available right now." />;
  }

  const selectedPeriodOption = periodOptions.find((option) => option.id === selectedPeriod) || periodOptions[0];
  const isOverallPeriod = selectedPeriod === "overall";
  const selectedPeriodIndex = periodOptions.findIndex((option) => option.id === selectedPeriod);
  const previousPeriodOption = !isOverallPeriod && selectedPeriodIndex > 1 ? periodOptions[selectedPeriodIndex - 1] : null;
  const selectedPodKey =
    selectedPod === "all"
      ? "all"
      : beatRows.find((row) => row.podLeadName === selectedPod)?.podMatchKey || normalizePodFilterKey(selectedPod);
  const scopedRows = beatRows.filter(
    (row) =>
      (selectedPod === "all" || normalizePodFilterKey(row.podMatchKey || row.podLeadName) === selectedPodKey) &&
      (isOverallPeriod ||
        (row.monthKey === selectedPeriodOption.monthKey && Number(row.weekInMonth || 0) === Number(selectedPeriodOption.weekInMonth || 0)))
  );
  const scopedFreshTakeRows = freshTakeRows.filter(
    (row) =>
      (selectedPod === "all" || normalizePodFilterKey(row.podMatchKey || row.podLeadName) === selectedPodKey) &&
      (isOverallPeriod ||
        (row.monthKey === selectedPeriodOption.monthKey && Number(row.weekInMonth || 0) === Number(selectedPeriodOption.weekInMonth || 0)))
  );
  const previousScopedRows = previousPeriodOption
    ? beatRows.filter(
        (row) =>
          (selectedPod === "all" || normalizePodFilterKey(row.podMatchKey || row.podLeadName) === selectedPodKey) &&
          row.monthKey === previousPeriodOption.monthKey &&
          Number(row.weekInMonth || 0) === Number(previousPeriodOption.weekInMonth || 0)
      )
    : [];

  const activePods = Array.from(
    new Set(scopedRows.map((row) => String(row?.podLeadName || "").trim()).filter(Boolean))
  );
  const totalBeats = scopedRows.length;
  const approvedCount = scopedRows.filter((row) => row.statusCategory === "approved").length;
  const abandonedCount = scopedRows.filter((row) => row.statusCategory === "abandoned").length;
  const reviewPendingCount = scopedRows.filter((row) => row.statusCategory === "review_pending").length;
  const iterateCount = scopedRows.filter((row) => row.statusCategory === "iterate").length;
  const previousApprovedCount = previousScopedRows.filter((row) => row.statusCategory === "approved").length;
  const previousAbandonedCount = previousScopedRows.filter((row) => row.statusCategory === "abandoned").length;
  const previousReviewPendingCount = previousScopedRows.filter((row) => row.statusCategory === "review_pending").length;
  const previousIterateCount = previousScopedRows.filter((row) => row.statusCategory === "iterate").length;
  const podStatusSummaryRows = activePods
    .map((podLeadName) => {
      const podRows = scopedRows.filter((row) => row.podLeadName === podLeadName);
      return {
        podLeadName,
        approved: podRows.filter((row) => row.statusCategory === "approved").length,
        abandoned: podRows.filter((row) => row.statusCategory === "abandoned").length,
        reviewPending: podRows.filter((row) => row.statusCategory === "review_pending").length,
        iterate: podRows.filter((row) => row.statusCategory === "iterate").length,
        toBeIdeated: podRows.filter((row) => row.statusCategory === "to_be_ideated").length,
        total: podRows.length,
      };
    })
    .sort((left, right) => right.total - left.total || left.podLeadName.localeCompare(right.podLeadName));
  const comparisonSuffix = previousPeriodOption ? `vs ${previousPeriodOption.label}` : "vs last week";
  const metricCards = [
    {
      label: "Total Beats",
      value: formatMetricValue(totalBeats),
      delta: getDeltaMeta(totalBeats, previousScopedRows.length, comparisonSuffix),
    },
    {
      label: "Approved beats",
      value: formatMetricValue(approvedCount),
      delta: getDeltaMeta(approvedCount, previousApprovedCount, comparisonSuffix),
    },
    {
      label: "Review pending",
      value: formatMetricValue(reviewPendingCount),
      delta: getDeltaMeta(reviewPendingCount, previousReviewPendingCount, comparisonSuffix),
    },
    {
      label: "Iterate",
      value: formatMetricValue(iterateCount),
      delta: getDeltaMeta(iterateCount, previousIterateCount, comparisonSuffix),
    },
    {
      label: "Abandoned",
      value: formatMetricValue(abandonedCount),
      delta: getDeltaMeta(abandonedCount, previousAbandonedCount, comparisonSuffix),
    },
  ];
  const detailedRows = [...scopedRows].sort((left, right) => {
    const getSortValue = (row, key) => {
      if (key === "name") return row.beatCode || "";
      if (key === "podLeadName") return row.podLeadName || "";
      if (key === "showName") return row.showName || "";
      if (key === "beatName") return row.beatName || "";
      if (key === "statusLabel") return row.statusLabel || "";
      if (key === "assignedDate") return row.assignedDate || row.assignedDateRaw || "";
      if (key === "completedDate") return row.completedDate || row.completedDateRaw || "";
      if (key === "cycleDays") return row.cycleDays ?? "";
      return "";
    };

    const comparison = compareDetailedTableValues(
      getSortValue(left, detailSort.key),
      getSortValue(right, detailSort.key)
    );

    if (comparison !== 0) {
      return detailSort.direction === "asc" ? comparison : -comparison;
    }

    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  const detailPageSize = 10;
  const detailPageCount = Math.max(1, Math.ceil(detailedRows.length / detailPageSize));
  const safeDetailPage = Math.min(detailPage, detailPageCount - 1);
  const paginatedDetailedRows = detailedRows.slice(
    safeDetailPage * detailPageSize,
    safeDetailPage * detailPageSize + detailPageSize
  );
  const detailPageOptions = Array.from({ length: detailPageCount }, (_, index) => {
    const start = index * detailPageSize + 1;
    const end = Math.min((index + 1) * detailPageSize, detailedRows.length);
    return { index, label: `${start}-${end}` };
  });
  const selectedPeriodRangeLabel = getSelectedPeriodRangeLabel(selectedPeriodOption, beatRows);
  const selectedPeriodRange = getSelectedPeriodRange(selectedPeriodOption, beatRows);
  const effectiveWorkflowPod = drilldownPod !== "all" ? drilldownPod : selectedPod;
  const effectiveWorkflowPodKey =
    effectiveWorkflowPod === "all"
      ? "all"
      : beatRows.find((row) => row.podLeadName === effectiveWorkflowPod)?.podMatchKey || normalizePodFilterKey(effectiveWorkflowPod);
  const workflowTableConfigs = [
    {
      id: "editorial",
      title: "Editorial",
      subtitle: "Filtered rows from the Editorial sheet",
      columns: [
        ["assetCode", "AD code"],
        ["podLeadName", "POD"],
        ["writerName", "Writer"],
        ["showName", "Show"],
        ["beatName", "Angle name"],
        ["productionType", "Production Type"],
        ["dateAssigned", "Date assigned"],
        ["dateSubmittedByLead", "Date submitted by Lead"],
      ],
    },
    {
      id: "readyForProduction",
      title: "Ready for Production",
      subtitle: "Filtered rows from the Ready for Production sheet",
      columns: [
        ["assetCode", "AD code"],
        ["podLeadName", "POD"],
        ["writerName", "Writer"],
        ["showName", "Show"],
        ["beatName", "Angle name"],
        ["productionType", "Production Type"],
        ["dateSubmittedByLead", "Date submitted by Lead"],
        ["etaToStartProd", "ETA to start prod"],
      ],
    },
    {
      id: "production",
      title: "Production",
      subtitle: "Filtered rows from the Production sheet",
      columns: [
        ["assetCode", "AD code"],
        ["podLeadName", "POD"],
        ["writerName", "Writer"],
        ["showName", "Show"],
        ["beatName", "Angle name"],
        ["productionType", "Production Type"],
        ["etaToStartProd", "ETA to start prod"],
        ["etaPromoCompletion", "ETA for promo completion"],
        ["cl", "CL"],
        ["cd", "CD"],
        ["acd1WorkedOnWorldSettings", "ACD 1 Worked on world settings"],
        ["acdMultipleSelections", "ACD Multiple selections allowed."],
        ["status", "Status"],
      ],
    },
    {
      id: "live",
      title: "Live",
      subtitle: "Filtered rows from the Live sheet",
      columns: [
        ["assetCode", "AD code"],
        ["podLeadName", "POD"],
        ["writerName", "Writer"],
        ["showName", "Show"],
        ["beatName", "Angle name"],
        ["productionType", "Production Type"],
        ["dateAssigned", "Date assigned"],
        ["dateSubmittedByLead", "Date submitted by Lead"],
        ["etaToStartProd", "ETA to start prod"],
        ["etaPromoCompletion", "ETA for promo completion"],
        ["cl", "CL"],
        ["cd", "CD"],
        ["acd1WorkedOnWorldSettings", "ACD 1 Worked on world settings"],
        ["acdMultipleSelections", "ACD Multiple selections allowed."],
        ["finalUploadDate", "Final Upload Date"],
      ],
    },
  ];
  const workflowPodChips = [...podOptions].sort((left, right) => left.localeCompare(right));
  const preparedWorkflowTables = workflowTableConfigs.map((config) => {
    const filteredRows = filterWorkflowRows(
      workflowTables?.[config.id],
      effectiveWorkflowPod,
      effectiveWorkflowPodKey
    );
    const sortedRows = sortWorkflowRows(filteredRows, workflowSorts[config.id] || { key: "assetCode", direction: "asc" });
    const pagination = paginateRows(sortedRows, workflowPages[config.id] || 0, 10);
    return {
      ...config,
      rows: sortedRows,
      paginatedRows: pagination.paginatedRows,
      pageOptions: pagination.options,
      safePage: pagination.safePage,
      sort: workflowSorts[config.id] || { key: "assetCode", direction: "asc" },
    };
  });
  const ideationAvailabilityRows = scopedRows.map((row) => ({
    beatCodeKey: normalizeStageMatchKey(row.beatCode),
    showKey: normalizeStageMatchKey(row.showName),
    beatKey: normalizeStageMatchKey(row.beatName),
  }));
  const workflowTablesWithAvailability = preparedWorkflowTables.map((table) => ({
    ...table,
    columns: [...table.columns, ["beatsAvailable", "Beats is available"]],
    paginatedRows: table.paginatedRows.map((row) => {
      const scriptCodeKey = normalizeStageMatchKey(row.scriptCode);
      const showKey = normalizeStageMatchKey(row.showName);
      const beatKey = normalizeStageMatchKey(row.beatName);
      const fuzzyBeatMatch = matchAngleName(
        row.beatName,
        scopedRows
          .filter((candidate) => normalizeStageMatchKey(candidate.showName) === showKey || !showKey)
          .map((candidate) => candidate.beatName)
          .filter(Boolean)
      );
      const beatsAvailable = ideationAvailabilityRows.some(
        (candidate) =>
          (fuzzyBeatMatch && candidate.beatKey === normalizeStageMatchKey(fuzzyBeatMatch)) ||
          (beatKey && candidate.beatKey === beatKey) ||
          (scriptCodeKey && candidate.beatCodeKey === scriptCodeKey) ||
          (beatKey && candidate.showKey === showKey && candidate.beatKey === beatKey)
      );

      return {
        ...row,
        beatsAvailable: beatsAvailable ? "Yes" : "No",
      };
    }),
  }));

  return (
    <ShareablePanel shareLabel="Beats Performance" onShare={onShare} isSharing={copyingSection === "Beats Performance"}>
      <div className="section-stack">
        <div className="section-toolbar">
          <label className="toolbar-select">
            <span>Filter</span>
            <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>
              {periodOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="toolbar-select">
            <span>POD</span>
            <select value={selectedPod} onChange={(event) => setSelectedPod(event.target.value)}>
              <option value="all">All PODs</option>
              {podOptions.map((podLeadName) => (
                <option key={podLeadName} value={podLeadName}>
                  {podLeadName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            marginTop: -6,
            fontSize: 13,
            color: "var(--subtle)",
            fontWeight: 600,
          }}
        >
          {selectedPeriodOption?.label ? `${selectedPeriodOption.label}: ` : ""}
          {selectedPeriodRangeLabel}
        </div>

        <div
          style={{
            marginTop: -6,
            fontSize: 12,
            color: "var(--subtle)",
          }}
        >
          Live updates daily at 5:00 AM IST. Other sheets refresh every 4 hours.
        </div>

        <div className="pod-summary-grid">
          {metricCards.map((card) => (
            <div key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
              {!isOverallPeriod ? (
                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8, color: card.delta.color }}>{card.delta.text}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }} />

        <div className="pod-section-header">
          <span className="pod-section-title">POD Status</span>
          <span className="pod-section-subtitle">POD-wise status counts from Ideation tracker only</span>
        </div>

        <div className="table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>POD</th>
                <th>Approved</th>
                <th>Abandoned</th>
                <th>Review pending</th>
                <th>Iterate</th>
                <th>To be ideated</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {podStatusSummaryRows.length > 0 ? (
                podStatusSummaryRows.map((row) => (
                  <tr key={row.podLeadName}>
                    <td>{row.podLeadName || "-"}</td>
                    <td>{formatMetricValue(row.approved)}</td>
                    <td>{formatMetricValue(row.abandoned)}</td>
                    <td>{formatMetricValue(row.reviewPending)}</td>
                    <td>{formatMetricValue(row.iterate)}</td>
                    <td>{formatMetricValue(row.toBeIdeated)}</td>
                    <td>{formatMetricValue(row.total)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="empty-cell">
                    No beats match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pod-section-header">
          <span className="pod-section-title">Detailed Info</span>
          <span className="pod-section-subtitle">Row-level detail from Ideation tracker</span>
        </div>

        <div className="table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                {[
                  ["podLeadName", "POD"],
                  ["name", "Writer name"],
                  ["showName", "Show"],
                  ["beatName", "Beat name"],
                  ["statusLabel", "Beat status"],
                  ["assignedDate", "Assign date"],
                  ["completedDate", "Complete date"],
                ].map(([key, label]) => {
                  const isActive = detailSort.key === key;
                  const arrow = isActive ? (detailSort.direction === "asc" ? " ↑" : " ↓") : " ↕";
                  return (
                    <th key={key}>
                      <button
                        type="button"
                        onClick={() =>
                          setDetailSort((current) => ({
                            key,
                            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
                          }))
                        }
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          color: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        {label}
                        {arrow}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {paginatedDetailedRows.length > 0 ? (
                paginatedDetailedRows.map((row) => {
                  const statusMeta = getBeatsStatusMeta(row.statusCategory);
                  return (
                    <tr key={row.id}>
                      <td>{row.podLeadName || "-"}</td>
                      <td>{row.beatCode || "-"}</td>
                      <td>{row.showName || "-"}</td>
                      <td>{row.beatName || "-"}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: statusMeta.bg,
                            color: statusMeta.color,
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {row.statusLabel || statusMeta.label}
                        </span>
                      </td>
                      <td>{row.assignedDate ? formatDateLabel(row.assignedDate) : row.assignedDateRaw || row.rawBucketLabel || "-"}</td>
                      <td>{row.completedDate ? formatDateLabel(row.completedDate) : row.completedDateRaw || "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="empty-cell">
                    No detailed beats match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detailPageOptions.length > 1 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {detailPageOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                className={safeDetailPage === option.index ? "toggle-chip is-active" : "toggle-chip"}
                onClick={() => setDetailPage(option.index)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {workflowPodChips.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--subtle)", fontWeight: 700 }}>Filter below tables:</span>
            {workflowPodChips.map((podName) => {
              const isActive = drilldownPod === podName;
              return (
                <button
                  key={`workflow-pod-${podName}`}
                  type="button"
                  className={isActive ? "toggle-chip is-active" : "toggle-chip"}
                  onClick={() => setDrilldownPod(isActive ? "all" : podName)}
                  title={isActive ? "Click to Remove" : "Click to Filter"}
                >
                  {podName}
                </button>
              );
            })}
          </div>
        ) : null}

        {workflowTablesWithAvailability.map((table) => (
          <div key={table.id} style={{ display: "grid", gap: 12 }}>
            <div className="pod-section-header">
              <span className="pod-section-title">{table.title}</span>
              <span className="pod-section-subtitle">{table.subtitle}</span>
            </div>

            <div className="table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    {table.columns.map(([key, label]) => {
                      const isActive = table.sort.key === key;
                      const arrow = isActive ? (table.sort.direction === "asc" ? " ↑" : " ↓") : " ↕";
                      return (
                        <th key={`${table.id}-${key}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setWorkflowSorts((current) => ({
                                ...current,
                                [table.id]: {
                                  key,
                                  direction:
                                    current?.[table.id]?.key === key && current?.[table.id]?.direction === "asc" ? "desc" : "asc",
                                },
                              }))
                            }
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              font: "inherit",
                              color: "inherit",
                              cursor: "pointer",
                            }}
                          >
                            {label}
                            {arrow}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {table.paginatedRows.length > 0 ? (
                    table.paginatedRows.map((row) => (
                      <tr key={`${table.id}-${row.id}-${row.rowIndex || ""}`}>
                        {table.columns.map(([key]) => (
                          <td key={`${table.id}-${row.id}-${key}`}>
                            {key.toLowerCase().includes("date") || key.toLowerCase().includes("eta")
                              ? row[key]
                                ? formatDateLabel(row[key])
                                : "-"
                              : row[key] || "-"}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={table.columns.length} className="empty-cell">
                        No {table.title.toLowerCase()} rows match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {table.pageOptions.length > 1 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {table.pageOptions.map((option) => (
                  <button
                    key={`${table.id}-${option.label}`}
                    type="button"
                    className={table.safePage === option.index ? "toggle-chip is-active" : "toggle-chip"}
                    onClick={() =>
                      setWorkflowPages((current) => ({
                        ...current,
                        [table.id]: option.index,
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </ShareablePanel>
  );
}

function PodTasksBarChart({ title, subtitle, items, maxValue, accentColor }) {
  if (items.length === 0) {
    return (
      <>
        <div className="pod-section-header">
          <span className="pod-section-title">{title}</span>
          <span className="pod-section-subtitle">{subtitle}</span>
        </div>
        <EmptyState text={`No ${title.toLowerCase()} right now.`} />
      </>
    );
  }

  return (
    <>
      <div className="pod-section-header">
        <span className="pod-section-title">{title}</span>
        <span className="pod-section-subtitle">{subtitle}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const isMax = i === 0;
          const barColor = isMax ? accentColor : "#2d5a3d";
          const pct = maxValue > 0 ? Math.max((item.count / maxValue) * 100, 4) : 0;
          return (
            <div key={item.podLead} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 72, fontSize: 13, fontWeight: 500, color: "var(--ink)", textAlign: "right", flexShrink: 0 }}>
                {item.podLead}
              </span>
              <div style={{ flex: 1, height: 28, borderRadius: 6, background: "var(--surface)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 6, background: barColor, transition: "width 0.4s ease" }} />
              </div>
              <span style={{ width: 28, fontSize: 14, fontWeight: 700, color: isMax ? accentColor : "var(--ink-secondary)", textAlign: "right", flexShrink: 0 }}>
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PodTasksContent({ podTasksData, podTasksLoading, onShare, copyingSection }) {
  if (podTasksLoading) {
    return <EmptyState text="Loading POD tasks..." />;
  }

  if (!podTasksData) {
    return <EmptyState text="POD tasks data is not available right now." />;
  }

  const { scriptsPendingByPod, beatsPendingByPod, totalScriptsPending, totalBeatsPending } = podTasksData;
  const maxScripts = Math.max(...scriptsPendingByPod.map((r) => r.count), 1);
  const maxBeats = Math.max(...beatsPendingByPod.map((r) => r.count), 1);

  return (
    <ShareablePanel
      shareLabel="POD Tasks"
      onShare={onShare}
      isSharing={copyingSection === "POD Tasks"}
    >
      <div className="section-stack">
        {/* Summary row */}
        <div className="pod-summary-grid">
          {[
            { label: "Scripts to review", value: totalScriptsPending },
            { label: "Beats to review", value: totalBeatsPending },
          ].map((card) => (
            <div key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
            </div>
          ))}
        </div>

        <PodTasksBarChart
          title="Scripts pending approval"
          subtitle="Scripts completed by writer, awaiting POD lead review"
          items={scriptsPendingByPod}
          maxValue={maxScripts}
          accentColor="#c2703e"
        />

        <PodTasksBarChart
          title="Beats pending approval"
          subtitle="Beats from current week in review pending or iterate status"
          items={beatsPendingByPod}
          maxValue={maxBeats}
          accentColor="#c2703e"
        />
      </div>
    </ShareablePanel>
  );
}

function ProductionContent({
  acdMetricsData,
  acdMetricsLoading,
  acdMetricsError,
  acdTimeView,
  onTimeViewChange,
  acdViewType,
  onViewTypeChange,
  onRunSync,
  busyAction,
  onShare,
  copyingSection,
}) {
  if (acdMetricsLoading) {
    return <EmptyState text="Loading Production dashboard..." />;
  }

  if (acdMetricsError) {
    return <div className="warning-note">{acdMetricsError}</div>;
  }

  if (!acdMetricsData) {
    return <EmptyState text="Production data is not available right now." />;
  }

  const syncStatus = acdMetricsData.syncStatus || {};
  const dataset = getAcdLeaderboardDataset(acdMetricsData, acdTimeView, acdViewType);
  const viewLabel = getAcdViewLabel(dataset.viewType);
  const notes = [syncStatus.syncError, syncStatus.sourceFilterWarning].filter(Boolean);
  const latestWorkDateLabel = acdMetricsData.latestWorkDate ? formatDateLabel(acdMetricsData.latestWorkDate) : "";
  const adherenceIssueRows = Array.isArray(syncStatus.adherenceIssueRows) ? syncStatus.adherenceIssueRows : [];
  const failureReasonRows = Array.isArray(acdMetricsData.failureReasonRows) ? acdMetricsData.failureReasonRows : [];
  const totalFailedSheets = Number(syncStatus.totalFailedSheets || 0);
  const totalCdsAffected = Array.isArray(syncStatus.adherenceRows) ? syncStatus.adherenceRows.length : 0;

  return (
    <div className="section-stack">
      {notes.map((note) => (
        <div key={note} className="warning-note">
          {note}
        </div>
      ))}

      <ShareablePanel
        shareLabel="Production ACD sync"
        onShare={onShare}
        isSharing={copyingSection === "Production ACD sync"}
      >
        <div className="panel-title">ACD Daily Sync</div>
        <div className="panel-statline">{buildAcdSyncMeta(syncStatus)}</div>
        <div className="panel-stack">
          <div className="section-actions section-actions-left" data-share-ignore="true">
            <button
              type="button"
              className="primary-button"
              onClick={() => void onRunSync()}
              disabled={busyAction !== ""}
            >
              {busyAction === "acd-sync" ? "Running sync..." : "Run sync"}
            </button>
          </div>
        </div>
      </ShareablePanel>

      <ShareablePanel
        shareLabel="Production ACD chart"
        onShare={onShare}
        isSharing={copyingSection === "Production ACD chart"}
      >
        <div className="panel-head">
          <div>
            <div className="panel-title">{viewLabel} productivity chart</div>
            <div className="panel-statline">
              <span>{dataset.rows.length > 0 ? dataset.meta : acdMetricsData.emptyStateMessage || EMPTY_ACD_MESSAGE}</span>
              {latestWorkDateLabel ? <span>Latest synced work date: {latestWorkDateLabel}</span> : null}
            </div>
          </div>
          <div className="production-toggle-wrap" data-share-ignore="true">
            <ToggleGroup
              label="Time View"
              options={ACD_TIME_OPTIONS}
              value={acdTimeView}
              onChange={onTimeViewChange}
              disabled={busyAction !== ""}
            />
            <ToggleGroup
              label="View Type"
              options={ACD_VIEW_OPTIONS}
              value={acdViewType}
              onChange={onViewTypeChange}
              disabled={busyAction !== ""}
            />
          </div>
        </div>
        <AcdLeaderboardChart rows={dataset.rows} viewLabel={viewLabel} emptyText={EMPTY_ACD_MESSAGE} />
      </ShareablePanel>

      <ShareablePanel
        shareLabel="Production troubleshooting"
        onShare={onShare}
        isSharing={copyingSection === "Production troubleshooting"}
        className="production-troubleshooting-panel"
      >
        <div className="panel-title">ACD Sync Rules and Adherence Issues</div>
        <div className="panel-statline">{buildAcdAdherenceMeta(syncStatus)}</div>
        <div className="rules-card">
          <div className="rules-card-title">Image sheet rules for ACD sync</div>
          <ol className="rules-list">
            <li>Please ensure sheet is accessible to everyone (outside PocketFM also).</li>
            <li>
              Please ensure that ACD name is tagged as google chips against every image &amp; the column is named as
              &quot;ACD Name&quot;.
            </li>
            <li>
              Please ensure that Work date is tagged against every image &amp; the column is named as
              &quot;Work Date&quot;.
            </li>
            <li>
              Please ensure that the final image links are named under the column &quot;Final Image URL&quot;.
            </li>
            <li>Please name the tab with all images as &quot;Final image sheet&quot;.</li>
          </ol>
        </div>

        <div className="troubleshoot-summary-grid">
          <div className="troubleshoot-summary-card">
            <span>Total failed sheets</span>
            <strong>{formatNumber(totalFailedSheets)}</strong>
          </div>
          <div className="troubleshoot-summary-card">
            <span>Total CDs affected</span>
            <strong>{formatNumber(totalCdsAffected)}</strong>
          </div>
        </div>

        {failureReasonRows.length > 0 ? (
          <div className="failure-reason-row">
            {failureReasonRows.map((row) => (
              <div key={row.failureReason} className="failure-reason-pill">
                <span>{formatFailureReasonLabel(row.failureReason)}</span>
                <strong>{formatNumber(row.count)}</strong>
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <div className="panel-title">Image Sheet Adherence Issues</div>
          <AcdAdherenceTable rows={adherenceIssueRows} />
        </div>
      </ShareablePanel>
    </div>
  );
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

export default function UnifiedOpsApp() {
  const [activeView, setActiveView] = useState("leadership-overview");
  const [editorialPeriod, setEditorialPeriod] = useState("current");
  const [selectedAnalyticsWeekKey, setSelectedAnalyticsWeekKey] = useState(getWeekSelection("current").weekKey);
  const [plannerBoardSnapshot, setPlannerBoardSnapshot] = useState(null);
  const [overviewDataByPeriod, setOverviewDataByPeriod] = useState({});
  const [overviewLoadingByPeriod, setOverviewLoadingByPeriod] = useState(
    Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, true]))
  );
  const [overviewErrorByPeriod, setOverviewErrorByPeriod] = useState({});
  const [leadershipOverviewDataByPeriod, setLeadershipOverviewDataByPeriod] = useState({});
  const [leadershipOverviewLoadingByPeriod, setLeadershipOverviewLoadingByPeriod] = useState(
    Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, true]))
  );
  const [leadershipOverviewErrorByPeriod, setLeadershipOverviewErrorByPeriod] = useState({});
  const [productionDataByPeriod, setProductionDataByPeriod] = useState({});
  const [productionLoadingByPeriod, setProductionLoadingByPeriod] = useState(
    Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, true]))
  );
  const [productionErrorByPeriod, setProductionErrorByPeriod] = useState({});
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

  const nextWeekKey = useMemo(() => shiftWeekKey(getCurrentWeekKey(), 1), []);
  const nextWeekPlannerBoardMetrics = useMemo(() => {
    if (!plannerBoardSnapshot || plannerBoardSnapshot.weekKey !== nextWeekKey || plannerBoardSnapshot.isNextWeek !== true) {
      return null;
    }

    return buildNextWeekPlannerBoardMetrics(plannerBoardSnapshot);
  }, [nextWeekKey, plannerBoardSnapshot]);
  const effectiveOverviewDataByPeriod = useMemo(() => {
    if (!nextWeekPlannerBoardMetrics?.overview) {
      return overviewDataByPeriod;
    }

    const nextApiData = overviewDataByPeriod?.next && typeof overviewDataByPeriod.next === "object" ? overviewDataByPeriod.next : {};
    const nextOverviewError = String(overviewErrorByPeriod?.next || "");
    return {
      ...overviewDataByPeriod,
      next: {
        ...nextApiData,
        ...nextWeekPlannerBoardMetrics.overview,
        goodToGoBeatsCount: nextApiData.goodToGoBeatsCount ?? null,
        reviewPendingCount: nextApiData.reviewPendingCount ?? 0,
        iterateCount: nextApiData.iterateCount ?? 0,
        goodToGoTarget: nextApiData.goodToGoTarget ?? 30,
        ideationWeekBucket: nextApiData.ideationWeekBucket || "",
        goodToGoError: nextApiData.goodToGoError || nextOverviewError || "",
        hasWeekData:
          nextWeekPlannerBoardMetrics.overview.hasWeekData ||
          Number(nextApiData.goodToGoBeatsCount || 0) > 0,
        emptyStateMessage:
          nextWeekPlannerBoardMetrics.overview.hasWeekData || Number(nextApiData.goodToGoBeatsCount || 0) > 0
            ? ""
            : nextWeekPlannerBoardMetrics.overview.emptyStateMessage,
        },
      };
  }, [nextWeekPlannerBoardMetrics, overviewDataByPeriod, overviewErrorByPeriod]);
  const effectiveOverviewLoadingByPeriod = useMemo(() => {
    if (!nextWeekPlannerBoardMetrics?.overview) {
      return overviewLoadingByPeriod;
    }

    return {
      ...overviewLoadingByPeriod,
      next: false,
    };
  }, [nextWeekPlannerBoardMetrics, overviewLoadingByPeriod]);
  const effectiveOverviewErrorByPeriod = useMemo(() => {
    if (!nextWeekPlannerBoardMetrics?.overview) {
      return overviewErrorByPeriod;
    }

    return {
      ...overviewErrorByPeriod,
      next: "",
    };
  }, [nextWeekPlannerBoardMetrics, overviewErrorByPeriod]);
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
    let cancelled = false;

    async function loadOverviewSections() {
      const nextLoadingState = Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, true]));
      setOverviewLoadingByPeriod(nextLoadingState);
      setProductionLoadingByPeriod(nextLoadingState);
      setOverviewErrorByPeriod({});
      setProductionErrorByPeriod({});

      const overviewResults = await Promise.allSettled(
        OVERVIEW_PERIODS.map(async (period) => {
          const response = await fetch(`/api/dashboard/overview?period=${encodeURIComponent(period)}&includeNewShowsPod=${includeNewShowsPod}`, {
            cache: "no-store",
          });
          const payload = await readJson(response);
          if (!response.ok) {
            throw new Error(payload.liveTabError || payload.error || "Unable to load Overview metrics.");
          }
          return { period, payload };
        })
      );

      const productionResults = await Promise.allSettled(
        OVERVIEW_PERIODS.map(async (period) => {
          const response = await fetch(`/api/dashboard/production?period=${encodeURIComponent(period)}`, {
            cache: "no-store",
          });
          const payload = await readJson(response);
          if (!response.ok) {
            throw new Error(payload.error || "Unable to load Production dashboard.");
          }
          return { period, payload };
        })
      );

      if (cancelled) {
        return;
      }

      const nextOverviewData = {};
      const nextOverviewErrors = {};
      const nextOverviewLoading = {};
      const nextProductionData = {};
      const nextProductionLoading = {};
      const nextProductionErrors = {};

      overviewResults.forEach((result, index) => {
        const period = OVERVIEW_PERIODS[index];
        nextOverviewLoading[period] = false;
        if (result.status === "fulfilled") {
          nextOverviewData[period] = result.value.payload;
        } else {
          nextOverviewData[period] = null;
          nextOverviewErrors[period] = result.reason?.message || "Unable to load Overview metrics.";
        }
      });

      productionResults.forEach((result, index) => {
        const period = OVERVIEW_PERIODS[index];
        nextProductionLoading[period] = false;
        if (result.status === "fulfilled") {
          nextProductionData[period] = result.value.payload;
        } else {
          nextProductionData[period] = null;
          nextProductionErrors[period] = result.reason?.message || "Unable to load Production dashboard.";
        }
      });

      setOverviewDataByPeriod(nextOverviewData);
      setOverviewErrorByPeriod(nextOverviewErrors);
      setOverviewLoadingByPeriod(nextOverviewLoading);
      setProductionDataByPeriod(nextProductionData);
      setProductionLoadingByPeriod(nextProductionLoading);
      setProductionErrorByPeriod(nextProductionErrors);
    }

    void loadOverviewSections();
    return () => {
      cancelled = true;
    };
  }, [includeNewShowsPod]);

  useEffect(() => {
    let cancelled = false;

    async function loadLeadershipOverviewSections() {
      const nextLoadingState = Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, true]));
      setLeadershipOverviewLoadingByPeriod(nextLoadingState);
      setLeadershipOverviewErrorByPeriod({});

      try {
        const response = await fetch("/api/dashboard/leadership-overview", { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Overview.");
        }

        if (!cancelled) {
          const nextData = Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, payload]));
          const nextLoading = Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, false]));
          setLeadershipOverviewDataByPeriod(nextData);
          setLeadershipOverviewErrorByPeriod({});
          setLeadershipOverviewLoadingByPeriod(nextLoading);
        }
      } catch (error) {
        if (!cancelled) {
          const nextData = Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, null]));
          const nextLoading = Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, false]));
          const nextErrors = Object.fromEntries(
            OVERVIEW_PERIODS.map((period) => [period, error?.message || "Unable to load Overview."])
          );
          setLeadershipOverviewDataByPeriod(nextData);
          setLeadershipOverviewErrorByPeriod(nextErrors);
          setLeadershipOverviewLoadingByPeriod(nextLoading);
        }
      }
    }

    void loadLeadershipOverviewSections();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCompetition() {
      try {
        const response = await fetch("/api/dashboard/competition", { cache: "no-store" });
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
  }, []);

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
        const multiWeekMatch = selectedAnalyticsWeekKey.match(/^last-(\d+)-weeks$/);
        const analyticsUrl = multiWeekMatch
          ? `/api/dashboard/analytics?weeks=${multiWeekMatch[1]}`
          : `/api/dashboard/analytics?week=${encodeURIComponent(selectedAnalyticsWeekKey)}`;
        const response = await fetch(analyticsUrl, { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Analytics dashboard.");
        }

        if (!cancelled) {
          setAnalyticsData(payload);
          if (!selectedAnalyticsWeekKey.startsWith("last-") && payload?.selectedWeekKey && payload.selectedWeekKey !== selectedAnalyticsWeekKey) {
            setSelectedAnalyticsWeekKey(payload.selectedWeekKey);
          }
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
  }, [activeView, selectedAnalyticsWeekKey]);

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
    const cancelState = { cancelled: false };
    void requestAcdMetrics(cancelState);
    return () => {
      cancelState.cancelled = true;
    };
  }, []);

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
    const weekKey = String(analyticsData?.selectedWeekKey || selectedAnalyticsWeekKey || "").trim();
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
          <div className="ops-shell">
            {activeView === "leadership-overview" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Leadership Snapshot</div>
                  <h1 className="page-header-title">Overview</h1>
                  <p className="page-header-sub">Beats, POD output, production throughput, and Full Gen AI in one weekly view</p>
                </div>
                <div className="section-shell">
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                    <div className="week-toggle-group">
                      {[
                        { id: "last", label: "Last week" },
                        { id: "current", label: "This week" },
                        { id: "next", label: "Next week" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={editorialPeriod === opt.id ? "is-active" : ""}
                          onClick={() => setEditorialPeriod(opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <LeadershipOverviewContent
                    leadershipOverviewDataByPeriod={leadershipOverviewDataByPeriod}
                    leadershipOverviewLoadingByPeriod={leadershipOverviewLoadingByPeriod}
                    leadershipOverviewErrorByPeriod={leadershipOverviewErrorByPeriod}
                    onNavigate={setActiveView}
                  />
                </div>
              </>
            ) : null}

            {activeView === "overview" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">This Week's Pipeline</div>
                  <h1 className="page-header-title">Editorial Funnel</h1>
                  <p className="page-header-sub">Scripts moving through review, testing, and production this week</p>
                </div>
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
                    <div className="week-toggle-group">
                      {[
                        { id: "last", label: "Last week" },
                        { id: "current", label: "This week" },
                        { id: "next", label: "Next week" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={editorialPeriod === opt.id ? "is-active" : ""}
                          onClick={() => setEditorialPeriod(opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <OverviewContent
                    overviewDataByPeriod={effectiveOverviewDataByPeriod}
                    overviewLoadingByPeriod={effectiveOverviewLoadingByPeriod}
                    overviewErrorByPeriod={effectiveOverviewErrorByPeriod}
                    productionDataByPeriod={productionDataByPeriod}
                    productionLoadingByPeriod={productionLoadingByPeriod}
                    productionErrorByPeriod={productionErrorByPeriod}
                    onShare={copySection}
                    copyingSection={copyingSection}
                    editorialPeriod={editorialPeriod}
                    includeNewShowsPod={includeNewShowsPod}
                    onIncludeNewShowsPodChange={setIncludeNewShowsPod}
                  />
                </div>
              </>
            ) : null}

            {activeView === "pod-wise" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Team Performance</div>
                  <h1 className="page-header-title">POD Wise</h1>
                  <p className="page-header-sub">Conversion rates and output by POD lead</p>
                </div>
                <div className="section-shell">
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
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
              </>
            ) : null}

            {activeView === "beats-performance" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Beat Output</div>
                  <h1 className="page-header-title">Beats Performance</h1>
                  <p className="page-header-sub">POD-wise beat volume with writer efficiency and hit-rate context</p>
                </div>
                <div className="section-shell">
                  <BeatsPerformanceContent
                    beatsPerformanceData={beatsPerformanceData}
                    beatsPerformanceLoading={beatsPerformanceLoading}
                    beatsPerformanceError={beatsPerformanceError}
                    onShare={copySection}
                    copyingSection={copyingSection}
                  />
                </div>
              </>
            ) : null}

            {activeView === "planner" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Weekly Planning</div>
                  <h1 className="page-header-title">Planner</h1>
                  <p className="page-header-sub">Beat assignments and stage tracking across PODs</p>
                </div>
                <PlannerErrorBoundary>
                  <GanttTracker onPlannerSnapshotChange={setPlannerBoardSnapshot} />
                </PlannerErrorBoundary>
              </>
            ) : null}

            {activeView === "analytics" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Script Performance</div>
                  <h1 className="page-header-title">Analytics</h1>
                  <p className="page-header-sub">{analyticsSubtitle || "Week-on-week script test results from the Live tab."}</p>
                </div>
                <div className="section-shell">
                  <div className="section-toolbar">
                    <label className="toolbar-select">
                      <span>Week</span>
                      <select
                        value={selectedAnalyticsWeekKey}
                        onChange={(event) => setSelectedAnalyticsWeekKey(event.target.value)}
                        disabled={analyticsLoading && !analyticsData}
                      >
                        <option value="last-2-weeks">Last 2 weeks (incl. current)</option>
                        <option value="last-4-weeks">Last 4 weeks</option>
                        {(Array.isArray(analyticsData?.weekOptions) ? analyticsData.weekOptions : []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
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
              </>
            ) : null}

            {activeView === "production" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Output Tracking</div>
                  <h1 className="page-header-title">Production</h1>
                  <p className="page-header-sub">{productionSubtitle}</p>
                </div>
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
              </>
            ) : null}

            {activeView === "details" ? (
              <>
                <div className="page-header">
                  <div className="page-header-kicker">Configuration</div>
                  <h1 className="page-header-title">Details</h1>
                  <p className="page-header-sub">Tracked teams, sync scope, and Analytics next-step logic.</p>
                </div>
                <div className="section-shell">
                  <DetailsContent
                    acdMetricsData={acdMetricsData}
                    acdMetricsLoading={acdMetricsLoading}
                    acdMetricsError={acdMetricsError}
                    analyticsData={analyticsData}
                  />
                </div>
              </>
            ) : null}
          </div>
        </main>
      </div>

      <Notice notice={notice} />
    </>
  );
}
