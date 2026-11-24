# WatchTube Configuration Audit

**Audit date:** November 21, 2026  
**Repository:** `D:\watchtube\watchtube`  
**Branch / HEAD:** `main` / `1857d1aeaa87e434d67a4c41a0c117acf91c41e5`  
**Verdict:** **PARTIALLY CONFIGURED** — local web-to-API connectivity is restored and verified; storage, authenticated sessions, media processing, and production readiness remain unverified or blocked.

## Scope and safety

- The checkout already contained extensive modified and untracked work. It was preserved; no reset, cleanup, commit, or push was performed.
- Environment values and credentials were not printed or copied into this report. The API's ignored local `.env` was backed up before each targeted edit.
- Only local WatchTube services were checked. No Neon account/project, production database, payment provider, R2 bucket, or R2 object was contacted or modified. No migration was applied.
- The API process used for local HTTP checks had R2/AWS credential variables blanked. Its successful API/feed responses do not prove storage access.

## Findings

### Vite API proxy and HTTP 502

The prior Vite configuration selected the API port from the generic `PORT` before the API-specific `API_PORT`. In a web development process, that generic variable can identify the web server (for example, 5173), not the API (3001). The old configuration also accepted `localhost` and `::1` as upstreams without canonicalizing them. The observed listeners were Vite on IPv6 loopback (`::1:5173`) and the API on IPv4 loopback (`127.0.0.1:3001`); an upstream aimed at the wrong port/address can therefore be refused and surface as Vite 502.

The failed Vite process's original environment was not retained, so it is not possible to prove which invalid target that specific process selected. The source-level configuration defects and the listener mismatch are confirmed.

The fix in [apps/web/vite.config.ts](./apps/web/vite.config.ts):

- Selects only `API_PORT` for the upstream port, not generic web `PORT`.
- In local-only mode reads `API_PORT` from the API package environment, with the established 3001 fallback.
- In ordinary development accepts only loopback targets unless external services are explicitly allowed, and rewrites `localhost` / `::1` targets to `127.0.0.1`.
- Preserves `/api` paths unchanged, so `/api/v1/...` reaches the same API route.
- Keeps the browser on the same `/api` route through [apps/web/src/api/apiClient.ts](./apps/web/src/api/apiClient.ts); no separate browser API host is required.

Regression coverage in [apps/web/tests/viteProxy.integration.test.mjs](./apps/web/tests/viteProxy.integration.test.mjs) verifies that generic `PORT` does not select the API port, an IPv4-only upstream is reached through a `localhost` override, request paths are preserved, and an unavailable API remains an explicit gateway failure. [apps/web/tests/apiAvailability.test.mjs](./apps/web/tests/apiAvailability.test.mjs) verifies network/gateway failures are distinguished from HTTP 401/503 responses.

**IPv4/IPv6 boundary:** The API proxy's upstream is explicitly IPv4 and is stable against `localhost` resolution. The Vite web listener itself remains IPv6-only in this environment: `http://localhost:5173/` works, while `http://127.0.0.1:5173/` is unreachable. This does not prevent the tested browser-origin proxy flow; changing the web listener to all interfaces would broaden network exposure and was not done.

### API, database, and Redis

- [apps/api/scripts/dev-local.cjs](./apps/api/scripts/dev-local.cjs) loads the API package `.env`, requires `WATCHTUBE_DATABASE_URL`, and constrains local database/cache endpoints to loopback. Local API startup connected to local PostgreSQL and Redis.
- The ignored [apps/api/.env](./apps/api/.env) had duplicate `REDIS_URL` entries, with a non-loopback value overriding the intended loopback value. It now has one local Redis entry.
- The same file had conflicting `NODE_ENV` assignments (`development` and `production`); the later value won when loaded. The duplicate production assignment was removed. A standalone `process.loadEnvFile` check now resolves `NODE_ENV=development` and found no duplicate API environment keys.
- The current API process was not restarted after the `.env` cleanup, so the mode correction takes effect on its next launch. Connectivity did not require a restart. No restart was done because the running API remained healthy and its stored R2 credential values must not be reloaded before authorized rotation is confirmed.
- `prisma migrate status`/`db:status` connected to the local database and reported five migration directories with `20261120170000_shorts_monetization_rate` pending (exit code 1 for pending migrations). No migration or database write was performed.
- Root `.env` contains external-service configuration, but the local API/worker launchers use package-local environment files. The root template/documentation does not clearly communicate this distinction; avoid assuming root `.env` values are active in local app processes.

