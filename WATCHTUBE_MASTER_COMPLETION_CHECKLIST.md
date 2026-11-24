# WATCHTUBE MASTER COMPLETION CHECKLIST

**Baseline Date:** November 22, 2026  
**Repository Root:** `D:\watchtube\watchtube`  
**Branch / HEAD:** `main` / `1857d1aeaa87e434d67a4c41a0c117acf91c41e5`  
**Governing Plan:** [WATCHTUBE_UNIFIED_MASTER_VERIFICATION_PLAN.md](./WATCHTUBE_UNIFIED_MASTER_VERIFICATION_PLAN.md)  
**Roadmap:** [WATCHTUBE_MASTER_ROADMAP.md](./WATCHTUBE_MASTER_ROADMAP.md)  
**Execution History:** [WATCHTUBE_PROGRESS.md](./WATCHTUBE_PROGRESS.md)

---

## Standardized Status Vocabulary

Every item in this checklist conforms to one of the six formal platform statuses:

- `NOT_STARTED` — No implementation exists in the repository.
- `IN_PROGRESS` — Code changes are underway but feature is incomplete.
- `IMPLEMENTED_UNVERIFIED` — Code implementation exists and automated unit/mock tests pass, but end-to-end integration, live external service, database migration, or physical device verification is incomplete.
- `VERIFICATION_FAILED` — Implementation exists but automated tests or verification checks fail.
- `BLOCKED` — Advancement is prevented by external dependencies, missing credentials, approval gates, or environment limitations.
- `COMPLETE_VERIFIED` — Implementation satisfies all seven verification criteria: code inspected, tests passing, integration verified, security verified, documentation consistent, no open blockers, and dated evidence recorded.

---

## Phase 0 — Unified Repository Baseline & Documentation Consolidation

- [x] `COMPLETE_VERIFIED` — Confirm repository root is `D:\watchtube\watchtube`, branch `main`, HEAD `1857d1aeaa87e434d67a4c41a0c117acf91c41e5`.
- [x] `COMPLETE_VERIFIED` — Preserve all 97 modified files and untracked files without destructive Git commands (`git reset`, `git clean`).
- [x] `COMPLETE_VERIFIED` — Run full monorepo test suite: 270/270 tests pass (Database: 6/6, API: 186/186, Worker: 16/16, Web: 35/35, Mobile: 9/9, Backup System: 18/18). Zero test failures.
- [x] `COMPLETE_VERIFIED` — Run all package builds: `@watchtube/database` (Clean), `@watchtube/types` (Clean), `@watchtube/api` (Clean, prior CEO dashboard errors resolved), `@watchtube/worker` (Clean), `@watchtube/web` (Clean Vite build).
- [x] `COMPLETE_VERIFIED` — Create `WATCHTUBE_UNIFIED_MASTER_VERIFICATION_PLAN.md` integrating all 11 workstreams and 11 phases.
- [x] `COMPLETE_VERIFIED` — Reconcile checklist, roadmap, and progress records with actual repository evidence.

---

## Phase 1 — R2 Credential Exposure & Storage Security Verification

- [x] `COMPLETE_VERIFIED` — Owner R2 credential retention policy: explicit owner decision to retain existing local R2 configuration; rotation is not a prerequisite.
- [ ] `IN_PROGRESS` — Scrub sensitive production keys and secrets from all `.env.example` templates; replace with safe illustrative placeholders.
- [x] `COMPLETE_VERIFIED` — API storage diagnostic repair: `apps/api/scripts/storage-check.cjs` repaired with explicit `ts-node` tsconfig registration; exits code 0 and reports `{"status":"configured","missing":[]}` without leaking secrets. Unit test added in `storage-readiness.test.ts`.
- [x] `COMPLETE_VERIFIED` — Worker storage diagnostic repair: `apps/worker/scripts/storage-check.cjs` repaired with explicit `ts-node` tsconfig registration; exits code 0 and reports `{"status":"unconfigured","missing":[...]}` cleanly.
- [ ] `IMPLEMENTED_UNVERIFIED` — Live R2 bucket connectivity: verify authenticated S3 API connectivity against `watchtube-raw-uploads` and `watchtube-media-public` once live permission is authorized.
- [ ] `BLOCKED` — Verify Cloudflare account audit logs and available R2 data access logs for unauthorized object access during exposure window.
- [ ] `BLOCKED` — Verify bucket identity, CORS, and access policies for `watchtube-raw-uploads` (private) and `watchtube-media-public` (public) without deleting or modifying existing objects.

