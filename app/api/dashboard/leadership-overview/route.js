import { NextResponse } from "next/server";
import {
  fetchAnalyticsLiveTabRows,
  fetchEditorialWorkflowRows,
  fetchIdeationTabRows,
  fetchLiveTabRows,
  fetchLiveWorkflowRows,
  parseLiveDate,
  fetchProductionWorkflowRows,
  fetchReadyForProductionWorkflowRows,
  isAnalyticsEligibleProductionType,
  isFreshTakesLabel,
  normalizePodLeadName,
} from "../../../../lib/live-tab.js";
import { matchAngleName } from "../../../../lib/fuzzy-match.js";
import { buildDateRangeSelection, formatWeekRangeLabel, getWeekSelection, normalizeWeekView } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const maxDuration = 120;
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

function toTitleCase(value) {
  return normalizeText(value).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function buildWriterNameResolver(rows) {
  const exactMap = new Map();
  const prefixCandidates = [];
  const tokenMap = new Map();

  function register(value) {
    const displayName = normalizeText(value);
    const key = normalizeKey(displayName);
    if (!displayName || !key || exactMap.has(key)) return;

    exactMap.set(key, displayName);
    prefixCandidates.push({ key, displayName });

    for (const token of key.split(" ").filter(Boolean)) {
      if (!tokenMap.has(token)) tokenMap.set(token, new Set());
      tokenMap.get(token).add(displayName);
    }
  }

  function registerPossibleWriters(value) {
    const cleaned = normalizeText(value);
    if (!cleaned) return;
    for (const part of cleaned.split(",").map(normalizeText).filter(Boolean)) {
      register(part);
    }
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const writerName = normalizeText(row?.writerName);
    if (writerName.includes(" ")) registerPossibleWriters(writerName);
  }

  return function resolveWriterName(rawValue) {
    const cleaned = normalizeText(rawValue);
    if (!cleaned) return "Unknown Writer";

    const key = normalizeKey(cleaned);
    if (exactMap.has(key)) return exactMap.get(key);

    const prefixMatches = prefixCandidates.filter((candidate) => candidate.key.startsWith(key));
    if (prefixMatches.length === 1) return prefixMatches[0].displayName;

    const firstWordMatches = prefixCandidates.filter((candidate) => {
      if (candidate.displayName.includes(",")) return false;
      return candidate.key.split(" ")[0] === key;
    });
    if (firstWordMatches.length === 1) return firstWordMatches[0].displayName;

    const tokenMatches = tokenMap.get(key);
    if (tokenMatches && tokenMatches.size === 1) {
      return Array.from(tokenMatches)[0];
    }

    return cleaned;
  };
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

function isDateWithinWeek(dateValue, weekSelection) {
  const primaryDate = normalizeText(dateValue);
  if (!primaryDate) return false;
  return primaryDate >= weekSelection.weekStart && primaryDate <= weekSelection.weekEnd;
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
      const parsedBeatsAssignedDate = parseLiveDate(row?.beatsAssignedDate);
      const parsedAssignedDate = parseLiveDate(row?.assignedDate);
      const parsedCompletedDate = parseLiveDate(row?.completedDate);
      // Use completedDate first — this is the "Beats completed" column in the ideation sheet,
      // which is what users count when they check a week. Fall back to assigned date for
      // beats that haven't been completed yet so they still appear somewhere.
      const primaryDate = parsedCompletedDate || parsedBeatsAssignedDate || parsedAssignedDate || "";
      const timeParts = getTimeParts(primaryDate);
      return {
        id: `beat-row-${index + 1}`,
        beatCode: normalizeText(row?.beatCode),
      podLeadName: normalizeText(row?.podLeadRaw || row?.podLeadName),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      writerName: normalizeText(row?.writerName),
      statusLabel: normalizeText(row?.status || row?.beatsStatus),
      statusCategory: categorizeIdeationStatus(row?.status || row?.beatsStatus),
        beatsAssignedDate: parsedBeatsAssignedDate,
        assignedDate: parsedAssignedDate,
        completedDate: parsedCompletedDate,
        ...timeParts,
      };
    })
    .filter((row) => row.podLeadName && row.showName && row.beatName && row.monthKey && row.weekInMonth);
}

