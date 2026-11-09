# WeekendCheck

A weekly review desk for indie builders: public project lists and reviews, a private admin, and an X scheduling grid.

## Configure and run

1. Put the Postgres connection in `.env` as `DATABASE_URL`. For Supabase over IPv4, use the **Session pooler** connection from the project's Connect panel. Remote connections use verified TLS; `DATABASE_SSL_CA` can supply a root certificate if required. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
2. Set `APP_URL=http://localhost:3000` locally, or your exact HTTPS origin in production.
3. Set your own `ADMIN_PASSWORD` (12–256 characters).
4. Choose media storage:
   - Supabase: `MEDIA_STORAGE=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `SUPABASE_STORAGE_BUCKET` (default: `weekendcheck-media`).
   - Local development / persistent server: `MEDIA_STORAGE=local`. Set `WEEKENDCHECK_DATA_DIR` for a persistent media directory.
5. Run:

```bash
npm install
npm run db:migrate
npm run storage:init
npm run dev
```

Open http://localhost:3000/admin and sign in with the password configured above. No signup or other user roles.

The migration creates an **empty** workspace. It does not drop old tables, clear Supabase, or import the previous JSON store. For optional demo data, run `npm run db:seed` before creating anything; it refuses to overwrite a used workspace.

No Supabase connection is embedded in this repository. The existing local environment pointed to `localhost:5433/weekendcheck`; replace that value before applying migrations to Supabase.

### Local Postgres alternative

If you want a local database instead of Supabase:

```bash
docker compose -f compose.dev.yaml up -d
```

Use `DATABASE_URL=postgresql://weekendcheck:weekendcheck_dev@localhost:5433/weekendcheck` and `MEDIA_STORAGE=local`, then run the setup commands above. The development database uses a separate named volume. Docker must be running.

## Authentication and security

- One server-managed admin password, stored as a randomly salted scrypt hash in Postgres.
- The password environment variable is used by setup/rotation commands, not compared on every login.
- Opaque 12-hour sessions: only token hashes are stored in the database. Cookies are HttpOnly, SameSite=Strict, host-only, and Secure on HTTPS.
- Logout revokes the session. Expired sessions are rejected. Password rotation revokes all sessions.
- Login attempts are limited to 10 per 15 minutes across all instances. This is a global sole-admin limit, deliberately independent of untrusted IP headers.
- Every admin API (including uploads, export, X import, and scheduler status) verifies the session. Mutating browser requests require the exact configured Origin.
- Admin pages redirect to `/login`. Draft media is accessible only to the admin; anonymous media access requires a reference in a currently published review/project or public avatar.
- Supabase media uses a **private** bucket. Do not make it public. Credentials stay on the server.
- The app-owned `weekendcheck` schema is not exposed to public/anonymous roles. Its tables have RLS enabled without client-access policies; use the migration-owning server database role.
- Request size limits, parameterized SQL, transaction rollback, row locks, and revision checks protect writes.

To change or recover your admin password, update `ADMIN_PASSWORD` securely on the server, then run:

```bash
npm run admin:set-password
```

Changing the environment variable alone does not change an existing account.

## Data and media

The small, single-admin editorial workspace is stored as a versioned JSONB aggregate in `weekendcheck.workspace`. PostgreSQL transactions and a row lock serialize updates from multiple web/worker processes. This keeps publication snapshots and the existing review workflow atomic without a second ORM model.

Sessions, password hashes, login limits, and worker heartbeats are separate tables. Media is outside the database, in Supabase Storage or an explicitly configured persistent filesystem.

There is no silent fallback to JSON files when Postgres fails. The old `.weekendcheck/editorial.json` is not deleted. The admin JSON export includes editorial data, but excludes passwords, sessions, credentials, and media bytes. Back up the database and media separately.

The migration only creates app-owned objects. It does **not** drop `public`, `auth`, `storage`, or any old tables. Destructive cleanup should only happen after the correct remote project has been inspected and backed up.

## Weekly workflow

1. Open this week (Monday is calculated; creation remains manual).
2. Add projects manually or import X replies into an editable, deduplicated preview.
3. Choose Quick take or Deep review directly in the weekly list; no quotas or scoring. Previously reviewed/reserved projects cannot be picked again.
4. Publish the weekly selection. Subsequent edits remain private until republished.
5. Write/reorder thread posts and add screenshots or video. Publish or schedule a website snapshot. Publishing or scheduling a review also adds that project to the public week; other unpublished week changes stay private.
6. Copy a review into an X draft, or compose a standalone X post. The weekly grid has clickable 30-minute slots and preserves the selected week.
7. Complete the week once its selected reviews are published.

Website scheduling is separate from X posting. Due website snapshots appear on requests after their scheduled time; no browser or cron is needed for that.

