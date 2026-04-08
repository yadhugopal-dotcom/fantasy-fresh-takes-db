import { NextResponse } from "next/server";
import {
  fetchAnalyticsLiveTabRows,
  fetchEditorialWorkflowRows,
  fetchIdeationTabRows,
  fetchLiveWorkflowRows,
  fetchProductionWorkflowRows,
  fetchReadyForProductionWorkflowRows,
  isAnalyticsEligibleProductionType,
} from "../../../../lib/live-tab.js";
import { matchAngleName } from "../../../../lib/fuzzy-match.js";
import { getWeekSelection } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASELINE_THRESHOLD_CHECKS = {
  threeSecPlays: (value) => value >= 35,
  thruplaysTo3s: (value) => value >= 40,
  q1Completion: (value) => value > 10,
  cpi: (value) => value < 10,
  absoluteCompletion: (value) => value > 1.5,
  cti: (value) => value >= 12,
  amountSpent: (value) => value > 100,
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return "";
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1, 12)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

function getWeekInMonthFromDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const day = Number(String(value).slice(-2));
  if (!Number.isFinite(day) || day <= 0) return null;
  return Math.min(4, Math.floor((day - 1) / 7) + 1);
}

function getTimeParts(dateValue) {
  const primaryDate = normalizeText(dateValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primaryDate)) {
    return {
      primaryDate: "",
      monthKey: "",
      monthLabel: "",
      weekInMonth: null,
    };
  }

  const monthKey = primaryDate.slice(0, 7);
  const weekInMonth = getWeekInMonthFromDate(primaryDate);
  return {
    primaryDate,
    monthKey,
    monthLabel: getMonthLabel(monthKey),
    weekInMonth,
  };
}

function categorizeIdeationStatus(statusLabel) {
  const normalized = normalizeKey(statusLabel);
  if (!normalized) return "to_be_ideated";
  if (normalized.includes("abandon")) return "abandoned";
  if (normalized === "gtg" || normalized === "gtg - minor changes" || normalized === "approved") return "approved";
  if (normalized.includes("review") && normalized.includes("pend")) return "review_pending";
  if (normalized.includes("iterate")) return "iterate";
  return "to_be_ideated";
}

function makeBeatKey(showName, beatName) {
  const showKey = normalizeKey(showName);
  const beatKey = normalizeKey(beatName);
  return showKey && beatKey ? `${showKey}|${beatKey}` : "";
}

function formatStageLabel(stageKey) {
  switch (stageKey) {
    case "live":
      return "Live";
    case "production":
      return "Production";
    case "ready_for_production":
      return "Ready for Production";
    case "editorial_review":
      return "Editorial Review";
    case "editorial":
      return "Editorial";
    default:
      return "Not mapped";
  }
}

function getStagePriority(stageKey) {
  switch (stageKey) {
    case "live":
      return 5;
    case "production":
      return 4;
    case "ready_for_production":
      return 3;
    case "editorial_review":
      return 2;
    case "editorial":
      return 1;
    default:
      return 0;
  }
}

