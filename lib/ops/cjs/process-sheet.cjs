const {
  makeError,
  readJsonBody,
  supabaseRequest,
  supabaseFetchAll,
  chunk,
  normalizeForKey,
  normalizeAssetId,
  normalizeAcdName,
  normalizeAcdIdentity,
  normalizeCdName,
  normalizeUrl,
  parseWorkDate,
  logDateParse,
  isTruthyYes,
  calcDeltaMinutes,
  round4,
  isValidCreativeDirector,
  fetchFinalImageSheetCsv,
  makeVideoCompareKey,
  makeParentCompareKey
} = require("./_lib.cjs");

const ACD_TABLE = "acd_productivity";
const PREVIEW_LIMIT = 5;
const DATA_SOURCE_LIVE_SYNC = "live_tab_sync";
const DATA_SOURCE_LEGACY = "manual_legacy";
const LIVE_SYNC_CUTOFF_DATE = "2026-03-10";

const WORK_DATE_ALIASES = ["Work Date", "Date", "WorkDate", "Dates", "Work Day", "WorkDateIST"];
const ACD_NAME_ALIASES = ["ACD Name", "ACD", "ACDs", "POC ACD", "POC", "POC ACD Name"];
const FINAL_IMAGE_ALIASES = [
  "Final Image URL",
  "Final Image URLs",
  "Final Image",
  "Image URL",
  "Final URL",
  "Final Images",
  "Image Link",
  "Final Image Link"
];

function normalizeDataSource(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return raw === DATA_SOURCE_LIVE_SYNC ? DATA_SOURCE_LIVE_SYNC : DATA_SOURCE_LEGACY;
}

function isLiveTabSyncDataSource(value) {
  return normalizeDataSource(value) === DATA_SOURCE_LIVE_SYNC;
}

function isMissingDataSourceColumnError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("data_source") && (message.includes("column") || message.includes("does not exist"));
}

function filterLegacyRowsForLiveSyncFallback(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const createdDate = String(row && row.created_at ? row.created_at : "").slice(0, 10);
    return Boolean(createdDate) && createdDate >= LIVE_SYNC_CUTOFF_DATE;
  });
}

async function fetchRowsByDataSource(path, dataSource) {
  const liveOnly = isLiveTabSyncDataSource(dataSource);
  if (!liveOnly) {
    return await supabaseFetchAll(path);
  }

  try {
    return await supabaseFetchAll(`${path}&data_source=eq.${encodeURIComponent(DATA_SOURCE_LIVE_SYNC)}`);
  } catch (error) {
    if (!isMissingDataSourceColumnError(error)) throw error;

    const fallbackRows = await supabaseFetchAll(path);
    return filterLegacyRowsForLiveSyncFallback(fallbackRows);
  }
}

function json(res, status, body) {
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .send(JSON.stringify(body));
}

function makeComparisonKey(mode, videoCode, baseAssetId, acdName, imageUrl) {
  return mode === "lineage"
    ? makeParentCompareKey(baseAssetId, acdName, imageUrl)
    : makeVideoCompareKey(videoCode, acdName, imageUrl);
}

function canonicalHeaderKey(value) {
  const text = extractCellText(value)
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.replace(/[^a-z0-9]/g, "");
}

function findColumnIndex(headers, aliases) {
  const aliasSet = new Set(aliases.map((v) => canonicalHeaderKey(v)));

  for (let i = 0; i < headers.length; i += 1) {
    const key = canonicalHeaderKey(headers[i]);
    if (aliasSet.has(key)) return i;
  }

  return -1;
}

function extractCellText(cell) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell.trim();
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell).trim();

  if (typeof cell === "object") {
    const directProps = [
      "display",
      "displayValue",
      "formatted",
      "formattedValue",
      "text",
      "value",
      "label",
      "userEnteredValue",
      "hyperlink",
      "url",
      "formula",
      "html"
    ];

    for (const prop of directProps) {
      if (typeof cell[prop] === "string" && cell[prop].trim()) {
        return cell[prop].trim();
      }
      if (typeof cell[prop] === "number") {
        return String(cell[prop]);
      }
    }

    if (Array.isArray(cell.richTextValues)) {
      const rich = cell.richTextValues
        .map((v) => (typeof v?.text === "string" ? v.text : ""))
        .join("")
        .trim();
      if (rich) return rich;
    }

    if (Array.isArray(cell.textFormatRuns)) {
      const rich = cell.textFormatRuns
        .map((v) => (typeof v?.text === "string" ? v.text : ""))
        .join("")
        .trim();
      if (rich) return rich;
    }

    if (typeof cell.hyperlink === "string" && cell.hyperlink.trim()) {
      return cell.hyperlink.trim();
    }

    if (typeof cell.url === "string" && cell.url.trim()) {
      return cell.url.trim();
    }
  }

  return String(cell).trim();
}

