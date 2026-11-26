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
4. Confirm the two public Supabase values in `.env.local`.
5. Run `npm run dev`.

Users enter their phone number and password. TagIn normalizes the phone number to E.164 and a server-side Edge Function derives a non-deliverable internal email alias before calling Supabase email/password Auth. This keeps the phone number as the user's login identifier without requiring Supabase Phone Auth, Twilio, or SMS. Accounts must be created by a trusted administrator workflow with the same alias algorithm and confirmed internal email identity; never expose the Supabase service-role key in the browser.

Never commit secrets. `.env.local` is ignored by Git.

## Available scripts

- `npm run dev` — start the local development server
- `npm run typecheck` — check TypeScript
- `npm run build` — type-check and build the production bundle
- `npm run preview` — preview the production build

## Project status

The frontend foundation and phone-identifier login Edge Function are in place. Account provisioning and first super-admin bootstrap are the next authentication tasks. The authenticated workspace reads the signed-in user's profile and active school memberships under RLS. Role-specific operational screens, QR scanning, bus workflows, and parent notifications will follow in subsequent stages.
