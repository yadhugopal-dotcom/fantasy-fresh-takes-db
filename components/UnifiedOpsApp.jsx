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
        <section className="panel-card details-card-no-accent">
          <div className="funnel-section-head">
            <div className="panel-subtitle">Teams currently being tracked</div>
            <div className="section-description">
              ACD sync reads from the Live tab only, processes Final image sheet links from column AZ, and reports only
              rows stored as <code>live_tab_sync</code>.
            </div>
          </div>
          <div className="section-stack" style={{ marginTop: 12 }}>
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

        <section className="panel-card details-card-no-accent">
          <div className="funnel-section-head">
            <div className="panel-subtitle">Analytics legend</div>
            <div className="section-description">Use this to decide which attempts are ready for Full Gen AI, need rework, or should be dropped.</div>
          </div>
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

      <section className="panel-card details-card-no-accent">
        <div className="funnel-section-head">
          <div className="panel-subtitle">Next step logic</div>
          <div className="section-description">
            Amount spent is a hard gate. Assets with less than $100 spend are classified as Testing / Drop.
            Attempts without a readable CPI are excluded from Analytics entirely.
          </div>
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
        <div className="details-panel-copy" style={{ marginTop: 14 }}>
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
          <CartesianGrid horizontal={false} stroke="#e0d5c7" strokeDasharray="3 3" />
          <XAxis
            type="number"
            tick={{ fill: "#8c847d", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            label={{ value: "Minutes", position: "insideBottomRight", offset: -2, fill: "#8c847d", fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={yAxisWidth}
            tick={{ fill: "#2c2c2c", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgba(196, 112, 75, 0.06)" }} content={<AcdChartTooltip />} />
          <Bar dataKey="totalMinutes" radius={[0, 10, 10, 0]}>
            <LabelList
              dataKey="totalMinutes"
              position="right"
              formatter={(value) => `${formatNumber(value)} min`}
              fill="#2c2c2c"
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

function ReadinessChecklistItem({ label, done }) {
  return (
    <div className="readiness-item">
      <span className="readiness-label">{label}</span>
      <span className={`readiness-status ${done ? "readiness-status-done" : "readiness-status-pending"}`}>
        {done ? "Done" : "Pending"}
      </span>
    </div>
  );
}

function OverviewWeekSection({
  period,
  overviewData,
  overviewLoading,
  overviewError,
  productionData,
  productionLoading,
  productionError,
  writerTrackerData,
  writerTrackerLoading,
  writerTrackerError,
  onShare,
  isSharing,
}) {
  const notes = buildOverviewNotes({ overviewError, overviewData });
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
  const weekLabel = overviewData?.weekLabel || productionData?.weekLabel || "";

  if (overviewLoading && !overviewData) {
    return <EmptyState text="Loading Editorial Funnel..." />;
  }

  /* ── LAST WEEK ── */
  if (period === "last") {
    return (
      <ShareablePanel
        shareLabel={`Editorial Funnel ${getWeekViewLabel(period)}`}
        onShare={onShare}
        isSharing={isSharing}
        className="overview-week-panel"
      >
        <div className="funnel-section-head">
          <div className="panel-title">Output from last week</div>
          <div className="panel-statline">{weekLabel}</div>
          <div className="section-description">What shipped last week and how it performed.</div>
        </div>

        <div className="section-stack">
          {notes.map((note) => (
            <div key={note} className="warning-note">{note}</div>
          ))}

          <div className="metric-grid funnel-metric-row-3">
            <MetricCard
              label="Fresh takes released"
              value={unavailableMetricValue || formatMetricValue(overviewData?.freshTakeCount)}
              hint="Unique attempts from Live tab."
              tone={getTargetCardTone(overviewData?.freshTakeCount, overviewData?.targetFloor)}
            />
            <MetricCard
              label="Production TAT"
              value={tatValue}
              hint={
                tatSummary?.eligibleAssetCount > 0
                  ? "From last week's Live tab."
                  : overviewData?.tatEmptyMessage || "No eligible TAT rows found."
              }
              tone={getTatCardTone(tatSummary?.averageTatDays, tatSummary?.targetTatDays)}
            />
            <MetricCard
              label="Hit rate"
              value={
                unavailableMetricValue ||
                (overviewData?.hitRate !== null && overviewData?.hitRate !== undefined
                  ? `${overviewData.hitRate.toFixed(1)}%`
                  : "-")
              }
              hint={
                <>
                  <div>{overviewData?.hitRateNumerator ?? 0} of {overviewData?.hitRateDenominator ?? 0} analytics-eligible assets.</div>
                  <div style={{ marginTop: 4, fontSize: "0.82rem", color: "var(--muted)" }}>Success = $100+ spent, Q1 &gt; 10%, CTI &ge; 12%, Abs completion &ge; 1.8%, CPI &le; $12</div>
                </>
              }
              tone="default"
            />
          </div>

          {Array.isArray(overviewData?.beatsFunnel) && overviewData.beatsFunnel.length > 0 && (
            <div className="beats-funnel-section">
              <div className="funnel-section-head" style={{ marginBottom: 12 }}>
                <div className="panel-subtitle">Beats funnel</div>
                <div className="panel-statline" style={{ fontSize: "0.82rem" }}>
                  Beats released and their conversion in the last week.
                </div>
              </div>
              <div className="table-wrap">
                <table className="beats-funnel-table ops-table">
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
                      <th className="col-right">Successful</th>
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
                              <td className="col-right" style={isSuccess ? { color: "var(--forest)", fontWeight: 700 } : { color: "var(--red)" }}>
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
            </div>
          )}
        </div>
      </ShareablePanel>
    );
  }

  /* ── THIS WEEK (current) ── */
  if (period === "current") {
    const [expandedWriters, setExpandedWriters] = useState(new Set());

    if (writerTrackerLoading && !writerTrackerData) {
      return <EmptyState text="Loading Writer Tracker..." />;
    }
    if (writerTrackerError) {
      return <EmptyState text={`Writer Tracker error: ${writerTrackerError}`} />;
    }

    const trackerRows = writerTrackerData?.trackerRows || [];
    const stageCounts = writerTrackerData?.stageCounts || {};
    const dayOfWeek = writerTrackerData?.dayOfWeek ?? new Date().getDay();
    const totalAllocated = writerTrackerData?.totalAllocated || 0;
    const totalThisWeek = writerTrackerData?.totalThisWeek || 0;
    const totalGap = writerTrackerData?.totalGap || 0;
    const totalSpillovers = writerTrackerData?.totalSpillovers || 0;

    const STAGE_LABELS = {
      writing: "Writing",
      pending_review: "Pending Review",
      reviewed_by_lead: "Reviewed",
      moving_to_production: "Moving to Prod",
      ready_for_production: "Ready for Prod",
    };

    const commitTarget = 17;
    const commitMax = 20;
    const commitPct = Math.min(100, Math.round((totalThisWeek / commitMax) * 100));
    const commitColor = totalThisWeek >= commitTarget ? "#1a4731" : totalThisWeek >= 12 ? "#b8860b" : "#c0392b";

    const gapClass = (gap) => {
      if (gap === 0) return "gap-zero";
      if (gap === 1 && dayOfWeek <= 2) return "gap-amber";
      return "gap-red";
    };

    const grouped = new Map();
    for (const row of trackerRows) {
      if (!grouped.has(row.podLead)) grouped.set(row.podLead, []);
      grouped.get(row.podLead).push(row);
    }

    const toggleWriter = (name) => {
      setExpandedWriters((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    };

    const stageOrder = ["writing", "pending_review", "reviewed_by_lead", "ready_for_production"];

    return (
      <ShareablePanel
        shareLabel={`Editorial Funnel ${getWeekViewLabel(period)}`}
        onShare={onShare}
        isSharing={isSharing}
        className="overview-week-panel"
      >
        <div className="funnel-section-head">
          <div className="panel-title">This week</div>
          <div className="panel-statline">{writerTrackerData?.weekLabel || weekLabel}</div>
          <div className="section-description">Writer delivery, stage pipeline, and efficiency.</div>
        </div>

        <div className="section-stack">
          {notes.map((note) => (
            <div key={note} className="warning-note">{note}</div>
          ))}

          {/* Section 1 — Planning Health */}
          <div className="planning-health">
            <span className="planning-health-label">{totalThisWeek} of {commitTarget}–{commitMax}</span>
            <div className="planning-health-bar">
              <div
                className="planning-health-fill"
                style={{ width: `${commitPct}%`, background: commitColor }}
              />
            </div>
            <span className="planning-health-target">beats committed</span>
          </div>

          {/* Section 2 — Writer Delivery Tracker */}
          <div className="tracker-table-wrap">
            <table className="tracker-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Writer</th>
                  <th className="col-right">Allocated</th>
                  <th className="col-right">This Week</th>
                  <th className="col-right">Gap</th>
                  <th className="col-right">Spillovers</th>
                  <th className="col-right">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {[...grouped.entries()].map(([podLead, writers]) => (
                  <>
                    <tr key={`pod-${podLead}`} className="tracker-pod-header">
                      <td colSpan={7}>{podLead}</td>
                    </tr>
                    {writers.map((w) => {
                      const isOpen = expandedWriters.has(w.writerName);
                      return (
                        <>
                          <tr
                            key={w.writerName}
                            className="tracker-writer-row"
                            onClick={() => toggleWriter(w.writerName)}
                          >
                            <td>
                              <span className={`tracker-expand-icon${isOpen ? " is-expanded" : ""}`}>▶</span>
                            </td>
                            <td>{w.writerName}</td>
                            <td className="col-right">{w.allocated}</td>
                            <td className="col-right">{w.thisWeekCount}</td>
                            <td className={`col-right ${gapClass(w.gap)}`}>{w.gap}</td>
                            <td className="col-right">{w.spilloverCount}</td>
                            <td className="col-right">
                              {w.ambiguousCount > 0 ? (
                                <span className="flag-badge">⚠ {w.ambiguousCount}</span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr key={`${w.writerName}-detail`} className="tracker-detail-row">
                              <td colSpan={7}>
                                <div className="tracker-beat-detail">
                                  {w.thisWeekBeats?.length > 0 && (
                                    <>
                                      <div className="tracker-beat-category">This Week</div>
                                      {w.thisWeekBeats.map((b, i) => (
                                        <div key={`tw-${i}`} className="tracker-beat-item">
                                          <div>
                                            <span className="tracker-beat-name">{b.beatName}</span>
                                            {" "}
                                            <span className="tracker-beat-show">{b.showName}</span>
                                          </div>
                                          <span className={`tracker-beat-stage stage-${b.stage}`}>
                                            {STAGE_LABELS[b.stage] || b.stage}
                                          </span>
                                        </div>
                                      ))}
                                    </>
                                  )}
                                  {w.spilloverBeats?.length > 0 && (
                                    <>
                                      <div className="tracker-beat-category">Spillovers</div>
                                      {w.spilloverBeats.map((b, i) => (
                                        <div key={`sp-${i}`} className="tracker-beat-item">
                                          <div>
                                            <span className="tracker-beat-name">{b.beatName}</span>
                                            {" "}
                                            <span className="tracker-beat-show">{b.showName}</span>
                                          </div>
                                          <span className={`tracker-beat-stage stage-${b.stage}`}>
                                            {STAGE_LABELS[b.stage] || b.stage}
                                          </span>
                                        </div>
                                      ))}
                                    </>
                                  )}
                                  {w.ambiguousBeats?.length > 0 && (
                                    <>
                                      <div className="tracker-beat-category">Flagged / Ambiguous</div>
                                      {w.ambiguousBeats.map((b, i) => (
                                        <div key={`am-${i}`} className="tracker-beat-item">
                                          <div>
                                            <span className="tracker-beat-name">{b.beatName}</span>
                                            {" "}
                                            <span className="tracker-beat-show">{b.showName}</span>
                                          </div>
                                          <span className={`tracker-beat-stage stage-${b.stage}`}>
                                            {STAGE_LABELS[b.stage] || b.stage}
                                          </span>
                                        </div>
                                      ))}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Section 3 — Stage Breakdown */}
          <div className="stage-pipeline">
            {stageOrder.map((key) => (
              <div key={key} className="stage-pipeline-node">
                <div className="stage-pipeline-count">{stageCounts[key] || 0}</div>
                <div className="stage-pipeline-label">{STAGE_LABELS[key]}</div>
              </div>
            ))}
          </div>
          {totalSpillovers > 0 && (
            <div className="spillover-note">{totalSpillovers} spillover{totalSpillovers !== 1 ? "s" : ""} from previous weeks</div>
          )}

          {/* Section 4 — Efficiency Stats */}
          <div className="metric-grid funnel-metric-row-3">
            <MetricCard
              label="Scripts per writer"
              value={
                writerTrackerData?.scriptsPerWriter !== null && writerTrackerData?.scriptsPerWriter !== undefined
                  ? String(writerTrackerData.scriptsPerWriter)
                  : unavailableMetricValue || "-"
              }
              hint="Beats entering production / writers."
              tone="default"
            />
            <MetricCard
              label="Expected production TAT"
              value={tatValue}
              hint={
                tatSummary?.averageTatDays !== null
                  ? "Production cells / unique beats."
                  : overviewData?.tatEmptyMessage || "Not enough data yet."
              }
              tone={getTatCardTone(tatSummary?.averageTatDays, tatSummary?.targetTatDays)}
            />
            <MetricCard
              label="Avg CL review days"
              value={unavailableMetricValue || formatTat(overviewData?.averageClReviewDays)}
              hint={
                overviewData?.averageClReviewDays !== null && overviewData?.averageClReviewDays !== undefined
                  ? "CL review cells / unique beats."
                  : overviewData?.clReviewEmptyMessage || "Not enough data yet."
              }
              tone={getClReviewDaysTone(overviewData?.averageClReviewDays)}
            />
          </div>
        </div>
      </ShareablePanel>
    );
  }

  /* ── NEXT WEEK ── */
  const beatsLockedGtg = Number(overviewData?.goodToGoBeatsCount || 0) + Number(overviewData?.plannerBeatCount || 0);
  const plannedLive = Number(overviewData?.plannedReleaseCount || 0);
  const targetFloor = Number(overviewData?.targetFloor || 22);
  const shortOfTarget = Math.max(0, targetFloor - plannedLive);

  const hasBeatsLocked = beatsLockedGtg > 0;
  const hasClReview = overviewData?.averageClReviewDays !== null && overviewData?.averageClReviewDays !== undefined;
  const hasProduction = Number(overviewData?.inProductionBeatCount || 0) > 0;
  const hasTat = tatSummary?.averageTatDays !== null;
  const hasShowCoverage = Number(overviewData?.plannerBeatCount || 0) > 0;

  return (
    <ShareablePanel
      shareLabel={`Editorial Funnel ${getWeekViewLabel(period)}`}
      onShare={onShare}
      isSharing={isSharing}
      className="overview-week-panel"
    >
      <div className="section-stack">
        {notes.map((note) => (
          <div key={note} className="warning-note">{note}</div>
        ))}

        <div className="funnel-section-head">
          <div className="panel-title">Plan for next week</div>
          <div className="panel-statline">{weekLabel}</div>
          <div className="section-description">Readiness check: are we set up to hit target next week?</div>
        </div>

        <div className="metric-grid funnel-metric-row-2">
          <MetricCard
            label="Beats locked GTG"
            value={unavailableMetricValue || formatMetricValue(beatsLockedGtg)}
            hint="Confirmed and ready to go."
            tone="default"
          />
          <MetricCard
            label="Assets planned to go live"
            value={unavailableMetricValue || (
              <>
                {formatMetricValue(plannedLive)}
                <span className="metric-value-suffix"> / {targetFloor}</span>
              </>
            )}
            hint={
              shortOfTarget > 0
                ? <span style={{ color: "var(--red)", fontWeight: 700 }}>{shortOfTarget} short of target</span>
                : "On track."
            }
            tone={getTargetCardTone(plannedLive, targetFloor)}
          />
        </div>

        <div className="metric-grid funnel-metric-row-3">
          <MetricCard
            label="Expected production TAT"
            value={tatValue}
            hint={
              hasTat
                ? "Production cells / unique beats."
                : overviewData?.tatEmptyMessage || "Not enough allocations yet."
            }
            tone={getTatCardTone(tatSummary?.averageTatDays, tatSummary?.targetTatDays)}
          />
          <MetricCard
            label="Avg writing days"
            value={unavailableMetricValue || formatTat(overviewData?.averageWritingDays)}
            hint={
              overviewData?.averageWritingDays !== null && overviewData?.averageWritingDays !== undefined
                ? "Writing cells / unique beats."
                : overviewData?.writingEmptyMessage || "Not enough allocations yet."
            }
            tone={getWritingDaysTone(overviewData?.averageWritingDays)}
          />
          <MetricCard
            label="Avg CL review days"
            value={unavailableMetricValue || formatTat(overviewData?.averageClReviewDays)}
            hint={
              hasClReview
                ? "CL review cells / unique beats."
                : overviewData?.clReviewEmptyMessage || "Not enough allocations yet."
            }
            tone={getClReviewDaysTone(overviewData?.averageClReviewDays)}
          />
        </div>

        <div className="readiness-checklist">
          <div className="panel-subtitle">Readiness checklist</div>
          <div className="readiness-list">
            <ReadinessChecklistItem label="Beats locked and assigned to writers" done={hasBeatsLocked} />
            <ReadinessChecklistItem label="Scripts in CL review pipeline" done={hasClReview} />
            <ReadinessChecklistItem label="Scripts cleared for production" done={hasProduction} />
            <ReadinessChecklistItem label="Production slots booked" done={hasTat} />
            <ReadinessChecklistItem label="Show coverage (shows with at least 1 beat)" done={hasShowCoverage} />
          </div>
        </div>
      </div>
    </ShareablePanel>
  );
}

function OverviewContent({
  period,
  overviewDataByPeriod,
  overviewLoadingByPeriod,
  overviewErrorByPeriod,
  productionDataByPeriod,
  productionLoadingByPeriod,
  productionErrorByPeriod,
  writerTrackerData,
  writerTrackerLoading,
  writerTrackerError,
  onShare,
  copyingSection,
}) {
  return (
    <OverviewWeekSection
      period={period}
      overviewData={overviewDataByPeriod[period]}
      overviewLoading={Boolean(overviewLoadingByPeriod[period])}
      overviewError={overviewErrorByPeriod[period] || ""}
      productionData={productionDataByPeriod[period]}
      productionLoading={Boolean(productionLoadingByPeriod[period])}
      productionError={productionErrorByPeriod[period] || ""}
      writerTrackerData={writerTrackerData}
      writerTrackerLoading={writerTrackerLoading}
      writerTrackerError={writerTrackerError}
      onShare={onShare}
      isSharing={copyingSection === `Editorial Funnel ${getWeekViewLabel(period)}`}
    />
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
  const [showPromisingOnly, setShowPromisingOnly] = useState(false);
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
    if (hideActioned) {
      safeRows = safeRows.filter((row) => !row?.actioned);
    } else {
      const activeRows = [];
      const completedRows = [];
      safeRows.forEach((row) => {
        if (row?.actioned) {
          completedRows.push(row);
        } else {
          activeRows.push(row);
        }
      });
      safeRows = [...activeRows, ...completedRows];
    }
    if (showPromisingOnly) {
      safeRows = safeRows.filter((row) => row.rowTone === "gen-ai" || row.rowTone === "rework-p1");
    }
    return safeRows;
  }, [hideActioned, showPromisingOnly, rows]);
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
      <div className="funnel-section-head">
        <div className="panel-subtitle">Weekly script test results</div>
        <div className="panel-statline">{analyticsSubtitle}</div>
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
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`ghost-button${showPromisingOnly ? " analytics-filter-active" : ""}`}
                      onClick={() => setShowPromisingOnly((current) => !current)}
                    >
                      {showPromisingOnly ? "Show all items" : "Show what's promising right now"}
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
                            {showPromisingOnly
                              ? "No promising items (Gen AI or P1 Rework) in the current view."
                              : "All rows for this week are marked actioned. Use \"Show actioned items\" to review them."}
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

function PodWisePerformanceView({ competitionRows, onShare, copyingSection }) {
  const totalBeats = competitionRows.reduce((sum, row) => sum + Number(row.lifetimeBeats || 0), 0);
  const totalScripts = competitionRows.reduce((sum, row) => sum + Number(row.lifetimeScripts || 0), 0);
  const totalSuccessful = competitionRows.reduce((sum, row) => sum + Number(row.hitRateNumerator || 0), 0);
  const avgConversion = totalScripts > 0 ? Number(((totalSuccessful / totalScripts) * 100).toFixed(0)) : 0;
  const maxBarValue = Math.max(
    ...competitionRows.map((row) =>
      Math.max(Number(row.lifetimeBeats || 0), Number(row.lifetimeScripts || 0))
    ),
    1
  );
  const sorted = [...competitionRows].sort((a, b) => {
    const aRate = Number(a.lifetimeScripts || 0) > 0 ? (Number(a.hitRateNumerator || 0) / Number(a.lifetimeScripts || 0)) : 0;
    const bRate = Number(b.lifetimeScripts || 0) > 0 ? (Number(b.hitRateNumerator || 0) / Number(b.lifetimeScripts || 0)) : 0;
    return bRate - aRate;
  });

  return (
    <div className="section-stack">
      <ShareablePanel
        shareLabel="POD Wise leaderboard"
        onShare={onShare}
        isSharing={copyingSection === "POD Wise leaderboard"}
      >
        <div className="metric-grid pod-metric-row-4">
          <article className="metric-card tone-default">
            <div className="metric-label">Total beats</div>
            <div className="metric-value">{formatNumber(totalBeats)}</div>
          </article>
          <article className="metric-card tone-default">
            <div className="metric-label">Total scripts</div>
            <div className="metric-value">{formatNumber(totalScripts)}</div>
          </article>
          <article className="metric-card tone-default">
            <div className="metric-label">Successful</div>
            <div className="metric-value">{formatNumber(totalSuccessful)}</div>
          </article>
          <article className="metric-card tone-default">
            <div className="metric-label">Avg conversion</div>
            <div className="metric-value">{avgConversion}%</div>
          </article>
        </div>

        <div className="pod-performance-section">
          <div className="panel-head">
            <div className="panel-subtitle">POD performance</div>
            <div className="pod-performance-hint">Ranked by successful scripts as % of total attempted scripts</div>
          </div>

          <div className="pod-rank-list">
            {sorted.map((row, index) => {
              const beats = Number(row.lifetimeBeats || 0);
              const scripts = Number(row.lifetimeScripts || 0);
              const successful = Number(row.hitRateNumerator || 0);
              const hitRate = scripts > 0 ? Number(((successful / scripts) * 100).toFixed(0)) : 0;

              return (
                <div key={row.podLeadName} className="pod-rank-card">
                  <div className="pod-rank-left">
                    <div className="pod-rank-circle">{index + 1}</div>
                    <div className="pod-rank-info">
                      <div className="pod-rank-name">{row.podLeadName}</div>
                      <div className="pod-rank-rate">
                        <span className="pod-rank-pct">{hitRate}%</span>
                        <span className="pod-rank-rate-label">Script hit rate</span>
                      </div>
                    </div>
                  </div>
                  <div className="pod-rank-bars">
                    <div className="pod-bar-row">
                      <span className="pod-bar-label">Beats</span>
                      <div className="pod-bar-track">
                        <div className="pod-bar-fill pod-bar-beats" style={{ width: `${(beats / maxBarValue) * 100}%` }} />
                      </div>
                      <span className="pod-bar-count">{beats}</span>
                    </div>
                    <div className="pod-bar-row">
                      <span className="pod-bar-label">Scripts</span>
                      <div className="pod-bar-track">
                        <div className="pod-bar-fill pod-bar-scripts" style={{ width: `${(scripts / maxBarValue) * 100}%` }} />
                      </div>
                      <span className="pod-bar-count">{scripts}</span>
                    </div>
                    <div className="pod-bar-row">
                      <span className="pod-bar-label">Successful</span>
                      <div className="pod-bar-track">
                        <div className="pod-bar-fill pod-bar-successful" style={{ width: `${(successful / maxBarValue) * 100}%` }} />
                      </div>
                      <span className="pod-bar-count">{successful}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pod-legend-row">
            <span className="pod-legend-item"><span className="pod-legend-swatch pod-bar-beats" /> Beats written</span>
            <span className="pod-legend-item"><span className="pod-legend-swatch pod-bar-scripts" /> Scripts produced</span>
            <span className="pod-legend-item"><span className="pod-legend-swatch pod-bar-successful" /> Successful scripts</span>
          </div>
        </div>
      </ShareablePanel>
    </div>
  );
}

function PodWiseTasksView({ podTasksData, podTasksLoading, podTasksError, onShare, copyingSection }) {
  if (podTasksLoading) {
    return <EmptyState text="Loading POD tasks..." />;
  }

  if (podTasksError) {
    return <div className="warning-note">{podTasksError}</div>;
  }

  const pods = Array.isArray(podTasksData?.pods) ? podTasksData.pods : [];
  const totalScriptsToReview = pods.reduce((sum, pod) => sum + Number(pod.scriptsToReview || 0), 0);
  const totalBeatsToReview = pods.reduce((sum, pod) => sum + Number(pod.pendingBeats || 0), 0);
  const maxScripts = Math.max(...pods.map((p) => Number(p.scriptsToReview || 0)), 1);
  const maxBeats = Math.max(...pods.map((p) => Number(p.pendingBeats || 0)), 1);
  const scriptPods = [...pods].filter((p) => Number(p.scriptsToReview || 0) > 0).sort((a, b) => Number(b.scriptsToReview || 0) - Number(a.scriptsToReview || 0));
  const beatPods = [...pods].filter((p) => Number(p.pendingBeats || 0) > 0).sort((a, b) => Number(b.pendingBeats || 0) - Number(a.pendingBeats || 0));

  return (
    <div className="section-stack">
      <ShareablePanel
        shareLabel="POD Wise tasks"
        onShare={onShare}
        isSharing={copyingSection === "POD Wise tasks"}
      >
        <div className="metric-grid funnel-metric-row-2">
          <article className="metric-card tone-default">
            <div className="metric-label">Scripts to review</div>
            <div className="metric-value">{formatNumber(totalScriptsToReview)}</div>
          </article>
          <article className="metric-card tone-default">
            <div className="metric-label">Beats to review</div>
            <div className="metric-value">{formatNumber(totalBeatsToReview)}</div>
          </article>
        </div>

        <div className="pod-tasks-section">
          <div className="panel-head">
            <div className="panel-subtitle">Scripts pending approval</div>
            <div className="pod-performance-hint">Scripts completed by writer, awaiting POD lead review</div>
          </div>
          {scriptPods.length > 0 ? (
            <div className="pod-tasks-bar-list">
              {scriptPods.map((pod) => {
                const count = Number(pod.scriptsToReview || 0);
                return (
                  <div key={pod.podLeadName} className="pod-tasks-bar-row">
                    <span className="pod-tasks-bar-name">{pod.podLeadName}</span>
                    <div className="pod-bar-track">
                      <div className="pod-bar-fill pod-bar-beats" style={{ width: `${(count / maxScripts) * 100}%` }} />
                    </div>
                    <span className="pod-bar-count" style={{ color: "var(--forest)", fontWeight: 700 }}>{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text="No scripts pending review right now." />
          )}
        </div>

        <div className="pod-tasks-section">
          <div className="panel-head">
            <div className="panel-subtitle">Beats pending approval</div>
            <div className="pod-performance-hint">Beats from current week in review pending or iterate status</div>
          </div>
          {beatPods.length > 0 ? (
            <div className="pod-tasks-bar-list">
              {beatPods.map((pod) => {
                const count = Number(pod.pendingBeats || 0);
                return (
                  <div key={pod.podLeadName} className="pod-tasks-bar-row">
                    <span className="pod-tasks-bar-name">{pod.podLeadName}</span>
                    <div className="pod-bar-track">
                      <div className="pod-bar-fill pod-bar-scripts" style={{ width: `${(count / maxBeats) * 100}%` }} />
                    </div>
                    <span className="pod-bar-count">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text="No beats pending approval right now." />
          )}
        </div>
      </ShareablePanel>
    </div>
  );
}

function PodWiseContent({ view, competitionPodRows, competitionLoading, podTasksData, podTasksLoading, podTasksError, onShare, copyingSection }) {
  if (view === "tasks") {
    return (
      <PodWiseTasksView
        podTasksData={podTasksData}
        podTasksLoading={podTasksLoading}
        podTasksError={podTasksError}
        onShare={onShare}
        copyingSection={copyingSection}
      />
    );
  }

  if (competitionLoading) {
    return <EmptyState text="Loading POD Wise dashboard..." />;
  }

  const competitionRows = Array.isArray(competitionPodRows) ? competitionPodRows : [];
  if (competitionRows.length === 0) {
    return <EmptyState text="POD Wise data is not available right now." />;
  }

  return (
    <PodWisePerformanceView
      competitionRows={competitionRows}
      onShare={onShare}
      copyingSection={copyingSection}
    />
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
        <div className="funnel-section-head">
          <div className="panel-subtitle">ACD Daily Sync</div>
          <div className="panel-statline">{buildAcdSyncMeta(syncStatus)}</div>
        </div>
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
            <div className="funnel-section-head">
              <div className="panel-subtitle">{viewLabel} productivity chart</div>
              <div className="panel-statline">
                <span>{dataset.rows.length > 0 ? dataset.meta : acdMetricsData.emptyStateMessage || EMPTY_ACD_MESSAGE}</span>
                {latestWorkDateLabel ? <span> Latest synced work date: {latestWorkDateLabel}</span> : null}
              </div>
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
        <div className="funnel-section-head">
          <div className="panel-subtitle">ACD Sync Rules and Adherence Issues</div>
          <div className="panel-statline">{buildAcdAdherenceMeta(syncStatus)}</div>
        </div>
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

const OVERVIEW_PERIOD_OPTIONS = [
  { id: "last", label: "Last week" },
  { id: "current", label: "This week" },
  { id: "next", label: "Next week" },
];

export default function UnifiedOpsApp() {
  const [activeView, setActiveView] = useState("overview");
  const [overviewPeriod, setOverviewPeriod] = useState("current");
  const [writerTrackerData, setWriterTrackerData] = useState(null);
  const [writerTrackerLoading, setWriterTrackerLoading] = useState(false);
  const [writerTrackerError, setWriterTrackerError] = useState("");
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
  const [podWiseView, setPodWiseView] = useState("performance");
  const [competitionData, setCompetitionData] = useState(null);
  const [competitionLoading, setCompetitionLoading] = useState(true);
  const [podTasksData, setPodTasksData] = useState(null);
  const [podTasksLoading, setPodTasksLoading] = useState(false);
  const [podTasksError, setPodTasksError] = useState("");
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
    if (activeView !== "overview" || overviewPeriod !== "current") {
      return undefined;
    }

    let cancelled = false;

    async function loadWriterTracker() {
      setWriterTrackerLoading(true);
      setWriterTrackerError("");
      try {
        const response = await fetch(
          `/api/dashboard/writer-tracker?includeNewShowsPod=${includeNewShowsPod}`,
          { cache: "no-store" }
        );
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load writer tracker.");
        }
        if (!cancelled) {
          setWriterTrackerData(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setWriterTrackerError(error.message || "Unable to load writer tracker.");
        }
      } finally {
        if (!cancelled) {
          setWriterTrackerLoading(false);
        }
      }
    }

    void loadWriterTracker();
    return () => {
      cancelled = true;
    };
  }, [activeView, overviewPeriod, includeNewShowsPod]);

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
      setPodTasksError("");
      try {
        const response = await fetch("/api/dashboard/pod-tasks", { cache: "no-store" });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load POD tasks.");
        }

        if (!cancelled) {
          setPodTasksData(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setPodTasksError(error.message || "Unable to load POD tasks.");
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
                  <>
                    <label className="toggle-label" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                      <input
                        type="checkbox"
                        checked={includeNewShowsPod}
                        onChange={(e) => setIncludeNewShowsPod(e.target.checked)}
                      />
                      Include new shows POD
                    </label>
                    <div className="week-toggle-group">
                      {OVERVIEW_PERIOD_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={overviewPeriod === option.id ? "is-active" : ""}
                          onClick={() => setOverviewPeriod(option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </>
                }
              >
                <OverviewContent
                  period={overviewPeriod}
                  overviewDataByPeriod={effectiveOverviewDataByPeriod}
                  overviewLoadingByPeriod={effectiveOverviewLoadingByPeriod}
                  overviewErrorByPeriod={effectiveOverviewErrorByPeriod}
                  productionDataByPeriod={productionDataByPeriod}
                  productionLoadingByPeriod={productionLoadingByPeriod}
                  productionErrorByPeriod={productionErrorByPeriod}
                  writerTrackerData={writerTrackerData}
                  writerTrackerLoading={writerTrackerLoading}
                  writerTrackerError={writerTrackerError}
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
                actions={
                  <div className="week-toggle-group">
                    <button
                      type="button"
                      className={podWiseView === "performance" ? "is-active" : ""}
                      onClick={() => setPodWiseView("performance")}
                    >
                      Performance
                    </button>
                    <button
                      type="button"
                      className={podWiseView === "tasks" ? "is-active" : ""}
                      onClick={() => setPodWiseView("tasks")}
                    >
                      Tasks
                    </button>
                  </div>
                }
              >
                <PodWiseContent
                  view={podWiseView}
                  competitionPodRows={competitionData?.podRows}
                  competitionLoading={competitionLoading}
                  podTasksData={podTasksData}
                  podTasksLoading={podTasksLoading}
                  podTasksError={podTasksError}
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
