import { createRequire } from "node:module";
import { NextResponse } from "next/server";

const require = createRequire(import.meta.url);
const {
  CREATIVE_DIRECTORS,
  normalizeForKey,
  normalizeAssetId,
  normalizeAcdName,
  normalizeCdName,
  normalizeUrl,
  convertImagesToMinutes,
  round4,
  shiftDate,
  supabaseFetchAll,
  todayInIST,
} = require("../../../lib/ops/cjs/_lib.cjs");
const { fetchAcdSyncStatus, LIVE_SOURCE_CUTOFF_DATE } = require("../../../lib/ops/cjs/_acd-live-sync-lib.cjs");

const ACD_TABLE = "acd_productivity";
const FAILURES_TABLE = "acd_live_sync_failures";
const LIVE_TAB_DATA_SOURCE = "live_tab_sync";
const EMPTY_ACD_MESSAGE = "No valid ACD output data available yet from Live tab sync.";

function isGaAssetCode(value) {
  const key = normalizeForKey(normalizeAssetId(value));
  return key.startsWith("ga") || key.startsWith("gi");
}

function isTrackedCreativeDirector(value) {
  return CREATIVE_DIRECTORS.includes(normalizeCdName(value));
}

function isMissingDataSourceColumnError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("data_source") && (message.includes("column") || message.includes("does not exist"));
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

function filterRowsFromLiveSyncCutoff(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const createdDate = String(row && row.created_at ? row.created_at : "").slice(0, 10);
    return Boolean(createdDate) && createdDate >= LIVE_SOURCE_CUTOFF_DATE;
  });
}

async function fetchAcdReportingRows() {
  try {
    const rows = await supabaseFetchAll(
      `${ACD_TABLE}?select=id,parent_asset_id,video_code,cd_name,acd_name,raw_acd_name,normalized_acd_name,work_date,image_url,created_at,data_source&data_source=eq.${encodeURIComponent(
        LIVE_TAB_DATA_SOURCE
      )}`
    );
    return {
      rows: (Array.isArray(rows) ? rows : []).filter(
        (row) => isGaAssetCode(row.video_code) && isTrackedCreativeDirector(row.cd_name)
      ),
      sourceFilterWarning: "",
    };
  } catch (error) {
    if (!isMissingDataSourceColumnError(error)) {
      throw error;
    }

    const fallbackRows = await supabaseFetchAll(
      `${ACD_TABLE}?select=id,parent_asset_id,video_code,cd_name,acd_name,raw_acd_name,normalized_acd_name,work_date,image_url,created_at`
    );
    return {
      rows: filterRowsFromLiveSyncCutoff(fallbackRows).filter(
        (row) => isGaAssetCode(row.video_code) && isTrackedCreativeDirector(row.cd_name)
      ),
      sourceFilterWarning:
        "data_source column is missing; using created_at fallback until migration 2026-03-11-acd-data-source.sql is applied.",
    };
  }
}

function getAcdName(row) {
  return normalizeAcdName(row.normalized_acd_name || row.acd_name || row.raw_acd_name);
}

function getScopeKey(row) {
  return normalizeAssetId(row.parent_asset_id) || normalizeAssetId(row.video_code);
}

function getGenerationKey(row) {
  const scopeKey = getScopeKey(row);
  const acdName = getAcdName(row);
  const imageUrl = normalizeUrl(row.image_url);
  if (!scopeKey || !acdName || !imageUrl) {
    return "";
  }
  return `${normalizeForKey(scopeKey)}|${normalizeForKey(acdName)}|${normalizeForKey(imageUrl)}`;
}

function getLineageKey(row) {
  const scopeKey = getScopeKey(row);
  const acdName = getAcdName(row);
  if (!scopeKey || !acdName) {
    return "";
  }
  return `${normalizeForKey(scopeKey)}|${normalizeForKey(acdName)}`;
}

function addRollingSummary(map, name, totalMinutes, totalImages) {
  if (!name) {
    return;
  }

  if (!map.has(name)) {
    map.set(name, { name, totalMinutes: 0, totalImages: 0 });
  }

  const target = map.get(name);
  target.totalMinutes += Number(totalMinutes || 0);
  target.totalImages += Number(totalImages || 0);
}

function mapRollingRows(map, fieldName) {
  return Array.from(map.values())
    .map((row) => ({
      [fieldName]: row.name,
      totalMinutes: round4(row.totalMinutes),
      totalImages: Number(row.totalImages || 0),
    }))
    .sort((a, b) => {
      const byMinutes = Number(b.totalMinutes || 0) - Number(a.totalMinutes || 0);
      if (byMinutes !== 0) return byMinutes;
      return String(a[fieldName] || "").localeCompare(String(b[fieldName] || ""));
    });
}

