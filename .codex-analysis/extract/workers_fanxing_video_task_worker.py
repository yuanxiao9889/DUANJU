# -*- coding: utf-8 -*-
"""Official fanxing/API-SYS video task worker."""

from __future__ import annotations

import logging
import threading
import time

import requests
from typing import Any, Dict, List, Optional

from PyQt5.QtCore import QThread, pyqtSignal

from data.generation_config import SERVER_CONFIG, SERVER_ID_FANXING
from managers.auth import ActiveAuthContextResolver
from managers.config_manager import configure_requests_session, get_active_config_manager
from workers.channel_protocols import AuthContext, HuanyuApiSysProtocol
from workers.video_protocols.models import (
    VIDEO_STATUS_CANCELED,
    VIDEO_STATUS_COMPLETED,
    VIDEO_STATUS_FAILED,
    VIDEO_STATUS_PENDING,
    VIDEO_STATUS_PROCESSING,
    VideoTaskParams,
    VideoTaskStatus,
)

from .batch_poller import get_fanxing_batch_poller
from .video_constants import (
    FANXING_VIDEO_DEFAULT_POLL_INTERVAL_SEC,
    FANXING_VIDEO_DEFAULT_TIMEOUT_SEC,
    FANXING_VIDEO_PROTOCOL_ID,
    FANXING_VIDEO_TASK_TYPE,
)
from .video_task_builder import build_fanxing_video_task_payload