function extractLinksFromHtml(value) {
  const html = String(value || "");
  if (!html) return [];

  const links = [];
  const hrefMatches = html.match(/href\s*=\s*["']([^"']+)["']/gi) || [];
  for (const match of hrefMatches) {
    const parts = match.match(/href\s*=\s*["']([^"']+)["']/i);
    if (parts && parts[1]) {
      links.push(parts[1]);
    }
  }

  const directMatches = html.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  links.push(...directMatches);

  return links;
}

function toTitleCase(text) {
  return String(text || "")
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join(" ")
    .trim();
}

function extractAcdName(cell) {
  let text = extractCellText(cell).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const mailtoMatch = text.match(/^mailto:([^\s>]+)$/i);
  if (mailtoMatch) {
    text = mailtoMatch[1];
  }

  const angleEmail = text.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleEmail) {
    const display = String(angleEmail[1] || "").trim();
    if (display) {
      return normalizeAcdName(display);
    }
    text = angleEmail[2];
  }

  if (text.startsWith("@")) {
    text = text.slice(1).trim();
  }

  const emailMatch = text.match(/^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (emailMatch) {
    const localPart = emailMatch[1].replace(/[._-]+/g, " ").trim();
    return normalizeAcdName(toTitleCase(localPart));
  }

  return normalizeAcdName(text);
}

