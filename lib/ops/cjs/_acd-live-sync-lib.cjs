const {
  makeError,
  supabaseRequest,
  supabaseFetchAll,
  chunk,
  CREATIVE_DIRECTORS,
  normalizeAssetId,
  normalizeAcdName,
  normalizeCdName,
  normalizeUrl,
  normalizeForKey,
  parseGoogleSheetId,
  parseWorkDate,
  isTruthyYes
} = require("./_lib.cjs");
const XLSX = require("xlsx");

const LIVE_SOURCE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1N2gdkRi3uEaJneHAZatIVZ5YEBXpBEkC-Kbt0eut2Lg/edit?gid=270769039#gid=270769039";
const LIVE_SOURCE_TAB = "Live";
const LIVE_SOURCE_CUTOFF_DATE = "2026-03-16";

const SYNC_ROWS_TABLE = "acd_live_sync_rows";
const SYNC_FAILURES_TABLE = "acd_live_sync_failures";
const SYNC_RUNS_TABLE = "acd_live_sync_runs";
const ACD_TABLE = "acd_productivity";
const LIVE_TAB_DATA_SOURCE = "live_tab_sync";

const LIVE_COL_INDEX = {
  assetCode: 1, // B
  baseAssetCode: 16, // Q
  cdName: 27, // AB
  newCanvasGenerated: 42, // AQ
  imageSheetLinks: 51, // AZ
  liveDate: 75 // BX
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isGaAssetCode(value) {
  const key = normalizeForKey(normalizeAssetId(value));
  return key.startsWith("ga") || key.startsWith("gi");
}

function isTrackedCreativeDirector(value) {
  return CREATIVE_DIRECTORS.includes(normalizeCdName(value));
}

function looksLikeHtml(text) {
  const start = String(text || "").trim().slice(0, 40).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function isValidYmd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseCompactDateDdmmyyyy(text) {
  const value = String(text || "").trim().replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(value)) return "";
  const d = Number(value.slice(0, 2));
  const m = Number(value.slice(2, 4));
  const y = Number(value.slice(4, 8));
  if (!isValidYmd(y, m, d)) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseCompactDateYyyymmdd(text) {
  const value = String(text || "").trim().replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(value)) return "";
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  if (!isValidYmd(y, m, d)) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseLiveDate(rawValue) {
  if (rawValue instanceof Date || typeof rawValue === "number") {
    const directParsed = parseWorkDate(rawValue);
    if (directParsed) return directParsed;
  }

  const text = normalizeText(rawValue);
  if (!text) return "";

  const ddmmyyyy = parseCompactDateDdmmyyyy(text);
  if (ddmmyyyy) return ddmmyyyy;

  const yyyymmdd = parseCompactDateYyyymmdd(text);
  if (yyyymmdd) return yyyymmdd;

  return parseWorkDate(text);
}

function extractSheetLinks(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const links = [];
  const directMatches = text.match(/https?:\/\/[^\s,;]+/gi) || [];
  links.push(...directMatches);
  const docsMatches = text.match(/\bdocs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+[^\s,;]*/gi) || [];
  links.push(...docsMatches);

  const quotedMatches = text.match(/"((?:https?:\/\/|www\.)[^"]+)"/gi) || [];
  for (const match of quotedMatches) {
    const value = String(match || "").replace(/^"+|"+$/g, "");
    if (value) links.push(value);
  }

  const cleaned = links
    .map((value) => String(value || "").trim().replace(/[)\],.;]+$/g, ""))
    .map((value) => (/^www\./i.test(value) ? `https://${value}` : value))
    .filter(Boolean);

  return Array.from(new Set(cleaned));
}

function cellToDisplayValue(cell) {
  if (!cell) return "";
  if (cell.w !== undefined && cell.w !== null) return cell.w;
  if (cell.v === undefined || cell.v === null) return "";
  return cell.v;
}

