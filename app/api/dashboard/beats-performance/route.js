import { NextResponse } from "next/server";
import { getBeatsPerformancePayload } from "../../../../lib/beats-performance.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const payload = await getBeatsPerformancePayload();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Unable to load beats performance dashboard.",
      },
      { status: error.statusCode || 500 }
    );
  }
}
