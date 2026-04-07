const XLSX = require("xlsx");

const FINAL_TAB_NAME = "Final image sheet";
const COMMITMENT_MINUTES = 2.5;

const CREATIVE_DIRECTORS = [
  "Pauras Hinge",
  "Ankit D Badge",
  "Vivek Anand",
  "Swagat Karmakar",
  "Manthan M Kanani"
];
const CREATIVE_DIRECTOR_ALIASES = new Map(
  [
    ["Umesh Bahuguna", ["umesh bahuguna", "umesh"]],
    ["Pauras Hinge", ["pauras hinge", "pauras"]],
    ["Ankit D Badge", ["ankit d badge", "ankit d bagde", "ankit badge", "ankit"]],
    ["Daanish Narayan", ["daanish narayan", "daanish"]],
    ["Vivek Anand", ["vivek anand", "vivek"]],
    ["Priyesh Kava", ["priyesh kava", "priyesh tarun kava", "priyesh"]],
    ["Swagat Karmakar", ["swagat karmakar", "swagat"]],
    ["Varun Thomas", ["varun thomas", "varun"]],
    ["Manthan M Kanani", ["manthan m kanani", "manthan kanani", "manthan"]]
  ].flatMap(([canonicalName, aliases]) =>
    aliases.map((alias) => [
      String(alias || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " "),
      canonicalName
    ])
  )
);

const CANONICAL_ACD_ROSTER = [
  "Nupur Malik",
  "Chethan Kumar U",
  "Utkarsh Chaubey",
  "Aniket Shah",
  "Uttkarsh Sharma",
  "Aarav Shah",
  "Ketki Borgaonkar",
  "Masooma A",
  "Ishan Trivedi",
  "Faiz Ehsan",
  "Abhishek Nishad",
  "Ankush Kumar",
  "Susmita Biswas",
  "Ashni Methe",
  "Golani Anjali",
  "Animesh Mazumdar",
  "Mrinal Verma",
  "Prithvi Raj",
  "Shruti Dewangan",
  "Sanya Kathpal"
];

const CANONICAL_ACD_ALIASES = new Map(
  [
    ["sanya", "Sanya Kathpal"],
    ["sanya kathpal", "Sanya Kathpal"],
  ].map(([alias, canonicalName]) => [String(alias).trim().toLowerCase(), canonicalName])
);

const SOUND_ENGINEERS = ["Sound Engineer 1", "Sound Engineer 2"];
const EDITORS = ["Editor 1", "Editor 2"];

const GOOGLE_SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MAX_PAGE_SIZE = 1000;
const MONTH_LOOKUP = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};
const CANONICAL_ACD_BY_FULL = new Map(
  CANONICAL_ACD_ROSTER.map((name) => [String(name).trim().toLowerCase(), String(name).trim().replace(/\s+/g, " ")])
);
const CANONICAL_ACD_BY_FIRST = (() => {
  const map = new Map();
  for (const fullName of CANONICAL_ACD_ROSTER) {
    const normalizedFull = String(fullName).trim().replace(/\s+/g, " ");
    const first = normalizedFull.split(" ")[0].toLowerCase();
    if (!first) continue;
    if (!map.has(first)) map.set(first, []);
    map.get(first).push(normalizedFull);
  }
  return map;
})();

function makeError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    if (!req.body.trim()) return {};
    try {
      return JSON.parse(req.body);
    } catch {
      throw makeError(400, "Invalid JSON body.");
    }
  }

  return await new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(makeError(400, "Invalid JSON body."));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function getSupabaseConfig() {
  const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!base || !key) {
    throw makeError(
      500,
      "Server is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env vars."
    );
  }

  return { base, key };
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function supabaseRequest(path, options = {}) {
  const { base, key } = getSupabaseConfig();
  const method = options.method || "GET";
  const headers = supabaseHeaders(key, options.headers || {});

  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === "object" && (parsed.message || parsed.error_description)) ||
      (typeof parsed === "string" && parsed) ||
      `Supabase request failed (${response.status}).`;

    throw makeError(response.status, message);
  }

  return parsed;
}

