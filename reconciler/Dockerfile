# Pinned to bookworm explicitly, matching the runtime stage's
# debian:bookworm-slim below — `rust:1-slim` floats to whatever Debian
# release is current, which had drifted ahead of bookworm and produced a
# binary linked against a newer glibc than the runtime image ships
# ("GLIBC_2.38/2.39 not found"), crash-looping the container. Confirmed live
# against a real failed deployment, not a defensive guess.
FROM rust:1-bookworm AS builder
# build-essential (gcc/g++/make), pkg-config, and libssl-dev are for the
# reconciler binary's own build, not stellar-cli — soroban-client's reqwest
# dependency pulls in native-tls (confirmed via `cargo tree -i native-tls`),
# which links against system OpenSSL on Linux (unlike macOS, where
# native-tls uses Security.framework instead — a local `cargo build` here
# doesn't prove this stage needs nothing). libdbus-1-dev/libudev-dev, which
# used to be required by stellar-cli's own native dependencies, are gone
# now that the CLI isn't built here at all — compliance.rs calls the
# compliance contract over RPC directly instead (see that file).
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
# libssl3 (native-tls's runtime dependency, same reasoning as the builder
# stage) and ca-certificates stay; libdbus-1-3/libudev1 are gone along with
# the `stellar` binary that was the only thing needing them.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/konfirm-reconciler /usr/local/bin/konfirm-reconciler

# No internal `while true` restart loop here — the hosting platform's own
# restart-on-exit policy relaunches this when `watch` exits (hitting
# max_polls, or an error), which is simpler than nesting two restart
# mechanisms. RECONCILER_MAX_POLLS defaults high so that isn't the normal
# way this process ends in production.
ENTRYPOINT ["/bin/sh", "-c", "exec konfirm-reconciler watch \"$MERCHANT_STELLAR_ADDRESS\" \"${RECONCILER_MAX_POLLS:-999999}\" \"${RECONCILER_INTERVAL_SECS:-3}\""]
