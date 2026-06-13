"""单段音频 → CAM++ 声纹向量 + 质量度量 · 独立子进程(sherpa venv · 与 faster-whisper 进程隔离)。

声纹录入 v2 用:从一段专用录音(或会议片段)抽一条声纹,并给出「有效语音时长」供调用方做
质量门控——少于阈值的样本不该入库(根治「随便一句话定声纹」)。

用法: python -m app.embed_clip <wav16k_mono>
输出(stdout JSON):
  {"ok":true,"embedding":[...256],"speechSec":float,"totalSec":float,"snrDb":float}
  {"ok":false,"error":"..."}
"""
from __future__ import annotations

import json
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _speech_stats(samples: np.ndarray, sr: int, frame: float = 0.03) -> tuple[float, float, np.ndarray]:
    """能量法 VAD:返回(有效语音秒, 粗略 SNR dB, 语音帧掩码)。
    自适应阈值 = 噪声底(20 分位)+ 12dB;够区分「在说话」与「静音/底噪」。"""
    win = max(1, int(frame * sr))
    n = (len(samples) // win) * win
    if n == 0:
        return 0.0, 0.0, np.zeros(0, dtype=bool)
    frames = samples[:n].reshape(-1, win)
    rms = np.sqrt((frames**2).mean(axis=1) + 1e-12)
    db = 20.0 * np.log10(rms + 1e-9)
    noise_floor = float(np.percentile(db, 20))
    speech_level = float(np.percentile(db, 95))
    thresh = noise_floor + 12.0
    mask = db > thresh
    speech_sec = float(mask.sum()) * frame
    snr = speech_level - noise_floor
    return speech_sec, snr, mask


def main() -> None:
    wav = sys.argv[1]
    with wave.open(wav, "rb") as w:
        sr = w.getframerate() or 16000
        raw = w.readframes(w.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    total = len(samples) / sr if sr else 0.0
    speech_sec, snr, mask = _speech_stats(samples, sr)

    # 只把语音帧喂给声纹模型(去掉静音/底噪,向量更干净)
    from app.diar_punct import EMBED_MODEL_ID, _extractor

    win = max(1, int(0.03 * sr))
    n = (len(samples) // win) * win
    if mask.size and speech_sec >= 0.5:
        voiced = samples[:n].reshape(-1, win)[mask].reshape(-1)
    else:
        voiced = samples  # 兜底:VAD 没抓到就用全段

    ext = _extractor()
    stream = ext.create_stream()
    stream.accept_waveform(sr, voiced)
    stream.input_finished()
    emb = [float(x) for x in ext.compute(stream)]

    json.dump(
        {
            "ok": True,
            "embedding": emb,
            "model": EMBED_MODEL_ID,
            "speechSec": round(speech_sec, 2),
            "totalSec": round(total, 2),
            "snrDb": round(snr, 1),
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        main()
    except Exception as e:  # noqa: BLE001 — 子进程边界,失败转 JSON 由调用方判
        json.dump({"ok": False, "error": f"{type(e).__name__}: {e}"}, sys.stdout)
        sys.exit(0)
