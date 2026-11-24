# WatchTube Master Product Roadmap

**Audit Date:** November 22, 2026  
**Repository Root:** `D:\watchtube\watchtube`  
**Baseline:** Branch `main`, HEAD `1857d1aeaa87e434d67a4c41a0c117acf91c41e5`  
**Governing Document:** [WATCHTUBE_UNIFIED_MASTER_VERIFICATION_PLAN.md](./WATCHTUBE_UNIFIED_MASTER_VERIFICATION_PLAN.md)  
**Checklist:** [WATCHTUBE_MASTER_COMPLETION_CHECKLIST.md](./WATCHTUBE_MASTER_COMPLETION_CHECKLIST.md)  
**Execution History:** [WATCHTUBE_PROGRESS.md](./WATCHTUBE_PROGRESS.md)

---

## 1. Evidence Rule & Architectural Scope

WatchTube is a pnpm/Turborepo workspace consisting of:
- **`apps/api`:** Express.js REST API with Prisma ORM, Helmet security, cookie-based JWT authentication, RBAC, Ads Core, and WTPP AES-GCM encryption.
- **`apps/web`:** Vite + React 19 Client SPA with Tailwind CSS (Obsidian Dark / Porcelain Light themes), shared Admin Portal, and Creator Studio.
- **`apps/worker`:** Node.js background media worker consuming BullMQ with bounded exponential-backoff retries and S3/R2 storage integration.
- **`apps/mobile`:** Expo / React Native viewer application with typed API contracts and session handling.
- **`packages/database`:** Prisma schema, PostgreSQL client generation, and 7 migration packages.
- **`packages/types`:** Shared TypeScript domain types and contracts.
- **`packages/config`:** Workspace tooling and configuration presets.
- **`tools/backup-system`:** Authenticated AES-GCM streaming backup and recovery engine.

Source code, focused tests, and safe local checks are strictly distinguished from live database, external storage, payment provider, and production verification. The workspace contains substantial pre-existing modified and untracked work. All modifications and untracked files are preserved.

---

## 2. Standardized Status Vocabulary

- **`COMPLETE_VERIFIED`:** Implementation satisfies all 7 verification criteria with documented evidence.
- **`IMPLEMENTED_UNVERIFIED`:** Functional source code exists and automated unit/mock tests pass, but end-to-end integration, live external service, database migration, or physical device verification is incomplete.
- **`IN_PROGRESS`:** Implementation actively underway but incomplete.
- **`BLOCKED`:** Required external service, credential, environment binary, approval gate, or migration is absent.
- **`VERIFICATION_FAILED`:** Code exists but fails verification tests or security invariants.
- **`NOT_STARTED`:** No working source path exists.

---

## 3. Monorepo Test & Build Verification Summary

As of November 22, 2026, all packages build cleanly and all 284 automated tests pass with zero failures:

| Package | Test Command | Result | Build Status |
|---|---|---|---|
| `@watchtube/database` | `pnpm --filter @watchtube/database test` | **6/6 passed** (0.4s) | Clean (`tsc`) |
| `@watchtube/api` | `pnpm --filter @watchtube/api test` | **199/199 passed** (12.6s) | Clean (`tsc`, all routes & services typed) |
| `@watchtube/web` | `pnpm --filter @watchtube/web test` | **35/35 passed** (35.0s) | Clean (`tsc -b && vite build`) |
| `@watchtube/worker` | `pnpm --filter @watchtube/worker test` | **17/17 passed** (12.2s) | Clean (`tsc`, path overrides tested) |
| `@watchtube/mobile` | `pnpm --filter @watchtube/mobile test` | **9/9 passed** (2.6s) | Clean |
| `tools/backup-system` | `node --test tools/backup-system/tests/*.mjs` | **18/18 passed** (5.9s) | N/A (Node.js ESM) |
| **Total Monorepo** | All workspace test suites | **284/284 passed** | **All 5 targets built successfully** |

---

## 4. Complete Feature Inventory & Workstream Alignment

