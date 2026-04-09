"use client";
import { useState } from "react";

import {
  MetricCard,
  ProgressBar,
  ReadinessRow,
  ShareablePanel,
  formatMetricValue,
  formatNumber,
  formatPercent,
  getTargetCardTone,
  getTatCardTone,
  getWritingDaysTone,
  getClReviewDaysTone,
} from "./shared.jsx";

// ─── Private helpers ──────────────────────────────────────────────────────────

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
  if (overviewData?.analyticsSourceError) {
    notes.push(`Analytics source warning: ${overviewData.analyticsSourceError}`);
  }
  if (overviewData?.ideationSourceError) {
    notes.push(`Ideation source warning: ${overviewData.ideationSourceError}`);
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

function DeltaBadge({ current, previous, loading, label = "vs prev week" }) {
  if (loading || previous == null || current == null) return null;
  const delta = Number(current) - Number(previous);
  if (delta === 0) {
    return <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: 4 }}>= same as {label}</div>;
  }
  const color = delta > 0 ? "#2d5a3d" : "#9f2e2e";
  const sign = delta > 0 ? "+" : "";
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color, marginTop: 4 }}>
      {sign}{delta} vs {label}
    </div>
  );
}

function StagePill({ count, label, color, bg }) {
  if (!count) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 600, borderRadius: 5,
      padding: "2px 7px", background: bg, color, marginRight: 5,
    }}>
      {count} <span style={{ fontWeight: 400, opacity: 0.8 }}>{label}</span>
    </span>
  );
}

