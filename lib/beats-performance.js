import {
  fetchEditorialTabRows,
  fetchEditorialWorkflowRows,
  fetchIdeationTabRows,
  fetchLiveTabRows,
  fetchLiveWorkflowRows,
  fetchProductionTabRows,
  fetchProductionWorkflowRows,
  fetchReadyForProductionTabRows,
  fetchReadyForProductionWorkflowRows,
  isFreshTakesLabel,
  normalizePodLeadName,
  parseLiveDate,
} from "./live-tab.js";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

let beatsPerformanceCache = {
  expiresAt: 0,
  payload: null,
};

function getNextFiveAmIstTs(nowTs = Date.now()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const now = new Date(nowTs + istOffsetMs);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const nextFiveAmIst = Date.UTC(year, month, day, 5, 0, 0, 0) - istOffsetMs;
  return nowTs < nextFiveAmIst ? nextFiveAmIst : nextFiveAmIst + 24 * 60 * 60 * 1000;
}

function getPayloadCacheExpiryTs(nowTs = Date.now()) {
  return Math.min(nowTs + CACHE_TTL_MS, getNextFiveAmIstTs(nowTs));
}

function getSettledRows(result) {
  if (result?.status === "fulfilled" && Array.isArray(result.value?.rows)) {
    return result.value.rows;
  }
  return [];
}

function getMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) {
    return "Unknown month";
  }

  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1, 12)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getWeekInMonthFromDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const day = Number(String(value).slice(-2));
  if (!Number.isFinite(day) || day <= 0) {
    return null;
  }

  return Math.min(4, Math.floor((day - 1) / 7) + 1);
}