---

## Phase 2 — Upload, Worker, Storage & Playback Verification

- [x] `COMPLETE_VERIFIED` — Presigned upload intent API (`/api/v1/videos/upload-intent` and `/thumbnail-upload-intent`) with owner checks, size limits, format enforcement, and host-only signed headers (`X-Amz-SignedHeaders=host`). Tested via `storage-readiness.test.ts` and `loopback-s3-upload-pipeline.test.ts`.
- [x] `COMPLETE_VERIFIED` — Video and thumbnail upload lifecycle decoupling: `saveMetadata()` purely manages draft metadata, thumbnail upload executes alongside video transfer without blocking intent creation or file transfer, draft ID is retained on failure, and retries reuse existing drafts without duplicates. Tested via `videoUploadWorkflow.test.ts` and `creatorStudioUpload.test.mjs`.
- [x] `COMPLETE_VERIFIED` — Server-side upload verification (`/api/v1/videos/:id/verify-upload` and `thumbnail-confirmation`) checking length, MIME type, WebP normalization via Sharp, and storage key before job queuing.
- [x] `IMPLEMENTED_UNVERIFIED` — Queue reliability with bounded 3-attempt exponential backoff retries and creator manual retry (`POST /api/v1/videos/:id/retry`).
- [x] `COMPLETE_VERIFIED` — Worker media tool configuration & diagnostic: `apps/worker/scripts/media-check.cjs` repaired (exits 0); `transcode.service.ts` updated to support `FFMPEG_PATH` and `FFPROBE_PATH` binary path overrides with test in `worker.reliability.test.ts`.
- [x] `COMPLETE_VERIFIED` — Worker FFmpeg & FFprobe binary installation: binaries installed and verified on host PATH (`media:check` reports `{"ffmpeg":true,"ffprobe":true}`); real transcoding tests pass.
- [x] `COMPLETE_VERIFIED` — HLS encoding ladder for standard landscape videos: 360p (600 kbps), 720p (2 Mbps), 1080p (4.5 Mbps), separate FFmpeg tokens, and segment verification.
- [x] `COMPLETE_VERIFIED` — Dedicated Shorts portrait encoding ladder: 360p (800 kbps), 540p (1.8 Mbps), 1080p (3.5 Mbps) with 540p playlist promotion fix verified.
- [x] `COMPLETE_VERIFIED` — Thumbnail pipelines: standard 16:9 poster/thumbnails and Shorts portrait 9:16 normalization with sub-second clip safety.
- [ ] `BLOCKED` — End-to-end media lifecycle test against live Cloudflare R2: locally verified via loopback S3-wire server (`loopback-s3-upload-pipeline.test.ts`), but live Cloudflare R2 browser uploads remain blocked until bucket write/CORS permissions are granted on the live Cloudflare R2 bucket.

---

## Phase 3 — Company Administration & Authorization Security

