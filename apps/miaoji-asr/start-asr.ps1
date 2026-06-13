# Miaoji ASR microservice - resident startup script (user-level autostart, no UAC)
# ============================================================================
# Unlike run.ps1, this ONLY starts the service (no venv create, no dep install).
# Invoked by login autostart (see Startup folder shortcut).
# GPU (large-v3) mode; ctranslate2 uses 5090 via cudnn/cublas DLLs.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as system codepage; CJK would corrupt parsing.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) { throw "venv missing: $venvPy (install deps per run.ps1 first)" }

# runtime params (overridable via env)
if (-not $env:MIAOJI_ASR_HOST)   { $env:MIAOJI_ASR_HOST   = '0.0.0.0' }
if (-not $env:MIAOJI_ASR_PORT)   { $env:MIAOJI_ASR_PORT   = '9400' }
if (-not $env:ASR_DEVICE)        { $env:ASR_DEVICE        = 'cuda' }   # 5090; auto-fallback to cpu if unavailable
if (-not $env:WHISPER_MODEL)     { $env:WHISPER_MODEL     = 'large-v3' }

# register GPU DLL dirs (cudnn/cublas) on PATH for ctranslate2 GPU inference
$nv = Join-Path $PSScriptRoot '.venv\Lib\site-packages\nvidia'
foreach ($sub in 'cudnn','cublas','cuda_runtime') {
    $bin = Join-Path $nv "$sub\bin"
    if (Test-Path $bin) { $env:PATH = "$bin;$env:PATH" }
}

# idempotent: skip if port already listening
$inUse = Get-NetTCPConnection -State Listen -LocalPort ([int]$env:MIAOJI_ASR_PORT) -ErrorAction SilentlyContinue
if ($inUse) { Write-Host "[miaoji-asr] port $($env:MIAOJI_ASR_PORT) already listening, skip"; return }

Write-Host "[miaoji-asr] starting on $($env:MIAOJI_ASR_HOST):$($env:MIAOJI_ASR_PORT) (device=$($env:ASR_DEVICE), model=$($env:WHISPER_MODEL)) ..."
& $venvPy -m uvicorn app.main:app --host $env:MIAOJI_ASR_HOST --port $env:MIAOJI_ASR_PORT
