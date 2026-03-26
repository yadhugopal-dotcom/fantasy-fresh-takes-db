import { createRequire } from "node:module";
import { runLegacyHandler } from "../../../lib/ops/run-legacy-handler.js";
import { hasEditSession } from "../../../lib/auth.js";

const require = createRequire(import.meta.url);
const handler = require("../../../lib/ops/cjs/acd-live-sync.cjs");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  return runLegacyHandler(handler, request);
}

export async function POST(request) {
  if (!hasEditSession(request)) {
    return Response.json({ ok: false, error: "Unlock edit mode first to run sync." }, { status: 401 });
  }

  return runLegacyHandler(handler, request);
}
