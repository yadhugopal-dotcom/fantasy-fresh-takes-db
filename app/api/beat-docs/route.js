import { NextResponse } from "next/server";
import { listBeatDocs } from "../../../lib/beat-docs.js";

const NOT_CONNECTED_MESSAGE = "Beat docs not connected yet";

export async function GET() {
  try {
    const payload = await listBeatDocs();
    return NextResponse.json({
      connected: true,
      ...payload,
    });
  } catch (error) {
    const message = String(error?.message || "");
    const isMissingConfig =
      message.includes("GOOGLE_SERVICE_ACCOUNT_KEY") ||
      message.includes("client_email") ||
      message.includes("private_key");

    if (isMissingConfig) {
      return NextResponse.json({
        connected: false,
        items: [],
        message: NOT_CONNECTED_MESSAGE,
      });
    }

    return NextResponse.json(
      {
        connected: false,
        items: [],
        message: "Unable to load beat docs right now.",
      },
      { status: 500 }
    );
  }
}
