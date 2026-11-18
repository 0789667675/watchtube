# WatchTube local backup system

This tool is separate from `tools/backup-prototype`. It is a local, opt-in implementation; it does not load `.env` files, run automatically, or change hosting and database configuration. Commands that access a service require credentials to be supplied in the process environment. Never pass connection strings or access keys as command-line arguments.

## Status and scope

Implemented:

- Read-only PostgreSQL and R2 inventory.
- PostgreSQL custom-format dumps and optional role/tablespace export.
- Paginated copies of every object in the configured raw and public R2 buckets.
- Per-artifact AES-256-GCM encryption, SHA-256 checksums, encrypted JSONL manifest, and a final completion marker.
- Exclusive local run directories and no-overwrite artifact finalization.
- Local integrity verification, loopback-only PostgreSQL restore drills, and isolated object-storage restore drills.
- Optional copy of the encrypted run to a separately configured S3-compatible destination.
- Dry-run retention reporting and a loopback-only BullMQ reconstruction utility.
- Idempotent `VideoVariant` updates under transaction-scoped advisory locks; no schema migration is required.

Not implemented or not proven:

- No scheduled execution, alerting, automatic retention deletion, mirror download, or complete clean-machine provisioning.
- PostgreSQL and R2 are copied sequentially, not as one cross-service point-in-time snapshot. Pause writes and media processing for a consistent cut, or use provider-supported snapshots/versioning.
- R2 object version IDs are not retained. The tool compares listed/downloaded sizes and ETags, but this does not provide an immutable source snapshot.
- Role/global SQL is encrypted and recorded as captured only when `pg_dumpall --globals-only --no-role-passwords` succeeds. It is not automatically applied during restore.
- Encryption keys, environment configuration, external provider settings, identity-provider state, and deployment settings are not included in backups.
- Redis/BullMQ itself is not backed up. Only eligible `PROCESSING` video jobs can be reconstructed, and only after checking that the raw object still exists.
- `restore-test` verifies a database dump by restoring it to a new loopback database, but leaves that database in place. It never drops a database.
- Remote destination isolation cannot be fully inferred from an S3 endpoint. The operator must use an independently controlled account and bucket.

Therefore this is a useful local backup foundation, not a production-ready disaster-recovery service until its restore procedures, independent destination, capacity, monitoring, and recovery objectives are validated.

## Runtime requirements

- Node.js with built-in `node:test`, `node:crypto`, streams, and filesystem APIs.
- PostgreSQL client tools (`pg_dump`, `pg_dumpall`, `pg_restore`, and `psql`) for database commands. Set `PG_BIN` to their directory if they are not discoverable.
- Existing workspace dependencies: `@aws-sdk/client-s3` from `apps/api`, and BullMQ, ioredis, and `@watchtube/database` from `apps/worker`.
- An already-created backup destination directory outside the repository. The tool refuses a repository-local destination.

