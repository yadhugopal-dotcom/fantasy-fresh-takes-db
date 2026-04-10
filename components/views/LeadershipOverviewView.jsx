"use client";

import { useMemo, useState } from "react";
import {
  AcdCollapsibleTable,
  MetricCard,
  formatNumber,
  formatMetricValue,
  formatPercent,
  normalizePodFilterKey,
} from "./shared.jsx";
import { getWeekSelection } from "../../lib/week-view.js";

const FOCUS_POD_LEADS = [
  { key: "berman", label: "Berman" },
  { key: "roth", label: "Roth" },
  { key: "lee", label: "Lee" },
  { key: "gilatar", label: "Gilatar" },
  { key: "woodward", label: "Woodward" },
];
const SECTION3_ASSET_TYPE_OPTIONS = ["GA", "GI"];
const SECTION3_ASSET_TYPE_LABELS = {
  GA: "Q1 manual + thumbnail",
  GI: "Auto AI",
};
const SECTION3_MINUTES_PER_ASSET = 2.5;
const SECTION3_ALLOWED_NAMES = new Set([
  "Pauras Hinge",
  "Ankit D Bagde",
  "Vivek Anand",
  "Swagat Karmakar",
  "Manthan M Kanani",
  "Hitesh Gawankar",
  "Priyesh Kava",
  "Sakshi Nandwani",
  "Daanish Narayan",
  "Tanya Singh",
  "Ankur Saraf",
  "Umesh Bahuguna",
  "Varun Thomas",
]);

function detectAssetTypeFromCode(assetCode) {
  const normalized = String(assetCode || "").trim().toUpperCase();
  if (normalized.startsWith("GA")) return "GA";
  if (normalized.startsWith("GI")) return "GI";
  if (normalized.startsWith("GU")) return "GU";
  return "OTHER";
}

function countWeekdaysInRange(startDate, endDate) {
  const start = String(startDate || "");
  const end = String(endDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return 5;
  }
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return 5;
  }
  let count = 0;
  for (const day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return Math.max(1, count);
}

function resolveFocusPodLabel(podLeadName) {
  const normalized = normalizePodFilterKey(podLeadName || "");
  for (const pod of FOCUS_POD_LEADS) {
    if (normalized.includes(pod.key)) {
      return pod.label;
    }
  }
  return "";
}

function sanitizeAllowedOwnerName(value) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  if (cleaned.includes(",") || cleaned.includes("&")) return "";
  return SECTION3_ALLOWED_NAMES.has(cleaned) ? cleaned : "";
}

