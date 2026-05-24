# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from workers.fanxing.enhancement_config import get_enhancement_config


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FanxingWorkerFinishSnapshot:
    signal_type: str
    success: bool
    generation_id: str = ""
    mode: str = ""
    source: str = ""
    scheduler_task_ids: List[str] = field(default_factory=list)
    task_count: int = 0
    produced_count: int = 0
    text_count: int = 0
    elapsed: float = 0.0
    error_type: str = ""
    error_message: str = ""
    canceled: bool = False
    timeout: bool = False
    phase: str = ""
    observed_at: float = field(default_factory=time.time)


class FanxingResultFinishBridge:
    """Shadow bridge for ApiWorker finished_ok / finished_err events.

    This bridge is observational only. It records finish-signal equivalents and
    defensive counters before the legacy Qt signal is emitted, without emitting
    signals, releasing worker waits, or touching UI state.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._observed_total = 0
        self._ok_total = 0
        self._err_total = 0
        self._cancel_total = 0
        self._timeout_total = 0
        self._missing_identity_total = 0
        self._duplicate_ok_total = 0
        self._duplicate_err_total = 0
        self._conflicting_terminal_total = 0
        self._error_after_delivery_total = 0
        self._missing_after_delivery_total = 0
        self._last_finish: Dict[str, Any] = {}
        self._last_missing_identity: Dict[str, Any] = {}
        self._last_duplicate_ok: Dict[str, Any] = {}
        self._last_duplicate_err: Dict[str, Any] = {}
        self._last_conflict: Dict[str, Any] = {}
        self._last_error_after_delivery: Dict[str, Any] = {}
        self._last_missing_after_delivery: Dict[str, Any] = {}
        self._terminal_by_generation: Dict[str, str] = {}
        self._ok_generation_ids = set()
        self._err_generation_ids = set()
        self._reported_missing_after_delivery = set()

    @staticmethod
    def _text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _safe_len(value: Any) -> int:
        try:
            return len(value or [])
        except Exception:
            return 0

    def record_finished_ok(
        self,
        *,
        worker_context: Any,
        images: List[Any] | None,
        texts: List[str] | None,
        elapsed: float,
        generation_id: str,
        phase: str = "finished_ok_emit",
    ) -> Optional[FanxingWorkerFinishSnapshot]:
        if self._text(getattr(worker_context, "api_mode", "")) != "fanxing":
            return None
        snapshot = self._build_snapshot(
            worker_context=worker_context,
            signal_type="finished_ok",
            success=True,
            generation_id=generation_id,
            produced_count=self._safe_len(images),
            text_count=self._safe_len(texts),
            elapsed=elapsed,
            phase=phase,
        )
        self._record_snapshot(snapshot)
        return snapshot

    def record_finished_err(
        self,
        *,
        worker_context: Any,
        error_message: str,
        generation_id: str,
        error_type: str = "",
        phase: str = "finished_err_emit",
    ) -> Optional[FanxingWorkerFinishSnapshot]:
        if self._text(getattr(worker_context, "api_mode", "")) != "fanxing":
            return None
        safe_error = self._text(error_message)
        lower_error = safe_error.lower()
        safe_error_type = self._text(error_type)
        snapshot = self._build_snapshot(
            worker_context=worker_context,
            signal_type="finished_err",
            success=False,
            generation_id=generation_id,
            error_type=safe_error_type,
            error_message=safe_error,
            canceled=(
                "任务已取消" in safe_error
                or "task canceled" in lower_error
                or safe_error_type.lower() in {"cancel", "canceled", "cancelled"}
            ),
            timeout=("timeout" in safe_error_type.lower() or "超时" in safe_error),
            phase=phase,
        )
        self._record_snapshot(snapshot)
        return snapshot

    def get_defensive_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "observed_total": int(self._observed_total),
                "ok_total": int(self._ok_total),
                "err_total": int(self._err_total),
                "cancel_total": int(self._cancel_total),
                "timeout_total": int(self._timeout_total),
                "missing_identity_total": int(self._missing_identity_total),
                "duplicate_ok_total": int(self._duplicate_ok_total),
                "duplicate_err_total": int(self._duplicate_err_total),
                "conflicting_terminal_total": int(self._conflicting_terminal_total),
                "error_after_delivery_total": int(self._error_after_delivery_total),
                "missing_after_delivery_total": int(
                    self._missing_after_delivery_total
                ),
                "finished_generation_ids": sorted(self._terminal_by_generation.keys()),
                "ok_generation_ids": sorted(self._ok_generation_ids),
                "err_generation_ids": sorted(self._err_generation_ids),
                "last_finish": dict(self._last_finish),
                "last_missing_identity": dict(self._last_missing_identity),
                "last_duplicate_ok": dict(self._last_duplicate_ok),
                "last_duplicate_err": dict(self._last_duplicate_err),
                "last_conflict": dict(self._last_conflict),
                "last_error_after_delivery": dict(self._last_error_after_delivery),
                "last_missing_after_delivery": dict(
                    self._last_missing_after_delivery
                ),
            }

    def audit_missing_after_delivery(
        self,
        *,
        delivery_snapshot: Dict[str, Any] | None,
        poller_snapshot: Dict[str, Any] | None,
        phase: str = "",
    ) -> int:
        """Detect delivered generations that no longer have a worker finish.

        The check is intentionally delayed and ignores generations with active
        poller tasks, so multi-task canvas generations are not reported while
        sibling tasks are still running.
        """
        delivery_data = dict(delivery_snapshot or {})
        poller_data = dict(poller_snapshot or {})
        active_generations = {
            self._text((task or {}).get("generation_id"))
            for task in list(poller_data.get("tasks") or [])
            if self._text((task or {}).get("generation_id"))
        }
        delivered_at: Dict[str, float] = {}
        for key in (
            "success_generation_observed_at",
            "adapter_delivered_generation_observed_at",
        ):
            raw_map = dict(delivery_data.get(key) or {})
            for generation_id, observed_at in raw_map.items():
                normalized_id = self._text(generation_id)
                if not normalized_id:
                    continue
                try:
                    delivered_at[normalized_id] = max(
                        float(delivered_at.get(normalized_id, 0.0)),
                        float(observed_at or 0.0),
                    )
                except Exception:
                    delivered_at.setdefault(normalized_id, 0.0)

        config = get_enhancement_config()
        try:
            grace_seconds = max(
                0.0,
                float(
                    getattr(
                        config,
                        "result_finish_missing_after_delivery_grace_seconds",
                        30.0,
                    )
                    or 0.0
                ),
            )
        except Exception:
            grace_seconds = 30.0
        now = time.time()
        reported = 0
        with self._lock:
            finished = set(self._terminal_by_generation.keys())
            for generation_id, observed_at in delivered_at.items():
                if generation_id in finished:
                    continue
                if generation_id in active_generations:
                    continue
                if generation_id in self._reported_missing_after_delivery:
                    continue
                if observed_at and now - float(observed_at) < grace_seconds:
                    continue
                summary = {
                    "generation_id": generation_id,
                    "phase": self._text(phase) or "-",
                    "delivered_age_sec": round(
                        max(0.0, now - float(observed_at or now)),
                        3,
                    ),
                    "grace_seconds": float(grace_seconds),
                }
                self._missing_after_delivery_total += 1
                self._last_missing_after_delivery = summary
                self._reported_missing_after_delivery.add(generation_id)
                reported += 1
        if reported:
            logger.warning(
                "[FanxingResultFinishBridge] finish_missing_after_delivery "
                "phase=%s count=%s last=%s",
                self._text(phase) or "-",
                reported,
                dict(self._last_missing_after_delivery),
            )
        return reported

    def _build_snapshot(
        self,
        *,
        worker_context: Any,
        signal_type: str,
        success: bool,
        generation_id: str,
        produced_count: int = 0,
        text_count: int = 0,
        elapsed: float = 0.0,
        error_type: str = "",
        error_message: str = "",
        canceled: bool = False,
        timeout: bool = False,
        phase: str,
    ) -> FanxingWorkerFinishSnapshot:
        scheduler_ids = []
        try:
            raw_map = getattr(worker_context, "scheduler_task_id_map", {}) or {}
            scheduler_ids = [
                self._text(value) for value in raw_map.values() if self._text(value)
            ]
        except Exception:
            scheduler_ids = []
        return FanxingWorkerFinishSnapshot(
            signal_type=self._text(signal_type),
            success=bool(success),
            generation_id=self._text(generation_id)
            or self._text(getattr(worker_context, "generation_id", "")),
            mode=self._resolve_mode(worker_context),
            source=self._resolve_source(worker_context),
            scheduler_task_ids=scheduler_ids,
            task_count=int(getattr(worker_context, "batch_size", 0) or 0),
            produced_count=int(produced_count or 0),
            text_count=int(text_count or 0),
            elapsed=max(0.0, float(elapsed or 0.0)),
            error_type=self._text(error_type),
            error_message=self._text(error_message),
            canceled=bool(canceled),
            timeout=bool(timeout),
            phase=self._text(phase) or self._text(signal_type),
        )

    def _record_snapshot(self, snapshot: FanxingWorkerFinishSnapshot) -> None:
        summary = self._snapshot_summary(snapshot)
        missing_identity = not bool(snapshot.generation_id)
        duplicate_ok = False
        duplicate_err = False
        conflict = False
        error_after_delivery = False
        previous_terminal = ""
        generation_key = snapshot.generation_id

        delivery_generation_ids = set()
        if generation_key and not snapshot.success:
            try:
                from workers.fanxing.result_delivery_bridge import (
                    get_fanxing_result_delivery_bridge,
                )

                delivery_snapshot = (
                    get_fanxing_result_delivery_bridge().get_defensive_snapshot()
                )
                delivery_generation_ids.update(
                    str(item or "").strip()
                    for item in delivery_snapshot.get("adapter_delivered_generation_ids", [])
                    if str(item or "").strip()
                )
                delivery_generation_ids.update(
                    str(item or "").strip()
                    for item in delivery_snapshot.get("success_generation_ids", [])
                    if str(item or "").strip()
                )
            except Exception:
                delivery_generation_ids = set()
            error_after_delivery = generation_key in delivery_generation_ids

        with self._lock:
            self._observed_total += 1
            if snapshot.success:
                self._ok_total += 1
            else:
                self._err_total += 1
            if snapshot.canceled:
                self._cancel_total += 1
            if snapshot.timeout:
                self._timeout_total += 1
            if missing_identity:
                self._missing_identity_total += 1
                self._last_missing_identity = summary
            if generation_key:
                previous_terminal = self._terminal_by_generation.get(generation_key, "")
                if snapshot.success:
                    duplicate_ok = generation_key in self._ok_generation_ids
                    if duplicate_ok:
                        self._duplicate_ok_total += 1
                        self._last_duplicate_ok = summary
                    self._ok_generation_ids.add(generation_key)
                else:
                    duplicate_err = generation_key in self._err_generation_ids
                    if duplicate_err:
                        self._duplicate_err_total += 1
                        self._last_duplicate_err = summary
                    self._err_generation_ids.add(generation_key)
                if previous_terminal and previous_terminal != snapshot.signal_type:
                    conflict = True
                    self._conflicting_terminal_total += 1
                    conflict_summary = dict(summary)
                    conflict_summary["previous_signal_type"] = previous_terminal
                    self._last_conflict = conflict_summary
                self._terminal_by_generation[generation_key] = snapshot.signal_type
                if len(self._terminal_by_generation) > 3000:
                    keep_keys = list(self._terminal_by_generation.keys())[-2000:]
                    self._terminal_by_generation = {
                        key: self._terminal_by_generation[key] for key in keep_keys
                    }
                    self._ok_generation_ids = {
                        key for key in self._ok_generation_ids if key in self._terminal_by_generation
                    }
                    self._err_generation_ids = {
                        key for key in self._err_generation_ids if key in self._terminal_by_generation
                    }
            if error_after_delivery:
                self._error_after_delivery_total += 1
                self._last_error_after_delivery = summary
            self._last_finish = summary

        config = get_enhancement_config()
        if bool(getattr(config, "result_finish_bridge_shadow_log", True)):
            logger.info(
                "[FanxingResultFinishBridge] finish_shadow_observed signal=%s "
                "success=%s mode=%s source=%s generation_id=%s task_count=%s "
                "produced=%s texts=%s scheduler_ids=%s canceled=%s timeout=%s "
                "missing_identity=%s duplicate_ok=%s duplicate_err=%s "
                "conflict=%s error_after_delivery=%s",
                snapshot.signal_type or "-",
                int(bool(snapshot.success)),
                snapshot.mode or "-",
                snapshot.source or "-",
                snapshot.generation_id or "-",
                snapshot.task_count,
                snapshot.produced_count,
                snapshot.text_count,
                len(snapshot.scheduler_task_ids),
                int(bool(snapshot.canceled)),
                int(bool(snapshot.timeout)),
                int(missing_identity),
                int(duplicate_ok),
                int(duplicate_err),
                int(conflict),
                int(error_after_delivery),
            )

    def _resolve_mode(self, worker_context: Any) -> str:
        mode = self._text(getattr(worker_context, "request_mode", "")).lower()
        if mode:
            return mode
        extra_payload = getattr(worker_context, "extra_request_payload", {}) or {}
        render_mode = self._text(extra_payload.get("render_mode")).lower()
        if render_mode in {"canvas", "grid"}:
            return render_mode
        source = self._resolve_source(worker_context)
        if source == "grid_generation":
            return "grid"
        if source:
            return "canvas"
        generation_id = self._text(getattr(worker_context, "generation_id", ""))
        if generation_id.startswith("grid_"):
            return "grid"
        return "canvas" if generation_id else ""

    def _resolve_source(self, worker_context: Any) -> str:
        source = self._text(getattr(worker_context, "request_source", ""))
        if source:
            return source
        extra_payload = getattr(worker_context, "extra_request_payload", {}) or {}
        source = self._text(extra_payload.get("source"))
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

    def _snapshot_summary(
        self, snapshot: FanxingWorkerFinishSnapshot
    ) -> Dict[str, Any]:
        return {
            "signal_type": snapshot.signal_type,
            "success": bool(snapshot.success),
            "generation_id": snapshot.generation_id,
            "mode": snapshot.mode,
            "source": snapshot.source,
            "task_count": int(snapshot.task_count),
            "produced_count": int(snapshot.produced_count),
            "text_count": int(snapshot.text_count),
            "scheduler_id_count": len(snapshot.scheduler_task_ids),
            "error_type": snapshot.error_type,
            "canceled": bool(snapshot.canceled),
            "timeout": bool(snapshot.timeout),
            "phase": snapshot.phase,
        }


_fanxing_result_finish_bridge: Optional[FanxingResultFinishBridge] = None
_fanxing_result_finish_bridge_lock = threading.Lock()


def get_fanxing_result_finish_bridge() -> FanxingResultFinishBridge:
    global _fanxing_result_finish_bridge
    if _fanxing_result_finish_bridge is None:
        with _fanxing_result_finish_bridge_lock:
            if _fanxing_result_finish_bridge is None:
                _fanxing_result_finish_bridge = FanxingResultFinishBridge()
    return _fanxing_result_finish_bridge
