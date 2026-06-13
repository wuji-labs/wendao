# 现状基线:app.diar_punct._diarize_global(sherpa-onnx pyannote-seg3 + CAM++ + FastClustering)
# 跑 AliMeeting wav → RTTM 假设。运行环境:产线 .venv(sherpa-onnx)。cwd 必须 = apps/miaoji-asr。
# 用法: .venv/Scripts/python.exe eval/run_sherpa_baseline.py <work>/wav <work>/hyp_sherpa [num_speakers|0]
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.diar_punct import _diarize_global, _load_samples  # noqa: E402


def main() -> None:
    wav_dir, out_dir = sys.argv[1], sys.argv[2]
    nspk = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    os.makedirs(out_dir, exist_ok=True)
    for fn in sorted(os.listdir(wav_dir)):
        if not fn.endswith(".wav"):
            continue
        sid = fn[:-4]
        out = os.path.join(out_dir, f"{sid}.rttm")
        if os.path.isfile(out):
            print(f"{sid}: cached")
            continue
        samples, sr = _load_samples(os.path.join(wav_dir, fn))
        t0 = time.time()
        turns, _embs = _diarize_global(samples, sr, nspk)
        dt = time.time() - t0
        if turns is None:
            print(f"{sid}: FAILED")
            continue
        with open(out, "w", encoding="utf-8") as f:
            for s, e, g in turns:
                f.write(f"SPEAKER {sid} 1 {s:.3f} {e - s:.3f} <NA> <NA> SPEAKER_{g:02d} <NA> <NA>\n")
        spks = len({g for _, _, g in turns})
        print(f"{sid}: {len(turns)} turns, {spks} speakers, {dt:.0f}s")


if __name__ == "__main__":
    main()
