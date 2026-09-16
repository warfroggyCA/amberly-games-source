# Backup and recovery

## Current evidence and limits

The operator tool captures the entire `scrabble` schema as a consistent PostgreSQL custom archive, including tables, constraints, policies and grants. It encrypts the archive with AES-256-GCM and a separate 32-byte key. The recovery check authenticates the archive before opening any database and restores into a new local, socket-only cluster; it accepts no remote restore target.

The database test suite uses this actual tool, compares row counts and ordered-content digests for **every** application table, rejects a damaged archive, and refuses overwriting an existing backup. A separate database test restores original grants, while the normal database suite tests runtime permissions. The isolated operator rehearsal deliberately skips grants and changes ownership, so its success proves data/schema recovery, not reconstruction of hosted permissions.

**Hosted capture, scheduled backups, off-device storage and key custody are not yet configured by this milestone.** No claim is made that a current hosted backup exists. Supabase Auth identities, OAuth/provider configuration, database login roles/passwords, platform settings, and other schemas are outside this application-schema archive. The membership records retain Auth UUIDs, but a new Supabase project requires explicit identity recovery/mapping and configuration validation before reopening writes. Browser-local drafts/previews require their own in-app exports.

## Operator capture

Use PostgreSQL client tools at least as new as the server. Keep the key outside the repository and save a second secure copy separately from the encrypted archives. Losing the key makes the backups unusable.

```sh
node scripts/backup-database.mjs new-key /secure/location/amberly.backup.key
export SCRABBLE_BACKUP_KEY_FILE=/secure/location/amberly.backup.key
export SCRABBLE_PG_BIN=/path/to/postgresql/bin
export PGHOST=your-database-host
export PGPORT=5432
export PGUSER=your-approved-backup-operator
export PGDATABASE=postgres
export PGSSLMODE=verify-full
# Configure PGSSLROOTCERT when the server requires a private CA.
# Supply the password through a protected libpq passfile, never command text or Git.
node scripts/backup-database.mjs capture /secure/location/amberly-YYYY-MM-DD.backup.enc
node scripts/backup-database.mjs restore-check /secure/location/amberly-YYYY-MM-DD.backup.enc
```

`capture` requires an operator with complete schema access; never widen the application login for backups. It fails on inaccessible tables, timeouts or invalid archives. It never overwrites existing files. The tool bounds archive size to 256 MB; larger archives need a reviewed streaming implementation. Connection secrets and PostgreSQL stderr are deliberately omitted from tool output.

A verified backup should be copied to separate private storage, with its encrypted-file SHA-256, date, source project, schema migration list and restore result. Choose storage/retention and authorize operator access before enabling automatic capture. A suggested family-service target is daily capture and a monthly restore rehearsal, but no schedule is installed here.

## Real incident recovery

1. Stop scoring writes and preserve browser drafts and failed request envelopes.
2. Preserve the current database and export before any repair; establish which snapshot is authoritative.
3. Authenticate and rehearse the backup locally. Compare its age and contents with retained journals; do not overwrite production to test a restore.
4. Recover into a separate reviewed target. Restore role/permission and Auth configuration deliberately; verify membership mappings and all security tests.
5. Replay supported immutable journals and reconcile changes since the snapshot. Review any missing turns with the scorer rather than inventing results.
6. Obtain approval before switching the application to the recovered target. Verify read paths before allowing scoring again.

See Supabase’s [project backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) for the broader provider migration steps outside this application-schema tool.