async function supabaseFetchAll(pathBase) {
  const rows = [];
  let offset = 0;

  while (true) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const path = `${pathBase}${sep}limit=${MAX_PAGE_SIZE}&offset=${offset}`;
    const page = await supabaseRequest(path);

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    rows.push(...page);

    if (page.length < MAX_PAGE_SIZE) {
      break;
    }

    offset += MAX_PAGE_SIZE;
  }

  return rows;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeForKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeAssetId(value) {
  return String(value || "").trim();
}

function normalizeAcdName(value) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return CANONICAL_ACD_ALIASES.get(cleaned.toLowerCase()) || cleaned;
}

function normalizeAcdIdentity(value) {
  const rawName = normalizeAcdName(value);
  if (!rawName) {
    return {
      rawName: "",
      normalizedName: "",
      matchStatus: "unmatched"
    };
  }

  const exact = CANONICAL_ACD_BY_FULL.get(normalizeForKey(rawName));
  if (exact) {
    return {
      rawName,
      normalizedName: exact,
      matchStatus: "exact"
    };
  }

  const firstToken = normalizeForKey(rawName.split(" ")[0] || "");
  const matches = CANONICAL_ACD_BY_FIRST.get(firstToken) || [];
  if (matches.length === 1) {
    return {
      rawName,
      normalizedName: matches[0],
      matchStatus: "first_name_match"
    };
  }

  if (matches.length > 1) {
    return {
      rawName,
      normalizedName: rawName,
      matchStatus: "ambiguous"
    };
  }

  return {
    rawName,
    normalizedName: rawName,
    matchStatus: "unmatched"
  };
}

function normalizeCdName(value) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const aliasKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return CREATIVE_DIRECTOR_ALIASES.get(aliasKey) || cleaned;
}

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/&amp;/gi, "&");
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function isValidCreativeDirector(name) {
  return CREATIVE_DIRECTORS.includes(normalizeCdName(name));
}

function isValidSoundEngineer(name) {
  return SOUND_ENGINEERS.includes(String(name || "").trim());
}

function isValidEditor(name) {
  return EDITORS.includes(String(name || "").trim());
}

function parseGoogleSheetId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const idOnly = raw.match(/^[a-zA-Z0-9-_]{20,}$/);
  if (idOnly) return raw;

  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function looksLikeHtml(text) {
  const start = String(text || "").trim().slice(0, 40).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function normalizeSheetTabKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeSheetTabAliasKey(value) {
  return normalizeSheetTabKey(value).replace(/[^a-z0-9]+/g, "");
}

function isCharacterCanvasTab(value) {
  const key = normalizeSheetTabAliasKey(value);
  return key === "cc" || key === "charactercanvas";
}

function isWorldTab(value) {
  return normalizeSheetTabAliasKey(value) === "world";
}

function looksLikeAssetCodeTab(value) {
  return /^[a-z]{2,4}\d{3,}$/i.test(String(value || "").trim());
}

function getFallbackFinalSheetName(sheetNames) {
  const names = Array.isArray(sheetNames) ? sheetNames.filter(Boolean) : [];
  if (names.length !== 3) {
    return "";
  }

  const [firstName, secondName, thirdName] = names;
  const referenceTabs = names.filter((name) => isCharacterCanvasTab(name) || isWorldTab(name));
  const nonReferenceTabs = names.filter((name) => !isCharacterCanvasTab(name) && !isWorldTab(name));

  if (
    referenceTabs.length === 2 &&
    referenceTabs.some((name) => isCharacterCanvasTab(name)) &&
    referenceTabs.some((name) => isWorldTab(name)) &&
    nonReferenceTabs.length === 1
  ) {
    return nonReferenceTabs[0];
  }

  const firstTwo = [firstName, secondName];
  const hasCanvasReference = firstTwo.some((name) => isCharacterCanvasTab(name));
  const hasWorldReference = firstTwo.some((name) => isWorldTab(name));

  if ((hasCanvasReference && hasWorldReference) || looksLikeAssetCodeTab(thirdName)) {
    return thirdName;
  }

  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell || "").trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((cell) => String(cell || "").trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function normalizeExtractedLinks(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().replace(/[)\],.;]+$/g, ""))
        .map((value) => (/^www\./i.test(value) ? `https://${value}` : value))
        .map((value) => (/^docs\.google\.com\//i.test(value) ? `https://${value}` : value))
        .filter(Boolean)
    )
  );
}

