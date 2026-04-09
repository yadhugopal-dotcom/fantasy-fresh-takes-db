"use client";
import { useState } from "react";

import {
  AcdCollapsibleTable,
  MetricCard,
  ProgressBar,
  ReadinessRow,
  ShareablePanel,
  formatMetricValue,
  formatNumber,
  formatPercent,
  formatDateLabel,
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

function EditorialPodThroughputTable({ rows = [] }) {
  const [expandedPods, setExpandedPods] = useState({});
  const allExpanded = rows.length > 0 && rows.every((row) => Boolean(expandedPods[row.podLeadName]));

  return (
    <div>
      <div className="overview-section-actions" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          type="button"
          className="ghost-button overview-section-link"
          onClick={() =>
            setExpandedPods(
              allExpanded ? {} : Object.fromEntries(rows.map((row) => [row.podLeadName, true]))
            )
          }
        >
          {allExpanded ? "Collapse all pods" : "Expand all pods"}
        </button>
      </div>
      <div className="table-wrap">
        <table className="ops-table overview-table">
          <thead>
            <tr>
              <th>POD / Writer</th>
              <th>LW to Production (GA/GI, approved)</th>
              <th>This week beats</th>
              <th>WIP</th>
              <th>Review with CL</th>
              <th>On track for next week</th>
              <th>NW readiness stage</th>
              <th>Thu status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.flatMap((row) => {
                const isExpanded = Boolean(expandedPods[row.podLeadName]);
                const podRow = (
                  <tr key={`pod-${row.podLeadName}`} style={{ fontWeight: 700 }}>
                    <td>
                      <button
                        type="button"
                        className="as-link"
                        onClick={() =>
                          setExpandedPods((current) => ({
                            ...current,
                            [row.podLeadName]: !current[row.podLeadName],
                          }))
                        }
                        style={{ padding: 0, border: "none", background: "transparent", fontWeight: 700 }}
                      >
                        {isExpanded ? "▾" : "▸"} {row.podLeadName || "-"}
                      </button>
                    </td>
                    <td>{formatMetricValue(row.lwProductionCount)}</td>
                    <td>{formatMetricValue(row.thisWeekBeatsCount)}</td>
                    <td>{formatMetricValue(row.wipCount)}</td>
                    <td>{formatMetricValue(row.reviewWithClCount)}</td>
                    <td>{formatMetricValue(row.onTrackCount)}</td>
                    <td>{row.readinessStage || "-"}</td>
                    <td>{row.thuStatusMessage || "-"}</td>
                  </tr>
                );

                const writerRows = isExpanded
                  ? (Array.isArray(row.writerRows) ? row.writerRows : []).map((writer) => (
                      <tr key={`writer-${row.podLeadName}-${writer.writerName}`}>
                        <td style={{ paddingLeft: 34, color: "var(--subtle)" }}>• {writer.writerName || "-"}</td>
                        <td>{formatMetricValue(writer.lwProductionCount)}</td>
                        <td>{formatMetricValue(writer.thisWeekBeatsCount)}</td>
                        <td>{formatMetricValue(writer.wipCount)}</td>
                        <td>{formatMetricValue(writer.reviewWithClCount)}</td>
                        <td>{formatMetricValue(writer.onTrackCount)}</td>
                        <td>{writer.readinessStage || "-"}</td>
                        <td>-</td>
                      </tr>
                    ))
                  : [];

                return [podRow, ...writerRows];
              })
            ) : (
              <tr>
                <td colSpan="8">No POD throughput rows available yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

export function OverviewCurrentWeek({ overviewData, overviewLoading, overviewError }) {
  const unavailableMetricValue = overviewError ? "-" : null;
  const tatSummary = overviewData?.tatSummary || {};
  const tatDays = tatSummary?.averageTatDays;
  const [podSectionOpen, setPodSectionOpen] = useState(true);

  const beatsCount = overviewData?.plannerBeatCount ?? 0;
  const beatsTarget = 25;
  const productionCount = overviewData?.inProductionBeatCount ?? 0;
  const productionTarget = 22;

  return (
    <div className="section-stack">
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: podSectionOpen ? 8 : 0 }}>
          <button
            type="button"
            className="as-link"
            onClick={() => setPodSectionOpen((v) => !v)}
            style={{ padding: 0, border: "none", background: "transparent", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}
          >
            {podSectionOpen ? "▾" : "▸"} POD throughput ranking
          </button>
        </div>
        {podSectionOpen && (
          <>
            <div style={{ fontSize: 11, color: "var(--subtle)", marginBottom: 10 }}>
              Ranked by last week scripts pushed to production (Fresh Takes + GA/GI + approved beats), with writer drilldown.
            </div>
            <EditorialPodThroughputTable rows={Array.isArray(overviewData?.podThroughputRows) ? overviewData.podThroughputRows : []} />
          </>
        )}
      </div>
      <hr className="section-divider" />
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

export function OverviewLastWeek({ overviewData, overviewLoading, overviewError }) {
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

export function OverviewNextWeek({ overviewData, overviewLoading, overviewError }) {
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


// ─── Main View ────────────────────────────────────────────────────────────────

export default function OverviewContent({
  overviewData,
  overviewLoading,
  overviewError,
  acdMetricsData,
  acdMetricsLoading,
  onShare,
  copyingSection,
  includeNewShowsPod,
  onIncludeNewShowsPodChange,
}) {
  const notes = buildOverviewNotes({ overviewError, overviewData });
  const sectionTitle = "Editorial funnel";
  const contextLine = "What shipped and how it performed across the selected date range.";
  const weekLabel = overviewData?.weekLabel || "";
  const selectionMode = String(overviewData?.selectionMode || "");

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

        <div style={{ fontSize: 14, fontWeight: 500 }}>{sectionTitle}</div>
        {weekLabel && <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: -10 }}>{weekLabel}</div>}
        <div style={{ fontSize: 13, color: "var(--subtle)", fontStyle: "italic", marginTop: -8 }}>{contextLine}</div>

        {selectionMode === "editorial_funnel" && (
          <OverviewCurrentWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} />
        )}
        {selectionMode !== "editorial_funnel" && selectionMode !== "planned" && (
          <OverviewLastWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} />
        )}
        {selectionMode === "planned" && (
          <OverviewNextWeek overviewData={overviewData} overviewLoading={overviewLoading} overviewError={overviewError} />
        )}

        <hr className="section-divider" />
        <AcdCollapsibleTable
          acdMetricsData={acdMetricsData}
          acdMetricsLoading={acdMetricsLoading}
        />
      </div>
    </ShareablePanel>
  );
}
