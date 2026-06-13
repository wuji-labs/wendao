"""FastAPI 应用 — 妙记 ASR 微服务入口。

由 Node 后端经 HTTP 调用。响应字段名为跨语言 SSOT，必须与 TS 端契约逐字一致。

设计纪律：本模块顶层不 import 任何 ML 库；engine 内部懒加载，保证
`python -c "import app.main"` 在无 torch 环境下也能成功（CI 冒烟）。
"""

from __future__ import annotations

import json
import os
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import settings
from .engine import TranscribeResult, engine, get_progress

app = FastAPI(title="miaoji-asr", version="1.0.0")


# ----------------------------- 契约模型（pydantic v2）-----------------------------


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    asrLoaded: bool
    diarizeAvailable: bool
    device: Literal["cuda", "cpu"]


class TranscribeRequest(BaseModel):
    audioPath: str = Field(..., description="服务器本地绝对路径 · 16kHz 单声道 wav")
    language: Literal["zh", "en", "ja"]
    diarize: bool = False
    numSpeakers: int | None = None
    jobId: str | None = Field(default=None, description="进度跟踪 id · GET /progress/{jobId} 查询")


class EmbedRequest(BaseModel):
    audioPath: str = Field(..., description="服务器本地绝对路径 · 16kHz 单声道 wav · 声纹录入用单段录音")


class EmbedResponse(BaseModel):
    embedding: list[float]
    model: str = ""
    speechSec: float
    totalSec: float
    snrDb: float


class WordModel(BaseModel):
    w: str
    start: float
    end: float
    # score 可选：对齐模型给得出才有。
    score: float | None = None


class SegmentModel(BaseModel):
    start: float
    end: float
    text: str
    speaker: str | None = None
    words: list[WordModel] = Field(default_factory=list)


class EngineModel(BaseModel):
    asrModel: str
    diarized: bool
    deviceUsed: str


class TranscribeResponse(BaseModel):
    language: str
    durationSec: float
    speakers: list[str]
    segments: list[SegmentModel]
    engine: EngineModel
    speakerEmbeddings: dict[str, list[float]] = Field(default_factory=dict)
    embeddingModel: str = ""  # 声纹向量来自哪个模型(跨模型不可比)


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None


# ----------------------------- 映射器 -----------------------------


def _to_response(result: TranscribeResult) -> TranscribeResponse:
    """把引擎产物（snake_case dataclass）映射为契约响应（camelCase）。"""
    return TranscribeResponse(
        language=result.language,
        durationSec=result.duration_sec,
        speakers=result.speakers,
        segments=[
            SegmentModel(
                start=s.start,
                end=s.end,
                text=s.text,
                speaker=s.speaker,
                words=[
                    WordModel(w=w.w, start=w.start, end=w.end, score=w.score)
                    for w in s.words
                ],
            )
            for s in result.segments
        ],
        engine=EngineModel(
            asrModel=result.asr_model,
            diarized=result.diarized,
            deviceUsed=result.device_used,
        ),
        speakerEmbeddings=result.speaker_embeddings or {},
        embeddingModel=result.embedding_model or "",
    )


# ----------------------------- 端点 -----------------------------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """健康检查 — 绝不触发模型加载。device 探测为轻量操作。"""
    dev = engine.device
    device: Literal["cuda", "cpu"] = "cuda" if dev == "cuda" else "cpu"
    return HealthResponse(
        asrLoaded=engine.asr_loaded,
        diarizeAvailable=engine.diarize_available(),
        device=device,
    )


@app.get("/progress/{job_id}")
def progress(job_id: str) -> JSONResponse:
    """查询某次转写的真实进度(0..1)。transcribe 在线程池跑,此端点可并发响应。"""
    return JSONResponse(status_code=200, content={"jobId": job_id, "progress": get_progress(job_id)})


@app.post(
    "/transcribe",
    response_model=TranscribeResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def transcribe(req: TranscribeRequest) -> JSONResponse:
    """转写一条音频。audioPath 必须存在且为绝对路径。"""
    path = req.audioPath

    if not path or not path.strip():
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(error="invalid_audio_path", detail="audioPath is empty").model_dump(),
        )

    if not os.path.isabs(path):
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                error="invalid_audio_path",
                detail=f"audioPath must be an absolute path, got: {path}",
            ).model_dump(),
        )

    if not os.path.exists(path):
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="audio_not_found",
                detail=f"audioPath does not exist: {path}",
            ).model_dump(),
        )

    if not os.path.isfile(path):
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                error="invalid_audio_path",
                detail=f"audioPath is not a file: {path}",
            ).model_dump(),
        )

    if req.numSpeakers is not None and req.numSpeakers < 1:
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                error="invalid_num_speakers",
                detail="numSpeakers must be >= 1 when provided",
            ).model_dump(),
        )

    try:
        result = engine.transcribe(
            audio_path=path,
            language=req.language,
            diarize=req.diarize,
            num_speakers=req.numSpeakers,
            job_id=req.jobId,
        )
    except ImportError as exc:
        # ML 依赖缺失 → 明确 500，提示需在 3.11/3.12 venv 安装。
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error="engine_unavailable",
                detail=(
                    "ASR engine dependencies not installed. Install requirements.txt "
                    f"into a 3.11/3.12 venv. Underlying: {exc}"
                ),
            ).model_dump(),
        )
    except Exception as exc:  # noqa: BLE001 — 顶层兜底，避免泄漏堆栈给调用方。
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(error="transcription_failed", detail=str(exc)).model_dump(),
        )

    return JSONResponse(status_code=200, content=_to_response(result).model_dump())


@app.post(
    "/embed",
    response_model=EmbedResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def embed(req: EmbedRequest) -> JSONResponse:
    """单段录音 → CAM++ 声纹向量 + 质量度量(speechSec 供调用方做质量门控)。
    声纹提取走子进程(sherpa ORT 与本进程 faster-whisper 的 onnxruntime 隔离,同 diar_punct)。"""
    import subprocess
    import sys as _sys

    path = req.audioPath
    if not path or not os.path.isabs(path):
        return JSONResponse(status_code=400, content=ErrorResponse(error="invalid_audio_path", detail="audioPath must be absolute").model_dump())
    if not os.path.isfile(path):
        return JSONResponse(status_code=404, content=ErrorResponse(error="audio_not_found", detail=f"not a file: {path}").model_dump())
    try:
        proc = subprocess.run(
            [_sys.executable, "-m", "app.embed_clip", path],
            cwd=os.path.dirname(os.path.dirname(__file__)),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if proc.returncode != 0 or not proc.stdout:
            return JSONResponse(status_code=500, content=ErrorResponse(error="embed_failed", detail=(proc.stderr or "")[-300:]).model_dump())
        out = json.loads(proc.stdout)
        if not out.get("ok"):
            return JSONResponse(status_code=500, content=ErrorResponse(error="embed_failed", detail=str(out.get("error"))).model_dump())
        return JSONResponse(
            status_code=200,
            content=EmbedResponse(
                embedding=out["embedding"],
                model=out.get("model", ""),
                speechSec=out["speechSec"],
                totalSec=out["totalSec"],
                snrDb=out["snrDb"],
            ).model_dump(),
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=500, content=ErrorResponse(error="embed_failed", detail=str(exc)).model_dump())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