function normalizeWorksheetCell(cell) {
  if (!cell) {
    return "";
  }

  return {
    value: cell.v ?? "",
    displayValue: cell.w ?? "",
    formattedValue: cell.w ?? "",
    text:
      cell.w !== undefined && cell.w !== null
        ? String(cell.w)
        : cell.v === undefined || cell.v === null
          ? ""
          : String(cell.v),
    hyperlink: cell.l?.Target || cell.l?.Rel?.Target || "",
    formula: typeof cell.f === "string" ? cell.f : "",
    html: typeof cell.h === "string" ? cell.h : ""
  };
}

function buildWorksheetRows(worksheet) {
  const rangeRef = worksheet && worksheet["!ref"];
  if (!rangeRef) {
    return [];
  }

  const range = XLSX.utils.decode_range(rangeRef);
  const rows = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = worksheet[cellRef];
      row[colIndex] = cell ? normalizeWorksheetCell(cell) : "";
    }
    rows.push(row);
  }

  return rows;
}

function toDateKeyUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;

  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseGoogleSheetsSerialDate(value) {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num < 0) return "";

  const dayCount = Math.floor(num);
  const date = new Date(GOOGLE_SHEETS_EPOCH_UTC_MS + dayCount * 86400000);

  if (Number.isNaN(date.getTime())) return "";
  const y = date.getUTCFullYear();
  if (y < 1900 || y > 2200) return "";

  return toDateKeyUTC(date);
}

function parseDateObject(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const y = date.getUTCFullYear();
  if (y < 1900 || y > 2200) return "";

  return toDateKeyUTC(date);
}