export default function LeadershipOverviewContent({ leadershipOverviewData, leadershipOverviewLoading, leadershipOverviewError, onNavigate, acdMetricsData, acdMetricsLoading }) {
  const overviewData = leadershipOverviewData || null;
  const overviewLoading = Boolean(leadershipOverviewLoading);
  const overviewError = leadershipOverviewError || "";
  const [expandedPods, setExpandedPods] = useState({});
  const [expandedCds, setExpandedCds] = useState({});
  const [section2Mode, setSection2Mode] = useState("custom");
  const [section3AssetTypes, setSection3AssetTypes] = useState(SECTION3_ASSET_TYPE_OPTIONS);
  const [expandedAngles, setExpandedAngles] = useState({});
  const beatRows = Array.isArray(overviewData?.beatRows) ? overviewData.beatRows : [];
  const allBeatRows = Array.isArray(overviewData?.allBeatRows) ? overviewData.allBeatRows : beatRows;
  const workflowRows = Array.isArray(overviewData?.workflowRows) ? overviewData.workflowRows : [];
  const allWorkflowRows = Array.isArray(overviewData?.allWorkflowRows) ? overviewData.allWorkflowRows : workflowRows;
  const fullGenAiRows = Array.isArray(overviewData?.fullGenAiRows) ? overviewData.fullGenAiRows : [];
  const scopedBeatRows = beatRows;
  const scopedWorkflowRows = workflowRows;
  const scopedFullGenAiRows = fullGenAiRows;
  const selectedRangeLabel = overviewData?.selectedWeekRangeLabel || "";
  const lastWeekSelection = getWeekSelection("last");
  const currentWeekSelection = getWeekSelection("current");
  const inRange = (dateValue, range) => {
    const date = String(dateValue || "").trim();
    return Boolean(date) && date >= range.weekStart && date <= range.weekEnd;
  };
  const section2BeatRows =
    section2Mode === "last"
      ? allBeatRows.filter((row) => inRange(row.primaryDate, lastWeekSelection))
      : section2Mode === "current"
        ? allBeatRows.filter((row) => inRange(row.primaryDate, currentWeekSelection))
        : scopedBeatRows;
  const section2WorkflowRows =
    section2Mode === "last"
      ? allWorkflowRows.filter((row) => inRange(row.stageDate, lastWeekSelection))
      : section2Mode === "current"
        ? allWorkflowRows.filter((row) => inRange(row.stageDate, currentWeekSelection))
        : scopedWorkflowRows;
  const section2Columns =
    section2Mode === "last"
      ? [
          { key: "readyForProductionCount", label: "Ready for Production" },
          { key: "productionCount", label: "Production" },
          { key: "liveCount", label: "Live" },
        ]
      : section2Mode === "current"
        ? [
            { key: "ideationCount", label: "Beats", podOnly: true },
            { key: "editorialCount", label: "Editorial" },
            { key: "readyForProductionCount", label: "Ready for Production" },
            { key: "productionCount", label: "Production" },
          ]
        : [
            { key: "ideationCount", label: "Ideation", podOnly: true },
            { key: "editorialCount", label: "Editorial" },
            { key: "readyForProductionCount", label: "Ready for Production" },
            { key: "productionCount", label: "Production" },
            { key: "liveCount", label: "Live" },
          ];

  const countByStatus = (rows, statusCategory) => rows.filter((row) => row.statusCategory === statusCategory).length;
  const approvedBeats = countByStatus(scopedBeatRows, "approved");
  const reviewPendingBeats = countByStatus(scopedBeatRows, "review_pending");
  const iterateBeats = countByStatus(scopedBeatRows, "iterate");
  const abandonedBeats = countByStatus(scopedBeatRows, "abandoned");

  const buildMetricsRow = (podLeadName, writerName = "") => ({
    podLeadName,
    writerName,
    ideationCount: 0,
    deliveredCount: 0,
    editorialCount: 0,
    readyForProductionCount: 0,
    productionCount: 0,
    liveCount: 0,
  });

  const outputData = useMemo(() => {
    const podMap = new Map(FOCUS_POD_LEADS.map((pod) => [pod.label, buildMetricsRow(pod.label)]));
    const writerMap = new Map();

    const getPodRow = (podLeadName) => {
      const canonicalPod = resolveFocusPodLabel(podLeadName);
      if (!canonicalPod) return null;
      if (!podMap.has(canonicalPod)) {
        podMap.set(canonicalPod, buildMetricsRow(canonicalPod));
      }
      return podMap.get(canonicalPod);
    };

    const getWriterRow = (podLeadName, writerName) => {
      const canonicalPod = resolveFocusPodLabel(podLeadName);
      const safeWriter = String(writerName || "").trim() || "Unassigned";
      if (!canonicalPod) return null;
      const key = `${canonicalPod}::${safeWriter}`;
      if (!writerMap.has(key)) {
        writerMap.set(key, buildMetricsRow(canonicalPod, safeWriter));
      }
      return writerMap.get(key);
    };

    for (const row of section2BeatRows) {
      const podEntry = getPodRow(row.podLeadName);
      if (podEntry) podEntry.ideationCount += 1;
    }

    for (const row of section2WorkflowRows) {
      const podEntry = getPodRow(row.podLeadName);
      const writerEntry = getWriterRow(row.podLeadName, row.writerName);

      const applySourceCount = (entry) => {
        if (!entry) return;
        if (row.source === "editorial") entry.editorialCount += 1;
        if (row.source === "ready_for_production") entry.readyForProductionCount += 1;
        if (row.source === "production") entry.productionCount += 1;
        if (row.source === "live") entry.liveCount += 1;
      };

      applySourceCount(podEntry);
      applySourceCount(writerEntry);
    }

    const sortByReadiness = (a, b) => {
      const readinessA = Number(a.readyForProductionCount || 0) + Number(a.productionCount || 0);
      const readinessB = Number(b.readyForProductionCount || 0) + Number(b.productionCount || 0);
      if (readinessA !== readinessB) return readinessB - readinessA;
      const totalA =
        a.ideationCount + a.editorialCount + a.readyForProductionCount + a.productionCount + a.liveCount + a.deliveredCount;
      const totalB =
        b.ideationCount + b.editorialCount + b.readyForProductionCount + b.productionCount + b.liveCount + b.deliveredCount;
      if (totalA !== totalB) return totalB - totalA;
      return String(a.writerName || a.podLeadName).localeCompare(String(b.writerName || b.podLeadName));
    };

    const podRows = Array.from(podMap.values()).sort(sortByReadiness);
    const writerRowsByPod = Object.fromEntries(
      podRows.map((podRow) => {
        const rows = Array.from(writerMap.values())
          .filter((writerRow) => writerRow.podLeadName === podRow.podLeadName)
          .sort(sortByReadiness);
        return [podRow.podLeadName, rows];
      })
    );

    return { podRows, writerRowsByPod };
  }, [section2BeatRows, section2WorkflowRows]);
  const allPodsExpanded =
    outputData.podRows.length > 0 &&
    outputData.podRows.every((row) => Boolean(expandedPods[row.podLeadName]));
  const weekdayCount = useMemo(
    () => countWeekdaysInRange(overviewData?.weekStart, overviewData?.weekEnd),
    [overviewData?.weekStart, overviewData?.weekEnd]
  );

  const throughputByCd = useMemo(() => {
    const cdMap = new Map();
    const selectedTypes = new Set(section3AssetTypes);
    const throughputRows = scopedWorkflowRows.filter((row) => {
      if (!(row.source === "production" || row.source === "live")) return false;
      const assetType = detectAssetTypeFromCode(row?.assetCode || row?.scriptCode);
      return selectedTypes.has(assetType);
    });

    const ensureCdEntry = (cdName) => {
      const key = normalizePodFilterKey(cdName || "Unassigned");
      if (!cdMap.has(key)) {
        cdMap.set(key, {
          cdName: cdName || "Unassigned",
          productionAssets: new Set(),
          liveAssets: new Set(),
          acdMap: new Map(),
        });
      }
      return cdMap.get(key);
    };

    const ensureAcdEntry = (cdEntry, acdName) => {
      const acdKey = normalizePodFilterKey(acdName || "Unassigned");
      if (!cdEntry.acdMap.has(acdKey)) {
        cdEntry.acdMap.set(acdKey, {
          acdName: acdName || "Unassigned",
          productionAssets: new Set(),
          liveAssets: new Set(),
        });
      }
      return cdEntry.acdMap.get(acdKey);
    };

    for (const row of throughputRows) {
      const cdName = sanitizeAllowedOwnerName(row?.cdName || row?.cd);
      const acdNamesRaw = Array.isArray(row?.acdNames) && row.acdNames.length > 0 ? row.acdNames : [];
      const acdNames = acdNamesRaw.map(sanitizeAllowedOwnerName).filter(Boolean);
      const assetCode = String(row?.assetCode || row?.scriptCode || `${row?.showName}-${row?.beatName}`).trim();
      if (!assetCode || !cdName || acdNames.length === 0) continue;

      const cdEntry = ensureCdEntry(cdName);
      if (row.source === "production") cdEntry.productionAssets.add(assetCode);
      if (row.source === "live") cdEntry.liveAssets.add(assetCode);

      for (const acdName of acdNames) {
        const acdEntry = ensureAcdEntry(cdEntry, acdName);
        if (row.source === "production") acdEntry.productionAssets.add(assetCode);
        if (row.source === "live") acdEntry.liveAssets.add(assetCode);
      }
    }

    return Array.from(cdMap.values())
      .map((cdEntry) => {
        const acdRows = Array.from(cdEntry.acdMap.values())
          .map((acdEntry) => {
            const productionCount = acdEntry.productionAssets.size;
            const liveCount = acdEntry.liveAssets.size;
            const productionMinutes = Number((productionCount * SECTION3_MINUTES_PER_ASSET).toFixed(1));
            const liveMinutes = Number((liveCount * SECTION3_MINUTES_PER_ASSET).toFixed(1));
            const totalMinutes = Number((productionMinutes + liveMinutes).toFixed(1));
            return {
              acdName: acdEntry.acdName,
              productionMinutes,
              liveMinutes,
              totalMinutes,
              minutesPerDay: Number((totalMinutes / Math.max(1, weekdayCount)).toFixed(1)),
            };
          })
          .sort((a, b) => b.totalMinutes - a.totalMinutes || a.acdName.localeCompare(b.acdName));

        const productionCount = cdEntry.productionAssets.size;
        const liveCount = cdEntry.liveAssets.size;
        const productionMinutes = Number((productionCount * SECTION3_MINUTES_PER_ASSET).toFixed(1));
        const liveMinutes = Number((liveCount * SECTION3_MINUTES_PER_ASSET).toFixed(1));
        const totalMinutes = Number((productionMinutes + liveMinutes).toFixed(1));
        return {
          cdName: cdEntry.cdName,
          productionMinutes,
          liveMinutes,
          totalMinutes,
          minutesPerDay: Number((totalMinutes / Math.max(1, weekdayCount)).toFixed(1)),
          acdRows,
        };
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes || a.cdName.localeCompare(b.cdName));
  }, [scopedWorkflowRows, section3AssetTypes, weekdayCount]);
  const allCdsExpanded =
    throughputByCd.length > 0 &&
    throughputByCd.every((row) => Boolean(expandedCds[row.cdName]));

  const fullGenAiByBeat = useMemo(() =>
    Array.from(
      scopedFullGenAiRows.reduce((map, row) => {
      const key = `${row.showName}|${row.beatName}`;
      if (!map.has(key)) {
        map.set(key, {
          showName: row.showName,
          beatName: row.beatName,
          attempts: 0,
          successCount: 0,
          ads: [],
        });
      }
      const entry = map.get(key);
      entry.attempts += 1;
      if (row.success) entry.successCount += 1;
      entry.ads.push({
        assetCode: row.assetCode,
        success: row.success,
        cpiUsd: row.cpiUsd,
        absoluteCompletionPct: row.absoluteCompletionPct,
        ctrPct: row.ctrPct,
        clickToInstall: row.clickToInstall,
      });
      return map;
      }, new Map()).values()
    )
      .map((entry) => ({
        ...entry,
        hitRate: entry.attempts > 0 ? Number(((entry.successCount / entry.attempts) * 100).toFixed(1)) : null,
      }))
      .sort((a, b) => b.attempts - a.attempts || a.showName.localeCompare(b.showName) || a.beatName.localeCompare(b.beatName))
  , [scopedFullGenAiRows]);
  const successfulAdsCount = scopedFullGenAiRows.filter((r) => r.success).length;

  const beatsMetricCards = [
    { label: "Approved Beats", value: overviewLoading ? "..." : formatMetricValue(approvedBeats) },
    { label: "Review Pending", value: overviewLoading ? "..." : formatMetricValue(reviewPendingBeats) },
    { label: "Iterate", value: overviewLoading ? "..." : formatMetricValue(iterateBeats) },
    { label: "Abandoned", value: overviewLoading ? "..." : formatMetricValue(abandonedBeats) },
  ];

  return (
    <div className="section-stack overview-flow-shell">
      {overviewError ? <div className="warning-note">{overviewError}</div> : null}

      {(selectedRangeLabel || overviewData?.confidenceNote) ? (
        <>
          <div className="overview-hero-actions" style={{ marginTop: 2 }}>
            {selectedRangeLabel ? <div className="overview-range-pill">{selectedRangeLabel}</div> : null}
            {overviewData?.confidenceNote ? <div className="overview-confidence-note">{overviewData.confidenceNote}</div> : null}
          </div>
          <hr className="section-divider" />
        </>
      ) : null}

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-title">Beats</div>
          </div>
          <div className="overview-section-actions">
            <button type="button" className="ghost-button overview-section-link" onClick={() => onNavigate?.("beats-performance")}>
              Open expanded beat view
            </button>
          </div>
        </div>
        <div className="pod-summary-grid">
          {beatsMetricCards.map((card) => (
            <div key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
            </div>
          ))}
        </div>
      </section>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-title">Writer and POD output</div>
          </div>
          <div className="overview-section-actions" style={{ marginLeft: "auto", justifyContent: "flex-end" }}>
            <div className="week-toggle-group">
              {[
                ["custom", "Custom"],
                ["last", "Last week"],
                ["current", "Current week"],
              ].map(([id, label]) => (
                <button key={id} type="button" className={section2Mode === id ? "is-active" : ""} onClick={() => setSection2Mode(id)}>
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost-button overview-section-link"
              onClick={() =>
                setExpandedPods(
                  allPodsExpanded
                    ? {}
                    : Object.fromEntries(outputData.podRows.map((row) => [row.podLeadName, true]))
                )
              }
            >
              {allPodsExpanded ? "Collapse all pods" : "Open POD Wise"}
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="ops-table overview-table overview-output-table">
            <colgroup>
              <col style={{ width: "48%" }} />
              {section2Columns.map((column) => (
                <col key={`col-${column.key}`} style={{ width: `${52 / Math.max(section2Columns.length, 1)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>POD / Writer</th>
                {section2Columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outputData.podRows.length > 0 ? (
                outputData.podRows.flatMap((podRow) => {
                  const isExpanded = Boolean(expandedPods[podRow.podLeadName]);
                  const writerRows = outputData.writerRowsByPod[podRow.podLeadName] || [];
                  const podLabel = podRow.podLeadName || "-";
                  const podTr = (
                    <tr key={`pod-${podRow.podLeadName}`} style={{ fontWeight: 700 }}>
                      <td>
                        <button
                          type="button"
                          className="as-link"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpandedPods((current) => ({
                              ...current,
                              [podRow.podLeadName]: !current[podRow.podLeadName],
                            }))
                          }
                          style={{
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            fontWeight: 700,
                          }}
                        >
                          {podLabel}
                        </button>
                      </td>
                      {section2Columns.map((column) => (
                        <td key={`pod-${podRow.podLeadName}-${column.key}`}>
                          {formatMetricValue(podRow[column.key])}
                        </td>
                      ))}
                    </tr>
                  );

                  const writerTrs = isExpanded
                    ? writerRows.map((writerRow) => (
                        (() => {
                          const visibleWriterKeys = section2Columns
                            .filter((column) => !column.podOnly)
                            .map((column) => column.key);
                          const isWriterZeroAcross =
                            visibleWriterKeys.every((key) => Number(writerRow[key] || 0) === 0);

                          const zeroStyle = isWriterZeroAcross ? { color: "var(--red)", fontWeight: 700 } : undefined;
                          return (
                            <tr key={`writer-${podRow.podLeadName}-${writerRow.writerName}`}>
                              <td style={{ paddingLeft: 34, color: isWriterZeroAcross ? "var(--red)" : "var(--subtle)", fontWeight: isWriterZeroAcross ? 700 : 500 }}>
                                • {writerRow.writerName || "-"}
                              </td>
                              {section2Columns.map((column) => (
                                <td key={`writer-${podRow.podLeadName}-${writerRow.writerName}-${column.key}`} style={zeroStyle}>
                                  {column.podOnly ? "-" : formatMetricValue(writerRow[column.key])}
                                </td>
                              ))}
                            </tr>
                          );
                        })()
                      ))
                    : [];

                  return [podTr, ...writerTrs];
                })
              ) : (
                <tr>
                  <td colSpan={1 + section2Columns.length}>No output rows available for this filter yet.</td>
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
            <div className="overview-section-title">Production throughput</div>
          </div>
          <div className="overview-section-actions" style={{ marginLeft: "auto", justifyContent: "flex-end" }}>
            <label className="toolbar-select" style={{ minWidth: 180 }}>
              <span>Assets</span>
              <select
                multiple
                value={section3AssetTypes}
                onChange={(event) => {
                  const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                  setSection3AssetTypes(values.length > 0 ? values : SECTION3_ASSET_TYPE_OPTIONS);
                }}
              >
                {SECTION3_ASSET_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {SECTION3_ASSET_TYPE_LABELS[type] || type}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "normal", textTransform: "none", fontWeight: 500 }}>
                Hold Shift (or Cmd/Ctrl) to multi-select
              </span>
            </label>
            <button
              type="button"
              className="ghost-button overview-section-link"
              onClick={() =>
                setExpandedCds(
                  allCdsExpanded
                    ? {}
                    : Object.fromEntries(throughputByCd.map((row) => [row.cdName, true]))
                )
              }
            >
              {allCdsExpanded ? "Collapse all pods" : "Open POD Wise"}
            </button>
          </div>
        </div>
        <div className="panel-card overview-panel-card">
          <AcdCollapsibleTable acdMetricsData={acdMetricsData} acdMetricsLoading={acdMetricsLoading} />
        </div>
      </section>

      <hr className="section-divider" />

      <section className="overview-flow-section">
        <div className="overview-section-head">
          <div>
            <div className="overview-section-title">Full Gen AI</div>
            <div className="overview-section-subtitle" style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Q1 Manual + Q1 Auto AI only
            </div>
          </div>
          <div className="overview-section-actions" style={{ marginLeft: "auto", justifyContent: "flex-end" }}>
            <div className="overview-section-note">
              {overviewLoading ? "Rows: ..." : `Rows: ${formatMetricValue(fullGenAiByBeat.length)}`}
            </div>
          </div>
        </div>
        <div className="metric-grid three-col">
          <MetricCard label="Ads passed to Full Gen AI" value={overviewLoading ? "..." : formatMetricValue(scopedFullGenAiRows.length)} />
          <MetricCard
            label="Successful ads (formula)"
            value={overviewLoading ? "..." : formatMetricValue(successfulAdsCount)}
            hint="Ad counts only when all formula thresholds are met"
          />
          <MetricCard
            label="Overall hit rate"
            value={
              overviewLoading
                ? "..."
                : scopedFullGenAiRows.length > 0
                  ? formatPercent((successfulAdsCount / scopedFullGenAiRows.length) * 100)
                  : "-"
            }
          />
        </div>
        {overviewData?.fullGenAiSourceError ? (
          <div className="warning-note" style={{ marginTop: 10 }}>
            Full Gen AI source warning: {overviewData.fullGenAiSourceError}
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="ops-table overview-table">
            <thead>
              <tr>
                <th>Show</th>
                <th>Beat</th>
                <th>Ads</th>
                <th>Successful</th>
                <th>Hit rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fullGenAiByBeat.length > 0 ? (
                fullGenAiByBeat.flatMap((row) => {
                  const angleKey = `${row.showName}|${row.beatName}`;
                  const isExpanded = Boolean(expandedAngles[angleKey]);
                  return [
                    <tr
                      key={angleKey}
                      className={row.successCount > 0 ? "overview-genai-success-row" : ""}
                      style={{ cursor: "pointer" }}
                      onClick={() => setExpandedAngles((prev) => ({ ...prev, [angleKey]: !prev[angleKey] }))}
                    >
                      <td>{row.showName || "-"}</td>
                      <td>{row.beatName || "-"}</td>
                      <td>{formatMetricValue(row.attempts)}</td>
                      <td className={row.successCount > 0 ? "overview-genai-success-value" : ""}>
                        {formatMetricValue(row.successCount)}
                      </td>
                      <td>{row.hitRate != null ? formatPercent(row.hitRate) : "-"}</td>
                      <td style={{ textAlign: "center", color: "var(--muted)", fontSize: 11 }}>{isExpanded ? "▲" : "▼"}</td>
                    </tr>,
                    ...(isExpanded ? [
                      <tr key={`${angleKey}-hdr`} style={{ background: "var(--bg-subtle, #f5f0e8)" }}>
                        <td colSpan={2} style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", paddingLeft: 28 }}>Asset Code</td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>CPI</td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>True Completion</td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>CTR</td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>CTI</td>
                      </tr>,
                      ...row.ads.map((ad) => (
                        <tr
                          key={`${angleKey}-${ad.assetCode}`}
                          style={{ background: "var(--bg-subtle, #f5f0e8)" }}
                          className={ad.success ? "overview-genai-success-row" : ""}
                        >
                          <td colSpan={2} style={{ paddingLeft: 28, fontSize: 12 }}>{ad.assetCode || "-"}</td>
                          <td style={{ fontSize: 12 }}>{ad.cpiUsd != null ? `$${ad.cpiUsd.toFixed(2)}` : "-"}</td>
                          <td style={{ fontSize: 12 }}>{ad.absoluteCompletionPct != null ? formatPercent(ad.absoluteCompletionPct) : "-"}</td>
                          <td style={{ fontSize: 12 }}>{ad.ctrPct != null ? formatPercent(ad.ctrPct) : "-"}</td>
                          <td style={{ fontSize: 12 }}>{ad.clickToInstall != null ? formatPercent(ad.clickToInstall) : "-"}</td>
                        </tr>
                      )),
                    ] : []),
                  ];
                })
              ) : (
                <tr>
                  <td colSpan="6">No Full Gen AI rows for this filter yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overview-guidelines-card">
          <div className="overview-guidelines-title">Success definition and guidelines</div>
          <div className="overview-guidelines-line">
            Shows Q1 Manual + Q1 Auto AI ads that have been passed to Full Gen AI (spend ≥ $100, CPI &lt; $10, ≤ 2 metric misses).
          </div>
          <div className="overview-guidelines-line">
            A successful ad passes all formula thresholds: Amount Spent ≥ 100, Q1 Completion &gt; 10%, CTI ≥ 12%, True Completion ≥ 1.8%, CPI ≤ 12.
          </div>
          <div className="overview-guidelines-line">Hit rate = (successful ads / total ads) × 100. Click any row to see per-ad metrics.</div>
          <div className="overview-guidelines-line">Rows shaded light green have one or more successful ads.</div>
        </div>
      </section>

    </div>
  );
}
