import { getPodLeadScriptChangesReport } from "../../../../lib/pod-lead-script-changes.js";
import {
  buildFilteredReportView,
  buildLeadAggregatesCsv,
  TOTAL_SHOW_OPTION,
} from "../../../../lib/pod-lead-script-changes-shared.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "total";
}

export async function GET(request) {
  const show = new URL(request.url).searchParams.get("show") || TOTAL_SHOW_OPTION;
  const report = await getPodLeadScriptChangesReport();
  const view = buildFilteredReportView(report, show);
  const csv = buildLeadAggregatesCsv(view.aggregateRows, view.selectedShow);
  const fileName = `pod-lead-script-changes-${slugify(view.selectedShow)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