function PodEditorialStatusTable({ rows = [], loading = false }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>POD production status</div>
      <div style={{ fontSize: 11, color: "var(--subtle)", marginBottom: 10 }}>
        LW production · FT · GA/GI · approved beats only &nbsp;·&nbsp; This week stage from planner
      </div>
      <div className="table-wrap">
        <table className="ops-table overview-table">
          <thead>
            <tr>
              <th>POD</th>
              <th style={{ textAlign: "center" }}>LW Prod</th>
              <th>This week stage breakdown</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="3" style={{ color: "var(--subtle)" }}>Loading…</td></tr>
            ) : safeRows.length === 0 ? (
              <tr><td colSpan="3" style={{ color: "var(--subtle)" }}>No data yet for this period.</td></tr>
            ) : safeRows.map((pod) => (
              <tr key={pod.podLeadName}>
                <td style={{ fontWeight: 600 }}>{pod.podLeadName}</td>
                <td style={{ textAlign: "center", fontWeight: 700, color: "#2d5a3d", fontSize: 15 }}>
                  {pod.lwProductionCount || 0}
                </td>
                <td>
                  <StagePill count={pod.onTrackCount} label="On Track" color="#2d5a3d" bg="#e8f4ea" />
                  <StagePill count={pod.reviewWithClCount} label="Review w/ CL" color="#7c6bbf" bg="#f0edfb" />
                  <StagePill count={pod.wipCount} label="WIP" color="#9f6b15" bg="#fdf5e4" />
                  {!pod.onTrackCount && !pod.reviewWithClCount && !pod.wipCount && (
                    <span style={{ color: "var(--subtle)", fontSize: 11 }}>No beats assigned</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScriptTypeBadges({ ftCount = 0, rwLargeCount = 0, rwSmallCount = 0, rwOtherCount = 0, compact = false }) {
  const rwTotal = rwLargeCount + rwSmallCount + rwOtherCount;
  const parts = [];
  if (ftCount > 0) {
    parts.push(
      <span key="ft" style={{
        display: "inline-block", fontSize: compact ? 10 : 11, fontWeight: 600,
        background: "#e8f4ea", color: "#2d5a3d", borderRadius: 4,
        padding: compact ? "1px 5px" : "2px 6px", marginRight: 4,
      }}>FT:{ftCount}</span>
    );
  }
  if (rwLargeCount > 0) {
    parts.push(
      <span key="rwl" style={{
        display: "inline-block", fontSize: compact ? 10 : 11, fontWeight: 600,
        background: "#fdf0e6", color: "#c2601e", borderRadius: 4,
        padding: compact ? "1px 5px" : "2px 6px", marginRight: 4,
      }}>RW-L:{rwLargeCount}</span>
    );
  }
  if (rwSmallCount > 0) {
    parts.push(
      <span key="rws" style={{
        display: "inline-block", fontSize: compact ? 10 : 11, fontWeight: 600,
        background: "#edf2fb", color: "#3b5bdb", borderRadius: 4,
        padding: compact ? "1px 5px" : "2px 6px", marginRight: 4,
      }}>RW-S:{rwSmallCount}</span>
    );
  }
  if (rwOtherCount > 0) {
    parts.push(
      <span key="rwo" style={{
        display: "inline-block", fontSize: compact ? 10 : 11, fontWeight: 600,
        background: "#f3f0fb", color: "#6741d9", borderRadius: 4,
        padding: compact ? "1px 5px" : "2px 6px", marginRight: 4,
      }}>RW:{rwOtherCount}</span>
    );
  }
  if (parts.length === 0 && rwTotal === 0 && ftCount === 0) return null;
  return <span>{parts}</span>;
}

function PodThroughputRankingTable({ rows = [], loading = false }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const [expandedPods, setExpandedPods] = useState(new Set());

  const togglePod = (podName) => {
    setExpandedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podName)) next.delete(podName);
      else next.add(podName);
      return next;
    });
  };

  const tableRows = [];
  for (const pod of safeRows) {
    const beats = Array.isArray(pod.beats) ? pod.beats : [];
    const isExpanded = expandedPods.has(pod.podLeadName);

    tableRows.push(
      <tr
        key={`pod-${pod.podLeadName}`}
        className="throughput-pod-summary-row"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => togglePod(pod.podLeadName)}
      >
        <td style={{ fontWeight: 700 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 10, width: 16, height: 16, display: "inline-flex",
              alignItems: "center", justifyContent: "center",
              background: "var(--subtle-bg, #f0ece4)", borderRadius: 3,
              color: "var(--subtle)", flexShrink: 0,
            }}>
              {isExpanded ? "▾" : "▸"}
            </span>
            {pod.podLeadName}
          </span>
        </td>
        <td style={{ fontWeight: 700, textAlign: "center" }}>{formatNumber(pod.totalScripts)}</td>
        <td>
          <ScriptTypeBadges
            compact
            ftCount={pod.ftCount || 0}
            rwLargeCount={0}
            rwSmallCount={0}
            rwOtherCount={pod.rwCount || 0}
          />
        </td>
        <td style={{ color: "var(--subtle)", fontSize: 11 }}>
          {beats.length} beat{beats.length !== 1 ? "s" : ""}
        </td>
      </tr>
    );

    if (isExpanded) {
      for (let bi = 0; bi < beats.length; bi++) {
        const beat = beats[bi];
        tableRows.push(
          <tr key={`beat-${pod.podLeadName}-${bi}-${beat.beatName}`} className="throughput-beat-row">
            <td style={{ paddingLeft: 28, color: "var(--subtle)", fontSize: 12 }}>
              {beat.showName ? `${beat.showName} — ` : ""}{beat.beatName}
            </td>
            <td style={{ textAlign: "center", color: "var(--subtle)", fontSize: 12 }}>
              {formatNumber(beat.scriptCount)}
            </td>
            <td>
              <ScriptTypeBadges
                compact
                ftCount={beat.ftCount || 0}
                rwLargeCount={beat.rwLargeCount || 0}
                rwSmallCount={beat.rwSmallCount || 0}
                rwOtherCount={beat.rwOtherCount || 0}
              />
            </td>
            <td style={{ fontSize: 12 }}>
              {beat.inIdeation ? (
                <span style={{ color: "#2d5a3d", fontWeight: 600 }}>Approved</span>
              ) : (
                <span style={{ color: "#9f2e2e", fontWeight: 600 }}>Not Approved</span>
              )}
            </td>
          </tr>
        );
      }
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>POD throughput ranking</div>
      <div style={{ fontSize: 11, color: "var(--subtle)", marginBottom: 10 }}>
        GA/GI assets · date-filtered · FT = Fresh Take · RW = Rework (L=large, S=small) · beat checked against Ideation tab
      </div>
      <div className="table-wrap">
        <table className="ops-table overview-table">
          <thead>
            <tr>
              <th>POD / Beat</th>
              <th style={{ textAlign: "center" }}># Scripts</th>
              <th>Type</th>
              <th>Beats Approved</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" style={{ color: "var(--subtle)" }}>Loading…</td></tr>
            ) : tableRows.length > 0 ? (
              tableRows
            ) : (
              <tr><td colSpan="4">No GA/GI scripts found for the selected date range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

export function OverviewCurrentWeek({ overviewData, overviewLoading, overviewError, middleSlot }) {
  const unavailableMetricValue = overviewError ? "-" : null;
  const tatSummary = overviewData?.tatSummary || {};
  const tatDays = tatSummary?.averageTatDays;

  const beatsCount = overviewData?.plannerBeatCount ?? 0;
  const beatsTarget = 25;
  const productionCount = overviewData?.inProductionBeatCount ?? 0;
  const productionTarget = 22;

  return (
    <div className="section-stack">
      <hr className="section-divider" />
      <div className="metric-grid three-col">
        <MetricCard
          label="Unique beats this week"
          className="hero-card"
          tone={getPipelineCardTone(beatsCount, beatsTarget)}
          body={
            <>
              <div className="metric-value">
                {overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(beatsCount)}
              </div>
              <div className="metric-hint">{`Target: ${beatsTarget}+`}</div>
              <DeltaBadge
                current={beatsCount}
                previous={overviewData?.prevFreshTakeCount}
                loading={overviewLoading}
                label="LW releases"
              />
            </>
          }
        />
        <MetricCard
          label="Moving to production"
          className="hero-card"
          tone={getPipelineCardTone(productionCount, productionTarget)}
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(productionCount)}
          hint={`Target: ${productionTarget}`}
        />
        <MetricCard
          label="Fresh Take in Production"
          className="hero-card"
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(overviewData?.freshTakeInProductionCount ?? 0)}
          hint="FT scripts in Production tab this week"
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
      {middleSlot}
    </div>
  );
}

