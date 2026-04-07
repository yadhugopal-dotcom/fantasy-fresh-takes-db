export const POD_LEAD_SCRIPT_CHANGES_INFO_URL =
  "https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions/list";

const POD_LEAD_ALIAS_ENTRIES = [
  ["Roth", ["Roth", "Josh Roth", "Joshua Roth", "Josh"]],
  ["Lee", ["Lee", "Paul Lee", "Paul S Lee", "Paul"]],
  ["Gilatar", ["Gilatar", "Nishant Gilatar", "Nishant"]],
  ["Woodward", ["Woodward", "Dan Woodward", "Dan"]],
  ["Shruti Nair", ["Shruti Nair", "Shruthi Nair"]],
  ["John", ["John", "John A"]],
];

export function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAliasKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

const POD_LEAD_ALIAS_MAP = new Map(
  POD_LEAD_ALIAS_ENTRIES.flatMap(([canonicalName, aliases]) =>
    aliases.map((alias) => [normalizeAliasKey(alias), canonicalName])
  )
);

export function normalizePodLeadMatchName(value) {
  const cleaned = normalizeWhitespace(value);

  if (!cleaned) {
    return "";
  }

  return POD_LEAD_ALIAS_MAP.get(normalizeAliasKey(cleaned)) || cleaned;
}

export function normalizeShowName(value) {
  return normalizeWhitespace(value);
}
