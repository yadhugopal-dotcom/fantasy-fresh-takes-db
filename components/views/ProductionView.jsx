"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EmptyState,
  ShareablePanel,
  ToggleGroup,
  ACD_TIME_OPTIONS,
  ACD_VIEW_OPTIONS,
  formatNumber,
  formatDateLabel,
  formatDateTimeLabel,
  getChartBarColor,
  getAcdViewLabel,
  getAcdLeaderboardDataset,
} from "./shared.jsx";

// ─── Private helpers ──────────────────────────────────────────────────────────

const EMPTY_ACD_MESSAGE = "No valid ACD output data available yet from Live tab sync.";
const ASSET_TYPE_OPTIONS = ["GA", "GI", "GU"];

function detectAssetType(assetCode) {
  const normalized = String(assetCode || "").trim().toUpperCase();
  if (normalized.startsWith("GA")) return "GA";
  if (normalized.startsWith("GI")) return "GI";
  if (normalized.startsWith("GU")) return "GU";
  return "OTHER";
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

// ─── Production Pipeline table ────────────────────────────────────────────────

function ProductionPipelineTable({ rows = [], loading = false }) {
  const [expandedPods, setExpandedPods] = useState(new Set());
  const safeRows = Array.isArray(rows) ? rows : [];

  const togglePod = (podName) => {
    setExpandedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podName)) next.delete(podName);
      else next.add(podName);
      return next;
    });
  };

  const totalScripts = safeRows.reduce((s, r) => s + (r.total || 0), 0);

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, color: "var(--subtle)", marginBottom: 10 }}>
        Current scripts in the Production tracker · {totalScripts} total · FT = Fresh Take · RW = Rework
      </div>
      <div className="table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>POD / Script</th>
              <th style={{ textAlign: "center" }}>Total</th>
              <th>Type breakdown</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" style={{ color: "var(--subtle)" }}>Loading…</td></tr>
            ) : safeRows.length === 0 ? (
              <tr><td colSpan="4" style={{ color: "var(--subtle)" }}>No scripts currently in Production tracker.</td></tr>
            ) : safeRows.flatMap((pod) => {
              const isExpanded = expandedPods.has(pod.podLeadName);
              const scripts = Array.isArray(pod.scripts) ? pod.scripts : [];
              const rows = [
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
                  <td style={{ fontWeight: 700, textAlign: "center" }}>{pod.total}</td>
                  <td>
                    {pod.ft > 0 && (
                      <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, background: "#e8f4ea", color: "#2d5a3d", borderRadius: 4, padding: "1px 6px", marginRight: 4 }}>
                        FT:{pod.ft}
                      </span>
                    )}
                    {pod.rw > 0 && (
                      <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, background: "#fdf0e6", color: "#c2601e", borderRadius: 4, padding: "1px 6px", marginRight: 4 }}>
                        RW:{pod.rw}
                      </span>
                    )}
                    {pod.unknown > 0 && (
                      <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, background: "#f0ece4", color: "#666", borderRadius: 4, padding: "1px 6px" }}>
                        ?:{pod.unknown}
                      </span>
                    )}
                  </td>
                  <td style={{ color: "var(--subtle)", fontSize: 11 }}>
                    {scripts.length} script{scripts.length !== 1 ? "s" : ""}
                  </td>
                </tr>,
              ];

              if (isExpanded) {
                for (const script of scripts) {
                  rows.push(
                    <tr key={`${pod.podLeadName}-${script.assetCode || script.beatName}`} className="throughput-beat-row">
                      <td style={{ paddingLeft: 28, fontSize: 12 }}>
                        <span style={{ color: "var(--subtle)" }}>{script.showName ? `${script.showName} — ` : ""}</span>
                        {script.beatName || "—"}
                        {script.writerName ? <span style={{ color: "var(--subtle)", marginLeft: 6 }}>· {script.writerName}</span> : null}
                      </td>
                      <td style={{ textAlign: "center", color: "var(--subtle)", fontSize: 12 }}>
                        {script.assetCode || "—"}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {script.reworkType ? (
                          <span style={{
                            background: classifyFtRw(script.reworkType) === "ft" ? "#e8f4ea" : "#fdf0e6",
                            color: classifyFtRw(script.reworkType) === "ft" ? "#2d5a3d" : "#c2601e",
                            borderRadius: 4, padding: "1px 6px", fontWeight: 600,
                          }}>
                            {script.reworkType}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--subtle)" }}>
                        {script.status || "—"}
                        {script.etaToStartProd ? <span style={{ marginLeft: 6 }}>· ETA {script.etaToStartProd}</span> : null}
                      </td>
                    </tr>
                  );
                }
              }

              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function classifyFtRw(reworkType) {
  const rt = String(reworkType || "").trim().toLowerCase();
  if (!rt) return null;
  if (rt === "fresh take" || rt === "fresh takes" || rt.startsWith("new q1") || rt.startsWith("ft")) return "ft";
  return "rw";
}

// ─── View ─────────────────────────────────────────────────────────────────────

function PipelineStageCard({ label, total, ft, rw, loading, accentColor, bgColor }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1, minWidth: 140,
        background: "var(--panel)",
        border: `1.5px solid ${accentColor}33`,
        borderRadius: 12,
        padding: "18px 20px",
        textAlign: "center",
        cursor: "default",
        transform: hovered ? "scale(1.045) translateY(-2px)" : "scale(1) translateY(0)",
        boxShadow: hovered ? `0 8px 24px ${accentColor}22` : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "transform 180ms ease, box-shadow 180ms ease",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: accentColor, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 800, color: accentColor, lineHeight: 1 }}>
        {loading ? "—" : (total ?? 0)}
      </div>
      {!loading && (ft > 0 || rw > 0) && (
        <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: 6, display: "flex", justifyContent: "center", gap: 8 }}>
          <span style={{ background: "#e8f4ea", color: "#2d5a3d", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>FT:{ft}</span>
          <span style={{ background: "#fdf0e6", color: "#c2601e", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>RW:{rw}</span>
        </div>
      )}
    </div>
  );
}

