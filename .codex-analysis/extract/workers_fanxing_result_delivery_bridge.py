# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from workers.fanxing.enhancement_config import get_enhancement_config


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FanxingUiDeliverySnapshot:
    task_index: int
    success: bool
    mode: str = ""
    source: str = ""
    generation_id: str = ""
    scheduler_task_id: str = ""
    payload_count: int = 0
    url_count: int = 0
    base64_count: int = 0
    text_present: bool = False
    error_message: str = ""
    phase: str = ""
    observed_at: float = field(default_factory=time.time)


class FanxingResultDeliveryBridge:
    """Shadow bridge from extracted Fanxing task result to UI-equivalent delivery.

    Current phase is observational only. It validates that the worker has enough
    data to reproduce the existing single_task_ready delivery later, without
    emitting Qt signals or touching UI/result-manager state.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._observed_total = 0
        self._success_total = 0
        self._failure_total = 0
        self._missing_identity_total = 0
        self._missing_payload_total = 0
        self._unsupported_mode_total = 0
        self._duplicate_delivery_total = 0
        self._last_delivery: Dict[str, Any] = {}
        self._last_missing_identity: Dict[str, Any] = {}
        self._last_missing_payload: Dict[str, Any] = {}
        self._last_duplicate: Dict[str, Any] = {}
        self._adapter_attempt_total = 0
        self._adapter_delivered_total = 0
        self._adapter_blocked_total = 0
        self._adapter_fallback_total = 0
        self._last_adapter_delivery: Dict[str, Any] = {}
        self._last_adapter_blocked: Dict[str, Any] = {}
        self._seen_delivery_keys = set()
        self._success_generation_ids = set()
        self._adapter_delivered_generation_ids = set()
        self._success_generation_observed_at: Dict[str, float] = {}
        self._adapter_delivered_generation_observed_at: Dict[str, float] = {}

    @staticmethod
    def _text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return int(default)

    def record_worker_task_result(
        self,
        *,
        worker_context: Any,
        result: Dict[str, Any] | None,
        phase: str = "single_task_ready",
    ) -> Optional[FanxingUiDeliverySnapshot]:
        if self._text(getattr(worker_context, "api_mode", "")) != "fanxing":
            return None

        snapshot = self._build_snapshot(
            worker_context=worker_context,
            result=result,
            phase=phase,
        )
        self._record_snapshot(snapshot)
        return snapshot

    def deliver_worker_task_result(
        self,
        *,
        worker_context: Any,
        result: Dict[str, Any] | None,
        emit_callback: Callable[[int, List[Dict[str, Any]], str, str], None] | None,
        mapped_task_index: int,
        payloads: List[Dict[str, Any]],
        text: str,
        generation_id: str,
        phase: str = "ui_adapter_single_task_ready",
    ) -> bool:
        """Optionally deliver a Fanxing task result through the adapter.

        The adapter is a default-off takeover candidate. When disabled or when
        validation fails, callers must keep the legacy signal path.
        """
        if self._text(getattr(worker_context, "api_mode", "")) != "fanxing":
            return False
        snapshot = self._build_snapshot(
            worker_context=worker_context,
            result=result,
            phase=phase,
        )
        config = get_enhancement_config()
        if not bool(getattr(config, "result_delivery_adapter_takeover", False)):
            self._record_adapter_result(snapshot, delivered=False, reason="disabled")
            return False
        if not snapshot.success:
            self._record_adapter_result(snapshot, delivered=False, reason="not_success")
            return False
        if not snapshot.generation_id or not snapshot.scheduler_task_id:
            self._record_adapter_result(
                snapshot,
                delivered=False,
                reason="missing_identity",
            )
            return False
        if snapshot.payload_count <= 0 or not payloads:
            self._record_adapter_result(
                snapshot,
                delivered=False,
                reason="missing_payload",
            )
            return False
        if snapshot.mode not in {"canvas", "grid"}:
            self._record_adapter_result(
                snapshot,
                delivered=False,
                reason="unsupported_mode",
            )
            return False
        if emit_callback is None:
            self._record_adapter_result(
                snapshot,
                delivered=False,
                reason="callback_missing",
            )
            return False
        try:
            emit_callback(
                int(mapped_task_index),
                list(payloads or []),
                str(text or ""),
                str(generation_id or ""),
            )
        except Exception:
            logger.exception(
                "[FanxingResultDeliveryBridge] adapter_emit_failed generation_id=%s "
                "scheduler_task_id=%s task_index=%s",
                snapshot.generation_id or "-",
                snapshot.scheduler_task_id or "-",
                snapshot.task_index,
            )
            self._record_adapter_result(
                snapshot,
                delivered=False,
                reason="emit_exception",
            )
            return False
        self._record_adapter_result(snapshot, delivered=True, reason="delivered")
        return True

    def _build_snapshot(
        self,
        *,
        worker_context: Any,
        result: Dict[str, Any] | None,
        phase: str,
    ) -> FanxingUiDeliverySnapshot:
        payload = dict(result or {})
        task_index = self._int(payload.get("index"), 0)
        payloads = list(payload.get("payloads") or [])
        success = bool(payload.get("success"))
        mode = self._resolve_mode(worker_context, payloads)
        source = self._resolve_source(worker_context, payloads)
        generation_id = self._text(getattr(worker_context, "generation_id", ""))
        scheduler_task_id = self._text(payload.get("scheduler_task_id"))
        if not scheduler_task_id:
            try:
                scheduler_task_id = self._text(
                    (getattr(worker_context, "scheduler_task_id_map", {}) or {}).get(
                        task_index
                    )
                )
            except Exception:
                scheduler_task_id = ""

        url_count = 0
        base64_count = 0
        for item in payloads:
            if not isinstance(item, dict):
                continue
            if self._text(item.get("type")).lower() == "url" or self._text(
                item.get("url")
            ):
                url_count += 1
            elif self._text(item.get("data")):
                base64_count += 1

        snapshot = FanxingUiDeliverySnapshot(
            task_index=task_index,
            success=success,
            mode=mode,
            source=source,
            generation_id=generation_id,
            scheduler_task_id=scheduler_task_id,
            payload_count=len(payloads),
            url_count=url_count,
            base64_count=base64_count,
            text_present=bool(self._text(payload.get("text"))),
            error_message="" if success else self._text(payload.get("error")),
            phase=self._text(phase) or "single_task_ready",
        )
        return snapshot

    def get_defensive_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "observed_total": int(self._observed_total),
                "success_total": int(self._success_total),
                "failure_total": int(self._failure_total),
                "missing_identity_total": int(self._missing_identity_total),
                "missing_payload_total": int(self._missing_payload_total),
                "unsupported_mode_total": int(self._unsupported_mode_total),
                "duplicate_delivery_total": int(self._duplicate_delivery_total),
                "last_delivery": dict(self._last_delivery),
                "last_missing_identity": dict(self._last_missing_identity),
                "last_missing_payload": dict(self._last_missing_payload),
                "last_duplicate": dict(self._last_duplicate),
                "adapter_attempt_total": int(self._adapter_attempt_total),
                "adapter_delivered_total": int(self._adapter_delivered_total),
                "adapter_blocked_total": int(self._adapter_blocked_total),
                "adapter_fallback_total": int(self._adapter_fallback_total),
                "last_adapter_delivery": dict(self._last_adapter_delivery),
                "last_adapter_blocked": dict(self._last_adapter_blocked),
                "success_generation_ids": sorted(self._success_generation_ids),
                "adapter_delivered_generation_ids": sorted(
                    self._adapter_delivered_generation_ids
                ),
                "success_generation_observed_at": dict(
                    self._success_generation_observed_at
                ),
                "adapter_delivered_generation_observed_at": dict(
                    self._adapter_delivered_generation_observed_at
                ),
            }

    def _record_snapshot(self, snapshot: FanxingUiDeliverySnapshot) -> None:
        summary = self._snapshot_summary(snapshot)
        duplicate = False
        missing_identity = bool(
            snapshot.success
            and (not snapshot.generation_id or not snapshot.scheduler_task_id)
        )
        missing_payload = bool(snapshot.success and snapshot.payload_count <= 0)
        unsupported_mode = bool(snapshot.success and snapshot.mode not in {"canvas", "grid"})
        key = (
            snapshot.generation_id,
            snapshot.scheduler_task_id,
            snapshot.task_index,
            snapshot.phase,
        )
        with self._lock:
            self._observed_total += 1
            if snapshot.success:
                self._success_total += 1
                if snapshot.generation_id:
                    self._success_generation_ids.add(snapshot.generation_id)
                    self._success_generation_observed_at[
                        snapshot.generation_id
                    ] = float(snapshot.observed_at)
            else:
                self._failure_total += 1
            if missing_identity:
                self._missing_identity_total += 1
                self._last_missing_identity = summary
            if missing_payload:
                self._missing_payload_total += 1
                self._last_missing_payload = summary
            if unsupported_mode:
                self._unsupported_mode_total += 1
            if snapshot.success and key in self._seen_delivery_keys:
                self._duplicate_delivery_total += 1
                self._last_duplicate = summary
                duplicate = True
            elif snapshot.success:
                self._seen_delivery_keys.add(key)
                if len(self._seen_delivery_keys) > 3000:
                    self._seen_delivery_keys = set(list(self._seen_delivery_keys)[-2000:])
                    self._success_generation_ids = {
                        item
                        for item in self._success_generation_ids
                        if any(item == key[0] for key in self._seen_delivery_keys)
                    }
                    self._success_generation_observed_at = {
                        item: observed_at
                        for item, observed_at in self._success_generation_observed_at.items()
                        if item in self._success_generation_ids
                    }
            self._last_delivery = summary

        config = get_enhancement_config()
        if bool(getattr(config, "result_delivery_bridge_shadow_log", True)):
            logger.info(
                "[FanxingResultDeliveryBridge] shadow_delivery mode=%s source=%s "
                "generation_id=%s scheduler_task_id=%s task_index=%s success=%s "
                "payloads=%s urls=%s base64=%s missing_identity=%s missing_payload=%s duplicate=%s",
                snapshot.mode or "-",
                snapshot.source or "-",
                snapshot.generation_id or "-",
                snapshot.scheduler_task_id or "-",
                snapshot.task_index,
                int(bool(snapshot.success)),
                snapshot.payload_count,
                snapshot.url_count,
                snapshot.base64_count,
                int(missing_identity),
                int(missing_payload),
                int(duplicate),
            )

    def _record_adapter_result(
        self,
        snapshot: FanxingUiDeliverySnapshot,
        *,
        delivered: bool,
        reason: str,
    ) -> None:
        summary = self._snapshot_summary(snapshot)
        summary["reason"] = self._text(reason) or "-"
        with self._lock:
            self._adapter_attempt_total += 1
            if delivered:
                self._adapter_delivered_total += 1
                self._last_adapter_delivery = summary
                if snapshot.generation_id:
                    self._adapter_delivered_generation_ids.add(snapshot.generation_id)
                    self._adapter_delivered_generation_observed_at[
                        snapshot.generation_id
                    ] = float(snapshot.observed_at)
                    if len(self._adapter_delivered_generation_ids) > 3000:
                        self._adapter_delivered_generation_ids = set(
                            list(self._adapter_delivered_generation_ids)[-2000:]
                        )
                        self._adapter_delivered_generation_observed_at = {
                            item: observed_at
                            for item, observed_at in self._adapter_delivered_generation_observed_at.items()
                            if item in self._adapter_delivered_generation_ids
                        }
            else:
                if reason == "disabled":
                    self._adapter_blocked_total += 1
                else:
                    self._adapter_fallback_total += 1
                self._last_adapter_blocked = summary

        config = get_enhancement_config()
        if delivered or bool(getattr(config, "result_delivery_adapter_takeover", False)):
            logger.info(
                "[FanxingResultDeliveryBridge] adapter_delivery delivered=%s reason=%s "
                "mode=%s source=%s generation_id=%s scheduler_task_id=%s "
                "task_index=%s payloads=%s",
                int(bool(delivered)),
                self._text(reason) or "-",
                snapshot.mode or "-",
                snapshot.source or "-",
                snapshot.generation_id or "-",
                snapshot.scheduler_task_id or "-",
                snapshot.task_index,
                snapshot.payload_count,
            )

    def _resolve_mode(self, worker_context: Any, payloads: List[Dict[str, Any]]) -> str:
        mode = self._text(getattr(worker_context, "request_mode", "")).lower()
        if mode:
            return mode
        source = self._resolve_source(worker_context, payloads)
        if source in {
            "canvas_generation",
            "canvas_image_process",
            "canvas_element_transform",
            "ecom_chain",
            "ecom_chain_single_image",
        }:
            return "canvas"
        if source == "grid_generation":
            return "grid"
        render_mode = self._text(
            (getattr(worker_context, "extra_request_payload", {}) or {}).get(
                "render_mode"
            )
        ).lower()
        if render_mode in {"canvas", "grid"}:
            return render_mode
        generation_id = self._text(getattr(worker_context, "generation_id", ""))
        if generation_id.startswith("grid_"):
            return "grid"
        return "canvas" if generation_id else ""

    def _resolve_source(self, worker_context: Any, payloads: List[Dict[str, Any]]) -> str:
        source = self._text(getattr(worker_context, "request_source", ""))
        if source:
            return source
        extra_payload = getattr(worker_context, "extra_request_payload", {}) or {}
        source = self._text(extra_payload.get("source"))
        if source:
            return source
        for payload in payloads:
            if not isinstance(payload, dict):
                continue
            request_meta = payload.get("request_meta")
            if isinstance(request_meta, dict):
                source = self._text(request_meta.get("source"))
                if source:
                    return source
        request_mode = self._text(getattr(worker_context, "request_mode", "")).lower()
        render_mode = self._text(extra_payload.get("render_mode")).lower()
        generation_id = self._text(getattr(worker_context, "generation_id", ""))
        if (
            request_mode == "grid"
            or render_mode == "grid"
            or generation_id.startswith("grid_")
        ):
            return "grid_generation"
        if (
            request_mode == "canvas"
            or render_mode == "canvas"
            or generation_id.startswith("gen_")
        ):
            return "canvas_generation"
        return ""

    def _snapshot_summary(self, snapshot: FanxingUiDeliverySnapshot) -> Dict[str, Any]:
        return {
            "task_index": int(snapshot.task_index),
            "success": bool(snapshot.success),
            "mode": snapshot.mode,
            "source": snapshot.source,
            "generation_id": snapshot.generation_id,
            "scheduler_task_id": snapshot.scheduler_task_id,
            "payload_count": int(snapshot.payload_count),
            "url_count": int(snapshot.url_count),
            "base64_count": int(snapshot.base64_count),
            "phase": snapshot.phase,
        }


_fanxing_result_delivery_bridge: Optional[FanxingResultDeliveryBridge] = None
_fanxing_result_delivery_bridge_lock = threading.Lock()


def get_fanxing_result_delivery_bridge() -> FanxingResultDeliveryBridge:
    global _fanxing_result_delivery_bridge
    if _fanxing_result_delivery_bridge is None:
        with _fanxing_result_delivery_bridge_lock:
            if _fanxing_result_delivery_bridge is None:
                _fanxing_result_delivery_bridge = FanxingResultDeliveryBridge()
    return _fanxing_result_delivery_bridge
