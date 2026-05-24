# -*- coding: utf-8 -*-
"""繁星批量轮询管理器模块

集中管理所有待轮询的繁星任务，使用批量查询 API 减少请求次数。
"""

import logging
import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any, Dict, List, Optional, Tuple

import requests
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from data.generation_config import SERVER_ID_FANXING
from managers.auth import ActiveAuthContextResolver
from managers.config_manager import configure_requests_session, get_active_config_manager
from managers.logging_manager import redact_url_for_log
from managers.task_ledger import get_task_ledger_store
from utils import (
    build_request_trace,
    classify_runtime_issue,
    format_request_trace,
    get_runtime_issue_message,
)
from utils.api_error_mapper import (
    SESSION_INVALIDATED_USER_MESSAGE,
    is_session_invalidated_payload,
)
from workers.channel_protocols import AuthContext, HuanyuApiSysProtocol
from workers.channel_protocols.auth_context import build_auth_context_from_headers

from workers.fanxing.concurrency_controller import (
    TaskPriority,
    get_concurrency_controller,
)
try:
    from workers.fanxing.defensive import (
        get_lifecycle_guard,
        get_state_validator,
        get_task_monitor,
    )
except ImportError:
    # Some regression tests load defensive submodules into a stub package before
    # executing this module. Keep that legacy loading path working.
    from workers.fanxing.defensive.lifecycle_guard import get_lifecycle_guard
    from workers.fanxing.defensive.monitor import get_task_monitor
    from workers.fanxing.defensive.state_validator import get_state_validator
from workers.fanxing.enhancement_config import get_enhancement_config
from workers.fanxing.task_state import FanxingTaskState
from workers.fanxing.task_events import FanxingEventType, FanxingTaskEventBus


