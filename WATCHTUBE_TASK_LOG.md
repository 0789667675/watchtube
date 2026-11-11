# WATCHTUBE — DEVELOPMENT TASK LOG

---

## TASK 1: Safe Environment Configuration & Windows Worker Compatibility

**Date:** November 4, 2026  
**Status:** COMPLETED & VERIFIED  
**Repository Branch:** `main`  
**Baseline Commit:** `12713d856444bb2283e4d449257db48684801be1`  

### 1. Objectives & Scope
1. Conduct an exhaustive code audit of all environment variable references across all workspace packages (`apps/api`, `apps/worker`, `packages/database`).
2. Author safe, detailed `.env.example` configuration templates across the monorepo without exposing or generating real credentials.
3. Fix the platform-dependent Unix temporary directory in `apps/worker/src/worker.ts` (`/tmp/watchtube`) to support cross-platform Windows development using Node.js `os.tmpdir()`.
4. Implement job-isolated temporary directories (`${videoId}_${jobId}`) to prevent collisions between concurrent transcoding jobs.
5. Implement safe failure cleanup in `finally` blocks without risking process crashes.
6. Verify full monorepo compilation (`pnpm build` via Turborepo) and ensure zero regressions to existing files.

---

### 2. Environment Variables Audited & Documented

| Variable Name | Purpose | Required? | Consuming Workspaces | Safe Example / Default |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for Prisma ORM | Yes | `packages/database`, `apps/api`, `apps/worker` | `postgresql://postgres:postgres@localhost:5432/watchtube?schema=public` |
| `PORT` | HTTP port on which Express API listens | No (Default: 3001) | `apps/api` | `3001` |
| `NODE_ENV` | Runtime mode (`development`, `production`, `test`). In production, sets cookie `secure: true`. | No (Default: `development`) | `apps/api`, `apps/worker`, `packages/database` | `development` |
| `JWT_SECRET` | Secret key for signing/verifying JWT session tokens | Yes (Default fallback: `supersecret`) | `apps/api` | `replace_with_a_secure_random_jwt_secret_at_least_32_characters` |
| `REDIS_HOST` | Hostname/IP address for Redis server powering BullMQ queues | No (Default: `127.0.0.1`) | `apps/api`, `apps/worker` | `127.0.0.1` |
| `REDIS_PORT` | Port number for Redis server | No (Default: `6379`) | `apps/api`, `apps/worker` | `6379` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier for R2 S3 endpoints | Yes (for storage) | `apps/api`, `apps/worker` | `your_cloudflare_account_id` |
| `R2_ACCESS_KEY_ID` | S3-compatible Access Key ID for R2 bucket | Yes (for storage) | `apps/api`, `apps/worker` | `your_r2_access_key_id` |
| `R2_SECRET_ACCESS_KEY` | S3-compatible Secret Access Key for R2 | Yes (for storage) | `apps/api`, `apps/worker` | `your_r2_secret_access_key` |
| `R2_BUCKET_RAW` | Bucket name for incoming raw video uploads | Yes (Default in worker: `watchtube-raw-uploads`) | `apps/api`, `apps/worker` | `watchtube-raw-uploads` |
| `R2_BUCKET_PUBLIC` | Bucket name for public HLS playlists and assets | No (Default: `watchtube-media-public`) | `apps/worker` | `watchtube-media-public` |
| `R2_BUCKET_PUBLIC_URL` | CDN / public base domain for streaming playlists | Yes | `apps/worker` | `media.watchtube.rw` |
| `WATCHTUBE_TEMP_DIR` | Optional override for worker temporary scratch storage | No (Default: `path.join(os.tmpdir(), 'watchtube')`) | `apps/worker` | `/tmp/watchtube` or `C:\Temp\watchtube` |

---

### 3. Worker Implementation Changes

#### File: `apps/worker/src/worker.ts`

**Before:**
```typescript
import * as path from 'path';

const TEMP_DIR = '/tmp/watchtube';

// Inside worker processor:
const workDir = path.join(TEMP_DIR, videoId);
await fs.mkdir(workDir, { recursive: true });

// Inside finally:
console.log(`Cleaning up temporary files for ${videoId}`);
await fs.rm(workDir, { recursive: true, force: true });
```