class FanxingVideoTaskWorker(QThread):
    """Submit a single fanxing ``sk-video`` task and wait via batch poller."""

    submitted = pyqtSignal(str, str)  # task_id, generation_id
    status_changed = pyqtSignal(str, int, str)  # status, progress, generation_id
    result_ready = pyqtSignal(object, str)  # VideoTaskStatus, generation_id
    failed = pyqtSignal(str, str)  # error_message, generation_id

    def __init__(
        self,
        params: VideoTaskParams,
        *,
        generation_id: str = "",
        poll_interval_sec: float = FANXING_VIDEO_DEFAULT_POLL_INTERVAL_SEC,
        hard_timeout_sec: float = FANXING_VIDEO_DEFAULT_TIMEOUT_SEC,
        auth_context: AuthContext | None = None,
        session=None,
        poller=None,
        create_retry_delay_sec: float = 0.5,
        parent=None,
    ):
        super().__init__(parent)
        self._params = params if isinstance(params, VideoTaskParams) else VideoTaskParams.from_mapping(params or {})
        self._generation_id = str(generation_id or "").strip()
        self._poll_interval_sec = max(0.5, float(poll_interval_sec or FANXING_VIDEO_DEFAULT_POLL_INTERVAL_SEC))
        self._hard_timeout_sec = max(5.0, float(hard_timeout_sec or FANXING_VIDEO_DEFAULT_TIMEOUT_SEC))
        self._auth_context = auth_context
        self._session = session
        self._poller = poller
        self._stop_requested = False
        self._task_uuid = ""
        self._done_event = threading.Event()
        self._callback_success: Optional[bool] = None
        self._callback_payload = None
        self._callback_lock = threading.Lock()
        self._registered_with_poller = False
        self._create_retry_delay_sec = max(0.0, float(create_retry_delay_sec or 0.0))
        self._network_error = ""

    def stop(self) -> None:
        self._stop_requested = True
        self._done_event.set()
        try:
            self.requestInterruption()
        except Exception:
            pass
        self._safe_unregister_poller_task(reason="worker_stop")

    def run(self) -> None:
        try:
            self._params.validate()
            if str(self._params.video_protocol_id or "").strip() != FANXING_VIDEO_PROTOCOL_ID:
                raise ValueError(
                    f"unsupported fanxing video_protocol_id: {self._params.video_protocol_id}"
                )

            auth = self._build_auth_context()
            protocol = HuanyuApiSysProtocol()
            headers = protocol.build_headers(auth, include_json_content_type=True)
            payload = build_fanxing_video_task_payload(self._params)
            task_uuid = self._create_task(auth=auth, headers=headers, payload=payload)
            self._task_uuid = task_uuid

            self.submitted.emit(task_uuid, self._generation_id)
            self.status_changed.emit(VIDEO_STATUS_PENDING, 0, self._generation_id)

            self._register_poller(auth=auth, headers=headers, task_uuid=task_uuid)
            terminal = self._wait_for_terminal(task_uuid)
            self._emit_terminal(terminal)
        except Exception as exc:
            self._safe_unregister_poller_task(reason="worker_exception")
            logging.exception("[FanxingVideoTaskWorker] run failed")
            self.failed.emit(str(exc), self._generation_id)

    def _build_auth_context(self) -> AuthContext:
        if self._auth_context is not None:
            if not self._auth_context.normalized_bearer_token:
                raise RuntimeError("未配置可用认证凭据")
            return self._auth_context

        config = get_active_config_manager()
        base_url = str(
            config.get("api.server_fanxing.base_url")
            or SERVER_CONFIG.get(SERVER_ID_FANXING, {}).get("base_url")
            or SERVER_CONFIG.get(SERVER_ID_FANXING, {}).get("url")
            or ""
        ).strip()
        if not base_url:
            raise RuntimeError("未配置 fanxing 视频服务地址")
        resolved = ActiveAuthContextResolver(config).resolve(
            server_id=SERVER_ID_FANXING,
            base_url=base_url,
            visible_only=False,
        )
        if not resolved.normalized_bearer_token:
            raise RuntimeError("未配置可用认证凭据")
        return AuthContext(
            base_url=resolved.normalized_base_url,
            bearer_token=resolved.normalized_bearer_token,
            tenant_id=resolved.normalized_tenant_id,
            auth_mode=resolved.normalized_auth_mode,
            use_host_tenant=False,
        )

    def _get_session(self):
        if self._session is not None:
            return self._session
        self._session = configure_requests_session()
        return self._session

    def _get_poller(self):
        if self._poller is not None:
            return self._poller
        self._poller = get_fanxing_batch_poller()
        return self._poller

    def _create_task(self, *, auth: AuthContext, headers: dict, payload: dict) -> str:
        protocol = HuanyuApiSysProtocol()
        create_url = protocol.build_task_routes(auth).create
        max_attempts = 3
        retry_delay = self._create_retry_delay_sec
        last_error: Exception | None = None
        for attempt in range(max_attempts):
            try:
                response = self._get_session().post(
                    create_url,
                    headers=headers,
                    json=payload,
                    timeout=30,
                )
                body = self._safe_json_response(response)
                status_code = int(getattr(response, "status_code", 200) or 200)
                if status_code >= 500 and attempt < max_attempts - 1:
                    last_error = RuntimeError(f"????????: HTTP {status_code}")
                    self._sleep_before_retry(retry_delay)
                    retry_delay = self._next_retry_delay(retry_delay)
                    continue
                if status_code != 200:
                    message = HuanyuApiSysProtocol().summarize_api_error(body) if body else ""
                    raise RuntimeError(message or f"????????: HTTP {status_code}")
                if not self._is_success_response(body):
                    raise RuntimeError(self._extract_error_message(body) or "????????")
                task_uuid = self._extract_task_uuid(body)
                if not task_uuid:
                    raise RuntimeError("?????????? UUID")
                return task_uuid
            except (
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                TimeoutError,
                ConnectionResetError,
            ) as exc:
                last_error = exc
                if attempt >= max_attempts - 1:
                    break
                self._sleep_before_retry(retry_delay)
                retry_delay = self._next_retry_delay(retry_delay)
        if last_error is not None:
            raise RuntimeError(f"create video task failed after {max_attempts} attempts: {last_error}")
        raise RuntimeError("create video task failed")

    def _register_poller(self, *, auth: AuthContext, headers: dict, task_uuid: str) -> None:
        self._get_poller().register_task(
            task_uuid,
            auth.normalized_base_url,
            dict(headers or {}),
            self._on_poller_completed,
            timeout=int(self._hard_timeout_sec),
            task_index=0,
            progress_callback=self._on_poller_progress,
            status_callback=self._on_poller_status,
            network_error_callback=self._on_poller_network_error,
            capability="video_generation",
            generation_id=self._generation_id,
            task_type=FANXING_VIDEO_TASK_TYPE,
        )
        self._registered_with_poller = True

    def _wait_for_terminal(self, task_uuid: str) -> VideoTaskStatus:
        started_at = time.monotonic()
        while not self._stop_requested:
            if self._done_event.wait(self._poll_interval_sec):
                break
            if (time.monotonic() - started_at) >= self._hard_timeout_sec:
                self._safe_unregister_poller_task(reason="worker_timeout")
                raise TimeoutError("fanxing video task polling timed out")

        if self._stop_requested:
            return VideoTaskStatus(
                task_id=task_uuid,
                status=VIDEO_STATUS_CANCELED,
                progress=None,
                error_message="video task stopped by user",
            )
        with self._callback_lock:
            callback_success = self._callback_success
            callback_payload = self._callback_payload
        if callback_success is True:
            return self._build_success_status(task_uuid, callback_payload)
        if callback_success is False:
            return VideoTaskStatus(
                task_id=task_uuid,
                status=VIDEO_STATUS_FAILED,
                progress=None,
                error_message=str(callback_payload or "video task failed"),
            )
        raise TimeoutError("fanxing video task polling ended without terminal callback")

    def _on_poller_completed(self, task_uuid: str, success: bool, result_or_error) -> None:
        with self._callback_lock:
            self._callback_success = bool(success)
            self._callback_payload = result_or_error
        self._done_event.set()

    def _on_poller_progress(self, _task_index: int, progress: int) -> None:
        if self._stop_requested:
            return
        self.status_changed.emit(
            VIDEO_STATUS_PROCESSING,
            self._safe_progress(progress),
            self._generation_id,
        )

    def _on_poller_status(self, task_uuid: str, status: str, task_info: dict) -> None:
        if self._stop_requested:
            return
        mapped = self._map_status(status)
        progress = self._safe_progress(
            (task_info or {}).get("progress")
            or (task_info or {}).get("percent")
            or (task_info or {}).get("progress_percent")
            or 0
        )
        self.status_changed.emit(mapped, progress, self._generation_id)

    def _on_poller_network_error(self, task_uuid: str, error: str) -> None:
        self._network_error = str(error or "").strip()
        logging.warning(
            "[FanxingVideoTaskWorker] poll network error task_uuid=%s error=%s",
            str(task_uuid or "")[:8],
            self._network_error,
        )

    def _emit_terminal(self, status: VideoTaskStatus) -> None:
        if status.is_success:
            self.status_changed.emit(VIDEO_STATUS_COMPLETED, 100, self._generation_id)
            self.result_ready.emit(status, self._generation_id)
            return
        self.failed.emit(str(status.error_message or status.status or "video task failed"), self._generation_id)

    def _build_success_status(self, task_uuid: str, payload) -> VideoTaskStatus:
        result_urls = self._extract_result_urls(payload)
        if not result_urls:
            raise RuntimeError("视频任务已完成，但服务端未返回视频 URL")
        raw_response = payload if isinstance(payload, dict) else {"result_urls": list(result_urls)}
        input_params = dict((raw_response.get("input_params") or {}) if isinstance(raw_response, dict) else {})
        output_list = dict((raw_response.get("output_list") or {}) if isinstance(raw_response, dict) else {})
        return VideoTaskStatus(
            task_id=str(task_uuid or "").strip(),
            status=VIDEO_STATUS_COMPLETED,
            progress=100,
            result_urls=result_urls,
            last_frame_url=str(output_list.get("last_frame_url") or raw_response.get("last_frame_url") or "").strip(),
            model=str(input_params.get("model") or self._params.model or "").strip(),
            resolution=str(input_params.get("resolution") or self._params.resolution or "").strip(),
            ratio=str(input_params.get("ratio") or self._params.ratio or "").strip(),
            duration=self._params.duration,
            generate_audio=self._params.generate_audio,
            raw_response=raw_response,
        )

    def _safe_unregister_poller_task(self, *, reason: str = "") -> None:
        task_uuid = str(self._task_uuid or "").strip()
        if not task_uuid or not self._registered_with_poller:
            return
        self._registered_with_poller = False
        try:
            self._get_poller().unregister_task(task_uuid)
        except Exception:
            logging.debug(
                "[FanxingVideoTaskWorker] unregister task failed reason=%s",
                str(reason or "").strip(),
                exc_info=True,
            )

    @staticmethod
    def _safe_json_response(response) -> Dict[str, Any]:
        try:
            body = response.json()
        except Exception:
            return {}
        return body if isinstance(body, dict) else {}

    @staticmethod
    def _sleep_before_retry(delay_sec: float) -> None:
        delay = max(0.0, float(delay_sec or 0.0))
        if delay > 0:
            time.sleep(delay)

    @staticmethod
    def _next_retry_delay(delay_sec: float) -> float:
        delay = max(0.0, float(delay_sec or 0.0))
        if delay <= 0:
            return 0.0
        return min(max(0.5, delay * 2), 5.0)

    @classmethod
    def _extract_task_uuid(cls, body: dict) -> str:
        if not isinstance(body, dict):
            return ""
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        for source in (data, body):
            for key in ("task_uuid", "task_id", "id", "uuid"):
                value = str((source or {}).get(key) or "").strip()
                if value:
                    return value
        return ""

    @classmethod
    def _extract_result_urls(cls, payload) -> List[str]:
        candidates: List[Any] = []
        if isinstance(payload, list):
            candidates.extend(payload)
        elif isinstance(payload, dict):
            for key in ("result_urls", "video_urls", "videos", "images"):
                value = payload.get(key)
                if isinstance(value, list):
                    candidates.extend(value)
            data = payload.get("data")
            if isinstance(data, dict):
                for key in ("result_urls", "video_urls", "videos", "images"):
                    value = data.get(key)
                    if isinstance(value, list):
                        candidates.extend(value)
            output_list = payload.get("output_list")
            if isinstance(output_list, dict):
                for key in ("result_urls", "video_urls", "videos", "images"):
                    value = output_list.get(key)
                    if isinstance(value, list):
                        candidates.extend(value)

        urls: List[str] = []
        seen = set()
        for item in candidates:
            if isinstance(item, str):
                url = item.strip()
            elif isinstance(item, dict):
                url = str(
                    item.get("url")
                    or item.get("video_url")
                    or item.get("file_url")
                    or item.get("image_url")
                    or ""
                ).strip()
            else:
                url = ""
            if not url or url in seen:
                continue
            seen.add(url)
            urls.append(url)
        return urls

    @staticmethod
    def _is_success_response(body: Dict[str, Any]) -> bool:
        if not isinstance(body, dict):
            return False
        if body.get("success") is False:
            return False
        code = body.get("code")
        if code is None:
            return bool(body.get("success") is True or body.get("data"))
        try:
            return int(code) == 0
        except Exception:
            return str(code).strip().lower() in {"0", "ok", "success"}

    @staticmethod
    def _extract_error_message(body: Dict[str, Any]) -> str:
        for key in ("msg", "message", "error", "error_message"):
            value = (body or {}).get(key)
            if value:
                return str(value).strip()
        return ""

    @staticmethod
    def _safe_progress(value) -> int:
        try:
            return max(0, min(100, int(float(value))))
        except Exception:
            return 0

    @staticmethod
    def _map_status(status: str) -> str:
        normalized = str(status or "").strip().lower()
        if normalized in {"completed", "succeeded", "success"}:
            return VIDEO_STATUS_COMPLETED
        if normalized in {"failed", "failure", "error"}:
            return VIDEO_STATUS_FAILED
        if normalized in {"canceled", "cancelled", "aborted"}:
            return VIDEO_STATUS_CANCELED
        if normalized in {"queued", "pending"}:
            return VIDEO_STATUS_PENDING
        return VIDEO_STATUS_PROCESSING
