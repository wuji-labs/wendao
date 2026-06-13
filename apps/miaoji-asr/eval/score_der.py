# DER 评分 · 自含实现(numpy+scipy 帧级 10ms + Hungarian 最优说话人映射)
# 不依赖 pyannote.metrics(其 4.x 要 numpy>=2.2,与 DiariZen fork 的 numpy 1.26 冲突)。
# 口径:strict(collar=0) 与 collar=0.25s(参考段边界两侧各 0.25s 不计分 · md-eval 惯例)。
# 重叠语音参与计分(skip_overlap=False)。
# 用法: python eval/score_der.py <ref_dir> <hyp_dir> [<hyp_dir2> ...]
from __future__ import annotations

import os
import sys

import numpy as np
from scipy.optimize import linear_sum_assignment

FRAME = 0.010  # 10ms


def load_rttm(path: str) -> list[tuple[float, float, str]]:
    out = []
    with open(path, encoding="utf-8") as f:
        for ln in f:
            p = ln.split()
            if len(p) >= 8 and p[0] == "SPEAKER":
                s, d = float(p[3]), float(p[4])
                if d > 0:
                    out.append((s, s + d, p[7]))
    return out


def to_frames(turns, spk_ids: dict, n_frames: int) -> np.ndarray:
    m = np.zeros((len(spk_ids), n_frames), dtype=bool)
    for s, e, spk in turns:
        a, b = int(round(s / FRAME)), min(n_frames, int(round(e / FRAME)))
        if b > a:
            m[spk_ids[spk], a:b] = True
    return m


def der(ref_turns, hyp_turns, collar: float) -> tuple[float, float]:
    """返回 (der, ref_total_sec)。最优映射后 miss+fa+conf / ref_total。"""
    end = max([e for _, e, _ in ref_turns + hyp_turns] or [0.0])
    n = int(np.ceil(end / FRAME)) + 1
    rspk = {s: i for i, s in enumerate(sorted({x[2] for x in ref_turns}))}
    hspk = {s: i for i, s in enumerate(sorted({x[2] for x in hyp_turns}))}
    R = to_frames(ref_turns, rspk, n)
    H = to_frames(hyp_turns, hspk, n)

    keep = np.ones(n, dtype=bool)
    if collar > 0:
        c = int(round(collar / FRAME))
        for s, e, _ in ref_turns:
            for t in (s, e):
                i = int(round(t / FRAME))
                keep[max(0, i - c):min(n, i + c)] = False
    R, H = R[:, keep], H[:, keep]

    # 最优一对一说话人映射(Hungarian · 最大化重叠帧)
    ov = (R[:, None, :] & H[None, :, :]).sum(axis=2).astype(np.float64)
    ri, hi = linear_sum_assignment(-ov)
    correct = int(ov[ri, hi].sum())  # 映射命中帧(一对一,天然每帧 ≤ min(|ref|,|hyp|))

    # 帧级标准分解:miss = max(0,r-h) · fa = max(0,h-r) · conf = min(r,h) - correct
    Rs = R.sum(axis=0).astype(np.int64)
    Hs = H.sum(axis=0).astype(np.int64)
    ref_n = int(Rs.sum())
    if ref_n == 0:
        return 0.0, 0.0
    miss = int(np.maximum(Rs - Hs, 0).sum())
    fa = int(np.maximum(Hs - Rs, 0).sum())
    conf = max(int(np.minimum(Rs, Hs).sum()) - correct, 0)
    return (miss + fa + conf) / ref_n, ref_n * FRAME


def main() -> None:
    ref_dir = sys.argv[1]
    hyp_dirs = sys.argv[2:]
    sids = sorted(f[:-5] for f in os.listdir(ref_dir) if f.endswith(".rttm"))
    print(f"{'session':<14}" + "".join(f"{os.path.basename(h)[:20]:>26}" for h in hyp_dirs) + "   (strict% / collar0.25%)")
    agg = {h: [0.0, 0.0, 0.0, 0.0] for h in hyp_dirs}  # err_s, tot_s, err_c, tot_c
    for sid in sids:
        ref = load_rttm(os.path.join(ref_dir, f"{sid}.rttm"))
        row = f"{sid:<14}"
        for h in hyp_dirs:
            hp = os.path.join(h, f"{sid}.rttm")
            if not os.path.isfile(hp):
                row += f"{'--':>26}"
                continue
            hyp = load_rttm(hp)
            d_s, t_s = der(ref, hyp, 0.0)
            d_c, t_c = der(ref, hyp, 0.25)
            agg[h][0] += d_s * t_s
            agg[h][1] += t_s
            agg[h][2] += d_c * t_c
            agg[h][3] += t_c
            row += f"{d_s * 100:>12.2f}/{d_c * 100:<13.2f}"
        print(row)
    print("-" * (14 + 26 * len(hyp_dirs)))
    row = f"{'TOTAL':<14}"
    for h in hyp_dirs:
        e_s, t_s, e_c, t_c = agg[h]
        row += f"{(e_s / t_s if t_s else 0) * 100:>12.2f}/{(e_c / t_c if t_c else 0) * 100:<13.2f}"
    print(row)


if __name__ == "__main__":
    main()
