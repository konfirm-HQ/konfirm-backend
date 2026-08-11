# Builds just the `stellar` CLI binary, needed for the on-chain compliance
# check (payments.service.ts's isAllowedOnChain). `cargo install` is the
# officially documented way to get it — chosen over downloading a prebuilt
# release binary, since asset-naming conventions can't be verified without
# a real Docker build to test against on this machine.
FROM rust:1-slim AS stellar-cli
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
