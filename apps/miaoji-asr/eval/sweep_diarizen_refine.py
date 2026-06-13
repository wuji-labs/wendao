# 聚焦细扫:在 0.50-0.58 拐点附近,用更高 min_cluster_size 吸收噪声 dust,求「~7 干净说话人」
# 粗扫发现:thr 0.50/min_clus 12 → 15 人(7 实 + 8 dust)。dust 多在 ≤1min。
# 此处验:适当 thr + 较高 min_cluster_size 能否只留实质说话人。
# 用法: .venv-diar/Scripts/python.exe eval/sweep_diarizen_refine.py <wav>
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

    # (threshold, min_cluster_size, max_speakers) — 围绕拐点 + 抬 min_cluster 杀 dust
    grid = [
        (0.55, 25, 12),
        (0.55, 20, 12),
        (0.52, 25, 12),
        (0.52, 20, 12),
        (0.50, 25, 12),
    ]
    print(f"{'threshold':>9} {'min_clus':>8} {'max_spk':>7} {'spk':>4} {'substantial(>=2min)':>19} {'time':>6}  per-speaker minutes")
    for thr, mcs, maxs in grid:
        pipe.max_speakers = maxs
        pipe.min_speakers = 1
        pipe.instantiate({"clustering": {"method": "centroid", "min_cluster_size": mcs, "threshold": thr}})
        t0 = time.time()
        dia = pipe(wav)
        dt = time.time() - t0
        dur: dict = defaultdict(float)
        for turn, _, spk in dia.itertracks(yield_label=True):
            dur[spk] += turn.end - turn.start
        mins = sorted((d / 60 for d in dur.values()), reverse=True)
        substantial = sum(1 for m in mins if m >= 2.0)
        mins_str = " ".join(f"{m:.0f}" for m in mins)
        print(f"{thr:>9.2f} {mcs:>8} {maxs:>7} {len(dur):>4} {substantial:>19} {dt:>5.0f}s  [{mins_str}]", flush=True)


if __name__ == "__main__":
    main()
