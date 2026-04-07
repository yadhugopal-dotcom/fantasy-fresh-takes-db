# Writer Delivery Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "This Week" Editorial Funnel view with a Writer Delivery Tracker that compares Planner commitments against actual Sheet status, with spillover awareness and fuzzy matching.

**Architecture:** New API endpoint `/api/dashboard/writer-tracker` that fetches Planner state + Editorial tab rows, performs server-side fuzzy matching to classify each beat as this-week / spillover / ambiguous, and returns a structured payload. The frontend renders 4 sections: Planning Health, Writer Delivery table (expandable), Stage Breakdown pipeline, and Efficiency Stats. The existing overview route stays untouched for last/next week views.

**Tech Stack:** Next.js App Router API routes, Google Sheets gviz CSV API, Supabase Storage for planner config, React with CSS classes (no Tailwind).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/fuzzy-match.js` | **Create** | Writer name matching + show/angle matching utilities |
| `lib/live-tab.js` | **Modify** | Add Column W (leadSubmittedDate:22) and Column Y (moveToProduction:24) to EDITORIAL_TAB_COL_INDEX. Add `fetchReadyForProductionTabRows()` function. |
| `app/api/dashboard/writer-tracker/route.js` | **Create** | New API: loads Planner + Editorial + RFP tabs, runs fuzzy matching, classifies beats, returns structured payload |
| `app/api/dashboard/overview/route.js` | **Modify** | For `period === "current"`, also fetch Editorial rows and call the new tracker builder, merging results into existing payload |
| `components/UnifiedOpsApp.jsx` | **Modify** | Replace the `period === "current"` branch of `OverviewWeekSection` with 4 new sections |
| `app/globals.css` | **Modify** | Add CSS for tracker table, stage pipeline, expandable rows |

---

## Task 1: Extend Editorial Tab Column Mapping

**Files:**
- Modify: `lib/live-tab.js:95-105` (EDITORIAL_TAB_COL_INDEX)
- Modify: `lib/live-tab.js:744-758` (normalizeEditorialTabRow)

- [ ] **Step 1: Add new column indices to EDITORIAL_TAB_COL_INDEX**

```javascript
const EDITORIAL_TAB_COL_INDEX = {
  assetCode: 1,
  podLead: 2,
  writer: 3,
  showName: 6,
  beatName: 7,
  productionType: 8,
  reworkType: 9,
  status: 13,
  submittedDate: 20,
  leadSubmittedDate: 22,
  moveToProduction: 24,
};
```

- [ ] **Step 2: Update normalizeEditorialTabRow to parse new columns**

Add these two lines to the return object in `normalizeEditorialTabRow`:

```javascript
    leadSubmittedDate: parseLiveDate(row[EDITORIAL_TAB_COL_INDEX.leadSubmittedDate]),
    moveToProduction: normalizeText(row[EDITORIAL_TAB_COL_INDEX.moveToProduction]),
```

- [ ] **Step 3: Build and verify**

Run: `./node_modules/.bin/next build 2>&1 | tail -5`
Expected: Build succeeds. No existing code breaks because the new fields are additive.

- [ ] **Step 4: Commit**

```bash
git add lib/live-tab.js
git commit -m "feat: add leadSubmittedDate and moveToProduction to editorial tab mapping"
```

---

## Task 2: Add Ready for Production Tab Fetcher

**Files:**
- Modify: `lib/live-tab.js` (add new constant, column index, normalizer, fetch function)

- [ ] **Step 1: Add tab name constant**

After line 19 (`export const IDEATION_TAB_NAME = "Ideation tracker";`), add:

```javascript
export const READY_FOR_PRODUCTION_TAB_NAME = "Ready for Production";
```

- [ ] **Step 2: Add column index mapping**

After the IDEATION_TAB_COL_INDEX block (around line 110), add:

```javascript
const READY_FOR_PRODUCTION_TAB_COL_INDEX = {
  assetCode: 1,
  podLead: 2,
  writer: 3,
  showName: 6,
  beatName: 7,
  productionType: 8,
  submittedDate: 20,
  leadSubmittedDate: 22,
};
```

Note: Adjust column indices after checking the actual "Ready for Production" tab in the Sheet. The spec says "Column structure is similar to Editorial tab" so we start with the same indices.

- [ ] **Step 3: Add normalizer and fetch function**

After `fetchEditorialTabRows` (around line 763), add:

```javascript
function normalizeReadyForProductionTabRow(rawRow, rowIndex) {
  const row = Array.isArray(rawRow) ? rawRow : [];

  return {
    rowIndex,
    assetCode: normalizeText(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.assetCode]),
    podLeadName: normalizePodLeadName(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.podLead]),
    writerName: normalizeText(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.writer]),
    showName: normalizeText(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.showName]),
    beatName: normalizeText(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.beatName]),
    productionType: normalizeText(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.productionType]),
    submittedDate: parseLiveDate(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.submittedDate]),
    leadSubmittedDate: parseLiveDate(row[READY_FOR_PRODUCTION_TAB_COL_INDEX.leadSubmittedDate]),
  };
}