function parseMonthWeekLabel(rawValue) {
  const normalized = String(rawValue || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const match = normalized.match(/^([a-z]{3,9})\s+week\s+([1-4])$/);
  if (!match) {
    return null;
  }

  const monthDate = new Date(`${match[1]} 1, ${new Date().getUTCFullYear()} 12:00:00 UTC`);
  if (Number.isNaN(monthDate.getTime())) {
    return null;
  }

  const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const weekInMonth = Number(match[2]);
  return {
    monthKey,
    monthLabel: getMonthLabel(monthKey),
    weekInMonth,
    weekLabel: `Week ${weekInMonth}`,
  };
}

function categorizeStatus(statusLabel) {
  const normalized = String(statusLabel || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) return "to_be_ideated";
  if (normalized.includes("abandon")) return "abandoned";
  if (normalized === "gtg" || normalized === "gtg - minor changes" || normalized === "approved") return "approved";
  if (normalized.includes("review") && normalized.includes("pend")) return "review_pending";
  if (normalized === "iterate" || normalized.includes("iteration")) return "iterate";
  return "to_be_ideated";
}

function normalizePodMatchKey(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildTimeParts(assignedDateRaw, completedDateRaw, legacyDateRaw) {
  const assignedDate = parseLiveDate(assignedDateRaw);
  const completedDate = parseLiveDate(completedDateRaw) || parseLiveDate(legacyDateRaw);
  const primaryDate = completedDate || assignedDate || "";
  const primaryRaw = completedDate ? completedDateRaw : assignedDate ? assignedDateRaw : legacyDateRaw;

  if (primaryDate) {
    const monthKey = primaryDate.slice(0, 7);
    const weekInMonth = getWeekInMonthFromDate(primaryDate);
    return {
      assignedDate,
      completedDate,
      primaryDate,
      monthKey,
      monthLabel: getMonthLabel(monthKey),
      weekInMonth,
      weekLabel: weekInMonth ? `Week ${weekInMonth}` : "",
      rawBucketLabel: String(primaryRaw || "").trim(),
    };
  }

  const labelParts = parseMonthWeekLabel(legacyDateRaw || completedDateRaw || assignedDateRaw);
  if (labelParts) {
    return {
      assignedDate,
      completedDate,
      primaryDate: "",
      ...labelParts,
      rawBucketLabel: String(legacyDateRaw || completedDateRaw || assignedDateRaw || "").trim(),
    };
  }

  return {
    assignedDate,
    completedDate,
    primaryDate: "",
    monthKey: "",
    monthLabel: "",
    weekInMonth: null,
    weekLabel: "",
    rawBucketLabel: String(legacyDateRaw || completedDateRaw || assignedDateRaw || "").trim(),
  };
}

function daysBetween(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Number((diffMs / 86_400_000).toFixed(1));
}

async function fetchIdeationSheetRows() {
  const { rows } = await fetchIdeationTabRows();

  return rows.map((row) => {
    const statusLabel = String(row?.status || row?.beatsStatus || "").trim();
    const assignedDateRaw = String(row?.assignedDate || "").trim();
    const completedDateRaw = String(row?.completedDate || "").trim();
    const legacyDateRaw = String(row?.beatsAssignedDate || "").trim();
    const timeParts = buildTimeParts(assignedDateRaw, completedDateRaw, legacyDateRaw);
    const cycleDays = daysBetween(timeParts.assignedDate, timeParts.completedDate);

    return {
      id: `ideation-row-${row?.rowIndex || Math.random()}`,
      rowIndex: row?.rowIndex || 0,
      beatCode: String(row?.beatCode || "").trim() || `ROW-${row?.rowIndex || "-"}`,
      showName: String(row?.showName || "").trim() || "Unknown show",
      beatName: String(row?.beatName || "").trim() || `Beat row ${row?.rowIndex || "-"}`,
      podLeadName: String(row?.podLeadRaw || row?.podLeadName || "").trim(),
      podMatchKey: normalizePodMatchKey(normalizePodLeadName(row?.podLeadRaw || row?.podLeadName || "")),
      statusLabel: statusLabel || "To be ideated",
      statusCategory: categorizeStatus(statusLabel),
      assignedDate: timeParts.assignedDate || "",
      completedDate: timeParts.completedDate || "",
      assignedDateRaw,
      completedDateRaw,
      rawBucketLabel: timeParts.rawBucketLabel,
      monthKey: timeParts.monthKey,
      monthLabel: timeParts.monthLabel,
      weekInMonth: timeParts.weekInMonth,
      weekLabel: timeParts.weekLabel,
      primaryDate: timeParts.primaryDate,
      cycleDays,
    };
  });
}

function buildFreshTakeRows(liveRows = []) {
  return liveRows
    .filter((row) => {
      if (!row?.liveDate || !row?.podLeadName) return false;
      return isFreshTakesLabel(row?.reworkType);
    })
    .map((row, index) => {
      const monthKey = String(row.liveDate || "").slice(0, 7);
      const weekInMonth = getWeekInMonthFromDate(row.liveDate);
      return {
        id: `fresh-take-${index + 1}`,
        liveRowIndex: row.rowIndex || index + 2,
        assetCode: String(row.assetCode || "").trim(),
        baseAssetCode: String(row.baseAssetCode || "").trim(),
        podLeadName: normalizePodLeadName(row.podLeadName),
        podMatchKey: normalizePodMatchKey(row.podLeadName),
        showName: String(row.showName || "").trim() || "Unknown show",
        beatName: String(row.beatName || "").trim() || "Unknown beat",
        tatStartDate: String(row.tatStartDate || "").trim(),
        liveDate: row.liveDate,
        monthKey,
        monthLabel: getMonthLabel(monthKey),
        weekInMonth,
        weekLabel: weekInMonth ? `Week ${weekInMonth}` : "",
      };
    });
}

function buildStageRows(rows = [], { dateField, idPrefix, podSource = "normalized" } = {}) {
  return rows
    .map((row, index) => {
      const stageDate = String(row?.[dateField] || "").trim();
      return {
        id: `${idPrefix}-${index + 1}`,
        assetCode: String(row?.assetCode || row?.baseAssetCode || "").trim(),
        podLeadName:
          podSource === "raw" ? String(row?.podLeadRaw || row?.podLeadName || "").trim() : normalizePodLeadName(row?.podLeadName || ""),
        podMatchKey: normalizePodMatchKey(row?.podLeadRaw || row?.podLeadName || ""),
        showName: String(row?.showName || "").trim(),
        beatName: String(row?.beatName || "").trim(),
        productionType: String(row?.productionType || "").trim(),
        stageDate,
      };
    })
    .filter((row) => row.stageDate && row.showName && row.beatName);
}

function buildWorkflowRows(rows = [], dateFields = []) {
  return rows.map((row, index) => ({
    id: `workflow-row-${index + 1}`,
    rowIndex: row?.rowIndex || index + 2,
    assetCode: String(row?.assetCode || "").trim(),
    scriptCode: String(row?.scriptCode || "").trim(),
    podLeadName: String(row?.podLeadRaw || row?.podLeadName || "").trim(),
    podMatchKey: normalizePodMatchKey(normalizePodLeadName(row?.podLeadRaw || row?.podLeadName || "")),
    writerName: String(row?.writerName || "").trim(),
    showName: String(row?.showName || "").trim(),
    beatName: String(row?.beatName || "").trim(),
    productionType: String(row?.productionType || "").trim(),
    dateAssigned: String(row?.dateAssigned || "").trim(),
    dateSubmittedByLead: String(row?.dateSubmittedByLead || "").trim(),
    etaToStartProd: String(row?.etaToStartProd || "").trim(),
    etaPromoCompletion: String(row?.etaPromoCompletion || "").trim(),
    cl: String(row?.cl || "").trim(),
    cd: String(row?.cd || "").trim(),
    acd1WorkedOnWorldSettings: String(row?.acd1WorkedOnWorldSettings || "").trim(),
    acdMultipleSelections: String(row?.acdMultipleSelections || "").trim(),
    status: String(row?.status || "").trim(),
    finalUploadDate: String(row?.finalUploadDate || "").trim(),
    filterDates: dateFields.map((field) => String(row?.[field] || "").trim()).filter(Boolean),
  }));
}

function buildFilterOptions(beatRows) {
  const monthMap = new Map();
  const pods = new Set();

  for (const row of beatRows) {
    if (row?.monthKey) {
      monthMap.set(row.monthKey, row.monthLabel || getMonthLabel(row.monthKey));
    }
    if (row?.podLeadName) {
      pods.add(row.podLeadName);
    }
  }

  const months = Array.from(monthMap.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => right.id.localeCompare(left.id));

  return {
    months,
    pods: Array.from(pods).sort((left, right) => left.localeCompare(right)),
  };
}

async function buildBeatsPerformancePayload() {
  const [
    liveResult,
    editorialResult,
    readyForProductionResult,
    productionResult,
    editorialWorkflowResult,
    readyForProductionWorkflowResult,
    productionWorkflowResult,
    liveWorkflowResult,
    beatRowsResult,
  ] = await Promise.allSettled([
    fetchLiveTabRows(),
    fetchEditorialTabRows(),
    fetchReadyForProductionTabRows(),
    fetchProductionTabRows(),
    fetchEditorialWorkflowRows(),
    fetchReadyForProductionWorkflowRows(),
    fetchProductionWorkflowRows(),
    fetchLiveWorkflowRows(),
    fetchIdeationSheetRows(),
  ]);
  const liveRows = getSettledRows(liveResult);
  const editorialRows = getSettledRows(editorialResult);
  const readyForProductionRows = getSettledRows(readyForProductionResult);
  const productionRows = getSettledRows(productionResult);
  const editorialWorkflowRows = getSettledRows(editorialWorkflowResult);
  const readyForProductionWorkflowRows = getSettledRows(readyForProductionWorkflowResult);
  const productionWorkflowRows = getSettledRows(productionWorkflowResult);
  const liveWorkflowRows = getSettledRows(liveWorkflowResult);
  const beatRows =
    beatRowsResult?.status === "fulfilled" && Array.isArray(beatRowsResult.value)
      ? beatRowsResult.value
      : [];

  if (beatRows.length === 0) {
    throw new Error("Ideation tracker data is unavailable right now.");
  }

  const warnings = [
    liveResult?.status === "rejected" ? "Live" : "",
    editorialResult?.status === "rejected" ? "Editorial" : "",
    readyForProductionResult?.status === "rejected" ? "Ready for Production" : "",
    productionResult?.status === "rejected" ? "Production" : "",
  ].filter(Boolean);
  const freshTakeRows = buildFreshTakeRows(liveRows);
  const productionTimeline = {
    editorial: buildStageRows(editorialRows, { dateField: "submittedDate", idPrefix: "editorial" }),
    readyForProduction: buildStageRows(readyForProductionRows, { dateField: "approvedForProdDate", idPrefix: "ready-for-production" }),
    production: buildStageRows(productionRows, { dateField: "productionPickedDate", idPrefix: "production" }),
    live: buildStageRows(liveRows, { dateField: "liveDate", idPrefix: "live" }),
  };
  const workflowTables = {
    editorial: buildWorkflowRows(editorialWorkflowRows, ["dateAssigned", "dateSubmittedByLead"]),
    readyForProduction: buildWorkflowRows(readyForProductionWorkflowRows, ["dateSubmittedByLead", "etaToStartProd"]),
    production: buildWorkflowRows(productionWorkflowRows, ["etaToStartProd", "etaPromoCompletion"]),
    live: buildWorkflowRows(liveWorkflowRows, ["dateAssigned", "dateSubmittedByLead", "etaToStartProd", "etaPromoCompletion", "finalUploadDate"]),
  };

  const filteredBeatRows = beatRows.filter(
    (row) => row.podLeadName && row.monthKey && Number(row.weekInMonth || 0) >= 1 && row.statusLabel
  );

  return {
    ok: true,
    warnings,
    benchmark: {
      beatsPerPodPerWeek: 2,
      freshTakesPerPodPerWeek: 1,
    },
    filters: buildFilterOptions(filteredBeatRows),
    rows: filteredBeatRows,
    freshTakeRows,
    productionTimeline,
    workflowTables,
  };
}

export async function getBeatsPerformancePayload({ force = false } = {}) {
  const now = Date.now();
  if (!force && beatsPerformanceCache.payload && beatsPerformanceCache.expiresAt > now) {
    return beatsPerformanceCache.payload;
  }

  try {
    const payload = await buildBeatsPerformancePayload();
    beatsPerformanceCache = {
      payload,
      expiresAt: getPayloadCacheExpiryTs(now),
    };

    return payload;
  } catch (error) {
    if (beatsPerformanceCache.payload) {
      return {
        ...beatsPerformanceCache.payload,
        warnings: [
          ...(Array.isArray(beatsPerformanceCache.payload?.warnings) ? beatsPerformanceCache.payload.warnings : []),
          "Showing last cached dashboard snapshot because live refresh failed.",
        ],
      };
    }
    throw error;
  }
}
