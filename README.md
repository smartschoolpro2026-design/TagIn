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

The frontend signs in using a confirmed phone number and password. Enable Supabase Auth > Sign In / Providers > Phone, and turn OFF phone confirmation because TagIn provisions accounts administratively and does not send SMS verification codes. A Twilio or other SMS gateway is not required for this password-based flow when phone confirmation is disabled. Accounts are provisioned by a trusted administrator workflow; never expose the Supabase service-role key in the browser.

Never commit secrets. `.env.local` is ignored by Git.

## Available scripts

- `npm run dev` — start the local development server
- `npm run typecheck` — check TypeScript
- `npm run build` — type-check and build the production bundle
- `npm run preview` — preview the production build

## Project status

The frontend foundation and first phone/password authentication flow are in place. The authenticated workspace reads the signed-in user's profile and active school memberships under RLS. Role-specific operational screens, QR scanning, bus workflows, and parent notifications will follow in subsequent stages.