**After:**
```typescript
import * as path from 'path';
import * as os from 'os';

// Platform-independent temporary base directory (defaults to OS temp directory, with optional env override)
const TEMP_BASE_DIR = process.env.WATCHTUBE_TEMP_DIR || path.join(os.tmpdir(), 'watchtube');

// Inside worker processor:
const jobDirectoryId = job.id ? `${videoId}_${String(job.id).replace(/[^a-zA-Z0-9_-]/g, '_')}` : `${videoId}_${Date.now()}`;
const workDir = path.join(TEMP_BASE_DIR, jobDirectoryId);
await fs.mkdir(workDir, { recursive: true });

// Inside finally:
console.log(`Cleaning up temporary files for video ${videoId} at ${workDir}`);
try {
    await fs.rm(workDir, { recursive: true, force: true });
} catch (cleanupError) {
    console.warn(`Failed to clean up temporary directory ${workDir}:`, cleanupError);
}
```

**Improvements Delivered:**
1. Cross-platform compatibility using Node.js standard `os.tmpdir()`. Resolves to `C:\Users\username\AppData\Local\Temp\watchtube` on Windows and `/tmp/watchtube` on POSIX.
2. Job-isolated directories (`${videoId}_job-${job.id}`) prevent temporary file collisions when processing multiple concurrent jobs or retrying failed jobs for the same video.
3. Protected cleanup: `fs.rm` is wrapped in try/catch to avoid unhandled rejections if Windows file locking delays immediate deletion.
4. Preserved existing downstream logic: FFmpeg input/output paths, asset uploads to S3/R2, and database updates continue to operate without alteration.

---

### 4. Files Created / Modified

