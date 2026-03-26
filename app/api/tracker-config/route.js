import { NextResponse } from "next/server";
import { hasEditSession } from "../../../lib/auth.js";
import { readJsonObject, writeJsonObject } from "../../../lib/storage.js";
import { mergeWriterConfig, serializeWriterConfig } from "../../../lib/tracker-data.js";

const CONFIG_PATH = "config/writer-config.json";

export async function GET() {
  try {
    const storedConfig = await readJsonObject(CONFIG_PATH);
    const config = mergeWriterConfig(storedConfig);

    return NextResponse.json({
      config,
      updatedAt: storedConfig?.updatedAt || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to load writer config." }, { status: 500 });
  }
}

export async function PUT(request) {
  if (!hasEditSession(request)) {
    return NextResponse.json({ error: "Unlock edit mode before saving writer names." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const config = serializeWriterConfig(body.config || body);
    const payload = {
      updatedAt: new Date().toISOString(),
      ...config,
    };

    await writeJsonObject(CONFIG_PATH, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to save writer config." }, { status: 500 });
  }
}
