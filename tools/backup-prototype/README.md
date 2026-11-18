# Local PostgreSQL Backup Prototype

This development-only prototype uses fictional data, local PostgreSQL 18.4, Node's built-in AES-256-GCM, and Windows DPAPI. It has no application startup, scheduler, cloud, R2, or production connection path.

## Run

From this directory, run:

```powershell
node .\prototype.mjs
```

The default PostgreSQL client directory is `C:\Program Files\PostgreSQL\18\bin`, local endpoint is fixed to `127.0.0.1:5432`, and the default local role is `postgres`. If needed, use `--pg-bin <path>` or `--role <local-role>`. The role must already have permission to create databases. The program disables password prompts, ignores inherited PostgreSQL connection variables, and points `PGPASSFILE` at a nonexistent file.

Each run generates two new, collision-checked database names: one source and one restore target. It verifies the local server identity and each database identity before running schema, seed, restore, or verification SQL. It never drops or reuses a database. Both databases are intentionally left intact; if a run fails after database creation, inspect the printed names and do not assume the partial database was cleaned up.

Output is created under `%TEMP%\WatchTubeBackupPrototype\<unique-run-id>`, outside the repository. The archive is produced by `pg_dump -Fc` in memory, encrypted before being written, and decrypted only in memory for `pg_restore --list` and restore. The encrypted archive and manifest are under `encrypted-backups`; the DPAPI-protected key blob is under the separate `key-material` directory. Negative-test artifact copies and a validation report are retained in the run directory. Output files use create-new semantics and are not overwritten.

The synthetic schema has 2 users, 2 channels, 3 videos, and 6 video variants. It includes primary keys, three foreign keys, three unique constraints, a check constraint, and fixed timestamps. The manifest records server/client versions, UTC timestamps, counts, sizes, and SHA-256 hashes without credentials or key material.

## Encryption and Key Limits

The archive uses AES-256-GCM with a fresh 32-byte key and 12-byte nonce per run. Its authenticated envelope contains a format marker, nonce, 16-byte authentication tag, and ciphertext. SHA-256 is checked before decryption; GCM authentication is checked before plaintext is returned. The 32-byte key is protected with `ProtectedData` using `DataProtectionScope.CurrentUser` and a fixed application-specific entropy string. The DPAPI-protected key is stored separately from the encrypted archive.

This demonstrates local confidentiality and tamper detection only. Current-user DPAPI is tied to this Windows user/profile and machine environment; it does not prove portable disaster recovery. Losing the profile/key blob, changing the machine, or losing DPAPI recovery material can make backups unrecoverable. A portable key-recovery process requires a separately approved key-management design and tested independent recovery copies. The key is never printed, logged, placed in command-line arguments, or written in plaintext to disk by the prototype.

The program captures up to 64 MiB of custom archive in memory and is only intended for small synthetic data. PostgreSQL client and server versions must be exactly 18.4. It does not back up cluster roles, external configuration, Managed Auth service configuration, media objects, or queues. The manifest is not signed and must not be trusted if both it and the encrypted artifact can be replaced by the same attacker.

## Restore and Negative Tests

The run first checks encrypted artifact SHA-256 and size, DPAPI-unprotects the key, validates GCM authentication, checks the plaintext SHA-256 and size, and lists the archive TOC with `pg_restore --list`. It creates a new empty target database, verifies its identity, then restores transactionally with ownership/ACL replay disabled. It compares all table counts, constraint counts, and relationship counts. A synthetic source-only row is added after restore; it must not appear in the restore database.

The prototype also uses copies of the encrypted artifact for one-byte ciphertext modification, incorrect key, incorrect tag, incorrect manifest hash, and an authenticated but invalid PostgreSQL archive. Every case must fail safely, and source/target state snapshots must remain unchanged during those negative tests. It performs another encrypted hash and decrypt/hash check at the end.

## Before Production Use

Production use requires, at minimum: an approved portable key custody/recovery process; correct backups for roles, grants, extensions, Neon Auth and external providers; cost-reviewed storage and retention; scheduling and missed-run alerts; size and performance limits; version compatibility policy; protected immutable off-site copies; privacy/security review; and repeated restore rehearsals on isolated targets. This prototype establishes none of those production guarantees.