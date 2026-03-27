import { NextResponse } from "next/server";
import {
  fetchEditorialScriptStatusRows,
  fetchIdeationTabRows,
  parseLiveDate,
  normalizeIdeationWeekLabel,
  getIdeationWeekBucket,
} from "../../../../lib/live-tab.js";
import { getWeekSelection, shiftYmd } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function normalizeKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function GET() {
  try {
    const [{ rows: editorialRows }, { rows: ideationRows }] = await Promise.all([
      fetchEditorialScriptStatusRows(),
      fetchIdeationTabRows(),
    ]);

    // 1. Scripts pending approval per POD
    //    Column C = podLeadName, Column N = scriptStatus
    //    Count rows where scriptStatus = "Completed by writer"
    const scriptsPending = new Map();
    for (const row of editorialRows) {
      const status = normalizeKey(row.scriptStatus);
      if (status !== "completed by writer") continue;
      const podLead = row.podLeadName || "";
      if (!podLead) continue;
      scriptsPending.set(podLead, (scriptsPending.get(podLead) || 0) + 1);
    }

    const scriptsPendingByPod = Array.from(scriptsPending.entries())
      .map(([podLead, count]) => ({ podLead, count }))
      .sort((a, b) => b.count - a.count);

    // 2. Beats pending approval per POD (current week)
    //    Count ideation rows from current week with status "review pending" or "iterate"
    const weekSelection = getWeekSelection("current");
    const targetStart = weekSelection.weekStart;
    const targetEnd = shiftYmd(weekSelection.weekStart, 6);
    const bucketLabel = getIdeationWeekBucket(weekSelection);

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
