"use client";

import { Component, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import GanttTracker from "./GanttTracker.jsx";
import { copyNodeImageToClipboard } from "../lib/clipboard-share.js";
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
const CHART_TONE_WARNING = "#c4704b";
const CHART_TONE_DANGER = "#b54c47";
const WRITER_TARGET_PER_WEEK = 1.5;
const ANALYTICS_LEGEND_FALLBACK = [
  { label: "Gen AI", tone: "gen-ai" },
  { label: "P1 Rework", tone: "rework-p1" },
  { label: "P2 Rework", tone: "rework-p2" },
  { label: "Testing / Drop", tone: "testing-drop" },
  { label: "Metric not meeting", tone: "metric-miss" },
];

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

function MetricCard({ label, value, hint, tone = "default", body = null, className = "" }) {
  return (
    <article className={`metric-card tone-${tone} ${className}`.trim()}>
      <div className="metric-label">{label}</div>
      {body ? <div className="metric-body">{body}</div> : <div className="metric-value">{value}</div>}
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </article>
  );
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

function Toolbar({ title, kicker, subtitle, description, actions, children }) {
  return (
    <div className="section-shell">
      <div className="section-toolbar">
        <div>
          {kicker ? <div className="section-kicker">{kicker}</div> : null}
          <h2 className="section-title">{title}</h2>
          {subtitle ? <div className="section-subtitle">{subtitle}</div> : null}
          {description ? <div className="section-description">{description}</div> : null}
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
          <CartesianGrid horizontal={false} stroke="#eadfcc" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tick={{ fill: "#6d5b45", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            label={{ value: "Minutes", position: "insideBottomRight", offset: -2, fill: "#6d5b45", fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={yAxisWidth}
            tick={{ fill: "#34291d", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgba(20, 107, 101, 0.08)" }} content={<AcdChartTooltip />} />
          <Bar dataKey="totalMinutes" radius={[0, 10, 10, 0]}>
            <LabelList
              dataKey="totalMinutes"
              position="right"
              formatter={(value) => `${formatNumber(value)} min`}
              fill="#34291d"
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

function OverviewWeekSection({
  period,
  overviewData,
  overviewLoading,
  overviewError,
  productionData,
  productionLoading,
  productionError,
  onShare,
  isSharing,
}) {
  const notes = buildOverviewNotes({ overviewError, overviewData });
  const sectionTitle =
    period === "current"
      ? "Current week editorial funnel"
      : period === "next"
        ? "Plan for next week"
        : "Output from last week";
  const unavailableMetricValue = overviewError ? "-" : null;
  const tatSummary = overviewData?.tatSummary || {};
  const tatValue =
    overviewLoading || !overviewData
      ? "..."
      : unavailableMetricValue
        ? unavailableMetricValue
      : tatSummary?.eligibleAssetCount > 0 && tatSummary?.averageTatDays !== null
        ? formatTat(tatSummary.averageTatDays)
        : "-";

  const cards =
    period === "current"
      ? [
            {
              label: "Number of beats being worked on",
            value:
              overviewLoading || !overviewData
                ? "..."
                : unavailableMetricValue || formatMetricValue(overviewData.plannerBeatCount),
            hint:
              overviewData?.weekStart && overviewData?.weekEnd
                ? `Planner / ${formatDateLabel(overviewData.weekStart)} to ${formatDateLabel(overviewData.weekEnd)}`
                : "Planner",
            tone: "default",
          },
          {
            label: "Number of assets planned to be live this week",
            value:
              overviewLoading || !overviewData
                ? "..."
                : unavailableMetricValue || formatMetricValue(overviewData.plannedReleaseCount ?? overviewData.freshTakeCount),
            hint: (
              <>
                <div>Target: 22</div>
                <div>All planner scripts with any Live on Meta cell this week.</div>
              </>
            ),
            tone: getTargetCardTone(overviewData?.plannedReleaseCount ?? overviewData?.freshTakeCount, overviewData?.targetFloor),
          },
          {
            label: "Number of assets moving to production this week",
            value:
              overviewLoading || !overviewData
                ? "..."
                : unavailableMetricValue || formatMetricValue(overviewData.inProductionBeatCount),
            hint: "All planner scripts with any Production cell this week.",
            tone: "default",
          },
          {
            label: "Expected production TAT",
            value: tatValue,
            hint:
              tatSummary?.averageTatDays !== null
                ? "Planner Production cells divided by unique beats that entered Production."
                : overviewData?.tatEmptyMessage || "No planner beats are assigned for the selected week yet.",
            tone: getTatCardTone(tatSummary?.averageTatDays, tatSummary?.targetTatDays),
          },
          {
            label: "Average number of scripts pushed to production per writer",
            value:
              overviewLoading || !overviewData
                ? "..."
                : unavailableMetricValue || (overviewData?.scriptsPerWriter !== null && overviewData?.scriptsPerWriter !== undefined ? String(overviewData.scriptsPerWriter) : "-"),
            hint:
              overviewData?.scriptsPerWriter !== null && overviewData?.scriptsPerWriter !== undefined
                ? "Beats entering Production divided by number of writers."
                : overviewData?.writingEmptyMessage || "No planner beats are assigned for the selected week yet.",
            tone: "default",
          },
          {
            label: "Average CL review days",
            value:
              overviewLoading || !overviewData
                ? "..."
                : unavailableMetricValue || formatTat(overviewData?.averageClReviewDays),
            hint:
              overviewData?.averageClReviewDays !== null && overviewData?.averageClReviewDays !== undefined
                ? "Planner CL review cells divided by unique beats."
                : overviewData?.clReviewEmptyMessage || "No planner beats are assigned for the selected week yet.",
            tone: getClReviewDaysTone(overviewData?.averageClReviewDays),
          },
        ]
      : period === "next"
        ? [
            {
              label: "Number of beats locked GTG for next week",
              value:
                overviewLoading || !overviewData
                  ? "..."
                  : unavailableMetricValue || formatMetricValue(overviewData.plannerBeatCount),
              hint:
                overviewData?.plannerBeatCount !== null && overviewData?.plannerBeatCount !== undefined
                  ? "Unique beats selected in Planner for next week."
                  : overviewData?.emptyStateMessage || "No planner beats are assigned for next week yet.",
              tone: "default",
            },
            {
              label: "Number of assets planned to be live next week",
              value:
                overviewLoading || !overviewData
                  ? "..."
                  : unavailableMetricValue || formatMetricValue(overviewData.plannedReleaseCount),
              hint: (
                <>
                  <div>Target: 22</div>
                  <div>Planner-based release plan for next week.</div>
                </>
              ),
              tone: getTargetCardTone(overviewData?.plannedReleaseCount, overviewData?.targetFloor),
            },
            {
              label: "Expected production TAT",
              value: tatValue,
              hint:
                tatSummary?.averageTatDays !== null
                  ? "Planner Production cells divided by unique beats that entered Production."
                  : overviewData?.tatEmptyMessage || "Planner allocations are not sufficient yet.",
              tone: getTatCardTone(tatSummary?.averageTatDays, tatSummary?.targetTatDays),
            },
            {
              label: "Average writing days",
              value:
                overviewLoading || !overviewData
                  ? "..."
                  : unavailableMetricValue || formatTat(overviewData?.averageWritingDays),
              hint:
                overviewData?.averageWritingDays !== null && overviewData?.averageWritingDays !== undefined
                  ? "Planner Writing cells divided by unique beats."
                  : overviewData?.writingEmptyMessage || "Planner allocations are not sufficient yet.",
              tone: getWritingDaysTone(overviewData?.averageWritingDays),
            },
            {
              label: "Average CL review days",
              value:
                overviewLoading || !overviewData
                  ? "..."
                  : unavailableMetricValue || formatTat(overviewData?.averageClReviewDays),
              hint:
                overviewData?.averageClReviewDays !== null && overviewData?.averageClReviewDays !== undefined
                  ? "Planner CL review cells divided by unique beats."
                  : overviewData?.clReviewEmptyMessage || "Planner allocations are not sufficient yet.",
              tone: getClReviewDaysTone(overviewData?.averageClReviewDays),
            },
          ]
        : [
            {
              label: "Number of unique fresh takes released",
              value:
                overviewLoading || !overviewData
                  ? "..."
                  : unavailableMetricValue || formatMetricValue(overviewData.freshTakeCount),
              hint: "Released fresh-take attempts from the Live tab for the selected completed week.",
              tone: getTargetCardTone(overviewData?.freshTakeCount, overviewData?.targetFloor),
            },
            {
              label: "Production TAT",
              value: tatValue,
              hint:
                tatSummary?.eligibleAssetCount > 0
                  ? "Calculated from last-week fresh takes released in Live tab."
                  : overviewData?.tatEmptyMessage || "No eligible TAT rows were found for this completed week.",
              tone: getTatCardTone(tatSummary?.averageTatDays, tatSummary?.targetTatDays),
            },
            {
              label: "Hit rate",
              value:
                overviewLoading || !overviewData
                  ? "..."
                  : unavailableMetricValue ||
                    (overviewData.hitRate !== null && overviewData.hitRate !== undefined
                      ? `${overviewData.hitRate.toFixed(1)}%`
                      : "-"),
              hint: `Gen AI + P1 Rework assets out of all analytics-eligible released assets. (${overviewData?.hitRateNumerator ?? 0}/${overviewData?.hitRateDenominator ?? 0})`,
              tone: "default",
            },
          ];

  return (
    <ShareablePanel
      shareLabel={`Editorial Funnel ${getWeekViewLabel(period)}`}
      onShare={onShare}
      isSharing={isSharing}
      className="overview-week-panel"
    >
      <div className="panel-head">
        <div>
          <div className="panel-title">{sectionTitle}</div>
          <div className="panel-statline">{overviewData?.weekLabel || productionData?.weekLabel || ""}</div>
        </div>
      </div>

      <div className="section-stack">
        {notes.map((note) => (
          <div key={note} className="warning-note">
            {note}
          </div>
        ))}

        <div className="metric-grid">
          {cards.map((card) => (
            <MetricCard
              key={card.label}
              label={card.label}
              value={card.value}
              hint={card.hint}
              tone={card.tone}
              body={card.body}
              className={card.className}
            />
          ))}
        </div>

        {period === "last" && Array.isArray(overviewData?.beatsFunnel) && overviewData.beatsFunnel.length > 0 && (
          <div className="beats-funnel-section">
            <div className="panel-subtitle">Beats Funnel</div>
            <table className="beats-funnel-table">
              <colgroup>
                <col className="col-show" />
                <col className="col-beat" />
                <col className="col-attempts" />
                <col className="col-success" />
              </colgroup>
              <thead>
                <tr>
                  <th>Show</th>
                  <th>Beat</th>
                  <th className="col-right">Attempts</th>
                  <th className="col-right">Successful Attempts</th>
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
                          {k === i && <td rowSpan={span}>{row.showName}</td>}
                          <td>{row.beatName}</td>
                          <td className="col-right">{row.attempts}</td>
                          <td className="col-right">{row.successfulAttempts}</td>
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
        )}
      </div>
    </ShareablePanel>
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
}) {
  return (
    <div className="section-stack">
      {OVERVIEW_PERIODS.map((period) => (
        <OverviewWeekSection
          key={period}
          period={period}
          overviewData={overviewDataByPeriod[period]}
          overviewLoading={Boolean(overviewLoadingByPeriod[period])}
          overviewError={overviewErrorByPeriod[period] || ""}
          productionData={productionDataByPeriod[period]}
          productionLoading={Boolean(productionLoadingByPeriod[period])}
          productionError={productionErrorByPeriod[period] || ""}
          onShare={onShare}
          isSharing={copyingSection === `Editorial Funnel ${getWeekViewLabel(period)}`}
        />
      ))}
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
    const safeRows = Array.isArray(rows) ? rows : [];
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
  }, [hideActioned, rows]);
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
                  {legendItems.map((item) => (
                    <div key={item.label} className="analytics-legend-chip">
                      <span className={`details-legend-swatch ${getAnalyticsLegendToneClass(item.tone)}`.trim()} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>

                <div className="analytics-controls-row" data-share-ignore="true">
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

function PodWiseContent({ competitionPodRows, competitionLoading, onShare, copyingSection }) {
  if (competitionLoading) {
    return <EmptyState text="Loading POD Wise dashboard..." />;
  }

  const competitionRows = Array.isArray(competitionPodRows) ? competitionPodRows : [];
  if (competitionRows.length === 0) {
    return <EmptyState text="POD Wise data is not available right now." />;
  }

  return (
    <div className="section-stack">
      <ShareablePanel
        shareLabel="POD Wise leaderboard"
        onShare={onShare}
        isSharing={copyingSection === "POD Wise leaderboard"}
      >
        <div className="section-stack">
          <div>
            <div className="panel-title">POD wise leaderboard</div>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart
                data={competitionRows.map((row) => ({
                  name: row.podLeadName,
                  "Lifetime beats": row.lifetimeBeats,
                  "Lifetime scripts": row.lifetimeScripts,
                  "Successful scripts": row.hitRateNumerator,
                }))}
                margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Lifetime beats" fill="#146b65" />
                <Bar dataKey="Lifetime scripts" fill="#c28b2c" />
                <Bar dataKey="Successful scripts" fill="#3f7d4f" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ShareablePanel>
    </div>
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
  const [activeView, setActiveView] = useState("overview");
  const [selectedAnalyticsWeekKey, setSelectedAnalyticsWeekKey] = useState(getWeekSelection("last").weekKey);
  const [plannerBoardSnapshot, setPlannerBoardSnapshot] = useState(null);
  const [overviewDataByPeriod, setOverviewDataByPeriod] = useState({});
  const [overviewLoadingByPeriod, setOverviewLoadingByPeriod] = useState(
    Object.fromEntries(OVERVIEW_PERIODS.map((period) => [period, true]))
  );
  const [overviewErrorByPeriod, setOverviewErrorByPeriod] = useState({});
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
    if (activeView !== "analytics") {
      return undefined;
    }

    let cancelled = false;

    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError("");

      try {
        const response = await fetch(
          `/api/dashboard/analytics?week=${encodeURIComponent(selectedAnalyticsWeekKey)}`,
          { cache: "no-store" }
        );
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Analytics dashboard.");
        }

        if (!cancelled) {
          setAnalyticsData(payload);
          if (payload?.selectedWeekKey && payload.selectedWeekKey !== selectedAnalyticsWeekKey) {
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

  const viewNavItems = [
    ["overview", "Editorial Funnel"],
    ["pod-wise", "POD Wise"],
    ["planner", "Planner"],
    ["analytics", "Analytics"],
    ["production", "Production"],
  ];
  const moreNavItems = [
    ["details", "Details"],
  ];

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-name">Fresh Takes</div>
            <div className="sidebar-brand-sub">Pocket FM</div>
          </div>

          <nav className="sidebar-section" aria-label="Views">
            <div className="sidebar-section-label">Views</div>
            {viewNavItems.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`sidebar-link${activeView === id ? " active" : ""}`}
                onClick={() => setActiveView(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <nav className="sidebar-section" aria-label="More">
            <div className="sidebar-section-label">More</div>
            {moreNavItems.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`sidebar-link${activeView === id ? " active" : ""}`}
                onClick={() => setActiveView(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="ops-main">
          <div className="ops-shell">
            {activeView === "overview" ? (
              <Toolbar
                kicker="This week's pipeline"
                title="Editorial Funnel"
                description="Scripts moving through review, testing, and production this week."
                actions={
                  <label className="toggle-label" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                    <input
                      type="checkbox"
                      checked={includeNewShowsPod}
                      onChange={(e) => setIncludeNewShowsPod(e.target.checked)}
                    />
                    Include new shows POD
                  </label>
                }
              >
                <OverviewContent
                  overviewDataByPeriod={effectiveOverviewDataByPeriod}
                  overviewLoadingByPeriod={effectiveOverviewLoadingByPeriod}
                  overviewErrorByPeriod={effectiveOverviewErrorByPeriod}
                  productionDataByPeriod={productionDataByPeriod}
                  productionLoadingByPeriod={productionLoadingByPeriod}
                  productionErrorByPeriod={productionErrorByPeriod}
                  onShare={copySection}
                  copyingSection={copyingSection}
                />
              </Toolbar>
            ) : null}

            {activeView === "pod-wise" ? (
              <Toolbar
                kicker="Team performance"
                title="POD Wise"
                description="Conversion rates and output by POD lead."
              >
                <PodWiseContent
                  competitionPodRows={competitionData?.podRows}
                  competitionLoading={competitionLoading}
                  onShare={copySection}
                  copyingSection={copyingSection}
                />
              </Toolbar>
            ) : null}

            {activeView === "planner" ? (
              <PlannerErrorBoundary>
                <GanttTracker onPlannerSnapshotChange={setPlannerBoardSnapshot} />
              </PlannerErrorBoundary>
            ) : null}

            {activeView === "analytics" ? (
              <Toolbar
                kicker="Script performance"
                title="Analytics"
                subtitle={analyticsSubtitle || ""}
                description="Week-on-week script test results from the Live tab."
                actions={
                  <label className="toolbar-select">
                    <span>Week</span>
                    <select
                      value={selectedAnalyticsWeekKey}
                      onChange={(event) => setSelectedAnalyticsWeekKey(event.target.value)}
                      disabled={analyticsLoading && !analyticsData}
                    >
                      {(Array.isArray(analyticsData?.weekOptions) ? analyticsData.weekOptions : []).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                }
              >
                <AnalyticsContent
                  analyticsData={analyticsData}
                  analyticsLoading={analyticsLoading}
                  analyticsError={analyticsError}
                  onShare={copySection}
                  copyingSection={copyingSection}
                  onToggleActioned={updateAnalyticsActioned}
                  actionedBusyKey={analyticsActionedBusyKey}
                />
              </Toolbar>
            ) : null}

            {activeView === "production" ? (
              <Toolbar
                kicker="Output tracking"
                title="Production"
                subtitle={productionSubtitle}
                description="ACD productivity, image sheet tracking, and sync status."
              >
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
              </Toolbar>
            ) : null}

            {activeView === "details" ? (
              <Toolbar
                kicker="Configuration"
                title="Details"
                description="Tracked teams, sync scope, and Analytics next-step logic."
              >
                <DetailsContent
                  acdMetricsData={acdMetricsData}
                  acdMetricsLoading={acdMetricsLoading}
                  acdMetricsError={acdMetricsError}
                  analyticsData={analyticsData}
                />
              </Toolbar>
            ) : null}
          </div>
        </main>
      </div>

      <Notice notice={notice} />
    </>
  );
}
