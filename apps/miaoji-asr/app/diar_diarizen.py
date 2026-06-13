"""DiariZen 说话人分离后端 · 独立子进程(跑在 .venv-diar:torch cu128 + DiariZen + pyannote fork)。

为何独立 venv:产线 .venv 是 ctranslate2/onnx 栈(无 torch);DiariZen 要 torch+fork-pyannote+numpy1.26,
两栈依赖互斥,与 diar_punct 的 sherpa/faster-whisper DLL 隔离同理。

模型:BUT-FIT/diarizen-meeting-base(MIT · 可商用)。s80/large 系是 CC-BY-NC,禁入产线(见 eval/README)。
选型依据:AliMeeting far DER 基准,sherpa-onnx 现状 vs DiariZen,详 eval/ 与 commit 信息。

用法: .venv-diar/Scripts/python.exe -m app.diar_diarizen <wav> [num_speakers|0]
输出(stdout JSON): {"ok":true,"turns":[[start,end,gid],...]} · gid 从 0 起连续
失败: {"ok":false,"error":...}(调用方回退 sherpa 路径)
"""
from __future__ import annotations

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HOME", os.path.join(_ROOT, "models", "hf-cache"))

DEFAULT_MODEL = "BUT-FIT/diarizen-meeting-base"


def main() -> None:
    wav = sys.argv[1]
    num_speakers = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    model = os.environ.get("MIAOJI_DIARIZEN_MODEL", DEFAULT_MODEL)

    # DiariZen/pyannote 加载期会向 stdout 打配置信息,污染本协议的 JSON——
    # 工作期间 stdout 指向 stderr,最后用真 stdout 发 JSON
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import torch
    from torch.serialization import add_safe_globals

    # torch>=2.6 weights_only 默认拦非张量类;仅白名单官方 checkpoint 实际用到的
    # 版本号/任务规格等元数据类,不开 weights_only=False 大门
    from pyannote.audio.core.task import Problem, Resolution, Specifications

    add_safe_globals([torch.torch_version.TorchVersion, Specifications, Problem, Resolution])

    from diarizen.pipelines.inference import DiariZenPipeline

    pipe = DiariZenPipeline.from_pretrained(model)
    if num_speakers and num_speakers > 0:
        # DiariZen 聚类参数支持 min/max speakers;钉死簇数用等值上下界
        pipe.min_speakers = num_speakers
        pipe.max_speakers = num_speakers

    dia = pipe(wav)
    labels = {spk: i for i, spk in enumerate(sorted(dia.labels()))}
    turns = [
        [float(turn.start), float(turn.end), labels[spk]]
        for turn, _, spk in dia.itertracks(yield_label=True)
    ]
    turns.sort(key=lambda t: t[0])
    sys.stdout = real_stdout
    json.dump({"ok": True, "turns": turns}, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — 子进程边界,一切失败转 JSON 由调用方降级
        sys.stdout = sys.__stdout__
        json.dump({"ok": False, "error": f"{type(e).__name__}: {e}"}, sys.stdout)
        sys.exit(0)
