# Notes Portal

Separate authenticated app for Gabriel's lecture notes. The original static folders are left untouched:

- `../lectures/`
- `../lecture-notes-public/`

## Current State

This app is a Supabase-backed lecture notes and study portal with:

- real Supabase email/password auth
- approved/admin account flow
- student course and lecture reader
- previous / next lecture navigation
- admin panel for users, course access, courses, and new lecture creation
- AI study assets for flashcards, quizzes, tags, and study guides
- draft review and publish/archive flow
- live Supabase data loading
- production schema
- lecture-package JSON contract for the private downloader pipeline

Without Supabase env vars, the app runs in local demo mode and stores admin changes in browser `localStorage`.

## Run Locally

```bash
npm install
npm run dev
```

Open the printed local URL. With Supabase env vars configured, sign in with an approved account.

## Supabase Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. In Supabase, go to Authentication -> Providers -> Email and turn off
   **Confirm email**. This portal uses admin approval instead of email
   confirmation, and leaving confirmation on can hit Supabase's email rate
   limit during testing.
4. Copy `.env.example` to `.env.local`.
5. Fill in frontend variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Backend/admin scripts also need:

```bash
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Never expose `SUPABASE_SECRET_KEY` to Netlify, Vercel, or browser builds unless the command being run is an admin-only server script.

If signup shows a Supabase database error on an existing project, run
`supabase/create-profile-on-signup.sql` in the Supabase SQL editor. It creates
the pending profile row automatically when Supabase Auth creates a user.

## Deploy

The repository includes config for both Netlify and Vercel.

Required frontend environment variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Build command:

```bash
npm run build
```

Publish/output directory:

```text
dist
```

## Private Pipeline Contract

The OpenClaw LXC lecture worker should export one JSON package per lecture using:

```text
docs/lecture-package.schema.json
```

Then import it with:

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run import:lecture -- package.json
```

The import script upserts the course and lecture, then writes flashcards, quizzes,
questions, tags, study guides, and a generation job. Imported study assets default
to `published` so new lecture downloader output appears without manual approval.
Set `IMPORT_ASSET_STATUS=draft` before running the importer if a batch needs review.

For local review without exposing the Supabase secret key to the browser, export a
static snapshot after importing:

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run export:supabase-snapshot
```

This writes `public/supabase-snapshot.json`, which the Vite app loads on startup.

## Production Security Note

Do not deploy the old static HTML notes as public files if account control matters. The production version should serve note content from Supabase under Row Level Security, not from directly reachable static URLs.