function buildWorkflowRows({ editorialRows, readyRows, productionRows, liveRows }) {
  const rows = [];

  for (const row of editorialRows) {
    const stageDate = normalizeText(row?.dateSubmittedByLead || row?.dateAssigned);
    const leadSubmittedDate = normalizeText(row?.dateSubmittedByLead || row?.dateAssigned || row?.dateSubmittedByWriter);
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
      reworkType: normalizeText(row?.reworkType),
      productionType: normalizeText(row?.productionType),
      scriptStatus: normalizeText(row?.scriptStatus),
      acdNames: [],
      leadSubmittedDate,
      writerSubmittedDate: normalizeText(row?.dateSubmittedByWriter || row?.dateSubmittedByLead || row?.dateAssigned),
      ...getTimeParts(stageDate),
    });
  }

  for (const row of readyRows) {
    const stageDate = normalizeText(row?.etaToStartProd || row?.dateSubmittedByLead);
    const leadSubmittedDate = normalizeText(row?.dateSubmittedByLead || row?.etaToStartProd);
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
      reworkType: normalizeText(row?.reworkType),
      productionType: normalizeText(row?.productionType),
      acdNames: [],
      leadSubmittedDate,
      writerSubmittedDate: normalizeText(row?.dateSubmittedByWriter || row?.dateSubmittedByLead || row?.etaToStartProd),
      ...getTimeParts(stageDate),
    });
  }

  for (const row of productionRows) {
    const stageDate = normalizeText(row?.etaPromoCompletion || row?.etaToStartProd);
    const leadSubmittedDate = normalizeText(row?.dateSubmittedByLead || row?.etaPromoCompletion || row?.etaToStartProd);
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
      cdName: normalizeText(row?.cd),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      reworkType: normalizeText(row?.reworkType),
      productionType: normalizeText(row?.productionType),
      acdNames: acdNames.length ? acdNames : ["Unassigned"],
      leadSubmittedDate,
      writerSubmittedDate: normalizeText(row?.dateSubmittedByWriter || row?.dateSubmittedByLead || row?.etaPromoCompletion || row?.etaToStartProd),
      ...getTimeParts(stageDate),
    });
  }

  for (const row of liveRows) {
    const stageDate = normalizeText(row?.finalUploadDate);
    const leadSubmittedDate = normalizeText(row?.dateSubmittedByLead || row?.finalUploadDate);
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
      cdName: normalizeText(row?.cd),
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      reworkType: normalizeText(row?.reworkType),
      productionType: normalizeText(row?.productionType),
      acdNames: acdNames.length ? acdNames : ["Unassigned"],
      leadSubmittedDate,
      writerSubmittedDate: normalizeText(
        row?.dateSubmittedByWriter || row?.dateSubmittedByLead || row?.etaPromoCompletion || row?.finalUploadDate
      ),
      ...getTimeParts(stageDate),
    });
  }

  return rows.filter((row) => {
    if (!row.podLeadName) return false;
    // Exclude GU (GenAI-Cinematic-Still / Full GenAI) assets
    const code = String(row.assetCode || "").trim().toUpperCase();
    if (code.startsWith("GU")) return false;
    return true;
  });
}

function buildFallbackWorkflowFromLiveRows(liveRows) {
  const safeRows = Array.isArray(liveRows) ? liveRows : [];

  const editorialRows = safeRows
    .filter((row) => normalizeText(row?.dateSubmittedByLead || row?.dateAssigned))
    .map((row) => ({
      ...row,
      source: "editorial",
      stageDate: normalizeText(row?.dateSubmittedByLead || row?.dateAssigned),
    }));

  const readyRows = safeRows
    .filter((row) => normalizeText(row?.etaToStartProd || row?.dateSubmittedByLead))
    .map((row) => ({
      ...row,
      source: "ready_for_production",
      stageDate: normalizeText(row?.etaToStartProd || row?.dateSubmittedByLead),
    }));

  const productionRows = safeRows
    .filter((row) => normalizeText(row?.etaPromoCompletion || row?.etaToStartProd))
    .map((row) => ({
      ...row,
      source: "production",
      stageDate: normalizeText(row?.etaPromoCompletion || row?.etaToStartProd),
    }));

  return { editorialRows, readyRows, productionRows };
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
        reworkType: normalizeText(bestMatch?.reworkType || ""),
        scriptStatus: normalizeText(bestMatch?.scriptStatus || ""),
      };
    });
}

function isFullGenAiAssetCode(value) {
  const code = normalizeText(value).toUpperCase();
  return code.startsWith("GA") || code.startsWith("GI");
}

