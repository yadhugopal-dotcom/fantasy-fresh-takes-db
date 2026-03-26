"use client";

import { useMemo, useState } from "react";
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
import { POD_LEAD_SCRIPT_CHANGES_INFO_URL } from "../../lib/pod-lead-script-changes-config.js";
import {
  buildFilteredReportView,
  buildShowOptions,
  TOTAL_SHOW_OPTION,
} from "../../lib/pod-lead-script-changes-shared.js";
import styles from "./page.module.css";

const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatMetric(value) {
  return numberFormatter.format(Number(value || 0));
}

function formatPercent(value) {
  return `${percentFormatter.format(Number(value || 0) * 100)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload;
  if (!row) {
    return null;
  }

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{row.podLeadName}</div>
      <div className={styles.tooltipRow}>Median lead changes: {formatMetric(row.medianLeadChanges)}</div>
      <div className={styles.tooltipRow}>Total scripts: {formatMetric(row.totalScripts)}</div>
      <div className={styles.tooltipRow}>Average lead changes: {formatMetric(row.averageLeadChanges)}</div>
      <div className={styles.tooltipRow}>
        Scripts with zero lead changes: {formatMetric(row.zeroChangeScriptCount)} ({formatPercent(row.zeroChangeShare)})
      </div>
      <div className={styles.tooltipRow}>Median total doc changes: {formatMetric(row.medianTotalDocChanges)}</div>
    </div>
  );
}

function BarValueLabel({ x, y, width, value }) {
  if (width < 36 || value === null || value === undefined) {
    return null;
  }

  return (
    <text
      x={Number(x || 0) + Number(width || 0) / 2}
      y={Number(y || 0) - 8}
      textAnchor="middle"
      className={styles.barLabel}
    >
      {formatMetric(value)}
    </text>
  );
}

function DiagnosticsReasonList({ items }) {
  if (!items.length) {
    return <div className={styles.reasonEmpty}>No skipped or ignored rows for this selection.</div>;
  }

  return (
    <div className={styles.reasonList}>
      {items.map((item) => (
        <div key={`${item.reason}-${item.count}`} className={styles.reasonPill}>
          <span>{item.reason}</span>
          <strong>{formatMetric(item.count)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function PodLeadScriptChangesView({ initialReport = null, initialError = "" }) {
  const [selectedShow, setSelectedShow] = useState(TOTAL_SHOW_OPTION);
  const [showTable, setShowTable] = useState(false);
  const report = initialReport && typeof initialReport === "object" ? initialReport : null;
  const showOptions = useMemo(() => buildShowOptions(report), [report]);
  const view = useMemo(() => buildFilteredReportView(report, selectedShow), [report, selectedShow]);
  const chartWidth = Math.max(720, view.aggregateRows.length * 92);

  if (!report) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.hero}>
            <div>
              <div className={styles.kicker}>Pocket FM / POD lead script changes</div>
              <h1>POD Lead Script Changes</h1>
              <p>
                This page computes median lead-made Google Doc revisions per script before the script appears in the
                Live tab.
              </p>
            </div>
            <a className={styles.linkButton} href="/">
              Back to dashboard
            </a>
          </header>

          <section className={styles.card}>
            <div className={styles.errorTitle}>Unable to load data</div>
            <p className={styles.errorText}>{initialError || "The Google-backed report could not be generated."}</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div>
            <div className={styles.kicker}>Pocket FM / POD lead script changes</div>
            <h1>POD Lead Script Changes</h1>
            <p>
              Each bar shows the typical number of post-creation changes made by the POD lead on script docs before
              those scripts land in the Live tab.
            </p>
          </div>

          <div className={styles.heroActions}>
            <a className={styles.linkButton} href={`/api/pod-lead-script-changes/export?show=${encodeURIComponent(view.selectedShow)}`}>
              Export CSV
            </a>
            <a className={styles.linkButton} href="/">
              Back to dashboard
            </a>
          </div>
        </header>

        <section className={styles.card}>
          <div className={styles.topRow}>
            <div>
              <div className={styles.sectionTitle}>Filters</div>
              <div className={styles.sectionMeta}>Last refreshed: {formatDateTime(report.generatedAt)}</div>
            </div>

            <label className={styles.filterField}>
              <span>Show</span>
              <select value={selectedShow} onChange={(event) => setSelectedShow(event.target.value)}>
                {showOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className={styles.infoNote}>
            Google Drive revision history from the API can be incomplete for heavily edited files.{" "}
            <a href={POD_LEAD_SCRIPT_CHANGES_INFO_URL} target="_blank" rel="noreferrer">
              Google Drive revisions.list
            </a>
          </p>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionTitle}>Median lead-made changes by POD lead</div>
          {view.hasData ? (
            <div className={styles.chartScroller}>
              <div className={styles.chartFrame} style={{ width: `${chartWidth}px` }}>
                <ResponsiveContainer width="100%" height={420}>
                  <BarChart data={view.aggregateRows} margin={{ top: 28, right: 16, left: 4, bottom: 84 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8d4c8" />
                    <XAxis
                      dataKey="podLeadName"
                      interval={0}
                      angle={-28}
                      textAnchor="end"
                      height={88}
                      tick={{ fill: "#33403d", fontSize: 12 }}
                    />
                    <YAxis allowDecimals tick={{ fill: "#33403d", fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "rgba(0, 102, 96, 0.08)" }} content={<ChartTooltip />} />
                    <Bar dataKey="medianLeadChanges" fill="#006660" radius={[8, 8, 0, 0]}>
                      <LabelList dataKey="medianLeadChanges" content={<BarValueLabel />} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>{view.emptyStateMessage}</div>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.sectionTitle}>Diagnostics</div>
          <div className={styles.metricGrid}>
            <article className={styles.metricCard}>
              <div className={styles.metricLabel}>Rows scanned</div>
              <div className={styles.metricValue}>{formatMetric(view.diagnostics.rowsScanned)}</div>
            </article>
            <article className={styles.metricCard}>
              <div className={styles.metricLabel}>Valid script docs</div>
              <div className={styles.metricValue}>{formatMetric(view.diagnostics.validScriptDocs)}</div>
            </article>
            <article className={styles.metricCard}>
              <div className={styles.metricLabel}>Skipped docs</div>
              <div className={styles.metricValue}>{formatMetric(view.diagnostics.skippedDocs)}</div>
            </article>
            <article className={styles.metricCard}>
              <div className={styles.metricLabel}>Ignored rows</div>
              <div className={styles.metricValue}>{formatMetric(view.diagnostics.ignoredRows)}</div>
            </article>
          </div>

          <DiagnosticsReasonList items={view.diagnostics.reasonCounts} />
        </section>

        <section className={styles.card}>
          <div className={styles.tableHeader}>
            <div>
              <div className={styles.sectionTitle}>Validation table</div>
              <div className={styles.sectionMeta}>Use this to QA the underlying per-script calculations.</div>
            </div>
            <button type="button" className={styles.linkButton} onClick={() => setShowTable((current) => !current)}>
              {showTable ? "Hide table" : "Show table"}
            </button>
          </div>

          {showTable ? (
            view.validEntries.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>POD lead</th>
                      <th>Show</th>
                      <th>Script doc</th>
                      <th>Total revisions</th>
                      <th>Total changes</th>
                      <th>Lead changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.validEntries.map((entry) => (
                      <tr key={`${entry.rowNumber}-${entry.docFileId}`}>
                        <td>{entry.podLeadName}</td>
                        <td>{entry.showName || "-"}</td>
                        <td>
                          <a href={entry.docUrl} target="_blank" rel="noreferrer">
                            {entry.docLabel || entry.docUrl}
                          </a>
                        </td>
                        <td>{formatMetric(entry.revisionCount)}</td>
                        <td>{formatMetric(entry.totalChanges)}</td>
                        <td>{formatMetric(entry.leadChanges)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.emptyState}>No valid scripts are available for this selection.</div>
            )
          ) : null}
        </section>
      </div>
    </main>
  );
}
