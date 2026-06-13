# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Wendao API / worker image  (packages/miaoji-api)
#
# WORKSPACE / TS-SOURCE NOTE — read before "optimizing" this file:
#   @wuji/miaoji-api depends on @wuji/miaoji-contracts, which is published inside
#   the monorepo as RAW TYPESCRIPT ("main": "./src/index.ts" — no build step).
#   `tsc` compiles miaoji-api into dist/, but the emitted JS still imports
#   `@wuji/miaoji-contracts`, which resolves to that package's .ts source — so
#   `node dist/server.js` would fail to load an un-compiled .ts file at runtime.
#
#   The robust, correct choice is therefore to run the service with **tsx** at
#   runtime, with the full pnpm workspace (incl. contracts TS source) present.
#   tsx transpiles TS on the fly, so the TS-source workspace dep just works,
#   the AppRouter types stay intact, and there is zero "compiled api + raw-TS
#   dep" mismatch. We prioritize CORRECTNESS over image size here, exactly as
#   the brief asks. (We still run `tsc` once in the builder as a type-check gate.)
#
#   The same image runs BOTH the API server and the worker loop — compose just
#   overrides the command for the worker service.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder — install full workspace deps + type-check ──────────────
FROM node:22-slim AS builder
WORKDIR /app

# Enable pnpm via corepack, pinned to the version in root package.json.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy only the manifests first so `pnpm install` is cached across source edits.
COPY pnpm-workspace.yaml package.json ./
COPY packages/miaoji-api/package.json        packages/miaoji-api/package.json
COPY packages/miaoji-contracts/package.json  packages/miaoji-contracts/package.json

# Install workspace deps for just the api + its contracts dependency.
# (Full store would also pull web/asr manifests; we scope to what api needs.)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @wuji/miaoji-api... --frozen-lockfile=false

# Copy the sources needed to build/run the api.
COPY packages/miaoji-contracts packages/miaoji-contracts
COPY packages/miaoji-api        packages/miaoji-api

# Type-check + emit dist/ as a build gate (catches type errors at image build).
# Runtime uses tsx (see note above), but a clean tsc keeps the build honest.
RUN pnpm --filter @wuji/miaoji-api build

# ── Stage 2: runtime — slim node + ffmpeg, non-root, run via tsx ─────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg + ffprobe are required by the transcode pipeline (lib/ffmpeg).
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Bring over the installed workspace (node_modules incl. tsx + the contracts
# TS source) and the application sources. We copy from the builder so we never
# re-install in the runtime layer.
COPY --from=builder /app/node_modules                         ./node_modules
COPY --from=builder /app/package.json                         ./package.json
COPY --from=builder /app/pnpm-workspace.yaml                  ./pnpm-workspace.yaml
COPY --from=builder /app/packages/miaoji-contracts            ./packages/miaoji-contracts
COPY --from=builder /app/packages/miaoji-api                  ./packages/miaoji-api

# Storage dir for uploaded media + derived artifacts (mounted as a volume).
ENV MIAOJI_STORAGE_DIR=/app/.storage
RUN mkdir -p /app/.storage && \
    # node:slim ships a `node` user (uid 1000) — run unprivileged.
    chown -R node:node /app
USER node

WORKDIR /app/packages/miaoji-api
EXPOSE 3100

# Run via tsx (transpiles the TS-source workspace dep on the fly). Use the
# locally installed tsx from node_modules/.bin.
CMD ["node", "--import", "tsx", "src/server.ts"]