function isFunnelSuccess(row) {
  const amountSpent = toFiniteNumber(row?.amountSpentUsd);
  const q1Completion = toFiniteNumber(row?.video0To25Pct);
  const cti = toFiniteNumber(row?.clickToInstall);
  const absoluteCompletion = toFiniteNumber(row?.absoluteCompletionPct);
  const cpi = toFiniteNumber(row?.cpiUsd);

  const passesAllThresholds = (
    Number.isFinite(amountSpent) && amountSpent >= 100 &&
    Number.isFinite(q1Completion) && q1Completion > 10 &&
    Number.isFinite(cti) && cti >= 12 &&
    Number.isFinite(absoluteCompletion) && absoluteCompletion >= 1.8 &&
    Number.isFinite(cpi) && cpi <= 12
  );
  const passesCpiOnly = Number.isFinite(cpi) && cpi < 6;
  return passesAllThresholds || passesCpiOnly;
}

function buildFullGenAiRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.liveDate)
    .filter((row) => isFullGenAiAssetCode(row?.assetCode))
    .map((row, index) => {
      const timeParts = getTimeParts(normalizeText(row?.liveDate));
      return {
        id: `full-gen-ai-${index + 1}`,
        assetCode: normalizeText(row?.assetCode),
        showName: toTitleCase(row?.showName),
        beatName: toTitleCase(row?.beatName),
        productionType: normalizeText(row?.productionType),
        success: isFunnelSuccess(row),
        amountSpentUsd: toFiniteNumber(row?.amountSpentUsd),
        q1CompletionPct: toFiniteNumber(row?.video0To25Pct),
        cpiUsd: toFiniteNumber(row?.cpiUsd),
        absoluteCompletionPct: toFiniteNumber(row?.absoluteCompletionPct),
        ctrPct: toFiniteNumber(row?.ctrPct),
        clickToInstall: toFiniteNumber(row?.clickToInstall),
        ...timeParts,
      };
    })
    .filter((row) => row.monthKey && row.weekInMonth);
}

