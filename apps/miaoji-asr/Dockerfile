# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Wendao ASR microservice  (apps/miaoji-asr — Python 3.12 FastAPI)
#
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  GPU NOTICE — THIS IMAGE DEFAULTS TO **CPU** (portable but SLOW).         ║
# ║                                                                          ║
# ║  Real-time transcription wants a CUDA GPU (such as an RTX 4090 / 5090).  ║
# ║  For GPU inference you must do BOTH of:                                  ║
# ║    1. Build with a CUDA-enabled torch wheel — change the TORCH_INDEX_URL ║
# ║       build-arg below to the matching CUDA channel, e.g. for Blackwell   ║
# ║       (RTX 5090, sm_120):                                                ║
# ║         --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
# ║       or cu124 for Ada/Ampere cards.                                     ║
# ║    2. Run the container on the NVIDIA runtime (nvidia-container-toolkit) ║
# ║       — in docker-compose this service lives under the `asr` profile     ║
# ║       with a GPU device reservation. See docker-compose.yml.             ║
# ║                                                                          ║
# ║  For a GPU image you may also prefer an `nvidia/cuda:12.x-runtime` base  ║
# ║  instead of python:3.12-slim; the slim base + cuXXX torch wheel works    ║
# ║  too because the wheels bundle their own CUDA libs.                      ║
# ║                                                                          ║
# ║  Python 3.11/3.12 is REQUIRED: the ML wheels (torch / whisperx /         ║
# ║  pyannote / faster-whisper) do not yet ship for 3.14.                    ║
# ╚══════════════════════════════════════════════════════════════════════════╝
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS runtime
WORKDIR /app

# CPU torch by default. Override at build time for GPU (see notice above).
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu

# ffmpeg → audio decode/transcode (the engine decodes via ffmpeg).
# git → some ML deps (whisperx / pyannote) pull VCS refs during install.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg git && \
    rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

COPY requirements.txt ./

# Install torch first from the chosen channel so the heavy CUDA/CPU wheel is
# resolved deterministically, then the rest of the requirements.
RUN pip install --index-url "${TORCH_INDEX_URL}" torch && \
    pip install -r requirements.txt

# Application code.
COPY app/ ./app/

# Model cache / weights live on a mounted volume (see compose) — not baked in.
RUN mkdir -p /app/.cache/huggingface /app/models

EXPOSE 9400

# host 0.0.0.0 so the API container can reach it over the compose network.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9400"]
