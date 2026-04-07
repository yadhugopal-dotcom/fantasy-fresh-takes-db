const { syncAcdFromLive } = require("./_acd-live-sync-lib.cjs");

function json(res, status, body) {
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .send(JSON.stringify(body));
}

function getRequestOrigin(req) {
  const forwardedProtoRaw = req.headers["x-forwarded-proto"];
  const forwardedHostRaw = req.headers["x-forwarded-host"];
  const hostRaw = req.headers.host;

  const proto = String(Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw || "https")
    .split(",")[0]
    .trim();
  const host = String(Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw || hostRaw || "")
    .split(",")[0]
    .trim();

  if (host) {
    return `${proto || "https"}://${host}`;
  }

  const envOrigin = String(process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (envOrigin) return envOrigin.replace(/\/$/, "");

  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return "";
}

function buildSchemaErrorMessage() {
  return "ACD live sync tables are not configured. Run migration 2026-03-11-acd-live-sync.sql in Supabase SQL Editor.";
}

function isSchemaError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return (
    message.includes("acd_live_sync_rows") ||
    message.includes("acd_live_sync_failures") ||
    message.includes("acd_live_sync_runs") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const origin = getRequestOrigin(req);
    if (!origin) {
      json(res, 500, { ok: false, error: "Could not resolve application origin for sync processing." });
      return;
    }

    const result = await syncAcdFromLive({ origin });
    json(res, 200, {
      ok: true,
      message: "ACD live sync completed.",
      ...result
    });
  } catch (error) {
    if (isSchemaError(error)) {
      json(res, 200, {
        ok: true,
        schemaReady: false,
        error: buildSchemaErrorMessage(),
        result: null
      });
      return;
    }

    json(res, error.statusCode || 500, {
      ok: false,
      error: error.message || "ACD live sync failed."
    });
  }
};
