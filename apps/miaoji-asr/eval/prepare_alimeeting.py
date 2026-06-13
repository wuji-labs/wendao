# AliMeeting Eval 集预处理:8ch far wav → 16k 单声道(取 ch0) + TextGrid → RTTM 参考
# 运行环境:.venv-diar(textgrid + numpy)。
# 用法: python eval/prepare_alimeeting.py <Eval_Ali 根目录> <输出工作目录>
# 输出: <out>/wav/<sid>.wav · <out>/ref/<sid>.rttm
from __future__ import annotations

import os
import sys
import wave

import numpy as np


def to_mono16k(src: str, dst: str) -> float:
    with wave.open(src, "rb") as w:
        sr = w.getframerate()
        nch = w.getnchannels()
        sw = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    assert sw == 2, f"expect 16-bit, got {sw * 8}-bit"
    a = np.frombuffer(raw, dtype=np.int16).reshape(-1, nch)[:, 0]  # ch0
    if sr != 16000:
        # 简单线性重采样(AliMeeting 本就 16k,此分支仅保险)
        n2 = int(len(a) * 16000 / sr)
        a = np.interp(np.linspace(0, len(a) - 1, n2), np.arange(len(a)), a.astype(np.float64)).astype(np.int16)
        sr = 16000
    with wave.open(dst, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(a.tobytes())
    return len(a) / sr


def textgrid_to_rttm(tg_path: str, sid: str, out_path: str) -> int:
    import textgrid  # 惰性:wav 转换可在无 textgrid 的产线 venv 下跑(--wav-only)

    tg = textgrid.TextGrid.fromFile(tg_path)
    n = 0
    with open(out_path, "w", encoding="utf-8") as f:
        for tier in tg.tiers:
            spk = tier.name.strip() or f"tier{tg.tiers.index(tier)}"
            for itv in tier:
                if not getattr(itv, "mark", "").strip():
                    continue
                dur = itv.maxTime - itv.minTime
                if dur <= 0:
                    continue
                f.write(f"SPEAKER {sid} 1 {itv.minTime:.3f} {dur:.3f} <NA> <NA> {spk} <NA> <NA>\n")
                n += 1
    return n


def main() -> None:
    root, out = sys.argv[1], sys.argv[2]
    wav_only = "--wav-only" in sys.argv
    far = os.path.join(root, "Eval_Ali_far")
    os.makedirs(os.path.join(out, "wav"), exist_ok=True)
    os.makedirs(os.path.join(out, "ref"), exist_ok=True)
    for fn in sorted(os.listdir(os.path.join(far, "audio_dir"))):
        if not fn.endswith(".wav"):
            continue
        sid = "_".join(fn.split("_")[:2])  # R8001_M8004_MS801.wav → R8001_M8004
        tg = os.path.join(far, "textgrid_dir", f"{sid}.TextGrid")
        if not os.path.isfile(tg):
            print(f"skip {sid}: no TextGrid")
            continue
        dst = os.path.join(out, "wav", f"{sid}.wav")
        if not os.path.isfile(dst):
            dur = to_mono16k(os.path.join(far, "audio_dir", fn), dst)
        else:
            with wave.open(dst, "rb") as w:
                dur = w.getnframes() / w.getframerate()
        n = textgrid_to_rttm(tg, sid, os.path.join(out, "ref", f"{sid}.rttm")) if not wav_only else -1
        print(f"{sid}: {dur / 60:.1f}min, {n} ref turns")


if __name__ == "__main__":
    main()