## X integration

### Import

Set `X_BEARER_TOKEN` and restart the web app. The importer uses X's [recent search endpoint](https://docs.x.com/x-api/posts/search-recent-posts), follows conversation replies automatically, and extracts website URLs/metadata/author handles. This is deterministic extraction, not an AI model.

Recent search is limited to the last seven days and your API account's access/usage limits. Each batch reads up to 1,000 replies; Stop and Continue controls preserve fetched results. Candidates remain editable, and imports commit at most 200 projects per batch. Replies without usable website URLs need manual entry. Paste import remains available without X credentials.

### Automatic posting

Configure `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` with OAuth 1.0a user-context Read and Write permission. Set `X_POSTING_ENABLED=true`. For Vercel + Supabase, use the scheduled endpoint setup below. On an always-on server, the original worker is also available:

```bash
npm run scheduler
```

Both the worker and scheduled endpoint **send due posts to X**. They use the web app's database and media storage, verify that the connected X account matches the handle in Settings, and record a heartbeat in Postgres.

Standard 280-character weighted X posts, threads, images and MP4 uploads are supported. Use up to four still images (5 MB each), or one GIF (15 MB) / MP4 (50 MB). External media URLs and WebM are website-only. X may reject unsupported codecs/durations.

Claims and individual receipts persist in the database. Long threads can yield between confirmed posts and continue on the next scheduled request, using the saved reply IDs. Definite failures can be rescheduled; uncertain sends or failures partway through a thread stop for manual inspection and are never automatically retried. Check X, finish any missing replies manually, and use Mark as published with the actual URL. Schedules not started within 15 minutes are held rather than posted unexpectedly late. Interrupted publishing is flagged after 20 minutes on the next scheduler run.

No real X posts are sent by automated tests.

### X daily (growth helper)

Admin → X daily is a read-only helper for daily X activity. It never posts, replies, likes or follows; all engagement is done by hand in the X app.

- **Today:** posts and replies against daily goals, a streak (days both goals were hit), six daily quests, unique and new people replied to, the share of replies going to your top 10, the reply mix by account size against a target, and reply speed to Big/Star accounts (the parent post's time comes from its snowflake ID, so it costs nothing).
- **Discover:** people who replied to or mentioned you but you never replied to, plus up to N new accounts a day from niche keyword search. Mark them Replied, Keep warm, or Skip; an account is never suggested twice, and replying to one clears it automatically.
- **People:** the keep-warm list (anyone replied to on 3+ days in 14, plus pinned accounts), flagged after the quiet limit; and the week's top 10 regulars.
- **Settings:** goals, timezone (days start at local midnight), size tiers (default Small < 1k, Middle 1k–10k, Big 10k–25k, Star 25k+), mix target, speed limits, keywords and daily cost caps.

Counting rules: replies to yourself (thread continuations) count for neither goal; quotes count as posts; reposts are ignored. "New people" means the first reply since tracking began, so it is overcounted for the first week.

It uses the same OAuth 1.0a keys as automatic posting (`X_POSTING_ENABLED` is not required) and runs only on production. A sync runs when the page opens or regains focus and the data is over 10 minutes old, or with Sync now (at most once a minute). The first sync backfills 7 days of posts and 3 days of mentions. X's pay-per-use API is billed per resource returned: your own posts and mentions at the owned-read rate ($0.001), keyword search posts at $0.005 (read 10 at a time, stopping once the day's target is met or the search cap is hit), and follower lookups at $0.01 (new accounts once, active contacts refreshed monthly, under a daily cap). The page shows an estimate from recorded reads; the real bill is in the X developer console. Data is stored in `weekendcheck.x_daily_*` tables (migration 003), separate from the editorial workspace.

## Deploy to Vercel with Supabase

Keep the existing Vercel Next.js project. Use the default `npm run build` build command. Vercel hosts the site and API; Supabase stores the database and media.

Set these variables in Vercel's project settings for the Production environment, then redeploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection; use the transaction pooler for serverless runtime connections. Never use the local development URL. |
| `APP_URL` | Exact canonical HTTPS origin, including `www` if used; no path. Sign in at this origin. |
| `MEDIA_STORAGE` | `supabase` |
| `SUPABASE_URL` | Your Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key; never prefix it with `NEXT_PUBLIC_`. |
| `SUPABASE_STORAGE_BUCKET` | `weekendcheck-media` (or your chosen private bucket). |
| `X_POSTING_ENABLED` | `true` to enable automatic posting after configuring the scheduled trigger below. |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | OAuth 1.0a credentials for the X account in Admin Settings, with Read and Write permission. |
| `CRON_SECRET` | A fresh random secret of at least 32 characters, shared only with Supabase Vault. |

