/**
 * Fuzzy matching utilities for correlating Planner names with Sheet data.
 */

const FILLER_WORDS = new Set([
  "v2", "v3", "v4", "v5", "adaptation", "fresh", "take", "outline",
  "compression", "the", "a", "an", "of", "and", "in", "for",
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenize(value) {
  return normalize(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function significantTokens(value) {
  return tokenize(value).filter((t) => !FILLER_WORDS.has(t));
}

/**
 * Match a Planner writer name against a list of Sheet writer names.
 * Returns the matched Sheet name or null.
 *
 * Priority: exact > first+lastInitial > uniqueFirstName
 */
export function matchWriterName(plannerName, sheetNames) {
  const pNorm = normalize(plannerName);
  if (!pNorm) return null;

  // 1. Exact match
  for (const sheetName of sheetNames) {
    if (normalize(sheetName) === pNorm) return sheetName;
  }

  // 2. First name + last initial
  const pParts = pNorm.split(/\s+/);
  if (pParts.length >= 2) {
    const pFirst = pParts[0];
    const pLastInitial = pParts[pParts.length - 1][0];
    for (const sheetName of sheetNames) {
      const sParts = normalize(sheetName).split(/\s+/);
      if (sParts.length >= 2) {
        const sFirst = sParts[0];
        const sLastInitial = sParts[sParts.length - 1][0];
        if (pFirst === sFirst && pLastInitial === sLastInitial) return sheetName;
      }
    }
  }

  // 3. Unique first name match
  const pFirst = pNorm.split(/\s+/)[0];
  const firstNameMatches = sheetNames.filter((sn) => normalize(sn).split(/\s+/)[0] === pFirst);
  if (firstNameMatches.length === 1) return firstNameMatches[0];

  return null;
}

/**
 * Match a Planner show name against Sheet show names.
 * Case-insensitive exact match.
 */
export function matchShowName(plannerShow, sheetShows) {
  const pNorm = normalize(plannerShow);
  if (!pNorm) return null;

  for (const sheetShow of sheetShows) {
    if (normalize(sheetShow) === pNorm) return sheetShow;
  }

  return null;
}

/**
 * Match a Planner angle/beat name against Sheet angle/beat names.
 * Tries: exact > substring containment > significant word overlap.
 */
export function matchAngleName(plannerAngle, sheetAngles) {
  const pNorm = normalize(plannerAngle);
  if (!pNorm) return null;

  // 1. Exact match
  for (const sheetAngle of sheetAngles) {
    if (normalize(sheetAngle) === pNorm) return sheetAngle;
  }

  // 2. Substring containment
  for (const sheetAngle of sheetAngles) {
    const sNorm = normalize(sheetAngle);
    if (pNorm.includes(sNorm) || sNorm.includes(pNorm)) return sheetAngle;
  }

  // 3. Significant word overlap
  const pTokens = significantTokens(plannerAngle);
  if (pTokens.length === 0) return null;

  let bestMatch = null;
  let bestOverlap = 0;
  for (const sheetAngle of sheetAngles) {
    const sTokens = significantTokens(sheetAngle);
    if (sTokens.length === 0) continue;
    const overlap = pTokens.filter((t) => sTokens.includes(t)).length;
    const score = overlap / Math.max(pTokens.length, sTokens.length);
    if (score > 0.5 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = sheetAngle;
    }
  }

  return bestMatch;
}
