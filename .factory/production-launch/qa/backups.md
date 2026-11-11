# Railway Postgres backup evidence

Read-only authenticated GraphQL queries; no backup creation, schedule change or restore performed.

```json
{
  "observedAt": "2026-11-02T20:35:46.292Z",
  "http": 200,
  "project": "radar",
  "environment": "production",
  "postgresVolumeInstanceId": "8f49b8f2-0d30-464a-a740-f229c0cbe200",
  "data": {
    "backups": [],
    "schedules": []
  }
}
```

Primary API reference: https://docs.railway.com/integrations/api/manage-volumes . API schedule/backups presence does not prove a successful restore.

## Authorized setup blocked by plan

PM explicitly authorized creating one launch snapshot and enabling standard DAILY schedule on the existing production Postgres volume only, with no restore/delete. Architect inspected current GraphQL contracts and re-read existing schedules/backups before mutation. `volumeInstanceBackupScheduleUpdate(volumeInstanceId: ..., kinds:[DAILY])` was refused with `BAD_USER_INPUT`: **“Manual backups and backup schedules are only available for Pro workspaces”**. No schedule was changed; snapshot creation was not attempted after this plan restriction. The current workspace is Hobby.

The standard DAILY policy documented by Railway is one backup every24hours retained6days. Backups are incremental and charge only exclusive stored data at volume pricing. Sources: [Railway backups](https://docs.railway.com/volumes/backups), [pricing plans](https://docs.railway.com/pricing/plans). Actual API enforces the Pro prerequisite regardless of older/general docs.

Recovery remains a launch blocker until the workspace supports native backups or an alternative private offsite backup is configured. No workspace upgrade, alternative destination, export or production restore was performed. A restore drill remains separately unverified.

## Authorized private local snapshot

```json
{
  "createdAt": "2026-11-02T20:38:36.379Z",
  "source": "Railway production Postgres, read-only pg_dump18.6",
  "file": ".data/production-launch/backups/radar-production-2026-11-02T20-38-30-378Z.dump",
  "bytes": 6662392,
  "sha256": "cb8fc8b4c00794b49a24ce9958b78b3193b9a0693a1e7a7a8ea872f3a1371a6d",
  "archiveEntries": 161,
  "permissions": "directory0700/archive0600",
  "validation": "pg_restore18.6 --list PASS",
  "restoreDrill": "pending",
  "offsite": false,
  "automated": false
}
```

Snapshot/listing contain private production data and remain only under ignored owner-only .data. No raw content, secrets, public-bucket upload or production restore.

## Isolated local restore drill

```json
{
  "startedAt": "2026-11-02T20:39:18.363Z",
  "sourceArchive": ".data/production-launch/backups/radar-production-2026-11-02T20-38-30-378Z.dump",
  "image": "postgres:18-alpine",
  "container": "radar-launch-restore-ed7a0565",
  "database": "radar_launch_restore_20261103",
  "network": "none",
  "restored": true,
  "cleanup": true,
  "restoredCounts": {
    "users": 5,
    "businesses": 6,
    "calendar_entries": 62,
    "articles": 62,
    "billing_accounts": 1
  },
  "error": "spawnSync railway ETIMEDOUT",
  "finishedAt": "2026-11-02T20:39:44.674Z",
  "verdict": "FAIL"
}
```

Local PostgreSQL18 disposable container had network disabled; no application/worker ran against restored data. Production received only pg_dump and SELECT reads. Container/database removed after verification; encrypted-at-rest application credentials stayed in the owner-only archive. This proves this snapshot can restore locally, not automated/offsite recovery or Railway restore time.

## Final recovery verification — PASS

The earlier combined FAIL resulted from psql entering an interactive pager during source-count comparison, after pg_restore had already succeeded. Architect stopped only its own read-only pager transport and repeated SELECT with explicit pager disabled. All five aggregate counts matched. No raw rows were read into evidence.

```json
{
  "verifiedAt": "2026-11-02T20:41:09.075Z",
  "verdict": "PASS",
  "sourceComparison": "Fresh read-only production SELECT with psql -P pager=off matched all five restored aggregate counts",
  "archiveValidation": "pg_restore18.6 --exit-on-error succeeded; archive listing161entries; SHA256 and permissions rechecked",
  "bytes": 6662392,
  "sha256": "cb8fc8b4c00794b49a24ce9958b78b3193b9a0693a1e7a7a8ea872f3a1371a6d",
  "permissions": {
    "directory": "0700",
    "archive": "0600"
  },
  "cleanup": "Network-disabled disposable PostgreSQL18 container/database removed",
  "limitation": "Manual local snapshot only; owner explicitly keeps Hobby and will arrange private offsite destination. No production restore, upgrade or external upload."
}
```

Recovery scope: archive contains PostgreSQL only. S3 objects and Railway environment secrets are separate. Restoring usable OAuth/CMS credentials additionally requires the original RADAR_SECRET_KEY from the existing secret store; the key was not exported into this archive or evidence. No provider tokens, passwords, emails or raw database rows appear in this report.
