import { NextResponse } from "next/server";
import {
  fetchEditorialWorkflowRows,
  fetchProductionWorkflowRows,
  fetchReadyForProductionWorkflowRows,
  normalizePodLeadName,
} from "../../../../lib/live-tab.js";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

const POD_ORDER = ["Dan", "Josh", "Nishant", "Paul"];
const ALLOWED_POD_NAMES = new Set(["Dan", "Josh", "Nishant", "Paul", "Aakash Ahuja", "Berman"]);

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

function buildWorkflowRows({ editorialRows, readyRows, productionRows, liveRows }) {
  const rows = [];

  for (const row of Array.isArray(editorialRows) ? editorialRows : []) {
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
    });
  }

  for (const row of Array.isArray(readyRows) ? readyRows : []) {
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
    });
  }

  for (const row of Array.isArray(productionRows) ? productionRows : []) {
    const stageDate = normalizeText(row?.etaPromoCompletion || row?.etaToStartProd);
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
      productionType: normalizeText(row?.productionType),
    });
  }

  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    const stageDate = normalizeText(row?.finalUploadDate || row?.etaPromoCompletion || row?.etaToStartProd);
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
      productionType: normalizeText(row?.productionType),
    });
  }

  return rows;
}

function buildRawPipelineSnapshot(workflowRows) {
  const summary = {
    editorial: { total: 0 },
    readyForProd: { total: 0 },
    inProduction: { total: 0 },
    live: { total: 0 },
  };
  const podMap = new Map();
  const pipelineMap = new Map();

  const ensurePod = (podName) => {
    const pod = normalizePodLeadName(podName) || normalizeText(podName);
    if (!pod) return null;
    if (!ALLOWED_POD_NAMES.has(pod)) return null;
    if (!podMap.has(pod)) {
      podMap.set(pod, {
        podLeadName: pod,
        editorial: { total: 0 },
        readyForProd: { total: 0 },
        production: { total: 0 },
        live: { total: 0 },
      });
    }
    if (!pipelineMap.has(pod)) {
      pipelineMap.set(pod, { podLeadName: pod, total: 0, scripts: [] });
    }
    return pod;
  };

  for (const row of Array.isArray(workflowRows) ? workflowRows : []) {
    const stageKey = row?.stageKey || "editorial";
    const podName = ensurePod(row?.podLeadName || row?.podLeadRaw || "Unassigned");
    if (!podName) continue;

    if (stageKey === "editorial_review" || stageKey === "editorial") summary.editorial.total += 1;
    else if (stageKey === "ready_for_production") summary.readyForProd.total += 1;
    else if (stageKey === "production") summary.inProduction.total += 1;
    else if (stageKey === "live") summary.live.total += 1;

    const podBucket = podMap.get(podName);
    if (stageKey === "editorial_review" || stageKey === "editorial") podBucket.editorial.total += 1;
    else if (stageKey === "ready_for_production") podBucket.readyForProd.total += 1;
    else if (stageKey === "production") podBucket.production.total += 1;
    else podBucket.editorial.total += 1;

    const pipelineBucket = pipelineMap.get(podName);
    pipelineBucket.total += 1;
    pipelineBucket.scripts.push({
      showName: normalizeText(row?.showName),
      beatName: normalizeText(row?.beatName),
      writerName: normalizeText(row?.writerName || ""),
      assetCode: normalizeText(row?.assetCode || ""),
      scriptCode: normalizeText(row?.scriptCode || ""),
      status: row?.stageLabel || "Sheet row",
      stageKey,
      stageLabel: formatStageLabel(stageKey),
      etaToStartProd: normalizeText(row?.stageDate || ""),
    });
  }

  const podBreakdownRows = Array.from(podMap.values()).sort((a, b) => {
    const ai = POD_ORDER.indexOf(a.podLeadName);
    const bi = POD_ORDER.indexOf(b.podLeadName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.podLeadName.localeCompare(b.podLeadName);
  });

  const pipelineRows = Array.from(pipelineMap.values()).sort((a, b) => {
    const ai = POD_ORDER.indexOf(a.podLeadName);
    const bi = POD_ORDER.indexOf(b.podLeadName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.podLeadName.localeCompare(b.podLeadName);
  });

  return { summary, podBreakdownRows, pipelineRows };
}

function buildPipelineSummary(summary) {
  return {
    editorial: summary?.editorial || { total: 0 },
    readyForProd: summary?.readyForProd || { total: 0 },
    inProduction: summary?.inProduction || { total: 0 },
    live: Number(summary?.live?.total || 0),
  };
}

function buildPodBreakdownForPipeline(podBreakdownRows) {
  return Array.isArray(podBreakdownRows) ? podBreakdownRows : [];
}

function buildProductionPipelineRows(pipelineRows) {
  return Array.isArray(pipelineRows) ? pipelineRows : [];
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const [editorialResult, rfpResult, workflowResult] = await Promise.allSettled([
      fetchEditorialWorkflowRows(),
      fetchReadyForProductionWorkflowRows(),
      fetchProductionWorkflowRows(),
    ]);

    const editorialWorkflowRows = editorialResult.status === "fulfilled" ? (editorialResult.value?.rows || []) : [];
    const rfpWorkflowRows = rfpResult.status === "fulfilled" ? (rfpResult.value?.rows || []) : [];
    const prodWorkflowRows = workflowResult.status === "fulfilled" ? (workflowResult.value?.rows || []) : [];

    const workflowRows = buildWorkflowRows({
      editorialRows: editorialWorkflowRows,
      readyRows: rfpWorkflowRows,
      productionRows: prodWorkflowRows,
      liveRows: [],
    });
    const { summary, podBreakdownRows, pipelineRows } = buildRawPipelineSnapshot(workflowRows);
    const pipelineSummary = buildPipelineSummary(summary);

    return NextResponse.json({
      ok: true,
      pipelineRows,
      pipelineSummary,
      podBreakdownRows,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      error: error.message || "Unable to load Production pipeline.",
      pipelineRows: [],
      pipelineSummary: null,
      podBreakdownRows: [],
    });
  }
}
