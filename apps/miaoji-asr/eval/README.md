# 闻道说话人分离评测台(diarization eval harness)

> 立 2026-06-12(主器令:「说话人真的太不准了·必须以最高标准最高要求解决」)。
> 以可量化 DER 在中文会议基准上选型,杜绝"感觉修好了"。

## 基准数据

**AliMeeting Eval 集**(openslr 119 · 阿里云 OSS 直下):8 场真实中文会议(2-4 人,远场 8 麦阵列),
带人工 TextGrid 说话人标注。预处理取 ch0 转 16k 单声道——与闻道实际输入(录音笔/手机单声道)同构。

数据与产物在 `tmp/wendao/diar-eval/`(不入 git):`wav/` `ref/` `hyp_*/`。

## 跑法

```powershell
# 1. 数据准备(wav 转换可用产线 venv --wav-only;RTTM 要 .venv-diar 的 textgrid)
.venv-diar/Scripts/python.exe eval/prepare_alimeeting.py <Eval_Ali 根> <work>

# 2. 现状基线(sherpa-onnx pyannote-seg3 + CAM++ + FastClustering · 产线 venv)
.venv/Scripts/python.exe eval/run_sherpa_baseline.py <work>/wav <work>/hyp_sherpa 0

# 3. DiariZen 候选(.venv-diar)
.venv-diar/Scripts/python.exe eval/run_diarizen.py <work>/wav <work>/hyp_diarizen_base

# 4. DER 评分(自含实现:帧级 10ms + Hungarian;strict 与 collar 0.25 双口径)
.venv-diar/Scripts/python.exe eval/score_der.py <work>/ref <work>/hyp_sherpa <work>/hyp_diarizen_base
```

## 候选与许可证红线(产线只许可商用)

| 方案 | 许可 | 可入产线 | 备注 |
|---|---|---|---|
| sherpa-onnx seg3+CAM++(现状) | Apache-2.0 | ✔ | AliMeeting 实测 2-4 人会聚出 8-9 人(过分裂) |
| **DiariZen meeting-base** | **MIT** | ✔ | WavLM-base EEND + wespeaker 聚类 |
| DiariZen wavlm-{base,large}-s80-md(-v2) | CC-BY-NC-4.0 | ✘ 禁商用 | 仅评测参照(官方 AliMeeting far 10.8-14.1) |
| pyannote community-1 | MIT | ✔ 但 HF gated | 需在 Hugging Face 接受模型条款并用有 gated-repo 读权限的 token(`HF_TOKEN`) |
| NeMo Sortformer | 开放 | ✘ | ≤4 说话人硬上限,不适配会议 |

## 产线接线

- 后端开关:`MIAOJI_DIAR_BACKEND` = `auto`(默认·DiariZen 优先,venv/模型缺则回退 sherpa)| `diarizen` | `sherpa`
- DiariZen 跑在独立 `.venv-diar`(torch cu128 栈),由 `app/diar_punct.py` 子进程调 `app/diar_diarizen.py`
- 声纹向量仍用 CAM++ 抽取(`_embed_turns`),声纹库/跨会匹配向量空间不变
- 模型缓存 `models/hf-cache`(HF_HOME),首跑后离线可用

## 结果(2026-06-12 实测 · AliMeeting Eval far 8 会 · DER%)

| session | sherpa 现状 strict/collar | DiariZen base strict/collar |
|---|---|---|
| R8001_M8004 | 33.80 / 26.27 | 17.79 / 11.66 |
| R8003_M8001 | 19.63 / 10.09 | 14.41 / 7.60 |
| R8007_M8010 | 39.84 / 32.77 | 29.82 / 22.88 |
| R8007_M8011 | 22.75 / 11.26 | 14.46 / 6.37 |
| R8008_M8013 | 23.43 / 12.40 | 14.16 / 5.99 |
| R8009_M8018 | 12.12 / 3.76 | 8.63 / 2.01 |
| R8009_M8019 | 12.73 / 4.88 | 4.56 / 0.79 |
| R8009_M8020 | 10.70 / 2.67 | 4.60 / 0.45 |
| **TOTAL** | **23.55 / 13.43** | **14.98 / 7.57**(相对降 36%/44%) |

