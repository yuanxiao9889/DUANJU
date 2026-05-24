# -*- coding: utf-8 -*-
"""Payload builder for fanxing/API-SYS video generation tasks."""

from __future__ import annotations

from typing import Any, Dict, List

from workers.video_protocols.models import (
    VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_FIRST_FRAME,
    VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_LAST_FRAME,
    VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_FIRST_LAST,
    VIDEO_INPUT_MODE_MULTIMODAL_REFERENCE,
    VIDEO_INPUT_MODE_TEXT_TO_VIDEO,
    VideoTaskParams,
)

from .video_constants import (
    FANXING_VIDEO_INPUT_MODE_I2V,
    FANXING_VIDEO_INPUT_MODE_MULTIMODAL,
    FANXING_VIDEO_INPUT_MODE_T2V,
    FANXING_VIDEO_TASK_TYPE,
)
from .video_model_mapping import (
    normalize_fanxing_video_duration,
    normalize_fanxing_video_ratio,
    normalize_fanxing_video_resolution,
    resolve_fanxing_video_submit_model,
)


def build_fanxing_video_task_payload(params: VideoTaskParams) -> Dict[str, Any]:
    """Build an API-SYS ``sk-video`` task payload from normalized params."""
    if not isinstance(params, VideoTaskParams):
        params = VideoTaskParams.from_mapping(params or {})
    params.validate()

    submit_model = resolve_fanxing_video_submit_model(params.model)
    input_params: Dict[str, Any] = {
        "model": submit_model,
        "input_mode": _resolve_fanxing_input_mode(params.input_mode),
        "prompt": str(params.prompt or "").strip(),
        "resolution": normalize_fanxing_video_resolution(
            submit_model, params.resolution
        ),
        "duration": normalize_fanxing_video_duration(submit_model, params.duration),
        "ratio": normalize_fanxing_video_ratio(submit_model, params.ratio),
    }

    if params.generate_audio is not None:
        input_params["generate_audio"] = bool(params.generate_audio)

    _apply_mode_inputs(input_params, params)
    _apply_optional_extra_fields(input_params, params)

    return {
        "task_type": FANXING_VIDEO_TASK_TYPE,
        "input_params": _prune_empty_values(input_params),
    }


def _resolve_fanxing_input_mode(input_mode: str) -> str:
    mode = str(input_mode or "").strip()
    if mode == VIDEO_INPUT_MODE_TEXT_TO_VIDEO:
        return FANXING_VIDEO_INPUT_MODE_T2V
    if mode in {
        VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_FIRST_FRAME,
        VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_LAST_FRAME,
        VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_FIRST_LAST,
    }:
        return FANXING_VIDEO_INPUT_MODE_I2V
    if mode == VIDEO_INPUT_MODE_MULTIMODAL_REFERENCE:
        return FANXING_VIDEO_INPUT_MODE_MULTIMODAL
    raise ValueError(f"unsupported fanxing video input_mode: {mode}")


def _apply_mode_inputs(input_params: Dict[str, Any], params: VideoTaskParams) -> None:
    mode = str(params.input_mode or "").strip()
    if mode == VIDEO_INPUT_MODE_TEXT_TO_VIDEO:
        return

    if mode == VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_FIRST_FRAME:
        input_params["first_frame_url"] = str(params.first_frame_image or "").strip()
        return

    if mode == VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_LAST_FRAME:
        input_params["last_frame_url"] = str(params.last_frame_image or "").strip()
        return

    if mode == VIDEO_INPUT_MODE_IMAGE_TO_VIDEO_FIRST_LAST:
        input_params["first_frame_url"] = str(params.first_frame_image or "").strip()
        input_params["last_frame_url"] = str(params.last_frame_image or "").strip()
        return

    if mode == VIDEO_INPUT_MODE_MULTIMODAL_REFERENCE:
        image_urls = _normalize_url_list(params.reference_images)
        video_urls = _normalize_url_list(params.reference_videos)
        audio_urls = _normalize_url_list(params.reference_audios)
        if image_urls:
            input_params["image_urls"] = image_urls
        if video_urls:
            input_params["video_urls"] = video_urls
        if audio_urls:
            input_params["audio_urls"] = audio_urls
        return

    raise ValueError(f"unsupported fanxing video input_mode: {mode}")


def _apply_optional_extra_fields(
    input_params: Dict[str, Any], params: VideoTaskParams
) -> None:
    extras = dict(params.extra_options or {})
    for key in ("real_person_mode", "web_search"):
        if key in extras:
            input_params[key] = extras.get(key)


def _normalize_url_list(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item or "").strip() for item in value if str(item or "").strip()]
    item = str(value or "").strip()
    return [item] if item else []


def _prune_empty_values(value: Any) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            pruned = _prune_empty_values(item)
            if pruned is None or pruned == "" or pruned == [] or pruned == {}:
                continue
            result[key] = pruned
        return result
    if isinstance(value, list):
        result = []
        for item in value:
            pruned = _prune_empty_values(item)
            if pruned is None or pruned == "" or pruned == [] or pruned == {}:
                continue
            result.append(pruned)
        return result
    return value
