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

# Keep the last 14 backups locally, prune older ones — this is NOT a
# substitute for offsite storage (see README note), just bounds local disk
# usage for day-to-day dev use.
ls -1t "$BACKUP_DIR"/"${DB_NAME}"_*.dump 2>/dev/null | tail -n +15 | xargs rm --
