# -*- coding: utf-8 -*-
"""Fanxing cf-task payload builder."""

from typing import Dict, Iterable, Optional

from .image_url_service import normalize_fanxing_reference_image_url


CF_TASK_TYPE = "cf-task"

FEATURE_ID_EC_UPSCALE = "ecUpscale"
FEATURE_ID_PERSON_UPSCALE = "personUpscale"
FEATURE_ID_MATTING = "matting"

SUPPORTED_CF_TASK_FEATURES = {
    FEATURE_ID_EC_UPSCALE,
    FEATURE_ID_PERSON_UPSCALE,
    FEATURE_ID_MATTING,
}

_FEATURE_ALLOWED_PARAMS = {
    FEATURE_ID_EC_UPSCALE: {"upscaleNum", "denoise"},
    FEATURE_ID_PERSON_UPSCALE: {"upscaleNum", "denoise"},
    FEATURE_ID_MATTING: set(),
}

_DEFAULT_VIDEO_MEMORY = "24"
_FEATURE_DEFAULT_WORKFLOW_IDS = {
    FEATURE_ID_EC_UPSCALE: 5,
    FEATURE_ID_MATTING: 4,
}


def resolve_fanxing_source_image_url(
    image_urls: Optional[Iterable[str]], *, explicit_source_image: str = ""
) -> str:
    explicit = str(explicit_source_image or "").strip()
    if explicit:
        return explicit

    for url in list(image_urls or []):
        normalized = str(url or "").strip()
        if normalized:
            return normalized
    raise ValueError("cf-task 缺少 source_image，未找到可用参考图 URL")


def _normalize_cf_task_source_image(value: str) -> str:
    return normalize_fanxing_reference_image_url(value)


def normalize_cf_task_options(
    feature_id: str,
    feature_params: Optional[dict],
    image_urls: Optional[Iterable[str]] = None,
) -> Dict[str, object]:
    normalized_feature_id = str(feature_id or "").strip()
    if not normalized_feature_id:
        raise ValueError("cf-task 缺少 feature_id")
    if normalized_feature_id not in SUPPORTED_CF_TASK_FEATURES:
        raise ValueError(f"暂不支持的 cf-task feature_id: {normalized_feature_id}")

    raw_params = dict(feature_params or {})
    source_image = _normalize_cf_task_source_image(
        resolve_fanxing_source_image_url(
            image_urls,
            explicit_source_image=str(raw_params.get("source_image") or ""),
        )
    )
    normalized_inputs: Dict[str, object] = {
        "source_image": source_image,
    }

    allowed_params = _FEATURE_ALLOWED_PARAMS.get(normalized_feature_id, set())
    for key in allowed_params:
        value = raw_params.get(key)
        if value is None or value == "":
            continue
        normalized_inputs[key] = value

    workflow_id = None
    workflow_id_raw = raw_params.get("workflow_id")
    if workflow_id_raw not in (None, ""):
        try:
            workflow_id = int(workflow_id_raw)
        except Exception:
            workflow_id = None
    elif normalized_feature_id in _FEATURE_DEFAULT_WORKFLOW_IDS:
        workflow_id = int(_FEATURE_DEFAULT_WORKFLOW_IDS[normalized_feature_id])

    video_memory = str(raw_params.get("video_memory") or _DEFAULT_VIDEO_MEMORY).strip()
    if video_memory not in {"24", "32"}:
        video_memory = _DEFAULT_VIDEO_MEMORY

    result = {
        "model": normalized_feature_id,
        "inputs": normalized_inputs,
        "extra": {
            "video_memory": video_memory,
        },
    }
    if workflow_id is not None:
        result["workflow_id"] = workflow_id
    return result


def build_fanxing_cf_task_params(
    *,
    feature_id: str,
    feature_params: Optional[dict],
    image_urls: Optional[Iterable[str]],
) -> Dict[str, object]:
    normalized = normalize_cf_task_options(feature_id, feature_params, image_urls)
    return {
        "task_type": CF_TASK_TYPE,
        "input_params": dict(normalized),
    }


def get_supported_cf_task_feature_params(feature_id: str = "") -> Dict[str, tuple]:
    """Return a read-only snapshot of supported cf-task feature params."""
    target = str(feature_id or "").strip()
    if target:
        return {target: tuple(sorted(_FEATURE_ALLOWED_PARAMS.get(target, set())))}
    return {
        key: tuple(sorted(value or set()))
        for key, value in _FEATURE_ALLOWED_PARAMS.items()
    }


__all__ = [
    "CF_TASK_TYPE",
    "FEATURE_ID_EC_UPSCALE",
    "FEATURE_ID_PERSON_UPSCALE",
    "FEATURE_ID_MATTING",
    "SUPPORTED_CF_TASK_FEATURES",
    "build_fanxing_cf_task_params",
    "get_supported_cf_task_feature_params",
    "resolve_fanxing_source_image_url",
    "normalize_cf_task_options",
]
