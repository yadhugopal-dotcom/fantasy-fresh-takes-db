import { NextResponse } from "next/server";
import {
  POD_LEAD_ORDER,
  fetchEditorialTabRows,
} from "../../../../lib/live-tab.js";
import { formatWeekRangeLabel, getWeekSelection, normalizeWeekView } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

export async function GET(request) {
  const period = normalizeWeekView(new URL(request.url).searchParams.get("period") || "next");

  try {
    const { rows: editorialRows } = await fetchEditorialTabRows();
    const selectedWeek = getWeekSelection(period);

    const pods = POD_LEAD_ORDER.map((podName) => {
      const podKey = normalizeKey(podName);
      const podRows = (editorialRows || []).filter(
        (row) => normalizeKey(row.podLeadName) === podKey
      );

      // Beats pending vs approved for selected week
      const selectedWeekRows = podRows.filter((row) => {
        const date = row.submittedDate || "";
        return date >= selectedWeek.weekStart && date <= selectedWeek.weekEnd;
      });
      const approvedBeats = selectedWeekRows.filter(
        (row) => normalizeKey(row.status) === "approved for production by cl"
      ).length;
      const pendingBeats = selectedWeekRows.length - approvedBeats;

      // Scripts to review (status = "Completed by writer")
      const scriptsToReview = podRows.filter(
        (row) => normalizeKey(row.status) === "completed by writer"
      ).length;

      return {
        podLeadName: podName,
        pendingBeats,
        approvedBeats,
        scriptsToReview,
      };
    });

    return NextResponse.json({
      ok: true,
      period,
      weekKey: selectedWeek.weekKey,
      weekStart: selectedWeek.weekStart,
      weekEnd: selectedWeek.weekEnd,
      weekLabel: formatWeekRangeLabel(selectedWeek.weekStart, selectedWeek.weekEnd),
      pods,
    });
  } catch (error) {
    const selectedWeek = getWeekSelection(period);
    return NextResponse.json({
      ok: true,
      error: error.message || "Unable to load POD tasks.",
      period,
      weekKey: selectedWeek.weekKey,
      weekStart: selectedWeek.weekStart,
      weekEnd: selectedWeek.weekEnd,
      weekLabel: formatWeekRangeLabel(selectedWeek.weekStart, selectedWeek.weekEnd),
      pods: POD_LEAD_ORDER.map((podLeadName) => ({
        podLeadName,
        pendingBeats: 0,
        approvedBeats: 0,
        scriptsToReview: 0,
      })),
    });
  }
}