export function OverviewLastWeek({ overviewData, overviewLoading, overviewError, middleSlot }) {
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
          tone={getTargetCardTone(overviewData?.freshTakeCount, overviewData?.targetFloor)}
          body={
            <>
              <div className="metric-value">
                {overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(overviewData?.freshTakeCount)}
              </div>
              <div className="metric-hint">Unique attempts from Live tab</div>
              <DeltaBadge
                current={overviewData?.freshTakeCount}
                previous={overviewData?.prevFreshTakeCount}
                loading={overviewLoading}
                label="prev week"
              />
            </>
          }
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
        <MetricCard
          label="Fresh Take in Production"
          className="hero-card"
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(overviewData?.freshTakeInProductionCount ?? 0)}
          hint="FT scripts in Production tab last week"
        />
      </div>

      {middleSlot}

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

export function OverviewNextWeek({ overviewData, overviewLoading, overviewError, middleSlot }) {
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

  const liveOnMetaCount = Number(overviewData?.plannedReleaseCount || 0);
  const inProductionCount = Number(overviewData?.inProductionBeatCount || 0);
  const uniqueShowCount = Number(overviewData?.uniqueShowCount || 0);

  return (
    <div className="section-stack">
      <div className="metric-grid three-col">
        <MetricCard
          label="Beats locked GTG"
          className="hero-card"
          tone="positive"
          body={
            <>
              <div className="metric-value">
                {overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(beatsCount)}
              </div>
              <div className="metric-hint">Confirmed and ready to go</div>
              <DeltaBadge
                current={beatsCount}
                previous={overviewData?.prevFreshTakeCount}
                loading={overviewLoading}
                label="LW releases"
              />
            </>
          }
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
          label="Fresh Take in Production"
          className="hero-card"
          value={overviewLoading ? "..." : unavailableMetricValue || formatMetricValue(overviewData?.freshTakeInProductionCount ?? 0)}
          hint="FT scripts in Production tab next week"
        />
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

      {middleSlot}

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

// ─── Main View ────────────────────────────────────────────────────────────────

export default function OverviewContent({
  overviewData,
  overviewLoading,
  overviewError,
  onShare,
  copyingSection,
  includeNewShowsPod,
  onIncludeNewShowsPodChange,
}) {
  const notes = buildOverviewNotes({ overviewError, overviewData });
  const weekLabel = overviewData?.weekLabel || "";
  const selectionMode = String(overviewData?.selectionMode || "");
  const podThroughputRows = Array.isArray(overviewData?.podThroughputRows) ? overviewData.podThroughputRows : [];
  const editorialPodRows = Array.isArray(overviewData?.editorialPodRows) ? overviewData.editorialPodRows : [];

  return (
    <ShareablePanel
      shareLabel={`Editorial Funnel ${weekLabel || "selected range"}`}
      onShare={onShare}
      isSharing={copyingSection === `Editorial Funnel ${weekLabel || "selected range"}`}
      topControls={
        <label className="overview-inline-check">
          <input
            type="checkbox"
            checked={Boolean(includeNewShowsPod)}
            onChange={(event) => onIncludeNewShowsPodChange?.(event.target.checked)}
          />
          <span>Include new shows POD (Dan Woodward)</span>
        </label>
      }
    >
      <div className="section-stack">
        {notes.map((note) => (
          <div key={note} className="warning-note">{note}</div>
        ))}

        {(() => {
          const throughputTable = <PodThroughputRankingTable rows={podThroughputRows} loading={overviewLoading} />;
          if (selectionMode === "editorial_funnel") {
            const middleSlot = (
              <>
                <PodEditorialStatusTable rows={editorialPodRows} loading={overviewLoading} />
                {throughputTable}
              </>
            );
            return <OverviewCurrentWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} middleSlot={middleSlot} />;
          }
          if (selectionMode === "planned") {
            return <OverviewNextWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} middleSlot={throughputTable} />;
          }
          return <OverviewLastWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} middleSlot={throughputTable} />;
        })()}
      </div>
    </ShareablePanel>
  );
}
