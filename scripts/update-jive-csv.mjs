import { writeFile, rename } from "node:fs/promises";
import path from "node:path";

const LIVE_TAB_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1N2gdkRi3uEaJneHAZatIVZ5YEBXpBEkC-Kbt0eut2Lg/edit?gid=270769039#gid=270769039";
const LIVE_SHEET_NAME = "Live";
const OUTPUT_FILE = "jive.csv";

function parseGoogleSheetId(input) {
  const text = String(input || "").trim();
  const byPath = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (byPath?.[1]) return byPath[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return "";
}

async function fetchLiveCsv() {
  const spreadsheetId = parseGoogleSheetId(LIVE_TAB_SHEET_URL);
  if (!spreadsheetId) {
    throw new Error("Invalid Live-tab sheet ID.");
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(LIVE_SHEET_NAME)}`;
  const response = await fetch(csvUrl, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok || !text || !text.trim()) {
    throw new Error(`Failed to fetch Live tab CSV (HTTP ${response.status}).`);
  }
  if (String(text).trim().startsWith("<")) {
    throw new Error("Live tab CSV endpoint returned HTML (likely access issue).");
  }
  return text;
}

async function main() {
  const csvText = await fetchLiveCsv();
  const outputPath = path.join(process.cwd(), OUTPUT_FILE);
  const tempPath = `${outputPath}.tmp`;
  await writeFile(tempPath, csvText, "utf8");
  await rename(tempPath, outputPath);
  const rowCount = csvText.split(/\r?\n/).filter(Boolean).length - 1;
  console.log(
    JSON.stringify({
      ok: true,
      file: OUTPUT_FILE,
      updatedAt: new Date().toISOString(),
      estimatedRows: Math.max(0, rowCount),
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error?.message || "Unable to update jive.csv",
      updatedAt: new Date().toISOString(),
    })
  );
  process.exit(1);
});
