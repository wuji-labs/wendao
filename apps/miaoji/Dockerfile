# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Wendao web image  (apps/miaoji — Next.js 16 + React 19)
#
# WORKSPACE NOTE:
#   next.config.mjs uses `transpilePackages` for @wuji/miaoji-contracts and
#   @wuji/miaoji-web-ui (both shipped as raw TS source), and imports the
#   AppRouter TYPE from @wuji/miaoji-api (`import type`, fully erased at build).
#   So the BUILD needs those workspace packages present in node_modules; the
#   api package contributes only types.
#
#   Next standalone output is NOT configured, so we don't fake a standalone
#   runtime. The simplest correct runtime is `next start`, which needs the
#   built .next plus node_modules — we carry them over from the builder.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Manifests first for cached installs.
COPY pnpm-workspace.yaml package.json ./
COPY apps/miaoji/package.json                apps/miaoji/package.json
COPY packages/miaoji-api/package.json        packages/miaoji-api/package.json
COPY packages/miaoji-contracts/package.json  packages/miaoji-contracts/package.json
COPY packages/miaoji-web-ui/package.json     packages/miaoji-web-ui/package.json

# Install everything the web build needs (incl. its transpiled workspace deps
# and the api package that supplies the AppRouter type).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @wuji/miaoji-web... --frozen-lockfile=false

# Sources required by the web build.
COPY packages/miaoji-contracts packages/miaoji-contracts
COPY packages/miaoji-web-ui    packages/miaoji-web-ui
COPY packages/miaoji-api       packages/miaoji-api
COPY apps/miaoji               apps/miaoji

# MIAOJI_API_URL is read at runtime by next.config.mjs rewrites; the
# NEXT_PUBLIC_* base is inlined at build time, so allow overriding it here.
ARG NEXT_PUBLIC_MIAOJI_API_BASE=http://127.0.0.1:3100
ENV NEXT_PUBLIC_MIAOJI_API_BASE=${NEXT_PUBLIC_MIAOJI_API_BASE}

RUN pnpm --filter @wuji/miaoji-web build

# ── Stage 2: runtime — `next start` ──────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Carry over installed deps + built app from the builder (no re-install).
COPY --from=builder /app/node_modules               ./node_modules
COPY --from=builder /app/package.json               ./package.json
COPY --from=builder /app/pnpm-workspace.yaml        ./pnpm-workspace.yaml
COPY --from=builder /app/packages/miaoji-contracts  ./packages/miaoji-contracts
COPY --from=builder /app/packages/miaoji-web-ui     ./packages/miaoji-web-ui
COPY --from=builder /app/packages/miaoji-api        ./packages/miaoji-api
COPY --from=builder /app/apps/miaoji                ./apps/miaoji

RUN chown -R node:node /app
USER node

EXPOSE 3101

# `next start -p 3101` (see apps/miaoji package.json "start").
CMD ["pnpm", "--filter", "@wuji/miaoji-web", "start"]
