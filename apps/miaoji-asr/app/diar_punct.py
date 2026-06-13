"""说话人分离 + 中文标点 + 声纹提取 · 独立子进程(只 import sherpa_onnx,避开与 faster-whisper 的 onnxruntime DLL 冲突)。

用法: python -m app.diar_punct <wav> <segments.json> <num_speakers|0> <diarize 1|0>
- segments.json: [{"start":float,"end":float,"text":str}, ...]
输出(stdout, JSON):
  {"ok":bool,"diarized":bool,"speakers":[str],
   "speakerEmbeddings":{str:[float]},   # 每个全局说话人簇的声纹向量(供声纹库比对/注册)
   "segments":[{...,"text":punct,"speaker":str|null}]}

长音频:按 DIAR_CHUNK_SEC(默认 20 分钟)分块各自分离,再用声纹把各块的同一人串成同一个全局说话人
(顶级大厂做法:分块分离 + 跨块声纹链接,内存有界、长会议也能稳定分离)。所有失败均降级,不抛。
"""
from __future__ import annotations

import bisect
import json
import math
import os
import sys
import wave

_MODELS = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
_PUNCT = os.path.join(_MODELS, "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12", "model.onnx")
_SEG = os.path.join(_MODELS, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx")
# 声纹模型:默认 ERes2NetV2 zh-cn(3D-Speaker·实测 AliMeeting EER 4.00% < CAM++ 5.28%·见 eval/eer_compare)。
# env MIAOJI_VOICEPRINT_MODEL 可覆盖(文件名,不含 .onnx);缺则按优先级回退。
# 注:不同模型的向量不可跨比(即便同 192 维),故 EMBED_MODEL_ID 随响应/样本带出,匹配只比同模型。
def _pick_embed_model() -> tuple[str, str]:
    forced = os.environ.get("MIAOJI_VOICEPRINT_MODEL", "").strip()
    candidates = [forced] if forced else ["eres2netv2_zh", "campplus_zh", "spk_embed"]
    for name in candidates:
        p = os.path.join(_MODELS, f"{name}.onnx")
        if os.path.isfile(p):
            return p, name
    # 兜底:目录里任一 onnx(极少触发)
    return os.path.join(_MODELS, "campplus_zh.onnx"), "campplus_zh"


_EMBED, EMBED_MODEL_ID = _pick_embed_model()


def _load_samples(wav: str):
    import numpy as np

    with wave.open(wav, "rb") as w:
        sr = w.getframerate() or 16000
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0, sr


def _punctuator():
    import sherpa_onnx

    if not os.path.isfile(_PUNCT):
        return None
    cfg = sherpa_onnx.OfflinePunctuationConfig(
        model=sherpa_onnx.OfflinePunctuationModelConfig(ct_transformer=_PUNCT)
    )
    return sherpa_onnx.OfflinePunctuation(cfg)


def _make_sd(num_speakers: int):
    import sherpa_onnx

    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=_SEG)
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=_EMBED),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=num_speakers if num_speakers and num_speakers > 0 else -1,
            threshold=float(os.environ.get("DIAR_THRESHOLD", "1.15")),
        ),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    return sherpa_onnx.OfflineSpeakerDiarization(cfg)


def _extractor():
    import sherpa_onnx

    return sherpa_onnx.SpeakerEmbeddingExtractor(
        sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=_EMBED)
    )


