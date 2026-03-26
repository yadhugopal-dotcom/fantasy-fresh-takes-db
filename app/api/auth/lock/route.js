import { NextResponse } from "next/server";
import { clearEditSession } from "../../../../lib/auth.js";

export async function POST() {
  const response = NextResponse.json({ unlocked: false });
  clearEditSession(response);
  return response;
}
