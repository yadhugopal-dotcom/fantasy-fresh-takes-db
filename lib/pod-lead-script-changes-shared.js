import { normalizeShowName } from "./pod-lead-script-changes-config.js";

export const TOTAL_SHOW_OPTION = "Total";

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return round2((sorted[middle - 1] + sorted[middle]) / 2);
}

export function buildShowOptions(report) {
  const showNames = Array.isArray(report?.shows) ? report.shows : [];
  return [TOTAL_SHOW_OPTION, ...showNames];
}

export function matchesShowFilter(showName, selectedShow) {
  const normalizedFilter = normalizeShowName(selectedShow);

  if (!normalizedFilter || normalizedFilter === TOTAL_SHOW_OPTION) {
    return true;
  }

  return normalizeShowName(showName) === normalizedFilter;
}

export function buildLeadAggregates(validEntries) {
  const grouped = new Map();

  for (const entry of Array.isArray(validEntries) ? validEntries : []) {
    const podLeadName = String(entry?.podLeadName || "").trim();

    if (!podLeadName) {
      continue;
    }

    if (!grouped.has(podLeadName)) {
      grouped.set(podLeadName, []);
    }

    grouped.get(podLeadName).push(entry);
  }

  return Array.from(grouped.entries())
    .map(([podLeadName, entries]) => {
      const leadChanges = entries.map((entry) => Number(entry.leadChanges || 0));
      const totalChanges = entries.map((entry) => Number(entry.totalChanges || 0));
      const zeroChangeScriptCount = leadChanges.filter((value) => value === 0).length;
      const totalScripts = entries.length;
      const totalLeadChanges = leadChanges.reduce((sum, value) => sum + value, 0);
      const averageLeadChanges = totalScripts ? round2(totalLeadChanges / totalScripts) : 0;

      return {
        podLeadName,
        totalScripts,
        medianLeadChanges: median(leadChanges) ?? 0,
        averageLeadChanges,
        totalLeadChanges,
        medianTotalDocChanges: median(totalChanges) ?? 0,
        zeroChangeScriptCount,
        zeroChangeShare: totalScripts ? zeroChangeScriptCount / totalScripts : 0,
      };
    })
    .sort(
      (left, right) =>
        right.medianLeadChanges - left.medianLeadChanges ||
        right.averageLeadChanges - left.averageLeadChanges ||
        right.totalLeadChanges - left.totalLeadChanges ||
        right.totalScripts - left.totalScripts ||
        left.podLeadName.localeCompare(right.podLeadName)
    );
}

export function buildDiagnostics(outcomes) {
  const items = Array.isArray(outcomes) ? outcomes : [];
  const reasonMap = new Map();
  let validScriptDocs = 0;
  let skippedDocs = 0;
  let ignoredRows = 0;

  for (const outcome of items) {
    const status = String(outcome?.status || "");
    const reason = String(outcome?.reason || "").trim();

    if (status === "valid") {
      validScriptDocs += 1;
      continue;
    }

    if (status === "skipped") {
      skippedDocs += 1;
    } else if (status === "ignored") {
      ignoredRows += 1;
    }

    if (reason) {
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    }
  }

  return {
    rowsScanned: items.length,
    validScriptDocs,
    skippedDocs,
    ignoredRows,
    reasonCounts: Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

export function buildFilteredReportView(report, selectedShow = TOTAL_SHOW_OPTION) {
  const filterValue = normalizeShowName(selectedShow) || TOTAL_SHOW_OPTION;
  const validEntries = (Array.isArray(report?.validEntries) ? report.validEntries : []).filter((entry) =>
    matchesShowFilter(entry?.showName, filterValue)
  );
  const outcomes = (Array.isArray(report?.outcomes) ? report.outcomes : []).filter((outcome) =>
    matchesShowFilter(outcome?.showName, filterValue)
  );
  const aggregateRows = buildLeadAggregates(validEntries);

  return {
    selectedShow: filterValue,
    validEntries,
    outcomes,
    aggregateRows,
    diagnostics: buildDiagnostics(outcomes),
    hasData: aggregateRows.length > 0,
    emptyStateMessage: `No usable script docs were found for ${filterValue}.`,
  };
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function buildLeadAggregatesCsv(rows, selectedShow) {
  const header = [
    "show_filter",
    "pod_lead",
    "total_scripts",
    "median_lead_changes",
    "average_lead_changes",
    "total_lead_changes",
    "median_total_doc_changes",
    "zero_change_scripts",
    "zero_change_share_pct",
  ];

  const lines = [header.join(",")];

  for (const row of Array.isArray(rows) ? rows : []) {
    lines.push(
      [
        selectedShow,
        row.podLeadName,
        row.totalScripts,
        row.medianLeadChanges,
        row.averageLeadChanges,
        row.totalLeadChanges,
        row.medianTotalDocChanges,
        row.zeroChangeScriptCount,
        round2(Number(row.zeroChangeShare || 0) * 100),
      ]
        .map(escapeCsvValue)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}
