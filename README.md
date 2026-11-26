# TagIn

A multi-school student arrival, departure, and transport coordination platform.

## Technology

- React + Vite + TypeScript
- Supabase Auth and Postgres (existing project)
- Row Level Security for school-level data isolation

## Getting started

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the project's public browser credentials.
5. Run `npm run dev`.

Never put a Supabase service-role key in a browser environment or commit secrets. `.env.local` is ignored by Git.

## Available scripts

- `npm run dev` — start the local development server
- `npm run typecheck` — check TypeScript
- `npm run build` — type-check and build the production bundle
- `npm run preview` — preview the production build

## Project status

The initial frontend foundation is in place. Authentication flows, role-specific dashboards, QR scanning, notifications, and bus workflows will be implemented in subsequent steps after the database schema and authorization rules are verified.
