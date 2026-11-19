# FriendMail — fixed and expanded

A GitHub Pages-compatible frontend plus a **separate Cloudflare Worker + D1 database** for accounts, messages, friends, and PNG profile photos.

## Logo rendering hotfix (November 2026)

The favicon is used in the browser tab only. Both in-page logo placements now use **size-limited CSS background badges**, not raw `<img>` elements; even if someone replaces `favicon.png` with a very large image, it cannot expand over the sign-in page or app header. The HTML gives both badges explicit dimensions as a fallback when an older stylesheet is cached. Asset URLs have new version query strings to invalidate old GitHub Pages/browser caches.

To publish this fix, upload **the contents of this ZIP** to the exact GitHub Pages publishing folder, keeping `index.html`, `style.css`, `favicon.png`, `icons.js`, `app.js`, and `config.js` alongside each other. Do not paste the 512px `icon-preview.png` directly into HTML. If the layout is still broken, open DevTools → Network and confirm `style.css?v=logo-fix-2` returns HTTP 200 (not 404), then hard-refresh. This is a frontend-only change; your existing Worker code does not need another deployment.

## What changed

- Replaced the incorrectly labeled, watermarked `favicon.png` (formerly WebP) with an original, real PNG favicon, plus `.ico` and Apple touch icon.
- Added a **Friends** tab: up to 5 randomly selected people (refreshed every 45 seconds), username search, invitations, incoming accept/decline, outgoing cancellation, messaging friends, and removal.
- Added clickable account/profile controls and PNG image upload. PNG files up to 2 MB are cropped/resized locally, verified on the server, then stored in D1; you can also remove your avatar.
- Shipped the API backend that was **absent** from the original ZIP, plus a D1 schema. GitHub Pages alone cannot host an API or persistent shared accounts.
- Made API errors identify connection, CORS, timeout, missing configuration, expired session, and missing endpoint problems.
- Fixed false delete functionality: messages are now actually hidden for the deleting user on the server, while the other user's copy remains.
- Reduced XSS risks by allowlisting rich-text tags/links, avoiding unsafe contact-option HTML, and escaping dynamic names. Fixed dialog display, draft isolation by account, request races, unread counts, and responsive layout.
- Removed dependence on the Google Material Symbols icon font; icons are local inline SVGs. Inter is optional with a system-font fallback.
- Added a runnable in-memory local preview, API integration tests, and CI checks.

> **Important:** The ZIP does **not** update your live GitHub Pages site or your Cloudflare Worker automatically. The new features will not work publicly until you deploy the new Worker + database and publish the new frontend. The old external API from the original project could not be confirmed reachable. Existing accounts/messages in a previous backend do **not** automatically migrate into a new D1 database. Export/migrate them first if they must be kept; never deploy a new schema over a production database without a backup.

## Try the full app locally (no Cloudflare account required)

1. Install **Node.js 22+**.
2. From this directory run:

   ```bash
   node --experimental-sqlite tests/local-server.mjs
   ```

3. Visit **http://localhost:8000/**, register two test accounts (different browsers/incognito profiles), and try friends, messaging, and photos.

The local server swaps in a local API URL and uses **temporary in-memory SQLite**. All local-preview test accounts are lost when you stop it. Do not use this test server for public hosting.

## Deploy the real Cloudflare backend

1. Create/sign into a Cloudflare account and install Node.js. From this repository:

   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler d1 create friendmail-db
   ```

2. Wrangler prints a `database_id` UUID. Open **`worker/wrangler.toml`**, replace `REPLACE_WITH_YOUR_DATABASE_ID` with this exact UUID, and check `database_name` matches your D1 database.
3. In `worker/wrangler.toml`, set **`ALLOWED_ORIGINS`** to *every actual frontend origin* (comma-separated, no paths, no trailing `/`), for example:

   ```toml
   ALLOWED_ORIGINS = "https://YOUR-USERNAME.github.io,https://your-custom-domain.example,http://localhost:8000"
   ```

   GitHub Pages URLs such as `https://YOUR-USERNAME.github.io/email/` have the origin `https://YOUR-USERNAME.github.io`, without `/email/`. Custom domains are a different origin. Add both if you use both.
