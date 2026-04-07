import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getPodLeadScriptChangesReport } from "../../../../lib/pod-lead-script-changes.js";
import { buildFilteredReportView, TOTAL_SHOW_OPTION } from "../../../../lib/pod-lead-script-changes-shared.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function valuesMatch(expected, received) {
  const expectedBuffer = Buffer.from(String(expected || ""));
  const receivedBuffer = Buffer.from(String(received || ""));

  if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function getRefreshSecret() {
  return String(process.env.POD_LEAD_SCRIPT_CHANGES_REFRESH_SECRET || "").trim();
}

function getProvidedSecret(request) {
  const url = new URL(request.url);
  return (
    String(request.headers.get("x-refresh-secret") || "").trim() ||
    String(url.searchParams.get("secret") || "").trim()
  );
}

export async function POST(request) {
  const configuredSecret = getRefreshSecret();

  if (!configuredSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "POD_LEAD_SCRIPT_CHANGES_REFRESH_SECRET is not configured.",
      },
      { status: 503 }
    );
  }

  if (!valuesMatch(configuredSecret, getProvidedSecret(request))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Refresh secret is invalid.",
      },
      { status: 401 }
    );
  }

  try {
    const report = await getPodLeadScriptChangesReport({ force: true });
    const view = buildFilteredReportView(report, TOTAL_SHOW_OPTION);

    return NextResponse.json({
      ok: true,
      generatedAt: report.generatedAt,
      diagnostics: view.diagnostics,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Unable to refresh POD lead script changes.",
      },
      { status: 500 }
    );
  }
}