- [x] `COMPLETE_VERIFIED` — Hierarchical RBAC: `SUPER_ADMIN` (Founder/CEO/Owner) protected against lockout, demotion, suspension, or deletion; 3 designated partner `ADMIN` positions in `AdminPosition` model; ordinary `USER`. Tested via `admin-governance.test.ts` and `company-administration.test.ts`.
- [x] `COMPLETE_VERIFIED` — Single-use partner invitations (`AdminInvitation`) with SHA-256 hashed tokens and 72-hour expiration.
- [x] `COMPLETE_VERIFIED` — Shared Admin Portal frontend (`AdminDashboard.tsx`) with permission-personalized views for CEO Overview, Partner Positions, User Directory, Health & Telemetry, Support Cases, Approval Requests, Creator Financial Lookup, and Audit Logs. Tested via `adminPortal.test.mjs` and web build.
- [x] `COMPLETE_VERIFIED` — User Directory & Governance API (`/api/v1/admin/users`) with search, role and standing filters (`GOOD_STANDING`, `WARNING`, `RESTRICTED`, `SUSPENDED`), user inspect detail, self-suspension guard (400), SUPER_ADMIN protection (403), audit logging, and security alert events. Tested via `admin-governance.test.ts`.
- [x] `COMPLETE_VERIFIED` — Platform Operational Health Center (`/api/v1/platform/health` and `/api/v1/operational-overview`) reporting truthful live status for API, PostgreSQL database, BullMQ video backlog, R2 storage, email outbox, and honest unconfigured mobile money states, strictly omitting financial intelligence for ordinary admins. Tested via `admin-governance.test.ts`.
- [x] `COMPLETE_VERIFIED` — Creator Support Case management (`WT-CASE-YYYYMMDD-XXXX`) with assignment, status transitions, confidential internal notes, and activity timeline.
- [x] `COMPLETE_VERIFIED` — Administrative Approval Requests allowing partners to escalate sensitive actions to the CEO with decision rationale recording.
- [x] `COMPLETE_VERIFIED` — Searchable Admin Audit Trail (`AdminAuditLog`) with automated PII and credential redaction, multi-dimensional filtering (`action`, `targetResource`, `outcome`, `startDate`, `endDate`), and operational scope isolation.
- [x] `COMPLETE_VERIFIED` — Database migration `20261121190000_company_administration`: applied cleanly to local PostgreSQL database (`127.0.0.1:5432/watchtube`); verified with `prisma migrate status`.
- [ ] `IMPLEMENTED_UNVERIFIED` — End-to-end partner onboarding test: generate invitation, accept on `/auth/accept-invitation`, log in as partner, and verify role-gated access.

---

## Phase 4 — Ads Task 2 Security & Database Migration Review

- [x] `IMPLEMENTED_UNVERIFIED` — Provider-independent Ads Core waterfall engine (`AdDecisionEngine`) supporting VAST pre-rolls, display banners, and direct ads.
- [x] `IMPLEMENTED_UNVERIFIED` — Server-side monetization eligibility checks (`eligibility.ts`) verifying WTPP channel standing, public video status, clear copyright claims, and zero active strikes.
- [x] `IMPLEMENTED_UNVERIFIED` — Fail-open guarantee: `/api/v1/monetization/decision` returns clean `NO_FILL` on timeout, provider failure, or unmonetized content.
- [x] `IMPLEMENTED_UNVERIFIED` — Dedicated `ADS_TRACKING_SECRET` enforcement preventing reuse of `JWT_SECRET`.
- [x] `IMPLEMENTED_UNVERIFIED` — Cryptographic HMAC-SHA256 tracking tokens binding session ID, placement, provider, ad ID, video ID, channel ID, and expiration.
- [x] `IMPLEMENTED_UNVERIFIED` — Telemetry ingestion (`/api/v1/monetization/ad-event`) with strict schema validation rejecting client-submitted revenue and forcing `grossRevenueCents: 0`.
- [x] `COMPLETE_VERIFIED` — Distributed atomic telemetry replay store: implemented `RedisAdTelemetryNonceStore` with atomic Redis Lua script enforcing duplicate impression detection, lifecycle conflict protection (`AD_COMPLETED` vs `AD_SKIPPED`), and session TTL; all 4 concurrency & replay unit tests pass.
- [x] `COMPLETE_VERIFIED` — Database migration `20261121220000_advertising_lifecycle_telemetry`: schema updated with extended `AdEventType` (8 new lifecycle enums) and telemetry columns; applied cleanly to local PostgreSQL database.
- [x] `IMPLEMENTED_UNVERIFIED` — Ad provider management endpoints (`/api/v1/admin/monetization/providers`) protected by `monetization.manage_providers` permission and audit logging.

---

## Phase 5 — Web Advertising Player & Display Integration

