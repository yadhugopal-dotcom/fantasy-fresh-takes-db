import { NextResponse } from "next/server";
import { readJsonObject } from "../../../../lib/storage.js";
import {
  fetchEditorialTabRows,
  fetchReadyForProductionTabRows,
  fetchDashboardOverrides,
  writeDashboardOverride,
} from "../../../../lib/live-tab.js";
import { hasEditSession } from "../../../../lib/auth.js";
import {
  buildPodsModel,
  createDefaultWriterConfig,
  getCurrentWeekKey,
  isNonBauPodLeadName,
  isVisiblePlannerPodLeadName,
  mergeWeekData,
  mergeWriterConfig,
} from "../../../../lib/tracker-data.js";
import { getWeekSelection, formatWeekRangeLabel } from "../../../../lib/week-view.js";
import { matchWriterName, matchAngleName } from "../../../../lib/fuzzy-match.js";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CONFIG_PATH = "config/writer-config.json";

function makePlannerWeekPath(weekKey) {
  return `weeks/${weekKey}.json`;
}

function getIstDayOfWeek() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
  return istDate.getDay(); // 0=Sun, 1=Mon, ...
}

function isDateInCurrentWeek(dateStr, weekStart, weekEnd) {
  if (!dateStr) return false;
  return dateStr >= weekStart && dateStr <= weekEnd;
}

function isDateBeforeCurrentWeek(dateStr, weekStart) {
  if (!dateStr) return false;
  return dateStr < weekStart;
}

function classifyEditorialBeat(row, weekStart, weekEnd, plannerBeatKeys) {
  const status = String(row.status || "").toLowerCase();
  const writerName = String(row.writerName || "").trim().toLowerCase();
  const showName = String(row.showName || "").trim().toLowerCase();
  const beatName = String(row.beatName || "").trim().toLowerCase();
  const submitted = row.submittedDate || "";

  // Completed scripts
  if (status.includes("completed by writer") || status.includes("completed")) {
    if (isDateInCurrentWeek(submitted, weekStart, weekEnd)) {
      return "this_week";
    }
    if (isDateBeforeCurrentWeek(submitted, weekStart)) {
      return "spillover";
    }
    return "spillover";
  }

  // WIP scripts — check Planner match
  if (status.includes("wip")) {
    const matchKey = `${writerName}|${showName}|${beatName}`;
    if (plannerBeatKeys.has(matchKey)) {
      return "this_week";
    }
    return "ambiguous";
  }

  return "ambiguous";
}

function classifyRfpBeat(row, weekStart, weekEnd) {
  const submitted = row.submittedDate || row.leadSubmittedDate || "";
  if (isDateInCurrentWeek(submitted, weekStart, weekEnd)) {
    return "this_week";
  }
  return "spillover";
}

function deriveStage(row, isRfp) {
  if (isRfp) return "ready_for_production";
  if (row.moveToProduction && String(row.moveToProduction).toLowerCase() !== "false") {
    return "moving_to_production";
  }
  if (row.leadSubmittedDate) return "reviewed_by_lead";
  const status = String(row.status || "").toLowerCase();
  if (status.includes("completed")) return "pending_review";
  return "writing";
}

