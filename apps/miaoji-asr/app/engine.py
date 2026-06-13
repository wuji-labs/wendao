"""转写引擎 — 懒加载单例。

设计要点：
- 所有重型依赖（torch / whisperx / faster_whisper / pyannote）一律在懒加载器
  内部 import，绝不在模块顶层 import。这样即使 ML 库缺失，本模块也能被
  `import` 成功，/health 据此报告 asrLoaded=false 而非启动崩溃。
- 主引擎 WhisperX（Whisper ASR + wav2vec2 词级对齐 + pyannote 说话人分离一条龙）；
  不可用时回落 faster-whisper（ASR + 词级时间戳，无对齐/分离）。
- 设备：torch.cuda 可用则 cuda，否则 cpu；compute_type cuda→float16 / cpu→int8。
- 说话人分离需 HF_TOKEN + 已接受 pyannote 模型条款；缺则优雅降级
  （segment/word 的 speaker=None，engine.diarized=false），永不抛错。
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any

from .config import settings


# ---- 转写进度注册表(job_id → 0..1)· 供 /progress 查询,实现真实进度条 ----
_PROGRESS: dict[str, float] = {}


def set_progress(job_id: str | None, value: float) -> None:
    if job_id:
        _PROGRESS[job_id] = max(0.0, min(0.999, value))


def get_progress(job_id: str) -> float:
    return _PROGRESS.get(job_id, 0.0)


def clear_progress(job_id: str | None) -> None:
    if job_id:
        _PROGRESS.pop(job_id, None)


def _quietest_cut(audio, sr: int, target: float, search: float) -> float:
    """在 target±search 秒窗口内找能量最低的 200ms 处作为切点(块边界落在静音处,不切断词)。"""
    import numpy as np  # type: ignore

    a = max(0, int((target - search) * sr))
    b = min(len(audio), int((target + search) * sr))
    if b - a < sr:  # 窗口太小,放弃寻找
        return target
    win = max(1, int(0.2 * sr))
    seg = audio[a:b]
    n = (len(seg) // win) * win
    if n == 0:
        return target
    rms = np.sqrt((seg[:n].reshape(-1, win) ** 2).mean(axis=1))
    return (a + int(rms.argmin()) * win + win // 2) / sr


# ---- 标点恢复 + 说话人分离(sherpa-onnx · 纯 ONNX · 不需 torch / HF token)----
import os.path as _osp

_MODELS_DIR = _osp.join(_osp.dirname(_osp.dirname(__file__)), "models")
_PUNCT_MODEL = _osp.join(_MODELS_DIR, "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12", "model.onnx")
_SEG_MODEL = _osp.join(_MODELS_DIR, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx")
_EMBED_MODEL = _osp.join(_MODELS_DIR, "campplus_zh.onnx")  # CAM++ 中文优先,缺则回退 wespeaker
if not _osp.isfile(_EMBED_MODEL):
    _EMBED_MODEL = _osp.join(_MODELS_DIR, "spk_embed.onnx")

_punct_obj: Any = None
_punct_tried = False


def _get_punct() -> Any:
    """懒加载中文标点模型(ct-transformer)。缺模型/失败 → None(降级,不抛)。"""
    global _punct_obj, _punct_tried
    if _punct_tried:
        return _punct_obj
    _punct_tried = True
    try:
        import os

        import sherpa_onnx  # type: ignore

        if not os.path.isfile(_PUNCT_MODEL):
            return None
        cfg = sherpa_onnx.OfflinePunctuationConfig(
            model=sherpa_onnx.OfflinePunctuationModelConfig(ct_transformer=_PUNCT_MODEL)
        )
        _punct_obj = sherpa_onnx.OfflinePunctuation(cfg)
    except Exception:
        _punct_obj = None
    return _punct_obj


def add_punct(text: str) -> str:
    p = _get_punct()
    if not p or not text.strip():
        return text
    try:
        return str(p.add_punctuation(text))
    except Exception:
        return text


def diarize_turns(audio_path: str, num_speakers: int | None) -> list[tuple[float, float, int]] | None:
    """sherpa-onnx 说话人分离 → [(start, end, speaker_int)]。缺模型/失败 → None(降级)。"""
    try:
        import os
        import wave

        import numpy as np  # type: ignore
        import sherpa_onnx  # type: ignore

        if not (os.path.isfile(_SEG_MODEL) and os.path.isfile(_EMBED_MODEL)):
            return None
        cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=_SEG_MODEL)
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=_EMBED_MODEL),
            clustering=sherpa_onnx.FastClusteringConfig(
                num_clusters=int(num_speakers) if num_speakers and num_speakers > 0 else -1,
                threshold=float(os.environ.get("DIAR_THRESHOLD", "0.5")),
            ),
            min_duration_on=0.3,
            min_duration_off=0.5,
        )
        sd = sherpa_onnx.OfflineSpeakerDiarization(cfg)
        with wave.open(audio_path, "rb") as w:
            n = w.getnframes()
            raw = w.readframes(n)
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        result = sd.process(samples).sort_by_start_time()
        return [(float(s.start), float(s.end), int(s.speaker)) for s in result]
    except Exception:
        return None


def enrich_segments(audio_path: str, segments: list, num_speakers: int | None, diarize: bool) -> tuple[bool, dict]:
    """隔离子进程里跑 标点 + 说话人分离 + 声纹提取(sherpa-onnx 自带 ORT,与主进程 faster-whisper 不冲突)。
    就地改写 segments 的 text/speaker;返回 (是否成功分离, {SPEAKER_xx: 声纹向量})。全程失败即降级(原样)。"""
    import json
    import os
    import subprocess
    import sys
    import tempfile

    if not segments:
        return (False, {})
    # 带词级时间戳 → 子进程可做词级说话人归属(在说话人边界切段,短插话不被整段吞掉)
    payload = [
        {
            "start": s.start,
            "end": s.end,
            "text": s.text,
            "words": [{"w": w.w, "start": w.start, "end": w.end, "score": w.score} for w in s.words],
        }
        for s in segments
    ]
    fd, jf = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        with open(jf, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        proc = subprocess.run(
            [sys.executable, "-m", "app.diar_punct", audio_path, jf, str(num_speakers or 0), "1" if diarize else "0"],
            cwd=os.path.dirname(os.path.dirname(__file__)),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=int(os.environ.get("DIAR_TIMEOUT", "1800")),
        )
        if proc.returncode != 0 or not proc.stdout:
            return (False, {})
        out = json.loads(proc.stdout)
        if not out.get("ok"):
            return (False, {})
        # 词级切段后段数可能变多 → 整体重建(不再 zip 就地改)
        rebuilt: list = []
        for e in out.get("segments", []):
            words = [
                WordOut(w=x["w"], start=float(x["start"]), end=float(x["end"]), score=x.get("score"))
                for x in (e.get("words") or [])
            ]
            rebuilt.append(
                SegmentOut(
                    start=float(e["start"]),
                    end=float(e["end"]),
                    text=str(e.get("text") or "").strip(),
                    speaker=e.get("speaker"),
                    words=words,
                )
            )
        if rebuilt:
            segments[:] = rebuilt
        return (bool(out.get("diarized")), out.get("speakerEmbeddings") or {}, str(out.get("embeddingModel") or ""))
    except Exception:
        return (False, {}, "")
    finally:
        try:
            os.remove(jf)
        except Exception:
            pass


# ----------------------------- 数据结构 -----------------------------


@dataclass
class WordOut:
    """词级结果。score 可选（对齐模型给得出才有）。"""

    w: str
    start: float
    end: float
    score: float | None = None


@dataclass
class SegmentOut:
    """句级结果。speaker 为分离标签或 None。"""

    start: float
    end: float
    text: str
    speaker: str | None = None
    words: list[WordOut] = field(default_factory=list)


@dataclass
class TranscribeResult:
    """一次转写的完整产物，与 TS 端响应契约对齐（驼峰由 main 层 pydantic 完成）。"""

    language: str
    duration_sec: float
    speakers: list[str]
    segments: list[SegmentOut]
    asr_model: str
    diarized: bool
    device_used: str
    speaker_embeddings: dict = field(default_factory=dict)  # {SPEAKER_xx: [float]} 声纹向量
    embedding_model: str = ""  # 声纹向量来自哪个模型(跨模型不可比·匹配只比同模型)


# ----------------------------- 设备/计算类型探测 -----------------------------


def _resolve_device(torch_mod: Any) -> str:
    """按 ASR_DEVICE 设置 + torch.cuda 可用性决定最终设备。"""
    want = settings.asr_device
    if want == "cpu":
        return "cpu"
    if want == "cuda":
        # 显式要 cuda 但不可用时，安全回落 cpu（不崩）。
        return "cuda" if torch_mod.cuda.is_available() else "cpu"
    # auto
    return "cuda" if torch_mod.cuda.is_available() else "cpu"


_cuda_dll_added = False


def _ensure_cuda_dll_path() -> None:
    """Windows: 把 venv 内 nvidia cudnn/cublas 的 DLL 目录注册到加载路径,
    否则 ctranslate2 GPU 推理找不到 cudnn_*.dll / cublas64_*.dll。幂等。"""
    global _cuda_dll_added
    if _cuda_dll_added:
        return
    _cuda_dll_added = True
    import os
    import sys

    base = os.path.join(sys.prefix, "Lib", "site-packages", "nvidia")
    for sub in ("cudnn", "cublas", "cuda_runtime"):
        d = os.path.join(base, sub, "bin")
        if os.path.isdir(d):
            try:
                os.add_dll_directory(d)
            except Exception:
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def _resolve_compute_type(device: str) -> str:
    """compute_type：显式 env 优先，否则 cuda→float16 / cpu→int8。"""
    if settings.asr_compute_type:
        return settings.asr_compute_type
    return "float16" if device == "cuda" else "int8"


# ----------------------------- 引擎单例 -----------------------------


class _Engine:
    """懒加载转写引擎。线程安全（FastAPI 默认线程池里跑同步代码）。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._backend: str | None = None  # "whisperx" | "faster-whisper"
        self._device: str | None = None
        self._compute_type: str | None = None

        # 各后端句柄（懒加载后填充）
        self._whisperx: Any = None
        self._wx_model: Any = None
        self._fw_model: Any = None

        # 对齐模型缓存：language -> (align_model, metadata)
        self._align_cache: dict[str, tuple[Any, Any]] = {}

        # 分离管线（pyannote），可能为 None（不可用/无 token）
        self._diarize_pipeline: Any = None
        self._diarize_attempted = False

        # 空闲卸载:ctranslate2/large-v3 加载后在 Blackwell 上即便不转写也占满 GPU,
        # 会饿死本机 LLM(qwen3 15→341 tok/s)。空闲超阈值即卸载模型释放 GPU,下次转写再懒加载。
        import time as _t

        self._last_used = _t.time()
        self._evictor_started = False
        self._busy = False  # 转写进行中 → 禁止空闲驱逐(否则长音频转写中途模型被卸载)

    # ---- 探针：供 /health 使用，绝不触发重型加载 ----

    @property
    def asr_loaded(self) -> bool:
        return self._loaded

    @property
    def device(self) -> str:
        """返回当前/将要使用的设备，供 /health 报告。未加载时探测一次（轻量）。"""
        return self._device or self._detect_device()

    def diarize_available(self) -> bool:
        """是否具备说话人分离能力（pyannote 可导入 + 有 HF_TOKEN）。

        只做轻量判断，不真正加载管线，避免 /health 触发下载。
        """
        # 改用 sherpa-onnx 分离(无需 HF token):seg + embedding 模型在位 + 可导入即可
        try:
            import importlib.util
            import os

            if not (os.path.isfile(_SEG_MODEL) and os.path.isfile(_EMBED_MODEL)):
                return False
            return importlib.util.find_spec("sherpa_onnx") is not None
        except Exception:
            return False

    # ---- 设备探测(torch 可选) ----

    def _detect_device(self) -> str:
        want = settings.asr_device
        if want in ("cpu", "cuda"):
            return want
        # auto:优先 torch.cuda,否则 ctranslate2 CUDA 设备数,否则 cpu
        try:
            import torch  # type: ignore

            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            pass
        try:
            import ctranslate2  # type: ignore

            return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            return "cpu"

    # ---- 懒加载 ASR 后端 ----

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return

            # GPU DLL 路径(cudnn/cublas)必须在 ctranslate2 GPU 加载前注册
            _ensure_cuda_dll_path()
            # 设备探测:有 torch 用 torch.cuda;否则用 ctranslate2(faster-whisper 后端)自身探测。
            # 不再无条件 import torch —— 仅装 faster-whisper(无 torch)时也能跑。
            device = self._detect_device()
            compute_type = _resolve_compute_type(device)
            self._device = device
            self._compute_type = compute_type

            # 优先 WhisperX
            try:
                import whisperx  # type: ignore

                self._whisperx = whisperx
                self._wx_model = whisperx.load_model(
                    settings.whisper_model,
                    device=device,
                    compute_type=compute_type,
                )
                self._backend = "whisperx"
                self._loaded = True
                return
            except Exception:
                # WhisperX 不可用 → 回落 faster-whisper
                self._whisperx = None
                self._wx_model = None

            from faster_whisper import WhisperModel  # type: ignore

            self._fw_model = WhisperModel(
                settings.whisper_model,
                device=device,
                compute_type=compute_type,
            )
            self._backend = "faster-whisper"
            self._loaded = True

    # ---- 懒加载分离管线 ----

    def _ensure_diarize_pipeline(self) -> Any:
        """尝试加载 pyannote 分离管线；失败返回 None（不抛）。"""
        if self._diarize_pipeline is not None:
            return self._diarize_pipeline
        if self._diarize_attempted:
            return self._diarize_pipeline
        self._diarize_attempted = True

        if settings.hf_token is None:
            return None

        try:
            import torch  # type: ignore

            device = self._device or _resolve_device(torch)

            # WhisperX 自带 DiarizationPipeline 封装；优先用它。
            if self._whisperx is not None:
                try:
                    pipe = self._whisperx.DiarizationPipeline(
                        use_auth_token=settings.hf_token,
                        device=device,
                    )
                    self._diarize_pipeline = pipe
                    return pipe
                except Exception:
                    pass

            # 直接走 pyannote 原生管线作为兜底。
            from pyannote.audio import Pipeline  # type: ignore

            pipe = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=settings.hf_token,
            )
            try:
                pipe.to(torch.device(device))
            except Exception:
                pass
            self._diarize_pipeline = pipe
            return pipe
        except Exception:
            # 任意失败（无网络/未接受条款/版本不匹配）→ 优雅降级。
            self._diarize_pipeline = None
            return None

    # ---- 主转写入口 ----

    def transcribe(
        self,
        audio_path: str,
        language: str,
        diarize: bool,
        num_speakers: int | None,
        job_id: str | None = None,
    ) -> TranscribeResult:
        """执行一次转写。调用方已校验 audio_path 存在。"""
        import time as _t

        # busy 必须先于加载置位:否则驱逐器可在「加载完成→busy 置位」窗口里抽走模型(竞态实战踩过)
        self._busy = True
        self._last_used = _t.time()
        self._ensure_loaded()
        assert self._device is not None
        self._start_evictor()

        try:
            if self._backend == "whisperx":
                return self._transcribe_whisperx(audio_path, language, diarize, num_speakers)
            return self._transcribe_faster_whisper(audio_path, language, diarize, num_speakers, job_id)
        finally:
            self._busy = False
            self._last_used = _t.time()
            clear_progress(job_id)

    # ---- 空闲卸载:释放 GPU 给本机 LLM ----

    def _unload(self) -> None:
        """卸载 ASR 模型,释放 GPU 显存/计算(下次转写自动懒加载重建)。"""
        import gc
        import sys

        with self._lock:
            # 锁内复核 busy:驱逐器锁外判定到进锁之间转写可能已开始
            if not self._loaded or self._busy:
                return
            sys.stderr.write("[engine] idle-unload: releasing ASR model/GPU\n")
            self._fw_model = None
            self._wx_model = None
            self._whisperx = None
            self._align_cache.clear()
            self._diarize_pipeline = None
            self._diarize_attempted = False
            self._loaded = False
        gc.collect()
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _start_evictor(self) -> None:
        if self._evictor_started:
            return
        self._evictor_started = True
        import os
        import threading
        import time as _t

        idle_sec = int(os.environ.get("ASR_IDLE_UNLOAD_SEC", "90"))
        if idle_sec <= 0:
            return

        def _loop() -> None:
            while True:
                _t.sleep(15)
                if self._loaded and not self._busy and (_t.time() - self._last_used) > idle_sec:
                    self._unload()

        threading.Thread(target=_loop, daemon=True, name="asr-idle-evictor").start()

    # ---- WhisperX 路径：ASR + 对齐 + 分离 ----

    def _transcribe_whisperx(
        self,
        audio_path: str,
        language: str,
        diarize: bool,
        num_speakers: int | None,
    ) -> TranscribeResult:
        wx = self._whisperx
        device = self._device or "cpu"

        audio = wx.load_audio(audio_path)
        duration_sec = float(len(audio)) / 16000.0  # 约定输入为 16kHz 单声道

        # 1) ASR
        asr_result = self._wx_model.transcribe(
            audio, batch_size=16, language=language
        )
        detected_lang = str(asr_result.get("language", language))

        # 2) 词级对齐（wav2vec2）
        try:
            align_model, metadata = self._get_align_model(detected_lang, device, wx)
            aligned = wx.align(
                asr_result["segments"],
                align_model,
                metadata,
                audio,
                device,
                return_char_alignments=False,
            )
            segments_raw = aligned.get("segments", asr_result["segments"])
        except Exception:
            # 对齐失败（语言无对齐模型等）→ 退回 ASR 段，词级可能缺失。
            segments_raw = asr_result["segments"]

        # 3) 说话人分离（可选 + 优雅降级）
        diarized = False
        if diarize:
            pipe = self._ensure_diarize_pipeline()
            if pipe is not None:
                try:
                    if num_speakers is not None:
                        diar_df = pipe(audio, num_speakers=num_speakers)
                    else:
                        diar_df = pipe(audio)
                    assigned = wx.assign_word_speakers(diar_df, {"segments": segments_raw})
                    segments_raw = assigned.get("segments", segments_raw)
                    diarized = True
                except Exception:
                    diarized = False

        segments = self._build_segments_from_whisperx(segments_raw)
        speakers = _collect_speakers(segments)

        return TranscribeResult(
            language=detected_lang,
            duration_sec=duration_sec,
            speakers=speakers,
            segments=segments,
            asr_model=settings.whisper_model,
            diarized=diarized,
            device_used=device,
        )

    def _get_align_model(self, language: str, device: str, wx: Any) -> tuple[Any, Any]:
        """按语言缓存 wav2vec2 对齐模型。"""
        if language in self._align_cache:
            return self._align_cache[language]
        align_model, metadata = wx.load_align_model(language_code=language, device=device)
        self._align_cache[language] = (align_model, metadata)
        return align_model, metadata

    @staticmethod
    def _build_segments_from_whisperx(segments_raw: list[dict[str, Any]]) -> list[SegmentOut]:
        """把 WhisperX 段（含 words / speaker）规整为 SegmentOut。"""
        out: list[SegmentOut] = []
        for seg in segments_raw:
            words: list[WordOut] = []
            for w in seg.get("words", []) or []:
                # WhisperX 词字段：word / start / end / score / speaker
                text = str(w.get("word", "")).strip()
                if not text:
                    continue
                w_start = w.get("start")
                w_end = w.get("end")
                # 个别词可能缺时间戳（对齐落空）；落回段边界。
                start = float(w_start) if w_start is not None else float(seg.get("start", 0.0))
                end = float(w_end) if w_end is not None else float(seg.get("end", start))
                score = w.get("score")
                words.append(
                    WordOut(
                        w=text,
                        start=start,
                        end=end,
                        score=float(score) if score is not None else None,
                    )
                )

            speaker = seg.get("speaker")
            out.append(
                SegmentOut(
                    start=float(seg.get("start", 0.0)),
                    end=float(seg.get("end", 0.0)),
                    text=str(seg.get("text", "")).strip(),
                    speaker=str(speaker) if speaker is not None else None,
                    words=words,
                )
            )
        return out

    # ---- faster-whisper 路径：ASR + 词级时间戳（无对齐/分离）----

    def _transcribe_faster_whisper(
        self,
        audio_path: str,
        language: str,
        diarize: bool,
        num_speakers: int | None = None,
        job_id: str | None = None,
    ) -> TranscribeResult:
        # 标点/分离由 sherpa-onnx 转写后补齐(见下)。beam=1 换速度;VAD 跳静音。
        # 大文件分块:整段长音频一次性喂 VAD 会建一个覆盖全时长的巨型频谱数组(2 小时→1.85GB complex128 OOM)。
        # 顶级做法 = 按 ASR_CHUNK_SEC(默认 15 分钟)连续分块,每块独立转写、时间戳加偏移后合并,内存有界。
        import os as _os
        import wave

        import numpy as np  # type: ignore

        beam = int(_os.environ.get("ASR_BEAM", "1"))
        chunk_sec = float(_os.environ.get("ASR_CHUNK_SEC", "900"))

        # 抓取本地引用:整轮转写用同一个模型对象,驱逐器无论何时清掉 self._fw_model 都不影响在跑的这轮
        model = self._fw_model
        if model is None:
            raise RuntimeError("ASR model not loaded (race with idle-unload?)")

        with wave.open(audio_path, "rb") as w:
            sr = w.getframerate() or 16000
            raw = w.readframes(w.getnframes())
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        total = (len(audio) / sr) if sr else 0.0

        segments: list[SegmentOut] = []
        detected_lang = language

        def _run(arr, offset: float) -> None:
            nonlocal detected_lang
            seg_iter, info = model.transcribe(
                arr, language=language, word_timestamps=True, beam_size=beam, vad_filter=True
            )
            detected_lang = str(getattr(info, "language", language) or language)
            for seg in seg_iter:
                if total > 0:
                    set_progress(job_id, min(0.999, (offset + float(seg.end)) / total))
                words: list[WordOut] = []
                for w in getattr(seg, "words", None) or []:
                    wt = str(getattr(w, "word", "")).strip()
                    if not wt:
                        continue
                    words.append(
                        WordOut(
                            w=wt,
                            start=offset + float(getattr(w, "start", seg.start)),
                            end=offset + float(getattr(w, "end", seg.end)),
                            score=float(w.probability) if getattr(w, "probability", None) is not None else None,
                        )
                    )
                segments.append(
                    SegmentOut(
                        start=offset + float(seg.start),
                        end=offset + float(seg.end),
                        text=str(seg.text).strip(),
                        speaker=None,
                        words=words,
                    )
                )

        if chunk_sec <= 0 or total <= chunk_sec * 1.5:
            _run(audio, 0.0)
        else:
            # 块边界不硬切:在目标点 ±10s 内找最静音处下刀(硬切在词中间会丢字/出乱词)
            t0 = 0.0
            while t0 < total - 0.1:
                target = t0 + chunk_sec
                if target >= total - chunk_sec * 0.25:
                    cut = total  # 尾块并入,避免极短尾巴
                else:
                    cut = _quietest_cut(audio, sr, target, 10.0)
                _run(audio[int(t0 * sr):int(cut * sr)], t0)
                t0 = cut

        # 标点恢复 + 说话人分离 + 声纹 → 隔离子进程(就地改写 text/speaker)
        diarized, spk_embs, embed_model = enrich_segments(audio_path, segments, num_speakers, diarize)

        return TranscribeResult(
            language=detected_lang,
            duration_sec=total,
            speakers=_collect_speakers(segments),
            segments=segments,
            asr_model=settings.whisper_model,
            diarized=diarized,
            device_used=self._device or "cpu",
            speaker_embeddings=spk_embs,
            embedding_model=embed_model,
        )


def _collect_speakers(segments: list[SegmentOut]) -> list[str]:
    """收集去重后的说话人标签，按首次出现顺序稳定排序。"""
    seen: list[str] = []
    for seg in segments:
        if seg.speaker and seg.speaker not in seen:
            seen.append(seg.speaker)
        for w in seg.words:
            # words 暂不单独带 speaker 字段（合并由段决定），此处保留扩展位。
            _ = w
    return seen


# 模块级单例。import 本模块不触发任何重型加载。
engine = _Engine()
