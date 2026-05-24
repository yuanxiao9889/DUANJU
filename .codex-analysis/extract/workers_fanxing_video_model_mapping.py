# -*- coding: utf-8 -*-
"""Model-name mapping for fanxing/API-SYS video generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class FanxingVideoModelOption:
    display_name: str
    submit_model: str
    price_model: str
    max_price_ceiling_per_sec: dict[str, float]
    aliases: tuple[str, ...]
    resolutions: tuple[str, ...]
    ratios: tuple[str, ...]
    durations: tuple[int, ...]
    default_resolution: str
    default_ratio: str
    default_duration: int


_COMMON_RATIOS = ("16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive")
_COMMON_DURATIONS = (4, 5, 8, 10, 12, 15)
DEFAULT_MAX_PRICE_CEILING_PER_SEC = 8.00

_MODEL_OPTIONS = (
    FanxingVideoModelOption(
        display_name="Seedance-2",
        submit_model="SD-Video-2",
        price_model="doubao-seedance-2.0",
        max_price_ceiling_per_sec={
            "480p": DEFAULT_MAX_PRICE_CEILING_PER_SEC,
            "720p": DEFAULT_MAX_PRICE_CEILING_PER_SEC,
            "1080p": DEFAULT_MAX_PRICE_CEILING_PER_SEC,
        },
        aliases=("Seedance 2.0", "Seedance 2"),
        resolutions=("480p", "720p", "1080p"),
        ratios=_COMMON_RATIOS,
        durations=_COMMON_DURATIONS,
        default_resolution="720p",
        default_ratio="16:9",
        default_duration=5,
    ),
    FanxingVideoModelOption(
        display_name="Seedance-2-fast",
        submit_model="SD-Video-2-fast",
        price_model="doubao-seedance-2.0-fast",
        max_price_ceiling_per_sec={
            "480p": DEFAULT_MAX_PRICE_CEILING_PER_SEC,
            "720p": DEFAULT_MAX_PRICE_CEILING_PER_SEC,
        },
        aliases=("Seedance 2.0 Fast", "Seedance 2 Fast"),
        resolutions=("480p", "720p"),
        ratios=_COMMON_RATIOS,
        durations=_COMMON_DURATIONS,
        default_resolution="720p",
        default_ratio="16:9",
        default_duration=5,
    ),
)

_MODEL_LOOKUP = {}
for _option in _MODEL_OPTIONS:
    _MODEL_LOOKUP[_option.display_name.lower()] = _option
    _MODEL_LOOKUP[_option.submit_model.lower()] = _option
    for _alias in _option.aliases:
        _MODEL_LOOKUP[str(_alias or "").strip().lower()] = _option


def get_fanxing_video_model_options() -> List[FanxingVideoModelOption]:
    return list(_MODEL_OPTIONS)


def resolve_fanxing_video_model_option(value: str) -> FanxingVideoModelOption:
    key = str(value or "").strip().lower()
    if key in _MODEL_LOOKUP:
        return _MODEL_LOOKUP[key]
    raise ValueError(f"unsupported fanxing video model: {value}")


def resolve_fanxing_video_submit_model(value: str) -> str:
    return resolve_fanxing_video_model_option(value).submit_model


def resolve_fanxing_video_price_model(value: str) -> str:
    """Return the local official-pricing rule key for this fanxing model."""
    return resolve_fanxing_video_model_option(value).price_model


def resolve_fanxing_video_max_price_ceiling_per_sec(
    value: str,
    resolution: str,
) -> float:
    option = resolve_fanxing_video_model_option(value)
    normalized_resolution = normalize_fanxing_video_resolution(
        option.submit_model,
        resolution,
    )
    return float(
        option.max_price_ceiling_per_sec.get(
            normalized_resolution,
            DEFAULT_MAX_PRICE_CEILING_PER_SEC,
        )
    )


def is_supported_fanxing_video_model(value: str) -> bool:
    key = str(value or "").strip().lower()
    return bool(key and key in _MODEL_LOOKUP)


def normalize_fanxing_video_resolution(model: str, resolution: str) -> str:
    option = resolve_fanxing_video_model_option(model)
    value = str(resolution or "").strip()
    if value in option.resolutions:
        return value
    return option.default_resolution


def normalize_fanxing_video_ratio(model: str, ratio: str) -> str:
    option = resolve_fanxing_video_model_option(model)
    value = str(ratio or "").strip()
    if value in option.ratios:
        return value
    return option.default_ratio


def normalize_fanxing_video_duration(model: str, duration) -> int:
    option = resolve_fanxing_video_model_option(model)
    try:
        value = int(duration)
    except Exception:
        value = option.default_duration
    if value in option.durations:
        return value
    return option.default_duration
