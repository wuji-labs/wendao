# Configuration

All configuration is via environment variables with sensible local defaults. The repo-root `.env.example`
is the canonical reference and is also what `docker-compose` reads; per-package `.env.example` files exist
for running a single service standalone (e.g. `packages/miaoji-api/.env.example`).

Create your own `.env` from the example file (copy `.env.example` to a new file named `.env` at the repo
root), then open it and fill in values for your environment.

Variables are grouped by the service that reads them. A variable can be read by more than one service
(e.g. `MIAOJI_STORAGE_DIR` is read by both the API and indirectly relied on by the worker, which shares
the API process/codebase).

## Database (Postgres)

| Variable            | Default                                          | Service      | Description                                                                                                                    |
| ------------------- | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER`     | `miaoji`                                         | postgres     | Postgres role (used by the docker-compose `postgres` service).                                                                 |
| `POSTGRES_PASSWORD` | `miaoji`                                         | postgres     | Postgres password. **Change this in production.**                                                                              |
| `POSTGRES_DB`       | `miaoji`                                         | postgres     | Database name.                                                                                                                 |
| `DATABASE_URL`      | `postgres://miaoji:miaoji@localhost:5432/miaoji` | api / worker | Connection string used by the API, worker, and `drizzle-kit` migrations. In Docker this points at the `postgres` service host. |

## API / server (`packages/miaoji-api`)

| Variable                | Default                 | Service | Description                                                                                                                                                                                        |
| ----------------------- | ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3100`                  | api     | API listen port.                                                                                                                                                                                   |
| `HOST`                  | `0.0.0.0`               | api     | API bind address.                                                                                                                                                                                  |
| `CORS_ORIGIN`           | `http://localhost:3101` | api     | Comma-separated list of allowed origins. If unset, CORS is fully open (`true`). Set this to your public web origin in production.                                                                  |
| `MIAOJI_STORAGE_DIR`    | `./.storage`            | api     | Root dir for original media + transcoded artifacts. Resolved to an absolute path. Can point at an S3/OSS-mounted path.                                                                             |
| `MIAOJI_ARCHIVE_DIR`    | (empty = disabled)      | api     | Optional archive root. When set, a READY minute's original recording + transcript copy are filed under `<archiveDir>/<YYYY-MM>/<title-token>/`. Point at any local dir or a mounted NAS/SMB share. |
| `FFMPEG_BIN`            | `ffmpeg`                | api     | ffmpeg executable name/path (must be on PATH or absolute).                                                                                                                                         |
| `FFPROBE_BIN`           | `ffprobe`               | api     | ffprobe executable name/path.                                                                                                                                                                      |
| `MIAOJI_WORKER_POLL_MS` | `3000`                  | worker  | How often the standalone worker polls Postgres for pending minutes.                                                                                                                                |

> Auth note: the API identifies the user via the `x-user-id` request header (placeholder for a future
> SSO/identity layer). There is no auth-related env var yet — see the [roadmap](./roadmap.md).

## Web (`apps/miaoji`)

| Variable                      | Default                 | Service           | Description                                                                                                                                             |
| ----------------------------- | ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MIAOJI_API_BASE` | `http://127.0.0.1:3100` | web (browser)     | Where the **browser** reaches the API for direct large-file uploads. Must be browser-reachable in production (your public API URL).                     |
| `MIAOJI_API_URL`              | `http://127.0.0.1:3100` | web (Next server) | The rewrite target the Next server proxies `/trpc`, `/upload`, and `/media` to. Server-side only.                                                       |
| `NEXT_PUBLIC_DEV_ORIGINS`     | (empty)                 | web               | Comma-separated LAN hosts/IPs allowed as Next dev origins (e.g. `192.168.1.50`) so phones/other machines on the LAN can reach the dev server. Optional. |

## ASR microservice (`apps/miaoji-asr`)

