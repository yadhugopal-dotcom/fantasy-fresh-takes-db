import { NextResponse } from "next/server";
import {
  isEditPasswordConfigured,
  matchesEditPassword,
  setEditSession,
} from "../../../../lib/auth.js";

export async function POST(request) {
  if (!isEditPasswordConfigured()) {
    return NextResponse.json(
      { error: "Edit access is not configured right now." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    if (!matchesEditPassword(body.password)) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    const response = NextResponse.json({ unlocked: true });
    setEditSession(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
}