class FanxingBatchPoller:
    """繁星批量轮询管理器（单例）

    集中管理所有待轮询的繁星任务，使用批量查询 API 减少请求次数。

    架构：
    - 各 ApiWorker 提交任务后，注册到此管理器
    - 管理器在后台线程中统一批量轮询
    - 任务完成时通过回调通知对应的 Worker

    优势：
    - N 个任务只需 1 次批量查询，而非 N 次独立查询
    - 统一的轮询间隔控制，避免请求风暴
    - 共享 Session，减少连接开销
    """

    _instance = None
    _lock = threading.Lock()
    _CHECKPOINT_META_PRESERVE_KEYS = {
        "api_mode",
        "model_type",
        "auth_mode",
        "tenant_id",
        "billing_owner_type",
        "billing_owner_id",
        "billing_owner_name",
        "source",
        "feature_key",
        "function_name",
    }

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._tasks: Dict[str, dict] = {}  # {task_uuid: task_info}
        self._task_lock = threading.Lock()
        self._poll_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._session: Optional[requests.Session] = None

        # 配置
        self._base_poll_interval = 3.0  # 基础轮询间隔（秒）
        self._min_poll_interval = 1.5  # 最小轮询间隔（任务即将完成时）
        self._max_poll_interval = 6.0  # 最大轮询间隔（任务初期或空闲时）
        self._batch_size = 50  # 单次批量查询最大任务数
        self._consecutive_errors = 0  # 连续错误计数
        self._max_consecutive_errors = 5  # 连续错误阈值（超过后增加轮询间隔）
        self._last_logged_interval = None  # 上次记录的间隔（用于去重日志）
        self._last_logged_stagnation_bucket = None  # 上次记录的停滞退避档位
        self._poll_count = 0  # 轮询计数器
        self._poll_iteration = 0  # 实际轮询轮次计数
        self._group_states: Dict[str, dict] = {}
        self._log_state_lock = threading.Lock()
        self._last_poll_summary_signature = ""
        self._last_batch_response_signatures: Dict[str, str] = {}
        self._last_task_status_signatures: Dict[str, str] = {}
        self._concurrency = get_concurrency_controller()
        self._task_monitor = get_task_monitor()
        self._state_validator = get_state_validator()
        self._lifecycle_guard = get_lifecycle_guard()
        self._event_bus = FanxingTaskEventBus.get_instance()
        self._callback_executor = ThreadPoolExecutor(
            max_workers=2,
            thread_name_prefix="FanxingPollerCallback",
        )
        self._callback_timeout_seconds = 5.0
        self._network_error_notify_interval = 5.0
        self._min_network_error_notify_interval = 5.0
        self._max_network_error_notify_interval = 15.0
        self._batch_query_connect_timeout_seconds = 3.0
        self._batch_query_read_timeout_seconds = 15.0
        self._missing_task_probe_threshold = 2
        self._missing_task_probe_cooldown_seconds = 8.0
        self._group_watchdog_multiplier = 3.0
        self._group_max_future_due_seconds = 60.0
        self._last_defensive_audit_at = 0.0

        self._initialized = True
        logging.info("[FanxingBatchPoller] 初始化完成")

    @staticmethod
    def _summarize_task_info(task_info: dict) -> dict:
        if not isinstance(task_info, dict):
            return {}

        input_params = (
            dict(task_info.get("input_params") or {})
            if isinstance(task_info.get("input_params"), dict)
            else {}
        )
        output_list = (
            dict(task_info.get("output_list") or {})
            if isinstance(task_info.get("output_list"), dict)
            else {}
        )
        prompt = str(input_params.get("prompt") or "")
        img_list = input_params.get("img_list")
        image_count = len(list(img_list or [])) if isinstance(img_list, list) else 0
        error_message = str(
            task_info.get("error_message")
            or task_info.get("message")
            or task_info.get("msg")
            or ""
        ).strip()
        if len(error_message) > 200:
            error_message = error_message[:200] + "..."

        return {
            "task_uuid": str(task_info.get("task_uuid") or "").strip(),
            "status": str(task_info.get("status") or "").strip(),
            "progress": int(task_info.get("progress") or 0),
            "model": str(input_params.get("model") or "").strip(),
            "size": str(input_params.get("size") or "").strip(),
            "prompt_len": len(prompt),
            "ref_image_count": image_count,
            "provider": str(output_list.get("provider") or "").strip(),
            "worker_node": str(task_info.get("worker_node") or "").strip(),
            "created_at": str(task_info.get("created_at") or "").strip(),
            "updated_at": str(task_info.get("updated_at") or "").strip(),
            "completed_at": str(task_info.get("completed_at") or "").strip(),
            "error_message": error_message,
        }

    _PROFILE_CONFIGS = {
        "interactive_image_generation": {
            "base_interval": 3.0,
            "min_interval": 1.5,
            "max_interval": 6.0,
            "mid_progress_min": 50,
            "late_progress_min": 80,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (60.0, 8.0),
                (180.0, 12.0),
                (300.0, 15.0),
            ),
            "network_backoff_cap": 15.0,
            "use_progress_curve": True,
        },
        "ecom_single_tile": {
            "base_interval": 3.0,
            "min_interval": 2.0,
            "max_interval": 6.0,
            "mid_progress_min": 50,
            "late_progress_min": 80,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (60.0, 8.0),
                (180.0, 12.0),
                (300.0, 15.0),
            ),
            "network_backoff_cap": 15.0,
            "use_progress_curve": True,
        },
        "image_process_cf_task": {
            "base_interval": 5.0,
            "min_interval": 2.5,
            "max_interval": 6.0,
            "processing_interval": 5.0,
            "late_progress_min": 85,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (60.0, 10.0),
                (180.0, 15.0),
                (300.0, 20.0),
            ),
            "network_backoff_cap": 20.0,
            "use_progress_curve": False,
        },
        "text_extract": {
            "base_interval": 5.0,
            "min_interval": 4.0,
            "max_interval": 5.0,
            "processing_interval": 5.0,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (60.0, 10.0),
                (180.0, 15.0),
            ),
            "network_backoff_cap": 15.0,
            "use_progress_curve": False,
        },
        "fanxing_llm_short": {
            "base_interval": 4.0,
            "min_interval": 4.0,
            "max_interval": 4.0,
            "processing_interval": 4.0,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (60.0, 8.0),
                (180.0, 12.0),
            ),
            "network_backoff_cap": 12.0,
            "use_progress_curve": False,
        },
        "video_generation": {
            "base_interval": 4.0,
            "min_interval": 3.0,
            "max_interval": 8.0,
            "processing_interval": 4.0,
            "late_progress_min": 80,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (120.0, 8.0),
                (360.0, 12.0),
                (720.0, 20.0),
            ),
            "network_backoff_cap": 20.0,
            "use_progress_curve": True,
        },
        "restored_polling": {
            "base_interval": 8.0,
            "min_interval": 8.0,
            "max_interval": 8.0,
            "processing_interval": 8.0,
            "queued_statuses": {"queued", "pending"},
            "stagnation_steps": (
                (60.0, 10.0),
                (180.0, 15.0),
                (300.0, 20.0),
            ),
            "network_backoff_cap": 20.0,
            "use_progress_curve": False,
        },
    }

    def configure_network_error_notify(self, interval: float) -> None:
        normalized = max(
            self._min_network_error_notify_interval,
            min(
                float(interval or self._network_error_notify_interval),
                self._max_network_error_notify_interval,
            ),
        )
        self._network_error_notify_interval = normalized

    def _refresh_runtime_config(self) -> None:
        config = get_enhancement_config()
        self._callback_timeout_seconds = max(
            1.0,
            float(
                getattr(
                    config, "callback_timeout_seconds", self._callback_timeout_seconds
                )
                or self._callback_timeout_seconds
            ),
        )
        self._network_error_notify_interval = max(
            self._min_network_error_notify_interval,
            min(
                float(
                    getattr(
                        config,
                        "network_error_notify_interval",
                        self._network_error_notify_interval,
                    )
                    or self._network_error_notify_interval
                ),
                self._max_network_error_notify_interval,
            ),
        )
        self._batch_query_connect_timeout_seconds = max(
            1.0,
            float(
                getattr(
                    config,
                    "batch_query_connect_timeout_seconds",
                    self._batch_query_connect_timeout_seconds,
                )
                or self._batch_query_connect_timeout_seconds
            ),
        )
        self._batch_query_read_timeout_seconds = max(
            self._batch_query_connect_timeout_seconds,
            float(
                getattr(
                    config,
                    "batch_query_read_timeout_seconds",
                    self._batch_query_read_timeout_seconds,
                )
                or self._batch_query_read_timeout_seconds
            ),
        )

    @classmethod
    def _get_profile_config(cls, profile_id: str) -> dict:
        normalized = str(profile_id or "").strip() or "interactive_image_generation"
        return dict(
            cls._PROFILE_CONFIGS.get(
                normalized, cls._PROFILE_CONFIGS["interactive_image_generation"]
            )
        )

    @staticmethod
    def _resolve_profile_id(
        *,
        lifecycle_type: str = "",
        task_type: str = "",
        capability: str = "",
        restored: bool = False,
    ) -> str:
        if restored:
            return "restored_polling"

        normalized_lifecycle_type = str(lifecycle_type or "").strip().lower()
        normalized_task_type = str(task_type or "").strip().lower()
        normalized_capability = str(capability or "").strip().lower()

        if normalized_task_type == "image_process_cf_task":
            return "image_process_cf_task"
        if normalized_task_type == "text_extract":
            return "text_extract"
        if normalized_task_type == "fanxing_llm_short":
            return "fanxing_llm_short"
        if normalized_task_type in {"sk-video", "video_generation"}:
            return "video_generation"
        if normalized_task_type == "ecom_single_tile_generation":
            return "ecom_single_tile"
        if normalized_capability == "video_generation":
            return "video_generation"
        if normalized_capability == "cf_task":
            return "image_process_cf_task"
        if normalized_task_type in {
            "canvas_generation",
            "grid_generation",
            "batch_generation",
        }:
            return "interactive_image_generation"
        if normalized_lifecycle_type == "interactive_image_generation":
            return "interactive_image_generation"
        return "interactive_image_generation"

    def _build_group_key(self, *, base_url: str, headers: dict, profile_id: str) -> str:
        return "|".join(
            [
                str(base_url or "").strip(),
                self._build_header_fingerprint(headers),
                str(profile_id or "").strip() or "interactive_image_generation",
            ]
        )

    def _compute_task_group_key(self, task_data: dict) -> str:
        data = dict(task_data or {})
        profile_id = str(
            data.get("profile_id")
            or self._resolve_profile_id(
                lifecycle_type=str(data.get("lifecycle_type") or "").strip(),
                task_type=str(data.get("task_type") or "").strip(),
                capability=str(data.get("capability") or "").strip(),
                restored=bool(data.get("restored")),
            )
        ).strip() or "interactive_image_generation"
        return self._build_group_key(
            base_url=str(data.get("base_url") or "").strip(),
            headers=dict(data.get("headers") or {}),
            profile_id=profile_id,
        )

    def _ensure_group_state_locked(self, group_key: str, profile_id: str) -> dict:
        normalized_group_key = str(group_key or "").strip()
        if not normalized_group_key:
            normalized_group_key = "unknown"
        state = self._group_states.get(normalized_group_key)
        if state is None:
            state = {
                "profile_id": str(profile_id or "").strip()
                or "interactive_image_generation",
                "next_due_at": 0.0,
                "consecutive_errors": 0,
                "last_polled_at": 0.0,
                "last_success_at": 0.0,
                "last_watchdog_forced_at": 0.0,
                "last_logged_interval": None,
                "last_logged_stagnation_bucket": None,
                "poll_count": 0,
            }
            self._group_states[normalized_group_key] = state
        else:
            state["profile_id"] = (
                str(profile_id or "").strip()
                or str(state.get("profile_id") or "").strip()
                or "interactive_image_generation"
            )
        return state

    def _prune_group_states_locked(self, active_group_keys: set) -> None:
        active = {str(key or "").strip() for key in set(active_group_keys or set()) if str(key or "").strip()}
        stale_group_keys = [
            group_key for group_key in list(self._group_states.keys()) if group_key not in active
        ]
        for group_key in stale_group_keys:
            self._group_states.pop(group_key, None)
            with self._log_state_lock:
                self._last_batch_response_signatures.pop(group_key, None)

    def _get_profile_max_expected_interval(self, profile_id: str) -> float:
        config = self._get_profile_config(profile_id)
        candidates = [
            float(config.get("base_interval") or 0.0),
            float(config.get("min_interval") or 0.0),
            float(config.get("max_interval") or 0.0),
            float(config.get("processing_interval") or 0.0),
            float(config.get("network_backoff_cap") or 0.0),
        ]
        for _, interval in list(config.get("stagnation_steps") or []):
            candidates.append(float(interval or 0.0))
        filtered = [value for value in candidates if value > 0]
        return max(filtered) if filtered else self._base_poll_interval

    def _sanitize_group_schedule_locked(
        self,
        *,
        current_time: float,
        group_key: str,
        profile_id: str,
        active_task_count: int,
    ) -> dict:
        state = self._ensure_group_state_locked(group_key, profile_id)
        max_expected_interval = max(
            1.0, self._get_profile_max_expected_interval(profile_id)
        )
        max_silence_seconds = min(
            self._group_max_future_due_seconds,
            max_expected_interval * self._group_watchdog_multiplier,
        )
        next_due_at = float(state.get("next_due_at") or 0.0)
        last_polled_at = float(state.get("last_polled_at") or 0.0)
        last_watchdog_forced_at = float(state.get("last_watchdog_forced_at") or 0.0)

        if next_due_at <= 0.0:
            state["next_due_at"] = current_time
            return state

        future_delta = next_due_at - current_time
        if future_delta > max_silence_seconds:
            logging.warning(
                "[FanxingBatchPoller] group_schedule_clamped group=%s profile=%s future_delta=%.1fs active_tasks=%s",
                group_key,
                profile_id,
                future_delta,
                active_task_count,
            )
            state["next_due_at"] = current_time + max_expected_interval
            return state

        if (
            active_task_count > 0
            and last_polled_at > 0.0
            and current_time - last_polled_at > max_silence_seconds
            and next_due_at > current_time
            and current_time - last_watchdog_forced_at > max_expected_interval
        ):
            logging.warning(
                "[FanxingBatchPoller] group_watchdog_force_due group=%s profile=%s silence=%.1fs next_due_in=%.1fs",
                group_key,
                profile_id,
                current_time - last_polled_at,
                next_due_at - current_time,
            )
            state["next_due_at"] = current_time
            state["last_watchdog_forced_at"] = current_time
        return state

    def _log_group_interval_decision(
        self,
        *,
        group_key: str,
        profile_id: str,
        interval: float,
        max_progress,
        avg_progress,
        max_stagnation: float,
        stagnation_bucket: Optional[int],
    ) -> None:
        state = self._group_states.get(str(group_key or "").strip())
        if state is None:
            return
        state["poll_count"] = int(state.get("poll_count") or 0) + 1
        interval_key = f"{profile_id}:{interval:.1f}:{int(max_progress) // 10}"
        if (
            interval_key != state.get("last_logged_interval")
            or state["poll_count"] % 10 == 0
        ):
            state["last_logged_interval"] = interval_key
            logging.debug(
                "[FanxingBatchPoller] 自适应间隔: group=%s profile=%s interval=%.1fs max_progress=%s avg=%s",
                group_key,
                profile_id,
                interval,
                int(max_progress),
                int(avg_progress),
            )

        stagnation_log_key = (
            None
            if stagnation_bucket is None
            else f"{profile_id}:{int(stagnation_bucket)}"
        )
        if stagnation_log_key and (
            stagnation_log_key != state.get("last_logged_stagnation_bucket")
            or state["poll_count"] % 20 == 0
        ):
            state["last_logged_stagnation_bucket"] = stagnation_log_key
            logging.debug(
                "[FanxingBatchPoller] 停滞退避: group=%s profile=%s stagnation=%ss interval=%.1fs bucket=%ss",
                group_key,
                profile_id,
                int(max_stagnation),
                interval,
                int(stagnation_bucket),
            )
        elif stagnation_log_key is None:
            state["last_logged_stagnation_bucket"] = None

    def _emit_task_event(self, event_type: str, task_uuid: str, **data) -> None:
        config = get_enhancement_config()
        if not getattr(config, "use_event_bus", False):
            return

        generation_id = ""
        with self._task_lock:
            task_data = self._tasks.get(task_uuid) or {}
            generation_id = str(task_data.get("generation_id") or "")

        event = self._event_bus.create_task_event(
            event_type=event_type,
            task_id=task_uuid,
            generation_id=generation_id,
            **data,
        )
        self._event_bus.emit(event)

    def _execute_callback_safely(self, callback, *args) -> None:
        if not callback:
            return
        self._refresh_runtime_config()
        future = self._callback_executor.submit(callback, *args)
        try:
            future.result(timeout=self._callback_timeout_seconds)
        except FutureTimeoutError:
            logging.error(
                "[FanxingBatchPoller] 回调执行超时: timeout=%ss",
                self._callback_timeout_seconds,
            )
        except Exception as exc:
            logging.error("[FanxingBatchPoller] 回调异常: %s", exc)

    def _record_terminal_result_for_dispatcher(
        self,
        *,
        task_uuid: str,
        success: bool,
        result_or_error: Any,
        task_data: Optional[dict],
        callback=None,
    ) -> None:
        try:
            from workers.fanxing.result_dispatcher import (
                get_fanxing_result_dispatcher,
            )

            effective_callback = callback
            if effective_callback is None and task_data:
                effective_callback = task_data.get("callback")
            get_fanxing_result_dispatcher().record_terminal_result(
                task_uuid=task_uuid,
                success=success,
                result_or_error=result_or_error,
                task_data=task_data,
                has_callback=bool(effective_callback),
            )
        except Exception:
            logging.exception(
                "[FanxingResultDispatcher] record terminal result failed"
            )

    def _publish_terminal_result_for_dispatcher(
        self,
        *,
        task_uuid: str,
        phase: str,
    ) -> None:
        try:
            from workers.fanxing.result_dispatcher import (
                get_fanxing_result_dispatcher,
            )

            get_fanxing_result_dispatcher().publish_terminal_result(
                task_uuid=task_uuid,
                phase=phase,
            )
        except Exception:
            logging.exception(
                "[FanxingResultDispatcher] publish terminal result failed"
            )

    def _task_trace(
        self,
        *,
        task_uuid: str = "",
        task_data: Optional[dict] = None,
        phase: str = "",
        restored: Optional[bool] = None,
    ) -> str:
        data = dict(task_data or {})
        restored_value = restored
        if restored_value is None:
            restored_value = bool(data.get("restored"))
        return format_request_trace(
            build_request_trace(
                source="fanxing_batch_poller",
                phase=phase,
                generation_id=str(data.get("generation_id") or "").strip(),
                task_uuid=str(task_uuid or data.get("task_uuid") or "").strip(),
                task_index=data.get("task_index"),
                capability=str(data.get("capability") or "").strip(),
                restored=restored_value,
            )
        )

    def _create_session(self) -> requests.Session:
        """创建配置了连接池的 Session"""
        session = configure_requests_session()

        # 配置连接池和重试策略
        adapter = HTTPAdapter(
            pool_connections=10,  # 连接池大小
            pool_maxsize=10,  # 最大连接数
            max_retries=Retry(
                total=2,  # 最多重试 2 次
                backoff_factor=0.5,
                status_forcelist=[502, 503, 504],
                allowed_methods=["POST"],
            ),
        )
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        session.verify = False
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        return session

    @staticmethod
    def _normalize_registered_task_uuid(task_uuid: str) -> str:
        return str(task_uuid or "").strip()

    def register_task(
        self,
        task_uuid: str,
        base_url: str,
        headers: dict,
        callback: callable,
        timeout: int = 300,
        task_index: int = -1,
        progress_callback: callable = None,
        status_callback: callable = None,
        network_error_callback: callable = None,
        capability: str = "image_generation",
        generation_id: str = "",
        concurrency_acquired: bool = False,
        restored: bool = False,
        task_type: str = "",
        lifecycle_type: str = "",
        scheduler_task_id: str = "",
    ) -> None:
        """注册一个待轮询的任务

        Args:
            task_uuid: 任务 UUID
            base_url: 服务器地址
            headers: 请求头（包含 Authorization）
            callback: 完成回调 callback(task_uuid, success, result_or_error)
            timeout: 超时时间（秒）
            task_index: 任务索引（用于进度回调）
            progress_callback: 进度回调 progress_callback(task_index, progress)
            network_error_callback: 网络错误回调 network_error_callback(task_uuid, error)
            capability: 并发能力标识（可选增强）
        """
        normalized_task_uuid = self._normalize_registered_task_uuid(task_uuid)
        if not normalized_task_uuid:
            raise RuntimeError("missing_task_uuid_for_poll_registration")
        registered_auth = build_auth_context_from_headers(
            base_url=str(base_url or "").strip(),
            headers=dict(headers or {}),
            use_host_tenant=False,
        )
        registered_auth_mode = registered_auth.normalized_auth_mode
        registered_bearer_fingerprint = self._build_token_fingerprint(
            registered_auth.normalized_bearer_token
        )

        current_time = time.time()
        normalized_task_type = str(task_type or "").strip()
        normalized_lifecycle_type = str(lifecycle_type or "").strip()
        normalized_scheduler_task_id = str(scheduler_task_id or "").strip()
        strict_identity = bool(normalized_scheduler_task_id) or bool(
            normalized_lifecycle_type
        )
        identity_task_types = {
            "canvas_generation",
            "grid_generation",
            "batch_generation",
            "ecom_single_tile_generation",
        }
        requires_full_identity = (
            strict_identity and normalized_task_type in identity_task_types
        )
        self._lifecycle_guard.validate_identity(
            phase="poll_register",
            scheduler_task_id=normalized_scheduler_task_id,
            generation_id=str(generation_id or "").strip(),
            task_index=task_index,
            provider_task_uuid=normalized_task_uuid,
            require_provider_task_uuid=True,
            require_generation_id=requires_full_identity,
            require_task_index=requires_full_identity,
            require_scheduler_task_id=requires_full_identity,
            task_type=normalized_task_type,
            lifecycle_type=normalized_lifecycle_type,
        )
        base_profile_id = self._resolve_profile_id(
            lifecycle_type=normalized_lifecycle_type,
            task_type=normalized_task_type,
            capability=capability,
            restored=False,
        )
        profile_id = self._resolve_profile_id(
            lifecycle_type=normalized_lifecycle_type,
            task_type=normalized_task_type,
            capability=capability,
            restored=restored,
        )
        with self._task_lock:
            if normalized_task_uuid in self._tasks:
                existing_task = dict(self._tasks.get(normalized_task_uuid) or {})
                logging.error(
                    "[FanxingBatchPoller] duplicate_active_task_registration task_uuid=%s existing_task_type=%s existing_generation_id=%s existing_profile=%s",
                    normalized_task_uuid,
                    str(existing_task.get("task_type") or "").strip(),
                    str(existing_task.get("generation_id") or "").strip(),
                    str(existing_task.get("profile_id") or "").strip(),
                )
                raise RuntimeError(
                    f"duplicate_active_task_registration:{normalized_task_uuid}"
                )
            self._tasks[normalized_task_uuid] = {
                "task_uuid": normalized_task_uuid,
                "base_url": base_url,
                "headers": headers,
                "callback": callback,
                "progress_callback": progress_callback,
                "status_callback": status_callback,
                "network_error_callback": network_error_callback,
                "task_index": task_index,
                "timeout": timeout,
                "start_time": current_time,
                "last_activity_time": current_time,  # 最后活动时间（用于超时检测）
                "last_status": "queued",
                "last_status_change_time": current_time,
                "last_progress": 0,
                "last_progress_change_time": current_time,
                "last_network_error_notify": 0.0,
                "network_retry_active": False,
                "concurrency_acquired": concurrency_acquired,
                "capability": capability,
                "state_enum": FanxingTaskState.QUEUED,
                "generation_id": str(generation_id or ""),
                "scheduler_task_id": normalized_scheduler_task_id,
                "defensive_strict_identity": bool(strict_identity),
                "restored": bool(restored),
                "task_type": normalized_task_type,
                "lifecycle_type": normalized_lifecycle_type,
                "base_profile_id": base_profile_id,
                "profile_id": profile_id,
                "consecutive_missing_responses": 0,
                "last_missing_probe_at": 0.0,
                "completed_without_results_count": 0,
                "first_completed_without_results_at": 0.0,
                "registered_auth_mode": registered_auth_mode,
                "registered_bearer_fingerprint": registered_bearer_fingerprint,
            }
            group_key = self._build_group_key(
                base_url=base_url,
                headers=headers,
                profile_id=profile_id,
            )
            self._ensure_group_state_locked(group_key, profile_id)
            task_data = dict(self._tasks[normalized_task_uuid])
            logging.info(
                "[FanxingBatchPoller] register_task trace=%s queue_size=%s timeout=%ss profile=%s",
                self._task_trace(
                    task_uuid=normalized_task_uuid,
                    task_data=task_data,
                    phase="poll_register",
                ),
                len(self._tasks),
                timeout,
                profile_id,
            )

        self._task_monitor.register_task(
            normalized_task_uuid,
            state="queued",
            progress=0,
        )
        try:
            ledger_record = get_task_ledger_store().update_task_state(
                normalized_task_uuid, "polling"
            )
            if ledger_record is None and strict_identity:
                self._lifecycle_guard.audit_orphan_poller_task(
                    task_uuid=normalized_task_uuid,
                    generation_id=str(generation_id or "").strip(),
                    scheduler_task_id=normalized_scheduler_task_id,
                    task_type=normalized_task_type,
                    reason="ledger_missing_on_poll_register",
                )
        except Exception:
            logging.exception("[TaskLedger] 更新 polling 状态失败")
        self._emit_task_event(
            FanxingEventType.TASK_CREATED,
            normalized_task_uuid,
            state="queued",
            progress=0,
            capability=capability,
        )

        # 确保轮询线程在运行
        self._ensure_poll_thread()
        self._lifecycle_guard.log_health_snapshot(
            reason="poll_register",
            poller_snapshot=self.get_defensive_snapshot(),
        )

    def has_task(self, task_uuid: str) -> bool:
        target = str(task_uuid or "").strip()
        if not target:
            return False
        with self._task_lock:
            return target in self._tasks

    def get_defensive_snapshot(self) -> Dict[str, Any]:
        with self._task_lock:
            tasks = [dict(item or {}) for item in self._tasks.values()]
        by_profile: Dict[str, int] = {}
        callback_active_count = 0
        callbacks_detached_count = 0
        for task in tasks:
            profile_id = str(task.get("profile_id") or "-").strip() or "-"
            by_profile[profile_id] = by_profile.get(profile_id, 0) + 1
            if any(
                bool(task.get(key))
                for key in (
                    "callback",
                    "progress_callback",
                    "status_callback",
                    "network_error_callback",
                )
            ):
                callback_active_count += 1
            if bool(task.get("callbacks_detached")):
                callbacks_detached_count += 1
        return {
            "active_count": len(tasks),
            "callback_active_count": callback_active_count,
            "callbacks_detached_count": callbacks_detached_count,
            "by_profile": dict(sorted(by_profile.items())),
            "active_task_uuids": [
                str(task.get("task_uuid") or "").strip()
                for task in tasks
                if str(task.get("task_uuid") or "").strip()
                and bool(task.get("defensive_strict_identity"))
            ],
            "all_task_uuids": [
                str(task.get("task_uuid") or "").strip()
                for task in tasks
                if str(task.get("task_uuid") or "").strip()
            ],
            "tasks": [
                {
                    "task_uuid": str(task.get("task_uuid") or "").strip(),
                    "generation_id": str(task.get("generation_id") or "").strip(),
                    "scheduler_task_id": str(
                        task.get("scheduler_task_id") or ""
                    ).strip(),
                    "task_index": task.get("task_index"),
                    "task_type": str(task.get("task_type") or "").strip(),
                    "state": getattr(
                        task.get("state_enum"),
                        "name",
                        str(task.get("state_enum") or ""),
                    ).lower(),
                    "has_callback": any(
                        bool(task.get(key))
                        for key in (
                            "callback",
                            "progress_callback",
                            "status_callback",
                            "network_error_callback",
                        )
                    ),
                    "callbacks_detached": bool(task.get("callbacks_detached")),
                    "defensive_strict_identity": bool(
                        task.get("defensive_strict_identity")
                    ),
                }
                for task in tasks[:100]
            ],
            "task_uuids": [
                str(task.get("task_uuid") or "").strip()
                for task in tasks[:20]
                if str(task.get("task_uuid") or "").strip()
            ],
        }

    def _maybe_run_defensive_health_audit(self, *, phase: str = "poll_once") -> None:
        config = get_enhancement_config()
        if not bool(getattr(config, "use_lifecycle_guard", True)):
            return
        interval = max(
            1.0,
            float(getattr(config, "lifecycle_guard_health_interval", 30.0) or 30.0),
        )
        now = time.time()
        if now - float(self._last_defensive_audit_at or 0.0) < interval:
            return
        self._last_defensive_audit_at = now

        poller_snapshot = self.get_defensive_snapshot()
        self._lifecycle_guard.audit_poller_snapshot(
            poller_snapshot,
            phase=phase,
        )
        self._lifecycle_guard.audit_waiting_threads(phase=phase)

        dispatcher_snapshot = {}
        try:
            from workers.fanxing.task_dispatcher import get_fanxing_task_dispatcher

            dispatcher_snapshot = (
                get_fanxing_task_dispatcher().get_defensive_snapshot()
            )
            self._lifecycle_guard.audit_dispatcher_snapshot(
                dispatcher_snapshot,
                poller_snapshot=poller_snapshot,
                phase=phase,
            )
        except Exception:
            logging.exception("[FanxingDefensive] dispatcher snapshot audit failed")

        result_dispatcher_snapshot = {}
        try:
            from workers.fanxing.result_dispatcher import (
                get_fanxing_result_dispatcher,
            )

            result_dispatcher_snapshot = (
                get_fanxing_result_dispatcher().get_defensive_snapshot()
            )
            self._lifecycle_guard.audit_result_dispatcher_snapshot(
                result_dispatcher_snapshot,
                phase=phase,
            )
        except Exception:
            logging.exception(
                "[FanxingDefensive] result dispatcher snapshot audit failed"
            )

        result_delivery_bridge_snapshot = {}
        try:
            from workers.fanxing.result_delivery_bridge import (
                get_fanxing_result_delivery_bridge,
            )

            result_delivery_bridge_snapshot = (
                get_fanxing_result_delivery_bridge().get_defensive_snapshot()
            )
            self._lifecycle_guard.audit_result_delivery_bridge_snapshot(
                result_delivery_bridge_snapshot,
                phase=phase,
            )
        except Exception:
            logging.exception(
                "[FanxingDefensive] result delivery bridge snapshot audit failed"
            )

        result_finish_bridge_snapshot = {}
        try:
            from workers.fanxing.result_finish_bridge import (
                get_fanxing_result_finish_bridge,
            )

            finish_bridge = get_fanxing_result_finish_bridge()
            finish_bridge.audit_missing_after_delivery(
                delivery_snapshot=result_delivery_bridge_snapshot,
                poller_snapshot=poller_snapshot,
                phase=phase,
            )
            result_finish_bridge_snapshot = (
                finish_bridge.get_defensive_snapshot()
            )
            self._lifecycle_guard.audit_result_finish_bridge_snapshot(
                result_finish_bridge_snapshot,
                phase=phase,
            )
        except Exception:
            logging.exception(
                "[FanxingDefensive] result finish bridge snapshot audit failed"
            )

        active_ledger_records = []
        try:
            active_ledger_records = get_task_ledger_store().find_active_records()
        except Exception:
            logging.exception("[FanxingDefensive] ledger active snapshot failed")
        self._lifecycle_guard.audit_ledger_poller_consistency(
            active_ledger_records=active_ledger_records,
            poller_snapshot=poller_snapshot,
            phase=phase,
        )
        self._lifecycle_guard.audit_waiting_poller_consistency(
            poller_snapshot=poller_snapshot,
            phase=phase,
        )

        scheduler_snapshot = {}
        try:
            from managers.task_scheduler import get_global_image_task_scheduler

            scheduler = get_global_image_task_scheduler()
            scheduler_snapshot = scheduler.get_debug_snapshot(
                "fanxing_image_generation"
            )
            self._lifecycle_guard.audit_scheduler_snapshot(
                scheduler_snapshot,
                phase=phase,
            )
            self._lifecycle_guard.audit_scheduler_terminal_leases(
                scheduler_snapshot=scheduler_snapshot,
                task_lookup=scheduler.get_task,
                phase=phase,
            )
        except Exception:
            logging.exception("[FanxingDefensive] scheduler snapshot audit failed")

        self._lifecycle_guard.log_health_snapshot(
            reason=phase,
            scheduler_snapshot=scheduler_snapshot,
            poller_snapshot=poller_snapshot,
            dispatcher_snapshot=dispatcher_snapshot,
            result_dispatcher_snapshot=result_dispatcher_snapshot,
            result_delivery_bridge_snapshot=result_delivery_bridge_snapshot,
            result_finish_bridge_snapshot=result_finish_bridge_snapshot,
            min_interval_sec=interval,
        )

    def acquire_generation_slot(
        self,
        *,
        capability: str = "image_generation",
        timeout: int = 300,
    ) -> bool:
        config = get_enhancement_config()
        if not config.use_concurrency_control:
            return False
        acquired = self._concurrency.acquire(
            channel="fanxing",
            capability=capability,
            priority=TaskPriority.NORMAL,
            blocking=True,
            timeout=float(timeout or 0),
        )
        if not acquired:
            raise RuntimeError("服务器繁忙，请稍后再试")
        return True

    def release_generation_slot(self, *, capability: str = "image_generation") -> None:
        config = get_enhancement_config()
        if not config.use_concurrency_control:
            return
        self._concurrency.release(channel="fanxing", capability=capability)

    def unregister_task(self, task_uuid: str) -> None:
        """取消注册任务（用于用户中止）"""
        task_data = None
        with self._task_lock:
            if task_uuid in self._tasks:
                task_data = self._tasks.pop(task_uuid)
                logging.debug(f"[FanxingBatchPoller] 取消任务: {task_uuid}")

        self._clear_task_log_state(task_uuid)
        self._task_monitor.unregister_task(task_uuid)
        self._release_concurrency_for_task(task_data)
        if task_data is not None:
            try:
                get_task_ledger_store().update_task_state(
                    task_uuid,
                    "canceled",
                    last_error="user_unregister",
                    meta={"cancel_scope": "remote_submitted"},
                )
            except Exception:
                logging.exception("[TaskLedger] 更新 canceled 状态失败")
            self._emit_task_event(
                FanxingEventType.TASK_CANCEL_REQUEST,
                task_uuid,
                reason="user_unregister",
            )
            self._event_bus.emit(
                self._event_bus.create_task_event(
                    FanxingEventType.TASK_CANCELLED,
                    task_id=task_uuid,
                    generation_id=str(task_data.get("generation_id") or ""),
                    reason="user_unregister",
                )
            )
            callback = task_data.get("callback")
            self._record_terminal_result_for_dispatcher(
                task_uuid=task_uuid,
                success=False,
                result_or_error=f"任务已取消 [ID: {task_uuid[:8]}]",
                task_data=task_data,
                callback=callback,
            )
            if callback:
                self._execute_callback_safely(
                    callback,
                    task_uuid,
                    False,
                    f"任务已取消 [ID: {task_uuid[:8]}]",
                )
            self._publish_terminal_result_for_dispatcher(
                task_uuid=task_uuid,
                phase="unregister_task",
            )
        self._lifecycle_guard.log_health_snapshot(
            reason="poll_unregister",
            poller_snapshot=self.get_defensive_snapshot(),
        )

    def detach_generation_callbacks(
        self,
        generation_id: str,
        *,
        task_uuids: Optional[List[str]] = None,
        reason: str = "",
    ) -> int:
        """Detach local callbacks without canceling remote polling tasks."""
        normalized_generation_id = str(generation_id or "").strip()
        targets = {
            str(task_uuid or "").strip()
            for task_uuid in list(task_uuids or [])
            if str(task_uuid or "").strip()
        }
        if not normalized_generation_id and not targets:
            return 0

        detached = 0
        with self._task_lock:
            for task_uuid, task_data in list(self._tasks.items()):
                if targets and str(task_uuid or "").strip() not in targets:
                    continue
                if (
                    not targets
                    and normalized_generation_id
                    and str((task_data or {}).get("generation_id") or "").strip()
                    != normalized_generation_id
                ):
                    continue
                had_callback = any(
                    bool((task_data or {}).get(key))
                    for key in (
                        "callback",
                        "progress_callback",
                        "status_callback",
                        "network_error_callback",
                    )
                )
                task_data["callback"] = None
                task_data["progress_callback"] = None
                task_data["status_callback"] = None
                task_data["network_error_callback"] = None
                task_data["callbacks_detached"] = True
                task_data["callbacks_detached_reason"] = (
                    str(reason or "").strip() or "worker_detach"
                )
                task_data["callbacks_detached_at"] = time.time()
                if had_callback:
                    detached += 1

        if detached:
            logging.info(
                "[FanxingBatchPoller] callbacks_detached generation_id=%s task_filter=%s detached=%s reason=%s",
                normalized_generation_id or "<empty>",
                len(targets),
                detached,
                str(reason or "").strip() or "worker_detach",
            )
        return detached

    def abort_generation_tasks(
        self,
        generation_id: str,
        *,
        final_state: str = "failed",
        error_message: str = "",
    ) -> int:
        normalized_generation_id = str(generation_id or "").strip()
        normalized_state = str(final_state or "").strip() or "failed"
        if not normalized_generation_id:
            return 0

        removed_tasks = []
        with self._task_lock:
            for task_uuid, task_data in list(self._tasks.items()):
                if (
                    str((task_data or {}).get("generation_id") or "").strip()
                    != normalized_generation_id
                ):
                    continue
                removed = dict(task_data or {})
                removed["task_uuid"] = str(task_uuid or "").strip()
                self._tasks.pop(task_uuid, None)
                self._task_monitor.unregister_task(task_uuid)
                removed_tasks.append(removed)

        for task_data in removed_tasks:
            task_uuid = str(task_data.get("task_uuid") or "").strip()
            self._clear_task_log_state(task_uuid)
            self._release_concurrency_for_task(task_data)
            try:
                get_task_ledger_store().update_task_state(
                    task_uuid,
                    normalized_state,
                    last_error=str(error_message or "").strip(),
                    last_transition_reason="generation_abort_cleanup",
                )
            except Exception:
                logging.exception(
                    "[TaskLedger] generation abort cleanup failed task_uuid=%s",
                    task_uuid,
                )
            callback = task_data.get("callback")
            if normalized_state in {"failed", "canceled"}:
                self._record_terminal_result_for_dispatcher(
                    task_uuid=task_uuid,
                    success=False,
                    result_or_error=(
                        str(error_message or "").strip()
                        or (
                            f"任务已取消 [ID: {task_uuid[:8]}]"
                            if normalized_state == "canceled"
                            else f"任务已终止 [ID: {task_uuid[:8]}]"
                        )
                    ),
                    task_data=task_data,
                    callback=callback,
                )
            if callback:
                if normalized_state == "canceled":
                    callback_error = f"任务已取消 [ID: {task_uuid[:8]}]"
                else:
                    callback_error = (
                        str(error_message or "").strip()
                        or f"任务已终止 [ID: {task_uuid[:8]}]"
                    )
                self._execute_callback_safely(
                    callback,
                    task_uuid,
                    False,
                    callback_error,
                )
            if normalized_state in {"failed", "canceled"}:
                self._publish_terminal_result_for_dispatcher(
                    task_uuid=task_uuid,
                    phase="abort_generation_tasks",
                )

        if removed_tasks:
            logging.warning(
                "[FanxingBatchPoller] abort_generation_tasks generation_id=%s final_state=%s removed=%s reason=%s",
                normalized_generation_id,
                normalized_state,
                len(removed_tasks),
                str(error_message or "").strip(),
            )
        return len(removed_tasks)

    def abort_tasks(
        self,
        task_uuids: List[str],
        *,
        final_state: str = "failed",
        error_message: str = "",
    ) -> int:
        targets = {
            str(task_uuid or "").strip()
            for task_uuid in list(task_uuids or [])
            if str(task_uuid or "").strip()
        }
        normalized_state = str(final_state or "").strip() or "failed"
        if not targets:
            return 0

        removed_tasks = []
        with self._task_lock:
            for task_uuid in list(targets):
                task_data = self._tasks.pop(task_uuid, None)
                if not task_data:
                    continue
                removed = dict(task_data or {})
                removed["task_uuid"] = task_uuid
                self._task_monitor.unregister_task(task_uuid)
                removed_tasks.append(removed)

        for task_data in removed_tasks:
            task_uuid = str(task_data.get("task_uuid") or "").strip()
            self._clear_task_log_state(task_uuid)
            self._release_concurrency_for_task(task_data)
            try:
                get_task_ledger_store().update_task_state(
                    task_uuid,
                    normalized_state,
                    last_error=str(error_message or "").strip(),
                    last_transition_reason="task_abort_cleanup",
                )
            except Exception:
                logging.exception(
                    "[TaskLedger] task abort cleanup failed task_uuid=%s",
                    task_uuid,
                )
            callback = task_data.get("callback")
            if normalized_state in {"failed", "canceled"}:
                self._record_terminal_result_for_dispatcher(
                    task_uuid=task_uuid,
                    success=False,
                    result_or_error=(
                        str(error_message or "").strip()
                        or (
                            f"任务已取消 [ID: {task_uuid[:8]}]"
                            if normalized_state == "canceled"
                            else f"任务已终止 [ID: {task_uuid[:8]}]"
                        )
                    ),
                    task_data=task_data,
                    callback=callback,
                )
            if callback:
                if normalized_state == "canceled":
                    callback_error = f"任务已取消 [ID: {task_uuid[:8]}]"
                else:
                    callback_error = (
                        str(error_message or "").strip()
                        or f"任务已终止 [ID: {task_uuid[:8]}]"
                    )
                self._execute_callback_safely(
                    callback,
                    task_uuid,
                    False,
                    callback_error,
                )
            if normalized_state in {"failed", "canceled"}:
                self._publish_terminal_result_for_dispatcher(
                    task_uuid=task_uuid,
                    phase="abort_tasks",
                )

        if removed_tasks:
            logging.warning(
                "[FanxingBatchPoller] abort_tasks final_state=%s removed=%s reason=%s tasks=%s",
                normalized_state,
                len(removed_tasks),
                str(error_message or "").strip(),
                ",".join(str(item.get("task_uuid") or "")[:8] for item in removed_tasks),
            )
        return len(removed_tasks)

    def _release_concurrency_for_task(self, task_data: Optional[dict]) -> None:
        if not task_data:
            return
        if not task_data.get("concurrency_acquired"):
            return
        capability = str(task_data.get("capability") or "image_generation")
        self._concurrency.release(channel="fanxing", capability=capability)

    def _transition_task_state(
        self,
        task_uuid: str,
        to_state: FanxingTaskState,
    ) -> None:
        config = get_enhancement_config()
        with self._task_lock:
            task_data = self._tasks.get(task_uuid)
            if not task_data:
                return
            from_state = task_data.get("state_enum") or FanxingTaskState.QUEUED
            if config.use_state_validation:
                is_restored = bool(task_data.get("restored"))
                if not (
                    is_restored
                    and from_state == FanxingTaskState.QUEUED
                    and to_state
                    in {
                        FanxingTaskState.PROCESSING,
                        FanxingTaskState.DOWNLOADING,
                        FanxingTaskState.COMPLETED,
                        FanxingTaskState.FAILED,
                        FanxingTaskState.TIMEOUT,
                        FanxingTaskState.CANCELLED,
                    }
                ):
                    self._state_validator.validate(from_state, to_state)
            task_data["state_enum"] = to_state
            task_data["restored"] = False
            generation_id = str(task_data.get("generation_id") or "")

        if not getattr(config, "use_event_bus", False):
            return

        state_name = to_state.name.lower()
        event_type = None
        extra_data = {"state": state_name}
        if to_state == FanxingTaskState.PROCESSING:
            event_type = FanxingEventType.TASK_STARTED
        elif to_state == FanxingTaskState.CANCELLED:
            event_type = FanxingEventType.TASK_CANCELLED
        elif to_state == FanxingTaskState.TIMEOUT:
            event_type = FanxingEventType.TASK_TIMEOUT

        if event_type:
            event = self._event_bus.create_task_event(
                event_type=event_type,
                task_id=task_uuid,
                generation_id=generation_id,
                **extra_data,
            )
            self._event_bus.emit(event)

    def _ensure_poll_thread(self) -> None:
        """确保轮询线程在运行（线程安全）"""
        with self._lock:  # 使用类级锁避免竞态
            if self._poll_thread is None or not self._poll_thread.is_alive():
                self._stop_event.clear()
                self._poll_thread = threading.Thread(
                    target=self._poll_loop, daemon=True
                )
                self._poll_thread.start()
                logging.debug("[FanxingBatchPoller] 轮询线程已启动")

    def _poll_loop(self) -> None:
        """轮询主循环"""
        logging.debug("[FanxingBatchPoller] 轮询循环开始")

        while not self._stop_event.is_set():
            wait_time = self._base_poll_interval
            try:
                wait_time = self._poll_once()
            except Exception as e:
                logging.error(f"[FanxingBatchPoller] 轮询异常: {e}")

            # 检查是否还有任务
            with self._task_lock:
                if not self._tasks:
                    logging.debug("[FanxingBatchPoller] 无待轮询任务，线程退出")
                    break

            wait_time = max(0.2, float(wait_time or self._base_poll_interval))
            self._stop_event.wait(wait_time)

        logging.debug("[FanxingBatchPoller] 轮询循环结束")

    def _calculate_group_interval(
        self,
        *,
        group_key: str,
        task_snapshots: List[dict],
    ) -> float:
        if not task_snapshots:
            return self._base_poll_interval

        group_state = self._group_states.get(str(group_key or "").strip()) or {}
        profile_id = str(group_state.get("profile_id") or "").strip() or "interactive_image_generation"
        config = self._get_profile_config(profile_id)
        consecutive_errors = int(group_state.get("consecutive_errors") or 0)

        if consecutive_errors >= self._max_consecutive_errors:
            backoff = min(
                float(config.get("base_interval") or self._base_poll_interval)
                * (
                    2
                    ** (
                        consecutive_errors - self._max_consecutive_errors + 1
                    )
                ),
                float(config.get("network_backoff_cap") or 15.0),
            )
            logging.debug(
                "[FanxingBatchPoller] 连续错误退避: group=%s profile=%s interval=%.1fs retry=%s",
                group_key,
                profile_id,
                backoff,
                consecutive_errors,
            )
            return backoff

        progresses = [int(t.get("last_progress", 0) or 0) for t in task_snapshots]
        max_progress = max(progresses) if progresses else 0
        avg_progress = (sum(progresses) / len(progresses)) if progresses else 0.0
        statuses = {
            str(t.get("last_status") or "").strip().lower()
            for t in task_snapshots
            if str(t.get("last_status") or "").strip()
        }

        base_interval = float(config.get("base_interval") or self._base_poll_interval)
        min_interval = float(config.get("min_interval") or self._min_poll_interval)
        max_interval = float(config.get("max_interval") or self._max_poll_interval)
        interval = base_interval

        if bool(config.get("use_progress_curve", False)):
            mid_progress_min = int(config.get("mid_progress_min") or 50)
            late_progress_min = int(config.get("late_progress_min") or 80)
            if max_progress >= late_progress_min:
                interval = min_interval
            elif max_progress >= mid_progress_min:
                denominator = max(1, late_progress_min - mid_progress_min)
                ratio = (max_progress - mid_progress_min) / denominator
                interval = base_interval - ratio * (base_interval - min_interval)
            elif avg_progress <= 10:
                interval = max_interval
            else:
                interval = base_interval
        else:
            late_progress_min = int(config.get("late_progress_min") or 100)
            queued_statuses = set(config.get("queued_statuses") or {"queued", "pending"})
            processing_statuses = {"processing", "running", "in_progress"}
            processing_interval = float(config.get("processing_interval") or base_interval)
            if max_progress >= late_progress_min:
                interval = min_interval
            elif statuses and statuses.issubset(queued_statuses):
                interval = max_interval
            elif statuses & processing_statuses:
                interval = processing_interval
            else:
                interval = base_interval

        max_stagnation = self._calculate_max_stagnation_seconds(task_snapshots)
        stagnation_bucket = None
        if max_progress < max(int(config.get("late_progress_min") or 100), 80):
            stagnation_interval = self._get_stagnation_interval(
                max_stagnation,
                config.get("stagnation_steps"),
            )
            if stagnation_interval > 0:
                interval = max(interval, stagnation_interval)
                stagnation_bucket = int(stagnation_interval)

        self._log_group_interval_decision(
            group_key=str(group_key or "").strip(),
            profile_id=profile_id,
            interval=interval,
            max_progress=max_progress,
            avg_progress=avg_progress,
            max_stagnation=max_stagnation,
            stagnation_bucket=stagnation_bucket,
        )
        return interval

    @staticmethod
    def _calculate_max_stagnation_seconds(task_snapshots: List[dict]) -> float:
        if not task_snapshots:
            return 0.0

        now = time.time()
        max_stagnation = 0.0
        for task_data in task_snapshots:
            status_change_time = float(
                task_data.get(
                    "last_status_change_time", task_data.get("start_time", now)
                )
                or now
            )
            progress_change_time = float(
                task_data.get(
                    "last_progress_change_time", task_data.get("start_time", now)
                )
                or now
            )
            stagnation_seconds = max(
                0.0,
                now - max(status_change_time, progress_change_time),
            )
            max_stagnation = max(max_stagnation, stagnation_seconds)
        return max_stagnation

    @staticmethod
    def _get_stagnation_interval(
        stagnation_seconds: float, steps: Optional[tuple] = None
    ) -> float:
        normalized_steps = list(steps or ((60.0, 8.0), (180.0, 12.0), (300.0, 15.0)))
        selected = 0.0
        for threshold, interval in normalized_steps:
            if float(stagnation_seconds or 0.0) >= float(threshold or 0.0):
                selected = float(interval or 0.0)
        if selected > 0:
            return selected
        return 0.0

    def _should_emit_periodic_log(self, every: int) -> bool:
        interval = max(1, int(every or 1))
        return self._poll_iteration <= 1 or self._poll_iteration % interval == 0

    def _should_log_poll_summary(self, poll_groups_summary: List[dict]) -> bool:
        signature_parts = []
        for item in poll_groups_summary:
            task_ids = ",".join(sorted(item.get("task_uuids") or []))
            signature_parts.append(
                "|".join(
                    [
                        str(item.get("group_key") or ""),
                        str(item.get("count") or 0),
                        task_ids,
                    ]
                )
            )
        signature = "||".join(sorted(signature_parts))
        with self._log_state_lock:
            changed = signature != self._last_poll_summary_signature
            if changed:
                self._last_poll_summary_signature = signature
        return changed or self._should_emit_periodic_log(10)

    def _should_log_batch_response(
        self,
        group_key: str,
        *,
        requested_count: int,
        returned_count: int,
        response_briefs: List[str],
    ) -> bool:
        signature = "|".join(
            [
                str(group_key or ""),
                str(requested_count),
                str(returned_count),
                ";".join(response_briefs),
            ]
        )
        with self._log_state_lock:
            previous = self._last_batch_response_signatures.get(group_key)
            changed = signature != previous
            if changed:
                self._last_batch_response_signatures[group_key] = signature
        return changed or self._should_emit_periodic_log(10)

    def _should_log_task_status_raw(
        self,
        task_uuid: str,
        *,
        status: str,
        progress,
        error_message: str,
    ) -> bool:
        signature = "|".join(
            [
                str(status or "").strip().lower() or "-",
                str(progress),
                str(error_message or "").strip()[:120] or "-",
            ]
        )
        normalized_task_uuid = str(task_uuid or "").strip()
        with self._log_state_lock:
            previous = self._last_task_status_signatures.get(normalized_task_uuid)
            changed = signature != previous
            if changed:
                self._last_task_status_signatures[normalized_task_uuid] = signature
        return changed or self._should_emit_periodic_log(10)

    def _clear_task_log_state(self, task_uuid: str) -> None:
        normalized_task_uuid = str(task_uuid or "").strip()
        if not normalized_task_uuid:
            return
        with self._log_state_lock:
            self._last_task_status_signatures.pop(normalized_task_uuid, None)

    @staticmethod
    def _build_header_fingerprint(headers: dict) -> str:
        if not isinstance(headers, dict) or not headers:
            return ""
        normalized = []
        for key, value in sorted(
            headers.items(), key=lambda item: str(item[0]).lower()
        ):
            normalized.append(f"{str(key).strip().lower()}={str(value).strip()}")
        raw = "|".join(normalized)
        if not raw:
            return ""
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]

    @staticmethod
    def _build_token_fingerprint(token: str) -> str:
        normalized = str(token or "").strip()
        if not normalized:
            return ""
        return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]

    def _resolve_current_auth_scope(self) -> dict:
        try:
            resolver = ActiveAuthContextResolver(get_active_config_manager())
            active_auth = resolver.resolve(
                server_id=SERVER_ID_FANXING,
                visible_only=False,
            )
            return {
                "resolved": True,
                "auth_mode": active_auth.normalized_auth_mode,
                "bearer_fingerprint": self._build_token_fingerprint(
                    active_auth.normalized_bearer_token
                ),
            }
        except Exception as exc:
            logging.exception("[FanxingBatchPoller] resolve current auth scope failed")
            return {
                "resolved": False,
                "auth_mode": "",
                "bearer_fingerprint": "",
                "error": str(exc),
            }

    def _log_tasks_with_changed_auth_scope(self) -> None:
        """Log auth-scope drift without aborting submitted remote tasks.

        Fanxing tasks are charged and bound to the headers used at submission time.
        Polling groups already keep those registered headers, so a later global auth
        mode/token switch should not prevent the user from receiving old results.
        """
        current_scope = self._resolve_current_auth_scope()
        with self._task_lock:
            for task_uuid, task_data in list(self._tasks.items()):
                registered_auth_mode = str(
                    task_data.get("registered_auth_mode") or ""
                ).strip()
                registered_bearer_fingerprint = str(
                    task_data.get("registered_bearer_fingerprint") or ""
                ).strip()
                if not registered_auth_mode and not registered_bearer_fingerprint:
                    continue
                current_bearer_fingerprint = str(
                    current_scope.get("bearer_fingerprint") or ""
                ).strip()
                if registered_bearer_fingerprint and not current_bearer_fingerprint:
                    if self._should_emit_periodic_log(10):
                        logging.warning(
                            "[FanxingBatchPoller] keep polling with registered headers; current bearer unavailable task_uuid=%s registered_mode=%s current_mode=%s resolved=%s error=%s",
                            str(task_uuid or "").strip(),
                            registered_auth_mode,
                            str(current_scope.get("auth_mode") or "").strip(),
                            bool(current_scope.get("resolved", False)),
                            str(current_scope.get("error") or "").strip(),
                        )
                    continue
                if (
                    registered_auth_mode
                    and registered_auth_mode
                    != str(current_scope.get("auth_mode") or "").strip()
                ):
                    if self._should_emit_periodic_log(10):
                        logging.warning(
                            "[FanxingBatchPoller] auth mode switched; keep polling with registered headers task_uuid=%s registered_mode=%s current_mode=%s",
                            str(task_uuid or "").strip(),
                            registered_auth_mode,
                            str(current_scope.get("auth_mode") or "").strip(),
                        )
                    continue
                if (
                    registered_bearer_fingerprint
                    and registered_bearer_fingerprint
                    != current_bearer_fingerprint
                ):
                    if self._should_emit_periodic_log(10):
                        logging.warning(
                            "[FanxingBatchPoller] auth bearer switched; keep polling with registered headers task_uuid=%s registered_fp=%s current_fp=%s",
                            str(task_uuid or "").strip(),
                            registered_bearer_fingerprint,
                            current_bearer_fingerprint,
                        )

    def _collect_poll_groups(self, now: Optional[float] = None) -> tuple:
        current_time = float(now or time.time())
        groups: Dict[str, Dict[str, object]] = {}
        all_task_uuids = []

        self._log_tasks_with_changed_auth_scope()

        with self._task_lock:
            if not self._tasks:
                return {}, []

            active_group_keys = set()
            for task_uuid, info in self._tasks.items():
                task_data = self._tasks.get(task_uuid) or {}
                profile_id = str(
                    task_data.get("profile_id")
                    or self._resolve_profile_id(
                        lifecycle_type=str(
                            task_data.get("lifecycle_type") or ""
                        ).strip(),
                        task_type=str(task_data.get("task_type") or "").strip(),
                        capability=str(task_data.get("capability") or "").strip(),
                        restored=bool(task_data.get("restored")),
                    )
                ).strip() or "interactive_image_generation"
                task_data["profile_id"] = profile_id
                group_key = self._compute_task_group_key(task_data)
                active_group_keys.add(group_key)
                group_state = self._sanitize_group_schedule_locked(
                    current_time=current_time,
                    group_key=group_key,
                    profile_id=profile_id,
                    active_task_count=len(list(groups.get(group_key, {}).get("task_uuids") or []))
                    + 1,
                )
                if group_key not in groups:
                    groups[group_key] = {
                        "group_key": group_key,
                        "profile_id": profile_id,
                        "base_url": str(task_data.get("base_url") or "").strip(),
                        "headers": dict(task_data.get("headers") or {}),
                        "task_uuids": [],
                        "task_snapshots": [],
                        "due": float(group_state.get("next_due_at") or 0.0) <= current_time,
                    }
                groups[group_key]["task_uuids"].append(task_uuid)
                groups[group_key]["task_snapshots"].append(dict(task_data))
                all_task_uuids.append(task_uuid)

            self._prune_group_states_locked(active_group_keys)

        return groups, all_task_uuids

    def _get_group_task_snapshots(self, group_key: str) -> List[dict]:
        normalized_group_key = str(group_key or "").strip()
        snapshots = []
        with self._task_lock:
            for task_data in self._tasks.values():
                if self._compute_task_group_key(task_data) != normalized_group_key:
                    continue
                snapshots.append(dict(task_data or {}))
        return snapshots

    def _schedule_group_next_due(self, group_key: str) -> None:
        snapshots = self._get_group_task_snapshots(group_key)
        normalized_group_key = str(group_key or "").strip()
        with self._task_lock:
            if not snapshots:
                self._group_states.pop(normalized_group_key, None)
                return
            group_state = self._ensure_group_state_locked(
                normalized_group_key,
                str((snapshots[0] or {}).get("profile_id") or "").strip(),
            )
            interval = self._calculate_group_interval(
                group_key=normalized_group_key,
                task_snapshots=snapshots,
            )
            group_state["next_due_at"] = time.time() + max(0.2, float(interval or 0.2))

    def _record_group_poll_started(self, group_key: str) -> None:
        normalized_group_key = str(group_key or "").strip()
        if not normalized_group_key:
            return
        with self._task_lock:
            group_state = self._group_states.get(normalized_group_key)
            if group_state is not None:
                group_state["last_polled_at"] = time.time()

    def _record_group_poll_succeeded(self, group_key: str) -> None:
        normalized_group_key = str(group_key or "").strip()
        if not normalized_group_key:
            return
        with self._task_lock:
            group_state = self._group_states.get(normalized_group_key)
            if group_state is not None:
                now = time.time()
                group_state["last_success_at"] = now
                group_state["last_polled_at"] = now

    def _mark_task_missing_and_should_probe(self, task_uuid: str) -> bool:
        normalized_task_uuid = str(task_uuid or "").strip()
        if not normalized_task_uuid:
            return False
        now = time.time()
        with self._task_lock:
            task_data = self._tasks.get(normalized_task_uuid)
            if not task_data:
                return False
            missing_count = int(task_data.get("consecutive_missing_responses") or 0) + 1
            task_data["consecutive_missing_responses"] = missing_count
            last_probe_at = float(task_data.get("last_missing_probe_at") or 0.0)
            if missing_count < self._missing_task_probe_threshold:
                return False
            if now - last_probe_at < self._missing_task_probe_cooldown_seconds:
                return False
            task_data["last_missing_probe_at"] = now
            return True

    def _reset_task_missing_state(self, task_uuid: str) -> None:
        normalized_task_uuid = str(task_uuid or "").strip()
        if not normalized_task_uuid:
            return
        with self._task_lock:
            task_data = self._tasks.get(normalized_task_uuid)
            if not task_data:
                return
            task_data["consecutive_missing_responses"] = 0

    def _probe_single_task(
        self, base_url: str, headers: dict, task_uuid: str, group_key: str
    ) -> bool:
        normalized_task_uuid = str(task_uuid or "").strip()
        if not normalized_task_uuid:
            return False

        protocol = HuanyuApiSysProtocol()
        auth = build_auth_context_from_headers(
            base_url=str(base_url or "").strip(),
            headers=headers,
            use_host_tenant=False,
        )
        query_url = protocol.build_task_query_url(auth, normalized_task_uuid)

        try:
            if self._session is None:
                self._session = self._create_session()
            self._refresh_runtime_config()
            response = self._session.get(
                query_url,
                headers=headers,
                timeout=(
                    self._batch_query_connect_timeout_seconds,
                    self._batch_query_read_timeout_seconds,
                ),
            )
            if response.status_code != 200:
                logging.warning(
                    "[FanxingBatchPoller] single_probe_http_error group=%s task=%s status=%s",
                    group_key,
                    self._build_poll_task_brief(normalized_task_uuid),
                    response.status_code,
                )
                return False

            payload = response.json()
            if not payload.get("success"):
                logging.warning(
                    "[FanxingBatchPoller] single_probe_failed group=%s task=%s error=%s",
                    group_key,
                    self._build_poll_task_brief(normalized_task_uuid),
                    payload.get("msg"),
                )
                return False

            task_info = payload.get("data") or {}
            if not isinstance(task_info, dict):
                logging.warning(
                    "[FanxingBatchPoller] single_probe_invalid_payload group=%s task=%s payload_type=%s",
                    group_key,
                    self._build_poll_task_brief(normalized_task_uuid),
                    type(task_info),
                )
                return False

            task_info = dict(task_info)
            task_info.setdefault("task_uuid", normalized_task_uuid)
            logging.warning(
                "[FanxingBatchPoller] single_probe_recovered group=%s task=%s status=%s progress=%s",
                group_key,
                self._build_poll_task_brief(normalized_task_uuid),
                str(task_info.get("status") or "").strip() or "-",
                task_info.get("progress", "-"),
            )
            self._process_task_status(normalized_task_uuid, task_info)
            self._reset_task_missing_state(normalized_task_uuid)
            return True
        except Exception as exc:
            logging.warning(
                "[FanxingBatchPoller] single_probe_exception group=%s task=%s error=%s",
                group_key,
                self._build_poll_task_brief(normalized_task_uuid),
                exc,
            )
            return False

    def _handle_missing_tasks_with_fallback(
        self, base_url: str, headers: dict, group_key: str, missing_task_uuids: List[str]
    ) -> None:
        probe_targets = []
        for task_uuid in list(missing_task_uuids or []):
            if self._mark_task_missing_and_should_probe(task_uuid):
                probe_targets.append(str(task_uuid or "").strip())

        for task_uuid in probe_targets:
            self._probe_single_task(base_url, headers, task_uuid, group_key)

    def _persist_completion_checkpoint(
        self, task_uuid: str, result_urls: List[str], *, reason: str = ""
    ) -> None:
        normalized_task_uuid = str(task_uuid or "").strip()
        normalized_result_urls = [
            str(url or "").strip() for url in list(result_urls or []) if str(url or "").strip()
        ]
        if not normalized_task_uuid or not normalized_result_urls:
            return

        try:
            ledger = get_task_ledger_store()
            existing_record = ledger.find_record_by_provider_task_uuid(normalized_task_uuid) or {}
            existing_meta = (
                existing_record.get("meta") if isinstance(existing_record, dict) else {}
            )
            checkpoint_meta = self._build_completion_checkpoint_meta(
                existing_meta,
                normalized_result_urls,
                reason=str(reason or "poll_completed").strip() or "poll_completed",
            )
            ledger.update_task_state(
                normalized_task_uuid,
                "downloading",
                result_url=str(normalized_result_urls[0] or "").strip(),
                meta=checkpoint_meta,
                last_transition_reason="remote_result_checkpoint",
            )
        except Exception:
            logging.exception("[TaskLedger] 更新 remote result checkpoint 失败")

    @classmethod
    def _build_completion_checkpoint_meta(
        cls,
        existing_meta: Any,
        result_urls: List[str],
        *,
        reason: str,
    ) -> dict:
        source = existing_meta if isinstance(existing_meta, dict) else {}
        safe_meta: Dict[str, Any] = {}
        for key in sorted(cls._CHECKPOINT_META_PRESERVE_KEYS):
            value = source.get(key)
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                safe_meta[key] = value
            else:
                safe_meta[key] = str(value)
        safe_meta.update(
            {
                "remote_result_urls": list(result_urls or []),
                "remote_result_checkpoint_at": time.time(),
                "remote_result_checkpoint_reason": str(reason or "poll_completed").strip()
                or "poll_completed",
            }
        )
        return safe_meta

    def _calculate_next_wait_time(self) -> float:
        now = time.time()
        groups, _ = self._collect_poll_groups(now)
        if not groups:
            return self._base_poll_interval

        next_due_at_values = []
        for group_key in groups.keys():
            state = self._group_states.get(str(group_key or "").strip()) or {}
            next_due_at_values.append(float(state.get("next_due_at") or 0.0))

        if not next_due_at_values:
            return self._base_poll_interval

        earliest_due_at = min(next_due_at_values)
        return max(0.2, earliest_due_at - now)

    def _poll_once(self) -> float:
        """执行一次批量轮询，返回下一次轮询等待时间。"""
        self._poll_iteration += 1
        current_time = time.time()
        groups, all_task_uuids = self._collect_poll_groups(current_time)
        if not groups:
            self._maybe_run_defensive_health_audit(phase="poll_idle")
            return self._base_poll_interval

        poll_groups_summary = []
        due_groups = []
        for group_payload in groups.values():
            task_uuids = list(group_payload.get("task_uuids") or [])
            if not task_uuids:
                continue
            if not bool(group_payload.get("due")):
                continue
            due_groups.append(group_payload)
            poll_groups_summary.append(
                {
                    "base_url": str(group_payload.get("base_url") or "").strip(),
                    "count": len(task_uuids),
                    "group_key": str(group_payload.get("group_key") or "").strip(),
                    "task_uuids": task_uuids,
                }
            )

        if poll_groups_summary and self._should_log_poll_summary(poll_groups_summary):
            summary_text = "; ".join(
                f"{item['count']}个[{', '.join(self._build_poll_task_brief(tid) for tid in item['task_uuids'])}] @{item['base_url']}"
                for item in poll_groups_summary
            )
            logging.debug(
                "[FanxingBatchPoller] 单轮批量查询: 总任务=%s, 分组=%s, 明细=%s",
                sum(int(item["count"]) for item in poll_groups_summary),
                len(poll_groups_summary),
                summary_text,
            )

        for group_payload in due_groups:
            group_key = str(group_payload.get("group_key") or "").strip()
            self._record_group_poll_started(group_key)
            batch_success = self._poll_batch(
                str(group_payload.get("base_url") or "").strip(),
                list(group_payload.get("task_uuids") or []),
                dict(group_payload.get("headers") or {}),
                group_key,
            )
            with self._task_lock:
                group_state = self._group_states.get(group_key)
                if group_state is not None:
                    if batch_success:
                        group_state["consecutive_errors"] = 0
                    else:
                        group_state["consecutive_errors"] = int(
                            group_state.get("consecutive_errors") or 0
                        ) + 1
            if batch_success:
                self._record_group_poll_succeeded(group_key)
            self._schedule_group_next_due(group_key)

        if all_task_uuids:
            self._check_timeouts(all_task_uuids)
        self._maybe_run_defensive_health_audit(phase="poll_once")
        return self._calculate_next_wait_time()

    def _build_poll_task_brief(self, task_uuid: str) -> str:
        task_data = {}
        with self._task_lock:
            task_data = dict(self._tasks.get(task_uuid) or {})
        record = get_task_ledger_store().find_record_by_provider_task_uuid(task_uuid) or {}
        task_type = str(
            task_data.get("task_type")
            or record.get("task_type")
            or ""
        ).strip() or "-"
        generation_id = str(
            task_data.get("generation_id")
            or record.get("generation_id")
            or ""
        ).strip() or "-"
        return f"{str(task_uuid or '')[:8]}|{task_type[:18]}|{generation_id[:24]}"

    def _build_poll_response_brief(self, task_uuid: str, task_info: dict) -> str:
        task_uuid = str(task_uuid or "").strip()
        task_info = dict(task_info or {})
        status = str(task_info.get("status") or "").strip() or "-"
        error_message = str(
            task_info.get("error_message")
            or task_info.get("fail_reason")
            or task_info.get("failure_reason")
            or task_info.get("error")
            or task_info.get("message")
            or task_info.get("msg")
            or ""
        ).strip()
        progress = task_info.get("progress", "")
        progress_text = (
            str(progress).strip()
            if str(progress).strip()
            else "-"
        )
        return (
            f"{task_uuid[:8]}|status={status[:24]}|progress={progress_text[:8]}"
            f"|error={error_message[:48] or '-'}"
        )

    def _poll_batch(
        self,
        base_url: str,
        task_uuids: List[str],
        headers: dict,
        group_key: str,
    ) -> bool:
        """对一组任务执行批量查询

        Args:
            base_url: 服务器地址
            task_uuids: 任务 UUID 列表
        """
        if not task_uuids:
            return True

        # 分批查询（避免单次请求过大）
        overall_success = True
        for i in range(0, len(task_uuids), self._batch_size):
            batch = task_uuids[i : i + self._batch_size]
            if not self._query_batch(base_url, batch, headers, group_key):
                overall_success = False
        return overall_success

    def _query_batch(
        self, base_url: str, task_uuids: List[str], headers: dict, group_key: str
    ) -> bool:
        """执行单次批量查询请求

        Args:
            base_url: 服务器地址
            task_uuids: 任务 UUID 列表（最多 _batch_size 个）
            headers: 请求头
        """
        protocol = HuanyuApiSysProtocol()
        auth = build_auth_context_from_headers(
            base_url=str(base_url or "").strip(),
            headers=headers,
            use_host_tenant=False,
        )
        query_url = protocol.build_task_routes(auth).batch
        payload = {"task_uuids": task_uuids}

        try:
            if self._session is None:
                self._session = self._create_session()

            self._refresh_runtime_config()

            # 使用元组超时：(连接超时, 读取超时)
            # 连接超时保持较短，读取超时放宽到运行时配置，避免高峰期过早判定网络异常
            resp = self._session.post(
                query_url,
                headers=headers,
                json=payload,
                timeout=(
                    self._batch_query_connect_timeout_seconds,
                    self._batch_query_read_timeout_seconds,
                ),
            )

            try:
                error_payload = resp.json() if resp.content else {}
            except Exception:
                error_payload = {}
            if is_session_invalidated_payload(error_payload):
                self._handle_batch_error(task_uuids, SESSION_INVALIDATED_USER_MESSAGE)
                return False

            if resp.status_code == 401:
                self._handle_batch_error(task_uuids, "认证凭据无效或已过期")
                return False
            if resp.status_code == 403:
                self._handle_batch_error(task_uuids, "额度不足")
                return False
            if resp.status_code != 200:
                logging.warning(
                    "[FanxingBatchPoller] batch_query_http_error status=%s task_count=%s",
                    resp.status_code,
                    len(task_uuids),
                )
                return False

            data = error_payload if isinstance(error_payload, dict) else resp.json()
            if not data.get("success"):
                if is_session_invalidated_payload(data):
                    self._handle_batch_error(task_uuids, SESSION_INVALIDATED_USER_MESSAGE)
                    return False
                logging.warning(
                    "[FanxingBatchPoller] batch_query_failed task_count=%s error=%s",
                    len(task_uuids),
                    data.get("msg"),
                )
                return False

            # 处理每个任务的状态（防御性处理多种响应格式）
            tasks_data = data.get("data", {})
            processed_count = 0
            returned_task_uuids = set()
            response_briefs = []

            if isinstance(tasks_data, list):
                # 格式 A: 列表格式 [{"task_uuid": "xxx", "status": "..."}]
                for task_info in tasks_data:
                    if isinstance(task_info, dict):
                        task_uuid = task_info.get("task_uuid")
                        if task_uuid:
                            normalized_task_uuid = str(task_uuid or "").strip()
                            returned_task_uuids.add(normalized_task_uuid)
                            response_briefs.append(
                                self._build_poll_response_brief(
                                    normalized_task_uuid, task_info
                                )
                            )
                            self._process_task_status(task_uuid, task_info)
                            processed_count += 1
            elif isinstance(tasks_data, dict):
                # 检查是否是单任务直接返回（包含 task_uuid 字段）
                if "task_uuid" in tasks_data:
                    # 格式 B: 单任务直接返回 {"task_uuid": "xxx", "status": "..."}
                    task_uuid = tasks_data.get("task_uuid")
                    normalized_task_uuid = str(task_uuid or "").strip()
                    if normalized_task_uuid:
                        returned_task_uuids.add(normalized_task_uuid)
                        response_briefs.append(
                            self._build_poll_response_brief(
                                normalized_task_uuid, tasks_data
                            )
                        )
                    self._process_task_status(task_uuid, tasks_data)
                    processed_count += 1
                else:
                    # 格式 C: 字典格式 {task_uuid: task_info}
                    for task_uuid, task_info in tasks_data.items():
                        if isinstance(task_info, dict):
                            normalized_task_uuid = str(task_uuid or "").strip()
                            if normalized_task_uuid:
                                returned_task_uuids.add(normalized_task_uuid)
                                response_briefs.append(
                                    self._build_poll_response_brief(
                                        normalized_task_uuid, task_info
                                    )
                                )
                            self._process_task_status(task_uuid, task_info)
                            processed_count += 1

            if response_briefs and self._should_log_batch_response(
                group_key,
                requested_count=len(task_uuids),
                returned_count=len(returned_task_uuids),
                response_briefs=response_briefs,
            ):
                logging.debug(
                    "[FanxingBatchPoller] batch_query_response base_url=%s requested=%s returned=%s details=%s",
                    redact_url_for_log(base_url, category="base_url"),
                    len(task_uuids),
                    len(returned_task_uuids),
                    "; ".join(response_briefs),
                )

            missing_task_uuids = [
                str(task_uuid or "").strip()
                for task_uuid in task_uuids
                if str(task_uuid or "").strip()
                and str(task_uuid or "").strip() not in returned_task_uuids
            ]
            if missing_task_uuids:
                logging.warning(
                    "[FanxingBatchPoller] batch_query_missing_tasks base_url=%s requested=%s missing=%s details=%s",
                    redact_url_for_log(base_url, category="base_url"),
                    len(task_uuids),
                    len(missing_task_uuids),
                    ", ".join(self._build_poll_task_brief(task_uuid) for task_uuid in missing_task_uuids),
                )
                self._handle_missing_tasks_with_fallback(
                    base_url,
                    headers,
                    group_key,
                    missing_task_uuids,
                )

            for returned_task_uuid in returned_task_uuids:
                self._reset_task_missing_state(returned_task_uuid)

            # 防御性日志：如果没有处理任何任务，记录警告
            if processed_count == 0 and task_uuids:
                logging.warning(
                    "[FanxingBatchPoller] batch_query_empty_result task_count=%s",
                    len(task_uuids),
                )

            # 查询成功，重置错误计数
            self._consecutive_errors = 0
            return True

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            self._consecutive_errors += 1
            self._maybe_notify_network_error(task_uuids, e)
            group_error_count = 0
            with self._task_lock:
                group_state = self._group_states.get(str(group_key or "").strip()) or {}
                group_error_count = int(group_state.get("consecutive_errors") or 0) + 1
            if group_error_count >= self._max_consecutive_errors:
                logging.warning(
                    "[FanxingBatchPoller] batch_query_network_error group=%s retry_count=%s task_count=%s error=%s",
                    group_key,
                    group_error_count,
                    len(task_uuids),
                    str(e),
                )
            else:
                logging.debug(
                    "[FanxingBatchPoller] batch_query_network_error group=%s retry_count=%s task_count=%s error=%s",
                    group_key,
                    group_error_count,
                    len(task_uuids),
                    str(e),
                )
            return False
        except Exception as e:
            self._consecutive_errors += 1
            logging.error(
                "[FanxingBatchPoller] batch_query_exception group=%s task_count=%s error=%s",
                group_key,
                len(task_uuids),
                str(e),
            )
            return False

    def _maybe_notify_network_error(
        self, task_uuids: List[str], error: Exception
    ) -> None:
        if not task_uuids:
            return

        self._refresh_runtime_config()

        # 保守：避免网络抖动时频繁更新占位符
        # 但为了提升可感知性：首次网络错误即可触发一次提示（仍保留 15s 节流）
        if self._consecutive_errors < 1:
            return

        now = time.time()
        callbacks_to_call = []
        with self._task_lock:
            for task_uuid in task_uuids:
                task_data = self._tasks.get(task_uuid)
                if not task_data:
                    continue
                cb = task_data.get("network_error_callback")
                if not cb:
                    continue
                last_notify = float(
                    task_data.get("last_network_error_notify", 0.0) or 0.0
                )
                if now - last_notify < self._network_error_notify_interval:
                    continue
                task_data["last_network_error_notify"] = now
                task_data["network_retry_active"] = True
                callbacks_to_call.append((task_uuid, cb))

        for task_uuid, cb in callbacks_to_call:
            self._execute_callback_safely(cb, task_uuid, error)

    def _process_task_status(self, task_uuid: str, task_info: dict) -> None:
        """处理单个任务的状态更新

        Args:
            task_uuid: 任务 UUID
            task_info: 任务状态信息
        """
        # 防御性检查：确保 task_info 是字典
        if not isinstance(task_info, dict):
            logging.warning(
                f"[FanxingBatchPoller] 无效的任务信息格式: {type(task_info)}"
            )
            return

        status = task_info.get("status")
        progress = task_info.get("progress", 0)
        raw_error_message = str(
            task_info.get("error_message")
            or task_info.get("fail_reason")
            or task_info.get("failure_reason")
            or task_info.get("error")
            or task_info.get("message")
            or task_info.get("msg")
            or ""
        ).strip()
        if self._should_log_task_status_raw(
            task_uuid,
            status=str(status or "").strip(),
            progress=progress,
            error_message=raw_error_message,
        ):
            logging.debug(
                "[FanxingBatchPoller] task_status_raw task=%s status=%s progress=%s error=%s",
                self._build_poll_task_brief(task_uuid),
                str(status or "").strip() or "-",
                progress,
                raw_error_message[:200] or "-",
            )

        # 优先检查：提取各种可能的结果 URL 字段
        result_urls = self._extract_result_urls(task_info)
        if result_urls and not status:
            # 同步返回格式：有结果但无状态，视为成功
            success_payload = self._build_success_payload(
                task_uuid=task_uuid,
                task_data={"task_type": str(task_info.get("task_type") or "")}
                if isinstance(task_info, dict)
                else {},
                task_info=task_info,
                result_urls=result_urls,
            )
            logging.info(
                f"[FanxingBatchPoller] 任务完成(同步返回): {task_uuid}, 结果数: {len(result_urls)}"
            )
            self._transition_task_state(task_uuid, FanxingTaskState.COMPLETED)
            self._task_monitor.track_progress(task_uuid, 100, state="completed")
            self._complete_task(task_uuid, True, success_payload)
            return

        # 检查错误字段（某些格式可能没有 status 但有 error）
        error_msg = raw_error_message
        if error_msg and not status:
            # 有错误信息但无状态，视为失败
            logging.error(
                f"[FanxingBatchPoller] 任务失败(同步返回): {task_uuid}, 原因: {error_msg}"
            )
            self._transition_task_state(task_uuid, FanxingTaskState.FAILED)
            self._task_monitor.touch_task(task_uuid, state="failed")
            self._complete_task(task_uuid, False, f"{error_msg} [ID: {task_uuid[:8]}]")
            return

        # 标准异步轮询格式：有 status 字段
        if not status:
            status = "unknown"

        # 服务器端取消任务：作为终态处理，避免无限轮询
        # 兼容不同后端返回：status 可能为 canceled/cancelled/aborted，也可能通过字段标记
        try:
            status_norm = str(status).strip().lower()
        except Exception:
            status_norm = ""
        is_cancelled = (
            status_norm
            in (
                "canceled",
                "cancelled",
                "aborted",
                "canceled_by_user",
                "cancelled_by_user",
            )
            or bool(task_info.get("cancelled"))
            or bool(task_info.get("canceled"))
            or bool(task_info.get("is_cancelled"))
            or bool(task_info.get("is_canceled"))
        )
        if is_cancelled:
            reason = (
                task_info.get("cancel_reason")
                or task_info.get("cancelled_reason")
                or task_info.get("canceled_reason")
                or task_info.get("message")
                or task_info.get("msg")
                or "任务已取消"
            )
            logging.info(
                "[FanxingBatchPoller] 任务已取消: task_uuid=%s reason=%s summary=%s",
                task_uuid,
                reason,
                self._summarize_task_info(task_info),
            )
            self._transition_task_state(task_uuid, FanxingTaskState.CANCELLED)
            self._task_monitor.touch_task(task_uuid, state="cancelled")
            self._complete_task(
                task_uuid, False, f"任务已取消: {reason} [ID: {task_uuid[:8]}]"
            )
            return

        next_state = None
        status_norm = str(status).strip().lower()
        if status_norm in ("queued", "pending"):
            next_state = FanxingTaskState.QUEUED
        elif status_norm in ("processing", "running", "in_progress"):
            next_state = FanxingTaskState.PROCESSING
        elif status_norm in ("completed", "succeeded"):
            next_state = FanxingTaskState.COMPLETED
        elif status_norm in ("failed", "failure"):
            next_state = FanxingTaskState.FAILED

        if next_state is not None:
            self._transition_task_state(task_uuid, next_state)

        if self._should_short_circuit_running_error(
            status_norm=status_norm,
            raw_error_message=raw_error_message,
        ):
            diagnostic_label = classify_runtime_issue(raw_error_message)
            logging.error(
                "[FanxingBatchPoller] running_with_terminal_error trace=%s diagnostic=%s status=%s reason=%s summary=%s",
                self._task_trace(
                    task_uuid=task_uuid,
                    phase="poll_running_terminal_error",
                ),
                diagnostic_label or "explicit_terminal_error",
                status_norm or "unknown",
                raw_error_message,
                self._summarize_task_info(task_info),
            )
            self._transition_task_state(task_uuid, FanxingTaskState.FAILED)
            self._task_monitor.touch_task(task_uuid, state="failed")
            self._complete_task(
                task_uuid,
                False,
                f"{get_runtime_issue_message(raw_error_message)} [ID: {task_uuid[:8]}]",
            )
            return

        # 单次锁操作：读取并更新进度
        progress_callback = None
        status_callback = None
        task_index = -1
        should_update_progress = False
        should_emit_status = False

        with self._task_lock:
            if task_uuid not in self._tasks:
                return
            task_data = self._tasks[task_uuid]
            last_progress = task_data["last_progress"]
            last_status = str(task_data.get("last_status") or "unknown").strip().lower()
            recovering_from_network_retry = bool(
                task_data.get("network_retry_active", False)
            )
            now = time.time()

            # 每次收到服务器响应都重置活动时间（表明服务器仍在正常响应）
            task_data["last_activity_time"] = now
            task_data["consecutive_missing_responses"] = 0

            if status_norm != last_status:
                task_data["last_status"] = status_norm or "unknown"
                task_data["last_status_change_time"] = now
                should_emit_status = True

            if progress != last_progress:
                task_data["last_progress"] = progress
                task_data["last_progress_change_time"] = now
                should_update_progress = True

            if recovering_from_network_retry:
                task_data["network_retry_active"] = False
                if status_norm in {"queued", "pending", "processing", "running", "in_progress"}:
                    should_emit_status = True
                    should_update_progress = True

            current_profile_id = str(task_data.get("profile_id") or "").strip()
            base_profile_id = str(
                task_data.get("base_profile_id") or current_profile_id
            ).strip()
            if current_profile_id == "restored_polling" and (
                progress > 0
                or status_norm
                in {
                    "processing",
                    "running",
                    "in_progress",
                    "completed",
                    "succeeded",
                    "failed",
                    "failure",
                    "cancelled",
                    "canceled",
                    "aborted",
                }
            ):
                task_data["profile_id"] = base_profile_id or "interactive_image_generation"

            progress_callback = task_data.get("progress_callback")
            status_callback = task_data.get("status_callback")
            task_index = task_data.get("task_index", -1)

        monitor_state = "processing"
        if str(status).strip().lower() in ("queued", "pending"):
            monitor_state = "queued"
        self._task_monitor.track_progress(task_uuid, progress, state=monitor_state)

        # 在锁外执行回调
        if should_update_progress and progress_callback:
            try:
                progress_callback(task_index, progress)
            except Exception as e:
                logging.debug(f"[FanxingBatchPoller] 进度回调异常: {e}")
        if should_emit_status and status_callback:
            try:
                status_callback(task_uuid, status_norm or "unknown", dict(task_info or {}))
            except Exception as e:
                logging.debug(f"[FanxingBatchPoller] 状态回调异常: {e}")
        if should_update_progress:
            logging.info(
                "[FanxingBatchPoller] progress trace=%s status=%s progress=%s",
                self._task_trace(
                    task_uuid=task_uuid,
                    task_data=task_data,
                    phase="poll_progress",
                ),
                status_norm or "unknown",
                progress,
            )
            self._emit_task_event(
                FanxingEventType.TASK_PROGRESS,
                task_uuid,
                progress=progress,
                state=str(status).strip().lower() or "unknown",
            )

        if status in ("completed", "succeeded"):
            # 任务完成 - 支持 "completed" 和 "succeeded" 两种状态
            if not result_urls and not self._should_return_structured_payload(task_data):
                retry_count = 0
                first_seen_at = 0.0
                with self._task_lock:
                    if task_uuid in self._tasks:
                        live_task = self._tasks[task_uuid]
                        retry_count = int(
                            live_task.get("completed_without_results_count") or 0
                        ) + 1
                        live_task["completed_without_results_count"] = retry_count
                        first_seen_at = float(
                            live_task.get("first_completed_without_results_at") or 0.0
                        )
                        if first_seen_at <= 0.0:
                            first_seen_at = time.time()
                            live_task["first_completed_without_results_at"] = first_seen_at
                if retry_count <= 3:
                    logging.warning(
                        "[FanxingBatchPoller] completed_without_results retry trace=%s retry=%s elapsed=%.1fs",
                        self._task_trace(
                            task_uuid=task_uuid,
                            task_data=task_data,
                            phase="poll_completed_without_results_retry",
                        ),
                        retry_count,
                        max(0.0, time.time() - first_seen_at),
                    )
                    self._task_monitor.touch_task(task_uuid, state="running")
                    return
                diagnostic_error = "completed_without_results"
                diagnostic_label = classify_runtime_issue(diagnostic_error)
                # 记录完整的 task_info 以便调试
                logging.warning(
                    "[FanxingBatchPoller] completed_without_results trace=%s provider=%s model=%s worker_node=%s diagnostic=%s summary=%s",
                    self._task_trace(
                        task_uuid=task_uuid,
                        task_data=task_data,
                        phase="poll_completed_without_results",
                    ),
                    str(((task_info.get("output_list") or {}) if isinstance(task_info.get("output_list"), dict) else {}).get("provider") or ""),
                    str(((task_info.get("input_params") or {}) if isinstance(task_info.get("input_params"), dict) else {}).get("model") or ""),
                    str(task_info.get("worker_node") or ""),
                    diagnostic_label or "completed_without_results",
                    self._summarize_task_info(task_info),
                )
                self._task_monitor.touch_task(task_uuid, state="failed")
                self._complete_task(
                    task_uuid,
                    False,
                    f"{get_runtime_issue_message(diagnostic_error)} [ID: {task_uuid[:8]}]",
                )
            else:
                logging.info(
                    "[FanxingBatchPoller] task_completed trace=%s result_count=%s",
                    self._task_trace(
                        task_uuid=task_uuid,
                        task_data=task_data,
                        phase="poll_completed",
                    ),
                    len(result_urls),
                )
                self._task_monitor.track_progress(task_uuid, 100, state="completed")
                if result_urls:
                    self._persist_completion_checkpoint(
                        task_uuid,
                        result_urls,
                        reason="poll_completed",
                    )
                success_payload = self._build_success_payload(
                    task_uuid=task_uuid,
                    task_data=task_data,
                    task_info=task_info,
                    result_urls=result_urls,
                )
                self._complete_task(task_uuid, True, success_payload)

        elif status in ("failed", "failure"):
            # 任务失败 - 支持 "failed" 和 "failure" 两种状态
            if not error_msg:
                error_msg = "任务失败"
            diagnostic_label = classify_runtime_issue(error_msg)
            logging.error(
                "[FanxingBatchPoller] task_failed trace=%s diagnostic=%s reason=%s summary=%s",
                self._task_trace(
                    task_uuid=task_uuid,
                    task_data=task_data,
                    phase="poll_failed",
                ),
                diagnostic_label or "generic_failure",
                error_msg,
                self._summarize_task_info(task_info),
            )
            self._task_monitor.touch_task(task_uuid, state="failed")
            self._complete_task(
                task_uuid,
                False,
                f"{get_runtime_issue_message(error_msg)} [ID: {task_uuid[:8]}]",
            )

    def _extract_result_urls(self, task_info: dict) -> List[str]:
        """提取任务结果中的图片 URL，兼容多种返回格式。"""
        if not isinstance(task_info, dict):
            return []

        candidates = []

        for key in ("result_urls", "video_urls", "videos", "images"):
            direct_values = task_info.get(key)
            if isinstance(direct_values, list):
                candidates.extend(direct_values)

        data_obj = task_info.get("data")
        if isinstance(data_obj, dict):
            for key in ("result_urls", "video_urls", "videos", "images"):
                nested_values = data_obj.get(key)
                if isinstance(nested_values, list):
                    candidates.extend(nested_values)

        # 兼容 cf-task 等任务返回格式：output_list.images
        output_list = task_info.get("output_list")
        if isinstance(output_list, dict):
            for key in ("result_urls", "video_urls", "videos", "images"):
                output_values = output_list.get(key)
                if isinstance(output_values, list):
                    candidates.extend(output_values)

        normalized = []
        for item in candidates:
            if isinstance(item, str) and item.strip():
                normalized.append(item.strip())
            elif isinstance(item, dict):
                url = str(
                    item.get("url")
                    or item.get("video_url")
                    or item.get("file_url")
                    or item.get("image_url")
                    or ""
                ).strip()
                if url:
                    normalized.append(url)

        deduped = []
        seen = set()
        for url in normalized:
            if url in seen:
                continue
            seen.add(url)
            deduped.append(url)
        return deduped

    @staticmethod
    def _should_return_structured_payload(task_data: Optional[dict]) -> bool:
        normalized_task_type = str((task_data or {}).get("task_type") or "").strip().lower()
        return normalized_task_type in {"text_extract", "fanxing_llm_short"}

    def _build_success_payload(
        self,
        *,
        task_uuid: str,
        task_data: Optional[dict],
        task_info: dict,
        result_urls: List[str],
    ):
        if self._should_return_structured_payload(task_data):
            payload = dict(task_info or {})
            payload.setdefault("task_uuid", str(task_uuid or "").strip())
            return payload
        return list(result_urls or [])

    @staticmethod
    def _should_short_circuit_running_error(
        *, status_norm: str, raw_error_message: str
    ) -> bool:
        normalized_status = str(status_norm or "").strip().lower()
        normalized_error = str(raw_error_message or "").strip()
        if normalized_status not in {"processing", "running", "in_progress"}:
            return False
        if not normalized_error:
            return False

        runtime_issue = classify_runtime_issue(normalized_error)
        if runtime_issue and runtime_issue != "network":
            return True

        lowered = normalized_error.lower()
        explicit_failure_tokens = (
            "task failed",
            "task_status_failed",
            "task_status_failure",
            "provider failed",
            "all providers failed",
            "no available provider",
            "does not support image input",
            "invalid or expired token",
            "quota",
            "额度不足",
            "所有提供商不可用",
            "提供商调用失败",
            "completed_without_results",
        )
        return any(token in lowered for token in explicit_failure_tokens)

    def _complete_task(self, task_uuid: str, success: bool, result_or_error) -> None:
        """完成任务并触发回调

        Args:
            task_uuid: 任务 UUID
            success: 是否成功
            result_or_error: 成功时为结果列表，失败时为错误信息
        """
        with self._task_lock:
            if task_uuid not in self._tasks:
                return
            task_data = self._tasks.pop(task_uuid)

        self._clear_task_log_state(task_uuid)
        self._task_monitor.unregister_task(task_uuid)
        self._release_concurrency_for_task(task_data)
        generation_id = str(task_data.get("generation_id") or "")
        callback = task_data.get("callback")

        self._record_terminal_result_for_dispatcher(
            task_uuid=task_uuid,
            success=success,
            result_or_error=result_or_error,
            task_data=task_data,
            callback=callback,
        )

        if not success:
            try:
                ledger = get_task_ledger_store()
                existing_record = (
                    ledger.find_record_by_provider_task_uuid(task_uuid) or {}
                )
                existing_state = str(existing_record.get("state") or "").strip().lower()
                if existing_state not in {"failed", "canceled", "completed"}:
                    ledger.update_task_state(
                        task_uuid,
                        "failed",
                        last_error=str(result_or_error or "").strip(),
                    )
            except Exception:
                logging.exception("[TaskLedger] 更新 failed 状态失败")

        if get_enhancement_config().use_event_bus:
            if success:
                event = self._event_bus.create_task_event(
                    FanxingEventType.TASK_COMPLETED,
                    task_id=task_uuid,
                    generation_id=generation_id,
                    result=result_or_error,
                )
                self._event_bus.emit(event)
            else:
                event = self._event_bus.create_task_event(
                    FanxingEventType.TASK_FAILED,
                    task_id=task_uuid,
                    generation_id=generation_id,
                    error=result_or_error,
                )
                self._event_bus.emit(event)

        # 触发回调
        if callback:
            self._execute_callback_safely(callback, task_uuid, success, result_or_error)
        self._publish_terminal_result_for_dispatcher(
            task_uuid=task_uuid,
            phase="complete_task",
        )

    def _handle_batch_error(self, task_uuids: List[str], error_msg: str) -> None:
        """处理批量错误（如认证失败）"""
        for task_uuid in task_uuids:
            self._complete_task(task_uuid, False, f"{error_msg} [ID: {task_uuid[:8]}]")

    def _check_timeouts(self, task_uuids: List[str]) -> None:
        """检查超时任务。

        除网络完全无响应外，服务端持续返回 queued/processing 但状态和进度长期不变化，
        也应被视为停滞超时，避免无限轮询。
        """
        current_time = time.time()
        timed_out_tasks = []

        with self._task_lock:
            for task_uuid in task_uuids:
                if task_uuid not in self._tasks:
                    continue

                task_data = self._tasks[task_uuid]
                idle_time = current_time - float(
                    task_data.get("last_activity_time", task_data["start_time"]) or 0.0
                )
                status_change_time = float(
                    task_data.get(
                        "last_status_change_time", task_data.get("start_time", current_time)
                    )
                    or 0.0
                )
                progress_change_time = float(
                    task_data.get(
                        "last_progress_change_time", task_data.get("start_time", current_time)
                    )
                    or 0.0
                )
                stagnation_time = max(
                    0.0, current_time - max(status_change_time, progress_change_time)
                )
                total_elapsed = current_time - float(task_data.get("start_time") or 0.0)
                timeout_seconds = float(task_data.get("timeout") or 0.0)

                if max(idle_time, stagnation_time) <= timeout_seconds:
                    continue

                logging.error(
                    "[FanxingBatchPoller] 任务超时: task_uuid=%s generation_id=%s task_type=%s idle=%ss stagnation=%ss total=%ss timeout=%ss",
                    task_uuid,
                    str(task_data.get("generation_id") or "").strip(),
                    str(task_data.get("task_type") or "").strip(),
                    int(idle_time),
                    int(stagnation_time),
                    int(total_elapsed),
                    int(timeout_seconds),
                )
                if get_enhancement_config().use_state_validation:
                    from_state = task_data.get("state_enum") or FanxingTaskState.QUEUED
                    self._state_validator.validate(from_state, FanxingTaskState.TIMEOUT)
                generation_id = str(task_data.get("generation_id") or "")
                self._tasks.pop(task_uuid, None)
                self._task_monitor.unregister_task(task_uuid)
                self._clear_task_log_state(task_uuid)
                self._release_concurrency_for_task(task_data)
                timed_out_tasks.append(
                    (
                        task_uuid,
                        task_data,
                        int(total_elapsed),
                        generation_id,
                        int(stagnation_time),
                    )
                )

        for task_uuid, task_data, elapsed_int, generation_id, stagnation_int in timed_out_tasks:
            timeout_message = (
                f"任务超时（状态停滞 {stagnation_int}s，总等待 {elapsed_int}s）[ID: {task_uuid[:8]}]"
            )
            try:
                get_task_ledger_store().update_task_state(
                    task_uuid,
                    "failed",
                    last_error=timeout_message,
                )
            except Exception:
                logging.exception("[TaskLedger] 更新 timeout 失败状态失败")
            if get_enhancement_config().use_event_bus:
                timeout_event = self._event_bus.create_task_event(
                    FanxingEventType.TASK_TIMEOUT,
                    task_id=task_uuid,
                    generation_id=generation_id,
                    timeout_seconds=task_data.get("timeout"),
                    elapsed_seconds=elapsed_int,
                )
                self._event_bus.emit(timeout_event)
            callback = task_data.get("callback")
            self._record_terminal_result_for_dispatcher(
                task_uuid=task_uuid,
                success=False,
                result_or_error=timeout_message,
                task_data=task_data,
                callback=callback,
            )
            if callback:
                self._execute_callback_safely(
                    callback,
                    task_uuid,
                    False,
                    timeout_message,
                )
            self._publish_terminal_result_for_dispatcher(
                task_uuid=task_uuid,
                phase="check_timeouts",
            )

    def shutdown(self) -> None:
        """关闭轮询管理器"""
        self._stop_event.set()
        if self._poll_thread and self._poll_thread.is_alive():
            self._poll_thread.join(timeout=5)
        if self._session:
            self._session.close()
            self._session = None
        self._callback_executor.shutdown(wait=False)
        self._task_monitor.stop()
        logging.info("[FanxingBatchPoller] 已关闭")


def get_fanxing_batch_poller() -> FanxingBatchPoller:
    """返回繁星批量轮询器单例。"""
    return FanxingBatchPoller()