The CLI uses `DATABASE_URL`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_RAW`, and `R2_BUCKET_PUBLIC` as applicable. Bucket defaults match the current API/worker defaults. Database backup connections to non-loopback hosts require `sslmode=verify-full`; a trusted CA may be supplied with the PostgreSQL `sslrootcert` URL parameter.

The backup encryption key is a separate 32-byte file. Create it at a new path outside both the repository and backup destination:

```powershell
node tools\backup-system\cli.mjs keygen 'D:\secure\watchtube-backup.key'
```

Keep independently protected recovery copies of the key. Losing it makes encrypted backups unrecoverable; storing the only copy beside the backup defeats separation. Windows file permissions inherit from the containing directory, so restrict that directory to the backup operator and verify its ACL. The tool does not silently change ACLs.

Before running a backup, set the following non-secret paths in the current PowerShell process:

```powershell
$env:WATCHTUBE_BACKUP_ROOT = 'E:\WatchTubeBackups'
$env:WATCHTUBE_BACKUP_KEY_FILE = 'D:\secure\watchtube-backup.key'
```

Supply service credentials through an approved secret-aware process launcher or secure shell environment. The tool never reads `.env`, `.env.local`, or `.env.example`, and it never prints credential values. Process environments are still accessible to sufficiently privileged local processes.

## Commands

```powershell
node tools\backup-system\cli.mjs inventory
node tools\backup-system\cli.mjs backup:database
node tools\backup-system\cli.mjs backup:media
node tools\backup-system\cli.mjs backup:full
node tools\backup-system\cli.mjs verify <run-id>
node tools\backup-system\cli.mjs restore-test <run-id>
node tools\backup-system\cli.mjs restore-media-test <run-id>
node tools\backup-system\cli.mjs retention:dry-run
```

`inventory` runs read-only PostgreSQL size/catalog queries and paginated R2 listings. Prefixes and largest-object keys are represented by hashes in output to avoid disclosing user-derived object keys.

Each backup creates a unique `run-*` directory. Existing run directories and artifacts are never overwritten. Encrypted payloads use a versioned envelope with a random nonce, AES-256-GCM authentication tag, and SHA-256 checksums. The manifest is encrypted and authenticated with the same key. `.complete` is written only after all requested artifacts and the encrypted manifest finish. Failed runs have no completion marker and are not accepted by verification.

The local free-space preflight uses inventory sizes plus a safety reserve. It is an estimate, not a guarantee against concurrent disk use or later growth. Temporary plaintext used by verification/restore is placed in the operating-system temp directory and removed on normal completion; a forced process or machine failure may leave it behind.

### Optional independent S3-compatible mirror

Set `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, and `BACKUP_S3_BUCKET` to enable encrypted-run mirroring after local finalization. The destination must be HTTPS, non-empty at the unique run prefix, and is verified by object size and SHA-256 metadata. The exact source Cloudflare R2 endpoint is refused. This check cannot prove ownership separation for custom endpoint aliases.

The completion marker is uploaded last. A failed transfer can leave an incomplete remote prefix; no remote object is deleted or overwritten. The tool does not estimate provider charges or guarantee free-tier capacity.

### Restore drills

`restore-test` requires `WATCHTUBE_RESTORE_TEST=1` and `WATCHTUBE_RESTORE_TEST_URL` with a loopback host. It creates a unique database with `createdb`, runs `pg_restore --single-transaction --no-owner --no-acl`, and checks the restored catalog. It never connects to a non-loopback database and does not drop the test database. Use an isolated local cluster and review installed extensions/roles before relying on an actual recovery.

`restore-media-test` first verifies the entire local run, then writes plaintext objects under `watchtube-restore-tests/<run-id>/` in the separately configured `RESTORE_S3_*` destination bucket. It refuses an existing prefix and writes a completion marker last. The restored objects are deliberately not deleted; use a dedicated non-production bucket/account and clean it up manually only after review.

### BullMQ reconstruction

Run the planner first:

```powershell
node tools\backup-system\requeue-processing.mjs --dry-run
```

It reads only videos whose database status is `PROCESSING`, validates that each raw key belongs to the channel owner, and performs R2 `HeadObject` checks. It is restricted to loopback PostgreSQL and Redis. To actually retry failed jobs or add missing jobs, both `WATCHTUBE_REQUEUE_PROCESSING=1` and `WATCHTUBE_REQUEUE_STORAGE_ISOLATED=1` are required. The latter is an explicit operator attestation that the worker's R2 credentials and active worker are non-production. A running worker may immediately process queued work. Completed jobs whose database rows remain `PROCESSING` are reported for manual investigation instead of duplicated.

Queue reconstruction is not a Redis backup. It does not repair missing raw uploads, rejected videos, completed-but-inconsistent jobs, or other queue families.

## Retention and scheduling

`retention:dry-run` reports a proposed 7-day / 5-week / 12-month keep set. It never deletes backups. Incomplete runs are retained. There is no scheduler or alerting configured; invoke backups only from an explicitly managed, monitored job after credential and destination review.

## Tests

Run the isolated, synthetic tests without touching the application database, R2, Redis, or backup destination:

```powershell
node --test tools\backup-system\tests\core.test.mjs tools\backup-system\tests\queue-recovery.test.mjs tools\backup-system\tests\storage.test.mjs tools\backup-system\tests\postgres.test.mjs
```

The tests use temporary OS directories and remove only those test-owned directories.
