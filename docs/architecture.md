# Architecture

Wendao (闻道) is a self-hosted meeting and media transcription platform: upload audio/video, get a
word-level transcript with speaker separation, AI-generated minutes, chapters, to-dos, translation, and
a chat-with-the-transcript Q&A — all running on your own hardware, with a local LLM and a local ASR model.

This document describes the system at a level that lets you operate, extend, or debug it.

## System overview

```
                            ┌──────────────────────────────────────────────────┐
                            │                    Your server                    │
                            │                                                   │
  ┌─────────┐   HTTPS   ┌───┴────────────┐   same-origin    ┌──────────────────┐│
  │ Browser ├──────────▶│  web (Next 16) │   /trpc /upload  │  api (Fastify 5) ││
  │         │           │   apps/miaoji  ├─────────────────▶│ packages/miaoji- ││
  │         │◀──────────┤    :3101       │   rewrites       │      api  :3100  ││
  └────┬────┘           └────────────────┘                  └───┬───────┬──────┘│
       │  direct upload (large files)                           │       │       │
       │  POST /upload  ───────────────────────────────────────┘       │       │
       │                                                                │       │
       │                          ┌─────────────────────────────────────┘       │
       │                          │                                              │
       │                ┌─────────▼─────────┐   ┌──────────────┐  ┌────────────┐ │
       │                │  worker (in-proc  │   │  PostgreSQL  │  │   local    │ │
       │                │  or standalone)   │──▶│  (16)        │  │  storage   │ │
       │                │  runPipeline()    │   └──────────────┘  │ .storage/  │ │
       │                └────┬─────────┬────┘                     └────────────┘ │
       │                     │         │                                         │
       │       HTTP /transcribe       HTTP /v1/chat/completions                  │
       │                     │         │                                         │
       │           ┌─────────▼──────┐  └──▶┌────────────────────┐                │
       │           │  asr (FastAPI) │      │  Ollama  :11434    │                │
       │           │ apps/miaoji-asr│      │  qwen3:30b-a3b     │                │
       │           │    :9400 (GPU) │      │  (OpenAI-compat)   │                │
       │           └────────────────┘      └────────────────────┘                │
       │                                                                         │
       └─────────────────────────────────────────────────────────────────────────
```

All dependencies are self-hosted. Nothing is sent to a third-party cloud unless you point
`OLLAMA_BASE_URL` at a remote endpoint yourself.

## The five components

| Component        | Path                        | Stack                                                | Port   | Responsibility                                                          |
| ---------------- | --------------------------- | ---------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| **Web**          | `apps/miaoji`               | Next.js 16, React 19                                 | `3101` | UI; same-origin proxy to the API via Next rewrites                      |
| **API + Worker** | `packages/miaoji-api`       | Fastify 5, tRPC v11, Drizzle ORM, `postgres`         | `3100` | tRPC API, file upload, media serving, and the processing pipeline       |
| **ASR**          | `apps/miaoji-asr`           | Python 3.11/3.12, FastAPI, WhisperX / faster-whisper | `9400` | Transcription, word-level timestamps, diarization, voiceprint embedding |
| **Contracts**    | `packages/miaoji-contracts` | TypeScript, Zod                                      | —      | Cross-language type SSOT (shared types/enums)                           |
| **Web UI**       | `packages/miaoji-web-ui`    | React                                                | —      | Shared UI components consumed by `apps/miaoji`                          |

### Web (`apps/miaoji`, :3101)

The Next.js front end. It never talks to the API across a different origin in the browser; instead, the
Next server **rewrites** a set of paths to the API so the browser sees everything as same-origin (no CORS
in the common path). From `apps/miaoji/next.config.mjs`:

```js
async rewrites() {
  const API_URL = process.env.MIAOJI_API_URL ?? 'http://127.0.0.1:3100'
  return [
    { source: '/trpc/:path*',  destination: `${API_URL}/trpc/:path*` },
    { source: '/upload',       destination: `${API_URL}/upload` },
    { source: '/media/:path*', destination: `${API_URL}/media/:path*` }
  ]
}
```

