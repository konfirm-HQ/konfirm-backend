FROM rust:1-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
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
