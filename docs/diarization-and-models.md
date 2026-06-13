# Diarization & models

Wendao runs all speech models locally. This page explains the ASR model choice, the speaker-diarization
backends and — importantly — their **licenses**, plus the levers that improve speaker accuracy.

## ASR models (Whisper)

| Setting         | Default    | Notes                                                                                 |
| --------------- | ---------- | ------------------------------------------------------------------------------------- |
| `WHISPER_MODEL` | `large-v3` | Whisper model name. Smaller models (`medium`, `small`) trade accuracy for speed/VRAM. |

- The primary engine is **WhisperX** (Whisper ASR + wav2vec2 word-level alignment + diarization in one
  pass). If WhisperX can't be imported, the service falls back to **faster-whisper** (ASR + word-level
  timestamps), and punctuation + diarization are added afterward by a subprocess.
- **Models download on first use.** The first transcription pulls the Whisper weights (`large-v3` is
  several GB), the wav2vec2 alignment model for the detected language, and — if used — the diarization
  models. This needs network access and disk space; subsequent runs are offline.
- Device/precision: CUDA → `float16`, CPU → `int8` (override with `ASR_COMPUTE_TYPE`). Long audio is
  processed in `ASR_CHUNK_SEC` (default 900 s) chunks, cut at the quietest point near each boundary so
  words aren't split.

## Diarization backends

The backend is selected by `MIAOJI_DIAR_BACKEND`:

| Value            | Behaviour                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `auto` (default) | DiariZen meeting-base preferred; falls back to sherpa-onnx if the DiariZen venv/models are missing. |
| `diarizen`       | Force DiariZen.                                                                                     |
| `sherpa`         | Force the sherpa-onnx pipeline (pyannote-seg3 + CAM++ + FastClustering).                            |

**Graceful degradation:** if diarization is unavailable for any reason, transcription still succeeds —
every segment gets `speaker=null` and the response reports `engine.diarized=false`. It never crashes.

### Licenses — read before deploying commercially

| Backend / weights                                            | License                | Commercial use           | Notes                                                                                                      |
| ------------------------------------------------------------ | ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **sherpa-onnx** (pyannote-seg3 + CAM++ + FastClustering)     | **Apache-2.0**         | ✅ Yes                   | Always-available baseline. Over-splits on multi-party meetings (2–4 people → 8–9 clusters).                |
| **DiariZen `meeting-base`**                                  | **MIT**                | ✅ Yes                   | **The default high-accuracy path.** WavLM-base EEND + wespeaker clustering.                                |
| **DiariZen `wavlm-{base,large}-s80-md(-v2)` / "NC" weights** | **CC-BY-NC-4.0**       | ❌ **NON-COMMERCIAL**    | **MUST NOT be used in commercial deployments.** Evaluation/reference only.                                 |
| **pyannote `community-1` / `speaker-diarization-3.1`**       | MIT code, **HF-gated** | ✅ (with terms accepted) | Requires a Hugging Face account, accepting the model terms, and an `HF_TOKEN` with gated-repo read access. |

> ⚠️ **License warning.** The DiariZen `*-s80-md` and other "NC" weights are **CC-BY-NC-4.0 =
> non-commercial**. They produce the best benchmark numbers but **may not be used in any commercial
> deployment**. The shipped default (`meeting-base`, MIT) is safe for commercial use. The `auto`/`diarizen`
> backends use the MIT `meeting-base` path; do not point them at NC weights in production.

### pyannote prerequisites

