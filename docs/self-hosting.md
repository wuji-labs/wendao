# Self-hosting Wendao

This guide covers a production self-hosted deployment, both via Docker Compose and manually. For the full
environment variable reference, see [configuration.md](./configuration.md). For the system layout, see
[architecture.md](./architecture.md).

## Prerequisites

| Requirement            | Version             | Needed by        | Notes                                                                          |
| ---------------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------ |
| Node.js                | 20+                 | web, api, worker |                                                                                |
| pnpm                   | 9+                  | all (monorepo)   | `corepack enable` works too                                                    |
| PostgreSQL             | 16                  | api, worker      |                                                                                |
| ffmpeg / ffprobe       | recent (8.x tested) | api              | On PATH, or set `FFMPEG_BIN` / `FFPROBE_BIN`                                   |
| Ollama                 | recent              | LLM features     | With a model pulled, e.g. `ollama pull qwen3:30b-a3b`                          |
| Python                 | 3.11 or 3.12        | asr              | **Not 3.13/3.14** — ML wheels (torch/whisperx/pyannote) don't support them yet |
| NVIDIA GPU + CUDA 12.x | —                   | asr              | Strongly recommended. CPU works but is very slow.                              |

The LLM features (AI minutes, chapters, to-dos, auto-title, translation, Q&A) require Ollama. They are
generated **on demand** and their failure never blocks transcript availability, so Ollama is technically
optional if you only need transcripts.

## Option A — Docker Compose

A `docker-compose.yml` at the repo root brings up the stack. It defines services named `postgres`, `api`,
`worker`, `web`, and an optional `asr`.

> The compose file and Dockerfiles are maintained alongside the app. This guide assumes those service
> names; consult the compose file for the exact build context and image tags.

1. **Configure.** Create a `.env` at the repo root from the example file (`.env.example`) and set at
   minimum `POSTGRES_PASSWORD`, `DATABASE_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_MIAOJI_API_BASE`, and your
   Ollama/ASR endpoints. See [configuration.md](./configuration.md).

2. **Bring up the core services:**

   ```bash
   docker compose up -d postgres api worker web
   ```

3. **Run migrations** (first boot, against the running Postgres):

   ```bash
   docker compose exec api pnpm -F @wuji/miaoji-api db:migrate
   ```

4. **(Optional) seed a demo minute** so you can verify the UI end-to-end without an ASR model:

   ```bash
   docker compose exec api pnpm -F @wuji/miaoji-api db:seed
   ```

5. **(Optional) start the ASR service.** ASR needs a CUDA GPU and large model downloads, so it is a
   separate, opt-in service:

   ```bash
   docker compose up -d asr
   ```

   If you don't run `asr`, transcription requests fail but the rest of the app (uploads, demo data,
   AI-on-existing-transcripts) works.

6. Visit the web app (default `:3101`, or whatever you mapped it to behind your reverse proxy).

## Option B — Manual

Run each process yourself. This is the most flexible path and what you'll use for bare-metal GPU hosts.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Postgres

Create a database and user, and set `DATABASE_URL` accordingly. Then generate/apply the schema with
drizzle-kit:

```bash
pnpm -F @wuji/miaoji-api db:migrate
```

(Optional, to verify the UI without ASR:)

```bash
pnpm -F @wuji/miaoji-api db:seed
```

### 3. API + worker

The API and the worker share the same package. Run them as **two processes**:

```bash
# API server (:3100) — tRPC, /upload, /media
pnpm -F @wuji/miaoji-api start          # production (after `pnpm -F @wuji/miaoji-api build`)
# or for dev:
pnpm -F @wuji/miaoji-api dev

# Worker — polls Postgres and runs the pipeline
pnpm -F @wuji/miaoji-api dev:worker
```

> The API also enqueues a pipeline run in-process immediately after an upload, so a single API process can
> process minutes on its own. Running a **separate worker** is recommended for production so processing
> load doesn't block API request handling, and so you can scale the worker independently.

### 4. Web

```bash
# build then start
pnpm -F miaoji build && pnpm -F miaoji start    # serves :3101
# or dev:
pnpm -F miaoji dev
```

Set `MIAOJI_API_URL` (server-side proxy target) and `NEXT_PUBLIC_MIAOJI_API_BASE` (browser-reachable API
base for direct uploads).

### 5. ASR

Python 3.11/3.12 in a dedicated venv. On the host with the GPU:

```bash
cd apps/miaoji-asr
# install torch matching your CUDA first, then the rest
python -m venv .venv && . .venv/bin/activate    # Windows: .\.venv\Scripts\Activate.ps1
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 9400
```

On Windows there's a `run.ps1` that does the uv-based equivalent. First transcription downloads the
Whisper model (`large-v3` is several GB) plus alignment/diarization models — needs network and disk.

Point the API at it with `MIAOJI_ASR_URL` (default `http://127.0.0.1:9400`).

## Reverse proxy

Only the **web** service (`:3101`) needs to be public. The web server proxies `/trpc`, `/upload`, and
`/media` to the API via Next rewrites, so the API does not need to be publicly exposed _unless_ you use
direct large-file uploads from the browser.

Checklist:

- **Expose `:3101`** behind your TLS-terminating proxy (nginx / Caddy / Traefik).
- **`CORS_ORIGIN`** — set the API's `CORS_ORIGIN` to your public web origin (comma-separated for several).
  Required if the browser uploads **directly** to the API (`NEXT_PUBLIC_MIAOJI_API_BASE` pointing at a
  public API URL); not needed when everything goes through the same-origin Next proxy.
- **Large upload limits.** Uploads can be up to **4 GB** (API multipart limit). Raise your proxy's request
  body limit accordingly, e.g. nginx `client_max_body_size 4g;` and generous `proxy_read_timeout` /
  `client_body_timeout`. For the largest files, prefer direct-to-API upload via
  `NEXT_PUBLIC_MIAOJI_API_BASE` so the file doesn't stream through the Next server.
- **WebSocket / streaming** is not required for the core flow; progress is polled over tRPC.

Example nginx snippet for the web service:

```nginx
location / {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 4g;
    proxy_read_timeout 600s;
}
```

## GPU notes

- ASR auto-detects the device: CUDA if available, else CPU. `compute_type` is `float16` on CUDA, `int8` on
  CPU. CPU transcription works but is dramatically slower — plan for a GPU in production.
- The ASR model is **unloaded after `ASR_IDLE_UNLOAD_SEC` (default 90 s) of inactivity** to free GPU
  memory for the local LLM, and reloaded lazily on the next request. If your GPU is dedicated to ASR (LLM
  on another box), you can set `ASR_IDLE_UNLOAD_SEC=0` to keep the model resident.
- Match your torch wheel to your CUDA version. A torch/CUDA mismatch silently falls back to CPU (slow).
- ASR and the LLM contend for GPU memory if co-located. The idle-unload behaviour is designed for the
  single-GPU case; for heavy use, put Ollama on a separate GPU/host and point `OLLAMA_BASE_URL` at it.

## Scaling the worker

- The worker is a simple serial poller with a single-flight in-memory lock (one minute at a time per
  process). To increase throughput, run **multiple worker processes**.
- Because the worker picks the oldest non-terminal minute and the in-flight lock is **per-process**, the
  current implementation does not coordinate locks across processes — for multi-worker production the code
  comments recommend swapping the poller for a real queue (e.g. pg-boss). Until then, the safest scaling
  unit is **one worker process** plus the API's in-process enqueue.
- ASR is the real bottleneck (GPU-bound). Scaling typically means **more ASR replicas** behind a load
  balancer at `MIAOJI_ASR_URL`, not more workers.
