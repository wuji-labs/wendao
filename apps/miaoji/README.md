# @wuji/miaoji-web — Wendao web frontend

The Next.js 16 / React 19 web frontend for **Wendao** — self-hosted meeting & media transcription with speaker diarization and AI minutes. Runs on port **3101**.

This app is a thin shell: most UI lives in the shared **[`@wuji/miaoji-web-ui`](../../packages/miaoji-web-ui)** package (library, transcript detail, clip views, player, panels), which this app mounts via `MiaojiProviders`. It talks to the backend **[`@wuji/miaoji-api`](../../packages/miaoji-api)** (port 3100) over tRPC.

For the product overview, features, and architecture, see the **[root README](../../README.md)** and **[docs/architecture.md](../../docs/architecture.md)**.

## Develop

```bash
# from the repo root
pnpm install
pnpm -F @wuji/miaoji-web dev      # → http://localhost:3101
```

The dev frontend signs in as a fixed seed user (`NEXT_PUBLIC_MIAOJI_USER_ID`, matching the backend seed) so you can use it immediately without an auth layer. Replace this when integrating real authentication.

## How it connects to the API

- **tRPC + media** go through a **same-origin proxy**: the browser hits `:3101`, and `next.config.mjs` rewrites `/trpc`, `/upload`, and `/media` to the API (`MIAOJI_API_URL`, default `http://127.0.0.1:3100`). This avoids CORS.
- **Large uploads** connect **directly** to the API origin (`NEXT_PUBLIC_MIAOJI_API_BASE`) to bypass the Next dev proxy's request timeout for big files.

## Configuration

| Variable                      | Default                 | Purpose                                                   |
| ----------------------------- | ----------------------- | --------------------------------------------------------- |
| `MIAOJI_API_URL`              | `http://127.0.0.1:3100` | Server-side rewrite target for tRPC/upload/media          |
| `NEXT_PUBLIC_MIAOJI_API_BASE` | `http://127.0.0.1:3100` | API origin the browser uses for direct uploads            |
| `NEXT_PUBLIC_MIAOJI_USER_ID`  | seed dev user           | Fixed user id used in dev (until SSO/auth is wired)       |
| `NEXT_PUBLIC_DEV_ORIGINS`     | _(empty)_               | Comma-separated LAN hosts/IPs allowed as Next dev origins |

See the [configuration reference](../../docs/configuration.md) for the full list.

## Embedding in another host

The UI is built to be reusable: `@wuji/miaoji-web-ui` exposes `MiaojiProviders` plus `MiaojiLibrary` / `MiaojiDetail` / `MiaojiClip`, parameterized by a route prefix and session identity. This standalone app is the reference host; another platform can mount the same screens under a different route base.

> Note: the UI is currently zh-CN only. English/i18n contributions are welcome.
