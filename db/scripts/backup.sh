#!/usr/bin/env bash
# Dumps the Konfirm database to a timestamped, compressed file.
# Usage: db/scripts/backup.sh [database_name]
set -euo pipefail

DB_NAME="${1:-konfirm_dev}"
BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backups" && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

# Custom format (-Fc): compressed, and restorable with pg_restore including
# --clean/--if-exists for a clean re-import — a plain SQL dump would work
# too, but this is smaller and lets pg_restore do selective/parallel restores
# if the database ever grows enough for that to matter.
pg_dump -Fc "$DB_NAME" > "$OUT_FILE"

echo "Backed up '$DB_NAME' to $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Off-machine copy, before anything local gets pruned below — a local-only
# backup doesn't survive the disk it's sitting on failing. Set
# BACKUP_S3_BUCKET to enable; unset is still a normal local-only backup, so
# this stays free to run without an AWS account for day-to-day dev use.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  aws s3 cp "$OUT_FILE" "s3://${BACKUP_S3_BUCKET}/$(basename "$OUT_FILE")"
  echo "Uploaded to s3://${BACKUP_S3_BUCKET}/$(basename "$OUT_FILE")"
else
  echo "BACKUP_S3_BUCKET not set — skipping off-machine upload (this backup only exists locally)." >&2
fi

# Keep the last 14 backups locally, prune older ones — this is NOT a
# substitute for offsite storage, just bounds local disk usage for
# day-to-day dev use. Pruning only ever happens after the upload above, so
# nothing is deleted locally before it's shipped off-machine.
ls -1t "$BACKUP_DIR"/"${DB_NAME}"_*.dump 2>/dev/null | tail -n +15 | xargs rm --
