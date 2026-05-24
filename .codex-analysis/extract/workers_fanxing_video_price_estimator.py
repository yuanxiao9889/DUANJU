# -*- coding: utf-8 -*-
"""Price estimation client for fanxing/API-SYS video generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict

import requests

from managers.billing.price_resolver import yuan_to_points
from workers.channel_protocols import AuthContext, HuanyuApiSysProtocol

from .video_model_mapping import (
    normalize_fanxing_video_duration,
    normalize_fanxing_video_resolution,
    resolve_fanxing_video_max_price_ceiling_per_sec,
    resolve_fanxing_video_submit_model,
)


@dataclass(frozen=True)
class FanxingVideoPriceEstimate:
    ok: bool
    model: str = ""
    resolution: str = ""
    output_sec: int = 0
    max_user_price: str = ""
    points: int = 0
    error_message: str = ""
    raw_response: Dict[str, Any] = field(default_factory=dict)


def estimate_fanxing_video_max_price(
    *,
    auth: AuthContext,
    model: str,
    resolution: str,
    output_sec: int,
    timeout: float = 10.0,
    session=None,
) -> FanxingVideoPriceEstimate:
    """Query the API-SYS video max-price endpoint.

    The returned value is a worst-case upper bound, not the final charge.
    """
    try:
        submit_model = resolve_fanxing_video_submit_model(model)
        normalized_resolution = normalize_fanxing_video_resolution(
            submit_model, resolution
        )
        normalized_output_sec = normalize_fanxing_video_duration(
            submit_model, output_sec
        )
    except Exception as exc:
        return FanxingVideoPriceEstimate(
            ok=False,
            error_message=str(exc),
        )

    protocol = HuanyuApiSysProtocol()
    url = protocol.build_video_routes(auth).max_price
    headers = protocol.build_headers(auth, include_json_content_type=False)
    params = {
        "model": submit_model,
        "resolution": normalized_resolution,
        "output_sec": normalized_output_sec,
    }
    http = session or requests

    try:
        response = http.get(url, headers=headers, params=params, timeout=timeout)
        response.raise_for_status()
        body = response.json()
    except Exception as exc:
        return FanxingVideoPriceEstimate(
            ok=False,
            model=submit_model,
            resolution=normalized_resolution,
            output_sec=normalized_output_sec,
            error_message=str(exc),
        )

    if not isinstance(body, dict):
        return FanxingVideoPriceEstimate(
            ok=False,
            model=submit_model,
            resolution=normalized_resolution,
            output_sec=normalized_output_sec,
            error_message="video max_price response must be a JSON object",
        )

    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    success = _is_success_response(body)
    max_user_price = str(data.get("max_user_price") or "").strip()
    if not success or not max_user_price:
        return FanxingVideoPriceEstimate(
            ok=False,
            model=str(data.get("model") or submit_model).strip(),
            resolution=str(data.get("resolution") or normalized_resolution).strip(),
            output_sec=_safe_int(data.get("output_sec"), normalized_output_sec),
            error_message=_extract_error_message(body),
            raw_response=body,
        )

    return FanxingVideoPriceEstimate(
        ok=True,
        model=str(data.get("model") or submit_model).strip(),
        resolution=str(data.get("resolution") or normalized_resolution).strip(),
        output_sec=_safe_int(data.get("output_sec"), normalized_output_sec),
        max_user_price=max_user_price,
        points=yuan_to_points(max_user_price),
        raw_response=body,
    )


def infer_video_markup_rate_from_max_price(
    *,
    model: str,
    resolution: str,
    output_sec: int,
    max_user_price,
) -> float:
    """Infer server video markup from the documented max_price formula.

    The value is used only as the server-side multiplier for the local official
    pricing calculator; the max_price amount itself remains a conservative
    server upper bound and is not shown as the sidebar estimate.
    """
    submit_model = resolve_fanxing_video_submit_model(model)
    normalized_resolution = normalize_fanxing_video_resolution(submit_model, resolution)
    normalized_output_sec = normalize_fanxing_video_duration(submit_model, output_sec)
    try:
        amount = float(max_user_price)
    except Exception as exc:
        raise ValueError("invalid video max_price amount") from exc
    ceiling = resolve_fanxing_video_max_price_ceiling_per_sec(
        submit_model,
        normalized_resolution,
    )
    denominator = float(ceiling) * float(normalized_output_sec)
    if amount <= 0 or denominator <= 0:
        raise ValueError("invalid video markup inference inputs")
    return amount / denominator


def _is_success_response(body: Dict[str, Any]) -> bool:
    if body.get("success") is False:
        return False
    code = body.get("code")
    if code is None:
        return True
    try:
        return int(code) == 0
    except Exception:
        return str(code).strip() in {"0", "ok", "success"}


def _extract_error_message(body: Dict[str, Any]) -> str:
    for key in ("msg", "message", "error", "error_message"):
        value = body.get(key)
        if value:
            return str(value).strip()
    return "video max_price query failed"


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default or 0)
