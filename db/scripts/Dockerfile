# A dedicated small image for the backup cron service — the main API
# Dockerfile has no reason to carry pg_dump or the aws CLI, and this one
# has no reason to carry Node. Separate image, separate concern.
FROM debian:bookworm-slim
# Debian bookworm's default apt repos only ship postgresql-client 15, but
# Railway's managed Postgres runs 18 — pg_dump refuses to dump from a
# server newer than itself ("aborting because of server version
# mismatch"), confirmed live. The official PostgreSQL (PGDG) apt repo
# ships current major versions for bookworm; installing postgresql-client-18
# explicitly (not the bare postgresql-client metapackage, which would still
# resolve to whatever bookworm's own default is) keeps the client version
# matched to the actual server rather than to Debian's release cadence.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client-18 \
    awscli \
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
