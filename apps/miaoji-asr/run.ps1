# 妙记 ASR 微服务 — 启动脚本（Windows / PowerShell 7+）
# ============================================================================
# 用 uv 在 3.12 解释器上建专属 venv（ML wheels 尚不支持 3.14，故不能用系统 3.14）。
# uv 未安装时，参见文件尾的 plain venv 回退说明。
# ============================================================================

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# --- 配置默认值（可被外部 env 覆盖）---
if (-not $env:MIAOJI_ASR_HOST) { $env:MIAOJI_ASR_HOST = "0.0.0.0" }
if (-not $env:MIAOJI_ASR_PORT) { $env:MIAOJI_ASR_PORT = "9400" }

# --- 1) 建 venv（首次）---
if (-not (Test-Path ".venv")) {
    Write-Host "[miaoji-asr] creating venv with uv (python 3.12) ..."
    uv venv --python 3.12 .venv
}

# --- 2) 激活 ---
. .\.venv\Scripts\Activate.ps1

# --- 3) 装依赖 ---
# 注：torch 须匹配 CUDA（Blackwell/RTX 5090 用 cu128）。建议先单独装：
#   uv pip install torch --index-url https://download.pytorch.org/whl/cu128
# 再装其余（下行）。若已装好 torch，下行不会强制覆盖正确的 CUDA 版本。
Write-Host "[miaoji-asr] installing requirements ..."
uv pip install -r requirements.txt

# --- 4) 启动 ---
Write-Host "[miaoji-asr] starting on $($env:MIAOJI_ASR_HOST):$($env:MIAOJI_ASR_PORT) ..."
python -m uvicorn app.main:app --host $env:MIAOJI_ASR_HOST --port $env:MIAOJI_ASR_PORT

# ============================================================================
# uv 未安装时的回退（plain venv）：
#   py -3.12 -m venv .venv
#   .\.venv\Scripts\Activate.ps1
#   python -m pip install --upgrade pip
#   pip install torch --index-url https://download.pytorch.org/whl/cu128
#   pip install -r requirements.txt
#   python -m uvicorn app.main:app --host $env:MIAOJI_ASR_HOST --port $env:MIAOJI_ASR_PORT
#
# 安装 uv（任选其一）：
#   pip install uv
#   irm https://astral.sh/uv/install.ps1 | iex
# ============================================================================
