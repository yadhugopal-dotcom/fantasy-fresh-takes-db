# Fresh Take Gantt

Next.js tracker for Pocket FM fresh take planning with read-only public access, password-gated edit mode, shared writer configuration, week-based nested asset timelines, Google Sheets-backed beat docs, and Slack PNG sharing.

## Local development

1. Copy `.env.example` to `.env.local` and fill in the values.
2. Run `npm install`.
3. Run `npm run dev`.

## Required environment variables

- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` (optional fallback for the server-side storage route)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (currently unused by the app, but safe to set for future client-side Supabase work)
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_EDIT_PASSWORD` or `EDIT_PASSWORD`
- `EDIT_SESSION_SECRET`
- `SUPABASE_STORAGE_BUCKET` (optional, defaults to `fresh-take-gantt`)
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`
- `GOOGLE_SERVICE_ACCOUNT_KEY`
- `POD_LEAD_SCRIPT_CHANGES_REFRESH_SECRET` (optional, for the protected manual refresh endpoint)

## Deployment

Deploy the folder on Vercel and set the same environment variables for Development, Preview, and Production.

The Slack bot should have `files:write` access and be invited to the target channel.
The current persistence layer stores writer config and weekly snapshots as private JSON objects in Supabase Storage via server-side routes.
The Google service account must have Sheets read access to the `Ideation running list` tab in the shared tracker spreadsheet.
The Google service account project also needs the Google Drive API enabled to power the `POD Lead Script Changes` page.
