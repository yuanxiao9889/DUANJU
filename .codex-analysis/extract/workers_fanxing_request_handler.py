# -*- coding: utf-8 -*-
"""繁星请求处理 Mixin 模块

提供繁星 API 请求处理的所有方法，作为 Mixin 供 ApiWorker 继承使用。

使用方法：
    from workers.fanxing import FanxingRequestMixin

    class ApiWorker(QThread, FanxingRequestMixin):
        ...

依赖（由 ApiWorker 提供）：
    - self.uploaded_images: List[str] - 参考图 Base64 列表
    - self.prompt: str - 提示词
    - self.selected_aspect: dict - 画幅设置
    - self.resolution: str - 分辨率
    - self.model_type: str - 模型类型
    - self._stop_requested: bool - 停止标志
    - self.task_completed: pyqtSignal - 任务完成信号
    - self.progress: pyqtSignal - 进度信号
    - self.generation_id: str - 生成任务 ID
    - self._get_effective_aspect_ratio() - 获取有效画幅比例
"""

import base64
import hashlib
import logging
import threading
import time
from dataclasses import replace
from typing import List, Optional

import requests

from data.generation_config import (
    get_fanxing_model_name,
    get_fanxing_quality_for_resolution,
    get_fanxing_task_type,
    get_resolution_size,
    parse_fanxing_model_identifier,
    uses_pixel_size_payload,
)
from managers.logging_manager import log_prod_info, redact_url_for_log
from workers.channel_protocols import AuthContext, HuanyuApiSysProtocol
from workers.channel_protocols.auth_context import build_auth_context_from_config
from workers.fanxing.cf_task_builder import build_fanxing_cf_task_params
from workers.fanxing.defensive import get_lifecycle_guard
from workers.fanxing.enhancement_config import get_enhancement_config
from workers.fanxing.image_url_service import (
    get_or_upload_fanxing_image_url,
    normalize_fanxing_reference_image_urls,
    prepare_fanxing_upload_image_batch,
)
from workers.fanxing.result_dispatcher import get_fanxing_result_dispatcher
from workers.fanxing.task_dispatcher import (
    FanxingSubmittedTask,
    get_fanxing_task_dispatcher,
)
from utils.exception_handler import format_image_upload_error
from utils.api_error_mapper import (
    SESSION_INVALIDATED_USER_MESSAGE,
    extract_api_error,
    is_session_invalidated_payload,
)
from utils.image_processing import decode_and_validate_base64
from utils.request_trace import (
    build_request_trace,
    extend_request_trace,
    format_request_trace,
)


