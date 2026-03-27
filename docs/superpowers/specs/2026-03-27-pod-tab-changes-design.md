# POD Tab Changes — Design Spec

## 1. Hit Rate Rework + Rename

**Rename**: "POD Performance" → "POD Lifetime Performance"

**New hit rate formula**: Scripts meeting Gen AI or P1 Rework criteria / Total live scripts

- Source: Live tab analytics rows (same data as Analytics tab, via `fetchAnalyticsLiveTabRows`)
- Filter: last week by `liveDate`
- Classification: reuse `classifyNextStep` logic from `app/api/dashboard/analytics/route.js`
- Grouping: by `podLeadName` (column C in Live tab)
- A script "hits" if `nextStep === "Gen AI"` or `nextStep === "P1 Rework"`
- Hit rate per POD = hit count / total live scripts for that POD

### Classification rules (from existing analytics)

- **Gen AI**: amount spent >= $100, CPI < $10, and <= 2 baseline benchmark misses
- **P1 Rework**: amount spent >= $100 and CTI >= 12%
- Scripts with amount spent < $100 are "Testing / Drop" (not counted as hits)

## 2. Performance / Tasks Toggle

Add a toggle in the POD-wise section (Competition tab area) switching between:
- **Performance** (current view, renamed to "POD Lifetime Performance")
- **Tasks** (new view)

### Tasks View — Per-POD Cards

Each POD lead gets a card showing three metrics:

#### A. Beats Pending Approval
- Source: Editorial tab
- Logic: same as editorial "next week" — beats for next week grouped by pod lead (column C)
- Show: X pending / Y approved (status from column N)
- "Approved" = status matches approval pattern; everything else = pending

#### B. Scripts to Review (POD Lead Backlog)
- Source: Editorial tab
- Filter: status (column N) = "Completed by writer" (case-insensitive match)
- Group by: pod lead (column C)
- Shows how many scripts each POD lead has in their review queue

#### C. Writer Production %
- Source: Planner snapshot (client-side `plannerBoardSnapshot`)
- Per POD: count writers who have >1 beat with any day in `"production"` stage
- Divide by total active writers in that POD
- Display as percentage

### API Design

**New endpoint: `/api/dashboard/pod-tasks`**

Request: `GET /api/dashboard/pod-tasks`

Response:
```json
{
  "ok": true,
  "pods": [
    {
      "podLeadName": "Paul",
      "pendingBeats": 3,
      "approvedBeats": 5,
      "scriptsToReview": 2
    }
  ]
}
```

Writer production % is computed client-side from planner snapshot (already available).

**Hit rate data**: Add to existing `/api/dashboard/competition` response as `podHitRates`:
```json
{
  "podHitRates": [
    {
      "podLeadName": "Paul",
      "totalLiveScripts": 12,
      "hitScripts": 4,
      "hitRate": 0.333
    }
  ]
}
```

## Files to Modify

| File | Change |
|---|---|
| `app/api/dashboard/competition/route.js` | Add pod hit rate calculation using analytics rows + classifyNextStep |
| `app/api/dashboard/pod-tasks/route.js` | New endpoint — fetch Editorial tab, compute pending/approved beats + scripts to review |
| `lib/live-tab.js` | Export editorial status constants if needed |
| `components/UnifiedOpsApp.jsx` | Add Performance/Tasks toggle, render Tasks cards, compute writer production % from planner snapshot, rename "POD Performance" to "POD Lifetime Performance" |

## Data Flow

```
Live tab (analytics rows)
  → classifyNextStep per script
  → group by podLeadName
  → hit rate per POD
  → served via /api/dashboard/competition

Editorial tab
  → filter next week beats → pending vs approved per POD lead
  → filter "Completed by writer" status → scripts to review per POD lead
  → served via /api/dashboard/pod-tasks

Planner snapshot (client-side)
  → count writers with >1 production beat per POD
  → writer production % computed in UnifiedOpsApp.jsx
```