For **large-file uploads**, the browser can post directly to the API at
`NEXT_PUBLIC_MIAOJI_API_BASE` (default `http://127.0.0.1:3100`) instead of going through the Next proxy,
avoiding double-buffering through the Next server.

### API + Worker (`packages/miaoji-api`, :3100)

A Fastify 5 server that exposes:

- **tRPC v11** at `/trpc` — the entire typed API surface (see [API surface](#api-surface)).
- **`POST /upload`** — `multipart/form-data` ingest. Stores the file under
  `uploads/<uuid>/<filename>` in local storage and returns a `mediaKey`. The client then calls
  `minute.create` with that key. Multipart limit is **4 GB**; the JSON body limit is 50 MB.
- **`GET /media/*`** — serves stored media/transcoded artifacts (static file server rooted at
  `MIAOJI_STORAGE_DIR`).

The **worker** (`src/pipeline/worker-loop.ts`) runs the processing pipeline. It can run:

- **In-process** — after an upload the API calls `enqueue(minuteId)`, which runs the pipeline
  immediately without waiting for the poll.
- **As a standalone process** — `pnpm -F @wuji/miaoji-api dev:worker` polls Postgres every
  `MIAOJI_WORKER_POLL_MS` (default 3000 ms) for any minute stuck in a non-terminal state and runs it.
  This is what lets you scale the worker independently of the API.

The worker is intentionally simple (serial, single-flight `Set` lock). The code comments note that a
production deployment can swap in a real queue (e.g. pg-boss).

### ASR (`apps/miaoji-asr`, :9400)

A Python FastAPI microservice called by the API over HTTP. Engines:

- **Primary: WhisperX** — Whisper ASR + wav2vec2 word-level alignment + pyannote diarization in one pass.
- **Fallback: faster-whisper** — ASR + word-level timestamps only; punctuation restoration and
  diarization are then added by a sherpa-onnx / DiariZen subprocess (`app/diar_punct.py`).

Key design properties:

- **Lazy loading.** No ML library is imported at module top level — they load on first request. This
  means the service starts even if torch/whisperx are missing; `/health` then reports
  `asrLoaded=false` rather than crashing.
- **Device auto-detection.** `cuda` if available, else `cpu`; `compute_type` is `float16` on CUDA and
  `int8` on CPU.
- **Idle unload.** After `ASR_IDLE_UNLOAD_SEC` (default 90 s) of inactivity it unloads the model to free
  the GPU for the local LLM, reloading lazily on the next request.
- **Graceful degradation.** If diarization is unavailable the transcript is still produced with
  `speaker=null` everywhere and `engine.diarized=false`; it never throws.

Endpoints: `GET /health`, `GET /progress/{jobId}`, `POST /transcribe`, `POST /embed` (voiceprint).

### Contracts (`packages/miaoji-contracts`)

The **single source of truth** for types, shared across all three languages/services — see
[Cross-language contract](#cross-language-contract).

### Web UI (`packages/miaoji-web-ui`)

Shared React components used by `apps/miaoji` (transcript view, player, etc.).

## Request / upload flow

1. Browser requests `POST /upload` (either via the Next rewrite, or directly to the API for large files).
2. API streams the file to `uploads/<uuid>/<filename>` and returns `{ mediaKey }`.
3. Browser calls tRPC `minute.create` with the `mediaKey`, media type, language, and optional
   `numSpeakers` hint. The API inserts a `minutes` row with `status=UPLOADING` and `enqueue`s it.
4. The worker runs `runPipeline(minuteId)` (see below). The UI polls `minute.status` for live progress
   and renders the transcript as soon as it's available.

## Processing pipeline (state machine)

`runPipeline` (`src/pipeline/run.ts`) drives one minute through the stages below. Each stage writes a
`jobs` row (`stage`, `status`, `progress`) so the UI can show per-stage progress. Any stage failure marks
both the `job` and the `minute` as `FAILED` with an `errorMessage`.

```
UPLOADING
    │  (worker picks it up)
    ▼
TRANSCODING ── ffmpeg: extract 16 kHz mono WAV + a playable mp4/m4a + cover frame (cached on re-run)
    ▼
TRANSCRIBING ── POST /transcribe to ASR :9400  (Whisper large-v3, word timestamps; real progress via /progress)
    ▼
DIARIZING ──── speaker separation (folded into the ASR call; this stage just records the result)
    ▼
SEGMENTING ─── assemble segments + speakers; voiceprint-library match to auto-name known speakers
    ▼
(SUMMARIZING) ─ NOT run automatically — AI minutes are generated on demand (see note below)
    ▼
READY  ──────── transcript + media fully available; best-effort archive to MIAOJI_ARCHIVE_DIR
```

On failure any stage transitions the minute to **`FAILED`**.

```
   ┌─────────────┐
   │   FAILED    │ ◀── any stage throws (errorMessage is recorded on the minute)
   └─────────────┘
```

Two important behaviours:

- **AI summarizing does not block the transcript.** Although `SUMMARIZING` is a defined status and
  `SUMMARIZE` is a defined job stage, the pipeline deliberately does **not** run it inline. The transcript
  becomes visible the moment segmenting finishes; summaries, chapters, and to-dos are generated **on
  demand** when the user clicks "generate" (`ai.regenerateSummary` / `regenerateChapters` /
  `regenerateTodos`). This avoids a long meeting tying up the local Ollama and blocking transcript
  availability.
- **Re-runs are cheap.** Transcode caches its WAV/playable artifacts and skips work if they already exist;
  segmenting deletes and rebuilds segments/speakers, so a minute can be safely reprocessed.

The `jobs` enum stages are: `TRANSCODE`, `ASR`, `DIARIZE`, `SEGMENT`, `SUMMARIZE`, `INDEX`. Statuses:
`PENDING`, `RUNNING`, `DONE`, `FAILED`.

## Data model

Postgres via Drizzle ORM. All timestamps are UTC (`withTimezone`); all media times are stored as
**integer milliseconds**. Main tables (`src/db/schema.ts`):

| Table                      | Purpose                                                | Notable columns                                                                                                                |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `users`                    | Accounts                                               | `name`, `email`, `avatarUrl`                                                                                                   |
| `folders`                  | Folder tree for organizing minutes                     | `ownerId`, `parentId`                                                                                                          |
| `minutes`                  | One recording/upload + its processing state            | `token` (share URL), `status`, `mediaKey`, `playableKey`, `durationMs`, `language`, `numSpeakers`, `linkScope`, `errorMessage` |
| `speakers`                 | Per-minute speaker clusters                            | `displayName`, `voiceprintKey`, `speakingRatio`, `embedding`, `embeddingModel`, `voiceprintId`, `colorHex`                     |
| `voiceprints`              | Cross-meeting voiceprint library (auto-names speakers) | `embedding` (centroid), `samples[]`, `embeddingModel`, `sampleCount`                                                           |
| `segments`                 | Transcript sentence segments                           | `speakerId`, `startMs`, `endMs`, `text`, `words[]` (word-level timestamps), `orderIndex`, `paragraphId`, `isEdited`            |
| `translations`             | Per-segment translation                                | `segmentId`, `targetLang`, `text`                                                                                              |
| `summaries`                | AI minutes (one per minute)                            | `overview`, `keyPoints[]` (with source segment), `risks[]`, `status`                                                           |
| `chapters`                 | AI chapters                                            | `title`, `startMs`, `endMs`, `summary`                                                                                         |
| `todos`                    | AI-extracted action items                              | `text`, `owner`, `sourceSegmentId`, `status`, `externalTaskId`                                                                 |
| `highlights`               | User text highlights                                   | `segmentId`, `charStart`, `charEnd`, `createdBy`                                                                               |
| `comments`                 | Threaded comments on segments/ranges                   | `segmentId`, `charStart/End`, `body`, `parentId`, `resolved`                                                                   |
| `clips`                    | Shareable sub-clips of a minute                        | `startMs`, `endMs`, `shareToken`, `linkScope`                                                                                  |
| `qaThreads` / `qaMessages` | Chat-with-transcript Q&A                               | `role`, `content`, `citations[]` (clickable source lines)                                                                      |
| `collaborators`            | ACL: principal → role on a subject                     | `subjectType` (MINUTE/FOLDER/CLIP), `role` (VIEWER…MANAGER)                                                                    |
| `jobs`                     | Per-stage pipeline records                             | `stage`, `status`, `progress`, `errorMessage`, timing                                                                          |

Voiceprints are how a recurring speaker gets auto-named across meetings: at the segmenting stage, each
speaker cluster's embedding is matched against the owner's voiceprint library, and on a hit the speaker is
named automatically. Embeddings are only compared **within the same model** — vectors from different
embedding models are not comparable.

## API surface

The tRPC router (`src/trpc/routers/index.ts`) is grouped by domain. Auth is a simple `x-user-id` header
parsed into `ctx.userId` (`src/trpc/context.ts`); procedures that mutate user data use `authedProcedure`,
while read/share endpoints are `publicProcedure`.

| Router        | Procedures (abridged)                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `minute`      | `create`, `list`, `getByToken`, `status`, `rename`, `move`, `setLinkScope`, `setNumSpeakers`, `remove`, `stats`                              |
| `transcript`  | `editSegment`, `search`                                                                                                                      |
| `speaker`     | `rename`, `reassignSegment`                                                                                                                  |
| `voiceprint`  | `list`, `enroll`, `enrollRecording`, `assign`, `rename`, `remove`                                                                            |
| `ai`          | `regenerateSummary`, `regenerateChapters`, `regenerateTodos`, `setTodoStatus`                                                                |
| `qa`          | `ask`, `listThreads`, `getThread`                                                                                                            |
| `translation` | `translateMinute`, `get`                                                                                                                     |
| `collab`      | `addHighlight`, `removeHighlight`, `addComment`, `listComments`, `resolveComment`, `createClip`, `listClips`, `removeClip`, `getClipByToken` |
| `folder`      | `create`, `list`, `rename`, `remove`                                                                                                         |
| `export`      | `minute` (`TXT` / `SRT` / `DOCX` / `MD`)                                                                                                     |

> Auth is intentionally minimal. `x-user-id` is a placeholder for a real identity layer (SSO / Better
> Auth) — see [roadmap](./roadmap.md).

## Cross-language contract

`packages/miaoji-contracts` is the **SSOT** for shared types, expressed as Zod schemas. It is consumed by:

- the **TypeScript backend** (API + worker) — types and runtime validation;
- the **TypeScript frontend** — the same types over tRPC;
- the **Python ASR service** — _mirrored_ by hand. The FastAPI pydantic models in
  `apps/miaoji-asr/app/main.py` use the **exact field names** of the contract's `AsrTranscribeRequest` /
  `AsrTranscribeResponse` (e.g. `durationSec`, `speakers`, `segments`, `engine.asrModel`,
  `engine.diarized`, `engine.deviceUsed`, `speakerEmbeddings`, `embeddingModel`). The Python engine works
  internally in `snake_case` and maps to `camelCase` at the HTTP boundary.

Because of this contract, the `engine` block in every ASR response is auditable proof of _whether the
model actually ran_ (which ASR model, whether diarization happened, which device), and the enums
(`MinuteStatus`, `JobStage`, `Lang`, `LinkScope`, …) are identical in the DB, the API, and the UI.
