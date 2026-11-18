# WatchTube

WatchTube is a pnpm monorepo with a Vite/React viewer, an Express API, a
background media worker, and shared Prisma/database packages.

## Local development

Use Node.js compatible with Vite 8 and pnpm 10.30.3. Create
`apps/api/.env` from `apps/api/.env.example` and configure loopback PostgreSQL
and Redis services. Keep credentials out of Git and do not copy production
credentials into a local development environment.

Start the viewer and API together:

```powershell
pnpm dev:app
```

By default, Vite serves the viewer on port 5173. The API listens on `PORT`, or
3001 when unset. `pnpm dev:app` passes explicit API and proxy environment
variables through Turbo and runs the API in local-only mode. The API loads
`apps/api/.env`, not the root `.env`, and refuses non-loopback database or Redis
hosts before opening connections. Vite's normal development proxy also rejects
non-loopback targets. The isolated proxy regression test ignores env files and
uses only a temporary loopback backend.

The applications can also be started independently:

```powershell
pnpm --filter @watchtube/web dev
pnpm --filter @watchtube/api dev
```

For background video processing, start Redis and the worker separately:

```powershell
pnpm --filter @watchtube/worker dev
```

The worker also requires FFmpeg and the configured storage services. API
database-backed routes require a reachable PostgreSQL database with the
WatchTube schema. Development scripts do not apply migrations. To use
non-loopback services outside the local-only `dev:app` command, explicitly set
`WATCHTUBE_ALLOW_EXTERNAL_SERVICES=1` after verifying the target identity.
Never use that override for isolated smoke tests.

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
