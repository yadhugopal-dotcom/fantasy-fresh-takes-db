"use client";

import { useState } from "react";
import {
  MetricCard,
  EmptyState,
  formatMetricValue,
  formatPercent,
  normalizePodFilterKey,
  CHART_TONE_POSITIVE,
} from "./shared.jsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function LeadershipOverviewContent({ leadershipOverviewData, leadershipOverviewLoading, leadershipOverviewError, onNavigate }) {
  const overviewData = leadershipOverviewData || null;
  const overviewLoading = Boolean(leadershipOverviewLoading);
  const overviewError = leadershipOverviewError || "";
  const [outputMode, setOutputMode] = useState("pod");
  const beatRows = Array.isArray(overviewData?.beatRows) ? overviewData.beatRows : [];
  const workflowRows = Array.isArray(overviewData?.workflowRows) ? overviewData.workflowRows : [];
  const approvedMatchedRows = Array.isArray(overviewData?.approvedMatchedRows) ? overviewData.approvedMatchedRows : [];
  const fullGenAiRows = Array.isArray(overviewData?.fullGenAiRows) ? overviewData.fullGenAiRows : [];
  const currentWeekUpdateRows = Array.isArray(overviewData?.currentWeekUpdateRows) ? overviewData.currentWeekUpdateRows : [];
  const scopedBeatRows = beatRows;
  const previousBeatRows = [];
  const scopedWorkflowRows = workflowRows;
  const scopedApprovedMatchedRows = approvedMatchedRows;
  const scopedFullGenAiRows = fullGenAiRows;
  const selectedRangeLabel = overviewData?.selectedWeekRangeLabel || "";

  const countByStatus = (rows, statusCategory) => rows.filter((row) => row.statusCategory === statusCategory).length;
  const approvedBeats = countByStatus(scopedBeatRows, "approved");
  const reviewPendingBeats = countByStatus(scopedBeatRows, "review_pending");
  const iterateBeats = countByStatus(scopedBeatRows, "iterate");
  const abandonedBeats = countByStatus(scopedBeatRows, "abandoned");

  const deltaMetaFor = (currentValue, previousValue) => {
    return { text: "Selected date range", color: "var(--subtle)" };
  };

  const approvedBeatsDelta = deltaMetaFor(approvedBeats, countByStatus(previousBeatRows, "approved"));
  const reviewPendingDelta = deltaMetaFor(reviewPendingBeats, countByStatus(previousBeatRows, "review_pending"));
  const iterateDelta = deltaMetaFor(iterateBeats, countByStatus(previousBeatRows, "iterate"));
  const abandonedDelta = deltaMetaFor(abandonedBeats, countByStatus(previousBeatRows, "abandoned"));

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
    <div className="section-stack overview-flow-shell">
      {overviewError ? <div className="warning-note">{overviewError}</div> : null}

      <div className="overview-hero">
        <div className="overview-hero-copy">
          <div className="overview-hero-kicker">PRD-aligned leadership view</div>
          <div className="overview-hero-title">One place to track beats, output, production movement, and Gen AI readiness.</div>
          <div className="overview-hero-subtitle">
            The flow follows the PRD directly: beats first, then POD and writer output, then production throughput, Full Gen AI, and a mid-week progress view.
          </div>
        </div>
        <div className="overview-hero-actions">
          <div className="overview-range-pill">{selectedRangeLabel || "Select a date range"}</div>
          {overviewData?.confidenceNote ? <div className="overview-confidence-note">{overviewData.confidenceNote}</div> : null}
        </div>
      </div>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-kicker">Section 1</div>
            <div className="overview-section-title">Beats</div>
          </div>
          <div className="overview-section-note">Readiness view: focus on approval and blockers for the selected range.</div>
        </div>
        <div className="metric-grid four-col">
          {renderLinkMetricCard({ label: "Approved Beats", value: overviewLoading ? "..." : formatMetricValue(approvedBeats), delta: approvedBeatsDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Review Pending", value: overviewLoading ? "..." : formatMetricValue(reviewPendingBeats), delta: reviewPendingDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Iterate", value: overviewLoading ? "..." : formatMetricValue(iterateBeats), delta: iterateDelta, onClick: () => onNavigate?.("beats-performance") })}
          {renderLinkMetricCard({ label: "Abandoned", value: overviewLoading ? "..." : formatMetricValue(abandonedBeats), delta: abandonedDelta, onClick: () => onNavigate?.("beats-performance") })}
        </div>
      </section>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-kicker">Section 2</div>
            <div className="overview-section-title">Writer and POD output</div>
          </div>
          <div className="overview-section-actions">
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
        <div className="table-wrap">
          <table className="ops-table overview-table">
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
      </section>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-kicker">Section 3</div>
            <div className="overview-section-title">Production throughput</div>
          </div>
          <button type="button" className="ghost-button overview-section-link" onClick={() => onNavigate?.("production")}>
            Open Production
          </button>
        </div>
        <div className="panel-card overview-panel-card">
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="panel-title">ACD productivity</div>
              <div className="panel-statline">A compact date-range view of production and live movement, shaped for the PRD's POD x ACD lens.</div>
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
      </section>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-kicker">Section 4</div>
            <div className="overview-section-title">Full Gen AI</div>
          </div>
          <div className="overview-section-note">Which beats moved forward, how many attempts happened, and what actually worked.</div>
        </div>
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
        <div className="table-wrap">
          <table className="ops-table overview-table">
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
      </section>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-kicker">Section 5</div>
            <div className="overview-section-title">Current week update</div>
          </div>
          <div className="overview-section-note">A shareable mid-week progress snapshot for POD leads and leadership.</div>
        </div>
        <div className="table-wrap">
          <table className="ops-table overview-table">
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
      </section>
    </div>
  );
}