### R2, worker, mobile, and deployment

- API `storage:check` reported configuration present, but that is a presence/configuration check—not proof of valid credentials, bucket identity, permissions, or network access. The API public R2 URL fields failed a redacted format check.
- Worker `storage:check` reported missing effective `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`; its storage configuration is not usable as currently configured. Treat any previously exposed R2 credentials as compromised until an authorized owner confirms rotation. No credentials were used for this audit.
- The configured bucket-name strings are `watchtube-raw-uploads` and `watchtube-media-public`; bucket existence and access were deliberately not checked.
- Worker `media:check` reports FFmpeg and FFprobe unavailable, blocking real transcode verification.
- Web uses a same-origin `/api` route and needs no `apps/web/.env` for this local proxy. The mobile example contains a placeholder API base URL; no mobile device/runtime check was made.
- No production deployment configuration was found during the audit. The repository's `neon.ts` stub is not evidence that Neon services are provisioned or used.

## Live local verification

Requests below were made against the actual running development services. HTTP 401 results are expected for the signed-out session and are not proxy failures.

| Request | Result |
|---|---:|
| `http://127.0.0.1:3001/health` | 200 |
| `http://localhost:5173/` | 200 |
| `http://localhost:5173/api/v1/health` (through Vite) | 200 |
| `http://localhost:5173/api/v1/ready` (through Vite) | 200 |
| `http://localhost:5173/api/v1/auth/me` (signed out) | 401 |
| `http://localhost:5173/api/v1/videos` (Home data) | 200 |
| `http://localhost:5173/api/v1/feed/trending` | 200 |
| `http://localhost:5173/api/v1/feed/shorts` | 200 |
| `http://localhost:5173/api/v1/feed/subscriptions` (signed out) | 401 |
| `http://localhost:5173/api/v1/studio/analytics` (signed out) | 401 |
| Frontend routes `/`, `/feed/trending`, `/feed/shorts`, `/feed/subscriptions`, `/profile`, `/studio` | 200 each |

No 502 was returned by the valid proxied checks. Home, Trending, and Shorts API reads returned 200. Subscriptions and Studio reached the API and returned legitimate authentication responses. The Profile page route serves, but an authenticated profile fetch was not verified. These checks do **not** prove login, logout, session refresh/restoration, populated signed-in Subscriptions, or authenticated Studio/Profile behavior; no authorized test account/session was available.

## Validation results

| Check | Result |
|---|---|
| API tests | 130/130 passed |
| Web tests | 30/30 passed |
| Worker tests | 16/16 passed |
| Mobile tests | 9/9 passed |
| Database local-guard tests | 6/6 passed |
| Backup-system synthetic tests | 18/18 passed; isolated synthetic tests, not a real database/R2 backup |
| Workspace build | 5/5 tasks passed; web emitted a large-chunk warning |
| Workspace lint | Passed; web reported 7 warnings and 0 errors |
| Mobile typecheck | Passed |
| `git diff --check` | Passed; Git emitted existing Windows line-ending notices |
| Database migration status | One pending migration; no migration run |
| API/worker storage checks | Configuration-only; do not establish R2 connectivity |
| Worker media check | FFmpeg/FFprobe unavailable |

## Changed files and operational status

The proxy correction and regression tests are in [apps/web/vite.config.ts](./apps/web/vite.config.ts), [apps/web/tests/viteProxy.integration.test.mjs](./apps/web/tests/viteProxy.integration.test.mjs), and [apps/web/tests/apiAvailability.test.mjs](./apps/web/tests/apiAvailability.test.mjs). Related documentation/tracking was updated in [apps/web/README.md](./apps/web/README.md), [WATCHTUBE_PROGRESS.md](./WATCHTUBE_PROGRESS.md), [WATCHTUBE_MASTER_COMPLETION_CHECKLIST.md](./WATCHTUBE_MASTER_COMPLETION_CHECKLIST.md), and [WATCHTUBE_MASTER_ROADMAP.md](./WATCHTUBE_MASTER_ROADMAP.md).

This audit additionally changed only the ignored local [apps/api/.env](./apps/api/.env): removed the duplicate remote Redis setting and the conflicting `NODE_ENV=production` assignment. It was backed up outside the repository before edits. This report is the new deliverable.

**Checklist status:** local API proxy/connectivity is verified; shared authentication remains partial until a real authorized session is restored and exercised; R2 rotation/access, FFmpeg processing, the pending migration, and production deployment remain blocked or unverified. Do not mark the application production-ready.
