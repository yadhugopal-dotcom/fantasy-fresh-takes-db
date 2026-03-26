const IST_TIME_ZONE = "Asia/Kolkata";

export const WEEK_VIEW_OPTIONS = [
  { id: "current", label: "Current week", delta: 0 },
  { id: "next", label: "Next week", delta: 1 },
  { id: "last", label: "Last week", delta: -1 },
];

const WEEK_VIEW_DELTA = Object.fromEntries(WEEK_VIEW_OPTIONS.map((option) => [option.id, option.delta]));
const WEEK_VIEW_LABELS = Object.fromEntries(WEEK_VIEW_OPTIONS.map((option) => [option.id, option.label]));

function getDateParts(value, timeZone = IST_TIME_ZONE) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function normalizeWeekView(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(WEEK_VIEW_DELTA, normalized) ? normalized : "current";
}

export function getWeekViewLabel(value) {
  return WEEK_VIEW_LABELS[normalizeWeekView(value)];
}

export function todayInIstYmd() {
  const parts = getDateParts(new Date(), IST_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isValidYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseYmdToUtcDate(value) {
  if (!isValidYmd(value)) {
    return new Date(Date.UTC(1970, 0, 1, 12));
  }

  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatYmd(value) {
  const date = value instanceof Date ? value : parseYmdToUtcDate(value);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function shiftYmd(value, days) {
  const date = parseYmdToUtcDate(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatYmd(date);
}

export function getWeekWindowFromReference(referenceDate = todayInIstYmd()) {
  const safeReference = isValidYmd(referenceDate) ? referenceDate : todayInIstYmd();
  const date = parseYmdToUtcDate(safeReference);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = shiftYmd(safeReference, mondayOffset);

  return {
    referenceDate: safeReference,
    weekStart,
    weekEnd: shiftYmd(weekStart, 6),
  };
}

export function getWeekSelection(period = "current", baseDate = todayInIstYmd()) {
  const normalizedPeriod = normalizeWeekView(period);
  const currentWindow = getWeekWindowFromReference(baseDate);
  const delta = WEEK_VIEW_DELTA[normalizedPeriod] || 0;
  const weekStart = shiftYmd(currentWindow.weekStart, delta * 7);
  const weekEnd = shiftYmd(weekStart, 6);

  return {
    period: normalizedPeriod,
    periodLabel: getWeekViewLabel(normalizedPeriod),
    referenceDate: currentWindow.referenceDate,
    weekStart,
    weekEnd,
    weekKey: weekStart,
  };
}

export function formatWeekRangeLabel(weekStart, weekEnd) {
  if (!isValidYmd(weekStart) || !isValidYmd(weekEnd)) {
    return "";
  }

  const start = parseYmdToUtcDate(weekStart);
  const end = parseYmdToUtcDate(weekEnd);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });

  return `${startLabel} - ${endLabel}`;
}