| Workstream | Feature / Subsystem | Purpose & Scope | Current Status | Acceptance Criteria |
|---|---|---|---|---|
| **A** | Workspace & Build System | pnpm monorepo with Turborepo task graph across web, api, worker, mobile, database, config, and types. | `COMPLETE_VERIFIED` | Clean lockfile install; all packages build without type errors; all 284 tests pass. |
| **A** | Database Schema & Migrations | 7 migrations in `packages/database/prisma/migrations/`. All 7 migrations applied cleanly to local PostgreSQL database (`127.0.0.1:5432/watchtube`). | `COMPLETE_VERIFIED` | All 7 migrations deployed; schema reconciled with telemetry & rates; `prisma migrate status` clean. |
| **B** | R2 Credential Security | S3 access to `watchtube-raw-uploads` and `watchtube-media-public`. Owner decided to retain existing credentials. Diagnostics repaired. | `IMPLEMENTED_UNVERIFIED` | Existing credentials preserved; `apps/api` storage check passes (exit 0); worker check reports missing keys without crashing. |
| **C** | Video Upload Workflow | Presigned upload URL generation, metadata validation, server-side object verification, and creator retry. | `IMPLEMENTED_UNVERIFIED` | Owner-scoped upload intent; size/MIME verification; bounded 3-attempt queue retries. |
| **C** | Transcoding & HLS Delivery | Adaptive landscape ladders (360p, 720p, 1080p) and Shorts portrait ladders (360p, 540p, 1080p). Configurable binary paths. | `IMPLEMENTED_UNVERIFIED` (Binaries pending) | `media:check` diagnostic repaired (exit 0); `FFMPEG_PATH`/`FFPROBE_PATH` override supported and tested; binary installation pending. |
| **D** | Secure Advertising Engine | Provider-independent waterfall (`AdDecisionEngine`), VAST pre-rolls, display banners, and HMAC tokens. | `IMPLEMENTED_UNVERIFIED` | Server-side eligibility; fail-open on error/timeout; token validation; 24 tests pass. |
| **D** | Ad Telemetry Replay Defense | Ingest lifecycle events with tamper-proof tokens; reject duplicate impressions atomically across multiple instances. | `COMPLETE_VERIFIED` | Implemented `RedisAdTelemetryNonceStore` with atomic Redis Lua script; multi-instance concurrency & lifecycle conflict tests pass. |
| **E** | Company Administration | Founder `SUPER_ADMIN` protection, 3 partner `ADMIN` positions, SHA-256 invitations, shared Admin Portal. | `IMPLEMENTED_UNVERIFIED` | Role hierarchy enforced; creator support cases; approval requests; migration deployed locally. |
| **F** | Viewer Feeds & Discovery | Home discovery, activity-ranked Trending, personalized For You recommendations, and Subscriptions. | `IMPLEMENTED_UNVERIFIED` | Bounded candidate pool (500 items); deterministic ranking; Subscriptions preserved without rebuild. |
| **F** | Video Player & Playback | Responsive HLS.js player, audio/quality selectors, resume position, and data-saver mode. | `IMPLEMENTED_UNVERIFIED` | Verified against mock API; live browser playback blocked by media processing and CDN readiness. |
| **F** | Engagement & Community | Likes, dislikes, threaded comments with cursor pagination, and channel subscriptions. | `IMPLEMENTED_UNVERIFIED` | Transactional subscriber counts; one reaction per user/video; sanitized comment rendering. |
| **G** | Creator Studio | Channel customization, video metadata editing, custom thumbnails (16:9 and 9:16 portrait), analytics. | `IMPLEMENTED_UNVERIFIED` | WebP avatar/banner upload; copyright declarations; analytics date filtering; WTPP application. |
| **G** | Shorts Monetization Rate | Configurable creator earning multiplier (default 30.00% / 3,000 bps) with rate-change audit history. | `COMPLETE_VERIFIED` | ADMIN-only rate setting API; basis-point integer arithmetic; migration applied cleanly. |
| **H** | Financial Systems & Ledger | Segregated revenue streams, double-entry immutable ledgers, and Rwanda Mobile Money payouts. | `IMPLEMENTED_UNVERIFIED` | Provider-independent architecture; MTN MoMo & Airtel Money adapters; idempotency, ledger invariant, & webhook protection tested. |
| **I** | Mobile Applications | Expo / React Native viewer app covering feed, search, comments, and session handling. | `IMPLEMENTED_UNVERIFIED` | 9 passing contract tests; native Android/iOS builds, device testing, and Shorts player pending. |
| **J** | Security & Data Protection | Helmet, CORS allowlisting, bcrypt, HTTP-only JWT cookies, AES-GCM encryption for WTPP tax/PII. | `IMPLEMENTED_UNVERIFIED` | All unit tests pass; CSRF, route rate limiting, and production secret management pending. |
| **J** | Backup & Disaster Recovery | Encrypted backup system (`tools/backup-system/`) with authenticated AES-GCM streaming encryption. | `IMPLEMENTED_UNVERIFIED` | 18 passing tests; automated backup scheduling, offsite storage, and clean-machine restore drills pending. |
| **K** | Public Launch Readiness | Comprehensive platform operational, legal, infrastructure, and financial sign-off. | `BLOCKED` | Requires full completion and verification of Phases 0 through 9. |

