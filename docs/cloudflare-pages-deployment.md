# Cloudflare Pages deployment

TagIn is a Vite + React single-page application. Deploy it from the GitHub repository using Cloudflare Pages' Git integration.

## Build settings

- Repository: `smartschoolpro2026-design/TagIn`
- Production branch: `main`
- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Node.js version: `20` (set `NODE_VERSION=20` if the project settings expose environment variables)

## Required build environment variables

Set these in Cloudflare Pages → Settings → Environment variables for both Production and Preview:

- `VITE_SUPABASE_URL` = `https://wlkqsivehfwogdquodxx.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = the Supabase publishable key for this project

These are browser-visible public client values. Never add `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or other server secrets to `VITE_*` variables or the frontend build.

## Create the Pages project

1. Sign in to the Cloudflare dashboard.
2. Open **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Authorize GitHub if prompted and select `smartschoolpro2026-design/TagIn`.
4. Use the build settings above and add the two environment variables.
5. Start the deployment. Cloudflare will provide a `*.pages.dev` preview URL after a successful build.
6. Open that URL on a phone and check the login screen and responsive layout.

## Ongoing deployments

Cloudflare Pages will build new deployments from pushes to `main`. Pull requests can receive preview deployments when enabled in Pages settings.

## Notes

- `public/_redirects` is copied to the build output and provides the SPA fallback for client-side routes.
- The Supabase backend is separate and remains hosted in the existing Supabase project.
- The app currently has no production user accounts; a successful authenticated workflow still depends on completing and verifying account provisioning and phone-login Edge Function setup.
- Do not attach the WhoGoHost custom domain until the Pages preview has been tested. The initial `pages.dev` URL is sufficient for review.