function parseIsoDateStrict(value) {
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (!match) return "";

  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);

  if (!isValidYMD(y, m, d)) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseUsSlashDateStrict(value) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;

  if (!isValidYMD(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDayFirstSlashDateStrict(value) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return "";

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;

  if (!isValidYMD(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMonthToken(token) {
  const key = String(token || "")
    .trim()
    .slice(0, 3)
    .toLowerCase();
  return Number(MONTH_LOOKUP[key] || 0);
}

function parseMonthNameDateStrict(value) {
  const normalized = String(value || "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  let match = normalized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = parseMonthToken(match[2]);
    const year = Number(match[3]);
    if (!month || !isValidYMD(year, month, day)) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  match = normalized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (!match) return "";

  const month = parseMonthToken(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !isValidYMD(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCompactDateStrict(value) {
  const match = String(value || "").trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return "";

  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!isValidYMD(y, m, d)) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseNativeDateFallback(value) {
  const candidate = String(value || "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate) return "";
  if (!/\b\d{4}\b/.test(candidate)) return "";
  if (!(/[/-]/.test(candidate) || /[A-Za-z]/.test(candidate))) return "";

  const date = new Date(candidate);
  return parseDateObject(date);
}

function parseWorkDateString(value) {
  const text = String(value || "")
    .trim()
    .replace(/^'+|'+$/g, "");
  if (!text) return "";

  const compact = parseCompactDateStrict(text);
  if (compact) return compact;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return parseGoogleSheetsSerialDate(text);
  }

  const usSlash = parseUsSlashDateStrict(text);
  const dayFirstSlash = parseDayFirstSlashDateStrict(text);
  if (usSlash && dayFirstSlash) {
    const today = todayInIST();
    if (today && usSlash > today && dayFirstSlash <= today) {
      return dayFirstSlash;
    }
    return usSlash;
  }
  if (usSlash) return usSlash;
  if (dayFirstSlash) return dayFirstSlash;

  const iso = parseIsoDateStrict(text);
  if (iso) return iso;

  const monthName = parseMonthNameDateStrict(text);
  if (monthName) return monthName;

  return parseNativeDateFallback(text);
}

function parseWorkDate(raw) {
  if (raw === null || raw === undefined) return "";

  if (raw instanceof Date) {
    return parseDateObject(raw);
  }

  if (typeof raw === "number") {
    return parseGoogleSheetsSerialDate(raw);
  }

  if (typeof raw === "string") {
    return parseWorkDateString(raw);
  }

  if (typeof raw === "object") {
    const props = ["value", "displayValue", "formattedValue", "text", "userEnteredValue"];
    for (const prop of props) {
      if (raw[prop] === undefined || raw[prop] === null || raw[prop] === raw) continue;
      const parsed = parseWorkDate(raw[prop]);
      if (parsed) return parsed;
    }
  }

  return parseWorkDateString(String(raw));
}

function shouldDebugDateParse() {
  const value = String(process.env.DEBUG_DATE_PARSE || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function logDateParse(rawDateValue, parsedDateValue, storedDateValue) {
  if (!shouldDebugDateParse()) return;

  console.log(
    `[date-parse] raw_date_value=${JSON.stringify(rawDateValue)} parsed_date_value=${
      parsedDateValue || ""
    } stored_date_value=${storedDateValue || ""}`
  );
}

function partsToDateKey(parts) {
  const out = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      out[part.type] = part.value;
    }
  }
  if (!out.year || !out.month || !out.day) return "";
  return `${out.year}-${out.month}-${out.day}`;
}

function dateKeyFromTimestampIST(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return partsToDateKey(parts);
}

function todayInIST() {
  return dateKeyFromTimestampIST(new Date().toISOString());
}

function shiftDate(dateKey, deltaDays) {
  const [y, m, d] = String(dateKey || "")
    .split("-")
    .map((n) => Number(n));

  if (!isValidYMD(y, m, d)) return "";

  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return toDateKeyUTC(date);
}

function isTruthyYes(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function convertImagesToMinutes(images) {
  const count = Number(images || 0);
  if (count <= 0) return 0;
  if (count <= 100) return count / 20;
  return 5 + (count - 100) / 15;
}

function calcDeltaMinutes(existingImages, newlyAddedImages) {
  const before = convertImagesToMinutes(existingImages);
  const after = convertImagesToMinutes(existingImages + newlyAddedImages);
  return after - before;
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
}

function makeVideoCompareKey(videoCode, acdName, imageUrl) {
  return [normalizeForKey(videoCode), normalizeForKey(acdName), normalizeForKey(imageUrl)].join("|");
}

function makeParentCompareKey(parentAssetId, acdName, imageUrl) {
  return [normalizeForKey(parentAssetId), normalizeForKey(acdName), normalizeForKey(imageUrl)].join("|");
}

function getRecordAcdName(row) {
  return normalizeAcdName(row.normalized_acd_name || row.acd_name || row.raw_acd_name);
}

function makeAcdGenerationScopeKey(row) {
  const parentAssetId = normalizeAssetId(row.parent_asset_id);
  const videoCode = normalizeAssetId(row.video_code);
  const scope = parentAssetId || videoCode;
  return makeParentCompareKey(scope, getRecordAcdName(row), normalizeUrl(row.image_url));
}

function addRollingRow(map, name, minutes, count) {
  if (!map.has(name)) {
    map.set(name, { name, totalMinutes: 0, totalCount: 0 });
  }

  const target = map.get(name);
  target.totalMinutes += Number(minutes || 0);
  target.totalCount += Number(count || 0);
}

function statusFromMinutes(minutes) {
  if (minutes < COMMITMENT_MINUTES) return "Low";
  if (Math.abs(minutes - COMMITMENT_MINUTES) < 0.0001) return "Met";
  return "Above";
}

function aggregateAcdFromRecords(acdRows) {
  const rows = Array.isArray(acdRows) ? [...acdRows] : [];
  rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const seenGeneration = new Set();
  const dailyDuplicates = new Map();
  const perVideoDaily = new Map();

  for (const row of rows) {
    const videoCode = normalizeAssetId(row.video_code);
    const workDate = String(row.work_date || "").slice(0, 10);
    const acdName = getRecordAcdName(row);
    const cdName = normalizeCdName(row.cd_name);
    const imageUrl = normalizeUrl(row.image_url);

    if (!videoCode || !workDate || !acdName || !cdName || !imageUrl) continue;

    const generationKey = makeAcdGenerationScopeKey(row);
    const dailyKey = `${workDate}|${acdName}|${cdName}`;

    if (seenGeneration.has(generationKey)) {
      dailyDuplicates.set(dailyKey, (dailyDuplicates.get(dailyKey) || 0) + 1);
      continue;
    }

    seenGeneration.add(generationKey);

    const videoDailyKey = `${videoCode}|${workDate}|${acdName}|${cdName}`;
    perVideoDaily.set(videoDailyKey, (perVideoDaily.get(videoDailyKey) || 0) + 1);
  }

  const dailyMap = new Map();

  for (const [videoDailyKey, imageCount] of perVideoDaily.entries()) {
    const [, workDate, acdName, cdName] = videoDailyKey.split("|");
    const dailyKey = `${workDate}|${acdName}|${cdName}`;
    const minutes = convertImagesToMinutes(imageCount);

    if (!dailyMap.has(dailyKey)) {
      dailyMap.set(dailyKey, {
        workDate,
        acdName,
        cdName,
        totalImages: 0,
        totalMinutes: 0
      });
    }

    const target = dailyMap.get(dailyKey);
    target.totalImages += imageCount;
    target.totalMinutes += minutes;
  }

  const dailyRows = Array.from(dailyMap.values())
    .map((row) => {
      const totalMinutes = round4(row.totalMinutes);
      const duplicatesIgnored = Number(dailyDuplicates.get(`${row.workDate}|${row.acdName}|${row.cdName}`) || 0);

      return {
        workDate: row.workDate,
        acdName: row.acdName,
        cdName: row.cdName,
        totalImages: row.totalImages,
        totalMinutes,
        duplicatesIgnored,
        commitment: COMMITMENT_MINUTES,
        shortfallOrExcess: round4(totalMinutes - COMMITMENT_MINUTES),
        status: statusFromMinutes(totalMinutes)
      };
    })
    .sort(
      (a, b) =>
        b.workDate.localeCompare(a.workDate) ||
        a.acdName.localeCompare(b.acdName) ||
        a.cdName.localeCompare(b.cdName)
    );

  const today = todayInIST();
  const start7 = shiftDate(today, -6);
  const start30 = shiftDate(today, -29);

  const rolling7Acd = new Map();
  const rolling30Acd = new Map();
  const rolling7Cd = new Map();
  const rolling30Cd = new Map();

  for (const row of dailyRows) {
    if (row.workDate >= start30 && row.workDate <= today) {
      addRollingRow(rolling30Acd, row.acdName, row.totalMinutes, row.totalImages);
      addRollingRow(rolling30Cd, row.cdName, row.totalMinutes, row.totalImages);
    }

    if (row.workDate >= start7 && row.workDate <= today) {
      addRollingRow(rolling7Acd, row.acdName, row.totalMinutes, row.totalImages);
      addRollingRow(rolling7Cd, row.cdName, row.totalMinutes, row.totalImages);
    }
  }

  function mapToRows(map, nameField) {
    return Array.from(map.values())
      .map((item) => ({
        [nameField]: item.name,
        totalMinutes: round4(item.totalMinutes),
        totalImages: item.totalCount
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes || String(a[nameField]).localeCompare(String(b[nameField])));
  }

  return {
    today,
    latestWorkDate: dailyRows.length > 0 ? dailyRows[0].workDate : "",
    dailyRows,
    rolling7Rows: mapToRows(rolling7Acd, "acdName"),
    rolling30Rows: mapToRows(rolling30Acd, "acdName"),
    rolling7CdRows: mapToRows(rolling7Cd, "cdName"),
    rolling30CdRows: mapToRows(rolling30Cd, "cdName")
  };
}

function aggregateRoleProductivity(rows, personField, countedField, actualField) {
  const input = Array.isArray(rows) ? [...rows] : [];
  input.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const dailyMap = new Map();

  for (const row of input) {
    const dateKey = dateKeyFromTimestampIST(row.created_at);
    const personName = String(row[personField] || "").trim();
    const cdName = normalizeCdName(row.cd_name);
    const counted = Number(row[countedField] || 0);
    const actual = actualField ? Number(row[actualField] || 0) : 0;

    if (!dateKey || !personName || !cdName || counted <= 0) continue;

    const key = `${dateKey}|${personName}|${cdName}`;

    if (!dailyMap.has(key)) {
      dailyMap.set(key, {
        workDate: dateKey,
        personName,
        cdName,
        totalAssets: 0,
        totalActualMinutes: 0,
        totalCountedMinutes: 0
      });
    }

    const target = dailyMap.get(key);
    target.totalAssets += 1;
    target.totalCountedMinutes += counted;
    if (actual > 0) {
      target.totalActualMinutes += actual;
    }
  }

  const dailyRows = Array.from(dailyMap.values())
    .map((row) => ({
      workDate: row.workDate,
      personName: row.personName,
      cdName: row.cdName,
      totalAssets: row.totalAssets,
      totalActualMinutes: round4(row.totalActualMinutes),
      totalCountedMinutes: round4(row.totalCountedMinutes)
    }))
    .sort(
      (a, b) =>
        b.workDate.localeCompare(a.workDate) ||
        a.personName.localeCompare(b.personName) ||
        a.cdName.localeCompare(b.cdName)
    );

  const today = todayInIST();
  const start7 = shiftDate(today, -6);
  const start30 = shiftDate(today, -29);

  const rolling7 = new Map();
  const rolling30 = new Map();

  for (const row of dailyRows) {
    if (row.workDate >= start30 && row.workDate <= today) {
      addRollingRow(rolling30, row.personName, row.totalCountedMinutes, row.totalAssets);
    }

    if (row.workDate >= start7 && row.workDate <= today) {
      addRollingRow(rolling7, row.personName, row.totalCountedMinutes, row.totalAssets);
    }
  }

  function mapToRows(map) {
    return Array.from(map.values())
      .map((item) => ({
        personName: item.name,
        totalMinutes: round4(item.totalMinutes),
        totalAssets: item.totalCount
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes || a.personName.localeCompare(b.personName));
  }

  return {
    today,
    latestWorkDate: dailyRows.length > 0 ? dailyRows[0].workDate : "",
    dailyRows,
    rolling7Rows: mapToRows(rolling7),
    rolling30Rows: mapToRows(rolling30)
  };
}

async function fetchFinalImageSheetCsv(sheetUrl) {
  const spreadsheetId = parseGoogleSheetId(sheetUrl);
  if (!spreadsheetId) {
    throw makeError(400, "Invalid Google Sheet link.");
  }

  const xlsxUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const response = await fetch(xlsxUrl, { cache: "no-store", redirect: "follow" });
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    const text = buffer.toString("utf8");
    const lower = String(text || "").toLowerCase();
    if (lower.includes("unable to parse range") || lower.includes("does not exist")) {
      throw makeError(400, "Final image sheet tab not found. Please rename the working tab before uploading.");
    }
    throw makeError(400, "Sheet link not accessible. Please check sharing settings and try again.");
  }

  if (!buffer.length || looksLikeHtml(buffer.toString("utf8"))) {
    throw makeError(400, "Sheet link not accessible. Please check sharing settings and try again.");
  }

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellText: true,
    cellHTML: true
  });

  const targetSheetName = (workbook.SheetNames || []).find(
    (sheetName) => normalizeSheetTabKey(sheetName) === normalizeSheetTabKey(FINAL_TAB_NAME)
  );

  const fallbackSheetName = targetSheetName ? "" : getFallbackFinalSheetName(workbook.SheetNames || []);
  const resolvedSheetName = targetSheetName || fallbackSheetName;

  if (!resolvedSheetName) {
    throw makeError(400, "Final image sheet tab not found. Please rename the working tab before uploading.");
  }

  return {
    spreadsheetId,
    sheetName: resolvedSheetName,
    rows: buildWorksheetRows(workbook.Sheets[resolvedSheetName])
  };
}

module.exports = {
  FINAL_TAB_NAME,
  COMMITMENT_MINUTES,
  CREATIVE_DIRECTORS,
  CANONICAL_ACD_ROSTER,
  SOUND_ENGINEERS,
  EDITORS,
  makeError,
  readJsonBody,
  supabaseRequest,
  supabaseFetchAll,
  chunk,
  normalizeHeader,
  normalizeForKey,
  normalizeAssetId,
  normalizeAcdName,
  normalizeAcdIdentity,
  normalizeCdName,
  normalizeUrl,
  parsePositiveNumber,
  isValidCreativeDirector,
  isValidSoundEngineer,
  isValidEditor,
  parseGoogleSheetId,
  parseCsv,
  parseWorkDate,
  shouldDebugDateParse,
  logDateParse,
  dateKeyFromTimestampIST,
  todayInIST,
  shiftDate,
  isTruthyYes,
  convertImagesToMinutes,
  calcDeltaMinutes,
  round2,
  round4,
  makeVideoCompareKey,
  makeParentCompareKey,
  aggregateAcdFromRecords,
  aggregateRoleProductivity,
  fetchFinalImageSheetCsv
};
