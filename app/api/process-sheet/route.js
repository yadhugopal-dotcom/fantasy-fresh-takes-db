import { createRequire } from "node:module";
import { runLegacyHandler } from "../../../lib/ops/run-legacy-handler.js";

const require = createRequire(import.meta.url);
const handler = require("../../../lib/ops/cjs/process-sheet.cjs");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return runLegacyHandler(handler, request);
}