function isWithinWindow(dateKey, startDateKey, endDateKey) {
  return Boolean(dateKey) && Boolean(startDateKey) && Boolean(endDateKey) && dateKey >= startDateKey && dateKey <= endDateKey;
}

async function fetchLatestLiveDate() {
  try {
    const rows = await supabaseFetchAll(
      `acd_live_sync_rows?select=live_date&eligible=eq.true&successful_links=gt.0&order=live_date.desc&limit=1`
    );
    if (Array.isArray(rows) && rows.length > 0) {
      return String(rows[0].live_date || "").slice(0, 10);
    }
  } catch {
    // Fall through to empty
  }
  return "";
}

function aggregateAcdDeltaMetrics(rows, anchorDate) {
  const input = Array.isArray(rows) ? [...rows] : [];
  const today = todayInIST();
  input.sort((a, b) => {
    const createdCompare = String(a.created_at || "").localeCompare(String(b.created_at || ""));
    if (createdCompare !== 0) return createdCompare;
    const dateCompare = String(a.work_date || "").localeCompare(String(b.work_date || ""));
    if (dateCompare !== 0) return dateCompare;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  const seenImages = new Set();
  const lineageImageCounts = new Map();
  const dailyMap = new Map();
  let latestWorkDate = "";

  for (const row of input) {
    const workDate = String(row.work_date || "").slice(0, 10);
    const cdName = normalizeCdName(row.cd_name);
    const acdName = getAcdName(row);
    const generationKey = getGenerationKey(row);
    const lineageKey = getLineageKey(row);

    if (!workDate || !cdName || !acdName || !generationKey || !lineageKey || (today && workDate > today)) {
      continue;
    }

    if (seenImages.has(generationKey)) {
      continue;
    }
    seenImages.add(generationKey);

    const existingImages = Number(lineageImageCounts.get(lineageKey) || 0);
    const nextImages = existingImages + 1;
    const deltaMinutes = convertImagesToMinutes(nextImages) - convertImagesToMinutes(existingImages);
    lineageImageCounts.set(lineageKey, nextImages);

    const dailyKey = `${workDate}|${normalizeForKey(cdName)}|${normalizeForKey(acdName)}`;
    if (!dailyMap.has(dailyKey)) {
      dailyMap.set(dailyKey, {
        workDate,
        cdName,
        acdName,
        totalImages: 0,
        totalMinutes: 0,
      });
    }

    const target = dailyMap.get(dailyKey);
    target.totalImages += 1;
    target.totalMinutes += deltaMinutes;

    // The Production heading uses the latest valid synced work_date that survived
    // live_tab_sync filtering, validation, dedupe, and aggregation.
    if (!latestWorkDate || workDate > latestWorkDate) {
      latestWorkDate = workDate;
    }
  }

  const dailyRows = Array.from(dailyMap.values())
    .map((row) => ({
      workDate: row.workDate,
      cdName: row.cdName,
      acdName: row.acdName,
      totalImages: Number(row.totalImages || 0),
      totalMinutes: round4(row.totalMinutes),
    }))
    .sort(
      (a, b) =>
        String(b.workDate || "").localeCompare(String(a.workDate || "")) ||
        String(a.acdName || "").localeCompare(String(b.acdName || "")) ||
        String(a.cdName || "").localeCompare(String(b.cdName || ""))
    );

  const rollingAnchor = anchorDate || latestWorkDate;

  if (!latestWorkDate && !rollingAnchor) {
    return {
      today: todayInIST(),
      latestWorkDate: "",
      dailyRows: [],
      rolling7Rows: [],
      rolling14Rows: [],
      rolling30Rows: [],
      rolling7CdRows: [],
      rolling14CdRows: [],
      rolling30CdRows: [],
    };
  }

  const start7 = shiftDate(rollingAnchor, -6);
  const start14 = shiftDate(rollingAnchor, -13);
  const start30 = shiftDate(rollingAnchor, -29);
  const rolling7Acd = new Map();
  const rolling14Acd = new Map();
  const rolling30Acd = new Map();
  const rolling7Cd = new Map();
  const rolling14Cd = new Map();
  const rolling30Cd = new Map();

  for (const row of dailyRows) {
    if (isWithinWindow(row.workDate, start30, latestWorkDate)) {
      addRollingSummary(rolling30Acd, row.acdName, row.totalMinutes, row.totalImages);
      addRollingSummary(rolling30Cd, row.cdName, row.totalMinutes, row.totalImages);
    }

    if (isWithinWindow(row.workDate, start14, latestWorkDate)) {
      addRollingSummary(rolling14Acd, row.acdName, row.totalMinutes, row.totalImages);
      addRollingSummary(rolling14Cd, row.cdName, row.totalMinutes, row.totalImages);
    }

    if (isWithinWindow(row.workDate, start7, latestWorkDate)) {
      addRollingSummary(rolling7Acd, row.acdName, row.totalMinutes, row.totalImages);
      addRollingSummary(rolling7Cd, row.cdName, row.totalMinutes, row.totalImages);
    }
  }

  return {
    today: todayInIST(),
    latestWorkDate,
    latestLiveDate: rollingAnchor,
    dailyRows,
    rolling7Rows: mapRollingRows(rolling7Acd, "acdName"),
    rolling14Rows: mapRollingRows(rolling14Acd, "acdName"),
    rolling30Rows: mapRollingRows(rolling30Acd, "acdName"),
    rolling7CdRows: mapRollingRows(rolling7Cd, "cdName"),
    rolling14CdRows: mapRollingRows(rolling14Cd, "cdName"),
    rolling30CdRows: mapRollingRows(rolling30Cd, "cdName"),
  };
}

function buildTrackedTeams(rows) {
  const teamsByCd = new Map(
    CREATIVE_DIRECTORS.map((cdName) => [
      cdName,
      {
        cdName,
        acdNames: new Set(),
      },
    ])
  );
  const today = todayInIST();

  for (const row of Array.isArray(rows) ? rows : []) {
    const cdName = normalizeCdName(row.cd_name);
    const acdName = getAcdName(row);
    const workDate = String(row.work_date || "").slice(0, 10);
    if (!teamsByCd.has(cdName) || !acdName || (today && workDate && workDate > today)) {
      continue;
    }
    teamsByCd.get(cdName).acdNames.add(acdName);
  }

  return Array.from(teamsByCd.values()).map((team) => ({
    cdName: team.cdName,
    acdNames: Array.from(team.acdNames).sort((a, b) => a.localeCompare(b)),
  }));
}

async function fetchFailureReasonRows() {
  const rows = await supabaseFetchAll(
    `${FAILURES_TABLE}?select=failure_reason,live_date,asset_code,cd_name&live_date=gte.${encodeURIComponent(
      LIVE_SOURCE_CUTOFF_DATE
    )}`
  );
  const counts = new Map();

  for (const row of (Array.isArray(rows) ? rows : []).filter(
    (item) => isGaAssetCode(item.asset_code) && isTrackedCreativeDirector(item.cd_name)
  )) {
    const reason = String(row.failure_reason || "").trim() || "unknown";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([failureReason, count]) => ({
      failureReason,
      count: Number(count || 0),
    }))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || a.failureReason.localeCompare(b.failureReason));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [reporting, latestLiveDate] = await Promise.all([
      fetchAcdReportingRows(),
      fetchLatestLiveDate(),
    ]);
    const metrics = aggregateAcdDeltaMetrics(reporting.rows || [], latestLiveDate || undefined);
    const trackedTeams = buildTrackedTeams(reporting.rows || []);

    let syncStatus = {
      schemaReady: false,
      cutoffDate: LIVE_SOURCE_CUTOFF_DATE,
      latestRun: null,
      adherenceRows: [],
      adherenceIssueRows: [],
      totalFailedSheets: 0,
      syncError:
        "ACD live sync tables are not configured. Run migration 2026-03-11-acd-live-sync.sql in Supabase SQL Editor.",
      sourceFilterWarning: reporting.sourceFilterWarning || "",
    };

    try {
      const status = await fetchAcdSyncStatus();
      syncStatus = {
        schemaReady: true,
        ...status,
        sourceFilterWarning: reporting.sourceFilterWarning || "",
      };
    } catch (error) {
      if (!isSchemaError(error)) {
        syncStatus = {
          schemaReady: false,
          cutoffDate: LIVE_SOURCE_CUTOFF_DATE,
          latestRun: null,
          adherenceRows: [],
          adherenceIssueRows: [],
          totalFailedSheets: 0,
          syncError: error.message || "Failed to load ACD sync status.",
          sourceFilterWarning: reporting.sourceFilterWarning || "",
        };
      }
    }

    let failureReasonRows = [];
    try {
      failureReasonRows = await fetchFailureReasonRows();
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      emptyStateMessage: EMPTY_ACD_MESSAGE,
      ...metrics,
      trackedTeams,
      syncStatus,
      failureReasonRows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to load ACD metrics." },
      { status: error.statusCode || 500 }
    );
  }
}