def _quietest_cut(samples, sr: int, target: float, search: float) -> float:
    """在 target±search 秒内找能量最低的 200ms 处作为切点(边界落静音,不切断说话)。"""
    import numpy as np

    a = max(0, int((target - search) * sr))
    b = min(len(samples), int((target + search) * sr))
    if b - a < sr:
        return target
    win = max(1, int(0.2 * sr))
    seg = samples[a:b]
    n = (len(seg) // win) * win
    if n == 0:
        return target
    rms = np.sqrt((seg[:n].reshape(-1, win) ** 2).mean(axis=1))
    return (a + int(rms.argmin()) * win + win // 2) / sr


def _cosine(a, b) -> float:
    if not a or not b or len(a) != len(b):
        return -1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return -1.0
    return dot / (na * nb)


def _embed_speaker(ext, sr: int, chunk, turns):
    """对块内某说话人的若干段(累计 ≤30s)抽一条声纹向量。turns 为块内本地时间 (start,end)。
    精微:优先用 ≥1s 的 turn(碎 turn 多为抢话/噪声);每条收边 0.1s(turn 边缘常沾到他人尾音)。"""
    import numpy as np

    turns = sorted(turns, key=lambda t: t[1] - t[0], reverse=True)
    clean = [(s, e) for s, e in turns if e - s >= 1.0] or turns
    parts = []
    total = 0.0
    for s, e in clean:
        s2, e2 = (s + 0.1, e - 0.1) if e - s > 0.4 else (s, e)
        parts.append(chunk[int(s2 * sr):int(e2 * sr)])
        total += e2 - s2
        if total >= 30.0:
            break
    if not parts:
        return None
    audio = np.concatenate(parts)
    if len(audio) < sr * 0.3:  # 太短不可靠
        return None
    stream = ext.create_stream()
    stream.accept_waveform(sr, audio)
    stream.input_finished()
    return [float(x) for x in ext.compute(stream)]


def _diarize_global(samples, sr: int, num_speakers: int):
    """分块分离 + 跨块声纹链接 → (global_turns[(start,end,gid)], {SPEAKER_xx:[emb]})。失败返回 (None, {})。"""
    if not (os.path.isfile(_SEG) and os.path.isfile(_EMBED)):
        return None, {}
    total = len(samples) / sr
    # 45 分钟/块:≤67 分钟单趟跑(无跨块串联风险);更长才分块。块越少串联错误面越小。
    chunk_sec = float(os.environ.get("DIAR_CHUNK_SEC", "2700"))
    link_thr = float(os.environ.get("DIAR_LINK_THRESHOLD", "0.5"))
    ext = _extractor()

    protos: list[dict] = []  # 全局说话人原型 {emb, count}

    def link_chunk(local_embs: dict) -> dict:
        """整块一起做约束匹配:同块内已被聚类分开的说话人绝不合并 ——
        每个全局原型本块至多认领一个本地说话人;按相似度降序贪心;落选/低于阈值者立新全局。"""
        pairs = []
        for lspk, emb in local_embs.items():
            if emb is None:
                continue
            for gi, g in enumerate(protos):
                if g["emb"] is None:
                    continue
                s = _cosine(emb, g["emb"])
                if s >= link_thr:
                    pairs.append((s, lspk, gi))
        pairs.sort(reverse=True)
        mapped: dict = {}
        used_g: set = set()
        for s, lspk, gi in pairs:
            if lspk in mapped or gi in used_g:
                continue
            mapped[lspk] = gi
            used_g.add(gi)
            g = protos[gi]
            n = g["count"]
            emb = local_embs[lspk]
            g["emb"] = [(a * n + b) / (n + 1) for a, b in zip(g["emb"], emb)]
            g["count"] = n + 1
        for lspk, emb in local_embs.items():
            if lspk not in mapped:
                protos.append({"emb": list(emb) if emb is not None else None, "count": 1})
                mapped[lspk] = len(protos) - 1
        return mapped

    if chunk_sec <= 0 or total <= chunk_sec * 1.5:
        bounds = [(0.0, total)]
    else:
        # 块边界落在最静音处(±10s 搜索),不把一个人的话切在两块里;过短尾块并入上一块
        bounds = []
        t = 0.0
        while t < total - 0.1:
            target = t + chunk_sec
            if target >= total - chunk_sec * 0.25:
                cut = total
            else:
                cut = _quietest_cut(samples, sr, target, 10.0)
            bounds.append((t, cut))
            t = cut

    # 多块时每块自动聚类(强制每块凑 N 簇会造噪声簇/错并);最后由全局 merge-down 收敛到 num_speakers
    per_chunk_n = num_speakers if len(bounds) == 1 else 0

    global_turns: list[tuple[float, float, int]] = []
    for cs, ce in bounds:
        chunk = samples[int(cs * sr):int(ce * sr)]
        sd = _make_sd(per_chunk_n)
        res = sd.process(chunk).sort_by_start_time()
        local: dict[int, list[tuple[float, float]]] = {}
        for seg in res:
            local.setdefault(int(seg.speaker), []).append((float(seg.start), float(seg.end)))
        local_embs = {lspk: _embed_speaker(ext, sr, chunk, turns) for lspk, turns in local.items()}
        localmap = link_chunk(local_embs)
        for seg in res:
            g = localmap.get(int(seg.speaker))
            if g is not None:
                global_turns.append((cs + float(seg.start), cs + float(seg.end), g))

    # num_speakers 提示:全局簇多于目标则贪心合并最近的原型直到达标
    if num_speakers and num_speakers > 0 and len(protos) > num_speakers:
        remap = list(range(len(protos)))
        while len(set(remap)) > num_speakers:
            ids = sorted(set(remap))
            best = None
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    s = _cosine(protos[ids[i]]["emb"], protos[ids[j]]["emb"])
                    if best is None or s > best[0]:
                        best = (s, ids[i], ids[j])
            if not best:
                break
            _, keep, drop = best
            remap = [keep if x == drop else x for x in remap]
        global_turns = [(s, e, remap[g]) for (s, e, g) in global_turns]

    used = sorted({g for _, _, g in global_turns})
    relabel = {g: i for i, g in enumerate(used)}
    global_turns = [(s, e, relabel[g]) for (s, e, g) in global_turns]
    gemb = {f"SPEAKER_{relabel[g]:02d}": protos[g]["emb"] for g in used if protos[g]["emb"] is not None}
    return global_turns, gemb


def _diarize_diarizen(wav: str, num_speakers: int):
    """DiariZen 后端(独立 .venv-diar 子进程 · torch 栈与本进程 onnx 栈隔离)。
    选型依据:AliMeeting far DER 评测(eval/)碾压 sherpa FastClustering 路径。
    venv/模型缺失或失败 → None,调用方回退 sherpa(_diarize_global)。"""
    import subprocess

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    py = os.path.join(root, ".venv-diar", "Scripts", "python.exe")
    if not os.path.isfile(py):
        return None
    try:
        proc = subprocess.run(
            [py, "-m", "app.diar_diarizen", wav, str(num_speakers or 0)],
            cwd=root,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=int(os.environ.get("DIAR_TIMEOUT", "1800")),
        )
        if proc.returncode != 0 or not proc.stdout:
            sys.stderr.write(f"diarizen rc={proc.returncode}: {(proc.stderr or '')[-400:]}\n")
            return None
        out = json.loads(proc.stdout)
        if not out.get("ok"):
            sys.stderr.write(f"diarizen error: {out.get('error')}\n")
            return None
        turns = [(float(s), float(e), int(g)) for s, e, g in out.get("turns") or []]
        return turns or None
    except Exception as e:
        sys.stderr.write(f"diarizen exc: {e}\n")
        return None


def _embed_turns(samples, sr: int, turns):
    """对全局 turns 按说话人抽 CAM++ 声纹(声纹库/跨会匹配继续用同一向量空间,后端无关)。"""
    by: dict[int, list[tuple[float, float]]] = {}
    for s, e, g in turns:
        by.setdefault(int(g), []).append((float(s), float(e)))
    try:
        ext = _extractor()
    except Exception:
        return {}
    out = {}
    for g, ts in by.items():
        emb = _embed_speaker(ext, sr, samples, ts)
        if emb:
            out[f"SPEAKER_{g:02d}"] = emb
    return out


def _turn_at(turns, starts, mid: float):
    """时间点 mid 落在哪个说话人 turn 内;不在任何 turn 内 → 最近邻 turn。
    turns 按 start 升序,starts 为其 start 列表 → 二分定位(2 小时数万词 × 数千 turn 不再线性扫)。"""
    i = bisect.bisect_right(starts, mid)
    for j in range(i - 1, max(-1, i - 17), -1):  # 往回最多看 16 个(turn 可重叠)
        ts, te, g = turns[j]
        if ts <= mid <= te:
            return g
    best, bd = turns[0][2], None
    for j in (i - 1, i):
        if 0 <= j < len(turns):
            ts, te, g = turns[j]
            d = min(abs(mid - te), abs(ts - mid))
            if bd is None or d < bd:
                bd, best = d, g
    return best


def _split_by_speaker(segs, turns):
    """词级说话人归属:每个词按中点归到 turn,段内说话人变化处切开 → 短插话独立成段不被吞。
    三明治平滑(A,b,A → A,A,A 当 b 仅 1 词且 <0.5s)抵消词时间戳抖动。无词的段回退整段最大重叠归属。"""
    starts = [t[0] for t in turns]
    out = []
    for s in segs:
        words = s.get("words") or []
        if not words:
            best, best_ov = None, 0.0
            for ts, te, spk in turns:
                ov = min(s["end"], te) - max(s["start"], ts)
                if ov > best_ov:
                    best_ov, best = ov, spk
            if best is None:
                best = _turn_at(turns, starts, (s["start"] + s["end"]) / 2)
            s2 = dict(s)
            s2["speaker"] = f"SPEAKER_{best:02d}"
            out.append(s2)
            continue
        # 词级归属 → 连续同人成 run
        runs: list[list] = []  # [spk, [words]]
        for w in words:
            spk = _turn_at(turns, starts, (float(w["start"]) + float(w["end"])) / 2)
            if runs and runs[-1][0] == spk:
                runs[-1][1].append(w)
            else:
                runs.append([spk, [w]])
        # 三明治平滑
        i = 1
        while i < len(runs) - 1:
            spk, ws = runs[i]
            dur = float(ws[-1]["end"]) - float(ws[0]["start"])
            if len(ws) == 1 and dur < 0.5 and runs[i - 1][0] == runs[i + 1][0] and spk != runs[i - 1][0]:
                runs[i - 1][1].extend(ws)
                runs[i - 1][1].extend(runs[i + 1][1])
                del runs[i:i + 2]
            else:
                i += 1
        for spk, ws in runs:
            out.append(
                {
                    "start": float(ws[0]["start"]),
                    "end": float(ws[-1]["end"]),
                    "text": "".join(str(x["w"]) for x in ws).strip(),
                    "speaker": f"SPEAKER_{spk:02d}",
                    "words": ws,
                }
            )
    return out


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    wav = sys.argv[1]
    segs = json.load(open(sys.argv[2], encoding="utf-8"))
    num_speakers = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    do_diarize = (len(sys.argv) <= 4) or sys.argv[4] != "0"

    # 分离 + 词级切段(先切后标点:标点插字会破坏词↔文本对齐,顺序不可换)
    # 后端:MIAOJI_DIAR_BACKEND = auto(默认·DiariZen 优先缺则回退 sherpa) | diarizen | sherpa
    diarized = False
    speaker_embeddings: dict = {}
    try:
        if do_diarize:
            backend = os.environ.get("MIAOJI_DIAR_BACKEND", "auto").strip().lower()
            turns = None
            if backend in ("auto", "diarizen"):
                turns = _diarize_diarizen(wav, num_speakers)
                if turns:
                    samples, sr = _load_samples(wav)
                    speaker_embeddings = _embed_turns(samples, sr, turns)
                elif backend == "diarizen":
                    sys.stderr.write("diarizen backend unavailable (forced, no fallback)\n")
            if turns is None and backend != "diarizen":
                samples, sr = _load_samples(wav)
                turns, speaker_embeddings = _diarize_global(samples, sr, num_speakers)
            if turns:
                segs = _split_by_speaker(segs, turns)
                diarized = True
    except Exception as e:
        sys.stderr.write(f"diarize failed: {e}\n")

    # 标点(对切好的每段)
    try:
        p = _punctuator()
        if p:
            for s in segs:
                t = (s.get("text") or "").strip()
                if t:
                    s["text"] = str(p.add_punctuation(t))
    except Exception:
        pass

    speakers = []
    for s in segs:
        sp = s.get("speaker")
        if sp and sp not in speakers:
            speakers.append(sp)

    json.dump(
        {"ok": True, "diarized": diarized, "speakers": speakers,
         "speakerEmbeddings": speaker_embeddings, "embeddingModel": EMBED_MODEL_ID, "segments": segs},
        sys.stdout, ensure_ascii=False,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout, ensure_ascii=False)
