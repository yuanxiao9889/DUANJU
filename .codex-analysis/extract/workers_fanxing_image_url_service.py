# -*- coding: utf-8 -*-
"""Shared fanxing image upload/cache URL resolver."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Callable, Mapping, Optional, Tuple
from urllib.parse import urlsplit

import requests

from managers.config_manager import configure_requests_session, get_active_config_manager
from managers.logging_manager import redact_url_for_log, redact_value_for_log
from workers.channel_protocols import AuthContext, HuanyuApiSysProtocol
from workers.channel_protocols.auth_context import build_auth_context_from_config
from .image_cache import FanxingImageCache
from utils.api_error_mapper import extract_api_error, classify_runtime_issue
from utils.image_processing import (
    compress_image_for_filesize_high_quality,
    validate_image_bytes,
)
from utils.request_trace import format_request_trace


_PROTOCOL = HuanyuApiSysProtocol()
_FORMAT_TO_MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "JPG": "image/jpeg",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "BMP": "image/bmp",
}
_FORMAT_TO_EXTENSION = {
    "PNG": "png",
    "JPEG": "jpg",
    "JPG": "jpg",
    "WEBP": "webp",
    "GIF": "gif",
    "BMP": "bmp",
}
_UPLOAD_STAGE_LABELS = {
    "presign": "获取上传地址",
    "put": "上传图片文件",
    "confirm": "确认上传结果",
}


_FANXING_SINGLE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
_FANXING_TOTAL_IMAGE_MAX_BYTES = 40 * 1024 * 1024
_FANXING_BATCH_TARGETS = (
    (1, 10 * 1024 * 1024),
    (2, 8 * 1024 * 1024),
    (3, 6 * 1024 * 1024),
    (4, 5 * 1024 * 1024),
    (5, 4 * 1024 * 1024),
    (6, int(3.5 * 1024 * 1024)),
    (8, 3 * 1024 * 1024),
    (10, int(2.5 * 1024 * 1024)),
)


def normalize_fanxing_reference_image_url(image_url: str) -> str:
    normalized = str(image_url or "").strip()
    if not normalized:
        return ""
    parts = urlsplit(normalized)
    path = str(parts.path or "").strip()
    if (
        parts.scheme
        and parts.netloc
        and path
        and (path.startswith("/files/") or path.startswith("/token_files/"))
    ):
        if parts.query:
            return f"{path}?{parts.query}"
        return path
    return normalized


def normalize_fanxing_reference_image_urls(image_urls) -> list[str]:
    normalized_urls: list[str] = []
    for image_url in list(image_urls or []):
        normalized = normalize_fanxing_reference_image_url(image_url)
        if normalized:
            normalized_urls.append(normalized)
    return normalized_urls


def _format_size_mb(size_bytes: int) -> str:
    return f"{float(size_bytes or 0) / 1024 / 1024:.2f}MB"


def _build_single_image_limit_error(index: int, actual_size: int, limit_size: int) -> str:
    image_index = max(1, int(index or 1))
    return (
        f"第 {image_index} 张参考图过大，系统已尝试高质量压缩和缩小尺寸，"
        f"仍无法压到 { _format_size_mb(limit_size) } 内 "
        f"({ _format_size_mb(actual_size) } > { _format_size_mb(limit_size) })。\n\n"
        "建议操作：\n"
        "1. 优先换成长边更小的图片后重试\n"
        "2. 无透明图可先转为 JPG 后再上传\n"
        "3. 透明 PNG 请先手动缩小尺寸后再上传"
    )


def _build_total_image_limit_error(actual_size: int, limit_size: int) -> str:
    return (
        "参考图总大小过大，系统已尝试分图压缩和总量重平衡，"
        f"仍无法压到 { _format_size_mb(limit_size) } 内 "
        f"({ _format_size_mb(actual_size) } > { _format_size_mb(limit_size) })。\n\n"
        "建议操作：\n"
        "1. 减少参考图数量后重试\n"
        "2. 优先删除体积最大的参考图\n"
        "3. 将单张参考图进一步缩小尺寸后再上传"
    )


def _summarize_image_bytes(image_data: bytes) -> tuple[str, int, int, str]:
    image_format = "unknown"
    width = 0
    height = 0
    is_valid, _reason, detected_format = validate_image_bytes(image_data)
    if is_valid:
        image_format = str(detected_format or "unknown").upper()
    try:
        import io
        from PIL import Image

        with Image.open(io.BytesIO(image_data)) as img:
            width, height = img.size
    except Exception:
        width = 0
        height = 0
    return image_format, int(width or 0), int(height or 0), _format_size_mb(len(image_data or b""))


def _resolve_fanxing_batch_target_bytes(image_count: int) -> int:
    normalized_count = max(1, int(image_count or 1))
    for max_count, target_bytes in _FANXING_BATCH_TARGETS:
        if normalized_count <= max_count:
            return int(target_bytes)
    return int(_FANXING_BATCH_TARGETS[-1][1])


def _build_rebalance_targets(images_data: list[bytes], total_limit: int) -> list[int]:
    current_total = sum(len(item or b"") for item in list(images_data or []))
    if current_total <= total_limit:
        return [len(item or b"") for item in list(images_data or [])]

    min_target = 1024 * 1024
    raw_targets = []
    for item in list(images_data or []):
        current_size = len(item or b"")
        proportional = max(min_target, int(current_size * float(total_limit) / float(current_total)))
        raw_targets.append(min(current_size, proportional))

    overflow = max(0, sum(raw_targets) - int(total_limit or 0))
    while overflow > 0:
        adjusted = False
        for index, current_target in sorted(
            enumerate(raw_targets),
            key=lambda pair: pair[1],
            reverse=True,
        ):
            floor_target = min(min_target, current_target)
            if current_target <= floor_target:
                continue
            shrink_bytes = min(overflow, max(64 * 1024, current_target - floor_target))
            shrink_bytes = min(shrink_bytes, current_target - floor_target)
            if shrink_bytes <= 0:
                continue
            raw_targets[index] -= shrink_bytes
            overflow -= shrink_bytes
            adjusted = True
            if overflow <= 0:
                break
        if not adjusted:
            break

    return [max(min_target, int(target)) for target in raw_targets]


def prepare_fanxing_upload_image_batch(
    images_data: list[bytes],
    *,
    total_limit: int = _FANXING_TOTAL_IMAGE_MAX_BYTES,
    single_limit: int = _FANXING_SINGLE_IMAGE_MAX_BYTES,
) -> list[bytes]:
    prepared_images: list[bytes] = []
    image_count = len(list(images_data or []))
    if image_count <= 0:
        return prepared_images

    target_limit = min(single_limit, _resolve_fanxing_batch_target_bytes(image_count))
    total_before = 0
    total_after = 0
    compressed_count = 0
    detailed_info_logging = False

    start_log = logging.info if detailed_info_logging else logging.debug
    start_log(
        "[ApiSysUpload] batch_prepare_start images=%s single_limit=%s target_limit=%s total_limit=%s",
        image_count,
        _format_size_mb(single_limit),
        _format_size_mb(target_limit),
        _format_size_mb(total_limit),
    )

    for index, image_data in enumerate(list(images_data or []), start=1):
        is_valid, reason, _ = validate_image_bytes(image_data)
        if not is_valid:
            raise ValueError(f"绗?{index} 寮犲弬鑰冨浘鏃犳晥: {reason}")

        total_before += len(image_data or b"")
        target_bytes = target_limit
        prepared = bytes(image_data or b"")
        source_format, source_width, source_height, source_size = _summarize_image_bytes(prepared)
        if len(prepared) > target_bytes:
            prepared = compress_image_for_filesize_high_quality(prepared, target_bytes)

        is_valid, reason, _ = validate_image_bytes(prepared)
        if not is_valid:
            raise ValueError(f"绗?{index} 寮犲弬鑰冨浘鍘嬬缉鍚庢棤鏁? {reason}")
        if len(prepared) > single_limit:
            raise ValueError(_build_single_image_limit_error(index, len(prepared), single_limit))
        if len(prepared) != len(image_data or b""):
            compressed_count += 1

        final_format, final_width, final_height, final_size = _summarize_image_bytes(prepared)
        item_log = logging.info if len(prepared) != len(image_data or b"") else logging.debug
        item_log(
            "[ApiSysUpload] batch_prepare_item index=%s/%s before=%s %s %sx%s target=%s after=%s %s %sx%s changed=%s",
            index,
            image_count,
            source_size,
            source_format,
            source_width,
            source_height,
            _format_size_mb(target_bytes),
            final_size,
            final_format,
            final_width,
            final_height,
            int(len(prepared) != len(image_data or b"")),
        )
        prepared_images.append(prepared)
        total_after += len(prepared)

    if total_after > total_limit:
        rebalanced_targets = _build_rebalance_targets(prepared_images, total_limit)
        logging.info(
            "[ApiSysUpload] batch_prepare_rebalance_start total_after=%s total_limit=%s targets=%s",
            _format_size_mb(total_after),
            _format_size_mb(total_limit),
            [_format_size_mb(item) for item in rebalanced_targets],
        )
        rebalanced_images: list[bytes] = []
        total_after = 0
        for index, prepared in enumerate(list(prepared_images or []), start=1):
            target_bytes = rebalanced_targets[index - 1] if index - 1 < len(rebalanced_targets) else len(prepared or b"")
            rebalanced = prepared
            before_rebalance_format, before_rebalance_width, before_rebalance_height, before_rebalance_size = _summarize_image_bytes(rebalanced)
            if len(rebalanced) > target_bytes:
                rebalanced = compress_image_for_filesize_high_quality(rebalanced, target_bytes)
            if len(rebalanced) > single_limit:
                raise ValueError(_build_single_image_limit_error(index, len(rebalanced), single_limit))
            after_rebalance_format, after_rebalance_width, after_rebalance_height, after_rebalance_size = _summarize_image_bytes(rebalanced)
            logging.info(
                "[ApiSysUpload] batch_prepare_rebalance_item index=%s/%s before=%s %s %sx%s target=%s after=%s %s %sx%s changed=%s",
                index,
                image_count,
                before_rebalance_size,
                before_rebalance_format,
                before_rebalance_width,
                before_rebalance_height,
                _format_size_mb(target_bytes),
                after_rebalance_size,
                after_rebalance_format,
                after_rebalance_width,
                after_rebalance_height,
                int(len(rebalanced) != len(prepared or b"")),
            )
            rebalanced_images.append(rebalanced)
            total_after += len(rebalanced)
        prepared_images = rebalanced_images

    if total_after > total_limit:
        raise ValueError(_build_total_image_limit_error(total_after, total_limit))

    if image_count == 1 and compressed_count <= 0 and prepared_images:
        final_format, final_width, final_height, final_size = _summarize_image_bytes(prepared_images[0])
        logging.info(
            "[ApiSysUpload] reference_prepare index=1 unchanged=1 size=%s format=%s %sx%s limit=%s",
            final_size,
            final_format,
            final_width,
            final_height,
            _format_size_mb(single_limit),
        )
        logging.debug(
            "[ApiSysUpload] batch_prepare images=%s compressed=%s per_image_target=%s total_before=%s total_after=%s total_limit=%s",
            image_count,
            compressed_count,
            _format_size_mb(target_limit),
            _format_size_mb(total_before),
            _format_size_mb(total_after),
            _format_size_mb(total_limit),
        )
    else:
        logging.info(
            "[ApiSysUpload] batch_prepare images=%s compressed=%s per_image_target=%s total_before=%s total_after=%s total_limit=%s",
            image_count,
            compressed_count,
            _format_size_mb(target_limit),
            _format_size_mb(total_before),
            _format_size_mb(total_after),
            _format_size_mb(total_limit),
        )
    return prepared_images


def _elapsed_ms(started_at: float) -> int:
    try:
        return max(0, int((time.monotonic() - float(started_at)) * 1000))
    except Exception:
        return 0


def _get_upload_stage_label(stage: str) -> str:
    normalized = str(stage or "").strip().lower()
    return _UPLOAD_STAGE_LABELS.get(normalized, "上传参考图")


def _classify_request_exception(exc: Exception) -> str:
    if isinstance(exc, requests.exceptions.ConnectTimeout):
        return "connect_timeout"
    if isinstance(exc, requests.exceptions.ReadTimeout):
        return "read_timeout"
    if isinstance(exc, requests.exceptions.Timeout):
        return "timeout"
    if isinstance(exc, requests.exceptions.SSLError):
        return "ssl_error"

    lowered = str(exc or "").strip().lower()
    dns_tokens = (
        "name or service not known",
        "no such host",
        "host not found",
        "getaddrinfo failed",
        "temporary failure in name resolution",
        "nodename nor servname provided",
    )
    if any(token in lowered for token in dns_tokens):
        return "dns_error"

    if isinstance(exc, requests.exceptions.ConnectionError):
        return "connection_error"
    return "request_error"


def _format_request_exception_brief(exc: Exception) -> str:
    exc_type = type(exc).__name__
    message = " ".join(str(exc or "").strip().split())
    if not message:
        return exc_type
    if len(message) > 200:
        message = message[:197].rstrip() + "..."
    return f"{exc_type}: {message}"


def _build_upload_network_error(
    *,
    stage: str,
    index: int,
    attempt_count: int,
    error_kind: str,
) -> str:
    stage_label = _get_upload_stage_label(stage)
    index_prefix = f"第 {max(1, int(index or 1))} 张参考图"
    retry_suffix = f"（已重试 {max(1, int(attempt_count or 1))} 次）"

    detail_map = {
        ("presign", "connect_timeout"): "获取上传地址时连接超时，尚未拿到上传地址",
        ("presign", "read_timeout"): "获取上传地址时响应超时，客户端未收到上传地址结果",
        ("presign", "timeout"): "获取上传地址超时，客户端未收到上传地址结果",
        ("presign", "dns_error"): "获取上传地址时域名解析失败，无法连接上传服务",
        ("presign", "ssl_error"): "获取上传地址时安全连接失败，无法建立 HTTPS 连接",
        ("presign", "connection_error"): "获取上传地址时连接失败，无法连接上传服务",
        ("put", "connect_timeout"): "上传图片文件时连接超时，尚未完成文件上传",
        ("put", "read_timeout"): "上传图片文件时响应超时，服务器可能已收到部分或全部数据",
        ("put", "timeout"): "上传图片文件超时，服务器可能已收到部分或全部数据",
        ("put", "dns_error"): "上传图片文件时域名解析失败，无法连接对象存储服务",
        ("put", "ssl_error"): "上传图片文件时安全连接失败，无法建立 HTTPS 连接",
        ("put", "connection_error"): "上传图片文件时连接失败，无法连接对象存储服务",
        ("confirm", "connect_timeout"): "确认上传结果时连接超时，客户端未拿到最终确认结果",
        ("confirm", "read_timeout"): "确认上传结果时响应超时，服务器可能已收到图片但客户端未拿到确认结果",
        ("confirm", "timeout"): "确认上传结果超时，服务器可能已收到图片但客户端未拿到确认结果",
        ("confirm", "dns_error"): "确认上传结果时域名解析失败，无法连接上传服务",
        ("confirm", "ssl_error"): "确认上传结果时安全连接失败，无法建立 HTTPS 连接",
        ("confirm", "connection_error"): "确认上传结果时连接失败，无法连接上传服务",
    }
    detail = detail_map.get((str(stage or "").strip().lower(), error_kind))
    if not detail:
        detail = f"{stage_label}时网络请求失败"

    return (
        f"参考图上传失败: {index_prefix}{retry_suffix}{detail}"
        "，请检查网络连接、代理设置后重试"
    )


def _build_auth_context(*, base_url: str, api_key: str) -> AuthContext:
    return build_auth_context_from_config(
        base_url=str(base_url or "").strip(),
        config_manager=get_active_config_manager(),
        bearer_token=str(api_key or "").strip(),
        use_host_tenant=False,
    )


def _decode_json_response(resp: requests.Response, action_label: str) -> dict:
    if not resp.content:
        return {}
    try:
        data = resp.json()
    except ValueError as exc:
        content_type = str(resp.headers.get("Content-Type") or "").strip()
        raise RuntimeError(
            f"{action_label}: 服务器返回非 JSON 响应 (HTTP {resp.status_code}, Content-Type={content_type or 'unknown'})"
        ) from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"{action_label}: 响应数据格式错误")
    return data


def _resolve_upload_file_meta(
    *,
    image_data: bytes,
    index: int,
    original_filename: str = "",
    original_file_type: str = "",
) -> Tuple[str, str]:
    is_valid, reason, image_format = validate_image_bytes(image_data)
    if not is_valid:
        raise ValueError(f"参考图无效: {reason}")

    normalized_format = str(image_format or "PNG").strip().upper() or "PNG"
    file_type = str(original_file_type or "").strip().lower()
    if not file_type:
        file_type = _FORMAT_TO_MIME.get(normalized_format, "image/png")

    extension = _FORMAT_TO_EXTENSION.get(normalized_format, "png")
    original_name = str(original_filename or "").strip()
    if original_name:
        stem = Path(original_name).stem.strip() or f"ref_image_{max(0, int(index) - 1)}"
    else:
        stem = f"ref_image_{max(0, int(index) - 1)}"
    filename = f"{stem}.{extension}"
    return filename, file_type


def _request_presign(
    *,
    session: requests.Session,
    auth: AuthContext,
    filename: str,
    file_size: int,
    file_type: str,
    timeout: int,
    trace_context: Mapping[str, str] | None = None,
) -> dict:
    routes = _PROTOCOL.build_file_routes(auth)
    headers = _PROTOCOL.build_headers(auth, include_json_content_type=True)
    payload = {
        "filename": filename,
        "file_size": int(file_size or 0),
        "file_type": str(file_type or "image/png"),
        "upload_type": "file",
    }
    logging.debug(
        "[ApiSysUpload] presign_request trace=%s tenant=%s filename=%s size=%s route=%s",
        format_request_trace(trace_context, phase="upload_presign"),
        auth.normalized_tenant_id,
        str(filename or ""),
        int(file_size or 0),
        redact_url_for_log(routes.presign, category="route"),
    )
    started_at = time.monotonic()
    resp = session.post(routes.presign, headers=headers, json=payload, timeout=timeout)
    if resp.status_code == 401:
        raise PermissionError("认证凭据无效或已过期")
    if resp.status_code == 403:
        raise PermissionError("账户额度不足或无权上传")
    data = _decode_json_response(resp, "参考图预签名失败")
    if resp.status_code != 200:
        server_error = extract_api_error(data)
        if server_error:
            raise RuntimeError(f"参考图预签名失败: {server_error}")
        raise RuntimeError(f"参考图预签名失败: HTTP {resp.status_code}")
    if not bool(data.get("success")):
        raise RuntimeError(
            f"参考图预签名失败: {extract_api_error(data) or '未知错误'}"
        )
    body = data.get("data") or {}
    if not isinstance(body, dict):
        raise RuntimeError("参考图预签名失败: 响应数据格式错误")
    logging.debug(
        "[ApiSysUpload] presign_success trace=%s tenant=%s filename=%s storage_key=%s has_file_url=%s elapsed_ms=%s",
        format_request_trace(trace_context, phase="upload_presign_ok"),
        auth.normalized_tenant_id,
        str(filename or ""),
        redact_value_for_log(str(body.get("storage_key") or ""), category="storage_key"),
        bool(str(body.get("file_url") or "").strip()),
        _elapsed_ms(started_at),
    )
    return body


def _upload_to_presigned_url(
    *,
    session: requests.Session,
    presigned_url: str,
    image_data: bytes,
    file_type: str,
    timeout: int,
    trace_context: Mapping[str, str] | None = None,
) -> None:
    headers = {"Content-Type": str(file_type or "image/png")}
    logging.debug(
        "[ApiSysUpload] object_put trace=%s size=%s content_type=%s",
        format_request_trace(trace_context, phase="upload_put"),
        len(image_data or b""),
        str(file_type or "image/png"),
    )
    started_at = time.monotonic()
    resp = session.put(
        str(presigned_url or "").strip(),
        headers=headers,
        data=image_data,
        timeout=timeout,
    )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"对象存储上传失败: HTTP {resp.status_code}")
    logging.debug(
        "[ApiSysUpload] object_put_success trace=%s status=%s elapsed_ms=%s",
        format_request_trace(trace_context, phase="upload_put_ok"),
        int(resp.status_code),
        _elapsed_ms(started_at),
    )


def _confirm_upload(
    *,
    session: requests.Session,
    auth: AuthContext,
    storage_key: str,
    filename: str,
    file_size: int,
    file_type: str,
    timeout: int,
    trace_context: Mapping[str, str] | None = None,
) -> str:
    routes = _PROTOCOL.build_file_routes(auth)
    headers = _PROTOCOL.build_headers(auth, include_json_content_type=True)
    payload = {
        "storage_key": str(storage_key or "").strip(),
        "upload_type": "file",
        "original_filename": str(filename or "").strip(),
        "file_size": int(file_size or 0),
        "file_type": str(file_type or "image/png"),
    }
    logging.debug(
        "[ApiSysUpload] confirm_request trace=%s tenant=%s filename=%s storage_key=%s route=%s",
        format_request_trace(trace_context, phase="upload_confirm"),
        auth.normalized_tenant_id,
        str(filename or ""),
        redact_value_for_log(str(storage_key or ""), category="storage_key"),
        redact_url_for_log(routes.confirm, category="route"),
    )
    started_at = time.monotonic()
    resp = session.post(routes.confirm, headers=headers, json=payload, timeout=timeout)
    if resp.status_code == 401:
        raise PermissionError("认证凭据无效或已过期")
    if resp.status_code == 403:
        raise PermissionError("账户额度不足或无权确认上传")
    data = _decode_json_response(resp, "参考图确认上传失败")
    if resp.status_code != 200:
        server_error = extract_api_error(data)
        if server_error:
            raise RuntimeError(f"参考图确认上传失败: {server_error}")
        raise RuntimeError(f"参考图确认上传失败: HTTP {resp.status_code}")
    if not bool(data.get("success")):
        raise RuntimeError(
            f"参考图确认上传失败: {extract_api_error(data) or '未知错误'}"
        )
    body = data.get("data") or {}
    file_url = str((body or {}).get("file_url") or "").strip()
    if not file_url:
        raise RuntimeError("参考图确认上传失败: 缺少 file_url")
    normalized_file_url = _PROTOCOL.normalize_file_url(auth, file_url)
    logging.debug(
        "[ApiSysUpload] confirm_success trace=%s tenant=%s filename=%s file_url=%s elapsed_ms=%s",
        format_request_trace(trace_context, phase="upload_done"),
        auth.normalized_tenant_id,
        str(filename or ""),
        redact_url_for_log(normalized_file_url, category="file_url"),
        _elapsed_ms(started_at),
    )
    return normalized_file_url


def upload_fanxing_image(
    *,
    session: requests.Session,
    image_data: bytes,
    base_url: str,
    api_key: str,
    index: int = 1,
    original_filename: str = "",
    original_file_type: str = "",
    timeout: int = 60,
    max_retries: int = 2,
    trace_context: Mapping[str, str] | None = None,
) -> str:
    """Upload image bytes via API-SYS and return normalized file URL."""
    is_valid, reason, _ = validate_image_bytes(image_data)
    if not is_valid:
        raise ValueError(f"参考图无效: {reason}")

    original_size_bytes = len(image_data or b"")
    max_size = _FANXING_SINGLE_IMAGE_MAX_BYTES
    if len(image_data) > max_size:
        image_data = compress_image_for_filesize_high_quality(image_data, max_size)
        is_valid, reason, _ = validate_image_bytes(image_data)
        if not is_valid:
            raise ValueError(f"参考图压缩后无效: {reason}")

    if len(image_data) > max_size:
        raise ValueError(_build_single_image_limit_error(index, len(image_data), max_size))

    final_format, final_width, final_height, final_size = _summarize_image_bytes(image_data)
    prepare_log = logging.info if len(image_data or b"") != original_size_bytes else logging.debug
    prepare_log(
        "[ApiSysUpload] single_prepare index=%s final=%s %s %sx%s single_limit=%s changed=%s",
        max(1, int(index or 1)),
        final_size,
        final_format,
        final_width,
        final_height,
        _format_size_mb(max_size),
        int(len(image_data or b"") != original_size_bytes),
    )

    auth = _build_auth_context(base_url=base_url, api_key=api_key)
    filename, file_type = _resolve_upload_file_meta(
        image_data=image_data,
        index=index,
        original_filename=original_filename,
        original_file_type=original_file_type,
    )

    last_exc: Optional[Exception] = None
    for attempt in range(max_retries + 1):
        stage = "presign"
        attempt_started_at = time.monotonic()
        try:
            presign_data = _request_presign(
                session=session,
                auth=auth,
                filename=filename,
                file_size=len(image_data),
                file_type=file_type,
                timeout=timeout,
                trace_context=trace_context,
            )
            presigned_url = str(presign_data.get("presigned_url") or "").strip()
            storage_key = str(presign_data.get("storage_key") or "").strip()
            if not presigned_url or not storage_key:
                raise RuntimeError("参考图预签名失败: 缺少 presigned_url 或 storage_key")

            stage = "put"
            _upload_to_presigned_url(
                session=session,
                presigned_url=presigned_url,
                image_data=image_data,
                file_type=file_type,
                timeout=timeout,
                trace_context=trace_context,
            )
            stage = "confirm"
            final_url = _confirm_upload(
                session=session,
                auth=auth,
                storage_key=storage_key,
                filename=filename,
                file_size=len(image_data),
                file_type=file_type,
                timeout=timeout,
                trace_context=trace_context,
            )
            logging.debug(
                "[Fanxing] upload_success trace=%s file_url=%s",
                format_request_trace(trace_context, phase="upload_done"),
                redact_url_for_log(final_url, category="file_url"),
            )
            return final_url
        except (PermissionError, ValueError):
            raise
        except (
            requests.exceptions.Timeout,
            requests.exceptions.ConnectionError,
            requests.exceptions.SSLError,
            requests.exceptions.RequestException,
        ) as exc:
            last_exc = exc
            error_kind = _classify_request_exception(exc)
            error_brief = _format_request_exception_brief(exc)
            attempt_no = attempt + 1
            total_attempts = max_retries + 1
            elapsed_ms = _elapsed_ms(attempt_started_at)
            logging.warning(
                "[ApiSysUpload] upload_network_error trace=%s tenant=%s filename=%s index=%s attempt=%s/%s stage=%s stage_label=%s elapsed_ms=%s timeout=%s error_kind=%s error=%s",
                format_request_trace(
                    trace_context, phase=f"upload_{str(stage or 'unknown').lower()}_error"
                ),
                auth.normalized_tenant_id,
                str(filename or ""),
                max(1, int(index or 1)),
                attempt_no,
                total_attempts,
                str(stage or "unknown"),
                _get_upload_stage_label(stage),
                elapsed_ms,
                int(timeout or 0),
                error_kind,
                error_brief,
            )
            if attempt < max_retries:
                backoff_sec = 2 ** attempt
                logging.info(
                    "[ApiSysUpload] upload_retry_scheduled trace=%s tenant=%s filename=%s index=%s next_attempt=%s/%s stage=%s backoff_sec=%s",
                    format_request_trace(
                        trace_context, phase=f"upload_{str(stage or 'unknown').lower()}_retry"
                    ),
                    auth.normalized_tenant_id,
                    str(filename or ""),
                    max(1, int(index or 1)),
                    attempt_no + 1,
                    total_attempts,
                    str(stage or "unknown"),
                    backoff_sec,
                )
                time.sleep(backoff_sec)
                continue
            raise RuntimeError(
                _build_upload_network_error(
                    stage=stage,
                    index=index,
                    attempt_count=total_attempts,
                    error_kind=error_kind,
                )
            ) from exc
        except RuntimeError as exc:
            last_exc = exc
            logging.warning(
                "[ApiSysUpload] upload_runtime_error trace=%s tenant=%s filename=%s diagnostic=%s error=%s",
                format_request_trace(trace_context, phase="upload_error"),
                auth.normalized_tenant_id,
                str(filename or ""),
                classify_runtime_issue(str(exc)) or "generic_upload_error",
                str(exc),
            )
            # 业务失败通常无需重试，但对象存储或短暂中间状态可给一次重试机会
            if attempt < max_retries and "HTTP 5" in str(exc):
                time.sleep(2 ** attempt)
                continue
            raise

    raise RuntimeError(f"参考图上传失败: {last_exc}")


def get_or_upload_fanxing_image_url(
    *,
    image_data: bytes,
    index: int,
    base_url: str,
    api_key: str,
    cache: Optional[FanxingImageCache] = None,
    session: Optional[requests.Session] = None,
    stop_check: Optional[Callable[[], bool]] = None,
    timeout: int = 60,
    max_retries: int = 2,
    trace_context: Mapping[str, str] | None = None,
) -> Tuple[str, bool]:
    """Resolve fanxing image URL via cache first, then upload if needed.

    Returns:
        (url, from_cache)
    """
    if stop_check and stop_check():
        raise RuntimeError("任务被用户中止")

    if cache:
        cached_url = cache.get(image_data)
        if cached_url:
            return cached_url, True

    own_session = session is None
    request_session = (
        configure_requests_session(session)
        if session is not None
        else configure_requests_session()
    )
    try:
        url = upload_fanxing_image(
            session=request_session,
            image_data=image_data,
            base_url=base_url,
            api_key=api_key,
            index=index,
            timeout=timeout,
            max_retries=max_retries,
            trace_context=trace_context,
        )
        if cache:
            cache.set(image_data, url)
        return url, False
    finally:
        if own_session:
            request_session.close()
