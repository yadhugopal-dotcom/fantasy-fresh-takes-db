import { NextResponse } from "next/server";
import { getBeatsPerformancePayload } from "../../../../lib/beats-performance.js";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  try {
    const payload = await getBeatsPerformancePayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=14400, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Unable to load beats performance dashboard.",
      },
      {
        status: error.statusCode || 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
