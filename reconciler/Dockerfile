# Pinned to bookworm explicitly, matching the runtime stage's
# debian:bookworm-slim below — `rust:1-slim` floats to whatever Debian
# release is current, which had drifted ahead of bookworm and produced a
# binary linked against a newer glibc than the runtime image ships
# ("GLIBC_2.38/2.39 not found"), crash-looping the container. Confirmed live
# against a real failed deployment, not a defensive guess.
FROM rust:1-bookworm AS builder
# build-essential (gcc/g++/make) and libdbus-1-dev are both required by
# stellar-cli's native dependencies (cc-rs needs a real C++ compiler;
# libdbus-sys needs D-Bus headers to compile at all, even though the
# --secure-store feature that actually uses D-Bus is never invoked here) —
# both confirmed the hard way against two separate failed Railway builds.
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates build-essential libdbus-1-dev libudev-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# Same `stellar` CLI the on-chain compliance check needs (src/compliance.rs)
# — built in this same Rust stage since it's already paying the toolchain
# cost building the reconciler binary itself.
RUN cargo install --locked stellar-cli --root /out

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/konfirm-reconciler /usr/local/bin/konfirm-reconciler
COPY --from=builder /out/bin/stellar /usr/local/bin/stellar

# No internal `while true` restart loop here — the hosting platform's own
# restart-on-exit policy relaunches this when `watch` exits (hitting
# max_polls, or an error), which is simpler than nesting two restart
# mechanisms. RECONCILER_MAX_POLLS defaults high so that isn't the normal
# way this process ends in production.
ENTRYPOINT ["/bin/sh", "-c", "exec konfirm-reconciler watch \"$MERCHANT_STELLAR_ADDRESS\" \"${RECONCILER_MAX_POLLS:-999999}\" \"${RECONCILER_INTERVAL_SECS:-3}\""]