class FanxingRequestMixin:
    """繁星请求处理 Mixin

    提供繁星 API 的完整请求处理逻辑，包括：
    - 参考图上传（带缓存）
    - 任务创建
    - 结果轮询（通过 FanxingBatchPoller）
    - 结果转换
    """

    @staticmethod
    def _resolve_pic2api_reference_mode(image_urls: List[str]) -> str:
        refs = [
            str(url or "").strip() for url in list(image_urls or []) if str(url or "").strip()
        ]
        if not refs:
            return "text_to_image"
        if len(refs) == 1:
            return "image_to_image"
        return "multi_image_to_image"

    def _safe_emit(self, signal_name: str, *args) -> None:
        signal = getattr(self, signal_name, None)
        if signal is None:
            return
        try:
            signal.emit(*args)
        except Exception as exc:
            logging.debug("%s 信号发射失败: %s", signal_name, exc)

    def _get_fanxing_lifecycle_lock(self):
        lock = getattr(self, "_fanxing_lifecycle_lock", None)
        if lock is None:
            lock = threading.RLock()
            try:
                setattr(self, "_fanxing_lifecycle_lock", lock)
            except Exception:
                pass
        return lock

    def _mark_worker_lifecycle_closing(self, reason: str = "") -> None:
        lock = self._get_fanxing_lifecycle_lock()
        with lock:
            if getattr(self, "_worker_lifecycle_closing", False):
                return
            setattr(self, "_worker_lifecycle_closing", True)
        logging.info(
            "[FanxingWorkerLifecycle] closing generation_id=%s reason=%s",
            str(getattr(self, "generation_id", "") or "").strip(),
            str(reason or "").strip() or "unknown",
        )

    def _mark_worker_lifecycle_finalized(self, reason: str = "") -> bool:
        lock = self._get_fanxing_lifecycle_lock()
        with lock:
            if getattr(self, "_worker_lifecycle_finalized", False):
                return False
            setattr(self, "_worker_lifecycle_finalized", True)
            setattr(self, "_worker_lifecycle_closing", True)
        logging.info(
            "[FanxingWorkerLifecycle] finalized generation_id=%s reason=%s",
            str(getattr(self, "generation_id", "") or "").strip(),
            str(reason or "").strip() or "unknown",
        )
        return True

    def _register_fanxing_poll_task(self, task_uuid: str) -> None:
        normalized_task_uuid = str(task_uuid or "").strip()
        if not normalized_task_uuid:
            return
        lock = self._get_fanxing_lifecycle_lock()
        with lock:
            active = getattr(self, "_active_fanxing_task_uuids", None)
            if active is None:
                active = set()
                setattr(self, "_active_fanxing_task_uuids", active)
            active.add(normalized_task_uuid)
        logging.debug(
            "[FanxingWorkerLifecycle] register_callback task_uuid=%s generation_id=%s",
            normalized_task_uuid,
            str(getattr(self, "generation_id", "") or "").strip(),
        )

    def _unregister_fanxing_poll_task(self, task_uuid: str) -> None:
        normalized_task_uuid = str(task_uuid or "").strip()
        if not normalized_task_uuid:
            return
        lock = self._get_fanxing_lifecycle_lock()
        with lock:
            active = getattr(self, "_active_fanxing_task_uuids", None)
            if active is not None:
                active.discard(normalized_task_uuid)
        logging.debug(
            "[FanxingWorkerLifecycle] unregister_callback task_uuid=%s generation_id=%s",
            normalized_task_uuid,
            str(getattr(self, "generation_id", "") or "").strip(),
        )

    def _is_fanxing_callback_active(self, task_uuid: str, *, phase: str = "") -> bool:
        normalized_task_uuid = str(task_uuid or "").strip()
        lock = self._get_fanxing_lifecycle_lock()
        with lock:
            active = getattr(self, "_active_fanxing_task_uuids", None) or set()
            is_active_task = not normalized_task_uuid or normalized_task_uuid in active
            callbacks_detached = bool(getattr(self, "_fanxing_callbacks_detached", False))
            lifecycle_closed = bool(
                getattr(self, "_worker_lifecycle_closing", False)
                or getattr(self, "_worker_lifecycle_finalized", False)
            )

        if is_active_task and not callbacks_detached and not lifecycle_closed:
            return True

        logging.info(
            "[FanxingWorkerLifecycle] callback_ignored task_uuid=%s generation_id=%s phase=%s active=%s detached=%s closed=%s",
            normalized_task_uuid,
            str(getattr(self, "generation_id", "") or "").strip(),
            str(phase or "").strip() or "unknown",
            int(bool(is_active_task)),
            int(bool(callbacks_detached)),
            int(bool(lifecycle_closed)),
        )
        return False

    def detach_fanxing_callbacks(self, reason: str = "") -> int:
        lock = self._get_fanxing_lifecycle_lock()
        with lock:
            if getattr(self, "_fanxing_callbacks_detached", False):
                return 0
            setattr(self, "_fanxing_callbacks_detached", True)
            task_uuids = list(getattr(self, "_active_fanxing_task_uuids", set()) or [])

        generation_id = str(getattr(self, "generation_id", "") or "").strip()
        detached = 0
        try:
            from workers.fanxing import _fanxing_batch_poller

            detached = _fanxing_batch_poller.detach_generation_callbacks(
                generation_id,
                task_uuids=task_uuids or None,
                reason=str(reason or "").strip() or "worker_detach",
            )
        except Exception:
            logging.exception(
                "[FanxingWorkerLifecycle] detach callbacks failed generation_id=%s reason=%s",
                generation_id,
                str(reason or "").strip() or "worker_detach",
            )
        logging.info(
            "[FanxingWorkerLifecycle] callbacks_detached generation_id=%s tasks=%s detached=%s reason=%s",
            generation_id,
            len(task_uuids),
            detached,
            str(reason or "").strip() or "worker_detach",
        )
        return detached

    @staticmethod
    def _build_api_sys_auth_context(base_url: str, api_key: str, headers: dict) -> AuthContext:
        tenant_id = str((headers or {}).get("X-Tenant-ID") or "").strip()
        return build_auth_context_from_config(
            base_url=str(base_url or "").strip(),
            bearer_token=str(api_key or "").strip(),
            tenant_id=tenant_id,
            use_host_tenant=False,
        )

    def _execute_fanxing_request(
        self,
        session,
        base_url: str,
        api_key: str,
        request_payload: dict,
        timeout: int,
        task_index: int,
        headers: dict,
    ) -> dict:
        """执行繁星渠道请求（异步任务模式）

        流程：
        1. 上传参考图（如有）-> 获取 URL
        2. 创建任务 -> 获取 task_uuid
        3. 轮询任务状态 -> 获取结果
        """
        # 延迟导入避免循环依赖
        from workers.fanxing import _fanxing_image_cache
        from workers.fanxing import _fanxing_batch_poller
        capability = self._resolve_fanxing_task_capability(request_payload)
        request_trace = build_request_trace(
            source="fanxing_request",
            phase="request_start",
            generation_id=str(getattr(self, "generation_id", "") or "").strip(),
            task_index=task_index,
            capability=capability,
        )
        concurrency_acquired = False

        # 1. 处理参考图上传（支持缓存，避免重复上传）
        # 缓存由 ImageManager 在用户删除/清空/重排参考图时主动清理
        image_urls = [
            str(url or "").strip()
            for url in list(getattr(self, "uploaded_image_urls", []) or [])
            if str(url or "").strip()
        ]
        cache_hits = 0

        if image_urls:
            logging.info(
                "[RefTrace][generation_reuse] trace=%s refs=%s reused_urls=%s",
                format_request_trace(request_trace, phase="ref_reuse"),
                len(image_urls),
                len(image_urls),
            )

        if not image_urls and self.uploaded_images:
            logging.info(
                "[FanxingRef] trace=%s ref_count=%s",
                format_request_trace(request_trace, phase="ref_start"),
                len(self.uploaded_images),
            )

            self._safe_emit(
                "task_completed",
                task_index,
                True,
                "正在处理参考图...",
                self.generation_id,
            )

            cache_misses = 0
            image_fingerprints = []
            decoded_images: List[bytes] = []

            for idx, img_b64 in enumerate(self.uploaded_images):
                ref_trace = extend_request_trace(
                    request_trace,
                    ref_index=idx + 1,
                )
                if not img_b64:
                    logging.warning(
                        "[FanxingRef] trace=%s empty_reference_skipped=true",
                        format_request_trace(ref_trace, phase="ref_skip"),
                    )
                    continue
                if self._stop_requested:
                    raise RuntimeError("任务被用户中止")

                try:
                    # 使用统一的验证函数解码并验证
                    image_data, error = decode_and_validate_base64(img_b64)
                    if error:
                        logging.error(
                            "[FanxingRef] trace=%s validation_failed error=%s",
                            format_request_trace(ref_trace, phase="ref_invalid"),
                            str(error),
                        )
                        raise ValueError(
                            format_image_upload_error("invalid_format", error, idx + 1)
                        )

                    logging.debug(
                        "[FanxingRef] trace=%s decoded_bytes=%s",
                        format_request_trace(ref_trace, phase="ref_decoded"),
                        len(image_data),
                    )
                    image_fingerprints.append(hashlib.md5(image_data).hexdigest()[:8])
                    decoded_images.append(image_data)

                except base64.binascii.Error as e:
                    logging.error(
                        "[FanxingRef] trace=%s base64_decode_failed error=%s",
                        format_request_trace(ref_trace, phase="ref_invalid"),
                        str(e),
                    )
                    raise RuntimeError(
                        format_image_upload_error(
                            "invalid_format", "Base64 解码失败", idx + 1
                        )
                    )
                except PermissionError as e:
                    raise PermissionError(
                        format_image_upload_error("auth", str(e), idx + 1)
                    )
                except ValueError as e:
                    raise ValueError(
                        format_image_upload_error("invalid_format", str(e), idx + 1)
                    )
                except Exception as e:
                    logging.error(
                        "[FanxingRef] trace=%s process_failed error_type=%s error=%s",
                        format_request_trace(ref_trace, phase="ref_error"),
                        type(e).__name__,
                        str(e),
                    )
                    raise

            prepared_images = prepare_fanxing_upload_image_batch(decoded_images)

            for idx, image_data in enumerate(prepared_images):
                ref_trace = extend_request_trace(
                    request_trace,
                    ref_index=idx + 1,
                )
                if self._stop_requested:
                    raise RuntimeError("浠诲姟琚敤鎴蜂腑姝?")

                url, from_cache = get_or_upload_fanxing_image_url(
                    image_data=image_data,
                    index=idx + 1,
                    base_url=base_url,
                    api_key=api_key,
                    cache=_fanxing_image_cache,
                    session=session,
                    stop_check=lambda: bool(
                        getattr(self, "_stop_requested", False)
                    ),
                    trace_context=ref_trace,
                )
                image_urls.append(url)
                if from_cache:
                    cache_hits += 1
                    logging.debug(
                        "[FanxingRef] trace=%s cache_hit=true url=%s",
                        format_request_trace(ref_trace, phase="ref_cache_hit"),
                        redact_url_for_log(url, category="ref_url"),
                    )
                else:
                    cache_misses += 1
                    logging.debug(
                        "[FanxingRef] trace=%s uploaded=true url=%s",
                        format_request_trace(ref_trace, phase="ref_uploaded"),
                        redact_url_for_log(url, category="ref_url"),
                    )

            logging.info(
                "[RefTrace][generation] trace=%s refs=%s cache_hits=%s uploads=%s ref_md5s=%s",
                format_request_trace(request_trace, phase="ref_done"),
                len(image_urls),
                cache_hits,
                cache_misses,
                image_fingerprints,
            )
            logging.info(
                f"参考图处理完成: 缓存命中 {cache_hits}, 新上传 {cache_misses}, 总URL数 {len(image_urls)}"
            )

        # 2. 构建任务参数
        task_params = self._build_fanxing_task_payload(request_payload, image_urls)

        # 3. 创建任务（带重试机制）
        self._safe_emit(
            "task_completed",
            task_index,
            True,
            "正在创建任务...",
            self.generation_id,
        )

        protocol = HuanyuApiSysProtocol()
        auth = self._build_api_sys_auth_context(base_url, api_key, headers)
        create_url = protocol.build_task_routes(auth).create
        logging.info(
            "[FanxingSubmit] trace=%s create_url=%s",
            format_request_trace(request_trace, phase="create_prepare"),
            redact_url_for_log(create_url, category="create_url"),
        )

        if logging.getLogger().isEnabledFor(logging.DEBUG):
            try:
                safe_headers = dict(headers or {})
                auth = str(safe_headers.get("Authorization") or "")
                if auth.lower().startswith("bearer "):
                    token = auth[7:].strip()
                    tail = token[-4:] if token else ""
                    safe_headers["Authorization"] = (
                        f"Bearer ***{tail}" if tail else "Bearer ***"
                    )
                logging.debug(
                    "[Fanxing] create_task url=%s",
                    redact_url_for_log(create_url, category="create_url"),
                )
                logging.debug("[Fanxing] create_task headers=%s", safe_headers)
                try:
                    input_params = (
                        (task_params or {}).get("input_params")
                        if isinstance(task_params, dict)
                        else {}
                    )
                    task_type = (
                        (task_params or {}).get("task_type")
                        if isinstance(task_params, dict)
                        else None
                    )
                    # 普通生图：input_params 含 model/size/prompt；cf-task 含 model/inputs/workflow_id/extra
                    if str(task_type or "").strip() == "cf-task":
                        cf_inputs = (input_params or {}).get("inputs") or {}
                        cf_extra = (input_params or {}).get("extra") or {}
                        payload_preview = {
                            "task_type": task_type,
                            "model": (input_params or {}).get("model"),
                            "workflow_id": (input_params or {}).get("workflow_id"),
                            "cf_input_keys": sorted(
                                [k for k in cf_inputs.keys() if k != "source_image"]
                            ),
                            "has_source_image": bool(
                                str((cf_inputs or {}).get("source_image") or "").strip()
                            ),
                            "video_memory": str((cf_extra or {}).get("video_memory") or ""),
                        }
                    else:
                        prompt_text = str((input_params or {}).get("prompt") or "")
                        extra_params = (input_params or {}).get("extra") or {}
                        payload_preview = {
                            "task_type": task_type,
                            "model": (
                                "<hidden>"
                                if str((request_payload or {}).get("source") or "").strip() == "canvas_element_transform"
                                else (input_params or {}).get("model")
                            ),
                            "size": (input_params or {}).get("size"),
                            "extra_size": extra_params.get("size"),
                            "extra_quality": extra_params.get("quality"),
                            "prompt_len": len(prompt_text),
                            "has_negative": "[NEGATIVE]" in prompt_text,
                        }
                    logging.debug(
                        "[Fanxing] create_task payload_meta=%s", payload_preview
                    )
                except Exception:
                    logging.debug("[Fanxing] create_task payload_meta=unavailable")
            except Exception as e:
                logging.debug("[Fanxing] create_task debug payload failed: %s", e)

        max_retries = 3
        retry_delay = 1.0  # 秒
        max_retry_delay = 10.0
        last_error = None
        task_uuid = None
        provider_task_created = False

        # 资金安全：先获取本地托管额度，再向服务端创建任务。
        # 否则会出现服务端任务已创建并开始计费，但本地因额度已满无法注册轮询的孤儿任务。
        concurrency_acquired = _fanxing_batch_poller.acquire_generation_slot(
            capability=capability,
            timeout=timeout,
        )

        try:
            for attempt in range(max_retries):
                try:
                    logging.info(
                        "[FanxingSubmit] trace=%s create_attempt=%s/%s",
                        format_request_trace(request_trace, phase="create_attempt"),
                        attempt + 1,
                        max_retries,
                    )
                    resp = session.post(
                        create_url, headers=headers, json=task_params, timeout=30
                    )

                    if resp.status_code != 200:
                        error_msg = f"创建任务失败: HTTP {resp.status_code}"
                        try:
                            error_data = resp.json()
                            if is_session_invalidated_payload(error_data):
                                error_msg = SESSION_INVALIDATED_USER_MESSAGE
                            else:
                                server_msg = (
                                    extract_api_error(error_data)
                                    or error_data.get("msg", "")
                                )
                                if server_msg:
                                    error_msg = f"创建任务失败: {server_msg}"
                            logging.error(
                                "[FanxingSubmit] trace=%s create_http_error status=%s body=%s",
                                format_request_trace(
                                    request_trace, phase="create_http_error"
                                ),
                                resp.status_code,
                                error_data,
                            )
                        except:
                            logging.error(
                                "[FanxingSubmit] trace=%s create_http_error status=%s body=%s",
                                format_request_trace(
                                    request_trace, phase="create_http_error"
                                ),
                                resp.status_code,
                                resp.text[:500],
                            )
                        raise RuntimeError(error_msg)

                    result = resp.json()
                    if not result.get("success"):
                        if is_session_invalidated_payload(result):
                            server_msg = SESSION_INVALIDATED_USER_MESSAGE
                        else:
                            server_msg = extract_api_error(result) or result.get("msg", "未知错误")
                        logging.error(
                            "[FanxingSubmit] trace=%s create_rejected error=%s",
                            format_request_trace(
                                request_trace, phase="create_rejected"
                            ),
                            server_msg,
                        )
                        # 增强：如果创建失败且使用了缓存，清理缓存
                        if cache_hits > 0:
                            logging.warning(
                                "[ApiWorker] 任务创建失败且存在缓存命中，正在清理繁星图片缓存..."
                            )
                            _fanxing_image_cache.clear()
                        raise RuntimeError(f"任务失败: {server_msg}")

                    task_uuid = result.get("data", {}).get("task_uuid")
                    if not task_uuid:
                        logging.error(
                            "[FanxingSubmit] trace=%s provider_response_missing_task_uuid create_url=%s result_keys=%s",
                            format_request_trace(
                                request_trace, phase="create_invalid_response"
                            ),
                            redact_url_for_log(create_url, category="create_url"),
                            sorted(list((result or {}).keys())),
                        )
                        raise RuntimeError("服务器未返回任务 UUID")
                    provider_task_created = True

                    # 成功，跳出重试循环
                    break

                except (
                    requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout,
                    ConnectionResetError,
                ) as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        logging.warning(
                            "[FanxingSubmit] trace=%s create_retrying attempt=%s/%s error=%s",
                            format_request_trace(request_trace, phase="create_retry"),
                            attempt + 1,
                            max_retries,
                            str(e),
                        )
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, max_retry_delay)  # 指数退避
                    else:
                        raise RuntimeError(
                            f"任务创建失败，已重试 {max_retries} 次: {e}"
                        )
                except RuntimeError:
                    # 业务错误不重试
                    raise

            log_prod_info(
                logging.getLogger(__name__),
                prod_message="[Fanxing] 任务创建成功",
                dev_message="[Fanxing] 任务创建成功: task_uuid=%s",
                dev_args=(str(task_uuid),),
            )
            request_trace = extend_request_trace(
                request_trace,
                task_uuid=str(task_uuid or "").strip(),
            )
            logging.info(
                "[FanxingSubmit] trace=%s create_url=%s",
                format_request_trace(request_trace, phase="create_done"),
                redact_url_for_log(create_url, category="create_url"),
            )

            submission = None
            try:
                submission = get_fanxing_task_dispatcher().record_remote_submitted(
                    worker_context=self,
                    request_payload=request_payload,
                    task_uuid=str(task_uuid or "").strip(),
                    base_url=base_url,
                    headers=headers,
                    task_index=task_index,
                    capability=capability,
                    api_key=api_key,
                )
            except Exception as ledger_exc:
                logging.error("[TaskLedger] 任务落账失败: %s", ledger_exc)
            # 4. 注册到批量轮询管理器，等待结果
            self._safe_emit(
                "task_completed",
                task_index,
                True,
                f"任务已提交 [{task_uuid[:8]}...]",
                getattr(self, "generation_id", ""),
            )

            result = self._wait_fanxing_task_via_batch_poller(
                task_uuid,
                base_url,
                headers,
                timeout,
                task_index,
                request_payload,
                capability=capability,
                concurrency_acquired=concurrency_acquired,
                submission=submission,
            )
            concurrency_acquired = False
            logging.info(
                "[FanxingSubmit] trace=%s output_count=%s",
                format_request_trace(request_trace, phase="request_done"),
                len(list((result or {}).get("data") or [])),
            )

            try:
                from workers.llm.trace_logger import emit_trace, summarize_text

                input_params = (
                    (task_params or {}).get("input_params")
                    if isinstance(task_params, dict)
                    else {}
                )
                prompt_before_refs = str((request_payload or {}).get("prompt") or "")
                sent_prompt = str((input_params or {}).get("prompt") or "")
                sent_model = str((input_params or {}).get("model") or "")
                sent_extra = (input_params or {}).get("extra") or {}
                sent_size = str(
                    (sent_extra or {}).get("size")
                    or (input_params or {}).get("size")
                    or ""
                )
                sent_quality = str((sent_extra or {}).get("quality") or "")
                pic2api_mode = self._resolve_pic2api_reference_mode(image_urls)

                urls = []
                for item in (result or {}).get("data") or []:
                    if isinstance(item, dict) and item.get("url"):
                        urls.append(str(item.get("url")))
                    elif isinstance(item, str) and item.strip():
                        urls.append(str(item))

                emit_trace(
                    source="fanxing_request_handler",
                    event="fanxing_image_payload",
                    data={
                        "task_uuid": str(task_uuid or ""),
                        "task_index": int(task_index or 0),
                        "generation_id": str(getattr(self, "generation_id", "") or ""),
                        "model": sent_model,
                        "resolution": str(getattr(self, "resolution", "") or ""),
                        "resolved_model_type": str(
                            getattr(self, "model_type", "") or ""
                        ),
                        "image_size": sent_size,
                        "image_quality": sent_quality,
                        "pic2api_mode": pic2api_mode,
                        "timeout_sec": int(timeout or 0),
                        "user_prompt": summarize_text(prompt_before_refs),
                        "sent_prompt": summarize_text(sent_prompt),
                        "ref_image_count": int(len(image_urls or [])),
                        "output_image_count": int(len(urls)),
                    },
                )
            except Exception:
                pass

            return result
        finally:
            if last_error is not None and not provider_task_created:
                logging.error(
                    "[FanxingSubmit] trace=%s create_url=%s error=%s",
                    format_request_trace(
                        request_trace, phase="request_failed_before_create"
                    ),
                    redact_url_for_log(create_url, category="create_url"),
                    str(last_error),
                )
            if concurrency_acquired:
                try:
                    _fanxing_batch_poller.release_generation_slot(capability=capability)
                except Exception as release_exc:
                    logging.warning("[Fanxing] 释放并发额度失败: %s", release_exc)

    def _build_fanxing_task_payload(
        self, request_payload: dict, image_urls: List[str]
    ) -> dict:
        """构建繁星任务 payload，支持普通生图与 cf-task 分流。"""
        normalized_image_urls = normalize_fanxing_reference_image_urls(image_urls)
        feature_type = str(
            (request_payload or {}).get("fanxing_feature_type") or ""
        ).strip()
        if feature_type == "cf-task":
            return self._build_fanxing_cf_task_params(
                request_payload, normalized_image_urls
            )
        return self._build_fanxing_task_params(request_payload, normalized_image_urls)

    def _build_fanxing_cf_task_params(
        self, request_payload: dict, image_urls: List[str]
    ) -> dict:
        """构建 fanxing 的 cf-task 请求参数。"""
        feature_id = str(
            (request_payload or {}).get("fanxing_feature_id") or ""
        ).strip()
        feature_params = (request_payload or {}).get("fanxing_feature_params") or {}

        task_params = build_fanxing_cf_task_params(
            feature_id=feature_id,
            feature_params=feature_params,
            image_urls=image_urls,
        )

        try:
            input_params = (task_params or {}).get("input_params") or {}
            cf_inputs = (input_params or {}).get("inputs") or {}
            logging.info(
                "[Fanxing] create cf-task model=%s source_image=%s workflow_id=%s video_memory=%s",
                str((input_params or {}).get("model") or ""),
                str((cf_inputs or {}).get("source_image") or "")[:120],
                str((input_params or {}).get("workflow_id") or ""),
                str((((input_params or {}).get("extra") or {}).get("video_memory") or "")),
            )
        except Exception:
            pass
        return task_params

    def _build_fanxing_task_params(
        self, request_payload: dict, image_urls: List[str]
    ) -> dict:
        """构建普通繁星任务参数

        Args:
            request_payload: 原始请求参数
            image_urls: 上传后的参考图 URL 列表

        Returns:
            繁星任务参数字典
        """
        # 基础参数
        prompt = request_payload.get("prompt", self.prompt)
        request_source = str((request_payload or {}).get("source") or "").strip()

        try:
            prompt_text = str(prompt or "")
            logging.info(
                "[Fanxing] create_task prompt_len=%s has_negative=%s",
                len(prompt_text),
                "[NEGATIVE]" in prompt_text,
            )
            logging.debug(
                "[Fanxing] create_task prompt_len=%s head=%s tail=%s",
                len(prompt_text),
                prompt_text[:200].replace("\n", "\\n"),
                prompt_text[-200:].replace("\n", "\\n"),
            )
        except Exception:
            pass

        pic2api_mode = self._resolve_pic2api_reference_mode(image_urls)
        if image_urls:
            try:
                logging.info(
                    "[Fanxing] create_task ref_mode=%s ref_image_count=%s via=img_list",
                    pic2api_mode,
                    len(image_urls),
                )
                logging.debug(
                    "[Fanxing] create_task img_list=%s",
                    list(image_urls),
                )
            except Exception:
                pass

        # 画幅比例（繁星 API 直接使用比例字符串，如 "1:1"、"16:9"）
        # 使用统一的画幅获取逻辑
        aspect_ratio = self._get_effective_aspect_ratio()

        # 调试日志：确认画幅参数
        logging.info(
            f"画幅参数: selected_aspect={self.selected_aspect}, 计算结果 aspect_ratio={aspect_ratio}"
        )

        # 繁星渠道：从配置获取 task_type 和实际模型名
        task_type = get_fanxing_task_type(self.model_type)
        fanxing_tier = str(getattr(self, "fanxing_model_tier", "normal") or "normal")
        fanxing_model = get_fanxing_model_name(
            self.model_type,
            self.resolution,
            fanxing_tier,
        )

        parsed_model = parse_fanxing_model_identifier(
            str(getattr(self, "model_type", "") or "").strip()
        )
        resolved_base_model_id = str(
            parsed_model.get("base_model_id") or getattr(self, "model_type", "") or ""
        ).strip()
        uses_pixel_size = uses_pixel_size_payload(resolved_base_model_id)
        size = aspect_ratio
        extra = None
        if uses_pixel_size:
            size = get_resolution_size(
                str(getattr(self, "resolution", "") or "1K").strip() or "1K",
                aspect_ratio or "1:1",
                resolved_base_model_id,
            )
            extra = {
                "size": size,
                "quality": get_fanxing_quality_for_resolution(
                    str(getattr(self, "resolution", "") or "1K").strip() or "1K"
                ),
            }

        # 按照繁星 API 格式构建请求
        task_params = {
            "task_type": task_type,
            "input_params": {
                "model": fanxing_model,
                "prompt": prompt,
            },
        }
        if extra:
            task_params["input_params"]["extra"] = dict(extra)
        elif size:
            task_params["input_params"]["size"] = size
        if image_urls:
            task_params["input_params"]["img_list"] = list(image_urls)
        if request_source == "canvas_element_transform":
            logging.info(
                f"Request params: task_type={task_type}, size={size}, source=canvas_element_transform, gpt2_extra_mode={int(bool(extra))}, pic2api_mode={pic2api_mode}, ref_count={len(list(image_urls or []))}"
            )
            logging.debug("Request params detail: source=canvas_element_transform, model=<hidden>")
        else:
            logging.info(
                f"Request params: task_type={task_type}, size={size}, payload_model={fanxing_model}, gpt2_extra_mode={int(bool(extra))}, pic2api_mode={pic2api_mode}, ref_count={len(list(image_urls or []))}"
            )
            logging.debug(
                "Request params detail: "
                f"base_model_id={resolved_base_model_id or self.model_type}, effective_model={fanxing_model}"
            )
        return task_params

    def _wait_fanxing_task_via_batch_poller(
        self,
        task_uuid: str,
        base_url: str,
        headers: dict,
        timeout: int,
        task_index: int,
        request_payload: dict,
        capability: str = "image_generation",
        concurrency_acquired: bool = False,
        submission: Optional[FanxingSubmittedTask] = None,
    ) -> dict:
        """通过批量轮询管理器等待繁星任务完成

        使用 FanxingBatchPoller 集中轮询，避免多任务独立轮询的低效问题。

        Args:
            task_uuid: 任务 UUID
            base_url: 服务器地址
            headers: 请求头
            timeout: 超时时间
            task_index: 任务索引
            request_payload: 原始请求参数

        Returns:
            包含结果的字典（兼容现有格式）
        """
        # 延迟导入避免循环依赖
        from workers.fanxing import _fanxing_batch_poller

        # 用于等待回调的同步原语
        result_event = threading.Event()
        result_container = {"success": None, "data": None}
        legacy_callback_event = threading.Event()
        legacy_callback_container = {"success": None, "data": None, "received_at": 0.0}
        result_dispatcher = get_fanxing_result_dispatcher()
        result_wait_handle = None
        wait_trace = build_request_trace(
            source="fanxing_poller",
            generation_id=str(getattr(self, "generation_id", "") or "").strip(),
            task_uuid=str(task_uuid or "").strip(),
            task_index=task_index,
            capability=capability,
        )

        enhancement_config = get_enhancement_config()
        route_wait_enabled = bool(
            getattr(enhancement_config, "dispatcher_detached_wait", False)
        )
        worker_wait_release_status = {}
        status_provider = getattr(enhancement_config, "worker_wait_release_status", None)
        if callable(status_provider):
            worker_wait_release_status = dict(status_provider() or {})
        if worker_wait_release_status.get("requested") and not worker_wait_release_status.get(
            "armed"
        ):
            logging.warning(
                "[FanxingPollWait] trace=%s worker_wait_release_blocked reason=%s detached_wait=%s bridge_ready=%s",
                format_request_trace(wait_trace, phase="worker_wait_release_gate"),
                str(worker_wait_release_status.get("blocked_reason") or "not_armed"),
                int(bool(worker_wait_release_status.get("detached_wait"))),
                int(bool(worker_wait_release_status.get("bridge_ready"))),
            )
        route_wait_fallback_seconds = 2.0

        def on_task_complete(uuid: str, success: bool, result_or_error):
            """任务完成回调"""
            if not self._is_fanxing_callback_active(uuid, phase="complete"):
                return
            if route_wait_enabled:
                if legacy_callback_container["success"] is not None:
                    return
                legacy_callback_container["success"] = success
                legacy_callback_container["data"] = result_or_error
                legacy_callback_container["received_at"] = time.time()
                legacy_callback_event.set()
                logging.debug(
                    "[FanxingPollWait] trace=%s legacy_callback_deferred success=%s",
                    format_request_trace(wait_trace, phase="legacy_callback_deferred"),
                    int(bool(success)),
                )
                return
            if result_container["success"] is not None:
                return
            result_container["success"] = success
            result_container["data"] = result_or_error
            result_event.set()

        # 进度回调节流：避免频繁信号发射导致主线程阻塞
        last_emitted_progress = [-1]  # 使用列表以便在闭包中修改
        last_emit_time = [0.0]
        MIN_EMIT_INTERVAL = 1.0  # 最小发射间隔（秒）

        def on_progress_update(idx: int, progress: int):
            """进度更新回调（带节流）"""
            if not self._is_fanxing_callback_active(task_uuid, phase="progress"):
                return
            current_time = time.time()

            # 节流条件：进度变化 >= 5% 或 距上次发射 >= 1秒
            progress_delta = progress - last_emitted_progress[0]
            time_delta = current_time - last_emit_time[0]

            should_emit = (
                progress_delta >= 5  # 进度变化足够大
                or time_delta >= MIN_EMIT_INTERVAL  # 时间间隔足够长
                or progress >= 100  # 完成时必须发射
            )

            if not should_emit:
                return

            last_emitted_progress[0] = progress
            last_emit_time[0] = current_time

            # 注意：FanxingBatchPoller 回调运行在普通 Python 线程中，
            # 在该线程使用 QTimer.singleShot 可能不会触发。
            # 直接 emit 由 Qt 自动跨线程排队到接收者线程。
            _gen_id = getattr(self, "generation_id", "")
            _tid = f"[{str(task_uuid)[:8]}...]" if task_uuid else ""
            msg = ("生成中..." + _tid) if _tid else "生成中..."
            self._safe_emit("progress", progress, 100)
            self._safe_emit("task_completed", idx, True, msg, _gen_id)

        def on_network_error(task_uuid: str, error: Exception):
            if not self._is_fanxing_callback_active(task_uuid, phase="network_error"):
                return
            _gen_id = getattr(self, "generation_id", "")
            _tid = f"[{str(task_uuid)[:8]}...]" if task_uuid else ""
            msg = (
                ("网络异常，正在重试...\n" + _tid) if _tid else "网络异常，正在重试..."
            )
            logging.debug(
                "[FanxingPollWait] trace=%s network_retry error=%s",
                format_request_trace(wait_trace, phase="poll_network_retry"),
                str(error),
            )
            direct_network_error_callback = getattr(
                self, "_network_error_callback", None
            )
            if callable(direct_network_error_callback):
                try:
                    direct_network_error_callback(task_uuid, error)
                except Exception:
                    logging.exception(
                        "[FanxingPollWait] direct network callback failed trace=%s",
                        format_request_trace(wait_trace, phase="poll_network_retry"),
                    )
            self._safe_emit("task_completed", task_index, True, msg, _gen_id)

        # 注册到批量轮询管理器（使用用户配置的超时时间，不再硬编码限制）
        max_wait = timeout
        logging.info(
            "[FanxingPollWait] trace=%s timeout=%ss",
            format_request_trace(wait_trace, phase="poll_register"),
            max_wait,
        )
        capability = self._resolve_fanxing_task_capability(request_payload)
        generation_id = str(getattr(self, "generation_id", "") or "").strip()
        lifecycle_type = str(
            (request_payload or {}).get("lifecycle_type") or ""
        ).strip().lower()
        render_mode = str(
            (request_payload or {}).get("render_mode") or ""
        ).strip().lower()
        request_source = str(
            (request_payload or {}).get("source") or ""
        ).strip().lower()
        if capability == "cf_task":
            task_type = "image_process_cf_task"
        elif (
            lifecycle_type == "interactive_image_generation"
            and render_mode == "canvas"
        ):
            task_type = "canvas_generation"
        elif (
            lifecycle_type == "interactive_image_generation"
            and render_mode == "grid"
        ):
            task_type = "grid_generation"
        elif (
            lifecycle_type == "interactive_image_generation"
            and render_mode == "batch"
        ) or request_source == "batch_generation":
            task_type = "batch_generation"
        else:
            task_type = (
                "canvas_generation"
                if generation_id.startswith("gen_")
                else (
                    "grid_generation"
                    if generation_id.startswith("grid_")
                    else "ecom_single_tile_generation"
                )
            )
        if task_type in {
            "canvas_generation",
            "grid_generation",
            "batch_generation",
        }:
            max_wait = max(int(max_wait or 0), 1800)

        dispatcher = get_fanxing_task_dispatcher()
        if submission is None:
            submission = dispatcher.resolve_submission(
                worker_context=self,
                request_payload=request_payload,
                task_uuid=task_uuid,
                base_url=base_url,
                headers=headers,
                task_index=task_index,
                capability=capability,
            )
        scheduler_task_id = str(
            (request_payload or {}).get("scheduler_task_id") or ""
        ).strip()
        if not scheduler_task_id and task_type in {
            "canvas_generation",
            "grid_generation",
            "batch_generation",
        }:
            try:
                scheduler_task_id = str(
                    (getattr(self, "scheduler_task_id_map", {}) or {}).get(
                        int(task_index or 0)
                    )
                    or ""
                ).strip()
            except Exception:
                scheduler_task_id = ""
        generation_id = str(generation_id or submission.generation_id or "").strip()
        capability = str(
            capability or submission.capability or "image_generation"
        ).strip()
        poller_submission = replace(
            submission,
            task_type=task_type,
            scheduler_task_id=scheduler_task_id,
            generation_id=generation_id,
            lifecycle_type=lifecycle_type,
            render_mode=render_mode,
            capability=capability,
        )
        lifecycle_guard = get_lifecycle_guard()
        identity_task_types = {
            "canvas_generation",
            "grid_generation",
            "batch_generation",
            "ecom_single_tile_generation",
        }
        requires_full_identity = task_type in identity_task_types
        identity_generation_id = str(
            generation_id
            or submission.generation_id
            or (request_payload or {}).get("dispatch_batch_id")
            or (request_payload or {}).get("batch_id")
            or ""
        ).strip()
        lifecycle_guard.validate_identity(
            phase="poll_wait_enter",
            scheduler_task_id=scheduler_task_id,
            generation_id=identity_generation_id,
            task_index=task_index,
            provider_task_uuid=task_uuid,
            require_provider_task_uuid=True,
            require_generation_id=requires_full_identity,
            require_task_index=requires_full_identity,
            require_scheduler_task_id=requires_full_identity,
            task_type=task_type,
            lifecycle_type=lifecycle_type,
            render_mode=render_mode,
        )
        waiting_thread_registered = False
        poll_task_registered = False
        try:
            lifecycle_guard.register_waiting_thread(
                task_uuid=task_uuid,
                generation_id=identity_generation_id,
                task_index=task_index,
                scheduler_task_id=scheduler_task_id,
                timeout_sec=int(max_wait or 0),
                capability=capability,
            )
            waiting_thread_registered = True
            result_wait_handle = result_dispatcher.register_waiter(
                task_uuid=task_uuid,
                source="request_wait",
            )
            self._register_fanxing_poll_task(task_uuid)
            poll_task_registered = True
            dispatcher.register_poller_task(
                poller=_fanxing_batch_poller,
                submission=poller_submission,
                callback=on_task_complete,
                timeout=max_wait,
                progress_callback=on_progress_update,
                network_error_callback=on_network_error,
                concurrency_acquired=concurrency_acquired,
            )

            # 等待任务完成（超时由 FanxingBatchPoller 基于活动时间统一管理）
            # 优化：使用更长的等待间隔（0.5秒），减少 CPU 占用
            # 同时在等待期间允许 Qt 事件循环处理
            route_wait_logged = False
            route_wait_fallback_logged = False
            while not result_event.is_set():
                # 检查用户中止
                stop_callback = getattr(self, "_stop_callback", None)
                should_stop = bool(self._stop_requested) or bool(
                    callable(stop_callback) and stop_callback()
                )
                if should_stop:
                    preserve_remote = bool(
                        getattr(self, "_preserve_remote_tasks_on_stop", False)
                    )
                    if not preserve_remote:
                        _fanxing_batch_poller.unregister_task(task_uuid)
                    else:
                        logging.info(
                            "[FanxingRequestHandler] trace=%s preserve_remote_on_stop=true",
                            format_request_trace(wait_trace, phase="poll_stop_wait"),
                        )
                    raise RuntimeError("任务被用户中止")

                if route_wait_enabled:
                    if result_wait_handle.wait(0.5):
                        delivery = result_wait_handle.get_delivery()
                        if delivery is not None and result_container["success"] is None:
                            result_container["success"] = delivery.routed.success
                            result_container["data"] = delivery.result_or_error
                            result_event.set()
                            if not route_wait_logged:
                                logging.info(
                                    "[FanxingPollWait] trace=%s result_route_wait_delivered success=%s",
                                    format_request_trace(
                                        wait_trace,
                                        phase="result_route_wait",
                                    ),
                                    int(delivery.routed.success),
                                )
                                route_wait_logged = True
                    elif (
                        legacy_callback_event.is_set()
                        and result_container["success"] is None
                    ):
                        received_at = float(
                            legacy_callback_container.get("received_at") or 0.0
                        )
                        if (
                            received_at
                            and time.time() - received_at >= route_wait_fallback_seconds
                        ):
                            result_container["success"] = legacy_callback_container[
                                "success"
                            ]
                            result_container["data"] = legacy_callback_container["data"]
                            result_event.set()
                            if not route_wait_fallback_logged:
                                logging.warning(
                                    "[FanxingPollWait] trace=%s result_route_wait_fallback_to_legacy grace_seconds=%.1f",
                                    format_request_trace(
                                        wait_trace,
                                        phase="result_route_wait_fallback",
                                    ),
                                    route_wait_fallback_seconds,
                                )
                                route_wait_fallback_logged = True
                else:
                    result_event.wait(0.5)

            # 处理结果
            if result_container["success"]:
                result_payload = result_container["data"]
                if isinstance(result_payload, dict):
                    payload_size = len(result_payload)
                elif isinstance(result_payload, (list, tuple)):
                    payload_size = len(list(result_payload))
                else:
                    payload_size = 0
                logging.info(
                    "[FanxingPollWait] trace=%s result_count=%s result_type=%s",
                    format_request_trace(wait_trace, phase="poll_success"),
                    payload_size,
                    type(result_payload).__name__,
                )
                return self._convert_fanxing_result(result_payload)
            else:
                error_msg = result_container["data"]
                normalized_error = str(error_msg or "")
                is_canceled = "任务已取消" in normalized_error or "task canceled" in normalized_error.lower()
                log_fn = logging.info if is_canceled else logging.warning
                log_fn(
                    "[FanxingPollWait] trace=%s error=%s",
                    format_request_trace(wait_trace, phase="poll_failed"),
                    normalized_error,
                )
                raise RuntimeError(f"任务失败: {error_msg}")
        finally:
            if waiting_thread_registered:
                lifecycle_guard.unregister_waiting_thread(
                    task_uuid=task_uuid,
                    reason="poll_wait_exit",
                )
            result_dispatcher.unregister_waiter(result_wait_handle)
            if poll_task_registered:
                self._unregister_fanxing_poll_task(task_uuid)

    def _resolve_fanxing_task_capability(self, request_payload: dict) -> str:
        feature_type = str(
            (request_payload or {}).get("fanxing_feature_type") or ""
        ).strip()
        if feature_type == "cf-task":
            return "cf_task"
        return "image_generation"

    def _convert_fanxing_result(self, result_payload) -> dict:
        """将繁星结果转换为兼容现有格式

        Args:
            result_payload: 轮询成功后的结果 payload

        Returns:
            兼容 OpenAI 格式的响应字典
        """
        if isinstance(result_payload, dict):
            return dict(result_payload)

        if not isinstance(result_payload, (list, tuple)):
            raise RuntimeError(
                f"繁星结果格式错误: {type(result_payload).__name__}"
            )

        # 转换为 OpenAI images/generations 格式
        data = []
        for url in list(result_payload or []):
            normalized_url = str(url or "").strip()
            if not normalized_url:
                continue
            data.append({"url": normalized_url})

        return {"data": data}
