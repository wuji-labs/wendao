"""环境配置 — 全部从 env 读取，带合理默认值。

跨语言 SSOT：字段名与 Node/TS 端契约一致；本文件只管服务自身的运行参数。
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    """读取字符串型 env，空字符串视为未设置（回落默认）。"""
    val = os.environ.get(name)
    if val is None or val.strip() == "":
        return default
    return val.strip()


def _env_optional(name: str) -> str | None:
    """读取可选 env，未设置返回 None（用于 HF_TOKEN 这类敏感且非必需的值）。"""
    val = os.environ.get(name)
    if val is None or val.strip() == "":
        return None
    return val.strip()


@dataclass(frozen=True)
class Settings:
    """服务运行设置。frozen 保证启动后不可变。"""

    host: str
    port: int
    whisper_model: str
    hf_token: str | None
    # device 选择：auto / cuda / cpu。auto 时由 engine 探测 torch.cuda 决定。
    asr_device: str
    # compute_type：留空则 engine 按设备自动决定（cuda→float16 / cpu→int8）。
    asr_compute_type: str | None


def load_settings() -> Settings:
    """从环境变量装载一份 Settings。"""
    port_raw = _env("MIAOJI_ASR_PORT", "9400")
    try:
        port = int(port_raw)
    except ValueError:
        # 端口配错时不静默吞掉，落回默认并保证可启动。
        port = 9400

    return Settings(
        host=_env("MIAOJI_ASR_HOST", "0.0.0.0"),
        port=port,
        whisper_model=_env("WHISPER_MODEL", "large-v3"),
        hf_token=_env_optional("HF_TOKEN"),
        asr_device=_env("ASR_DEVICE", "auto").lower(),
        asr_compute_type=_env_optional("ASR_COMPUTE_TYPE"),
    )


# 模块级单例：进程启动时读一次即可。
settings: Settings = load_settings()