function normalizeExtractedLinks(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim().replace(/[)\],.;]+$/g, ""))
        .map((value) => (/^www\./i.test(value) ? `https://${value}` : value))
        .map((value) => (/^docs\.google\.com\//i.test(value) ? `https://${value}` : value))
        .filter(Boolean)
    )
  );
}

function extractLinksFromHtml(html) {
  const text = String(html || "");
  if (!text) return [];

  const links = [];
  const hrefMatches = text.match(/href\s*=\s*["']([^"']+)["']/gi) || [];
  for (const match of hrefMatches) {
    const href = match.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href && href[1]) {
      links.push(href[1]);
    }
  }

  const directMatches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  links.push(...directMatches);

  return links;
}

function quoteForPostgrestIn(value) {
  const raw = String(value || "").trim();
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function mapKey(...parts) {
  return parts.map((part) => normalizeForKey(part)).join("|");
}

function extractSheetLinksFromCell(rawValue, cell) {
  const links = [];
  links.push(...extractSheetLinks(rawValue));

  const cellLinkTarget = cell && cell.l ? cell.l.Target || (cell.l.Rel && cell.l.Rel.Target) : "";
  if (cellLinkTarget) {
    links.push(String(cellLinkTarget));
  }

  if (cell && typeof cell.h === "string" && cell.h.trim()) {
    links.push(...extractLinksFromHtml(cell.h));
  }

  const formula = cell && typeof cell.f === "string" ? cell.f : "";
  if (formula) {
    const formulaLinks = formula.match(/https?:\/\/[^\s)",]+/gi) || [];
    links.push(...formulaLinks);
    const formulaDocsLinks = formula.match(/\bdocs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+[^\s)",]*/gi) || [];
    links.push(...formulaDocsLinks);
  }

  return normalizeExtractedLinks(links);
}

function mapFailureReason(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("not accessible")) return "sheet_inaccessible";
  if (lower.includes("tab not found")) return "missing_final_image_sheet_tab";
  if (lower.includes("required columns")) return "required_columns_missing";
  if (lower.includes("work date") && lower.includes("parse")) return "work_date_parse_failure";
  if (lower.includes("no valid rows")) return "no_valid_rows_found";
  if (lower.includes("invalid creative director")) return "invalid_creative_director";
  if (lower.includes("video code is required")) return "missing_asset_code";
  return "other_format_issue";
}

function isMissingDataSourceColumnError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("data_source") && (message.includes("column") || message.includes("does not exist"));
}

function filterRowsFromLiveSyncCutoff(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const createdDate = String(row && row.created_at ? row.created_at : "").slice(0, 10);
    return Boolean(createdDate) && createdDate >= LIVE_SOURCE_CUTOFF_DATE;
  });
}

async function fetchLiveTabRows() {
  const spreadsheetId = parseGoogleSheetId(LIVE_SOURCE_SHEET_URL);
  if (!spreadsheetId) {
    throw makeError(500, "ACD live source sheet ID is invalid.");
  }

  const xlsxUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const response = await fetch(xlsxUrl, { cache: "no-store", redirect: "follow" });
  const arrayBuffer = await response.arrayBuffer();
  const binary = Buffer.from(arrayBuffer);

  if (!response.ok) {
    const text = binary.toString("utf8");
    const lower = String(text || "").toLowerCase();
    if (lower.includes("unable to parse range") || lower.includes("does not exist")) {
      throw makeError(400, 'Live source tab "Live" not found.');
    }
    throw makeError(400, "Live source sheet is not accessible.");
  }

  if (!binary || binary.length === 0 || looksLikeHtml(binary.toString("utf8"))) {
    throw makeError(400, "Live source sheet is not accessible.");
  }

  const workbook = XLSX.read(binary, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellText: true
  });
  const worksheet = workbook.Sheets[LIVE_SOURCE_TAB];
  if (!worksheet) {
    throw makeError(400, 'Live source tab "Live" not found.');
  }

  const rangeRef = worksheet["!ref"];
  if (!rangeRef) {
    return {
      spreadsheetId,
      rows: [],
      rowMetaByIndex: new Map()
    };
  }

  const range = XLSX.utils.decode_range(rangeRef);
  const rows = [];
  const rowMetaByIndex = new Map();

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = worksheet[cellRef];
      row[colIndex] = cellToDisplayValue(cell);
    }
    rows.push(row);

    const azCellRef = XLSX.utils.encode_cell({ r: rowIndex, c: LIVE_COL_INDEX.imageSheetLinks });
    const azCell = worksheet[azCellRef];
    const rawAzValue = row[LIVE_COL_INDEX.imageSheetLinks];
    const azLinks = extractSheetLinksFromCell(rawAzValue, azCell);

    rowMetaByIndex.set(rowIndex + 1, {
      imageSheetLinks: azLinks
    });
  }

  return {
    spreadsheetId,
    rows,
    rowMetaByIndex
  };
}

