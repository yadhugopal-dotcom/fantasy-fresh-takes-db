import { NextResponse } from "next/server";
import {
  fetchEditorialTabRows,
  fetchIdeationTabRows,
  parseLiveDate,
  normalizeIdeationWeekLabel,
  getIdeationWeekBucket,
} from "../../../../lib/live-tab.js";
import { getWeekSelection, shiftYmd } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function GET() {
  try {
    const [{ rows: editorialRows }, { rows: ideationRows }] = await Promise.all([
      fetchEditorialTabRows(),
      fetchIdeationTabRows(),
    ]);

    // 1. Scripts pending approval per POD
    //    Count editorial rows where status = "Completed by the writer"
    const scriptsPending = new Map();
    for (const row of editorialRows) {
      const status = normalizeKey(row.status);
      if (status !== "completed by the writer") continue;
      const podLead = row.podLeadName || "";
      if (!podLead) continue;
      scriptsPending.set(podLead, (scriptsPending.get(podLead) || 0) + 1);
    }

    const scriptsPendingByPod = Array.from(scriptsPending.entries())
      .map(([podLead, count]) => ({ podLead, count }))
      .sort((a, b) => b.count - a.count);

    // 2. Beats pending approval per POD (current week's ideation = pipeline for next week)
    //    Count ideation rows from current week with status "review pending" or "iterate"
    const weekSelection = getWeekSelection("current");
    const sourceWeekSelection = {
      ...weekSelection,
      weekStart: shiftYmd(weekSelection.weekStart, -7),
    };
    const targetStart = sourceWeekSelection.weekStart;
    const targetEnd = shiftYmd(sourceWeekSelection.weekStart, 6);
    const bucketLabel = getIdeationWeekBucket(sourceWeekSelection);

    const beatsPending = new Map();
    for (const row of ideationRows) {
      const status = normalizeKey(row.status);
      if (!status) continue;

      const isReviewPending = status.includes("review") && status.includes("pend");
      const isIterate = status === "iterate" || status.includes("iteration");
      if (!isReviewPending && !isIterate) continue;

      // Match by date range or week label
      const rawDate = row.beatsAssignedDate || "";
      const parsedDate = parseLiveDate(rawDate);
      const weekLabel = normalizeIdeationWeekLabel(rawDate);
      const normalizedBucket = normalizeIdeationWeekLabel(bucketLabel);

      const dateInRange = parsedDate && parsedDate >= targetStart && parsedDate <= targetEnd;
      const weekLabelMatch = weekLabel && weekLabel === normalizedBucket;

      if (!dateInRange && !weekLabelMatch) continue;

      const podLead = row.podLeadName || "";
      if (!podLead) continue;
      beatsPending.set(podLead, (beatsPending.get(podLead) || 0) + 1);
    }

    const beatsPendingByPod = Array.from(beatsPending.entries())
      .map(([podLead, count]) => ({ podLead, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      ok: true,
      scriptsPendingByPod,
      beatsPendingByPod,
      totalScriptsPending: scriptsPendingByPod.reduce((s, r) => s + r.count, 0),
      totalBeatsPending: beatsPendingByPod.reduce((s, r) => s + r.count, 0),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load POD tasks." },
      { status: error.statusCode || 500 }
    );
  }
}