function buildFilterOptions(beatRows) {
  const map = new Map();

  for (const row of beatRows) {
    if (!row?.monthKey || !row?.weekInMonth) continue;
    const id = `${row.monthKey}::${row.weekInMonth}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        monthKey: row.monthKey,
        weekInMonth: Number(row.weekInMonth),
        label: `${row.monthLabel} Wk${row.weekInMonth}`,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.monthKey !== b.monthKey) return a.monthKey.localeCompare(b.monthKey);
    return a.weekInMonth - b.weekInMonth;
  });
}

function buildBeatRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const primaryDate = normalizeText(row?.completedDate || row?.assignedDate || row?.beatsAssignedDate);
      const timeParts = getTimeParts(primaryDate);
      return {
        id: `beat-row-${index + 1}`,
        beatCode: normalizeText(row?.beatCode),
        podLeadName: normalizeText(row?.podLeadRaw || row?.podLeadName),
        showName: normalizeText(row?.showName),
        beatName: normalizeText(row?.beatName),
        statusLabel: normalizeText(row?.status || row?.beatsStatus),
        statusCategory: categorizeIdeationStatus(row?.status || row?.beatsStatus),
        ...timeParts,
      };
    })
    .filter((row) => row.podLeadName && row.showName && row.beatName && row.monthKey && row.weekInMonth);
}

function buildWorkflowRows({ editorialRows, readyRows, productionRows, liveRows }) {
  const rows = [];

  for (const row of editorialRows) {
    const stageDate = normalizeText(row?.dateSubmittedByLead || row?.dateAssigned);
    rows.push({
      source: "editorial",
      stageKey: row?.dateSubmittedByLead ? "editorial_review" : "editorial",
      stageLabel: formatStageLabel(row?.dateSubmittedByLead ? "editorial_review" : "editorial"),
      stagePriority: getStagePriority(row?.dateSubmittedByLead ? "editorial_review" : "editorial"),
      stageDate,
      assetCode: normalizeText(row?.assetCode),
      scriptCode: normalizeText(row?.scriptCode),
      podLeadName: normalizeText(row?.podLeadRaw || row?.podLeadName),
      writerName: normalizeText(row?.writerName),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      productionType: normalizeText(row?.productionType),
      acdNames: [],
      ...getTimeParts(stageDate),
    });
  }

  for (const row of readyRows) {
    const stageDate = normalizeText(row?.etaToStartProd || row?.dateSubmittedByLead);
    rows.push({
      source: "ready_for_production",
      stageKey: "ready_for_production",
      stageLabel: formatStageLabel("ready_for_production"),
      stagePriority: getStagePriority("ready_for_production"),
      stageDate,
      assetCode: normalizeText(row?.assetCode),
      scriptCode: normalizeText(row?.scriptCode),
      podLeadName: normalizeText(row?.podLeadRaw || row?.podLeadName),
      writerName: normalizeText(row?.writerName),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      productionType: normalizeText(row?.productionType),
      acdNames: [],
      ...getTimeParts(stageDate),
    });
  }

  for (const row of productionRows) {
    const stageDate = normalizeText(row?.etaPromoCompletion || row?.etaToStartProd);
    const acdNames = [
      ...String(row?.acd1WorkedOnWorldSettings || "").split(/[,/]/).map(normalizeText).filter(Boolean),
      ...String(row?.acdMultipleSelections || "").split(/[,/]/).map(normalizeText).filter(Boolean),
    ];
    rows.push({
      source: "production",
      stageKey: "production",
      stageLabel: formatStageLabel("production"),
      stagePriority: getStagePriority("production"),
      stageDate,
      assetCode: normalizeText(row?.assetCode),
      scriptCode: normalizeText(row?.scriptCode),
      podLeadName: normalizeText(row?.podLeadRaw || row?.podLeadName),
      writerName: normalizeText(row?.writerName),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      productionType: normalizeText(row?.productionType),
      acdNames: acdNames.length ? acdNames : ["Unassigned"],
      ...getTimeParts(stageDate),
    });
  }

  for (const row of liveRows) {
    const stageDate = normalizeText(row?.finalUploadDate || row?.etaPromoCompletion || row?.etaToStartProd);
    const acdNames = [
      ...String(row?.acd1WorkedOnWorldSettings || "").split(/[,/]/).map(normalizeText).filter(Boolean),
      ...String(row?.acdMultipleSelections || "").split(/[,/]/).map(normalizeText).filter(Boolean),
    ];
    rows.push({
      source: "live",
      stageKey: "live",
      stageLabel: formatStageLabel("live"),
      stagePriority: getStagePriority("live"),
      stageDate,
      assetCode: normalizeText(row?.assetCode),
      scriptCode: normalizeText(row?.scriptCode),
      podLeadName: normalizeText(row?.podLeadRaw || row?.podLeadName),
      writerName: normalizeText(row?.writerName),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      productionType: normalizeText(row?.productionType),
      acdNames: acdNames.length ? acdNames : ["Unassigned"],
      ...getTimeParts(stageDate),
    });
  }

  return rows.filter((row) => row.podLeadName && row.showName && row.beatName);
}

function findWorkflowMatches(ideationRow, workflowRows) {
  const beatCode = normalizeKey(ideationRow?.beatCode);
  const showKey = normalizeKey(ideationRow?.showName);
  const beatName = normalizeText(ideationRow?.beatName);

  if (beatCode) {
    const exactCodeMatches = workflowRows.filter(
      (row) => normalizeKey(row?.scriptCode) === beatCode || normalizeKey(row?.assetCode) === beatCode
    );
    if (exactCodeMatches.length > 0) return exactCodeMatches;
  }

  const sameShowRows = workflowRows.filter((row) => normalizeKey(row?.showName) === showKey);
  if (sameShowRows.length === 0) return [];

  const matchedAngle = matchAngleName(beatName, sameShowRows.map((row) => row?.beatName).filter(Boolean));
  if (!matchedAngle) return [];

  return sameShowRows.filter((row) => normalizeKey(row?.beatName) === normalizeKey(matchedAngle));
}

function getBestWorkflowMatch(matches) {
  return [...matches].sort((a, b) => {
    const byStage = Number(b?.stagePriority || 0) - Number(a?.stagePriority || 0);
    if (byStage !== 0) return byStage;
    return String(b?.stageDate || "").localeCompare(String(a?.stageDate || ""));
  })[0] || null;
}

function buildApprovedMatchedRows(beatRows, workflowRows) {
  return beatRows
    .filter((row) => row.statusCategory === "approved")
    .map((row, index) => {
      const bestMatch = getBestWorkflowMatch(findWorkflowMatches(row, workflowRows));
      return {
        id: `approved-match-${index + 1}`,
        monthKey: row.monthKey,
        monthLabel: row.monthLabel,
        weekInMonth: row.weekInMonth,
        beatCode: row.beatCode,
        showName: row.showName,
        beatName: row.beatName,
        podLeadName: normalizeText(bestMatch?.podLeadName || row.podLeadName),
        writerName: normalizeText(bestMatch?.writerName || ""),
        stageKey: bestMatch?.stageKey || "not_mapped",
        stageLabel: bestMatch?.stageLabel || "Not mapped",
      };
    });
}

function buildMetricCell(rawValue, baselineCheck) {
  const value = toFiniteNumber(rawValue);
  return {
    value,
    meetsBenchmark: Number.isFinite(value) && typeof baselineCheck === "function" ? baselineCheck(value) : null,
  };
}

function countBenchmarkMisses(metricMap, metricKeys) {
  return metricKeys.reduce((count, key) => {
    const cell = metricMap?.[key];
    if (cell && cell.meetsBenchmark === false) return count + 1;
    return count;
  }, 0);
}

function classifyNextStep(row) {
  const metrics = {
    threeSecPlays: buildMetricCell(row?.threeSecPlayPct, BASELINE_THRESHOLD_CHECKS.threeSecPlays),
    thruplaysTo3s: buildMetricCell(row?.thruPlayTo3sRatio, BASELINE_THRESHOLD_CHECKS.thruplaysTo3s),
    q1Completion: buildMetricCell(row?.video0To25Pct, BASELINE_THRESHOLD_CHECKS.q1Completion),
    cpi: buildMetricCell(row?.cpiUsd, BASELINE_THRESHOLD_CHECKS.cpi),
    absoluteCompletion: buildMetricCell(row?.absoluteCompletionPct, BASELINE_THRESHOLD_CHECKS.absoluteCompletion),
    cti: buildMetricCell(row?.clickToInstall, BASELINE_THRESHOLD_CHECKS.cti),
    amountSpent: buildMetricCell(row?.amountSpentUsd, BASELINE_THRESHOLD_CHECKS.amountSpent),
  };

  const baselineMissCount = countBenchmarkMisses(metrics, [
    "threeSecPlays",
    "thruplaysTo3s",
    "q1Completion",
    "cpi",
    "absoluteCompletion",
    "cti",
  ]);
  const amountSpent = toFiniteNumber(row?.amountSpentUsd);
  const cpiValue = toFiniteNumber(row?.cpiUsd);
  const ctiValue = toFiniteNumber(row?.clickToInstall);

  if (!Number.isFinite(amountSpent) || amountSpent < 100) return "Testing / Drop";
  if (Number.isFinite(cpiValue) && cpiValue < 10 && baselineMissCount <= 2) return "Gen AI";
  if (Number.isFinite(ctiValue) && ctiValue >= 12) return "P1 Rework";
  return "P2 Rework";
}

function isFunnelSuccess(row) {
  const amountSpent = toFiniteNumber(row?.amountSpentUsd);
  const q1Completion = toFiniteNumber(row?.video0To25Pct);
  const cti = toFiniteNumber(row?.clickToInstall);
  const absoluteCompletion = toFiniteNumber(row?.absoluteCompletionPct);
  const cpi = toFiniteNumber(row?.cpiUsd);

  return (
    Number.isFinite(amountSpent) && amountSpent >= 100 &&
    Number.isFinite(q1Completion) && q1Completion > 10 &&
    Number.isFinite(cti) && cti >= 12 &&
    Number.isFinite(absoluteCompletion) && absoluteCompletion >= 1.8 &&
    Number.isFinite(cpi) && cpi <= 12
  );
}

function isBetterAttemptRow(nextRow, currentRow) {
  const nextScore = Number(nextRow?.metricsCompletenessScore || 0);
  const currentScore = Number(currentRow?.metricsCompletenessScore || 0);
  if (nextScore !== currentScore) return nextScore > currentScore;

  const nextSpend = Number(nextRow?.amountSpentUsd || 0);
  const currentSpend = Number(currentRow?.amountSpentUsd || 0);
  if (Number.isFinite(nextSpend) && Number.isFinite(currentSpend) && nextSpend !== currentSpend) {
    return nextSpend > currentSpend;
  }

  return Number(nextRow?.rowIndex || 0) > Number(currentRow?.rowIndex || 0);
}

function buildFullGenAiRows(rows) {
  const deduped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.liveDate || !isAnalyticsEligibleProductionType(row?.productionType)) continue;
    const assetCodeKey = normalizeKey(row?.assetCode);
    if (!assetCodeKey) continue;
    if (!deduped.has(assetCodeKey) || isBetterAttemptRow(row, deduped.get(assetCodeKey))) {
      deduped.set(assetCodeKey, row);
    }
  }

  return Array.from(deduped.values())
    .filter((row) => classifyNextStep(row) === "Gen AI")
    .map((row, index) => {
      const timeParts = getTimeParts(normalizeText(row?.liveDate));
      return {
        id: `full-gen-ai-${index + 1}`,
        assetCode: normalizeText(row?.assetCode),
        showName: normalizeText(row?.showName),
        beatName: normalizeText(row?.beatName),
        success: isFunnelSuccess(row),
        ...timeParts,
      };
    })
    .filter((row) => row.monthKey && row.weekInMonth);
}

function buildCurrentWeekUpdateRows(beatRows, workflowRows) {
  const currentWeek = getWeekSelection("current");
  const grouped = new Map();

  const ensureRow = (podLeadName, writerName) => {
    const pod = normalizeText(podLeadName || "Unassigned");
    const writer = normalizeText(writerName || "Unassigned");
    const key = `${normalizeKey(pod)}|${normalizeKey(writer)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        podLeadName: pod,
        writerName: writer,
        beats: 0,
        editorial: 0,
        readyForProduction: 0,
        production: 0,
        live: 0,
      });
    }
    return grouped.get(key);
  };

  for (const beat of beatRows.filter((row) => row.primaryDate >= currentWeek.weekStart && row.primaryDate <= currentWeek.weekEnd)) {
    const bestMatch = getBestWorkflowMatch(findWorkflowMatches(beat, workflowRows));
    ensureRow(bestMatch?.podLeadName || beat.podLeadName, bestMatch?.writerName).beats += 1;
  }

  for (const workflow of workflowRows.filter((row) => row.stageDate >= currentWeek.weekStart && row.stageDate <= currentWeek.weekEnd)) {
    const entry = ensureRow(workflow.podLeadName, workflow.writerName);
    if (workflow.stageKey === "editorial" || workflow.stageKey === "editorial_review") entry.editorial += 1;
    if (workflow.stageKey === "ready_for_production") entry.readyForProduction += 1;
    if (workflow.stageKey === "production") entry.production += 1;
    if (workflow.stageKey === "live") entry.live += 1;
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.beats - a.beats || a.podLeadName.localeCompare(b.podLeadName) || a.writerName.localeCompare(b.writerName)
  );
}

