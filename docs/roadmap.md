# Roadmap

An honest snapshot of what exists today versus what we'd welcome contributions for. Items marked
**Current** ship in the repo now; items marked **Wanted** are not built yet.

## Current state

- **Core pipeline works end to end.** Upload → transcode → transcribe (word-level) → diarize → segment →
  READY, with on-demand AI minutes, chapters, to-dos, auto-title, translation, and transcript Q&A (all
  with clickable source-line citations). See [architecture.md](./architecture.md).
- **Self-hosted by design.** Local Postgres, local Whisper ASR, local Ollama LLM. No third-party cloud in
  the default path.
- **Speaker diarization** with a commercially-licensed default (DiariZen `meeting-base`, MIT) and a
  voiceprint library that auto-names recurring speakers across meetings. See
  [diarization-and-models.md](./diarization-and-models.md).
- **Graceful degradation** — diarization or LLM unavailability never blocks the transcript.
- **Exports**: `TXT`, `SRT`, `DOCX`, `MD`.
- **UI is zh-CN** (Simplified Chinese). Code comments are bilingual (zh/en).

### Known limitations (current)

- **Auth is a placeholder.** Identity is a plain `x-user-id` request header (`ctx.userId`). There is no
  login, session, or password handling yet.
- **Storage is filesystem-only.** `MIAOJI_STORAGE_DIR` is a local path (can be an S3/OSS-_mounted_ path,
  but there's no native object-store client).
- **The worker is a single-process serial poller** with an in-memory single-flight lock; cross-process
  coordination isn't implemented (the code notes pg-boss as the intended upgrade).
- **LLM is Ollama-only** in practice (OpenAI-compatible endpoint, but defaults and assumptions target a
  local Ollama).
- **Docker images are not yet verified/published** — the compose path is being added by a contributor.

## Wanted / planned contributions

| Area                       | What                                                                                                                                                      | Status                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **i18n**                   | English UI + a proper i18n layer (UI strings are currently zh-CN)                                                                                         | Wanted                    |
| **Auth / SSO**             | Replace the `x-user-id` header with real auth (Better Auth / OIDC / SSO), sessions, and per-user access control wired to the existing `collaborators` ACL | Wanted                    |
| **Object storage**         | Native S3/OSS storage adapter behind the storage interface, instead of relying on a mounted path                                                          | Wanted                    |
| **Cloud-LLM adapter**      | A pluggable LLM provider so users can choose a hosted OpenAI-compatible model as an alternative to local Ollama                                           | Wanted                    |
| **More export formats**    | Beyond `TXT/SRT/DOCX/MD` — e.g. VTT, JSON, PDF                                                                                                            | Wanted                    |
| **Verified Docker images** | Published, version-tagged images for `web`, `api`/`worker`, and `asr`, plus a hardened compose file                                                       | In progress (contributor) |
| **Queue-backed worker**    | Swap the in-memory poller for pg-boss (or similar) to enable multi-worker scaling with cross-process locking                                              | Wanted                    |
| **Diarization upgrades**   | Clear the pyannote `community-1` HF gate, and/or fine-tune DiariZen's MIT code to produce own weights (SOTA accuracy + clean license)                     | Wanted                    |

## How to contribute

The cross-language contract in `packages/miaoji-contracts` (Zod) is the SSOT — new shared types start
there and are mirrored by the Python ASR service's pydantic models. Keep field names byte-for-byte aligned
across TS and Python. See [architecture.md](./architecture.md#cross-language-contract).
