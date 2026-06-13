# 候选:pyannote speaker-diarization(community-1 优先,3.1 兜底)→ RTTM 假设
# 运行环境:.venv-diar(torch cu128 + pyannote.audio)。需 HF token(secrets 群共享)。
# 用法: .venv-diar/Scripts/python.exe eval/run_pyannote.py <work>/wav <work>/hyp_pyannote [model] [num_speakers|0]
from __future__ import annotations

import os
import sys
import time


def main() -> None:
    wav_dir, out_dir = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "pyannote/speaker-diarization-community-1"
    nspk = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    os.makedirs(out_dir, exist_ok=True)

    import wave

    import numpy as np
    import torch
    from pyannote.audio import Pipeline

    def load_wave(path: str):
        # torchcodec 在本机缺 FFmpeg DLL,走官方支持的预载 waveform 路径
        with wave.open(path, "rb") as w:
            sr = w.getframerate()
            raw = w.readframes(w.getnframes())
        a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        return {"waveform": torch.from_numpy(a).unsqueeze(0), "sample_rate": sr}

    pipe = Pipeline.from_pretrained(model, token=os.environ.get("HF_TOKEN") or True)
    pipe.to(torch.device("cuda"))

    for fn in sorted(os.listdir(wav_dir)):
        if not fn.endswith(".wav"):
            continue
        sid = fn[:-4]
        out = os.path.join(out_dir, f"{sid}.rttm")
        if os.path.isfile(out):
            print(f"{sid}: cached")
            continue
        t0 = time.time()
        kw = {"num_speakers": nspk} if nspk > 0 else {}
        dia = pipe(load_wave(os.path.join(wav_dir, fn)), **kw)
        dt = time.time() - t0
        ann = getattr(dia, "speaker_diarization", dia)  # community-1 返回 output 对象,3.x 直接 Annotation
        with open(out, "w", encoding="utf-8") as f:
            for turn, _, spk in ann.itertracks(yield_label=True):
                f.write(f"SPEAKER {sid} 1 {turn.start:.3f} {turn.end - turn.start:.3f} <NA> <NA> {spk} <NA> <NA>\n")
        spks = len(ann.labels())
        print(f"{sid}: {spks} speakers, {dt:.0f}s")


if __name__ == "__main__":
    main()
