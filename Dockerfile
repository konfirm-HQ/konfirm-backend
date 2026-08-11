# Builds just the `stellar` CLI binary, needed for the on-chain compliance
# check (payments.service.ts's isAllowedOnChain). `cargo install` is the
# officially documented way to get it — chosen over downloading a prebuilt
# release binary, since asset-naming conventions can't be verified without
# a real Docker build to test against on this machine.
FROM rust:1-slim AS stellar-cli
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
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