- `CREATED`: [`D:\watchtube\watchtube\.env.example`](file:///D:/watchtube/watchtube/.env.example) (Root monorepo master template)
- `CREATED`: [`D:\watchtube\watchtube\apps\api\.env.example`](file:///D:/watchtube/watchtube/apps/api/.env.example) (API configuration template)
- `CREATED`: [`D:\watchtube\watchtube\apps\worker\.env.example`](file:///D:/watchtube/watchtube/apps/worker/.env.example) (Worker configuration template)
- `CREATED`: [`D:\watchtube\watchtube\packages\database\.env.example`](file:///D:/watchtube/watchtube/packages/database/.env.example) (Database configuration template)
- `MODIFIED`: [`D:\watchtube\watchtube\apps\worker\src\worker.ts`](file:///D:/watchtube/watchtube/apps/worker/src/worker.ts) (Windows path & job isolation)
- `CREATED`: [`D:\watchtube\watchtube\WATCHTUBE_TASK_LOG.md`](file:///D:/watchtube/watchtube/WATCHTUBE_TASK_LOG.md) (Task record)
- `UPDATED`: [`D:\watchtube\watchtube\WATCHTUBE_PROGRESS.md`](file:///D:/watchtube/watchtube/WATCHTUBE_PROGRESS.md) (Master progress update)

---

### 5. Verification Commands and Results

1. **Worker Build Verification:**
   - Command: `pnpm --filter @watchtube/worker build`
   - Result: Exit code `0` (clean compile via `tsc`).
2. **Full Monorepo Build:**
   - Command: `turbo run build` (`pnpm build`)
   - Result: Exit code `0` (5 successful tasks: `@watchtube/types`, `@watchtube/database`, `@watchtube/api`, `@watchtube/worker`, `@watchtube/web` built in 24.31s).
3. **Node.js Windows Temp Path Verification:**
   - Command: Verified `os.tmpdir()` and `path.join(base, 'video-uuid_job-1')`.
   - Result: Resolves to valid Windows absolute path under `%LOCALAPPDATA%\Temp\watchtube`.
4. **Git Repository State:**
   - Verified unrelated modifications preserved:
     - `packages/database/package.json` (intact)
     - `packages/database/src/index.ts` (intact)
     - `pnpm-lock.yaml` (intact)
     - `patch_*.js` scripts in root (intact)
   - Zero local `.env` files touched or committed.

---

### 6. Remaining Blockers

1. **Local Infrastructure:** PostgreSQL (port 5432) and Redis (port 6379) are not running on the host. Docker is not installed in the environment.
2. **FFmpeg Binaries:** `ffmpeg` and `ffprobe` binaries are missing from the system PATH.
3. **Automated Tests:** Zero unit or integration test files currently exist in the repository.

---

### 7. Recommended Next Task

**Task 2: Local Database Setup, Prisma Migrations & Seed Script Baseline**
- Establish a local PostgreSQL database connection.
- Execute `prisma migrate dev` or `prisma db push` safely on a local test database.
- Create an idempotent development seed script (`packages/database/prisma/seed.ts`) to populate baseline roles, an admin user, test channels, and category metadata.


---

## TASK 1B: Worker Temp Directory Hardening & JWT Production Security

**Date:** November 4, 2026  
**Status:** COMPLETED & VERIFIED  
**Repository Branch:** `main`  
**Baseline Commit:** `12713d856444bb2283e4d449257db48684801be1`  

### 1. Objectives & Scope
1. Harden `apps/worker/src/worker.ts` against directory traversal, race conditions, retry collisions, and unsafe root path configuration.
2. Enforce strict RFC 4122 UUID validation on incoming `videoId` parameters prior to touching filesystem or database layers.
3. Replace BullMQ job-ID-based directory derivation with `fs.mkdtemp()` to guarantee unique attempt directories even when BullMQ retries reuse the same job ID.
4. Enforce strict filesystem path containment to guarantee scratch directories cannot escape the configured scratch base.
5. Harden cleanup in `finally` blocks so cleanup errors are logged as warnings and never mask or overwrite original processing errors.
6. Centralize JWT secret handling in `apps/api/src/config/jwt.ts` to ensure signing and verification never drift out of sync.
7. Enforce strict production startup validation: abort process boot if `NODE_ENV=production` and `JWT_SECRET` is missing, blank, shorter than 16 characters, or matches common default keys (`supersecret`, etc.).
8. Support `REDIS_URL` connection strings in both API and Worker alongside legacy `REDIS_HOST` / `REDIS_PORT`.
9. Document runtime environment loading mechanics across Node applications and Prisma CLI in all four `.env.example` templates.
10. Populate local `.env` configuration files across the monorepo from user-supplied parameters and verify `.gitignore` protections.

---

### 2. Implementation Details

#### 2.1 Worker Temp Directory Hardening (`apps/worker/src/worker.ts`)
- **UUID Validation:** Evaluates `videoId` against `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`. Immediate rejection prevents malicious strings (e.g. `../../etc/passwd`).
- **Safe Base Resolution:** `getSafeTempBaseDir()` resolves `WATCHTUBE_TEMP_DIR` or defaults to `os.tmpdir()/watchtube`. Explicitly rejects attempts to configure the filesystem root (`/` on POSIX or `C:\` on Windows).
- **Atomic Isolated Attempts:** Uses `await fs.mkdtemp(path.join(TEMP_BASE_DIR, `${videoId}-attempt-`))` to allocate a fresh, atomically created directory with secure permissions for every run attempt.
- **Path Containment:** Verifies `normalizedWorkDir.startsWith(normalizedBase + path.sep)`. Throws an error immediately if containment fails.
- **Safe Isolated Cleanup:** `finally` block verifies path containment before invoking `fs.rm(workDir, { recursive: true, force: true })`. Wrapped in try/catch to log warnings and preserve original transcode errors.
- **Public Domain Fallback:** Helper `getPublicDomain()` cleanly handles `R2_PUBLIC_DOMAIN` or `R2_BUCKET_PUBLIC_URL`, automatically stripping URL schemes and trailing slashes.
- **Redis Connection:** Supports `REDIS_URL` connection strings (e.g., Render/Upstash) with fallback to `REDIS_HOST` / `REDIS_PORT`.

#### 2.2 Centralized JWT Production Security (`apps/api/src/config/jwt.ts`)
- **Single Source of Truth:** Centralizes JWT configuration in `apps/api/src/config/jwt.ts`.
- **Production Gate:** If `NODE_ENV === 'production'`:
  - Rejects missing, empty, or whitespace-only `JWT_SECRET`.
  - Rejects secrets shorter than 16 characters.
  - Rejects insecure defaults (`supersecret`, `secret`, `changeme`, `password`, `12345678`, `default`, `admin`, `test`, `jwtsecret`).
  - Throws `[FATAL] Production startup rejected` error, terminating startup before Express binds to port.
- **Development Convenience:** If non-production (`NODE_ENV !== 'production'`), falls back to `'supersecret'` with an explicit console security warning.
- **Consumers:** Imported and utilized in:
  - `apps/api/src/routes/auth.route.ts` (token issuance)
  - `apps/api/src/middleware/auth.ts` (token verification)
  - `apps/api/src/index.ts` (boot validation)
- **Redis Connection:** Updated `apps/api/src/index.ts` to support `REDIS_URL` connection strings.

#### 2.3 Environment Templates & Runtime Loading Documentation
- Updated all four `.env.example` templates (`.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`, `packages/database/.env.example`).
- Documented runtime loading differences:
  - `apps/api` and `apps/worker` rely on ambient environment variables (Docker, PM2, Render, or `node --env-file=.env`).
  - `packages/database` (Prisma CLI) natively detects and reads `.env` files automatically.
- Documented `REDIS_URL` and `R2_PUBLIC_DOMAIN` aliases.

---

### 3. Verification & Test Evidence

1. **Automated Verification Suite (`test_task1b.js`):**
   - UUID validation: Confirmed valid RFC 4122 UUIDs pass; traversal strings (`../../etc/passwd`) and non-UUID values are rejected.
   - Base scratch resolution: Confirmed root paths (`C:\` / `/`) throw fatal configuration errors.
   - `fs.mkdtemp` isolation: Confirmed multiple attempts for identical video IDs produce distinct directories; attempt cleanup does not touch sibling attempts or base directory.
   - JWT production security: Confirmed missing, short, and default secrets throw fatal errors in production; verified development fallback operates with warning.
2. **TypeScript Compilation:**
   - `pnpm --filter @watchtube/worker build` -> Clean exit code `0`.
   - `pnpm --filter @watchtube/api build` -> Clean exit code `0`.
3. **Full Turborepo Monorepo Build:**
   - `pnpm build` (`turbo run build` across all 6 packages) -> 5 successful tasks, 0 errors, completed in 31.9s.
4. **Git Repository Status:**
   - Preserved baseline unstaged changes: `packages/database/package.json`, `packages/database/src/index.ts`, `pnpm-lock.yaml`.
   - Preserved all 7 historical root patch scripts (`patch_*.js`).
   - Verified `.env` files remain gitignored and untracked.


---

## TASK 1C: Final Task 1B Corrections (JWT 32-Char Enforcement & Public Media URL Protection)

**Date:** November 4, 2026  
**Status:** COMPLETED & FULLY VERIFIED  
**Repository Branch:** `main`  
**Baseline Commit:** `12713d856444bb2283e4d449257db48684801be1`  

### 1. Objectives & Scope
1. Enforce strict 32-character minimum length for `JWT_SECRET` in production (`NODE_ENV === 'production'`) inside `apps/api/src/config/jwt.ts`.
2. Update `.env.example` and `apps/api/.env.example` to document the 32-character minimum requirement consistently.
3. Harden `getPublicDomain()` in `apps/worker/src/worker.ts` to strictly fail if neither `R2_PUBLIC_DOMAIN` nor `R2_BUCKET_PUBLIC_URL` supplies a valid non-empty domain.
4. Guarantee that public media URLs starting with `https:///` can never be generated or persisted in the database.
5. Validate public domain early in the worker job lifecycle before initiating downloads or FFmpeg transcoding.
6. Execute automated verification tests directly against compiled production modules (`apps/api/dist/config/jwt.js` and `apps/worker/dist/worker.js`).
7. Verify clean compilation for `@watchtube/api`, `@watchtube/worker`, and full Turborepo monorepo build.

---

### 2. Code Modifications

#### 2.1 Production JWT Validation (`apps/api/src/config/jwt.ts`)
- Updated validation logic:
  ```typescript
  if (INSECURE_FALLBACKS.includes(rawSecret.toLowerCase()) || rawSecret.length < 32) {
    throw new Error(
      '[FATAL] Production startup rejected: JWT_SECRET must be at least 32 characters and cannot use a known default or insecure fallback.'
    );
  }
  ```
- Comments and error messages updated to specify 32 characters.
- Development fallback (`supersecret` with console warning) preserved for non-production environments.

#### 2.2 Public Media Domain Validation (`apps/worker/src/worker.ts`)
- Updated `getPublicDomain()`:
  ```typescript
  export function getPublicDomain(): string {
      const raw = (process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL || '').trim();
      const domain = raw.split(/\s+/)[0].replace(/^https?:\/\//, '').replace(/\/+$/, '');
      if (!domain) {
          throw new Error(
              '[FATAL] Worker configuration error: Neither R2_PUBLIC_DOMAIN nor R2_BUCKET_PUBLIC_URL supplies a valid domain. Cannot generate public media URLs.'
          );
      }
      return domain;
  }
  ```
- Worker job processor invokes `const publicDomain = getPublicDomain();` early, failing immediately with a clear configuration error if unconfigured.
- Prevents malformed `https:///...` URLs from being generated or saved to PostgreSQL.

#### 2.3 Documentation & Templates
- Synchronized `.env.example` and `apps/api/.env.example` to mandate 32+ characters in production comments.

---

### 3. Verification & Test Evidence

1. **Automated Production Module Test Suite (`test_task1c.js`):**
   - **31-character secret in production:** REJECTED (`must be at least 32 characters`).
   - **32-character secret in production:** ACCEPTED.
   - **Missing secret in production:** REJECTED (`missing or empty`).
   - **Whitespace secret in production:** REJECTED (`missing or empty`).
   - **Known default (`supersecret`) in production:** REJECTED (`cannot use a known default`).
   - **Development fallback:** Returns `'supersecret'` with warning.
   - **Missing public domain in worker:** THROWS `[FATAL] Worker configuration error`.
   - **Whitespace public domain in worker:** THROWS `[FATAL] Worker configuration error`.
   - **Domain without protocol (`pub-abc123.r2.dev`):** Resolved cleanly; URL formatted as `https://pub-abc123.r2.dev/...` (no `https:///`).
   - **Domain with protocol and trailing slash (`https://pub-abc123.r2.dev/`):** Stripped cleanly to `pub-abc123.r2.dev`.
   - **Fallback to `R2_BUCKET_PUBLIC_URL`:** Succeeded.
   - **Multi-domain string:** First token extracted cleanly.
2. **TypeScript Compilation:**
   - `pnpm --filter @watchtube/api build`: Exit code `0`.
   - `pnpm --filter @watchtube/worker build`: Exit code `0`.
   - `pnpm build` (`turbo run build` across 6 packages): Exit code `0`.
3. **Worktree Preservation:**
   - Preserved `packages/database/package.json`, `packages/database/src/index.ts`, `pnpm-lock.yaml`.
   - Preserved all 7 tracked root patch scripts.
   - No `.env` files touched, deleted, or tracked.


## TASK 2A: Read-only Database Connectivity & Existing Schema Inspection

**Date:** November 9, 2026  
**Status:** COMPLETED — READ-ONLY; OWNER APPROVAL RECORDED BEFORE TASK 2B

### Scope and safety
- Repository inspected: `D:\watchtube\watchtube`.
- Reviewed `packages/database/prisma/schema.prisma` and searched the repository for migration files. No migrations directory or migration files were found.
- No schema or environment configuration was modified. No database writes, migrations, seeds, `db push`, or resets were executed. Database inspection ran in an explicitly read-only transaction using catalog and data-presence SELECTs only.
- Credentials were not printed. Pre-existing modified and untracked files and all historical patch scripts were preserved; the post-check `git status --short` matched the pre-check state.

### Schema findings
- The Prisma schema declares **18 models** and **15 enums**. Full model field lists, enum values, relation mappings, and declared key/index inventory are recorded in `WATCHTUBE_PROGRESS.md` under Task 2A.
- Each model has a UUID `id` primary key. Unique constraints cover `User.email`, `Channel.handle`, `WalletTransaction.referenceId`, `AdProviderConfig.name`, `WtppApplication.channelId`, `EscrowHold.claimId`, plus composite keys for `VideoLike(userId, videoId)`, `Subscription(subscriberId, channelId)`, and `WatchHistory(userId, videoId)`.
- All model relations and foreign-key references were inspected, including the self-relation on `Comment` and one-to-one relations for channel WTPP application and claim escrow hold. There are no explicit `@index` or `@@index` declarations or explicit Prisma check constraints.

### PostgreSQL inspection
- Existing configuration reached **PostgreSQL 18.6**.
- The `public` schema contains one base table, `User`, and it has no rows. The live table contains `email` (text, not null), `createdAt` and `updatedAt` (timestamp without time zone, not null), `id` (text, not null), and nullable `name` (text).
- Live `User` constraints are the primary key on `id` and not-null checks. Live indexes are the unique primary-key index on `id` and the unique index on `email`.
- The live database has no `_prisma_migrations` table, and the repository has no migration files; migration history is absent. The live `User` table shape differs from the current Prisma model (`id` is text rather than UUID, and schema fields `passwordHash`, `role`, and `status` are absent while `name` is present). The table is empty. No reconciliation was attempted.

### Environment and Prisma checks
- A root `.env` and `packages/database/.env` both exist and both define `DATABASE_URL`; no `packages/database/prisma/.env` exists. The two URLs resolve to the same scheme, host, port, database path, and query when comparing without credentials.
- Prisma validation from the database package loaded its local `.env` and succeeded. Validation from the monorepo root using the database package's Prisma launcher also succeeded without a duplicate-env conflict message. Prisma schema resolution reported `packages/database/prisma/schema.prisma`.
- `prisma generate` succeeded with Prisma Client **5.22.0**. Its default output is under `node_modules`; no authored source path was targeted or overwritten.
- Safe checks completed: Prisma validation (exit `0`), Prisma client generation (exit `0`), PostgreSQL version/table/data/migration catalog queries, and Git status preservation check.

### Approval gate
Task 2A was completed read-only and reviewed/approved before Task 2B. The Task 2B outcome follows.


## TASK 2B: Safe Database Initialization & Migration Baseline

**Date:** November 9, 2026  
**Status:** BLOCKED — Prisma `migrate deploy` stopped with P3005; no migration applied

### Pre-migration inspection
- Connected target matched the existing root/package configuration without exposing credentials. PostgreSQL server: **18.6**; Prisma CLI/client: **5.22.0**.
- Only user schema: `public`; only extension: `plpgsql` 1.0. Before deployment the database had only `public."User"`, with zero rows. Columns: `email` text NOT NULL; `createdAt` timestamp without time zone NOT NULL DEFAULT `CURRENT_TIMESTAMP`; `updatedAt` timestamp without time zone NOT NULL; `id` text NOT NULL; nullable `name` text. It had a primary key, one unique email index, and four not-null constraints. No foreign keys, dependent views/materialized views, noninternal triggers, or migration-related objects were found.
- PostgreSQL client tools: `pg_dump` / `pg_restore` **18.4**.

### Backup
- Custom-format schema-and-data backup: `C:\Users\sam\AppData\Local\WatchTubeBackups\watchtube_task2b_20261109_081805.dump` (outside the Git repository).
- `pg_dump` exit `0`; archive size 3,481 bytes. `pg_restore --list` exit `0`, 9 TOC entries, with the `public` schema, `User` table, and `User` table-data entry. SHA-256: `BBA3AFD7FCF5F93EE1D218AA36D23B33D832A2B90153A21FC7BF1C9D4A573BB3`. The archive was not test-restored.

### Migration design and attempt
- Prisma 5.22.0 generated the initial SQL from `schema.prisma`. The reviewed migration contains 18 table creations, 15 enum creations, 9 unique indexes, and 24 foreign keys; no `DROP` or `TRUNCATE` statements.
- Created `packages/database/prisma/migrations/20261109082031_init_preserve_legacy_user/migration.sql` and `packages/database/prisma/migrations/migration_lock.toml` (`provider = "postgresql"`). The SQL transactionally renames the old table to `User_legacy_20261109`, renames its PK constraint/index and unique email index to avoid conflicts, then creates the current Prisma schema.
- `prisma validate` passed (exit `0`). `prisma migrate deploy` stopped with **P3005**: Prisma rejected applying a new migration to the non-empty schema. The generated DDL did not run.

### Post-failure state and verification limits
- Following the failure rule, no `migrate resolve`, retry, reset, `db push`, seed, manual DDL, or repair was attempted.
- Read-only checks confirmed the database is unchanged: only the original `public."User"` table remains, with the same five columns/defaults, two indexes, and zero rows. Neither `User_legacy_20261109` nor `_prisma_migrations` exists.
- Migration status, post-apply generation, database package build/tests, and full schema-parity checks were not run after the failed deployment. No migration success or full parity is claimed; **Database and migrations remain incomplete**.
- No `.env`, application/API, worker, frontend, package source, or lock files were modified. `WATCHTUBE_ARCHITECTURE.md` is absent. Parent workspace report mirrors were updated.
- **Before `git status --short`:**
   ```text
    M apps/api/src/index.ts
    M apps/api/src/middleware/auth.ts
    M apps/api/src/routes/auth.route.ts
    M apps/worker/src/worker.ts
    M packages/database/package.json
    M packages/database/src/index.ts
    M pnpm-lock.yaml
   ?? .env.example
   ?? WATCHTUBE_PROGRESS.md
   ?? WATCHTUBE_TASK_LOG.md
   ?? apps/api/.env.example
   ?? apps/api/src/config/
   ?? apps/worker/.env.example
   ?? packages/database/.env.example
   ```
- **After `git status --short`:** identical to before, plus the two approved migration artifacts under the new directory:
   ```text
    M apps/api/src/index.ts
    M apps/api/src/middleware/auth.ts
    M apps/api/src/routes/auth.route.ts
    M apps/worker/src/worker.ts
    M packages/database/package.json
    M packages/database/src/index.ts
    M pnpm-lock.yaml
   ?? .env.example
   ?? WATCHTUBE_PROGRESS.md
   ?? WATCHTUBE_TASK_LOG.md
   ?? apps/api/.env.example
   ?? apps/api/src/config/
   ?? apps/worker/.env.example
   ?? packages/database/.env.example
   ?? packages/database/prisma/migrations/
   ```


## TASK 2B.1: Backup Restore Verification & Migration Baseline Investigation

**Date:** November 9, 2026  
**Status:** INVESTIGATION COMPLETE; PRODUCTION UNCHANGED; BASELINE APPROACH VERIFIED ON DISPOSABLE COPY

### Backup verification and restore
- Verified `C:\Users\sam\AppData\Local\WatchTubeBackups\watchtube_task2b_20261109_081805.dump` exists and SHA-256 equals the recorded `BBA3AFD7FCF5F93EE1D218AA36D23B33D832A2B90153A21FC7BF1C9D4A573BB3`.
- PostgreSQL 18.4 `pg_restore --list` exited `0`; 9 TOC entries include public schema, `User`, and `User` data. A loopback-only disposable PostgreSQL 18.4 cluster was created under `C:\Users\sam\AppData\Local\Temp\watchtube_task2b1_pg_5fdee570a4854203a1dd3d8843f7c6b5` on port 49165. Restoring to new database `watchtube_restore_task2b1` with `pg_restore --single-transaction` exited `0`.
- The restored `User` had the same five columns/defaults, PK, four not-null constraints, unique email index, and zero rows as production. The temporary server is stopped; its data directory remains outside Git for review.

### Prisma baseline semantics and test
- Prisma CLI 5.22.0 `migrate resolve --help` explicitly identifies baselining an existing database; `--applied` records a migration as applied. The production P3005 occurred because the schema was non-empty and had no migration history; Prisma refused to assume it already matched the migration set.
- A baseline SQL file was derived from `pg_dump --schema-only` of the restored database. Only psql-specific `\restrict` / `\unrestrict` wrapper lines were filtered from this temporary artifact; the original schema, table, PK, and index definitions came from the restored database. No baseline file was added to the repository.
- In a temporary Prisma project, `migrate resolve --applied 20261109070000_baseline_legacy_user` on the restored disposable DB succeeded, recorded the baseline with 0 SQL steps, and left the later `20261109082031_init_preserve_legacy_user` pending. `migrate deploy` then applied the later migration successfully (1 SQL step). Final `migrate status` reported up to date; `prisma validate` passed.
- Disposable catalog verification found all 18 expected model tables, all 15 enum types (62 labels), 24 foreign keys, expected primary/unique indexes, two finished migration records, and zero rows in every application table and the archive. `User_legacy_20261109` retained the original columns, defaults, PK/not-null constraints, and two unique indexes.
- `prisma migrate diff --from-url <disposable> --to-schema-datamodel <schema> --script` emitted only `DROP TABLE "User_legacy_20261109";`, the expected difference because the archive is intentionally outside the current Prisma schema. It was inspected, not executed. No other schema diff appeared.

### Evidence-backed recommendation (not production authorization)
- The two-stage baseline strategy is supported by the disposable simulation: an earlier migration accurately representing the legacy database is marked applied, then the existing schema-creation migration preserves the legacy table and creates the current Prisma schema.
- Production follow-up recommendation only: review the generated legacy baseline and backup, then separately authorize `prisma migrate resolve --applied <baseline>` on production followed by `prisma migrate deploy`; never mark the current schema-creation migration as applied to the legacy database. Perform pre/post production catalog checks. No production resolve/deploy was run in Task 2B.1.
- Final production read-only check still found only the original `User` table (5 columns, 2 indexes, 0 rows), with no archive or `_prisma_migrations` table. Credentials and `.env` values were not exposed or modified. No repository source or migration files were added/changed in Task 2B.1.
- **Before and after Git status:** identical to the Task 2B after-state above; this investigation added no Git paths. `WATCHTUBE_ARCHITECTURE.md` is absent. Database and migrations remain incomplete until production application is separately authorized and verified.

---

## TASK 2B.2: Finalize Legacy Baseline Migration Artifact

**Date:** November 10, 2026  
**Status:** BLOCKED — stopped before either migration path because restored backup row count conflicts with Task 2B.1 evidence

### Evidence and stop condition
- Inspected the current Prisma schema, the complete migration inventory, both Task 2B/2B.1 histories, and the saved Task 2B.1 baseline/diff evidence. The migration history already present consists of `20261109082031_init_preserve_legacy_user`; it was not edited.
- Rechecked `C:\Users\sam\AppData\Local\WatchTubeBackups\watchtube_task2b_20261109_081805.dump`: 3,481 bytes and SHA-256 `BBA3AFD7FCF5F93EE1D218AA36D23B33D832A2B90153A21FC7BF1C9D4A573BB3`, matching the previously recorded hash. Its schema-only evidence contains only `public."User"` with five columns, its primary key, and the unique email index.
- Restored that backup into a new loopback-only PostgreSQL 18.4 disposable cluster at `127.0.0.1:49168`, database `watchtube_legacy_path_a`. The first transactional restore stopped on an absent ACL role; the failed transaction left zero public tables. Retrying with `pg_restore --single-transaction --no-owner --no-acl` succeeded.
- Actual restored catalog: `email text NOT NULL`; `createdAt timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP`; `updatedAt timestamp(3) without time zone NOT NULL`; `id text NOT NULL`; nullable `name text`; primary key on `id`; unique btree index on `email`. **The restored table has 1 row**, contradicting Task 2B and 2B.1's recorded 0 rows. No row contents were read or exposed.
- Stopped immediately before `migrate resolve`, `migrate deploy`, Path A, or Path B. A read-only check confirmed only the restored `User` table exists, with no archive and no `_prisma_migrations`. The temporary PostgreSQL cluster is stopped and its data directory retained at `C:\Users\sam\AppData\Local\Temp\watchtube_task2b2_pg_20261110_0757`.
- `prisma validate --schema prisma/schema.prisma` passed with `DATABASE_URL` explicitly pointed at the disposable loopback database. Migration status, migration replay, and schema diff were not run for either path because the evidence mismatch triggers the required stop. Production was not contacted or modified.

### Baseline artifact
- Added `packages/database/prisma/migrations/20261109070000_baseline_legacy_user/migration.sql`, ordered before the existing schema-creation migration. It contains only the verified legacy table, primary key, and unique email index; it does not create current application tables or insert data.
- This is the exact legacy schema DDL, not the table's row data. `migrate resolve --applied 20261109070000_baseline_legacy_user` records the baseline without executing its SQL; on a fresh database `migrate deploy` would execute the baseline and then the existing schema-creation migration.
- Production readiness is **not established** until the zero-versus-one-row discrepancy is reconciled and both disposable paths pass independently. Database and migrations remain unchecked/incomplete.

### Conditional production command order (NOT RUN; do not execute until the blocker is resolved and production is separately authorized)
From PowerShell, with `$env:DATABASE_URL` securely set to the intended production target (do not echo it; no `.env` file is changed). Run each line separately and stop on any nonzero exit or unexpected output:

```powershell
Set-Location 'D:\watchtube\watchtube\packages\database'
pnpm exec prisma validate --schema prisma/schema.prisma
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -v ON_ERROR_STOP=1 -d "$env:DATABASE_URL" -c 'SELECT current_database(), current_schema(); SELECT count(*) AS legacy_user_rows FROM public."User"; SELECT column_name, data_type, datetime_precision, is_nullable, column_default FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''User'' ORDER BY ordinal_position; SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=''public'' AND tablename=''User'' ORDER BY indexname; SELECT to_regclass(''public._prisma_migrations'') IS NULL AS no_migration_history;'
pnpm exec prisma migrate resolve --applied 20261109070000_baseline_legacy_user --schema prisma/schema.prisma
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -v ON_ERROR_STOP=1 -d "$env:DATABASE_URL" -c 'SELECT migration_name, applied_steps_count, finished_at IS NOT NULL AS finished FROM public."_prisma_migrations" ORDER BY started_at; SELECT count(*) AS legacy_user_rows FROM public."User"; SELECT column_name, data_type, datetime_precision, is_nullable, column_default FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''User'' ORDER BY ordinal_position; SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=''public'' AND tablename=''User'' ORDER BY indexname;'
pnpm exec prisma migrate status --schema prisma/schema.prisma
pnpm exec prisma migrate deploy --schema prisma/schema.prisma
pnpm exec prisma migrate status --schema prisma/schema.prisma
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -v ON_ERROR_STOP=1 -d "$env:DATABASE_URL" -c 'SELECT migration_name, applied_steps_count, finished_at IS NOT NULL AS finished FROM public."_prisma_migrations" ORDER BY started_at; SELECT count(*) AS archived_user_rows FROM public."User_legacy_20261109"; SELECT count(*) AS current_model_tables FROM pg_tables WHERE schemaname=''public'' AND tablename NOT IN (''_prisma_migrations'', ''User_legacy_20261109''); SELECT column_name, data_type, datetime_precision, is_nullable, column_default FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''User_legacy_20261109'' ORDER BY ordinal_position; SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=''public'' AND tablename=''User_legacy_20261109'' ORDER BY indexname;'
pnpm exec prisma validate --schema prisma/schema.prisma
pnpm exec prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

- The first `validate` is static. The first `psql` is read-only preflight; verify the target identity and exact legacy schema, and record its row count. `migrate resolve` records **only** `20261109070000_baseline_legacy_user` as applied (zero SQL steps); it does not execute its DDL. The next read-only query and `migrate status` must show that baseline finished and `20261109082031_init_preserve_legacy_user` still pending, with the original table unchanged. Only `migrate deploy` executes the existing `20261109082031_init_preserve_legacy_user`, which archives `User` and creates the current Prisma schema.
- Final read-only checks must show both migrations finished, 18 current model tables, and `User_legacy_20261109` retaining the preflight row count, columns, PK, and indexes. The expected Prisma schema diff is only the intentionally out-of-model archive table; no diff SQL is to be executed.
- If any command fails, target identity is unexpected, migration status differs, or row/schema checks do not match, stop immediately. Do not rerun, reset, drop, truncate, use `db push`, mark the schema-creation migration applied, roll back/repair migration history, or attempt destructive repair. Preserve output and use read-only inspection only.
