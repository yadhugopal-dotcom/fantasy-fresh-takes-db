# POD Tab Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework hit rate to use Gen AI/P1 Rework classification, rename POD Performance, add Performance/Tasks toggle with editorial backlog and writer production metrics.

**Architecture:** Modify existing competition API to fix hit rate denominator (all live scripts, not just qualifying). Add new `/api/dashboard/pod-tasks` endpoint for editorial pending/approved/review metrics. Add client-side toggle in UnifiedOpsApp with Tasks view computing writer production % from planner snapshot.

**Tech Stack:** Next.js API routes, React (UnifiedOpsApp.jsx), Google Sheets CSV via live-tab.js

---

### Task 1: Fix Hit Rate Denominator in Competition API

**Files:**
- Modify: `app/api/dashboard/competition/route.js` (computeHitRatePerPod function)

- [ ] **Step 1: Update computeHitRatePerPod to use total live scripts as denominator**

In `computeHitRatePerPod`, the current denominator is `qualifying` (scripts with >= $100 spend). Change to count ALL live scripts per pod as the denominator, while hits remain scripts classified Gen AI or P1 Rework.

Find the function and change the return to track `totalLive` instead of `qualifying`:
- Count every deduplicated live script per pod as `totalLive`
- Keep hit logic unchanged (Gen AI: CPI < $10 AND <= 2 misses; P1 Rework: CTI >= 12%; both require $100+ spend)
- Return `{ totalLive, hits }` per pod

- [ ] **Step 2: Update pod row building to use new denominator**

Where `podRows` are built, use `totalLive` for `hitRateDenominator` and compute `hitRate = hits / totalLive * 100`.

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/competition/route.js
git commit -m "fix: hit rate denominator uses all live scripts, not just qualifying"
```

### Task 2: Rename POD Performance to POD Lifetime Performance

**Files:**
- Modify: `components/UnifiedOpsApp.jsx` (PodWiseContent, Toolbar title)

- [ ] **Step 1: Rename title and subtitle**

Change `<Toolbar title="POD Wise" subtitle="Lifetime leaderboard">` and any "POD wise leaderboard" text to "POD Lifetime Performance".

- [ ] **Step 2: Commit**

```bash
git add components/UnifiedOpsApp.jsx
git commit -m "feat: rename POD Performance to POD Lifetime Performance"
```

### Task 3: Create /api/dashboard/pod-tasks Endpoint

**Files:**
- Create: `app/api/dashboard/pod-tasks/route.js`

- [ ] **Step 1: Create the route file**

```javascript
import { NextResponse } from "next/server";
import {
  POD_LEAD_ORDER,
  fetchEditorialTabRows,
  normalizePodLeadName,
} from "../../../../lib/live-tab.js";
import { getWeekSelection } from "../../../../lib/week-view.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

export async function GET() {
  try {
    const { rows: editorialRows } = await fetchEditorialTabRows();
    const nextWeek = getWeekSelection("next");

    const pods = POD_LEAD_ORDER.map((podName) => {
      const podKey = normalizeKey(podName);
      const podRows = (editorialRows || []).filter(
        (row) => normalizeKey(row.podLeadName) === podKey
      );

      // Beats pending vs approved for next week
      const nextWeekRows = podRows.filter((row) => {
        const date = row.submittedDate || "";
        return date >= nextWeek.weekStart && date <= nextWeek.weekEnd;
      });
      const approvedBeats = nextWeekRows.filter(
        (row) => normalizeKey(row.status) === "approved for production by cl"
      ).length;
      const pendingBeats = nextWeekRows.length - approvedBeats;

      // Scripts to review (status = "Completed by writer")
      const scriptsToReview = podRows.filter(
        (row) => normalizeKey(row.status) === "completed by writer"
      ).length;

      return {
        podLeadName: podName,
        pendingBeats,
        approvedBeats,
        scriptsToReview,
      };
    });

    return NextResponse.json({ ok: true, pods });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load POD tasks." },
      { status: error.statusCode || 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/dashboard/pod-tasks/route.js
git commit -m "feat: add /api/dashboard/pod-tasks endpoint for editorial backlog"
```

### Task 4: Add Performance/Tasks Toggle and Tasks View in UnifiedOpsApp

**Files:**
- Modify: `components/UnifiedOpsApp.jsx`

- [ ] **Step 1: Add state for toggle and pod-tasks data**

Add near existing competition state (~line 1630):
```javascript
const [podWiseView, setPodWiseView] = useState("performance");
const [podTasksData, setPodTasksData] = useState(null);
const [podTasksLoading, setPodTasksLoading] = useState(false);
```

- [ ] **Step 2: Add fetch for pod-tasks**

In the existing useEffect that fetches competition data, also fetch pod-tasks:
```javascript
fetch("/api/dashboard/pod-tasks", { cache: "no-store" })
  .then((res) => res.json())
  .then((data) => { if (data.ok) setPodTasksData(data); })
  .catch(() => {})
  .finally(() => setPodTasksLoading(false));
```

- [ ] **Step 3: Compute writer production % from planner snapshot**

Add a `useMemo` that computes per-POD writer production percentage:
```javascript
const writerProductionByPod = useMemo(() => {
  if (!plannerBoardSnapshot?.pods) return {};
  const result = {};
  for (const pod of plannerBoardSnapshot.pods) {
    const podName = String(pod?.cl || "").trim();
    if (!podName) continue;
    const writers = (pod.writers || []).filter((w) => w?.active !== false);
    const total = writers.length;
    const withProduction = writers.filter((writer) => {
      const beats = Object.values(writer?.beats || {});
      let productionBeats = 0;
      for (const beat of beats) {
        const assets = beat?.assets || [];
        for (const asset of assets) {
          const days = asset?.days || [];
          if (days.some((d) => d === "production")) {
            productionBeats++;
            break;
          }
        }
      }
      return productionBeats > 1;
    }).length;
    result[podName] = { total, withProduction, pct: total > 0 ? Math.round((withProduction / total) * 100) : 0 };
  }
  return result;
}, [plannerBoardSnapshot]);
```

- [ ] **Step 4: Add toggle UI and Tasks view to PodWiseContent**

Update PodWiseContent to accept new props and render toggle + tasks cards:
- Toggle buttons: "Performance" | "Tasks"
- Performance view: existing bar chart (unchanged)
- Tasks view: one card per POD with three metrics

- [ ] **Step 5: Commit**

```bash
git add components/UnifiedOpsApp.jsx
git commit -m "feat: add Performance/Tasks toggle with editorial backlog and writer production metrics"
```

### Task 5: Deploy and Verify

- [ ] **Step 1: Deploy**

```bash
npx vercel --prod
```

- [ ] **Step 2: Verify on production**
- Check POD Wise tab shows "POD Lifetime Performance"
- Check hit rate uses all live scripts as denominator
- Toggle between Performance and Tasks
- Tasks view shows pending/approved beats, scripts to review, writer production %