function extractUrl(cell) {
  if (cell && typeof cell === "object") {
    const directCandidates = [
      cell.hyperlink,
      cell.url,
      cell.link,
      cell.target,
      cell?.l?.Target,
      cell?.l?.Rel?.Target
    ];

    for (const candidate of directCandidates) {
      const normalized = normalizeUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }

    const formulaCandidates = [cell.formula, cell.f];
    for (const formulaValue of formulaCandidates) {
      const formula = String(formulaValue || "").trim();
      if (!formula) continue;

      const hyperlinkFormulaMatch = formula.match(/=\s*HYPERLINK\(\s*"([^"]+)"/i);
      if (hyperlinkFormulaMatch) {
        return normalizeUrl(hyperlinkFormulaMatch[1]);
      }

      const imageFormulaMatch = formula.match(/=\s*IMAGE\(\s*"([^"]+)"/i);
      if (imageFormulaMatch) {
        return normalizeUrl(imageFormulaMatch[1]);
      }

      const formulaDirectMatch = formula.match(/https?:\/\/[^\s)",]+/i);
      if (formulaDirectMatch) {
        return normalizeUrl(formulaDirectMatch[0]);
      }
    }

    const htmlLinks = extractLinksFromHtml(cell.html || cell.h);
    if (htmlLinks.length > 0) {
      return normalizeUrl(htmlLinks[0]);
    }
  }

  const raw = extractCellText(cell);
  if (!raw) return "";

  const text = raw.trim();

  const directMatch = text.match(/https?:\/\/[^\s"'<>\])]+/i);
  if (directMatch) {
    return normalizeUrl(directMatch[0]);
  }

  const hyperlinkFormulaMatch = text.match(/=\s*HYPERLINK\(\s*"([^"]+)"/i);
  if (hyperlinkFormulaMatch) {
    return normalizeUrl(hyperlinkFormulaMatch[1]);
  }

  const imageFormulaMatch = text.match(/=\s*IMAGE\(\s*"([^"]+)"/i);
  if (imageFormulaMatch) {
    return normalizeUrl(imageFormulaMatch[1]);
  }

  const hrefMatch = text.match(/href\s*=\s*"([^"]+)"/i);
  if (hrefMatch) {
    return normalizeUrl(hrefMatch[1]);
  }

  if (/^www\./i.test(text)) {
    return normalizeUrl(`https://${text}`);
  }

  return "";
}

function chooseNoValidRowsMessage(invalidSummary, failedDateSamples = []) {
  const acdIssues = invalidSummary.missing_acd_name + invalidSummary.unreadable_acd_name;
  const imageIssues = invalidSummary.missing_final_image_url + invalidSummary.invalid_final_image_url;
  const dateIssues = invalidSummary.missing_work_date + invalidSummary.unparsed_work_date;

  if (acdIssues > 0 && acdIssues >= imageIssues && acdIssues >= dateIssues) {
    return "Rows were found, but ACD Name could not be extracted from tagged cells.";
  }

  if (imageIssues > 0 && imageIssues >= acdIssues && imageIssues >= dateIssues) {
    return "Rows were found, but Final Image URL values could not be read from hyperlink cells.";
  }

  if (dateIssues > 0) {
    if (failedDateSamples.length > 0) {
      return `Could not parse Work Date values such as: ${failedDateSamples.join(", ")}`;
    }
    return "Rows were found, but Work Date values could not be parsed.";
  }

  return "No valid rows found. Ensure Work Date, ACD Name, and Final Image URL are filled for at least one row.";
}

function ensureUrlLooksValid(url) {
  return /^https?:\/\//i.test(url);
}

async function resolveEffectiveBaseAssetId(baseAssetIdInput, videoCode) {
  if (!baseAssetIdInput) {
    return videoCode;
  }

  let current = baseAssetIdInput;
  const visited = new Set();

  while (current) {
    const token = normalizeForKey(current);
    if (!token || visited.has(token)) break;

    visited.add(token);

    const rows = await supabaseRequest(
      `${ACD_TABLE}?select=parent_asset_id&video_code=eq.${encodeURIComponent(current)}&order=created_at.asc&limit=1`
    );

    if (!Array.isArray(rows) || rows.length === 0) break;

    const next = normalizeAssetId(rows[0].parent_asset_id);
    if (!next || normalizeForKey(next) === token) break;

    current = next;
  }

  return current || baseAssetIdInput;
}

function prepareRows(rows, context) {
  const {
    videoCode,
    cdName,
    sheetUrl,
    spreadsheetId,
    comparisonMode,
    effectiveBaseAssetId,
    sourceType = "main",
    canvasLink = "",
    dataSource = DATA_SOURCE_LEGACY
  } = context;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw makeError(400, "No rows found in Final image sheet.");
  }

  const headerRow = rows[0] || [];

  const workDateCol = findColumnIndex(headerRow, WORK_DATE_ALIASES);
  const acdNameCol = findColumnIndex(headerRow, ACD_NAME_ALIASES);
  const finalImageCol = findColumnIndex(headerRow, FINAL_IMAGE_ALIASES);
  const isNewCanvasCol = findColumnIndex(headerRow, ["isnewcanvas"]);

  const missing = [];
  if (workDateCol < 0) missing.push("Work Date");
  if (acdNameCol < 0) missing.push("ACD Name");
  if (finalImageCol < 0) missing.push("Final Image URL");

  if (missing.length > 0) {
    const error = makeError(400, "Final image sheet tab found, but required columns could not be matched.");
    error.details = {
      missingColumns: missing,
      detectedHeaders: headerRow.map((h) => extractCellText(h)).filter(Boolean),
      parserPreview: []
    };
    throw error;
  }

  const uploadDedupSet = new Set();
  const validRows = [];
  const inUploadDuplicates = [];
  const parserPreview = [];
  const failedDateSamples = [];
  const ambiguousAcdNames = new Set();
  let failedDateLogCount = 0;

  const invalidSummary = {
    missing_work_date: 0,
    unparsed_work_date: 0,
    missing_acd_name: 0,
    unreadable_acd_name: 0,
    missing_final_image_url: 0,
    invalid_final_image_url: 0
  };

  let skippedRows = 0;
  let skippedCanvasRows = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];

    if (isNewCanvasCol >= 0 && isTruthyYes(row[isNewCanvasCol])) {
      skippedCanvasRows += 1;
      continue;
    }

    const rawWorkDate = row[workDateCol];
    const rawAcdCell = row[acdNameCol];
    const rawFinalImage = row[finalImageCol];

    const parsedWorkDate = parseWorkDate(rawWorkDate);
    const parsedAcdName = extractAcdName(rawAcdCell);
    const parsedFinalImageUrl = extractUrl(rawFinalImage);
    const acdIdentity = normalizeAcdIdentity(parsedAcdName);
    const rawAcdName = normalizeAcdName(acdIdentity.rawName || parsedAcdName);
    const normalizedAcdName = normalizeAcdName(acdIdentity.normalizedName || parsedAcdName);
    const nameMatchStatus = String(acdIdentity.matchStatus || "unmatched");

    if (nameMatchStatus === "ambiguous" && rawAcdName) {
      ambiguousAcdNames.add(rawAcdName);
    }

    logDateParse(rawWorkDate, parsedWorkDate, parsedWorkDate);

    let rowValid = true;
    let invalidReason = "";

    if (!extractCellText(rawWorkDate)) {
      rowValid = false;
      invalidReason = "missing_work_date";
      invalidSummary.missing_work_date += 1;
    } else if (!parsedWorkDate) {
      rowValid = false;
      invalidReason = "unparsed_work_date";
      invalidSummary.unparsed_work_date += 1;

      const rawDateText = extractCellText(rawWorkDate);
      if (rawDateText && failedDateSamples.length < 5 && !failedDateSamples.includes(rawDateText)) {
        failedDateSamples.push(rawDateText);
      }
      if (failedDateLogCount < 10) {
        console.log(
          `[acd-parser-date-failure] ${JSON.stringify({
            row_number: i + 1,
            raw_work_date: rawWorkDate,
            typeof_raw_work_date: typeof rawWorkDate,
            parsed_result: parsedWorkDate,
            failure_reason: "unparsed_work_date"
          })}`
        );
        failedDateLogCount += 1;
      }
    } else if (!extractCellText(rawAcdCell)) {
      rowValid = false;
      invalidReason = "missing_acd_name";
      invalidSummary.missing_acd_name += 1;
    } else if (!parsedAcdName) {
      rowValid = false;
      invalidReason = "unreadable_acd_name";
      invalidSummary.unreadable_acd_name += 1;
    } else if (!extractCellText(rawFinalImage)) {
      rowValid = false;
      invalidReason = "missing_final_image_url";
      invalidSummary.missing_final_image_url += 1;
    } else if (!parsedFinalImageUrl) {
      rowValid = false;
      invalidReason = "invalid_final_image_url";
      invalidSummary.invalid_final_image_url += 1;
    } else if (!ensureUrlLooksValid(parsedFinalImageUrl)) {
      rowValid = false;
      invalidReason = "invalid_final_image_url";
      invalidSummary.invalid_final_image_url += 1;
    }

    const debugPayload = {
      row_number: i + 1,
      raw_work_date: extractCellText(rawWorkDate),
      raw_acd_name: extractCellText(rawAcdCell),
      raw_final_image_url: extractCellText(rawFinalImage),
      parsed_work_date: parsedWorkDate,
      parsed_acd_name: parsedAcdName,
      normalized_acd_name: normalizedAcdName,
      name_match_status: nameMatchStatus,
      parsed_final_image_url: parsedFinalImageUrl,
      row_valid: rowValid,
      invalid_reason: invalidReason
    };

    console.log(`[acd-parser-row] ${JSON.stringify(debugPayload)}`);

    if (parserPreview.length < PREVIEW_LIMIT) {
      parserPreview.push({
        rowNumber: i + 1,
        rawWorkDate: extractCellText(rawWorkDate),
        parsedWorkDate,
        acdName: normalizedAcdName || parsedAcdName || extractCellText(rawAcdCell),
        rawAcdName,
        normalizedAcdName,
        nameMatchStatus,
        finalImageUrl: parsedFinalImageUrl || extractCellText(rawFinalImage),
        valid: rowValid,
        invalidReason
      });
    }

    if (!rowValid) {
      skippedRows += 1;
      continue;
    }

    const comparisonKey = makeComparisonKey(
      comparisonMode,
      videoCode,
      effectiveBaseAssetId,
      normalizedAcdName,
      parsedFinalImageUrl
    );

    if (uploadDedupSet.has(comparisonKey)) {
      inUploadDuplicates.push({
        acdName: normalizedAcdName,
        rawAcdName,
        normalizedAcdName,
        nameMatchStatus,
        cdName,
        workDate: parsedWorkDate,
        imageUrl: parsedFinalImageUrl,
        reason: "Duplicate inside current upload"
      });
      continue;
    }

    uploadDedupSet.add(comparisonKey);

    validRows.push({
      sheet_url: sheetUrl,
      sheet_id: spreadsheetId,
      parent_asset_id: effectiveBaseAssetId,
      video_code: videoCode,
      cd_name: cdName,
      acd_name: parsedAcdName,
      raw_acd_name: rawAcdName,
      normalized_acd_name: normalizedAcdName,
      name_match_status: nameMatchStatus,
      work_date: parsedWorkDate,
      image_url: parsedFinalImageUrl,
      source_type: sourceType,
      canvas_link: canvasLink || "",
      data_source: normalizeDataSource(dataSource),
      comparisonKey
    });
  }

  if (validRows.length === 0) {
    const message = chooseNoValidRowsMessage(invalidSummary, failedDateSamples);
    const error = makeError(400, message);
    error.details = {
      parserPreview,
      invalidSummary,
      detectedHeaders: headerRow.map((h) => extractCellText(h)).filter(Boolean),
      failedDateSamples
    };
    throw error;
  }

  return {
    validRows,
    inUploadDuplicates,
    skippedRows,
    skippedCanvasRows,
    parserPreview,
    invalidSummary,
    detectedHeaders: headerRow.map((h) => extractCellText(h)).filter(Boolean),
    failedDateSamples,
    ambiguousAcdNames: Array.from(ambiguousAcdNames)
  };
}

