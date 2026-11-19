# WatchTube

WatchTube is a pnpm monorepo with a Vite/React viewer, an Express API, a
background media worker, and shared Prisma/database packages.

## Local development

Use Node.js compatible with Vite 8 and pnpm 10.30.3. Create
`apps/api/.env` from `apps/api/.env.example` only when you have safe local
configuration to add. The local API can start without PostgreSQL or Redis:
database-backed routes then return HTTP 503, while liveness remains available.
Never copy production credentials into a local development environment.

For the verified local PostgreSQL instance in this workspace, set the
loopback-only connection in the current PowerShell session, then start the
viewer and API:

```powershell
$env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/watchtube?schema=public'
$env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL
pnpm dev:app
```

These environment settings are process-local and do not modify an `.env` file.
If you use another local PostgreSQL role or authentication method, substitute
its local-only connection URL. Do not use a production URL.

By default, Vite serves the viewer on port 5173 and the API listens on
`API_PORT=3001`. In local-only mode, the API ignores `PORT`; Vite uses the same
`API_PORT` and always proxies to `127.0.0.1`. `pnpm dev:app` runs the API in
local-only mode. The API loads `apps/api/.env`, not the root `.env`, and refuses
non-loopback database or Redis hosts before opening connections. The Vite
development client ignores `VITE_API_BASE_URL` in local-only mode so requests go
through its local proxy. Vite's normal development proxy also rejects
non-loopback targets.

The API liveness routes are `http://127.0.0.1:3001/health` and
`http://localhost:5173/api/v1/health`. `/api/v1/ready` reports database,
Redis, and storage readiness; it returns 503 when PostgreSQL or the WatchTube
schema is unavailable. Redis and R2 are optional for basic feed and watch
requests; video processing and uploads requiring storage report service errors
instead of claiming success. Missing R2 configuration is reported by variable
name only.

On this Windows workstation, Memurai Developer provides local Redis-compatible
service on `127.0.0.1:6379`; its installer firewall rule was disabled. Verify
it with:

```powershell
& 'C:\Program Files\Memurai\memurai-cli.exe' -h 127.0.0.1 -p 6379 ping
```

The applications can also be started independently:

```powershell
pnpm --filter @watchtube/web dev
pnpm --filter @watchtube/api dev
```

For background video processing, first configure a local database, Redis,
Cloudflare R2 credentials, public media URL, and FFmpeg. Then start the worker
separately:

```powershell
pnpm --filter @watchtube/worker dev
```

The worker also requires FFmpeg and the configured storage services. API
database-backed routes require a reachable PostgreSQL database with the
WatchTube schema. Development scripts do not create databases or apply
migrations. The API can serve basic routes without Redis; queue-dependent
operations return 503 until Redis reconnects. Worker local development loads
only `apps/worker/.env` and refuses non-loopback database/Redis endpoints. A
separately started built API or web dev server may use non-loopback services
only when `WATCHTUBE_ALLOW_EXTERNAL_SERVICES=1` is explicitly set after
verifying the target identity. Never use that override for isolated smoke tests.

The API environment example contains placeholders only. Treat any real
credentials previously committed there as exposed and rotate them.

To run only the API and inspect dependency readiness:

```powershell
pnpm --filter @watchtube/api dev
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:3001/ready
```

Set `API_PORT` in the shell or `apps/api/.env` if port 3001 is occupied; use
the same value for both the API and Vite proxy. Do not start a second server on
an occupied port.

## Checks

```powershell
pnpm build
pnpm --filter @watchtube/api test
pnpm --filter @watchtube/web test
pnpm --filter @watchtube/web lint
node --test tools\backup-system\tests\core.test.mjs tools\backup-system\tests\queue-recovery.test.mjs tools\backup-system\tests\storage.test.mjs tools\backup-system\tests\postgres.test.mjs
```

The backup-system tests are synthetic and local-only; they do not verify a
production backup or restore.