async function getProcessedEligibleRowIndexes(sheetSource) {
  const rows = await supabaseFetchAll(
    `${SYNC_ROWS_TABLE}?select=live_row_index&sheet_source=eq.${encodeURIComponent(
      sheetSource
    )}&eligible=eq.true&successful_links=gt.0&failed_links=eq.0`
  );

  const set = new Set();
  for (const row of rows || []) {
    const parsed = Number(row && row.live_row_index ? row.live_row_index : 0);
    if (Number.isFinite(parsed) && parsed > 0) {
      set.add(parsed);
    }
  }
  return set;
}

async function callProcessSheetApi(origin, payload) {
  const url = `${String(origin || "").replace(/\/$/, "")}/api/process-sheet`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.ok) {
    const error = makeError(response.status || 400, data.error || "Failed to process image sheet.");
    error.details = data.details || null;
    throw error;
  }

  return data;
}

async function insertSyncRows(rows) {
  for (const part of chunk(rows, 500)) {
    await supabaseRequest(`${SYNC_ROWS_TABLE}?on_conflict=sheet_source,live_row_index`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: part
    });
  }
}

async function insertFailureRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  for (const part of chunk(rows, 500)) {
    await supabaseRequest(`${SYNC_FAILURES_TABLE}?on_conflict=sheet_source,live_row_index,image_sheet_link`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: part
    });
  }
}