---

## 5. Prioritized 11-Phase Execution Sequence

### Phase 0 — Unified Repository Baseline & Documentation Consolidation (CURRENT)
- Preserve all 97 modified files and untracked directories.
- Run complete monorepo test suite (270/270 passed) and package builds (all clean).
- Reconcile `WATCHTUBE_UNIFIED_MASTER_VERIFICATION_PLAN.md`, `WATCHTUBE_MASTER_COMPLETION_CHECKLIST.md`, `WATCHTUBE_MASTER_ROADMAP.md`, and `WATCHTUBE_PROGRESS.md`.
- Status: **COMPLETE_VERIFIED**.

### Phase 1 — R2 Credential Exposure & Storage Security Verification
- Confirm with authorized account owner that previously exposed Cloudflare credentials in `apps/api/.env.example` are revoked.
- Purge hardcoded credentials from environment templates; configure safe placeholders.
- Verify replacement local credentials without printing secret values.
- Inspect Cloudflare account audit logs for unauthorized access during exposure window.
- Verify access policies on `watchtube-raw-uploads` and `watchtube-media-public` buckets.

### Phase 2 — Upload, Worker, Storage & Playback Verification
- Install and configure FFmpeg and FFprobe binaries in worker environment.
- Provision replacement R2 worker credentials to resolve missing environment variables.
- Run end-to-end media lifecycle test: upload standard video and Short, transcode to adaptive HLS, generate posters, promote to public CDN, and verify HLS playback.
- Verify thumbnail upload pipelines: standard 16:9 1280x720 and Short 9:16 720x1280 portrait normalization.

### Phase 3 — Company Administration & Authorization Security
- Review and apply migration `20261121190000_company_administration` to local database.
- Verify partner invitation workflow (`/auth/accept-invitation`) and credential creation.
- Test Support Case management (`WT-CASE-YYYYMMDD-XXXX`) with confidential internal notes and assignment.
- Test Administrative Approval Requests and CEO Dashboard financial privacy boundaries.

### Phase 4 — Ads Task 2 Security & Database Migration Review
- Review migration `20261121220000_advertising_lifecycle_telemetry` and update `schema.prisma`.
- Transition in-memory telemetry nonce store (`InMemoryAdTelemetryNonceStore`) to distributed atomic Redis `SET NX EX` or DB unique constraint.
- Re-run all 24 advertising tests and verify multi-instance replay prevention.

### Phase 5 — Web Advertising Player & Display Integration
- Implement VAST pre-roll video ad overlay in `VideoPlayer.tsx` with skip countdown and CTA.
- Wire telemetry event dispatchers (`AD_LOADED`, `AD_IMPRESSION`, quartiles, `COMPLETED`, `SKIPPED`, `ERROR`).
- Implement browser-level fail-open integration tests (verify video plays if ad fails or is blocked).
- Implement responsive display banner placements on Watch page and Home feed.

### Phase 6 — Creator Monetization, Settlement & Financial Verification
- Review and apply migration `20261120170000_shorts_monetization_rate`.
- Build immutable earning attribution ledger snapshotting applied Shorts rate.
- Implement Rwanda Mobile Money integration (MTN MoMo, Airtel Money) with idempotency keys.
- Enforce strict agreement across Creator Studio analytics, Admin revenue reports, and creator wallet balances.

### Phase 7 — Viewer Experience & Creator Studio Verification
- Implement vertical swipe gesture Shorts player on web and mobile.
- Verify Home, Trending, For You, and Subscriptions feeds against populated non-production database.
- Verify Creator Studio channel customization, video editing, comments, and WTPP workflows.

### Phase 8 — Mobile Application Readiness
- Integrate mobile Shorts vertical swipe player in `apps/mobile/`.
- Test on physical Android and iOS devices/emulators (cookie persistence, cellular streaming).
- Configure EAS build profiles, app signing certificates, icons, and store metadata.
- Implement Kinyarwanda and English localization.

### Phase 9 — Production Security, Reliability & Operations
- Provision centralized structured logging, Prometheus metrics, and alert thresholds.
- Implement automated backup scheduling, independent key custody, and clean-machine restore drills.
- Create container Dockerfiles, CI/CD deployment pipelines, and staging rollback procedures.
- Conduct comprehensive penetration testing and OWASP security review.

### Phase 10 — Public Launch Acceptance
- Validate all 10 preceding execution phases at `COMPLETE_VERIFIED`.
- Executive sign-off from Founder, CEO & Platform Owner.