4. Apply the database migration **before** deploying the Worker:

   ```bash
   npx wrangler d1 migrations apply friendmail-db --remote
   npx wrangler deploy
   ```

5. Copy the HTTPS `*.workers.dev` URL printed by the deploy command. Open **`config.js`** in the repository root and set:

   ```js
   window.FRIENDMAIL_API_BASE = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api';
   ```

   If you deploy over the original Worker name, the existing default URL in `config.js` may already match; **verify it**. The Worker code contains no hard-coded account secrets.
6. Open `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/health`. If everything is bound properly it returns `{"status":"ok"}`. This endpoint only tests Worker/D1 connectivity, not that the migration ran; registering an account is the functional check.

**If you have an existing Cloudflare Worker/database**, do not assume this SQL schema matches the old schema. Use a fresh D1 database/Worker or plan a proper data migration, including password hashes and sessions.

## Publish to GitHub Pages

1. Replace your repository files with the **contents** of this folder (the `index.html`, `style.css`, `app.js`, `icons.js`, `config.js`, favicon files, etc. at the site root).
2. Commit/push to the branch published by GitHub Pages. For a typical repository, open **Settings → Pages → Deploy from a branch → main → /(root)**. If your repo already uses GitHub Actions or a custom domain, retain your existing GitHub Pages workflow and domain settings.
3. Open your **HTTPS** site (a custom domain must have its certificate active). Hard-refresh to clear any cached JS.
4. Sign up/sign in, open Friends, and test from a second account. The Friends tab uses live server data — no simulated friends.

## Troubleshooting “Failed to fetch”

- **Wrong Worker URL:** Inspect `config.js`. It must be the deployed HTTPS Worker, and it must end with `/api`. Verify `/api/health` in a browser.
- **Worker isn't deployed / DNS issue:** Re-run `npx wrangler deploy`. View errors with `npx wrangler tail` from `worker/`.
- **CORS blocked:** In `worker/wrangler.toml`, `ALLOWED_ORIGINS` must contain the **exact** frontend origin. Redeploy after editing it. Check DevTools → Network for failed `OPTIONS` preflights. Do not use `*` for all sites.
- **500 Server error:** Make sure `DB` is bound, the `database_id` is correct, and the migration has run against the **remote** database.
- **401 Session expired:** Sign in again. A session issued by the old Worker will not be valid against a freshly deployed database.
- **404 endpoint not found:** You're likely using the old Worker code; update it with `worker/index.js`.
- **GitHub Pages loads but buttons don't work:** Ensure that **all** new static files were committed, including `config.js` and `icons.js`.

## Run tests

From the repository root with Node 22+:

```bash
node --check app.js
node --check icons.js
node --check worker/index.js
node --experimental-sqlite --test tests/api.test.mjs
```

The integration tests exercise the real Worker handler using a SQLite-backed D1 adapter: registration, password verification, authorizations, messages, friend requests, acceptance/removal, avatars, CORS, and logout. The in-memory test backend is intentionally not a replacement for a real D1 database.

## Project structure

```text
index.html, style.css        GitHub Pages interface
app.js, icons.js, config.js  Frontend logic, vector icons, API location
favicon.png, favicon.ico    Browser icons
apple-touch-icon.png        Apple homescreen icon
icon-preview.png            Large icon preview
worker/index.js             Cloudflare API handler
worker/wrangler.toml        Cloudflare configuration (edit placeholders)
worker/migrations/          Database schema
worker/package.json         Wrangler commands
tests/api.test.mjs          Backend integration suite
tests/local-server.mjs      Disposable local full-stack demo
```

## Practical security limits

FriendMail uses TLS when deployed over HTTPS, PBKDF2-hashed passwords, hashed expiring bearer sessions, input validation, SQL parameter binding, restricted browser origins, and HTML sanitization in the frontend. **It is not end-to-end encrypted.** Message contents and profile icons are stored on the server, and avatars are publicly accessible by username. If you want a public production email service, also add abuse protection/rate limits, spam controls, moderation and account recovery, stronger CSP, secure token storage strategy, automated DB backups, and privacy/data-retention policies. It is a **private-user-to-user messaging demo**, not an internet email service that sends to arbitrary SMTP mailboxes.