| Variable           | Default                 | Service | Description                                                                                                                                                                                                                    |
| ------------------ | ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MIAOJI_ASR_URL`   | `http://127.0.0.1:9400` | api     | Where the API reaches the ASR service.                                                                                                                                                                                         |
| `MIAOJI_ASR_HOST`  | `0.0.0.0`               | asr     | ASR service bind address.                                                                                                                                                                                                      |
| `MIAOJI_ASR_PORT`  | `9400`                  | asr     | ASR service listen port.                                                                                                                                                                                                       |
| `ASR_DEVICE`       | `auto`                  | asr     | `auto` / `cuda` / `cpu`. `auto` uses CUDA if available, else CPU. Explicit `cuda` falls back to CPU if CUDA is unavailable (never crashes).                                                                                    |
| `ASR_COMPUTE_TYPE` | (auto)                  | asr     | Leave empty to auto-select: `float16` on CUDA, `int8` on CPU.                                                                                                                                                                  |
| `WHISPER_MODEL`    | `large-v3`              | asr     | Whisper model name; downloaded on first use.                                                                                                                                                                                   |
| `HF_TOKEN`         | (empty)                 | asr     | Hugging Face token. **Required only for pyannote diarization** — you must also accept the model terms at `https://hf.co/pyannote/speaker-diarization-3.1`. Not needed for the default sherpa-onnx / DiariZen diarization path. |

Additional ASR tuning knobs (read from the environment, not in `.env.example`):

| Variable                  | Default         | Description                                                                                                                                                |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASR_BEAM`                | `1`             | Beam size for faster-whisper (1 = fastest).                                                                                                                |
| `ASR_CHUNK_SEC`           | `900`           | Chunk length (seconds) for long audio; bounded memory. Quietest-point cut avoids splitting words.                                                          |
| `ASR_IDLE_UNLOAD_SEC`     | `90`            | Idle seconds before unloading the ASR model to free the GPU for the LLM. `0` disables.                                                                     |
| `MIAOJI_DIAR_BACKEND`     | `auto`          | Diarization backend: `auto` (DiariZen preferred, falls back to sherpa) / `diarizen` / `sherpa`. See [diarization-and-models](./diarization-and-models.md). |
| `MIAOJI_VOICEPRINT_MODEL` | `eres2netv2_zh` | Voiceprint embedding model filename (without `.onnx`). Falls back `eres2netv2_zh → campplus_zh → spk_embed`.                                               |
| `DIAR_THRESHOLD`          | `0.5`           | sherpa-onnx clustering threshold.                                                                                                                          |
| `DIAR_TIMEOUT`            | `1800`          | Diarization subprocess timeout (seconds).                                                                                                                  |

## LLM (Ollama, OpenAI-compatible)

Used for AI minutes (summary / key points / risks), chapters, to-dos, auto-title, translation, and the
transcript Q&A — all with clickable source-line citations.

| Variable           | Default                     | Service | Description                                                                                            |
| ------------------ | --------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `OLLAMA_BASE_URL`  | `http://127.0.0.1:11434/v1` | api     | OpenAI-compatible LLM endpoint. Point at any OpenAI-compatible server.                                 |
| `OLLAMA_API_KEY`   | `ollama`                    | api     | API key sent to the LLM endpoint (Ollama ignores it; a real OpenAI-compatible gateway may require it). |
| `MIAOJI_LLM_MODEL` | `qwen3:30b-a3b`             | api     | Model name. Must be pulled into Ollama (`ollama pull qwen3:30b-a3b`) or available on your endpoint.    |

## Storage & archiving

- **`MIAOJI_STORAGE_DIR`** holds two kinds of files:
  - original uploads under `uploads/<uuid>/<filename>`, and
  - transcoded artifacts under `derived/<minuteId>/` (`audio.wav`, `playable.mp4`/`playable.m4a`,
    `cover.jpg`).
    It can be a local directory or an S3/OSS bucket mounted into the filesystem.
- **`MIAOJI_ARCHIVE_DIR`** (optional) is a separate, best-effort archive written when a minute reaches
  `READY`. It never blocks the pipeline, and can point at a NAS/SMB mount. Leave empty to disable.
