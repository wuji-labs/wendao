# Contributing to Wendao

Thanks for your interest in Wendao (闻道) — a self-hosted meeting & media transcription
platform with speaker diarization and AI minutes. Contributions of every size are welcome:
bug reports, fixes, docs, translations, and features.

This guide gets you from a fresh clone to a running dev environment and a clean pull request.

---

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local development setup](#local-development-setup)
- [Running the three services](#running-the-three-services)
- [Coding standards](#coding-standards)
- [Before you open a PR](#before-you-open-a-pr)
- [Pull request process](#pull-request-process)
- [Comments, language & i18n](#comments-language--i18n)
- [Reporting bugs & requesting features](#reporting-bugs--requesting-features)
- [Security](#security)
- [License](#license)

---

## Ways to contribute

- **Fix a bug** — grab anything labelled `good first issue` or `help wanted`.
- **Improve docs** — setup guides, troubleshooting, deployment notes.
- **Translate / i18n** — the UI is currently zh-CN; English and other locales are very welcome
  (see [Comments, language & i18n](#comments-language--i18n)).
- **Add a feature** — please open or comment on an issue first so we can align on direction
  before you invest time.

If you're unsure where to start, open a [Discussion](https://github.com/wuji-labs/wendao/discussions)
or comment on an existing issue.

---

## Project structure

Wendao is a pnpm + Turborepo monorepo. The codename in code and directories is `miaoji`.

```
wendao/
├─ apps/
│  ├─ miaoji          Next.js 16 + React 19 web frontend (@wuji/miaoji-web) · port 3101
│  └─ miaoji-asr      Python 3.11/3.12 FastAPI ASR service                  · port 9400
├─ packages/
│  ├─ miaoji-api      Fastify 5 + tRPC v11 + Drizzle (Postgres) (@wuji/miaoji-api) · port 3100
│  │                  └─ also ships a background worker process
│  ├─ miaoji-contracts  Shared Zod schemas (@wuji/miaoji-contracts)
│  └─ miaoji-web-ui     Shared React UI components (@wuji/miaoji-web-ui)
├─ turbo.json
├─ pnpm-workspace.yaml
└─ .env.example
```

| Service | Stack                                                   | Port | Notes                                      |
| ------- | ------------------------------------------------------- | ---- | ------------------------------------------ |
| Web     | Next.js 16, React 19                                    | 3101 | The UI users interact with                 |
| API     | Fastify 5, tRPC v11, Drizzle                            | 3100 | HTTP/tRPC API                              |
| Worker  | (part of `@wuji/miaoji-api`)                            | —    | Picks up transcription jobs from the queue |
| ASR     | FastAPI, WhisperX / faster-whisper, pyannote / DiariZen | 9400 | GPU strongly recommended                   |

The ASR service handles speech-to-text and speaker diarization. The API orchestrates jobs and
persists results to Postgres; the worker drains the job queue and calls the ASR service.

---

## Prerequisites

- **Node** `>=20` (the repo pins `22` in `.nvmrc` — `nvm use` if you have nvm)
- **pnpm** `>=9` (`corepack enable` will provide the pinned version from `package.json`)
- **Docker** (for Postgres; optional if you run Postgres yourself)
- **Python** `3.11` or `3.12` (only if you work on the ASR service)
- **ffmpeg / ffprobe** on your `PATH` (used by the API/worker for media handling)
- A **GPU** is recommended for the ASR service but not required for most non-ASR work.

---

## Local development setup

```bash
# 1. Clone
git clone https://github.com/wuji-labs/wendao.git
cd wendao

# 2. Install workspace dependencies
corepack enable        # provides the pinned pnpm version
pnpm install

# 3. Configure environment
cp .env.example .env
# Open .env and review it. For most local work the defaults are fine.
# Set HF_TOKEN only if you want pyannote speaker diarization (see ASR notes below).

# 4. Start Postgres
# The root .env.example provides POSTGRES_* and DATABASE_URL for a local container.
# Bring up Postgres with docker compose (service name: postgres):
docker compose up -d postgres

# 5. Run database migrations and seed data
pnpm -F @wuji/miaoji-api db:migrate
pnpm -F @wuji/miaoji-api db:seed
```

> **Note:** A committed lockfile may not be present in early development. If `pnpm install`
> reports lockfile mismatches, run a plain `pnpm install` (without `--frozen-lockfile`).

### ASR service (optional, for transcription work)

```bash
cd apps/miaoji-asr
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

The ASR service is structured so its **top-level import requires no ML libraries** — you can
`python -c "import app.main"` to smoke-test the module without a GPU or model weights. The heavy
WhisperX / pyannote / DiariZen dependencies load lazily when a transcription actually runs.

`pyannote` diarization requires a Hugging Face token. Accept the model terms at
`https://hf.co/pyannote/speaker-diarization-3.1`, then set `HF_TOKEN` in your `.env`. The
**DiariZen** backend uses non-commercial weights — do not use them in commercial deployments.

---

## Running the three services

Run everything in parallel via Turborepo:

```bash
pnpm dev
```

Or run services individually in separate terminals:

```bash
# API (port 3100)
pnpm -F @wuji/miaoji-api dev

# Worker (drains the transcription queue)
pnpm -F @wuji/miaoji-api dev:worker

# Web frontend (port 3101)
pnpm -F @wuji/miaoji-web dev

# ASR service (port 9400) — from apps/miaoji-asr
uvicorn app.main:app --host 0.0.0.0 --port 9400
```

Open <http://localhost:3101> once the web app is running.

---

## Coding standards

- **TypeScript, strict mode.** Keep types honest — avoid `any`; prefer the shared Zod schemas in
  `@wuji/miaoji-contracts` for data that crosses service boundaries.
- **Prettier** is the single source of truth for formatting. Config (`.prettierrc.json`):
  no semicolons, single quotes, `printWidth` 110, no trailing commas, `arrowParens: avoid`.
  Run `pnpm format` before committing.
- **Tests** use [Vitest](https://vitest.dev). Add or update tests alongside behavioural changes;
  bug fixes should include a regression test that fails before the fix.
- **Conventional Commits** are encouraged (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`). This keeps history readable and helps with changelogs.
- Keep changes focused. One logical change per PR makes review faster.

---

## Before you open a PR

Run the full local check suite — these mirror CI:

```bash
pnpm type-check      # tsc across the workspace
pnpm test            # vitest across the workspace
pnpm format:check    # prettier --check (use `pnpm format` to auto-fix)
```

For the ASR service:

```bash
cd apps/miaoji-asr
python -c "import app.main"   # top-level import must succeed without ML libs
```

---

## Pull request process

1. Fork the repo and create a topic branch from `main`
   (e.g. `fix/worker-retry`, `feat/en-locale`).
2. Make your change, with tests and updated docs where relevant.
3. Run the checks above so CI passes on the first try.
4. Open the PR against `main`. Fill out the PR template — describe **what** changed, **why**,
   and **how you tested it**.
5. A maintainer (signing as **WUJI Labs**) will review. Address feedback by pushing follow-up
   commits; we squash-merge, so don't worry about a tidy intermediate history.

### Sign-off (optional)

We don't require a CLA. If you'd like to certify the
[Developer Certificate of Origin](https://developercertificate.org/), add a `Signed-off-by`
line with `git commit -s`. It's optional but appreciated.

---

## Comments, language & i18n

Wendao originated in a Chinese-speaking team, so existing code comments are a **mix of Chinese
and English** and the UI is currently **zh-CN**. This is expected — please don't reformat existing
comments wholesale.

- New comments may be in **English or Chinese**; write whichever communicates the intent best.
- **English and i18n contributions are explicitly welcome.** Help extracting hard-coded UI strings,
  adding an `en` locale, or improving translations is high-value and a great first contribution.

---

## Reporting bugs & requesting features

Use the issue forms:

- 🐞 [Bug report](https://github.com/wuji-labs/wendao/issues/new?template=bug_report.yml)
- ✨ [Feature request](https://github.com/wuji-labs/wendao/issues/new?template=feature_request.yml)

For open-ended questions, prefer
[Discussions](https://github.com/wuji-labs/wendao/discussions).

---

## Security

Please **do not** open public issues for security vulnerabilities. Follow the process in
[SECURITY.md](./SECURITY.md) instead.

---

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