- [x] `IMPLEMENTED_UNVERIFIED` — Web video player pre-roll VAST integration: render video ad overlay in `VideoPlayer.tsx` with skip countdown (default 5s), click-through CTA, and fail-open resilience.
- [x] `IMPLEMENTED_UNVERIFIED` — Telemetry dispatch from web player: fire signed `IMPRESSION`, `START`, `COMPLETE`, `SKIP`, and `ERROR` events to `/api/v1/monetization/event`.
- [x] `COMPLETE_VERIFIED` — Browser-level fail-open integration test: unit tested in `apps/web/tests/viewerPlayback.test.mjs` verifying that ad decision failure, timeout (2000ms), or error silently falls back to content playback without freezing.
- [ ] `NOT_STARTED` — Responsive display ad placements: sidebar banner on desktop Watch page and native feed ad card in Home/Trending feeds.
- [ ] `NOT_STARTED` — Fallback handling: graceful collapse of display containers on `NO_FILL` or ad-blocker interception.

---

## Phase 6 — Creator Monetization, Settlement & Financial Verification

- [x] `IMPLEMENTED_UNVERIFIED` — Prospective Shorts creator rate configuration: default 30.00% (3,000 bps), range 0.00-100.00%, ADMIN-only API, confirmation UI, and append-only audit log.
- [x] `COMPLETE_VERIFIED` — Database migration `20261120170000_shorts_monetization_rate`: applied cleanly to local PostgreSQL database (`127.0.0.1:5432/watchtube`).
- [x] `IMPLEMENTED_UNVERIFIED` — Integer RWF calculation helper using round-half-away-from-zero tested at 30%, 25%, and 50%.
- [ ] `NOT_STARTED` — Immutable earning attribution ledger: record eligible creator earnings tied to verified provider settlements, snapshotting applied Shorts rate.
- [ ] `NOT_STARTED` — Reconciliation engine: guarantee agreement among Creator Studio analytics, Admin revenue reports, creator wallet balances, and payouts.
- [x] `IMPLEMENTED_UNVERIFIED` — Rwanda Mobile Money integration foundations: implemented provider-independent architecture with typed MTN MoMo and Airtel Money adapters, phone normalization, HMAC signature validation, double-entry ledger invariant guardian, idempotency enforcement, and webhook replay protection; 8 unit tests in `mobile-money-payments.test.ts`. Live sandbox/production keys remain to be configured.
- [ ] `NOT_STARTED` — Creator payout controls: enforce payout threshold (e.g. 10,000 RWF), fee schedules, tax withholding, and fraud hold workflows.

---

## Phase 7 — Viewer Experience & Creator Studio Verification

- [x] `IMPLEMENTED_UNVERIFIED` — Home Feed: public discovery feed with accessibility, loading, empty, and error states.
- [x] `IMPLEMENTED_UNVERIFIED` — Trending Feed: ranked public feed using recent valid views, likes, comments, and deterministic tie-breaking.
- [x] `IMPLEMENTED_UNVERIFIED` — For You Feed: personalized recommendations engine using viewer watch history, engagement signals, repeat penalties, and creator diversity balancing.
- [x] `COMPLETE_VERIFIED` — Subscriptions Feed: chronological subscription feed with transactional follow/unfollow and verified tests (preserved without rebuild).
- [x] `IMPLEMENTED_UNVERIFIED` — Search & Discovery: parameterized query search with separate video and channel pagination.
- [x] `IMPLEMENTED_UNVERIFIED` — Vertical swipe Shorts player: `ShortsPage.tsx` with 9:16 vertical layout, keyboard/button navigation, slide-over comments, and <=180s enforcement verified in `viewerPlayback.test.mjs`.
- [x] `IMPLEMENTED_UNVERIFIED` — Channel customization: avatar and banner image uploads with WebP normalization and CDN URL persistence.
- [x] `IMPLEMENTED_UNVERIFIED` — WTPP application workflow: creator submission with field-bound AES-GCM PII encryption and administrative review queues.
- [ ] `BLOCKED` — Full viewer and creator workflows verified against a populated non-production database with real media playback.

---

## Phase 8 — Mobile Application Readiness

