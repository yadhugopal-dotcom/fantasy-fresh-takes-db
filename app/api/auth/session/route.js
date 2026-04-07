import { NextResponse } from "next/server";
import { hasEditSession, isEditPasswordConfigured } from "../../../../lib/auth.js";

export async function GET(request) {
  return NextResponse.json({
    configured: isEditPasswordConfigured(),
    unlocked: hasEditSession(request),
  });
}
