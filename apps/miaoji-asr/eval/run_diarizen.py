# 候选:DiariZen(BUT-FIT · WavLM-EEND 局部 + 声纹聚类)→ RTTM 假设
# 运行环境:.venv-diar(torch cu128 + DiariZen + 其 pyannote fork)。模型不带 HF 门禁。
# 默认 BUT-FIT/diarizen-meeting-base(MIT · 可商用)。s80/large 系为 CC-BY-NC,仅评测参照。
# 用法: .venv-diar/Scripts/python.exe eval/run_diarizen.py <work>/wav <out_dir> [model_id]
from __future__ import annotations

import os
import sys
import time


def main() -> None:
    wav_dir, out_dir = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "BUT-FIT/diarizen-meeting-base"
    os.makedirs(out_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "hf-cache"))

    import torch
    from torch.serialization import add_safe_globals

    # torch>=2.6 weights_only 默认拦非张量类;仅白名单官方 checkpoint 实际用到的
    # 版本号/任务规格等元数据类,不开 weights_only=False 大门
    from pyannote.audio.core.task import Problem, Resolution, Specifications

    add_safe_globals([torch.torch_version.TorchVersion, Specifications, Problem, Resolution])

    from diarizen.pipelines.inference import DiariZenPipeline

    pipe = DiariZenPipeline.from_pretrained(model)
    # 可选:env 覆盖聚类阈值,与产线 diar_diarizen.py 同口径,用于验证新默认不伤小会议
    thr = os.environ.get("MIAOJI_DIAR_THRESHOLD")
    if thr is not None:
        mcs = int(os.environ.get("MIAOJI_DIAR_MIN_CLUSTER", "20"))
        pipe.min_speakers = 1
        pipe.max_speakers = int(os.environ.get("MIAOJI_DIAR_MAX_SPEAKERS", "12"))
        pipe.instantiate({"clustering": {"method": "centroid", "min_cluster_size": mcs, "threshold": float(thr)}})

    for fn in sorted(os.listdir(wav_dir)):
        if not fn.endswith(".wav"):
            continue
        sid = fn[:-4]
        out = os.path.join(out_dir, f"{sid}.rttm")
        if os.path.isfile(out):
            print(f"{sid}: cached", flush=True)
            continue
        t0 = time.time()
        dia = pipe(os.path.join(wav_dir, fn))
        dt = time.time() - t0
        with open(out, "w", encoding="utf-8") as f:
            for turn, _, spk in dia.itertracks(yield_label=True):
                f.write(f"SPEAKER {sid} 1 {turn.start:.3f} {turn.end - turn.start:.3f} <NA> <NA> {spk} <NA> <NA>\n")
        print(f"{sid}: {len(dia.labels())} speakers, {dt:.0f}s", flush=True)


if __name__ == "__main__":
    main()