- [x] `COMPLETE_VERIFIED` — Expo / React Native viewer codebase in `apps/mobile/` with typed API contracts and 19 passing unit tests (`apps/mobile/tests/contracts.test.mjs`).
- [x] `IMPLEMENTED_UNVERIFIED` — Mobile Shorts player integration with vertical swipe gesture handling, looping playback, and <=180s duration enforcement.
- [x] `IMPLEMENTED_UNVERIFIED` — Mobile video and Short upload workflow (`apps/mobile/src/api/uploadWorkflow.ts` and `apps/mobile/src/studio/mediaUpload.ts`) with contract validations.
- [ ] `BLOCKED` — Physical device and emulator testing on Android and iOS (auth cookie persistence across restart, cellular data streaming, orientation).
- [x] `COMPLETE_VERIFIED` — Mobile export readiness: `npx expo export` bundles cleanly for iOS and Android.
- [ ] `NOT_STARTED` — EAS build profiles, app signing certificates, splash screens, icons, and app store metadata.
- [ ] `NOT_STARTED` — Kinyarwanda and English localization with runtime language switching.

---

## Email, Notifications & Creator Wallet Communications

- [x] `COMPLETE_VERIFIED` — Centralized delivery to each account's registered email: provider-agnostic `EmailDispatcher` (`apps/api/src/services/email/`) supporting `MockEmailTransport`, `ConsoleEmailTransport`, and `SmtpEmailTransport` with fail-safe error isolation, tested via `email-dispatcher.test.ts` (5/5 passing).
- [x] `COMPLETE_VERIFIED` — Durable email outbox & crash recovery: implemented `EmailOutbox` model (`packages/database/prisma/schema.prisma` with migration `20261123150000_durable_email_outbox_and_preferences`), atomic job claiming (`PROCESSING`), exponential backoff with jitter, permanent vs retryable error classification, bounded attempts, and automated crash recovery for orphaned jobs; tested via `email-outbox.test.ts` (6/6 passing).
- [x] `COMPLETE_VERIFIED` — Worker Email Outbox Integration & Background Lifecycle: Integrated `EmailOutboxProcessor` into `apps/worker/src/worker.ts` alongside BullMQ video transcoding without cascade failure. Supports truthful non-sensitive startup telemetry, in-flight batch drain on shutdown, clock-skew tolerant lease claiming, expired lease recovery, automatic interval draining verified end-to-end, and atomic unique claim tokens preventing concurrent double-claims or duplicate deliveries; tested via `worker.emailOutbox.test.ts` (17/17 passing) and full worker suite (36/36 passing). Total monorepo tests: 384/384 passing.
- [x] `COMPLETE_VERIFIED` — WTP acceptance, rejection, and status notifications sent directly to creator's registered email (`renderWtppStatusEmail`, `renderWtppReceivedEmail`, and `PlatformEventDispatcher` producing in-app and durable email notifications on submit, review, approval, and rejection).
- [x] `COMPLETE_VERIFIED` — Payment received confirmations: notifications sent upon successful viewer payments or tip transactions (`renderPaymentReceivedEmail` and `FinancialNotificationConsumer` bridging Workstream A `PAYMENT_RECEIVED` event).
- [x] `COMPLETE_VERIFIED` — Creator wallet withdrawal notifications: payout dispatch confirmation (`WITHDRAWAL_DISPATCHED`), initiation (`WITHDRAWAL_REQUESTED`), and status alerts (`WITHDRAWAL_FAILED`) generated from `PaymentOrchestratorService` lifecycle events.
- [ ] `NOT_STARTED` — A common scheduled wallet withdrawal date: pending Founder approval for policy (do not invent withdrawal date or cycle without approval).
- [x] `COMPLETE_VERIFIED` — Upload, processing, and publishing notifications: email templating (`renderVideoProcessingStatusEmail`) and notification events (`VIDEO_PROCESSING_COMPLETED`, `VIDEO_PROCESSING_FAILED`, `VIDEO_PUBLISHED`) wired into video lifecycle.
- [x] `COMPLETE_VERIFIED` — Copyright, moderation, and policy notifications: notices for claims and takedowns (`COPYRIGHT_DECISION` via `renderCopyrightClaimEmail`), and community guideline strikes (`MODERATION_STRIKE_ISSUED` via `renderSecurityAlertEmail`).
- [x] `COMPLETE_VERIFIED` — Account security alerts (`renderSecurityAlertEmail`) for administrative password changes, role modifications (`ADMIN_ROLE_CHANGED` via `renderAdminRoleChangedEmail`), and unusual activity; strictly mandatory and impossible to disable.
- [x] `COMPLETE_VERIFIED` — Admin and operational health: `GET /api/v1/admin/email/health` endpoint returning operational outbox health stats (`pending`, `processing`, `sent`, `retryableFailure`, `permanentFailure`, `total`, `transportName`, `isConfigured`) without leaking PII; `POST /api/v1/admin/email/outbox/:id/retry` allowing `SUPER_ADMIN` manual retry with full audit logging; verified via `admin-email-health.route.test.ts` (5/5 passing).
- [x] `COMPLETE_VERIFIED` — Delivery tracking, retries, and notification preferences: `NotificationPreference` model with migration `20261123150000_durable_email_outbox_and_preferences`, authenticated REST API (`GET/PATCH /api/v1/notifications/preferences`), strict user isolation, and mandatory security override preventing disabling security alerts; verified via `notification-preferences.route.test.ts` (5/5 passing) and `platform-events.test.ts` (5/5 passing).
- [x] `COMPLETE_VERIFIED` — Appropriate in-app notifications: database-backed `Notification` model with migration `20261123140000_enforce_channel_uniqueness_and_notifications`, `NotificationService`, REST endpoints (`GET /api/v1/notifications`, `GET /unread-count`, `PATCH /:id/read`, `POST /read-all`), and `FinancialNotificationConsumer` integration (3/3 passing in `notifications.route.test.ts`).
- [x] `COMPLETE_VERIFIED` — Account & channel uniqueness: strict 1 user = 1 channel enforced at database level (`Channel_userId_key`) and API route layer (`POST /api/v1/channels`), tested via `channel-uniqueness.test.ts` (4/4 passing, 11/11 total channel tests).