export async function GET() {
  try {
    const [ideationResult, editorialResult, readyResult, productionResult, liveResult, analyticsResult] = await Promise.all([
      fetchIdeationTabRows(),
      fetchEditorialWorkflowRows(),
      fetchReadyForProductionWorkflowRows().catch(() => ({ rows: [] })),
      fetchProductionWorkflowRows().catch(() => ({ rows: [] })),
      fetchLiveWorkflowRows().catch(() => ({ rows: [] })),
      fetchAnalyticsLiveTabRows().catch(() => ({ rows: [] })),
    ]);

    const beatRows = buildBeatRows(ideationResult?.rows || []);
    const workflowRows = buildWorkflowRows({
      editorialRows: editorialResult?.rows || [],
      readyRows: readyResult?.rows || [],
      productionRows: productionResult?.rows || [],
      liveRows: liveResult?.rows || [],
    });
    const approvedMatchedRows = buildApprovedMatchedRows(beatRows, workflowRows);
    const fullGenAiRows = buildFullGenAiRows(analyticsResult?.rows || []);
    const currentWeekUpdateRows = buildCurrentWeekUpdateRows(beatRows, workflowRows);

    return NextResponse.json({
      ok: true,
      filters: buildFilterOptions(beatRows),
      beatRows,
      workflowRows,
      approvedMatchedRows,
      fullGenAiRows,
      currentWeekUpdateRows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load leadership overview." },
      { status: error.statusCode || 500 }
    );
  }
}
