# Exam Quiz Portal

Separate authenticated app for Gabriel's private exam-practice quizzes.

## Current State

This app is a Supabase-backed exam quiz portal with:

- real Supabase email/password auth
- approved/admin account flow
- student course and quiz access
- admin panel for users, course access, and courses
- imported exam MCQ packages with source references, marks, topics, and diagram assets
- publish/archive flow
- live Supabase data loading
- production schema
- exam-quiz-package JSON contract for the private exam pipeline

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

## Exam Quiz Pipeline Contract

The exam ingestion worker should export one JSON package per paper using:

```text
docs/exam-quiz-package.schema.json
```

Then import it with:

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... IMPORT_ASSET_STATUS=published npm run import:exam-quiz -- package.json
```

The import script upserts the course and exam container, then writes the quiz,
questions, source metadata, diagram assets, and a generation job. Imported study
assets default to `draft`; set `IMPORT_ASSET_STATUS=published` for approved quiz
packages.

For local review without exposing the Supabase secret key to the browser, export a
static snapshot after importing:

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run export:supabase-snapshot
```

This writes `public/supabase-snapshot.json`, which the Vite app loads on startup.

## Production Security Note

Do not deploy source PDFs or old static HTML study material as public files. The
production version should serve quiz data from Supabase under Row Level Security.