export default function ProductionContent({
  acdMetricsData,
  acdMetricsLoading,
  acdMetricsError,
  productionPipelineData,
  productionPipelineLoading,
  acdTimeView,
  onTimeViewChange,
  acdViewType,
  onViewTypeChange,
  onRunSync,
  busyAction,
  onShare,
  copyingSection,
}) {
  const [selectedAssetTypes, setSelectedAssetTypes] = useState(ASSET_TYPE_OPTIONS);
  const [productionSubView, setProductionSubView] = useState("pipeline");
  const safeAcdMetricsData =
    acdMetricsData ||
    {
      syncStatus: {},
      latestWorkDate: "",
      failureReasonRows: [],
      emptyStateMessage: EMPTY_ACD_MESSAGE,
      acdDailyRows: [],
      acdWeeklyRows: [],
      acdCdRows: [],
      acdCdWeeklyRows: [],
    };

  const syncStatus = safeAcdMetricsData.syncStatus || {};
  const dataset = getAcdLeaderboardDataset(safeAcdMetricsData, acdTimeView, acdViewType);
  const viewLabel = getAcdViewLabel(dataset.viewType);
  const notes = [syncStatus.syncError, syncStatus.sourceFilterWarning].filter(Boolean);
  const latestWorkDateLabel = safeAcdMetricsData.latestWorkDate ? formatDateLabel(safeAcdMetricsData.latestWorkDate) : "";
  const adherenceIssueRows = Array.isArray(syncStatus.adherenceIssueRows) ? syncStatus.adherenceIssueRows : [];
  const failureReasonRows = Array.isArray(safeAcdMetricsData.failureReasonRows) ? safeAcdMetricsData.failureReasonRows : [];
  const totalFailedSheets = Number(syncStatus.totalFailedSheets || 0);
  const totalCdsAffected = Array.isArray(syncStatus.adherenceRows) ? syncStatus.adherenceRows.length : 0;
  const filteredAdherenceIssueRows = useMemo(() => {
    const selected = new Set(selectedAssetTypes);
    return adherenceIssueRows
      .map((row) => {
        const filteredAssets = (Array.isArray(row.assets) ? row.assets : []).filter((asset) =>
          selected.has(detectAssetType(asset?.assetCode))
        );
        return {
          ...row,
          assets: filteredAssets,
          totalAssetsNotAdhering: filteredAssets.length,
        };
      })
      .filter((row) => Number(row.totalAssetsNotAdhering || 0) > 0);
  }, [adherenceIssueRows, selectedAssetTypes]);
  const filteredTotalAssets = filteredAdherenceIssueRows.reduce(
    (sum, row) => sum + Number(row.totalAssetsNotAdhering || 0),
    0
  );
  const filteredCdsAffected = new Set(filteredAdherenceIssueRows.map((row) => row.cdName || "")).size;
  const pipelineRows = Array.isArray(productionPipelineData?.pipelineRows) ? productionPipelineData.pipelineRows : [];
  const pipelineSummary = productionPipelineData?.pipelineSummary || null;
  const podBreakdownRows = Array.isArray(productionPipelineData?.podBreakdownRows) ? productionPipelineData.podBreakdownRows : [];

  return (
    <div className="section-stack">
      {acdMetricsLoading ? <div className="warning-note">Loading data. Showing placeholder values.</div> : null}
      {acdMetricsError ? <div className="warning-note">{acdMetricsError}</div> : null}
      {notes.map((note) => (
        <div key={note} className="warning-note">
          {note}
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }} data-share-ignore="true">
        <div style={{
          display: "inline-flex", borderRadius: 999, padding: 4,
          background: "var(--bg-deep)", border: "1px solid var(--border)",
        }}>
          {[["pipeline", "Production Pipeline"], ["throughput", "Production Throughput"]].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProductionSubView(id)}
              style={{
                padding: "8px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                borderRadius: 999, border: "none",
                background: productionSubView === id ? "var(--panel)" : "transparent",
                color: productionSubView === id ? "var(--ink)" : "var(--subtle)",
                boxShadow: productionSubView === id ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
                transition: "all 150ms ease",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {productionSubView === "pipeline" && (
        <ShareablePanel shareLabel="Production Pipeline" onShare={onShare} isSharing={copyingSection === "Production Pipeline"}>
          <div style={{ background: "#2d5a3d", padding: "18px 24px", borderRadius: "10px 10px 0 0", marginBottom: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
              Production Pipeline Dashboard
            </div>
          </div>

          <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--subtle)", marginBottom: 14 }}>
              Pipeline Overview
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <PipelineStageCard
                label="Editorial"
                total={pipelineSummary?.editorial.total}
                ft={pipelineSummary?.editorial.ft}
                rw={pipelineSummary?.editorial.rw}
                loading={productionPipelineLoading}
                accentColor="#3b6bdb"
              />
              <PipelineStageCard
                label="Ready for Prod"
                total={pipelineSummary?.readyForProd.total}
                ft={pipelineSummary?.readyForProd.ft}
                rw={pipelineSummary?.readyForProd.rw}
                loading={productionPipelineLoading}
                accentColor="#6741d9"
              />
              <PipelineStageCard
                label="In Production"
                total={pipelineSummary?.inProduction.total}
                ft={pipelineSummary?.inProduction.ft}
                rw={pipelineSummary?.inProduction.rw}
                loading={productionPipelineLoading}
                accentColor="#c2601e"
              />
              <PipelineStageCard
                label="Live"
                total={pipelineSummary?.live}
                ft={0}
                rw={0}
                loading={productionPipelineLoading}
                accentColor="#2d5a3d"
              />
            </div>
          </div>

          {(productionPipelineLoading || podBreakdownRows.length > 0) && (
            <div style={{ padding: "20px 24px 8px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--subtle)", marginBottom: 12 }}>
                Breakdown by POD
              </div>
              <div className="table-wrap">
                <table className="ops-table overview-table">
                  <thead>
                    <tr>
                      <th>POD</th>
                      <th style={{ textAlign: "center" }}>Editorial</th>
                      <th style={{ textAlign: "center" }}>Ready for Prod</th>
                      <th style={{ textAlign: "center" }}>Production</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionPipelineLoading ? (
                      <tr><td colSpan="4" style={{ color: "var(--subtle)" }}>Loading…</td></tr>
                    ) : podBreakdownRows.map((pod) => (
                      <tr key={pod.podLeadName}>
                        <td style={{ fontWeight: 700 }}>{pod.podLeadName}</td>
                        {[pod.editorial, pod.readyForProd, pod.production].map((stage, i) => (
                          stage.total === 0
                            ? <td key={i} style={{ textAlign: "center", color: "var(--subtle)" }}>—</td>
                            : <td key={i} style={{ textAlign: "center" }}>
                                <span style={{ fontWeight: 700 }}>{stage.total}</span>
                                {" "}
                                {stage.ft > 0 && <span style={{ display: "inline-block", fontSize: 10, fontWeight: 600, background: "#e8f4ea", color: "#2d5a3d", borderRadius: 4, padding: "1px 5px", marginRight: 3 }}>FT:{stage.ft}</span>}
                                {stage.rw > 0 && <span style={{ display: "inline-block", fontSize: 10, fontWeight: 600, background: "#fdf0e6", color: "#c2601e", borderRadius: 4, padding: "1px 5px" }}>RW:{stage.rw}</span>}
                              </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <ProductionPipelineTable rows={pipelineRows} loading={productionPipelineLoading} />
        </ShareablePanel>
      )}

      {productionSubView === "throughput" && (
        <>
        <ShareablePanel
        shareLabel="Production ACD sync"
        onShare={onShare}
        isSharing={copyingSection === "Production ACD sync"}
      >
        <div className="panel-head panel-head-tight">
          <div>
            <div className="panel-title">ACD Daily Sync</div>
            <div className="panel-statline">{buildAcdSyncMeta(syncStatus)}</div>
          </div>
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
            <div className="panel-title">{viewLabel} productivity chart</div>
            <div className="panel-statline">
              <span>{dataset.rows.length > 0 ? dataset.meta : safeAcdMetricsData.emptyStateMessage || EMPTY_ACD_MESSAGE}</span>
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
        <div className="panel-head panel-head-tight">
          <div>
            <div className="panel-title">ACD Sync Rules and Adherence Issues</div>
            <div className="panel-statline">{buildAcdAdherenceMeta(syncStatus)}</div>
          </div>
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
            <span>Filtered non-adhering assets</span>
            <strong>{formatNumber(filteredTotalAssets || totalFailedSheets)}</strong>
          </div>
          <div className="troubleshoot-summary-card">
            <span>Filtered CDs affected</span>
            <strong>{formatNumber(filteredCdsAffected || totalCdsAffected)}</strong>
          </div>
        </div>

        <div className="panel-stack" data-share-ignore="true">
          <div className="panel-title panel-title-xs">Asset Type Filter</div>
          <div className="production-asset-filter-row">
            {ASSET_TYPE_OPTIONS.map((type) => {
              const isActive = selectedAssetTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={isActive ? "toggle-chip is-active" : "toggle-chip"}
                  onClick={() =>
                    setSelectedAssetTypes((current) => {
                      if (current.includes(type)) {
                        const next = current.filter((item) => item !== type);
                        return next.length > 0 ? next : current;
                      }
                      return [...current, type];
                    })
                  }
                >
                  {type}
                </button>
              );
            })}
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
          <AcdAdherenceTable rows={filteredAdherenceIssueRows} />
        </div>
      </ShareablePanel>
        </>
      )}
    </div>
  );
}