async function deleteFailureRows(sheetSource, liveRowIndexes) {
  const safeIndexes = Array.from(
    new Set(
      (Array.isArray(liveRowIndexes) ? liveRowIndexes : [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  if (!safeIndexes.length) {
    return;
  }

  for (const part of chunk(safeIndexes, 100)) {
    await supabaseRequest(
      `${SYNC_FAILURES_TABLE}?sheet_source=eq.${encodeURIComponent(sheetSource)}&live_row_index=in.(${part.join(",")})`,
      {
        method: "DELETE",
        headers: {
          Prefer: "return=minimal"
        }
      }
    );
  }
}

async function insertSyncRun(row) {
  await supabaseRequest(SYNC_RUNS_TABLE, {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
    body: [row]
  });
}

async function syncAcdFromLive(options = {}) {
  const origin = String(options.origin || "").trim();
  if (!origin) {
    throw makeError(500, "Sync origin URL is required.");
  }

  const fetchedAt = new Date().toISOString();
  const { spreadsheetId, rows, rowMetaByIndex } = await fetchLiveTabRows();
  const sheetSource = `${spreadsheetId}:${LIVE_SOURCE_TAB}`;
  const processedEligibleRowIndexes = await getProcessedEligibleRowIndexes(sheetSource);

  const syncRows = [];
  const failureRows = [];
  const eligibilityDebugRows = [];
  const reconciledFailureRowIndexes = new Set();

  let processedLiveRows = 0;
  let eligibleLiveRows = 0;
  let sheetLinksAttempted = 0;
  let sheetLinksSucceeded = 0;
  let sheetLinksFailed = 0;
  let skippedNonGaAsset = 0;
  let skippedUntrackedCd = 0;
  let skippedOldDate = 0;
  let skippedInvalidBxParse = 0;
  let skippedMissingAz = 0;
  let skippedAlreadyProcessed = 0;

  // Live tab has two non-data rows (section labels + header labels).
  for (let i = 2; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const liveRowIndex = i + 1;

    const assetCode = normalizeAssetId(row[LIVE_COL_INDEX.assetCode]);
    const baseAssetCode = normalizeAssetId(row[LIVE_COL_INDEX.baseAssetCode]);
    const cdName = normalizeCdName(row[LIVE_COL_INDEX.cdName]);
    const newCanvasGenerated = isTruthyYes(row[LIVE_COL_INDEX.newCanvasGenerated]);
    const rawBxValue = row[LIVE_COL_INDEX.liveDate];
    const rawAzValue = row[LIVE_COL_INDEX.imageSheetLinks];
    const imageSheetRaw = String(rawAzValue || "").trim();
    const rowMeta = rowMetaByIndex.get(liveRowIndex) || {};
    const imageSheetLinks =
      Array.isArray(rowMeta.imageSheetLinks) && rowMeta.imageSheetLinks.length > 0
        ? rowMeta.imageSheetLinks
        : extractSheetLinks(imageSheetRaw);
    const hasImageSheetLink = imageSheetLinks.length > 0;
    const liveDate = parseLiveDate(rawBxValue);
    const alreadyProcessed = processedEligibleRowIndexes.has(liveRowIndex);
    const isGaAsset = isGaAssetCode(assetCode);
    const isTrackedCd = isTrackedCreativeDirector(cdName);

    if (isGaAsset && isTrackedCd) {
      processedLiveRows += 1;
    }

    if (isGaAsset && isTrackedCd && liveDate && liveDate >= LIVE_SOURCE_CUTOFF_DATE && hasImageSheetLink) {
      reconciledFailureRowIndexes.add(liveRowIndex);
    }

    let exclusionReason = "";
    let eligible = false;
    if (!isGaAsset) {
      exclusionReason = "non_GA_asset";
      skippedNonGaAsset += 1;
    } else if (!isTrackedCd) {
      exclusionReason = "untracked_cd";
      skippedUntrackedCd += 1;
    } else if (!liveDate) {
      exclusionReason = "invalid_BX_parse";
      skippedInvalidBxParse += 1;
    } else if (liveDate < LIVE_SOURCE_CUTOFF_DATE) {
      exclusionReason = "old_date";
      skippedOldDate += 1;
    } else if (!hasImageSheetLink) {
      exclusionReason = "missing_AZ";
      skippedMissingAz += 1;
    } else if (alreadyProcessed) {
      exclusionReason = "already_processed";
      skippedAlreadyProcessed += 1;
    } else {
      eligible = true;
      exclusionReason = "";
    }

    const rawBxText = normalizeText(rawBxValue);
    const rawBxDigits = rawBxText.replace(/[^0-9]/g, "");
    const looksLikeMarch2026Text =
      /\bmar(?:ch)?\b/i.test(rawBxText) &&
      (/\b2026\b/.test(rawBxText) || rawBxDigits.includes("2026"));
    const isMarch2026Candidate =
      (liveDate && liveDate >= "2026-03-01") ||
      rawBxDigits.includes("202603") ||
      rawBxDigits.includes("032026") ||
      looksLikeMarch2026Text;

    if (isMarch2026Candidate && eligibilityDebugRows.length < 30) {
      const debugRow = {
        row_index: liveRowIndex,
        raw_BX_value: String(rawBxValue === undefined || rawBxValue === null ? "" : rawBxValue),
        parsed_BX_value: liveDate || "",
        raw_AZ_value: String(rawAzValue === undefined || rawAzValue === null ? "" : rawAzValue),
        has_image_sheet_link: hasImageSheetLink,
        extracted_image_sheet_links: imageSheetLinks,
        already_processed: alreadyProcessed,
        final_eligible: eligible,
        exclusion_reason: exclusionReason
      };
      eligibilityDebugRows.push(debugRow);
      console.log(`[acd-live-eligibility-row] ${JSON.stringify(debugRow)}`);
    }

    let processedLinks = 0;
    let successfulLinks = 0;
    let failedLinks = 0;

    if (eligible) {
      eligibleLiveRows += 1;

      for (const imageSheetLink of imageSheetLinks) {
        processedLinks += 1;
        sheetLinksAttempted += 1;

        if (!assetCode) {
          failedLinks += 1;
          sheetLinksFailed += 1;
          failureRows.push({
            sheet_source: sheetSource,
            live_row_index: liveRowIndex,
            live_date: liveDate,
            asset_code: assetCode || "",
            base_asset_code: baseAssetCode || null,
            cd_name: cdName || null,
            image_sheet_link: imageSheetLink,
            failure_reason: "missing_asset_code"
          });
          continue;
        }

        try {
          await callProcessSheetApi(origin, {
            cdName,
            videoCode: assetCode,
            baseAssetId: baseAssetCode,
            sheetUrl: imageSheetLink,
            newCanvasGenerated: false,
            dataSource: "live_tab_sync"
          });
          successfulLinks += 1;
          sheetLinksSucceeded += 1;
        } catch (error) {
          failedLinks += 1;
          sheetLinksFailed += 1;
          const category = mapFailureReason(error.message || "");
          const reason = `${category}: ${String(error.message || "processing_failed").trim()}`;
          failureRows.push({
            sheet_source: sheetSource,
            live_row_index: liveRowIndex,
            live_date: liveDate || null,
            asset_code: assetCode || "",
            base_asset_code: baseAssetCode || null,
            cd_name: cdName || null,
            image_sheet_link: imageSheetLink,
            failure_reason: reason
          });
        }
      }

      processedEligibleRowIndexes.add(liveRowIndex);
      syncRows.push({
        sheet_source: sheetSource,
        live_row_index: liveRowIndex,
        live_date: liveDate || null,
        asset_code: assetCode || "",
        base_asset_code: baseAssetCode || null,
        cd_name: cdName || null,
        new_canvas_generated: Boolean(newCanvasGenerated),
        image_sheet_links: imageSheetRaw || null,
        eligible: true,
        processed_links: processedLinks,
        successful_links: successfulLinks,
        failed_links: failedLinks
      });
    }
  }

  await deleteFailureRows(sheetSource, Array.from(reconciledFailureRowIndexes));
  await insertSyncRows(syncRows);
  await insertFailureRows(failureRows);
  await insertSyncRun({
    sheet_source: sheetSource,
    processed_live_rows: processedLiveRows,
    eligible_live_rows: eligibleLiveRows,
    sheet_links_attempted: sheetLinksAttempted,
    sheet_links_succeeded: sheetLinksSucceeded,
    sheet_links_failed: sheetLinksFailed
  });

  const lastProcessedRowIndex = syncRows.reduce((max, row) => Math.max(max, Number(row.live_row_index || 0)), 0);
  const eligibilityCounts = {
    skipped_non_GA_asset: skippedNonGaAsset,
    skipped_untracked_cd: skippedUntrackedCd,
    skipped_old_date: skippedOldDate,
    skipped_invalid_BX_parse: skippedInvalidBxParse,
    skipped_missing_AZ: skippedMissingAz,
    skipped_already_processed: skippedAlreadyProcessed
  };

  console.log(
    `[acd-live-eligibility-summary] ${JSON.stringify({
      sheetSource,
      processedLiveRows,
      eligibleLiveRows,
      ...eligibilityCounts
    })}`
  );

  return {
    sheetSource,
    spreadsheetId,
    tabName: LIVE_SOURCE_TAB,
    fetchedAt,
    cutoffDate: LIVE_SOURCE_CUTOFF_DATE,
    lastProcessedRowIndex,
    processedLiveRows,
    eligibleLiveRows,
    skippedOldDate,
    skippedInvalidBxParse,
    skippedMissingAz,
    skippedAlreadyProcessed,
    sheetLinksAttempted,
    sheetLinksSucceeded,
    sheetLinksFailed,
    failureRowsLogged: failureRows.length,
    eligibilityDiagnostics: {
      counts: eligibilityCounts,
      sampleRows: eligibilityDebugRows
    }
  };
}

async function fetchAcdSyncStatus() {
  const runs = await supabaseRequest(`${SYNC_RUNS_TABLE}?select=*&order=created_at.desc&limit=1`);
  const latestRun = Array.isArray(runs) && runs.length > 0 ? runs[0] : null;
  const syncRows = await supabaseFetchAll(
    `${SYNC_ROWS_TABLE}?select=live_row_index,asset_code,cd_name,processed_links,successful_links,failed_links,live_date&live_date=gte.${encodeURIComponent(
      LIVE_SOURCE_CUTOFF_DATE
    )}`
  );

  const failureRows = await supabaseFetchAll(
    `${SYNC_FAILURES_TABLE}?select=cd_name,asset_code,image_sheet_link,live_date,failure_reason&live_date=gte.${encodeURIComponent(
      LIVE_SOURCE_CUTOFF_DATE
    )}`
  );
  const safeFailureRows = (Array.isArray(failureRows) ? failureRows : []).filter(
    (row) => isGaAssetCode(row.asset_code) && isTrackedCreativeDirector(row.cd_name)
  );

  const failureAssetCodes = Array.from(
    new Set(
      safeFailureRows
        .map((row) => normalizeAssetId(row.asset_code))
        .filter((value) => Boolean(value))
    )
  );

  const acdLookupRows = [];
  for (const assetChunk of chunk(failureAssetCodes, 50)) {
    if (!assetChunk.length) continue;
    const inValue = assetChunk.map((value) => quoteForPostgrestIn(value)).join(",");
    const basePath = `${ACD_TABLE}?select=video_code,cd_name,normalized_acd_name,acd_name,created_at&video_code=in.(${encodeURIComponent(
      inValue
    )})`;
    let rows;
    try {
      rows = await supabaseFetchAll(
        `${basePath}&data_source=eq.${encodeURIComponent(LIVE_TAB_DATA_SOURCE)}`
      );
    } catch (error) {
      if (!isMissingDataSourceColumnError(error)) {
        throw error;
      }
      rows = filterRowsFromLiveSyncCutoff(await supabaseFetchAll(basePath));
    }
    if (Array.isArray(rows) && rows.length) {
      acdLookupRows.push(...rows.filter((row) => isTrackedCreativeDirector(row.cd_name)));
    }
  }

  const acdByVideoAndCd = new Map();
  const acdByVideo = new Map();

  for (const row of acdLookupRows) {
    const videoCode = normalizeAssetId(row.video_code);
    const cdName = normalizeCdName(row.cd_name);
    const acdName = normalizeAcdName(row.normalized_acd_name || row.acd_name);
    if (!videoCode || !acdName) continue;

    const byCdKey = mapKey(videoCode, cdName);
    if (!acdByVideoAndCd.has(byCdKey)) acdByVideoAndCd.set(byCdKey, new Set());
    acdByVideoAndCd.get(byCdKey).add(acdName);

    const byVideoKey = mapKey(videoCode);
    if (!acdByVideo.has(byVideoKey)) acdByVideo.set(byVideoKey, new Set());
    acdByVideo.get(byVideoKey).add(acdName);
  }

  const byCdAndAcd = new Map();
  const byCd = new Map();

  for (const row of safeFailureRows) {
    const cdName = normalizeCdName(row.cd_name) || "Unknown";
    const assetCode = normalizeAssetId(row.asset_code) || "Unknown";
    const sheetLink = normalizeUrl(row.image_sheet_link);
    byCd.set(cdName, (byCd.get(cdName) || 0) + 1);

    const exactAcdSet = acdByVideoAndCd.get(mapKey(assetCode, cdName));
    const fallbackAcdSet = acdByVideo.get(mapKey(assetCode));
    const resolvedAcdNames =
      exactAcdSet && exactAcdSet.size > 0
        ? Array.from(exactAcdSet)
        : fallbackAcdSet && fallbackAcdSet.size > 0
          ? Array.from(fallbackAcdSet)
          : ["Unknown ACD"];

    for (const acdName of resolvedAcdNames) {
      const groupKey = mapKey(cdName, acdName);
      if (!byCdAndAcd.has(groupKey)) {
        byCdAndAcd.set(groupKey, {
          cdName,
          acdName,
          assets: new Map()
        });
      }

      const target = byCdAndAcd.get(groupKey);
      if (!target.assets.has(assetCode)) {
        target.assets.set(assetCode, sheetLink || "");
      } else if (!target.assets.get(assetCode) && sheetLink) {
        target.assets.set(assetCode, sheetLink);
      }
    }
  }

  const adherenceRows = Array.from(byCd.entries())
    .map(([cdName, failedCount]) => ({ cdName, failedCount: Number(failedCount || 0) }))
    .sort((a, b) => b.failedCount - a.failedCount || a.cdName.localeCompare(b.cdName));

  const adherenceIssueRows = Array.from(byCdAndAcd.values())
    .map((item) => {
      const assetItems = Array.from(item.assets.entries())
        .map(([assetCode, imageSheetLink]) => ({
          assetCode,
          imageSheetLink: imageSheetLink || ""
        }))
        .sort((a, b) => a.assetCode.localeCompare(b.assetCode));

      return {
        cdName: item.cdName,
        acdName: item.acdName,
        totalAssetsNotAdhering: assetItems.length,
        assetCodes: assetItems.map((asset) => asset.assetCode),
        assets: assetItems
      };
    })
    .sort(
      (a, b) =>
        Number(b.totalAssetsNotAdhering || 0) - Number(a.totalAssetsNotAdhering || 0) ||
        a.cdName.localeCompare(b.cdName) ||
        a.acdName.localeCompare(b.acdName)
    );

  const safeSyncRows = (Array.isArray(syncRows) ? syncRows : []).filter(
    (row) => isGaAssetCode(row.asset_code) && isTrackedCreativeDirector(row.cd_name)
  );
  const eligibleGaRows = new Set(
    safeSyncRows
      .map((row) => Number(row.live_row_index || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
  );

  const latestRunSummary = latestRun
    ? {
        createdAt: String(latestRun.created_at || ""),
        processedLiveRows: Number(latestRun.processed_live_rows || 0),
        eligibleLiveRows: eligibleGaRows.size,
        sheetLinksAttempted: safeSyncRows.reduce((sum, row) => sum + Number(row.processed_links || 0), 0),
        sheetLinksSucceeded: safeSyncRows.reduce((sum, row) => sum + Number(row.successful_links || 0), 0),
        sheetLinksFailed: safeSyncRows.reduce((sum, row) => sum + Number(row.failed_links || 0), 0)
      }
    : null;

  return {
    cutoffDate: LIVE_SOURCE_CUTOFF_DATE,
    latestRun: latestRunSummary,
    adherenceRows,
    adherenceIssueRows,
    totalFailedSheets: safeFailureRows.length
  };
}

module.exports = {
  LIVE_SOURCE_CUTOFF_DATE,
  syncAcdFromLive,
  fetchAcdSyncStatus
};