export async function fetchReadyForProductionTabRows() {
  return fetchTrackerTabRows(READY_FOR_PRODUCTION_TAB_NAME, normalizeReadyForProductionTabRow);
}
```

- [ ] **Step 4: Build and verify**

Run: `./node_modules/.bin/next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/live-tab.js
git commit -m "feat: add Ready for Production tab fetcher"
```

---

## Task 3: Create Fuzzy Matching Library

**Files:**
- Create: `lib/fuzzy-match.js`

- [ ] **Step 1: Create the fuzzy matching module**

```javascript
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
```

- [ ] **Step 2: Build and verify**

Run: `./node_modules/.bin/next build 2>&1 | tail -5`
Expected: Build succeeds (module is not imported yet, but should parse fine).

- [ ] **Step 3: Commit**

```bash
git add lib/fuzzy-match.js
git commit -m "feat: add fuzzy matching library for writer/show/angle names"
```

---

## Task 4: Create Writer Tracker API Route

**Files:**
- Create: `app/api/dashboard/writer-tracker/route.js`

This is the core backend logic. It loads Planner state + Editorial rows + RFP rows, fuzzy-matches writers and beats, classifies each beat into this-week / spillover / ambiguous, and returns a structured payload.

- [ ] **Step 1: Create the route file**

```javascript
import { NextResponse } from "next/server";
import { readJsonObject } from "../../../../lib/storage.js";
import {
  fetchEditorialTabRows,
  fetchReadyForProductionTabRows,
  isNonBauPodLeadName,
} from "../../../../lib/live-tab.js";
import {
  buildPodsModel,
  createDefaultWriterConfig,
  getCurrentWeekKey,
  getWeekDates,
  isVisiblePlannerPodLeadName,
  mergeWeekData,
  mergeWriterConfig,
} from "../../../../lib/tracker-data.js";
import { getWeekSelection, formatWeekRangeLabel } from "../../../../lib/week-view.js";
import { matchWriterName, matchShowName, matchAngleName } from "../../../../lib/fuzzy-match.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_PATH = "config/writer-config.json";

function makePlannerWeekPath(weekKey) {
  return `weeks/${weekKey}.json`;
}

function getIstDayOfWeek() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
  return istDate.getDay(); // 0=Sun, 1=Mon, ...
}

function isDateInCurrentWeek(dateStr, weekStart, weekEnd) {
  if (!dateStr) return false;
  return dateStr >= weekStart && dateStr <= weekEnd;
}

function isDateBeforeCurrentWeek(dateStr, weekStart) {
  if (!dateStr) return false;
  return dateStr < weekStart;
}

function classifyEditorialBeat(row, weekStart, weekEnd, plannerBeatKeys) {
  const status = String(row.status || "").toLowerCase();
  const writerName = String(row.writerName || "").trim().toLowerCase();
  const showName = String(row.showName || "").trim().toLowerCase();
  const beatName = String(row.beatName || "").trim().toLowerCase();
  const submitted = row.submittedDate || "";

  // Completed scripts
  if (status.includes("completed by writer") || status.includes("completed")) {
    if (isDateInCurrentWeek(submitted, weekStart, weekEnd)) {
      return "this_week";
    }
    if (isDateBeforeCurrentWeek(submitted, weekStart)) {
      return "spillover";
    }
    // Completed but no date — treat as spillover (shouldn't happen per spec)
    return submitted ? "spillover" : "spillover";
  }

  // WIP scripts — check Planner match
  if (status.includes("wip")) {
    // Check if this beat matches a Planner allocation for this writer
    const matchKey = `${writerName}|${showName}|${beatName}`;
    if (plannerBeatKeys.has(matchKey)) {
      return "this_week";
    }
    return "ambiguous";
  }

  // Unknown status — default to ambiguous
  return "ambiguous";
}

