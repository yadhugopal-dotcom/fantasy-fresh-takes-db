"use client";

import { Fragment, useState, useEffect } from "react";
import {
  EmptyState,
  ShareablePanel,
  formatMetricValue,
  formatDateLabel,
  formatNumber,
  getDeltaMeta,
  normalizePodFilterKey,
  normalizeStageMatchKey,
} from "./shared.jsx";
import { matchAngleName } from "../../lib/fuzzy-match.js";

const LIVE_MIN_FINAL_UPLOAD_DATE = "2026-03-01";

// ─── Private helpers ──────────────────────────────────────────────────────────

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

function isDateWithinRange(value, range) {
  if (!range?.startDate || !range?.endDate) return true;
  const safeDate = String(value || "").slice(0, 10);
  if (!safeDate) return false;
  return safeDate >= range.startDate && safeDate <= range.endDate;
}

function rowHasDateInRange(rowDates, range) {
  if (!range?.startDate || !range?.endDate) return true;
  const dates = Array.isArray(rowDates) ? rowDates : [rowDates];
  return dates.some((date) => isDateWithinRange(date, range));
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

// ─── View ─────────────────────────────────────────────────────────────────────

export default function BeatsPerformanceContent({
  beatsPerformanceData,
  beatsPerformanceLoading,
  beatsPerformanceError,
  onShare,
  copyingSection,
  onNavigate,
  selectedDateRange,
}) {
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
  const [expandedPods, setExpandedPods] = useState([]);
  const [progressView, setProgressView] = useState("pod");
  const [hoveredProgressKey, setHoveredProgressKey] = useState(null);

  const safeBeatsPerformanceData =
    beatsPerformanceData ||
    {
      filters: { pods: [] },
      rows: [],
      freshTakeRows: [],
      workflowTables: {
        editorial: [],
        readyForProduction: [],
        production: [],
        live: [],
      },
    };
  const activeDateRange = selectedDateRange || null;
  const activeDateRangeLabel =
    activeDateRange?.startDate && activeDateRange?.endDate
      ? `${formatDateLabel(activeDateRange.startDate)} - ${formatDateLabel(activeDateRange.endDate)}`
      : "All available data";
  const beatRows = Array.isArray(safeBeatsPerformanceData?.rows) ? safeBeatsPerformanceData.rows : [];
  const freshTakeRows = Array.isArray(safeBeatsPerformanceData?.freshTakeRows) ? safeBeatsPerformanceData.freshTakeRows : [];
  const workflowTables = safeBeatsPerformanceData?.workflowTables || {};
  const editorialWorkflowRows = Array.isArray(workflowTables?.editorial) ? workflowTables.editorial : [];
  const readyForProductionWorkflowRows = Array.isArray(workflowTables?.readyForProduction) ? workflowTables.readyForProduction : [];
  const productionWorkflowRows = Array.isArray(workflowTables?.production) ? workflowTables.production : [];
  const liveWorkflowRows = (Array.isArray(workflowTables?.live) ? workflowTables.live : []).filter((row) => {
    const finalUploadDate = String(row?.finalUploadDate || "").slice(0, 10);
    if (!finalUploadDate || finalUploadDate < LIVE_MIN_FINAL_UPLOAD_DATE) {
      return false;
    }
    return rowHasDateInRange(finalUploadDate, activeDateRange);
  });
  const effectiveWorkflowPod = "all";
  const effectiveWorkflowPodKey = "all";

  useEffect(() => {
    setExpandedPods([]);
  }, [activeDateRange?.startDate, activeDateRange?.endDate]);

  useEffect(() => {
    setWorkflowPages({
      production: 0,
      live: 0,
    });
  }, [workflowSorts]);

  const scopedRows = beatRows.filter((row) =>
    rowHasDateInRange(row?.assignedDate || row?.primaryDate || row?.completedDate || row?.rawBucketLabel, activeDateRange)
  );
  const previousScopedRows = [];
  const isOverallPeriod = true;

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
  const metricCards = [
    { label: "Total Beats", value: formatMetricValue(totalBeats), delta: null },
    { label: "Approved beats", value: formatMetricValue(approvedCount), delta: null },
    { label: "Review pending", value: formatMetricValue(reviewPendingCount), delta: null },
    { label: "Iterate", value: formatMetricValue(iterateCount), delta: null },
    { label: "Abandoned", value: formatMetricValue(abandonedCount), delta: null },
  ];
  const podStatusSummaryRows = activePods
    .map((podLeadName) => {
      const podRows = scopedRows.filter((row) => row.podLeadName === podLeadName);
      const groups = {
        approved: podRows.filter((row) => row.statusCategory === "approved"),
        abandoned: podRows.filter((row) => row.statusCategory === "abandoned"),
        reviewPending: podRows.filter((row) => row.statusCategory === "review_pending"),
        iterate: podRows.filter((row) => row.statusCategory === "iterate"),
        toBeIdeated: podRows.filter((row) => row.statusCategory === "to_be_ideated"),
      };

      return {
        podLeadName,
        approved: groups.approved.length,
        abandoned: groups.abandoned.length,
        reviewPending: groups.reviewPending.length,
        iterate: groups.iterate.length,
        toBeIdeated: groups.toBeIdeated.length,
        total: podRows.length,
        groups,
      };
    })
    .sort((left, right) => right.total - left.total || left.podLeadName.localeCompare(right.podLeadName));

  const workflowTableConfigs = [
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
  const preparedWorkflowTables = workflowTableConfigs.map((config) => {
    const filteredRows = filterWorkflowRows(
      workflowTables?.[config.id],
      effectiveWorkflowPod,
      effectiveWorkflowPodKey
    ).filter((row) => {
      if (config.id === "live") {
        const finalUploadDate = String(row?.finalUploadDate || "").slice(0, 10);
        if (!finalUploadDate || finalUploadDate < LIVE_MIN_FINAL_UPLOAD_DATE) {
          return false;
        }
        return rowHasDateInRange(finalUploadDate, activeDateRange);
      }

      return rowHasDateInRange(row?.filterDates, activeDateRange);
    });
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
  const editorialRows = editorialWorkflowRows.filter((row) => rowHasDateInRange(row?.filterDates, activeDateRange));
  const readyForProductionRows = readyForProductionWorkflowRows.filter((row) => rowHasDateInRange(row?.filterDates, activeDateRange));
  const productionRows = productionWorkflowRows.filter((row) => rowHasDateInRange(row?.filterDates, activeDateRange));
  const progressMatchValue = (row) => String((progressView === "writer" ? row?.writerName : row?.podLeadName) || "").trim();

  const progressRows = Array.from(
    scopedRows.reduce((map, row) => {
      const keySource = progressView === "writer" ? row?.writerName : row?.podLeadName;
      const safeKey = String(keySource || "").trim();
      if (!safeKey) {
        return map;
      }

      if (!map.has(safeKey)) {
        map.set(safeKey, {
          label: safeKey,
          approved: 0,
          editorial: 0,
          readyProduction: 0,
          live: 0,
        });
      }

      const current = map.get(safeKey);
      current.approved += row?.statusCategory === "approved" ? 1 : 0;
      return map;
    }, new Map())
  )
    .map(([label, entry]) => ({ ...entry, label }))
    .map((entry) => {
      const editorialCount = editorialRows.filter((row) => {
        const compareValue = progressView === "writer" ? row?.writerName : row?.podLeadName;
        return String(compareValue || "").trim() === entry.label;
      }).length;

      const readyProductionCount =
        readyForProductionRows.filter((row) => {
          const compareValue = progressView === "writer" ? row?.writerName : row?.podLeadName;
          return String(compareValue || "").trim() === entry.label;
        }).length +
        productionRows.filter((row) => {
          const compareValue = progressView === "writer" ? row?.writerName : row?.podLeadName;
          return String(compareValue || "").trim() === entry.label;
        }).length;

      const liveCount = liveWorkflowRows.filter((row) => {
        const compareValue = progressView === "writer" ? row?.writerName : row?.podLeadName;
        return String(compareValue || "").trim() === entry.label;
      }).length;

      return {
        ...entry,
        editorial: editorialCount,
        readyProduction: readyProductionCount,
        live: liveCount,
        details: [
          ...scopedRows
            .filter((row) => progressMatchValue(row) === entry.label && row?.statusCategory === "approved")
            .map((row) => ({
              id: `ideation-${row.id}`,
              beatName: row?.beatName || row?.beatCode || "-",
              stageLabel: "Approved in Ideation",
              etaLabel: "-",
              tone: "approved",
            })),
          ...editorialRows
            .filter((row) => progressMatchValue(row) === entry.label)
            .map((row) => ({
              id: `editorial-${row.id}`,
              beatName: row?.beatName || row?.scriptCode || "-",
              stageLabel: String(row?.status || "").trim(),
              etaLabel: row?.etaPromoCompletion || row?.etaToStartProd || "-",
              tone: "editorial",
            })),
          ...readyForProductionRows
            .filter((row) => progressMatchValue(row) === entry.label)
            .map((row) => ({
              id: `ready-${row.id}`,
              beatName: row?.beatName || row?.scriptCode || "-",
              stageLabel: String(row?.status || "").trim(),
              etaLabel: row?.etaPromoCompletion || row?.etaToStartProd || "-",
              tone: "ready-production",
            })),
          ...productionRows
            .filter((row) => progressMatchValue(row) === entry.label)
            .map((row) => ({
              id: `production-${row.id}`,
              beatName: row?.beatName || row?.scriptCode || "-",
              stageLabel: String(row?.status || "").trim(),
              etaLabel: row?.etaPromoCompletion || row?.etaToStartProd || "-",
              tone: "ready-production",
            })),
          ...liveWorkflowRows
            .filter((row) => progressMatchValue(row) === entry.label)
            .map((row) => ({
              id: `live-${row.id}`,
              beatName: row?.beatName || row?.scriptCode || "-",
              stageLabel: String(row?.status || "").trim(),
              etaLabel: row?.etaPromoCompletion || row?.finalUploadDate || "-",
              tone: "live",
            })),
        ],
        total: entry.approved + editorialCount + readyProductionCount + liveCount,
      };
    })
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));

  return (
    <div className="beats-performance-shell">
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-start" }}>
        <button
          type="button"
          onClick={() => onNavigate?.("leadership-overview")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            border: "1px solid rgba(28, 25, 23, 0.12)",
            background: "rgba(255,255,255,0.86)",
            color: "#1f1b16",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 10px 26px rgba(57, 47, 31, 0.08)",
          }}
        >
          <span aria-hidden="true">←</span>
          Back to Overview
        </button>
      </div>
      <div style={{ marginBottom: 14, fontSize: 13, fontWeight: 700, color: "var(--subtle)" }}>
        Showing {activeDateRangeLabel}
      </div>
      <ShareablePanel shareLabel="Beats Performance" onShare={onShare} isSharing={copyingSection === "Beats Performance"}>
      <div className="section-stack">
        {beatsPerformanceLoading ? <div className="warning-note">Refreshing data from Sheets…</div> : null}
        {beatsPerformanceError ? <div className="warning-note">{beatsPerformanceError}</div> : null}
        {!beatsPerformanceLoading && !beatsPerformanceError && Array.isArray(safeBeatsPerformanceData?.warnings) && safeBeatsPerformanceData.warnings.length > 0
          ? safeBeatsPerformanceData.warnings.map((w) => <div key={w} className="warning-note">{w}</div>)
          : null}

        <div className="pod-summary-grid beats-summary-grid">
          {metricCards.map((card) => (
            <div key={card.label} className="metric-card beats-metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }} />

        <div className="pod-section-header">
          <span className="pod-section-title">POD Status</span>
          <span className="pod-section-subtitle">Expand a POD to see Writer name - Beat name by status</span>
        </div>

        <div className="table-wrap">
          <table className="ops-table beats-pod-table">
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
                podStatusSummaryRows.map((row) => {
                  const isExpanded = expandedPods.includes(row.podLeadName);
                  const detailGroups = [
                    ["approved", "Approved", row.groups.approved],
                    ["abandoned", "Abandoned", row.groups.abandoned],
                    ["reviewPending", "Review pending", row.groups.reviewPending],
                    ["iterate", "Iterate", row.groups.iterate],
                    ["toBeIdeated", "To be ideated", row.groups.toBeIdeated],
                  ];

                  return (
                    <Fragment key={row.podLeadName}>
                      <tr className={isExpanded ? "is-open" : undefined}>
                        <td>
                          <button
                            type="button"
                            className="pod-expand-button"
                            onClick={() =>
                              setExpandedPods((current) =>
                                current.includes(row.podLeadName)
                                  ? current.filter((pod) => pod !== row.podLeadName)
                                  : [...current, row.podLeadName]
                              )
                            }
                          >
                            <span>{row.podLeadName || "-"}</span>
                            <span className="pod-expand-chevron" aria-hidden="true">
                              {isExpanded ? "▾" : "▸"}
                            </span>
                          </button>
                        </td>
                        <td>{formatMetricValue(row.approved)}</td>
                        <td>{formatMetricValue(row.abandoned)}</td>
                        <td>{formatMetricValue(row.reviewPending)}</td>
                        <td>{formatMetricValue(row.iterate)}</td>
                        <td>{formatMetricValue(row.toBeIdeated)}</td>
                        <td>{formatMetricValue(row.total)}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="beats-pod-detail-row">
                          <td colSpan="7">
                            <div className="beats-pod-detail-panel">
                              <div className="beats-pod-detail-grid">
                                {detailGroups.map(([statusKey, statusLabel, statusRows]) => (
                                  <div key={`${row.podLeadName}-${statusKey}`} className="beats-pod-detail-column">
                                    <div className="beats-pod-detail-label">{statusLabel}</div>
                                    <div className="beats-pod-detail-list">
                                      {statusRows.length > 0 ? (
                                        statusRows.map((detailRow) => (
                                          <div key={detailRow.id} className="beats-pod-detail-item">
                                            <span className="beats-pod-detail-writer">{detailRow.writerName || "Beats owner"}</span>
                                            <span className="beats-pod-detail-separator">-</span>
                                            <span className="beats-pod-detail-beat">{detailRow.beatName || detailRow.beatCode || "Beat"}</span>
                                          </div>
                                        ))
                                      ) : (
                                        <div className="beats-pod-detail-empty">No rows</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
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

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }} />

        <div className="pod-section-header">
          <div style={{ display: "grid", gap: 4 }}>
            <span className="pod-section-title">Progress by Stage</span>
            <span className="pod-section-subtitle">
              Compare approved Ideation beats against Editorial, Ready + Production, and Live counts
            </span>
          </div>
          <div className="beats-progress-toggle" role="tablist" aria-label="Progress grouping">
            <button
              type="button"
              className={progressView === "pod" ? "beats-progress-toggle-button is-active" : "beats-progress-toggle-button"}
              onClick={() => setProgressView("pod")}
            >
              POD
            </button>
            <button
              type="button"
              className={progressView === "writer" ? "beats-progress-toggle-button is-active" : "beats-progress-toggle-button"}
              onClick={() => setProgressView("writer")}
            >
              Writer
            </button>
          </div>
        </div>

        <div className="beats-progress-card">
        {progressRows.length > 0 ? (
            <div className="beats-progress-list">
              {progressRows.map((row) => {
                const safeTotal = Math.max(row.total, 1);
                const isHovered = hoveredProgressKey === `${progressView}-${row.label}`;
                const segments = [
                  { key: "approved", label: "Approved", value: row.approved, className: "is-approved" },
                  { key: "editorial", label: "Editorial", value: row.editorial, className: "is-editorial" },
                  {
                    key: "ready-production",
                    label: "Ready + Production",
                    value: row.readyProduction,
                    className: "is-ready-production",
                  },
                  { key: "live", label: "Live", value: row.live, className: "is-live" },
                ];

                return (
                  <div
                    key={`${progressView}-${row.label}`}
                    className="beats-progress-entry"
                    onMouseEnter={() => setHoveredProgressKey(`${progressView}-${row.label}`)}
                    onMouseLeave={() => setHoveredProgressKey((current) => (current === `${progressView}-${row.label}` ? null : current))}
                  >
                    <div className="beats-progress-row">
                      <div className="beats-progress-name">{row.label}</div>
                      <div className="beats-progress-bar-wrap">
                        <div className="beats-progress-bar">
                          {segments.map((segment) => {
                            if (segment.value <= 0) {
                              return null;
                            }

                            const width = `${(segment.value / safeTotal) * 100}%`;
                            return (
                              <div
                                key={`${row.label}-${segment.key}`}
                                className={`beats-progress-segment ${segment.className}`}
                                style={{ width }}
                                title={`${segment.label}: ${segment.value}`}
                              >
                                <span>{segment.value}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="beats-progress-legend">
                          <span className="beats-progress-legend-item">
                            <span className="beats-progress-dot is-approved" />
                            Approved {row.approved}
                          </span>
                          <span className="beats-progress-legend-item">
                            <span className="beats-progress-dot is-editorial" />
                            Editorial {row.editorial}
                          </span>
                          <span className="beats-progress-legend-item">
                            <span className="beats-progress-dot is-ready-production" />
                            Ready + Production {row.readyProduction}
                          </span>
                          <span className="beats-progress-legend-item">
                            <span className="beats-progress-dot is-live" />
                            Live {row.live}
                          </span>
                        </div>
                      </div>
                      <div className="beats-progress-total">{row.total}</div>
                    </div>
                    {isHovered ? (
                      <div className="beats-progress-hover-card">
                        <div className="beats-progress-hover-head">
                          <span>{row.label}</span>
                          <span>{row.details.length} items</span>
                        </div>
                        <div className="beats-progress-hover-table">
                          <div className="beats-progress-hover-header">Angle name</div>
                          <div className="beats-progress-hover-header">Stage where it is</div>
                          <div className="beats-progress-hover-header">ETA for promo completion</div>
                          {row.details.length > 0 ? (
                            row.details.map((detail) => (
                              <Fragment key={detail.id}>
                                <div className={`beats-progress-hover-cell is-${detail.tone || "approved"}`}>{detail.beatName}</div>
                                <div className={`beats-progress-hover-cell is-${detail.tone || "approved"}`}>{detail.stageLabel || ""}</div>
                                <div className={`beats-progress-hover-cell is-${detail.tone || "approved"}`}>{detail.etaLabel}</div>
                              </Fragment>
                            ))
                          ) : (
                            <div className="beats-progress-hover-empty" style={{ gridColumn: "1 / -1" }}>
                              No detail rows available.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="beats-progress-empty">No progress rows match the selected date range.</div>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }} />

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
    </div>
  );
}