export async function GET(request) {
  const url = new URL(request.url);
  const includeNewShowsPod = url.searchParams.get("includeNewShowsPod") === "true";

  try {
    const weekSelection = getWeekSelection("current");
    const weekStart = weekSelection.weekStart;
    const weekEnd = weekSelection.weekEnd;
    const weekLabel = formatWeekRangeLabel(weekStart, weekEnd);
    const dayOfWeek = getIstDayOfWeek();

    // Load Planner state
    const storedConfig = await readJsonObject(CONFIG_PATH);
    const currentConfig = mergeWriterConfig(storedConfig || createDefaultWriterConfig());
    const currentWeekKey = getCurrentWeekKey();
    const storedWeek = await readJsonObject(makePlannerWeekPath(currentWeekKey));
    const weekData = mergeWeekData(currentConfig, storedWeek, currentWeekKey);
    const pods = buildPodsModel(currentConfig, weekData).filter((pod) =>
      isVisiblePlannerPodLeadName(pod?.cl)
    );

    // Load Sheet data + overrides in parallel
    const [{ rows: editorialRows }, rfpResult, overrides] = await Promise.all([
      fetchEditorialTabRows(),
      fetchReadyForProductionTabRows().catch(() => ({ rows: [] })),
      fetchDashboardOverrides(),
    ]);
    const rfpRows = Array.isArray(rfpResult?.rows) ? rfpResult.rows : [];

    // Build Planner allocation map
    const writerAllocations = [];
    const plannerBeatKeys = new Set();

    for (const pod of pods) {
      if (!includeNewShowsPod && isNonBauPodLeadName(pod.cl)) continue;

      for (const writer of pod.writers || []) {
        if (writer.active === false) continue;
        const beats = (writer.beats || []).filter(
          (b) => String(b.beatTitle || "").trim() || String(b.beatDocUrl || "").trim() || String(b.showName || "").trim()
        );
        if (beats.length === 0) continue;

        writerAllocations.push({
          podLead: pod.cl,
          writerName: writer.name,
          writerId: writer.id,
          allocatedBeats: beats.map((b) => ({
            beatTitle: b.beatTitle || "",
            showName: b.showName || "",
          })),
        });
      }
    }

    // Collect unique Sheet writer names for fuzzy matching
    const allSheetWriterNames = [
      ...new Set([
        ...editorialRows.map((r) => r.writerName).filter(Boolean),
        ...rfpRows.map((r) => r.writerName).filter(Boolean),
      ]),
    ];

    // Build fuzzy Planner beat keys for WIP matching
    for (const alloc of writerAllocations) {
      const matchedSheetName = matchWriterName(alloc.writerName, allSheetWriterNames);
      const writerKey = (matchedSheetName || alloc.writerName).trim().toLowerCase();

      for (const beat of alloc.allocatedBeats) {
        const showKey = beat.showName.trim().toLowerCase();
        const beatKey = beat.beatTitle.trim().toLowerCase();
        plannerBeatKeys.add(`${writerKey}|${showKey}|${beatKey}`);

        // Also add with fuzzy angle matching
        const writerEditorialRows = editorialRows.filter(
          (r) => r.writerName && r.writerName.trim().toLowerCase() === writerKey
        );
        const sheetAngles = writerEditorialRows
          .filter((r) => r.showName && r.showName.trim().toLowerCase() === showKey)
          .map((r) => r.beatName);
        const matchedAngle = matchAngleName(beat.beatTitle, sheetAngles);
        if (matchedAngle) {
          plannerBeatKeys.add(`${writerKey}|${showKey}|${matchedAngle.trim().toLowerCase()}`);
        }
      }
    }

    // Classify editorial rows by writer
    const writerBeatMap = new Map();

    for (const row of editorialRows) {
      if (!row.writerName) continue;
      if (!includeNewShowsPod && isNonBauPodLeadName(row.podLeadName)) continue;

      const adCode = String(row.assetCode || "").trim();
      const overrideKey = adCode.toLowerCase();
      const overrideClassification = overrides[overrideKey];
      const classification = overrideClassification || classifyEditorialBeat(row, weekStart, weekEnd, plannerBeatKeys);
      const writerKey = row.writerName.trim().toLowerCase();

      if (!writerBeatMap.has(writerKey)) {
        writerBeatMap.set(writerKey, {
          writerName: row.writerName,
          podLead: row.podLeadName || "",
          thisWeek: [],
          spillovers: [],
          ambiguous: [],
        });
      }

      const entry = writerBeatMap.get(writerKey);
      const beatInfo = {
        adCode,
        showName: row.showName,
        beatName: row.beatName,
        status: row.status,
        submittedDate: row.submittedDate,
        stage: deriveStage(row, false),
        overridden: Boolean(overrideClassification),
      };

      if (classification === "this_week") entry.thisWeek.push(beatInfo);
      else if (classification === "spillover") entry.spillovers.push(beatInfo);
      else entry.ambiguous.push(beatInfo);
    }

    // Classify RFP rows
    for (const row of rfpRows) {
      if (!row.writerName) continue;
      if (!includeNewShowsPod && isNonBauPodLeadName(row.podLeadName)) continue;

      const classification = classifyRfpBeat(row, weekStart, weekEnd);
      const writerKey = row.writerName.trim().toLowerCase();

      if (!writerBeatMap.has(writerKey)) {
        writerBeatMap.set(writerKey, {
          writerName: row.writerName,
          podLead: row.podLeadName || "",
          thisWeek: [],
          spillovers: [],
          ambiguous: [],
        });
      }

      const entry = writerBeatMap.get(writerKey);
      const beatInfo = {
        showName: row.showName,
        beatName: row.beatName,
        status: "Ready for Production",
        submittedDate: row.submittedDate || row.leadSubmittedDate,
        stage: "ready_for_production",
      };

      if (classification === "this_week") entry.thisWeek.push(beatInfo);
      else entry.spillovers.push(beatInfo);
    }

    // Build per-writer tracker rows
    const trackerRows = [];

    for (const alloc of writerAllocations) {
      const matchedSheetName = matchWriterName(alloc.writerName, allSheetWriterNames);
      const writerKey = (matchedSheetName || alloc.writerName).trim().toLowerCase();
      const sheetData = writerBeatMap.get(writerKey) || {
        thisWeek: [],
        spillovers: [],
        ambiguous: [],
      };

      const allocated = alloc.allocatedBeats.length;
      const thisWeekCount = sheetData.thisWeek.length;
      const gap = Math.max(0, allocated - thisWeekCount);

      trackerRows.push({
        podLead: alloc.podLead,
        writerName: alloc.writerName,
        sheetWriterName: matchedSheetName || "",
        allocated,
        thisWeekCount,
        gap,
        spilloverCount: sheetData.spillovers.length,
        ambiguousCount: sheetData.ambiguous.length,
        thisWeekBeats: sheetData.thisWeek,
        spilloverBeats: sheetData.spillovers,
        ambiguousBeats: sheetData.ambiguous,
        allocatedBeats: alloc.allocatedBeats,
      });
    }

    // Sort by pod lead then writer name
    trackerRows.sort((a, b) => {
      const podComp = a.podLead.localeCompare(b.podLead);
      if (podComp !== 0) return podComp;
      return a.writerName.localeCompare(b.writerName);
    });

    // Aggregate stage breakdown (Category 1 beats only)
    const stageCounts = {
      writing: 0,
      pending_review: 0,
      reviewed_by_lead: 0,
      moving_to_production: 0,
      ready_for_production: 0,
    };
    for (const row of trackerRows) {
      for (const beat of row.thisWeekBeats) {
        const stage = beat.stage || "writing";
        if (stageCounts[stage] !== undefined) {
          stageCounts[stage] += 1;
        }
      }
    }

    const totalSpillovers = trackerRows.reduce((s, r) => s + r.spilloverCount, 0);
    const totalAllocated = trackerRows.reduce((s, r) => s + r.allocated, 0);
    const totalThisWeek = trackerRows.reduce((s, r) => s + r.thisWeekCount, 0);

    // Efficiency: scripts per writer
    const reviewedByLeadThisWeek = stageCounts.reviewed_by_lead + stageCounts.moving_to_production + stageCounts.ready_for_production;
    const allocatedWriterCount = trackerRows.filter((r) => r.allocated > 0).length;

    return NextResponse.json({
      ok: true,
      weekLabel,
      weekStart,
      weekEnd,
      dayOfWeek,
      commitTarget: includeNewShowsPod ? 30 : 20,
      totalAllocated,
      totalThisWeek,
      totalGap: Math.max(0, totalAllocated - totalThisWeek),
      totalSpillovers,
      trackerRows,
      stageCounts,
      scriptsPerWriter: allocatedWriterCount > 0
        ? Number((reviewedByLeadThisWeek / allocatedWriterCount).toFixed(1))
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load writer tracker." },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  if (!hasEditSession(request)) {
    return NextResponse.json({ ok: false, error: "Edit session required." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const adCode = String(body.adCode || "").trim();
    const classification = String(body.classification || "").trim().toLowerCase();

    if (!adCode) {
      return NextResponse.json({ ok: false, error: "Missing adCode." }, { status: 400 });
    }

    if (classification !== "this_week" && classification !== "spillover") {
      return NextResponse.json({ ok: false, error: "Classification must be this_week or spillover." }, { status: 400 });
    }

    const result = await writeDashboardOverride(adCode, classification);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to save override." },
      { status: 500 }
    );
  }
}
