"use client";

import { useState, useEffect, useMemo } from "react";
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
  const podOptions = Array.isArray(safeBeatsPerformanceData?.filters?.pods) ? safeBeatsPerformanceData.filters.pods : [];
  const beatRows = Array.isArray(safeBeatsPerformanceData?.rows) ? safeBeatsPerformanceData.rows : [];
  const freshTakeRows = Array.isArray(safeBeatsPerformanceData?.freshTakeRows) ? safeBeatsPerformanceData.freshTakeRows : [];
  const workflowTables = safeBeatsPerformanceData?.workflowTables || {};
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
        {beatsPerformanceLoading ? <div className="warning-note">Loading data. Showing placeholder values.</div> : null}
        {beatsPerformanceError ? <div className="warning-note">{beatsPerformanceError}</div> : null}
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
