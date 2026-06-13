# 扫 DiariZen 聚类阈值 → 说话人数(诊断 under/over-clustering · 无 ground truth 时看灵敏度)
# meeting-base 默认 threshold=0.7 / min_cluster_size=30 偏保守(合并狠 → 说话人偏少)。
# 用法: .venv-diar/Scripts/python.exe eval/sweep_diarizen_threshold.py <wav>
from __future__ import annotations

import os
import sys
import time
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HOME", os.path.join(_ROOT, "models", "hf-cache"))


def main() -> None:
    wav = sys.argv[1]
    import torch
    from torch.serialization import add_safe_globals
    from pyannote.audio.core.task import Problem, Resolution, Specifications

    add_safe_globals([torch.torch_version.TorchVersion, Specifications, Problem, Resolution])
    from diarizen.pipelines.inference import DiariZenPipeline

    pipe = DiariZenPipeline.from_pretrained("BUT-FIT/diarizen-meeting-base")

    # (threshold, min_cluster_size, max_speakers)
    grid = [
        (0.70, 30, 8),   # 默认
        (0.60, 20, 12),
        (0.50, 12, 15),
        (0.45, 8, 20),
        (0.40, 5, 20),
    ]
    print(f"{'threshold':>9} {'min_clus':>8} {'max_spk':>7} {'speakers':>8} {'time':>6}  per-speaker minutes")
    for thr, mcs, maxs in grid:
        pipe.max_speakers = maxs
        pipe.min_speakers = 1
        pipe.instantiate(
            {"clustering": {"method": "centroid", "min_cluster_size": mcs, "threshold": thr}}
        )
        t0 = time.time()
        dia = pipe(wav)
        dt = time.time() - t0
        dur: dict = defaultdict(float)
        for turn, _, spk in dia.itertracks(yield_label=True):
            dur[spk] += turn.end - turn.start
        mins = sorted((d / 60 for d in dur.values()), reverse=True)
        mins_str = " ".join(f"{m:.0f}" for m in mins)
        print(f"{thr:>9.2f} {mcs:>8} {maxs:>7} {len(dur):>8} {dt:>5.0f}s  [{mins_str}]", flush=True)


if __name__ == "__main__":
    main()
