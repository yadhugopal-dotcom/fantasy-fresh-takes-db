"use client";

import { useState, useMemo } from "react";
import {
  EmptyState,
  ShareablePanel,
  ANALYTICS_LEGEND_FALLBACK,
  formatMetricValue,
  formatNumber,
  formatAnalyticsMetricValue,
  getAnalyticsLegendToneClass,
  getAnalyticsNextStepToneClass,
} from "./shared.jsx";

// ─── Private helpers ──────────────────────────────────────────────────────────
const ANALYTICS_METRIC_COLUMNS_FALLBACK = [
  { key: "cpi", label: "CPI", format: "currency", hiddenByDefault: false },
  { key: "cti", label: "CTI", format: "percent", hiddenByDefault: false },
  { key: "absoluteCompletion", label: "Absolute completion", format: "percent", hiddenByDefault: false },
];

const ANALYTICS_LOADING_ROWS = Array.from({ length: 5 }, (_, index) => ({
  showName: "-",
  beatName: "-",
  assetCode: `loading-${index + 1}`,
  rowIndex: index + 1,
  nextStep: "-",
  rowTone: "neutral",
  actioned: false,
  metrics: {
    cpi: { value: 0, meetsBenchmark: null },
    cti: { value: 0, meetsBenchmark: null },
    absoluteCompletion: { value: 0, meetsBenchmark: null },
  },
}));

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

// ─── View ─────────────────────────────────────────────────────────────────────

export default function AnalyticsContent({
  analyticsData,
  analyticsLoading,
  analyticsError,
  onShare,
  copyingSection,
  onToggleActioned,
  actionedBusyKey,
}) {
  const isLoadingPlaceholder = analyticsLoading && !analyticsData;
  const safeAnalyticsData =
    analyticsData ||
    {
      selectedWeekLabel: "Loading",
      selectedWeekRangeLabel: "",
      selectedWeekKey: "",
      rowCount: 0,
      legend: ANALYTICS_LEGEND_FALLBACK,
      metricColumns: ANALYTICS_METRIC_COLUMNS_FALLBACK,
      rows: ANALYTICS_LOADING_ROWS,
    };
  const [showCompletionBreakdown, setShowCompletionBreakdown] = useState(false);
  const [hideActioned, setHideActioned] = useState(true);
  const [showPromising, setShowPromising] = useState(false);
  const rows = Array.isArray(safeAnalyticsData?.rows) ? safeAnalyticsData.rows : [];
  const legendItems =
    Array.isArray(safeAnalyticsData?.legend) && safeAnalyticsData.legend.length > 0
      ? safeAnalyticsData.legend
      : ANALYTICS_LEGEND_FALLBACK;
  const metricColumns = Array.isArray(safeAnalyticsData?.metricColumns) ? safeAnalyticsData.metricColumns : [];
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
    ...safeAnalyticsData,
    rowCount: visibleRows.length,
  });

  return (
    <ShareablePanel
      shareLabel={`Analytics ${safeAnalyticsData?.selectedWeekRangeLabel || "selected range"}`}
      onShare={onShare}
      isSharing={copyingSection === `Analytics ${safeAnalyticsData?.selectedWeekRangeLabel || "selected range"}`}
      className="analytics-panel"
    >
      <div className="panel-head">
        <div>
          <div className="panel-title">Weekly script test results</div>
          <div className="panel-statline">{analyticsSubtitle}</div>
        </div>
      </div>
      <div className="analytics-kpi-row">
        <div className="analytics-kpi-chip">
          <span>Visible</span>
          <strong>{formatNumber(visibleRows.length)}</strong>
        </div>
        <div className="analytics-kpi-chip">
          <span>Actioned</span>
          <strong>{formatNumber(actionedCount)}</strong>
        </div>
        <div className="analytics-kpi-chip">
          <span>Date range</span>
          <strong>{safeAnalyticsData?.selectedWeekRangeLabel || "-"}</strong>
        </div>
      </div>

      <div className="section-stack">
        {isLoadingPlaceholder ? <div className="warning-note">Loading data. Showing placeholder values.</div> : null}
        {analyticsError ? <div className="warning-note">{analyticsError}</div> : null}
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
                        const rowActionedKey = `${safeAnalyticsData?.selectedWeekKey || ""}:${row.assetCode || ""}`;
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
                            All rows in this range are marked actioned. Use "Show actioned items" to review them.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState text={analyticsData?.emptyStateMessage || "No analytics rows are available for this range yet."} />
            )}
          </>
      </div>
    </ShareablePanel>
  );
}