To use the pyannote path (`sherpa` backend's segmentation is sherpa's own model; pyannote proper is used by
WhisperX's built-in diarization) you must:

1. Set `HF_TOKEN`.
2. On Hugging Face, **accept the terms** for `pyannote/speaker-diarization-3.1` and its dependency
   `pyannote/segmentation-3.0`.

Missing token / unaccepted terms → graceful degradation (no diarization), not an error.

## Benchmark numbers

Measured on the **AliMeeting Eval** set (8 real Chinese meetings, 2–4 speakers, far-field; channel 0
downmixed to 16 kHz mono to match real recorder/phone input). DER% reported as **strict / collar-0.25**:

| Session     | sherpa (current)  | DiariZen meeting-base |
| ----------- | ----------------- | --------------------- |
| R8001_M8004 | 33.80 / 26.27     | 17.79 / 11.66         |
| R8003_M8001 | 19.63 / 10.09     | 14.41 / 7.60          |
| R8007_M8010 | 39.84 / 32.77     | 29.82 / 22.88         |
| R8007_M8011 | 22.75 / 11.26     | 14.46 / 6.37          |
| R8008_M8013 | 23.43 / 12.40     | 14.16 / 5.99          |
| R8009_M8018 | 12.12 / 3.76      | 8.63 / 2.01           |
| R8009_M8019 | 12.73 / 4.88      | 4.56 / 0.79           |
| R8009_M8020 | 10.70 / 2.67      | 4.60 / 0.45           |
| **TOTAL**   | **23.55 / 13.43** | **14.98 / 7.57**      |

DiariZen meeting-base is **~36% / 44% relative lower DER** than the sherpa baseline, and got the speaker
count right in all 8 sessions (sherpa over-split 2–4-person meetings into 3–9 speakers). Speed on a 30-min
meeting: sherpa 120–190 s (CPU) vs DiariZen 22–30 s (RTX 5090).

For reference only, the non-commercial `wavlm-large-s80-md-v2` weights reach **11.44 / 4.70** — about 3.5
points better — but **cannot be used commercially**.

**Conclusion:** `meeting-base` (MIT) is the best _commercially licensable_ option available; the more
accurate alternatives are either non-commercial or paid API.

## Tuning speaker accuracy

Long meetings where one person is split into two clusters, or where noise becomes a phantom speaker, are
**over-clustering** — fix them with these levers (not by switching models):

1. **Provide the speaker count.** The biggest lever — relative DER drop of **37–43%**. The UI's "number of
   speakers" field flows through: upload → `minute.numSpeakers` → pipeline → ASR `numSpeakers` → DiariZen
   `min_speakers = max_speakers = N`. **Always set this for multi-party meetings.**
2. `min_cluster_size` (DiariZen `meeting-base` default 30) suppresses noise clusters; `max_speakers`
   (default 8) caps the count.
3. AHC `ahc_threshold` (default 0.7) — raise it to merge more aggressively, curing same-person splits.

Real example: a 2-hour meeting that old sherpa split into 8 speakers (one real speaker split + 5 noise
clusters) was cleanly resolved by DiariZen `meeting-base` into 4 clusters in 116 s on GPU.

## Voiceprint (speaker) embeddings

Cross-meeting speaker recognition uses an embedding model (default **ERes2NetV2 zh-cn**, 3D-Speaker,
Apache-2.0, 192-dim; AliMeeting EER 4.00% vs CAM++ 5.28%). Selected via `MIAOJI_VOICEPRINT_MODEL`, falling
back `eres2netv2_zh → campplus_zh → spk_embed`.

> **Embeddings are model-specific.** Vectors from different embedding models are **not comparable** (even
> at the same dimensionality). Every stored voiceprint and meeting speaker carries an `embeddingModel`
> tag, and matching only compares within the same model. Changing the model invalidates existing
> voiceprints — they must be re-enrolled.

Voiceprint model files live in `apps/miaoji-asr/models/` and are **not** committed to git; they download on
first use (or via the curl commands in the ASR service README) and must be re-downloaded on a new machine.

## Future upgrade paths

Both require either funding or clearing a gate, and are not enabled by default:

1. Clear the pyannote `community-1` HF gate (HF account + accept terms + gated-read token).
2. Fine-tune DiariZen's MIT-licensed _code_ on your own annotated meeting audio to produce your own
   weights — getting SOTA accuracy **and** a clean license. This is the highest-value path.