function uniqueNonEmpty(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function dedupeRowsByIdOrComposite(rows) {
  const result = [];
  const seen = new Set();

  for (const row of rows || []) {
    const key = row && row.id ? `id:${row.id}` : JSON.stringify(row || {});
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

async function checkSheetPreviouslyProcessed(videoCode, sheetUrls = [], sheetIds = [], dataSource = DATA_SOURCE_LEGACY) {
  const uniqueUrls = uniqueNonEmpty(sheetUrls);
  const uniqueIds = uniqueNonEmpty(sheetIds);

  const checks = [];
  for (const id of uniqueIds) {
    checks.push(fetchRowsByDataSource(`${ACD_TABLE}?select=id,created_at&sheet_id=eq.${encodeURIComponent(id)}`, dataSource));
  }
  for (const url of uniqueUrls) {
    checks.push(fetchRowsByDataSource(`${ACD_TABLE}?select=id,created_at&sheet_url=eq.${encodeURIComponent(url)}`, dataSource));
  }

  if (checks.length === 0) {
    checks.push(
      fetchRowsByDataSource(
        `${ACD_TABLE}?select=id,created_at&video_code=eq.${encodeURIComponent(videoCode)}`,
        dataSource
      )
    );
  }

  const responses = await Promise.all(checks);
  return responses.some((rows) => Array.isArray(rows) && rows.length > 0);
}

async function fetchHistoricalRows(
  comparisonMode,
  videoCode,
  effectiveBaseAssetId,
  sheetUrls = [],
  sheetIds = [],
  dataSource = DATA_SOURCE_LEGACY
) {
  if (comparisonMode === "lineage") {
    return await fetchRowsByDataSource(
      `${ACD_TABLE}?select=*&parent_asset_id=eq.${encodeURIComponent(effectiveBaseAssetId)}`,
      dataSource
    );
  }

  const uniqueUrls = uniqueNonEmpty(sheetUrls);
  const uniqueIds = uniqueNonEmpty(sheetIds);

  const queries = [`${ACD_TABLE}?select=*&video_code=eq.${encodeURIComponent(videoCode)}`];
  for (const id of uniqueIds) {
    queries.push(`${ACD_TABLE}?select=*&sheet_id=eq.${encodeURIComponent(id)}`);
  }
  for (const url of uniqueUrls) {
    queries.push(`${ACD_TABLE}?select=*&sheet_url=eq.${encodeURIComponent(url)}`);
  }

  const batches = await Promise.all(queries.map((query) => fetchRowsByDataSource(query, dataSource)));
  return dedupeRowsByIdOrComposite(batches.flat());
}

function buildHistoricalSet(rows, comparisonMode, videoCode, effectiveBaseAssetId) {
  const set = new Set();

  for (const row of rows) {
    const acdName = normalizeAcdName(row.normalized_acd_name || row.acd_name);
    const imageUrl = normalizeUrl(row.image_url);
    if (!acdName || !imageUrl) continue;

    const key = makeComparisonKey(comparisonMode, videoCode, effectiveBaseAssetId, acdName, imageUrl);
    set.add(key);
  }

  return set;
}

async function fetchExistingVideoRows(videoCode, sheetUrls = [], sheetIds = [], dataSource = DATA_SOURCE_LEGACY) {
  const uniqueUrls = uniqueNonEmpty(sheetUrls);
  const uniqueIds = uniqueNonEmpty(sheetIds);

  const queries = [`${ACD_TABLE}?select=*&video_code=eq.${encodeURIComponent(videoCode)}`];
  for (const id of uniqueIds) {
    queries.push(`${ACD_TABLE}?select=*&sheet_id=eq.${encodeURIComponent(id)}`);
  }
  for (const url of uniqueUrls) {
    queries.push(`${ACD_TABLE}?select=*&sheet_url=eq.${encodeURIComponent(url)}`);
  }

  const batches = await Promise.all(queries.map((query) => fetchRowsByDataSource(query, dataSource)));
  return dedupeRowsByIdOrComposite(batches.flat());
}

function buildExistingVideoCounts(rows, videoCode) {
  const seen = new Set();
  const counts = new Map();

  for (const row of rows) {
    const workDate = String(row.work_date || "").slice(0, 10);
    const acdName = normalizeAcdName(row.normalized_acd_name || row.acd_name);
    const imageUrl = normalizeUrl(row.image_url);

    if (!workDate || !acdName || !imageUrl) continue;

    const key = makeVideoCompareKey(videoCode, acdName, imageUrl);
    if (seen.has(key)) continue;

    seen.add(key);
    const groupKey = `${workDate}|${acdName}`;
    counts.set(groupKey, (counts.get(groupKey) || 0) + 1);
  }

  return counts;
}

async function insertRows(rows) {
  const inserted = [];
  let usedLegacyInsert = false;
  let missingSourceColumns = false;
  let missingNormalizationColumns = false;
  let missingDataSourceColumns = false;

  for (const part of chunk(rows, 500)) {
    const liveSyncPart = part.some((row) => isLiveTabSyncDataSource(row.data_source));
    const conflictResolution = liveSyncPart ? "merge-duplicates" : "ignore-duplicates";
    const body = part.map((row) => ({
      parent_asset_id: row.parent_asset_id,
      video_code: row.video_code,
      cd_name: row.cd_name,
      acd_name: row.acd_name,
      raw_acd_name: row.raw_acd_name,
      normalized_acd_name: row.normalized_acd_name,
      name_match_status: row.name_match_status,
      work_date: row.work_date,
      image_url: row.image_url,
      sheet_url: row.sheet_url,
      sheet_id: row.sheet_id,
      source_type: row.source_type || "main",
      canvas_link: row.canvas_link || "",
      data_source: normalizeDataSource(row.data_source)
    }));

    let data;
    try {
      data = await supabaseRequest(`${ACD_TABLE}?on_conflict=parent_asset_id,acd_name,image_url`, {
        method: "POST",
        headers: {
          Prefer: `resolution=${conflictResolution},return=representation`
        },
        body
      });
    } catch (error) {
      const message = String(error.message || "").toLowerCase();
      missingNormalizationColumns =
        message.includes("raw_acd_name") ||
        message.includes("normalized_acd_name") ||
        message.includes("name_match_status");
      missingSourceColumns = message.includes("source_type") || message.includes("canvas_link");
      missingDataSourceColumns = message.includes("data_source");

      if (!missingNormalizationColumns && !missingSourceColumns && !missingDataSourceColumns) {
        throw error;
      }

      usedLegacyInsert = true;

      const bodyWithoutSource = part.map((row) => ({
        parent_asset_id: row.parent_asset_id,
        video_code: row.video_code,
        cd_name: row.cd_name,
        acd_name: row.acd_name,
        raw_acd_name: row.raw_acd_name,
        normalized_acd_name: row.normalized_acd_name,
        name_match_status: row.name_match_status,
        work_date: row.work_date,
        image_url: row.image_url,
        sheet_url: row.sheet_url,
        sheet_id: row.sheet_id
      }));

      try {
        data = await supabaseRequest(`${ACD_TABLE}?on_conflict=parent_asset_id,acd_name,image_url`, {
          method: "POST",
          headers: {
            Prefer: `resolution=${conflictResolution},return=representation`
          },
          body: bodyWithoutSource
        });
      } catch (fallbackError) {
        const fallbackMessage = String(fallbackError.message || "").toLowerCase();
        const stillMissingNormalization =
          fallbackMessage.includes("raw_acd_name") ||
          fallbackMessage.includes("normalized_acd_name") ||
          fallbackMessage.includes("name_match_status");

        if (!stillMissingNormalization) {
          throw fallbackError;
        }

        missingNormalizationColumns = true;
        const legacyBody = part.map((row) => ({
          parent_asset_id: row.parent_asset_id,
          video_code: row.video_code,
          cd_name: row.cd_name,
          acd_name: row.acd_name,
          work_date: row.work_date,
          image_url: row.image_url,
          sheet_url: row.sheet_url,
          sheet_id: row.sheet_id
        }));

        data = await supabaseRequest(`${ACD_TABLE}?on_conflict=parent_asset_id,acd_name,image_url`, {
          method: "POST",
          headers: {
            Prefer: `resolution=${conflictResolution},return=representation`
          },
          body: legacyBody
        });
      }
    }

    if (Array.isArray(data) && data.length > 0) {
      inserted.push(...data);
    }
  }

  return {
    insertedRows: inserted,
    usedLegacyInsert,
    missingSourceColumns,
    missingNormalizationColumns,
    missingDataSourceColumns
  };
}

function buildSummary(insertedRows, existingCountsMap) {
  const insertedGroupCounts = new Map();
  const processedDates = new Set();

  for (const row of insertedRows) {
    const workDate = String(row.work_date || "").slice(0, 10);
    const acdName = normalizeAcdName(row.normalized_acd_name || row.acd_name);
    const groupKey = `${workDate}|${acdName}`;

    insertedGroupCounts.set(groupKey, (insertedGroupCounts.get(groupKey) || 0) + 1);
  }

  const summaryByAcd = new Map();

  for (const [groupKey, addedImages] of insertedGroupCounts.entries()) {
    const [workDate, acdName] = groupKey.split("|");
    processedDates.add(workDate);

    const existingImages = Number(existingCountsMap.get(groupKey) || 0);
    const deltaMinutes = calcDeltaMinutes(existingImages, addedImages);

    if (!summaryByAcd.has(acdName)) {
      summaryByAcd.set(acdName, {
        acdName,
        images: 0,
        minutes: 0
      });
    }

    const target = summaryByAcd.get(acdName);
    target.images += addedImages;
    target.minutes += deltaMinutes;
  }

  const summary = Array.from(summaryByAcd.values())
    .map((row) => ({
      acdName: row.acdName,
      images: row.images,
      minutes: round4(row.minutes)
    }))
    .sort((a, b) => b.minutes - a.minutes || a.acdName.localeCompare(b.acdName));

  return {
    summary,
    processedDates: Array.from(processedDates).sort()
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(req);

    const cdName = normalizeCdName(body.cdName);
    const baseAssetIdInput = normalizeAssetId(body.baseAssetId || body.parentAssetId);
    const videoCode = normalizeAssetId(body.videoCode);
    const sheetUrl = String(body.sheetUrl || "").trim();
    const newCanvasGenerated = Boolean(body.newCanvasGenerated);
    const canvasSheetUrl = String(body.canvasSheetUrl || "").trim();
    const dataSource = normalizeDataSource(body.dataSource);

    if (!cdName) {
      throw makeError(400, "Please select a Creative Director.");
    }

    if (!isValidCreativeDirector(cdName)) {
      throw makeError(400, "Invalid Creative Director selected.");
    }

    if (!videoCode) {
      throw makeError(400, "Video Code is required.");
    }

    if (!sheetUrl) {
      throw makeError(400, "Google Sheet link is required.");
    }

    if (newCanvasGenerated && !canvasSheetUrl) {
      throw makeError(400, "Canvas Link is required when New canvas generated is selected.");
    }

    const comparisonMode = baseAssetIdInput ? "lineage" : "video";
    const effectiveBaseAssetId = await resolveEffectiveBaseAssetId(baseAssetIdInput, videoCode);

    const mainSheet = await fetchFinalImageSheetCsv(sheetUrl);
    const preparedMain = prepareRows(mainSheet.rows, {
      videoCode,
      cdName,
      sheetUrl,
      spreadsheetId: mainSheet.spreadsheetId,
      comparisonMode,
      effectiveBaseAssetId,
      sourceType: "main",
      canvasLink: "",
      dataSource
    });

    let canvasSheet = null;
    let preparedCanvas = null;
    if (newCanvasGenerated && canvasSheetUrl) {
      canvasSheet = await fetchFinalImageSheetCsv(canvasSheetUrl);
      preparedCanvas = prepareRows(canvasSheet.rows, {
        videoCode,
        cdName,
        sheetUrl: canvasSheetUrl,
        spreadsheetId: canvasSheet.spreadsheetId,
        comparisonMode,
        effectiveBaseAssetId,
        sourceType: "canvas",
        canvasLink: canvasSheetUrl,
        dataSource
      });
    }

    const sheetUrls = [sheetUrl, canvasSheetUrl].filter(Boolean);
    const sheetIds = [mainSheet.spreadsheetId, canvasSheet ? canvasSheet.spreadsheetId : ""].filter(Boolean);
    const sheetAlreadyProcessed = await checkSheetPreviouslyProcessed(videoCode, sheetUrls, sheetIds, dataSource);

    const historicalRows = await fetchHistoricalRows(
      comparisonMode,
      videoCode,
      effectiveBaseAssetId,
      sheetUrls,
      sheetIds,
      dataSource
    );
    const historicalSet = buildHistoricalSet(historicalRows, comparisonMode, videoCode, effectiveBaseAssetId);

    const existingVideoRows = await fetchExistingVideoRows(videoCode, sheetUrls, sheetIds, dataSource);
    const existingCountsMap = buildExistingVideoCounts(existingVideoRows, videoCode);
    const allValidRows = [
      ...preparedMain.validRows,
      ...(preparedCanvas && Array.isArray(preparedCanvas.validRows) ? preparedCanvas.validRows : [])
    ];

    const rowsToInsert = [];
    const historicalSkipped = [];
    const uploadCrossSheetDuplicates = [];
    const submissionSet = new Set();

    for (const row of allValidRows) {
      if (submissionSet.has(row.comparisonKey)) {
        uploadCrossSheetDuplicates.push({
          acdName: normalizeAcdName(row.normalized_acd_name || row.acd_name),
          cdName: row.cd_name,
          workDate: row.work_date,
          imageUrl: row.image_url,
          reason: "Duplicate across uploaded sheets"
        });
        continue;
      }
      submissionSet.add(row.comparisonKey);

      if (historicalSet.has(row.comparisonKey)) {
        historicalSkipped.push({
          acdName: normalizeAcdName(row.normalized_acd_name || row.acd_name),
          cdName: row.cd_name,
          workDate: row.work_date,
          imageUrl: row.image_url,
          reason: "Previously processed duplicate"
        });
        continue;
      }

      historicalSet.add(row.comparisonKey);
      rowsToInsert.push(row);
    }

    const insertResult = await insertRows(rowsToInsert);
    const insertedRows = insertResult.insertedRows;
    const summaryData = buildSummary(insertedRows, existingCountsMap);
    const canvasRowsInserted = insertedRows.filter((row) => String(row.source_type || "main") === "canvas");
    const canvasAcdNames = Array.from(
      new Set(
        canvasRowsInserted
          .map((row) => normalizeAcdName(row.normalized_acd_name || row.acd_name || row.raw_acd_name))
          .filter(Boolean)
      )
    ).sort();

    const sameSheetDuplicates =
      preparedMain.inUploadDuplicates.length +
      (preparedCanvas ? preparedCanvas.inUploadDuplicates.length : 0) +
      uploadCrossSheetDuplicates.length;
    const existingHistoricalImagesSkipped = historicalSkipped.length + Math.max(0, rowsToInsert.length - insertedRows.length);
    const newImagesCounted = insertedRows.length;

    const notes = [];
    if (preparedMain.skippedRows > 0) {
      notes.push(`${preparedMain.skippedRows} row(s) skipped due to missing required values.`);
    }
    if (preparedMain.skippedCanvasRows > 0) {
      notes.push(`${preparedMain.skippedCanvasRows} row(s) ignored because Is New Canvas = Yes.`);
    }
    if (Array.isArray(preparedMain.ambiguousAcdNames) && preparedMain.ambiguousAcdNames.length > 0) {
      notes.push(
        `Ambiguous ACD names were not auto-merged: ${preparedMain.ambiguousAcdNames
          .slice(0, 10)
          .join(", ")}.`
      );
    }
    if (preparedCanvas) {
      if (preparedCanvas.skippedRows > 0) {
        notes.push(`${preparedCanvas.skippedRows} canvas row(s) skipped due to missing required values.`);
      }
      if (Array.isArray(preparedCanvas.ambiguousAcdNames) && preparedCanvas.ambiguousAcdNames.length > 0) {
        notes.push(
          `Ambiguous canvas ACD names were not auto-merged: ${preparedCanvas.ambiguousAcdNames
            .slice(0, 10)
            .join(", ")}.`
        );
      }
      notes.push(`Canvas rows counted: ${canvasRowsInserted.length}.`);
    }
    if (insertResult.usedLegacyInsert) {
      notes.push("Database insert fallback mode was used due to missing optional columns.");
    }
    if (insertResult.missingNormalizationColumns) {
      notes.push(
        "Name normalization columns are missing in database. Run migration 2026-03-09-acd-name-normalization.sql."
      );
    }
    if (insertResult.missingSourceColumns) {
      notes.push("Canvas/source columns are missing in database. Run migration 2026-03-10-acd-canvas-source-columns.sql.");
    }
    if (insertResult.missingDataSourceColumns) {
      notes.push("Data source column is missing in database. Run migration 2026-03-11-acd-data-source.sql.");
    }
    if (comparisonMode === "lineage") {
      notes.push(`Rework lineage mode enabled. Base Asset ID used for comparison: ${effectiveBaseAssetId}.`);
    }

    let message = "Sheet processed successfully.";
    if (sheetAlreadyProcessed && newImagesCounted > 0) {
      message =
        "This sheet was processed earlier. Previously processed images were skipped. Newly added images were accounted for.";
    } else if (sheetAlreadyProcessed && newImagesCounted === 0) {
      message = "This sheet was already processed. No new valid images were found.";
    }

    json(res, 200, {
      ok: true,
      message,
      sheetAlreadyProcessed,
      comparisonMode,
      baseAssetIdInput,
      effectiveBaseAssetId,
      parentAssetIdInput: baseAssetIdInput,
      effectiveParentAssetId: effectiveBaseAssetId,
      dataSource,
      videoCode,
      cdName,
      canvasProcessed: Boolean(newCanvasGenerated && canvasSheetUrl),
      canvasSheetUrl: newCanvasGenerated ? canvasSheetUrl : "",
      canvasNewImagesCounted: canvasRowsInserted.length,
      canvasAcdNames,
      processedDates: summaryData.processedDates,
      summary: summaryData.summary,
      existingHistoricalImagesSkipped,
      newImagesCounted,
      duplicatesIgnored: sameSheetDuplicates,
      sameSheetDuplicates,
      insertedImages: insertedRows.length,
      usedLegacyInsert: insertResult.usedLegacyInsert,
      notes,
      parserPreview: preparedMain.parserPreview,
      invalidSummary: preparedMain.invalidSummary,
      detectedHeaders: preparedMain.detectedHeaders,
      failedDateSamples: preparedMain.failedDateSamples,
      ambiguousAcdNames: [...preparedMain.ambiguousAcdNames, ...(preparedCanvas ? preparedCanvas.ambiguousAcdNames : [])],
      duplicateSamples: [
        ...preparedMain.inUploadDuplicates.slice(0, 3),
        ...(preparedCanvas ? preparedCanvas.inUploadDuplicates.slice(0, 3) : []),
        ...uploadCrossSheetDuplicates.slice(0, 2),
        ...historicalSkipped.slice(0, 4)
      ].map(
        (item) => ({
          acdName: item.acdName,
          cdName: item.cdName,
          workDate: item.workDate,
          imageUrl: item.imageUrl,
          reason: item.reason
        })
      )
    });
  } catch (error) {
    json(res, error.statusCode || 500, {
      ok: false,
      error: error.message || "Unexpected server error.",
      details: error.details || null
    });
  }
};
