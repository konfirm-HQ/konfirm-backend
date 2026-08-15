FROM node:20-slim
WORKDIR /app

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
