import { NextResponse } from "next/server";
import { getPodLeadScriptChangesReport } from "../../../lib/pod-lead-script-changes.js";
import {
  buildFilteredReportView,
  buildShowOptions,
  TOTAL_SHOW_OPTION,
} from "../../../lib/pod-lead-script-changes-shared.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const show = new URL(request.url).searchParams.get("show") || TOTAL_SHOW_OPTION;

  try {
    const report = await getPodLeadScriptChangesReport();
    const view = buildFilteredReportView(report, show);

    return NextResponse.json({
      ok: true,
      generatedAt: report.generatedAt,
      source: report.source,
      shows: buildShowOptions(report),
      ...view,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Unable to load POD lead script changes.",
      },
      { status: 500 }
    );
  }
}