Add `X_BEARER_TOKEN` only if using the X reply importer. Add `DATABASE_SSL_CA` if your database connection requires a supplied root certificate. Do not copy production credentials to untrusted preview deployments.

Before serving the new app, configure a trusted local shell's `.env` with the **production** Supabase connection (the session pooler is suitable for setup), storage credentials, and your chosen `ADMIN_PASSWORD` (12–256 characters), then run:

```bash
npm run db:migrate
npm run storage:init
```

These commands create the app schema, initial admin account, and private media bucket; they do not delete old tables. They are not run automatically by a Vercel deployment. `ADMIN_PASSWORD` is only needed for setup/rotation, not as a Vercel runtime variable. Updating an environment variable alone does not change the stored password.

After redeploying, check `/api/health` and sign in at `/login`. A successful build alone does not prove the remote database has been initialized.

### Enable automatic X posting without another service

Vercel runs `/api/cron/x` as a Node.js function; Supabase Cron calls it once a minute. There is no permanent server to start and the browser can be closed. Supabase Cron is used because [Vercel Hobby cron jobs run only once daily](https://vercel.com/docs/cron-jobs/usage-and-pricing).

1. Enable **Fluid compute** in Vercel project settings so the function supports its configured 300-second maximum. See [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).
2. Generate a new secret locally with `openssl rand -hex 32`. Put it in Vercel **Production** environment variables as `CRON_SECRET`; keep the X credentials and `X_POSTING_ENABLED=true` there too. Redeploy this version of the app.
3. In Supabase **Vault**, create `weekendcheck_cron_secret` with that exact secret and `weekendcheck_app_url` with your canonical production origin (same as `APP_URL`, such as `https://your-site.com`). Use the final HTTPS origin so the cron request does not redirect.
4. Run [scripts/supabase-x-cron.sql](scripts/supabase-x-cron.sql) in Supabase SQL Editor. It enables `pg_cron`/`pg_net` and creates or updates the `weekendcheck-x-posts` job. The SQL reads the bearer secret from Vault; it contains no credentials. See [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).
5. After a minute, Admin → Schedule should show **X scheduler is active**. The heartbeat means the trigger reached the app, not that X has accepted your credentials; account verification happens when a post is due. Check Vercel function logs and `net._http_response` for HTTP failures. Supabase cron history alone only confirms that the HTTP request was queued.

The endpoint rejects missing/incorrect secrets and Vercel preview deployments. Each invocation processes at most ten threads within a time budget; concurrent invocations cannot claim the same thread. Threads may continue across ticks, and each confirmed reply is recorded before yielding. A hard timeout or uncertain X response still stops automatic retries. Start times are approximate, normally the next minute's tick, and backlog/platform delays can increase that. No `vercel.json` cron entry or extra hosting provider is required. Disable any old always-on worker once using Supabase Cron.

If Vercel Deployment Protection covers your production domain, allow the scheduled request to reach the endpoint using Vercel's protection-bypass mechanism; the endpoint still requires `CRON_SECRET`. Do not disable the endpoint's authorization.

**Remaining media limitation:** uploads currently pass through the app endpoint; Vercel's 4.5 MB request limit means large uploads need direct signed Supabase uploads before they will work. See [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Deploy to an always-on server (alternative)

A Docker configuration is included for a web service plus optional scheduler. Supply `.env` on the server; it is excluded from the image. Set `APP_URL` to the public HTTPS origin and put an HTTPS reverse proxy in front of port 3000. The Compose port is bound to localhost only.

```bash
docker compose build web
docker compose run --rm web npm run db:migrate
docker compose run --rm web npm run storage:init
docker compose up -d web
# Only once X posting is configured and you want the worker to send posts:
docker compose --profile scheduler up -d scheduler
```

The containers run as a non-root user. Local media, if selected, is stored in a shared named volume; Supabase Storage does not require shared local files. Migrations are explicit and do not run on every startup.

`/api/health` checks database availability without exposing connection details. Automatic X posting requires either the Supabase Cron trigger above or the original always-on worker. Serverless request-size limits may also require direct signed media uploads.

A hosting destination, HTTPS/domain configuration, and actual Supabase credentials must be supplied before a remote deployment can be completed.

## Verification

```bash
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:browser
npm audit
```

Tests create a temporary real Postgres instance bound to loopback, with a random password and a separate test database. They never use `.env` database credentials. Browser tests run a production build on port 3108 with a temporary media directory and test-only admin session. The test runner stops Postgres after completion; temporary test directories can be removed later.

Tests cover transaction conflicts/rollback, publication snapshots, session expiry/revocation, login throttling, private media, anonymous API denial, CSRF, the full review workflow, calendar slots, and X failure handling. Supabase Storage and live X API access require their real credentials and must be verified separately.