function buildCurrentWeekUpdateRows(beatRows, workflowRows, weekSelection) {
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

  for (const beat of beatRows.filter((row) => isDateWithinWeek(row.completedDate, weekSelection))) {
    const bestMatch = getBestWorkflowMatch(findWorkflowMatches(beat, workflowRows));
    ensureRow(bestMatch?.podLeadName || beat.podLeadName, bestMatch?.writerName || beat.writerName).beats += 1;
  }

  for (const workflow of workflowRows.filter((row) => isDateWithinWeek(row.leadSubmittedDate || row.writerSubmittedDate || row.stageDate, weekSelection))) {
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

function classifyFtRw(reworkType) {
  const rt = String(reworkType || "").trim().toLowerCase();
  if (!rt) return null;
  if (isFreshTakesLabel(rt) || rt === "new q1" || rt.startsWith("new q1 ")) return "ft";
  return "rw";
}

function isPodThroughputAssetCode(assetCode) {
  const code = normalizeText(assetCode).toUpperCase();
  return code.startsWith("GA") || code.startsWith("GI");
}

function buildPodThroughputRowsForRange(workflowRows, startDate, endDate) {
  const resolveWriterName = buildWriterNameResolver(workflowRows);
  const filtered = (Array.isArray(workflowRows) ? workflowRows : []).filter((row) => {
    const leadDate = String(row?.leadSubmittedDate || "").slice(0, 10);
    if (!leadDate || leadDate < startDate || leadDate > endDate) return false;
    if (!isPodThroughputAssetCode(row?.assetCode)) return false;
    return ["editorial", "ready_for_production", "production", "live"].includes(String(row?.source || ""));
  });

  const podMap = new Map();
  const ensurePod = (name) => {
    const pod = normalizeText(name) || "Unknown POD";
    if (!podMap.has(pod)) {
      podMap.set(pod, { podLeadName: pod, totalScripts: 0, ftCount: 0, rwCount: 0, writers: new Map() });
    }
    return podMap.get(pod);
  };
  const ensureWriter = (pod, name) => {
    const writer = normalizeText(name) || "Unknown Writer";
    if (!pod.writers.has(writer)) {
      pod.writers.set(writer, { writerName: writer, totalScripts: 0, ftCount: 0, rwCount: 0 });
    }
    return pod.writers.get(writer);
  };

  for (const row of filtered) {
    const pod = ensurePod(normalizePodLeadName(row?.podLeadName || row?.podLeadRaw) || row?.podLeadName || row?.podLeadRaw);
    pod.totalScripts += 1;
    const writer = ensureWriter(pod, resolveWriterName(row?.writerName));
    writer.totalScripts += 1;

    const scriptType = classifyFtRw(row?.reworkType);
    if (scriptType === "ft") {
      pod.ftCount += 1;
      writer.ftCount += 1;
    } else {
      pod.rwCount += 1;
      writer.rwCount += 1;
    }
  }

  return Array.from(podMap.values())
    .sort((a, b) => b.totalScripts - a.totalScripts || a.podLeadName.localeCompare(b.podLeadName))
    .map((pod) => {
      const collapsedByResolvedName = Array.from(
        Array.from(pod.writers.values()).reduce((acc, writer) => {
          const resolvedName = resolveWriterName(writer.writerName);
          const key = normalizeKey(resolvedName);
          if (!acc.has(key)) {
            acc.set(key, {
              writerName: resolvedName,
              totalScripts: 0,
              ftCount: 0,
              rwCount: 0,
            });
          }
          const target = acc.get(key);
          target.totalScripts += Number(writer.totalScripts || 0);
          target.ftCount += Number(writer.ftCount || 0);
          target.rwCount += Number(writer.rwCount || 0);
          return acc;
        }, new Map()).values()
      );

      const mergedByPodLocalAlias = collapsedByResolvedName.reduce((acc, row) => {
        const current = {
          writerName: row.writerName,
          totalScripts: Number(row.totalScripts || 0),
          ftCount: Number(row.ftCount || 0),
          rwCount: Number(row.rwCount || 0),
        };
        const tokens = normalizeKey(current.writerName).split(" ").filter(Boolean);
        const isSingleToken = tokens.length === 1;

        if (isSingleToken) {
          const [token] = tokens;
          const fullNameCandidates = Array.from(acc.values()).filter((candidate) => {
            const candidateTokens = normalizeKey(candidate.writerName).split(" ").filter(Boolean);
            return candidateTokens.length > 1 && candidateTokens[0] === token;
          });
          if (fullNameCandidates.length > 0) {
            const target = fullNameCandidates.sort(
              (a, b) => b.totalScripts - a.totalScripts || a.writerName.localeCompare(b.writerName)
            )[0];
            target.totalScripts += current.totalScripts;
            target.ftCount += current.ftCount;
            target.rwCount += current.rwCount;
            return acc;
          }
        }

        const key = normalizeKey(current.writerName);
        if (!acc.has(key)) {
          acc.set(key, current);
          return acc;
        }

        const target = acc.get(key);
        target.totalScripts += current.totalScripts;
        target.ftCount += current.ftCount;
        target.rwCount += current.rwCount;
        return acc;
      }, new Map());

      return {
        podLeadName: pod.podLeadName,
        totalScripts: pod.totalScripts,
        ftCount: pod.ftCount,
        rwCount: pod.rwCount,
        writerRows: Array.from(mergedByPodLocalAlias.values()).sort(
          (a, b) => b.totalScripts - a.totalScripts || a.writerName.localeCompare(b.writerName)
        ),
      };
    });
}

export async function GET(request) {
  const url = new URL(request.url);
  const period = normalizeWeekView(url.searchParams.get("period") || "current");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const weekSelection = startDate || endDate ? buildDateRangeSelection({ startDate, endDate, period }) : getWeekSelection(period);

  try {
    const [ideationResult, editorialResult, readyResult, productionResult, liveResult, analyticsResult] = await Promise.all([
      fetchIdeationTabRows()
        .then((value) => ({ rows: value?.rows || [], error: "" }))
        .catch((error) => ({
          rows: [],
          error:
            error?.message || "The Ideation tracker tab is not accessible. Check the sheet sharing settings.",
        })),
      fetchEditorialWorkflowRows()
        .then((value) => ({ rows: value?.rows || [], error: "" }))
        .catch((error) => ({ rows: [], error: error?.message || "Editorial source unavailable." })),
      fetchReadyForProductionWorkflowRows()
        .then((value) => ({ rows: value?.rows || [], error: "" }))
        .catch((error) => ({ rows: [], error: error?.message || "Ready for Production source unavailable." })),
      fetchProductionWorkflowRows()
        .then((value) => ({ rows: value?.rows || [], error: "" }))
        .catch((error) => ({ rows: [], error: error?.message || "Production source unavailable." })),
      fetchLiveWorkflowRows()
        .then((value) => ({ rows: value?.rows || [], error: "" }))
        .catch((error) => ({ rows: [], error: error?.message || "Live source unavailable." })),
      fetchAnalyticsLiveTabRows()
        .then((value) => ({ rows: value?.rows || [], error: "" }))
        .catch((error) => ({ rows: [], error: error?.message || "Analytics source unavailable for Full Gen AI." })),
    ]);

    const fallbackFromLive = buildFallbackWorkflowFromLiveRows(liveResult?.rows || []);
    const workflowEditorialRows =
      Array.isArray(editorialResult?.rows) && editorialResult.rows.length > 0
        ? editorialResult.rows
        : fallbackFromLive.editorialRows;
    const workflowReadyRows =
      Array.isArray(readyResult?.rows) && readyResult.rows.length > 0
        ? readyResult.rows
        : fallbackFromLive.readyRows;
    const workflowProductionRows =
      Array.isArray(productionResult?.rows) && productionResult.rows.length > 0
        ? productionResult.rows
        : fallbackFromLive.productionRows;

    const beatRows = buildBeatRows(ideationResult?.rows || []);
    const workflowRows = buildWorkflowRows({
      editorialRows: workflowEditorialRows,
      readyRows: workflowReadyRows,
      productionRows: workflowProductionRows,
      liveRows: liveResult?.rows || [],
    });
    const scopedBeatRows = beatRows.filter((row) => isDateWithinWeek(row.primaryDate, weekSelection));
    const scopedWorkflowRows = workflowRows.filter((row) => isDateWithinWeek(row.stageDate, weekSelection));
    const approvedMatchedRows = buildApprovedMatchedRows(scopedBeatRows, workflowRows);

    // Pre-compute beat counts server-side (unique by beatCode or show|beat)
    const totalBeatsCount = (() => {
      const seen = new Set();
      for (const row of scopedBeatRows) {
        const key = normalizeKey(row.beatCode) || `${normalizeKey(row.showName)}|${normalizeKey(row.beatName)}`;
        if (key) seen.add(key);
      }
      return seen.size;
    })();
    const approvedBeatsCount = (() => {
      const seen = new Set();
      for (const row of scopedBeatRows) {
        if (row.statusCategory !== "approved") continue;
        const key = normalizeKey(row.beatCode) || `${normalizeKey(row.showName)}|${normalizeKey(row.beatName)}`;
        if (key) seen.add(key);
      }
      return seen.size;
    })();
    const fullGenAiRows = buildFullGenAiRows(analyticsResult?.rows || []).filter((row) =>
      isDateWithinWeek(row.primaryDate, weekSelection)
    );
    const currentWeekUpdateRows = buildCurrentWeekUpdateRows(beatRows, workflowRows, weekSelection);
    const podThroughputRows = buildPodThroughputRowsForRange(workflowRows, weekSelection.weekStart, weekSelection.weekEnd);

    return NextResponse.json({
      ok: true,
      period: startDate || endDate ? "range" : period,
      selectedWeekKey: weekSelection.weekKey,
      selectedWeekRangeLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
      weekStart: weekSelection.weekStart,
      weekEnd: weekSelection.weekEnd,
      confidenceNote: "",
      filters: buildFilterOptions(scopedBeatRows),
      totalBeatsCount,
      approvedBeatsCount,
      beatRows: scopedBeatRows,
      allBeatRows: beatRows,
      workflowRows: scopedWorkflowRows,
      allWorkflowRows: workflowRows,
      approvedMatchedRows,
      fullGenAiRows,
      fullGenAiSourceError: analyticsResult?.error || "",
      ideationSourceError: ideationResult?.error || "",
      editorialSourceError: editorialResult?.error || "",
      readyForProductionSourceError: readyResult?.error || "",
      productionSourceError: productionResult?.error || "",
      liveSourceError: liveResult?.error || "",
      currentWeekUpdateRows,
      podThroughputRows,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      error: error.message || "Unable to load leadership overview.",
      period: startDate || endDate ? "range" : period,
      selectedWeekKey: weekSelection.weekKey,
      selectedWeekRangeLabel: formatWeekRangeLabel(weekSelection.weekStart, weekSelection.weekEnd),
      confidenceNote: "",
      filters: [],
      beatRows: [],
      allBeatRows: [],
      workflowRows: [],
      allWorkflowRows: [],
      approvedMatchedRows: [],
      fullGenAiRows: [],
      fullGenAiSourceError: "Analytics source unavailable.",
      ideationSourceError: "Ideation source unavailable.",
      currentWeekUpdateRows: [],
    });
  }
}