---

## Phase 9 — Production Security, Reliability & Operations

- [x] `IMPLEMENTED_UNVERIFIED` — Local loopback guards in API and worker launchers preventing unintended external database or Redis connections.
- [x] `IMPLEMENTED_UNVERIFIED` — Encrypted backup prototype (`tools/backup-system/`) with 18 passing tests covering AES-GCM streaming encryption, manifest checksums, and R2 stream dumps.
- [ ] `NOT_STARTED` — Automated backup scheduling, independent key custody, offsite retention, and clean-machine restore drills.
- [ ] `NOT_STARTED` — Application observability: structured JSON logging, Prometheus metrics, distributed tracing, and incident alert thresholds.
- [ ] `NOT_STARTED` — Infrastructure as Code (IaC), container Dockerfiles, and CI/CD deployment pipelines for API, worker, and web apps.
- [ ] `NOT_STARTED` — Staging environment rehearsal with rollback procedures and data integrity checks.
- [ ] `NOT_STARTED` — Comprehensive penetration testing, OWASP Top 10 audit, and dependency supply-chain vulnerability scans.

---

## Phase 10 — Public Launch Acceptance

- [ ] `BLOCKED` — All 10 preceding execution phases confirmed at `COMPLETE_VERIFIED`.
- [ ] `BLOCKED` — Production database schema reconciled, approved, and migrated with backup provenance.
- [ ] `BLOCKED` — Cloudflare R2 production buckets verified with active SSL custom domains and scoped credentials.
- [ ] `BLOCKED` — Live MTN MoMo and Airtel Money merchant accounts validated with sandbox and production keys.
- [ ] `BLOCKED` — Founder `SUPER_ADMIN` bootstrap verified and 3 partner `ADMIN` positions provisioned.
- [ ] `BLOCKED` — Legal, privacy policy, creator terms, and store review disclosures approved.
- [ ] `BLOCKED` — Executive sign-off from Founder & CEO.
