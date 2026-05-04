# Signal Scanner — Web (MVP)

This folder contains a minimal Vite + React + TypeScript + Tailwind(v4) scaffold for the Signal Scanner web UI.

Quick start:

```bash
cd web
pnpm install # or npm install
pnpm dev
```

Notes:
- Uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Supabase access (MVP read-only).
- This is a frontend-only scaffold; backend APIs remain in the root `api/` serverless functions.

## Auth setup (Supabase Google OAuth)

Web now uses Supabase Auth for Google sign-in.

Required web env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE` (only when web and api are deployed separately)
- `VITE_UI_READ_KEY` (must match backend `UI_READ_KEY` for protected `/api/ui/*` routes)

`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_REDIRECT_URI`, `VITE_GOOGLE_CALLBACK_URL` are not required in this app flow because OAuth client and redirect settings are managed in Supabase.

Supabase dashboard configuration:

- Enable Google provider in Authentication > Providers.
- Add redirect URLs in Authentication > URL Configuration:
	- Local: `http://localhost:5173`
	- Production web URL (for example): `https://your-web-project.vercel.app`

Vercel settings:

- Set the same web env vars in the web project.
- Ensure backend project also has `UI_READ_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

Optional (advanced access admin):

- `UI_ADMIN_CHAT_IDS` (comma-separated Telegram chat IDs)
- `UI_ADMIN_CHAT_ID` (single admin ID fallback)

Advanced access feature:

- Advanced routes (`trigger-update`, `trigger-briefing`, `sync-*`, `report-*`) require Telegram chat based allow-list.
- Admin can add/remove/toggle users in web Settings > 고급 기능 사용자 관리.
- Access data is stored in `web_advanced_access_users` (see `db/migrations/005_web_auth_and_access_control.sql`).
