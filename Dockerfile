# Builds just the `stellar` CLI binary, needed for the on-chain compliance
# check (payments.service.ts's isAllowedOnChain). `cargo install` is the
# officially documented way to get it — chosen over downloading a prebuilt
# release binary, since asset-naming conventions can't be verified without
# a real Docker build to test against on this machine.
FROM rust:1-bookworm AS stellar-cli
# Pinned to bookworm explicitly, matching node:20-slim's own bookworm base
# below — `rust:1-slim` floats to whatever Debian release is current, which
# produced a stellar CLI binary linked against a newer glibc than the
# runtime image ships (confirmed live in reconciler/Dockerfile's identical
# builder — same fix applied here for the same reason).
# build-essential (gcc/g++/make) and libdbus-1-dev are both required by
# stellar-cli's native dependencies (cc-rs needs a real C++ compiler;
# libdbus-sys needs D-Bus headers to compile at all, even though the
# --secure-store feature that actually uses D-Bus is never invoked here) —
# both confirmed the hard way against two separate failed Railway builds.
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates build-essential libdbus-1-dev libudev-dev \
    && rm -rf /var/lib/apt/lists/*
RUN cargo install --locked stellar-cli --root /out

FROM node:20-slim
WORKDIR /app
# libdbus-1-dev (builder stage, above) satisfies the *compile-time* header
# dependency for libdbus-sys, but the compiled `stellar` binary also carries
# a hard *runtime* dynamic-link dependency on libdbus-1.so.3 — confirmed
# live in production ("error while loading shared libraries: libdbus-1.so.3")
# even though the --secure-store feature that's the only thing that
# actually calls into D-Bus is never invoked here. Linux resolves all of a
# binary's linked libraries at process startup, not lazily per feature, so
# the runtime image needs the shared library itself (no -dev suffix — just
# the .so, not headers) or `stellar` refuses to start at all.
RUN apt-get update && apt-get install -y --no-install-recommends libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=stellar-cli /out/bin/stellar /usr/local/bin/stellar

COPY package.json package-lock.json ./
# Full deps, not --omit=dev — `npm start` runs the TypeScript source
# directly via ts-node (see package.json), the exact same execution path
# every local run and CI's `tsc --noEmit` already validate. A separate
# compiled dist/ production path would be new, untested territory.
RUN npm ci

COPY . .

# PORT is injected by the hosting platform at runtime — src/main.ts already
# reads process.env.PORT with a local-dev fallback.
CMD ["npm", "start"]
