<div align="center">

# 闻道 · Wendao

**完全自托管的会议 / 音视频转写 —— 说话人分离 + AI 智能纪要。**

隐私优先,对标飞书妙记 / Otter.ai 的自托管替代：你的录音、你的算力、你的数据。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/wuji-labs/wendao/actions/workflows/ci.yml/badge.svg)](https://github.com/wuji-labs/wendao/actions/workflows/ci.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · 简体中文

</div>

> [!NOTE]
> 闻道全程跑在你自己的机器上：转写用本机 GPU 上的 Whisper 系开源模型,智能纪要用本机 [Ollama](https://ollama.com)。录音、转写、会议内容不出你的服务器。

<p align="center">
  <img src="docs/assets/transcript-detail.png" alt="闻道转写详情 —— 词级卡拉 OK 高亮、说话人分离、同步播放、AI 智能纪要" width="100%">
  <br/>
  <em>转写详情：词级卡拉 OK 高亮、说话人分离、同步播放、按需 AI 智能纪要 —— 全程自托管。</em>
</p>

<p align="center">
  <img src="docs/assets/library.png" alt="闻道资料库 —— 文件夹、搜索、处理状态" width="100%">
  <br/>
  <em>资料库：文件夹、全文搜索、处理状态一目了然。</em>
</p>

## ✨ 功能

- **🎙️ 上传即转写**：上传音频 / 视频,自动语音识别,输出带**词级时间戳**的转写。
- **🗣️ 说话人分离**：声纹聚类区分说话人,可把「说话人 1」重命名为真名,并把句段重新归属。
- **▶️ 同步播放**：点转写任意词跳到对应位置;播放时词级卡拉 OK 高亮;倍速、跳空白、字幕、双语字幕。
- **🤖 AI 智能纪要(本机 LLM)**：按需生成整体总结 + 要点 + 风险、章节划分、待办抽取(含责任人)、自动标题 —— 全部带**可点击的原文溯源**。
- **💬 与转写对话**：基于录音内容问答,答案带引用行号。
- **🤝 协作**：划重点、句段评论、可分享片段、链接权限范围。
- **✍️ 编辑**：直接改转写文本、整理段落。
- **🌐 翻译**：中 / 英 / 日 互译,双语转写。
- **📊 组织与统计**：文件夹、全文搜索、转写内搜索;每人发言时长 / 占比 / 字数、访问 / 评论统计。
- **📤 导出**：TXT / SRT / Markdown / DOCX(说话人、时间戳可选)。

> 智能纪要是**按需生成**(非阻塞流水线步骤),所以句段化一完成转写即可用,LLM 不拖慢转写。

## 🏗️ 架构

五个工作区包(pnpm + Turborepo):

| 包                          | 职责                                                 | 端口 |
| --------------------------- | ---------------------------------------------------- | ---- |
| `apps/miaoji`               | Next.js 16 / React 19 前端                           | 3101 |
| `packages/miaoji-api`       | Fastify 5 + tRPC v11 + Drizzle 后端(含流水线 worker) | 3100 |
| `apps/miaoji-asr`           | Python FastAPI ASR + 说话人分离微服务                | 9400 |
| `packages/miaoji-contracts` | 共享 Zod schema —— 跨语言类型唯一源头                | —    |
| `packages/miaoji-web-ui`    | 共享 React UI 组件                                   | —    |

> 目录 / 包代码名为 `miaoji`,产品名为**闻道**,一一对应。

完整设计见 **[docs/architecture.md](docs/architecture.md)**。

## 🚀 快速开始

### 前置依赖

- **Node** ≥ 20、**pnpm** ≥ 9(`corepack enable`)
- **PostgreSQL** 16(已附 Docker Compose)
- `PATH` 中有 **ffmpeg** / **ffprobe**
- **[Ollama](https://ollama.com)** 并已拉模型(默认 `qwen3:30b-a3b`)—— 用于智能纪要 / 翻译 / 问答
- 转写需 **Python 3.11/3.12** 和 **CUDA GPU**(CPU 可跑但慢),详见 [`apps/miaoji-asr/README.md`](apps/miaoji-asr/README.md)。

### 用 Docker Compose 运行

```bash
git clone https://github.com/wuji-labs/wendao.git
cd wendao
# 把 .env.example 复制为 .env 并按需调整(详见 docs/configuration.md)。

# Node 栈(postgres + api + worker + web)
docker compose up -d postgres api worker web
docker compose exec api pnpm -F @wuji/miaoji-api db:migrate

# GPU 的 ASR 服务可选,用 profile 单独拉起(需 NVIDIA runtime):
# docker compose --profile asr up -d asr
```

打开 <http://localhost:3101>。

完整自托管指南见 **[docs/self-hosting.md](docs/self-hosting.md)**,配置项参考见 **[docs/configuration.md](docs/configuration.md)**。

## 🔄 工作原理

每次上传走一条状态机:

```
UPLOADING → TRANSCODING(ffmpeg) → TRANSCRIBING(ASR) → DIARIZING → SEGMENTING → READY
```

之后由本机 LLM 按需生成智能纪要(总结 / 章节 / 待办)。LLM 不可用时转写仍可用,AI 功能优雅降级;说话人分离后端缺失时,也照样输出无说话人标签的完整转写。

## ⚠️ 现状与边界

闻道处于 **1.0 之前**,面向自托管 / 可信网络场景。公网部署前请注意:

- **鉴权刻意做得极简** —— 仅一个 `x-user-id` 头,适合可信局域网。**对公网暴露前请在前面加真正的鉴权 / 反向代理。**
- **界面目前仅简体中文**。英文 / i18n 是非常欢迎的高价值贡献,见 [docs/roadmap.md](docs/roadmap.md)。
- 代码注释中英混合(项目源自中文团队)。
- ASR 模型首次使用时下载,实用速度需 CUDA GPU。

## 🤝 参与贡献

欢迎任意规模的贡献,见 **[CONTRIBUTING.md](CONTRIBUTING.md)**,并请阅读 **[行为准则](CODE_OF_CONDUCT.md)**。安全问题请走 **[SECURITY.md](SECURITY.md)**(勿提公开 issue)。

## 📜 许可

[MIT](LICENSE) © 2026 WUJI (wuji-labs)。

> **模型许可另计。** 默认分离路径(`DiariZen meeting-base`)为 MIT,但部分可选 DiariZen 权重为 **CC-BY-NC-4.0(禁商用)**,pyannote 需用 Hugging Face token 接受其条款。商用前请阅读 **[docs/diarization-and-models.md](docs/diarization-and-models.md)**。

<div align="center">

由 **WUJI Labs** 用心打造。

</div>
