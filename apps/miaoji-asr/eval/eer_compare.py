"""声纹模型验证:在 AliMeeting(有真值说话人标注)上比 CAM++ vs ERes2NetV2 的 EER。
不信 CN-Celeb 的纸面数,在自家会议数据上实测——更准的(EER 低)才换。

做法:每会按 RTTM 把每个真值说话人的语音切成多段 ~6s,各抽一条声纹;
同人不同段=target 对,跨人=imposter 对;聚合所有会的分数算 EER。

用法: .venv/Scripts/python.exe eval/eer_compare.py <work>(含 wav/ 与 ref/) <model.onnx> [chunk_sec]
"""
from __future__ import annotations

import os
import sys
import wave

import numpy as np


def _load(wav: str):
    with wave.open(wav, "rb") as w:
        sr = w.getframerate() or 16000
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0, sr


def _rttm_by_speaker(path: str) -> dict[str, list[tuple[float, float]]]:
    by: dict[str, list[tuple[float, float]]] = {}
    with open(path, encoding="utf-8") as f:
        for ln in f:
            p = ln.split()
            if len(p) >= 8 and p[0] == "SPEAKER":
                s, d, spk = float(p[3]), float(p[4]), p[7]
                if d > 0:
                    by.setdefault(spk, []).append((s, s + d))
    return by


def _embeddings_for_speaker(ext, samples, sr, turns, chunk_sec: float):
    """把该说话人的语音拼起来,按 chunk_sec 切段,每段抽一条声纹(段需 ≥ chunk_sec*0.6 语音)。"""
    parts = [samples[int(s * sr):int(e * sr)] for s, e in sorted(turns)]
    if not parts:
        return []
    voiced = np.concatenate(parts)
    embs = []
    win = int(chunk_sec * sr)
    for i in range(0, len(voiced) - int(win * 0.6), win):
        seg = voiced[i:i + win]
        if len(seg) < win * 0.6:
            break
        st = ext.create_stream()
        st.accept_waveform(sr, seg)
        st.input_finished()
        embs.append(np.array(ext.compute(st), dtype=np.float64))
    return embs


def _cos(a, b):
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    return float(a @ b / (na * nb)) if na and nb else -1.0


def _eer(targets, imposters):
    import numpy as np

    scores = np.array(targets + imposters)
    labels = np.array([1] * len(targets) + [0] * len(imposters))
    thr = np.unique(scores)
    best = (1.0, 0.0)
    for t in thr:
        fa = np.mean(scores[labels == 0] >= t) if (labels == 0).any() else 0.0  # imposter accepted
        fr = np.mean(scores[labels == 1] < t) if (labels == 1).any() else 0.0  # target rejected
        if abs(fa - fr) < abs(best[0] - best[1]):
            best = (fa, fr)
    return (best[0] + best[1]) / 2 * 100


def main() -> None:
    work, model = sys.argv[1], sys.argv[2]
    chunk_sec = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
    import sherpa_onnx

    ext = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model))

    wav_dir = os.path.join(work, "wav")
    ref_dir = os.path.join(work, "ref")
    per_spk: dict[str, list] = {}  # global key "sid/spk" → [emb...]
    for fn in sorted(os.listdir(wav_dir)):
        if not fn.endswith(".wav"):
            continue
        sid = fn[:-4]
        ref = os.path.join(ref_dir, f"{sid}.rttm")
        if not os.path.isfile(ref):
            continue
        samples, sr = _load(os.path.join(wav_dir, fn))
        for spk, turns in _rttm_by_speaker(ref).items():
            embs = _embeddings_for_speaker(ext, samples, sr, turns, chunk_sec)
            if len(embs) >= 2:
                per_spk[f"{sid}/{spk}"] = embs

    targets, imposters = [], []
    keys = list(per_spk.keys())
    for k, embs in per_spk.items():
        for i in range(len(embs)):
            for j in range(i + 1, len(embs)):
                targets.append(_cos(embs[i], embs[j]))
    # imposter:跨说话人,每对取首段(控制对数)
    for a in range(len(keys)):
        for b in range(a + 1, len(keys)):
            imposters.append(_cos(per_spk[keys[a]][0], per_spk[keys[b]][0]))

    eer = _eer(targets, imposters)
    print(
        f"model={os.path.basename(model)} speakers={len(keys)} "
        f"target_pairs={len(targets)} imposter_pairs={len(imposters)} "
        f"target_mean={np.mean(targets):.3f} imposter_mean={np.mean(imposters):.3f} EER={eer:.2f}%"
    )


if __name__ == "__main__":
    main()