function classifyRfpBeat(row, weekStart, weekEnd) {
  const submitted = row.submittedDate || row.leadSubmittedDate || "";
  if (isDateInCurrentWeek(submitted, weekStart, weekEnd)) {
    return "this_week";
  }
  return "spillover";
}

function deriveStage(row, isRfp) {
  if (isRfp) return "ready_for_production";
  if (row.moveToProduction && String(row.moveToProduction).toLowerCase() !== "false") {
    return "moving_to_production";
  }
  if (row.leadSubmittedDate) return "reviewed_by_lead";
  const status = String(row.status || "").toLowerCase();
  if (status.includes("completed")) return "pending_review";
  return "writing";
}

export async function GET(request) {
  const url = new URL(request.url);
  const includeNewShowsPod = url.searchParams.get("includeNewShowsPod") === "true";

  try {
    const weekSelection = getWeekSelection("current");
    const weekStart = weekSelection.weekStart;
    const weekEnd = weekSelection.weekEnd;
    const weekLabel = formatWeekRangeLabel(weekStart, weekEnd);
    const dayOfWeek = getIstDayOfWeek();

    // Load Planner state
    const storedConfig = await readJsonObject(CONFIG_PATH);
    const currentConfig = mergeWriterConfig(storedConfig || createDefaultWriterConfig());
    const currentWeekKey = getCurrentWeekKey();
    const storedWeek = await readJsonObject(makePlannerWeekPath(currentWeekKey));
    const weekData = mergeWeekData(currentConfig, storedWeek, currentWeekKey);
    const pods = buildPodsModel(currentConfig, weekData).filter((pod) =>
      isVisiblePlannerPodLeadName(pod?.cl)
    );

    // Load Sheet data in parallel
    const [{ rows: editorialRows }, rfpResult] = await Promise.all([
      fetchEditorialTabRows(),
      fetchReadyForProductionTabRows().catch(() => ({ rows: [] })),
    ]);
    const rfpRows = Array.isArray(rfpResult?.rows) ? rfpResult.rows : [];

    // Build Planner allocation map: writer -> [{ showName, beatTitle, podLead }]
    const writerAllocations = [];
    const plannerBeatKeys = new Set();

    for (const pod of pods) {
      if (!includeNewShowsPod && isNonBauPodLeadName(pod.cl)) continue;

      for (const writer of pod.writers || []) {
        if (writer.active === false) continue;
        const beats = (writer.beats || []).filter(
          (b) => String(b.beatTitle || "").trim() || String(b.showName || "").trim()
        );
        if (beats.length === 0) continue;

        writerAllocations.push({
          podLead: pod.cl,
          writerName: writer.name,
          writerId: writer.id,
          allocatedBeats: beats.map((b) => ({
            beatTitle: b.beatTitle || "",
            showName: b.showName || "",
          })),
        });
      }
    }

    // Collect unique Sheet writer names for fuzzy matching
    const allSheetWriterNames = [
      ...new Set([
        ...editorialRows.map((r) => r.writerName).filter(Boolean),
        ...rfpRows.map((r) => r.writerName).filter(Boolean),
      ]),
    ];

    // Build fuzzy Planner beat keys for WIP matching
    for (const alloc of writerAllocations) {
      const matchedSheetName = matchWriterName(alloc.writerName, allSheetWriterNames);
      const writerKey = (matchedSheetName || alloc.writerName).trim().toLowerCase();

      for (const beat of alloc.allocatedBeats) {
        const showKey = beat.showName.trim().toLowerCase();
        const beatKey = beat.beatTitle.trim().toLowerCase();
        plannerBeatKeys.add(`${writerKey}|${showKey}|${beatKey}`);

        // Also add with fuzzy angle matching for the sheet's angle names
        const writerEditorialRows = editorialRows.filter(
          (r) => r.writerName && r.writerName.trim().toLowerCase() === writerKey
        );
        const sheetAngles = writerEditorialRows
          .filter((r) => r.showName && r.showName.trim().toLowerCase() === showKey)
          .map((r) => r.beatName);
        const matchedAngle = matchAngleName(beat.beatTitle, sheetAngles);
        if (matchedAngle) {
          plannerBeatKeys.add(`${writerKey}|${showKey}|${matchedAngle.trim().toLowerCase()}`);
        }
      }
    }

    // Classify editorial rows by writer
    const writerBeatMap = new Map();

    for (const row of editorialRows) {
      if (!row.writerName) continue;
      if (!includeNewShowsPod && isNonBauPodLeadName(row.podLeadName)) continue;

      const classification = classifyEditorialBeat(row, weekStart, weekEnd, plannerBeatKeys);
      const writerKey = row.writerName.trim().toLowerCase();

      if (!writerBeatMap.has(writerKey)) {
        writerBeatMap.set(writerKey, {
          writerName: row.writerName,
          podLead: row.podLeadName || "",
          thisWeek: [],
          spillovers: [],
          ambiguous: [],
        });
      }

      const entry = writerBeatMap.get(writerKey);
      const beatInfo = {
        showName: row.showName,
        beatName: row.beatName,
        status: row.status,
        submittedDate: row.submittedDate,
        stage: deriveStage(row, false),
      };

      if (classification === "this_week") entry.thisWeek.push(beatInfo);
      else if (classification === "spillover") entry.spillovers.push(beatInfo);
      else entry.ambiguous.push(beatInfo);
    }

    // Classify RFP rows
    for (const row of rfpRows) {
      if (!row.writerName) continue;
      if (!includeNewShowsPod && isNonBauPodLeadName(row.podLeadName)) continue;

      const classification = classifyRfpBeat(row, weekStart, weekEnd);
      const writerKey = row.writerName.trim().toLowerCase();

      if (!writerBeatMap.has(writerKey)) {
        writerBeatMap.set(writerKey, {
          writerName: row.writerName,
          podLead: row.podLeadName || "",
          thisWeek: [],
          spillovers: [],
          ambiguous: [],
        });
      }

      const entry = writerBeatMap.get(writerKey);
      const beatInfo = {
        showName: row.showName,
        beatName: row.beatName,
        status: "Ready for Production",
        submittedDate: row.submittedDate || row.leadSubmittedDate,
        stage: "ready_for_production",
      };

      if (classification === "this_week") entry.thisWeek.push(beatInfo);
      else entry.spillovers.push(beatInfo);
    }

    // Build per-writer tracker rows, merging Planner allocations with Sheet data
    const trackerRows = [];

    for (const alloc of writerAllocations) {
      const matchedSheetName = matchWriterName(alloc.writerName, allSheetWriterNames);
      const writerKey = (matchedSheetName || alloc.writerName).trim().toLowerCase();
      const sheetData = writerBeatMap.get(writerKey) || {
        thisWeek: [],
        spillovers: [],
        ambiguous: [],
      };

      const allocated = alloc.allocatedBeats.length;
      const thisWeekCount = sheetData.thisWeek.length;
      const gap = Math.max(0, allocated - thisWeekCount);

      trackerRows.push({
        podLead: alloc.podLead,
        writerName: alloc.writerName,
        sheetWriterName: matchedSheetName || "",
        allocated,
        thisWeekCount,
        gap,
        spilloverCount: sheetData.spillovers.length,
        ambiguousCount: sheetData.ambiguous.length,
        thisWeekBeats: sheetData.thisWeek,
        spilloverBeats: sheetData.spillovers,
        ambiguousBeats: sheetData.ambiguous,
        allocatedBeats: alloc.allocatedBeats,
      });
    }

    // Sort by pod lead then writer name
    trackerRows.sort((a, b) => {
      const podComp = a.podLead.localeCompare(b.podLead);
      if (podComp !== 0) return podComp;
      return a.writerName.localeCompare(b.writerName);
    });

    // Aggregate stage breakdown (Category 1 beats only)
    const stageCounts = {
      writing: 0,
      pending_review: 0,
      reviewed_by_lead: 0,
      moving_to_production: 0,
      ready_for_production: 0,
    };
    for (const row of trackerRows) {
      for (const beat of row.thisWeekBeats) {
        const stage = beat.stage || "writing";
        if (stageCounts[stage] !== undefined) {
          stageCounts[stage] += 1;
        }
      }
    }

    const totalSpillovers = trackerRows.reduce((s, r) => s + r.spilloverCount, 0);

    // Planning health
    const totalAllocated = trackerRows.reduce((s, r) => s + r.allocated, 0);
    const totalThisWeek = trackerRows.reduce((s, r) => s + r.thisWeekCount, 0);

    // Efficiency: scripts per writer (reviewed by lead this week / allocated writers)
    const reviewedByLeadThisWeek = stageCounts.reviewed_by_lead + stageCounts.moving_to_production + stageCounts.ready_for_production;
    const allocatedWriterCount = trackerRows.filter((r) => r.allocated > 0).length;

    return NextResponse.json({
      ok: true,
      weekLabel,
      weekStart,
      weekEnd,
      dayOfWeek,
      totalAllocated,
      totalThisWeek,
      totalGap: Math.max(0, totalAllocated - totalThisWeek),
      totalSpillovers,
      trackerRows,
      stageCounts,
      scriptsPerWriter: allocatedWriterCount > 0
        ? Number((reviewedByLeadThisWeek / allocatedWriterCount).toFixed(1))
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load writer tracker." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `./node_modules/.bin/next build 2>&1 | tail -10`
Expected: Build succeeds with new route listed under `f /api/dashboard/writer-tracker`.

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/writer-tracker/route.js
git commit -m "feat: add writer-tracker API with fuzzy matching and beat classification"
```

---

## Task 5: Add Writer Tracker State and Data Fetching to UnifiedOpsApp

**Files:**
- Modify: `components/UnifiedOpsApp.jsx` (state + useEffect + Toolbar props)

- [ ] **Step 1: Add state variables**

In the `UnifiedOpsApp` function, after the `overviewPeriod` state, add:

```javascript
  const [writerTrackerData, setWriterTrackerData] = useState(null);
  const [writerTrackerLoading, setWriterTrackerLoading] = useState(false);
  const [writerTrackerError, setWriterTrackerError] = useState("");
```

- [ ] **Step 2: Add useEffect for data fetching**

After the existing overview fetch effect, add:

```javascript
  useEffect(() => {
    if (activeView !== "overview" || overviewPeriod !== "current") {
      return undefined;
    }

    let cancelled = false;

    async function loadWriterTracker() {
      setWriterTrackerLoading(true);
      setWriterTrackerError("");
      try {
        const response = await fetch(
          `/api/dashboard/writer-tracker?includeNewShowsPod=${includeNewShowsPod}`,
          { cache: "no-store" }
        );
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load writer tracker.");
        }
        if (!cancelled) {
          setWriterTrackerData(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setWriterTrackerError(error.message || "Unable to load writer tracker.");
        }
      } finally {
        if (!cancelled) {
          setWriterTrackerLoading(false);
        }
      }
    }

    void loadWriterTracker();
    return () => {
      cancelled = true;
    };
  }, [activeView, overviewPeriod, includeNewShowsPod]);
```

- [ ] **Step 3: Pass tracker data to OverviewContent**

Update the `<OverviewContent>` call to pass the new props:

```jsx
<OverviewContent
  period={overviewPeriod}
  overviewDataByPeriod={effectiveOverviewDataByPeriod}
  overviewLoadingByPeriod={effectiveOverviewLoadingByPeriod}
  overviewErrorByPeriod={effectiveOverviewErrorByPeriod}
  productionDataByPeriod={productionDataByPeriod}
  productionLoadingByPeriod={productionLoadingByPeriod}
  productionErrorByPeriod={productionErrorByPeriod}
  writerTrackerData={writerTrackerData}
  writerTrackerLoading={writerTrackerLoading}
  writerTrackerError={writerTrackerError}
  onShare={copySection}
  copyingSection={copyingSection}
/>
```

Update `OverviewContent` function signature and pass through:

```javascript
function OverviewContent({
  period,
  overviewDataByPeriod,
  overviewLoadingByPeriod,
  overviewErrorByPeriod,
  productionDataByPeriod,
  productionLoadingByPeriod,
  productionErrorByPeriod,
  writerTrackerData,
  writerTrackerLoading,
  writerTrackerError,
  onShare,
  copyingSection,
}) {
  return (
    <OverviewWeekSection
      period={period}
      overviewData={overviewDataByPeriod[period]}
      overviewLoading={Boolean(overviewLoadingByPeriod[period])}
      overviewError={overviewErrorByPeriod[period] || ""}
      productionData={productionDataByPeriod[period]}
      productionLoading={Boolean(productionLoadingByPeriod[period])}
      productionError={productionErrorByPeriod[period] || ""}
      writerTrackerData={writerTrackerData}
      writerTrackerLoading={writerTrackerLoading}
      writerTrackerError={writerTrackerError}
      onShare={onShare}
      isSharing={copyingSection === `Editorial Funnel ${getWeekViewLabel(period)}`}
    />
  );
}
```

- [ ] **Step 4: Build and verify**

Run: `./node_modules/.bin/next build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add components/UnifiedOpsApp.jsx
git commit -m "feat: add writer tracker state and data fetching"
```

---

## Task 6: Rebuild "This Week" View UI

**Files:**
- Modify: `components/UnifiedOpsApp.jsx` (the `period === "current"` branch of `OverviewWeekSection`)
- Modify: `app/globals.css`

- [ ] **Step 1: Replace the current "This week" branch**

Replace the entire `if (period === "current") { ... }` block in `OverviewWeekSection` with 4 new sections. The component now receives `writerTrackerData`, `writerTrackerLoading`, `writerTrackerError` as props.

The new render has:
1. **Section 1 - Planning Health**: progress bar showing X of 17-20 beats
2. **Section 2 - Writer Delivery Tracker**: expandable table grouped by POD
3. **Section 3 - Stage Breakdown**: horizontal pipeline flow
4. **Section 4 - Efficiency Stats**: 3 small metric cards (scripts per writer, TAT, CL review)

This is a large JSX block. The full implementation should follow the spec's layout exactly. Key data mapping:

- `writerTrackerData.totalAllocated` -> Section 1 beat count
- `writerTrackerData.trackerRows` -> Section 2 table rows (grouped by `podLead`)
- `writerTrackerData.stageCounts` -> Section 3 pipeline
- `writerTrackerData.scriptsPerWriter` -> Section 4 card 1
- Existing `overviewData` TAT and CL review fields -> Section 4 cards 2-3
- `writerTrackerData.dayOfWeek` -> conditional gap styling (1=Mon, 2=Tue, etc.)

The Writer Delivery Tracker table uses local React state `expandedWriters` (a Set of writer names) to toggle beat-level detail.

- [ ] **Step 2: Add CSS classes for new sections**

Add to `globals.css`:

```css
/* Writer Delivery Tracker */
.planning-health-bar { ... }
.tracker-table { ... }
.tracker-row-expandable { ... }
.tracker-beat-detail { ... }
.stage-pipeline { ... }
.stage-pipeline-node { ... }
.stage-pipeline-connector { ... }
.gap-green { color: var(--forest); }
.gap-amber { color: var(--gold); }
.gap-red { color: var(--red); }
.flag-icon { color: var(--gold); }
```

(Exact CSS to be written during implementation based on the design system.)

- [ ] **Step 3: Build and verify**

Run: `./node_modules/.bin/next build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add components/UnifiedOpsApp.jsx app/globals.css
git commit -m "feat: rebuild This Week view with Writer Delivery Tracker"
```

---

## Task 7: Integration Test and Polish

**Files:**
- Possibly modify: `app/api/dashboard/writer-tracker/route.js`, `components/UnifiedOpsApp.jsx`, `app/globals.css`

- [ ] **Step 1: Start production server and test**

```bash
./node_modules/.bin/next build && ./node_modules/.bin/next start -p 3847
```

Then verify:
- Editorial Funnel -> This Week view loads the new tracker
- Last Week and Next Week views are unchanged
- "Include new shows POD" toggle filters tracker data
- Expanding a writer row shows beat-level detail
- Stage pipeline shows correct counts
- Gap colors change based on day of week
- Other tabs (POD Wise, Planner, Analytics, Production, Details) are unaffected

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit and push**

```bash
git add -A
git commit -m "polish: writer delivery tracker integration fixes"
git push origin main
```

---

## Risk Notes

1. **Ready for Production tab may not exist** in the Sheet. The fetch is wrapped in `.catch(() => ({ rows: [] }))` so it fails gracefully. If the tab doesn't exist, RFP beats simply won't appear.

2. **Column indices for RFP tab** are assumed identical to Editorial tab. Verify against the actual Sheet before deploying. The `READY_FOR_PRODUCTION_TAB_COL_INDEX` may need adjustment.

3. **Writer name quality** depends on what users typed into the Planner roster. If names are very different from Sheet names (e.g., nicknames), fuzzy matching may miss. The `matchWriterName` function logs these misses and they can be diagnosed from the `sheetWriterName` field in the API response.

4. **Date format** depends on Google Sheets locale. The existing `parseLiveDate` handles multiple formats including dd/mm/yyyy, but if the Sheet returns dates as serial numbers or ISO strings via the gviz CSV export, the parser handles those too.

5. **Performance**: The route makes 3 parallel fetches (Planner config + Editorial + RFP) and does O(writers * beats) fuzzy matching. This should be fast enough for the current data size (<100 writers, <500 editorial rows).
