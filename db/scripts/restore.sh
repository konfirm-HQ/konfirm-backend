#!/usr/bin/env bash
# Restores a backup produced by backup.sh into a target database.
# Usage: db/scripts/restore.sh <dump_file> <target_database>
#
# Refuses to overwrite a database that already has tables in it, unless
# FORCE=1 is set — a restore script that can silently clobber a live
# database on a typo is worse than no restore script at all.
set -euo pipefail

DUMP_FILE="${1:?usage: restore.sh <dump_file|s3://bucket/key> <target_database>}"
TARGET_DB="${2:?usage: restore.sh <dump_file|s3://bucket/key> <target_database>}"

# Dumps live in S3 now (see backup.sh) — fetch to a temp path first rather
# than requiring the caller to download it themselves. Real DR means being
# able to restore from the off-machine copy directly, not just from
# whatever happens to still be on local disk.
if [[ "$DUMP_FILE" == s3://* ]]; then
  TMP_DUMP="$(mktemp -t konfirm-restore.XXXXXX.dump)"
  trap 'rm -f "$TMP_DUMP"' EXIT
  echo "Fetching $DUMP_FILE ..."
  aws s3 cp "$DUMP_FILE" "$TMP_DUMP"
  DUMP_FILE="$TMP_DUMP"
elif [ ! -f "$DUMP_FILE" ]; then
  echo "No such dump file: $DUMP_FILE" >&2
  exit 1
fi

if ! psql -lqt | cut -d '|' -f 1 | grep -qw "$TARGET_DB"; then
  echo "Database '$TARGET_DB' does not exist — creating it."
  createdb "$TARGET_DB"
fi

TABLE_COUNT=$(psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" "$TARGET_DB")
if [ "$TABLE_COUNT" -gt 0 ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Refusing to restore into '$TARGET_DB': it already has $TABLE_COUNT table(s)." >&2
  echo "Set FORCE=1 to restore anyway (this drops and recreates conflicting objects)." >&2
  exit 1
fi

pg_restore -d "$TARGET_DB" --clean --if-exists --no-owner "$DUMP_FILE"
echo "Restored $DUMP_FILE into '$TARGET_DB'."
