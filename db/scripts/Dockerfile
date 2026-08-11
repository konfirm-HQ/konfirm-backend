# A dedicated small image for the backup cron service — the main API
# Dockerfile has no reason to carry pg_dump or the aws CLI, and this one
# has no reason to carry Node. Separate image, separate concern.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    awscli \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY db/scripts/backup.sh db/scripts/backup.sh
RUN chmod +x db/scripts/backup.sh
# PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE come from Railway's Postgres
# variable references (see the backup-cron service's env vars) — backup.sh
# itself needs no changes, it already relies on these ambient libpq vars.
# Shell form so $PGDATABASE actually expands, rather than being passed to
# the script literally as the string "$PGDATABASE".
ENTRYPOINT ["/bin/sh", "-c", "exec db/scripts/backup.sh \"$PGDATABASE\""]
