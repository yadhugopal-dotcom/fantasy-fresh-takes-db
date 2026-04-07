# Fresh Takes Gantt - Claude Code Rules

## CRITICAL: Always commit before deploying
1. Before making ANY changes, run `git status` to check for uncommitted work
2. After completing each logical change, commit immediately with a descriptive message
3. NEVER deploy without committing first
4. The deployed UI must always match what's in git
5. If you need to restore the UI, the git history has every tab's design committed separately

## Architecture
- Next.js App Router
- Single main component (UnifiedOpsApp.jsx or similar)
- Fonts: Fraunces (serif display) + DM Sans (sans body)
- Theme: warm cream/parchment background, terracotta accents, dark green numbers
- Data: Google Sheets API via service account, Supabase for planner persistence

## Tabs
- Editorial Funnel: 3 sub-views (last/this/next week) with different metrics each
- POD Wise: 2 sub-views (Performance/Tasks)
- Planner: Gantt with brush painting, roster manager, edit mode
- Analytics: Test results table with filters and colored status badges
- Production: ACD/CD productivity charts, sync status, adherence issues
- Details: Configuration page with team tracking and analytics logic docs
