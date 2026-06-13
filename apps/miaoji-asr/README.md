# miaoji-asr — Wendao 自动语音识别微服务

Wendao 的 ASR 微服务：一个 Python FastAPI 服务，为 Wendao 提供**自动语音识别（ASR）+ 词级时间戳 + 说话人分离**。由 Node 后端经 HTTP 调用。

## 它是什么

- **主引擎**：[WhisperX](https://github.com/m-bain/whisperX) —— Whisper ASR + wav2vec2 词级对齐 + pyannote 说话人分离，一条龙正好覆盖本服务契约。
- **回落引擎**：WhisperX 不可导入时自动回落 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)（ASR + 词级时间戳，**无**对齐/分离）。
- 模型**首请求懒加载**（模块级单例）。设备 `cuda`（`torch.cuda.is_available()`）否则 `cpu`；`compute_type` cuda→`float16` / cpu→`int8`。
- ML 依赖缺失时服务**仍可启动**，`/health` 报告 `asrLoaded=false`，不崩溃。

## 运行环境（已核验）

- ML wheels（torch/whisperx/pyannote）目前普遍**尚不支持 Python 3.14**（较新系统默认 Python 可能已是 3.14）。故本服务必须在用 **3.11/3.12** 解释器创建的专属 venv 中运行。
- GPU：建议用一块 CUDA GPU（如 **RTX 4090 / 5090**）。新一代 Blackwell 卡（如 RTX 5090，sm_120）—— torch 需 CUDA 12.x 轮子（**cu128** 优先，cu124 亦可）。CPU 亦可跑（极慢，仅供调试）。
- ffmpeg 8.1.1 在 PATH（音频解码用）。

## 如何运行

```powershell
# 一键（uv 路径）
.\run.ps1
```

`run.ps1` 会：用 `uv venv --python 3.12 .venv` 建 venv → 激活 → `uv pip install -r requirements.txt` → 用 uvicorn 在 `$env:MIAOJI_ASR_HOST:$env:MIAOJI_ASR_PORT` 启动。

> **torch 须匹配 CUDA**：建议先单独装匹配 Blackwell 的轮子，再装其余依赖：
> ```powershell
> uv pip install torch --index-url https://download.pytorch.org/whl/cu128
> uv pip install -r requirements.txt
> ```

### uv 未安装时的回退（plain venv）

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
python -m uvicorn app.main:app --host $env:MIAOJI_ASR_HOST --port $env:MIAOJI_ASR_PORT
```

安装 uv：`pip install uv` 或 `irm https://astral.sh/uv/install.ps1 | iex`。

## 配置（环境变量）

| env | 默认 | 说明 |
|---|---|---|
| `MIAOJI_ASR_HOST` | `0.0.0.0` | 监听地址 |
| `MIAOJI_ASR_PORT` | `9400` | 监听端口 |
| `WHISPER_MODEL` | `large-v3` | Whisper 模型名 |
| `HF_TOKEN` | （无） | Hugging Face token，**说话人分离必需** |
| `ASR_DEVICE` | `auto` | `auto` / `cuda` / `cpu` |
| `ASR_COMPUTE_TYPE` | （自动） | 留空则 cuda→`float16` / cpu→`int8` |

### 说话人分离的前置条件

分离走 `pyannote/speaker-diarization-3.1`，需要：
1. 设置 `HF_TOKEN`；
2. 在 Hugging Face **接受该模型（及其依赖 `pyannote/segmentation-3.0`）的使用条款**。

若请求 `diarize=true` 但缺 token / pyannote 不可导入 / 加载失败 —— **优雅降级**：所有段 `speaker=null` 且 `engine.diarized=false`，**绝不崩溃**。

## API 契约（跨语言 SSOT — 字段名与 Node/TS 端逐字一致）

### `GET /health`

```json
{ "status": "ok", "asrLoaded": false, "diarizeAvailable": false, "device": "cuda" }
```

### `POST /transcribe`

请求：

```json
{ "audioPath": "/abs/path/16k-mono.wav", "language": "zh", "diarize": true, "numSpeakers": null }
```

- `language`：`"zh"` | `"en"` | `"ja"`
- `audioPath`：服务器本地**绝对路径**，指向 Node 端已产出的 16kHz 单声道 wav。
- 路径为空/非绝对/非文件 → `400`；不存在 → `404`；以清晰 JSON error 返回。

响应：

```json
{
  "language": "zh",
  "durationSec": 12.34,
  "speakers": ["SPEAKER_00", "SPEAKER_01"],
  "segments": [
    {
      "start": 0.0, "end": 3.2, "text": "你好世界", "speaker": "SPEAKER_00",
      "words": [ { "w": "你好", "start": 0.0, "end": 0.8, "score": 0.97 } ]
    }
  ],
  "engine": { "asrModel": "large-v3", "diarized": true, "deviceUsed": "cuda" }
}
```

- `start`/`end` 单位为秒。
- `words[].score` 可选（对齐模型给得出才有）；回落引擎用词级概率充当。
- `speakers` 为去重后的分离标签；未分离时为 `[]`。

## 文件结构

```
apps/miaoji-asr/
├── app/
│   ├── __init__.py
│   ├── config.py     # env 配置（模块级单例）
│   ├── engine.py     # 懒加载引擎：WhisperX 主 / faster-whisper 回落 / 分离 / 词→说话人归属
│   └── main.py       # FastAPI app + 端点 + pydantic v2 契约模型
├── requirements.txt
├── run.ps1
├── README.md
└── .gitignore
```

## 声纹模型（voiceprint embedding · models/ 不入 git · 换机需重下）

声纹库比对/录入用的嵌入模型。默认 **ERes2NetV2 zh-cn**(3D-Speaker · Apache-2.0 · 192 维 ·
实测 AliMeeting EER **4.00%** < CAM++ 5.28%,见 `eval/eer_compare.py`)。env `MIAOJI_VOICEPRINT_MODEL`
可切(文件名不含 .onnx);缺则按 eres2netv2_zh → campplus_zh → spk_embed 回退。

```bash
cd apps/miaoji-asr/models
# 默认(推荐):ERes2NetV2 zh-cn(71MB)
curl -L -o eres2netv2_zh.onnx \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx
# 回退:CAM++ 中文(28MB,旧默认)
# curl -L -o campplus_zh.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx
```

**换模型的铁律(已落地)**:不同模型的向量**不可跨比**(即便同 192 维)。每条声纹/会议说话人
都带 `embeddingModel` 标签,匹配只比同模型;换模型后旧声纹会失配,需重新录入(向量不通用)。
选型/EER 复核:`.venv/Scripts/python.exe eval/eer_compare.py <work> models/<model>.onnx`。

## 诚实的说明（未经实跑验证的部分）

- 本仓只构建并通过了**语法解析（AST）冒烟**。`import app.main` 在无 torch 环境下应成功（重型 import 全部在 engine 懒加载器内部），但**真正转写需要安装 torch + 下载模型**，这一步尚未执行。
- 首次请求会触发：Whisper 模型下载（`large-v3` 约数 GB）、wav2vec2 对齐模型下载、（如启用）pyannote 分离模型下载。需联网与磁盘空间。
- RTX 5090（Blackwell）需正确的 CUDA 12.x torch 轮子；CUDA/torch 版本不匹配会导致 `cuda` 不可用而自动回落 cpu（极慢）。
- WhisperX / pyannote 各版本间 API 偶有变动；引擎已对对齐失败、分离失败做了 try/except 降级，但不同版本组合的实际行为仍需在装好依赖后端到端验证。