说话人数:sherpa 在 2-4 人会聚出 3-9 人(过分裂);DiariZen 8 场全部数对。
速度:30min 会 sherpa 120-190s(CPU) vs DiariZen 22-30s(5090)。
八场全胜 → 产线后端切 DiariZen meeting-base(auto 回退 sherpa 保底)。
天花板参照(NC 禁商用 · 不入产线):wavlm-large-s80-md-v2 = 11.44/4.70——
将来若过 pyannote community-1(MIT·gated)门禁或 NC 方案换许可,还有 ~3.5pt 空间。

## 全球对标 + 调参杠杆(2026-06-12 联网调研 · 长会议同人分裂/噪声簇治理)

**结论**:meeting-base(MIT)是「可商用许可」里的顶级方案,没有更好的可商用替代。
准确率绝对天花板 DiariZen-large-s80-v2(DER 10.8)与 pyannote precision-2(API 付费)
均**不可商用或要付费**。可商用候选里 3D-Speaker(Apache·~19.7)、pyannote community-1
(CC-BY·20.3)都比 meeting-base 差近 2 倍。

**长会议「同人被分成两簇 + 噪声簇」是过聚类,靠调参而非换模型**(研究实证杠杆):
1. **已知人数传 num_speakers**——最大杠杆,相对降 DER **37-43%**。链路已通:
   上传框「说话人数」→ minute.numSpeakers → run.ts → ASR → diar_diarizen 的
   `pipe.min_speakers = pipe.max_speakers = N`。**多人会议务必填**。
2. `min_cluster_size`(meeting-base 默认 30)抑噪声簇;`max_speakers`(默认 8)封顶。
3. AHC `ahc_threshold`(默认 0.7)调高→更易合并→治同人分裂。
4. 实证:同一 2h 会议旧 sherpa 8 人(徐老师分裂+5 噪声簇)→ DiariZen meeting-base
   自动 4 人干净簇(116s GPU)。

**未来升级两条路**(都要先动资金/过门禁,挂待办):① 过 pyannote community-1 的 HF
gate(需 HF 账号网页 accept terms 后换有 gated 读权限的 token);② 拿自有标注会议
音频**微调 DiariZen 的 MIT 代码**产出自有权重——同时拿到 SOTA 精度 + 干净许可,
是最高价值路径。

## .venv-diar 重建(换机/重装)

```powershell
cd apps/miaoji-asr
py -V:Astral/CPython3.12.13 -m venv .venv-diar   # 任一 CPython 3.12
.venv-diar/Scripts/python.exe -m pip install "torch==2.8.0" "torchaudio==2.8.0" --index-url https://download.pytorch.org/whl/cu128
git clone --depth 1 https://github.com/BUTSpeechFIT/DiariZen.git <tmp>/diarizen-src
.venv-diar/Scripts/python.exe -m pip install "<tmp>/diarizen-src"            # diarizen 包
.venv-diar/Scripts/python.exe -m pip install --no-deps --force-reinstall "<tmp>/diarizen-src/pyannote-audio"  # 其 pyannote fork(3.1.1)
.venv-diar/Scripts/python.exe -m pip install "numpy==1.26.4" "speechbrain==1.0.0" toml psutil accelerate soundfile librosa textgrid scipy
# 首跑自动下模型到 models/hf-cache(HF_HOME);无门禁
```

坑(实证):① torch≥2.6 weights_only 拦 checkpoint 元数据类 → 代码内白名单 TorchVersion/Specifications/Problem/Resolution;
② speechbrain>1.0 惰性导入扫 k2(Windows 无轮子)→ 钉 1.0.0;③ numpy 2.x 撞 fork 的 np.NaN → 钉 1.26.4;
④ DiariZen/pyannote 往 stdout 打配置 → diar_diarizen.py 工作期 stdout 重定向 stderr,JSON 走真 stdout。
