# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from managers.task_ledger import get_task_ledger_store


@dataclass(frozen=True)
class FanxingRoutedResult:
    task_uuid: str
    success: bool
    generation_id: str = ""
    scheduler_task_id: str = ""
    task_index: int = 0
    task_type: str = ""
    capability: str = ""
    has_callback: bool = False
    ledger_state: str = ""
    result_count: int = 0
    error_message: str = ""
    routed_at: float = field(default_factory=time.time)


@dataclass(frozen=True)
class FanxingTerminalDelivery:
    routed: FanxingRoutedResult
    result_or_error: Any
    delivered_at: float = field(default_factory=time.time)


class FanxingResultWaitHandle:
    def __init__(self, *, task_uuid: str, source: str = ""):
        self.task_uuid = str(task_uuid or "").strip()
        self.source = str(source or "").strip()
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._delivery: Optional[FanxingTerminalDelivery] = None
        self._closed = False

    def deliver(self, delivery: FanxingTerminalDelivery) -> bool:
        with self._lock:
            if self._closed or self._delivery is not None:
                return False
            self._delivery = delivery
            self._event.set()
            return True

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self._event.wait(timeout)

    def get_delivery(self) -> Optional[FanxingTerminalDelivery]:
        with self._lock:
            return self._delivery

    def close(self) -> None:
        with self._lock:
            self._closed = True


class FanxingResultDispatcher:
    """Phase 2 terminal-result landing point.

    This dispatcher is observational in the current phase. It records the
    terminal poller result and identity needed by future detached routing, while
    leaving existing worker callbacks and UI behavior unchanged.
    """

    def __init__(self, *, ledger_store_factory=get_task_ledger_store):
        self._ledger_store_factory = ledger_store_factory
        self._lock = threading.RLock()
        self._terminal_total = 0
        self._success_total = 0
        self._failure_total = 0
        self._missing_ledger_total = 0
        self._missing_identity_total = 0
        self._without_callback_total = 0
        self._duplicate_terminal_total = 0
        self._published_terminal_total = 0
        self._duplicate_publish_total = 0
        self._publish_missing_total = 0
        self._waiter_registered_total = 0
        self._waiter_delivered_total = 0
        self._last_result: Dict[str, Any] = {}
        self._last_duplicate: Dict[str, Any] = {}
        self._last_published: Dict[str, Any] = {}
        self._results_by_task: Dict[str, Dict[str, Any]] = {}
        self._deliveries_by_task: Dict[str, FanxingTerminalDelivery] = {}
        self._published_task_uuids = set()
        self._waiters_by_task: Dict[str, List[FanxingResultWaitHandle]] = {}

    @staticmethod
    def _text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return int(default)

    def record_terminal_result(
        self,
        *,
        task_uuid: str,
        success: bool,
        result_or_error: Any,
        task_data: Dict[str, Any] | None = None,
        has_callback: bool = False,
    ) -> FanxingRoutedResult:
        normalized_task_uuid = self._text(task_uuid)
        task = dict(task_data or {})
        ledger_record: Dict[str, Any] = {}
        missing_ledger = False
        try:
            ledger_store = self._ledger_store_factory()
            finder = getattr(ledger_store, "find_record_by_provider_task_uuid", None)
            if callable(finder):
                ledger_record = finder(normalized_task_uuid) or {}
                missing_ledger = not bool(ledger_record)
            else:
                missing_ledger = True
        except Exception:
            missing_ledger = True
            logging.exception(
                "[FanxingResultDispatcher] ledger lookup failed task_uuid=%s",
                normalized_task_uuid or "-",
            )

        routed = FanxingRoutedResult(
            task_uuid=normalized_task_uuid,
            success=bool(success),
            generation_id=self._text(task.get("generation_id"))
            or self._text(ledger_record.get("generation_id")),
            scheduler_task_id=self._text(task.get("scheduler_task_id"))
            or self._text(ledger_record.get("scheduler_task_id")),
            task_index=self._int(
                task.get("task_index", ledger_record.get("task_index", 0)),
                0,
            ),
            task_type=self._text(task.get("task_type"))
            or self._text(ledger_record.get("task_type")),
            capability=self._text(task.get("capability")),
            has_callback=bool(has_callback),
            ledger_state=self._text(ledger_record.get("state")),
            result_count=self._result_count(result_or_error) if success else 0,
            error_message="" if success else self._text(result_or_error),
        )
        delivery = FanxingTerminalDelivery(
            routed=routed,
            result_or_error=result_or_error,
        )
        stored_delivery, duplicate = self._record_result(
            delivery,
            missing_ledger=missing_ledger,
        )
        if duplicate:
            return stored_delivery.routed
        self._audit_routed_result(routed, missing_ledger=missing_ledger)
        return routed

    def publish_terminal_result(
        self,
        *,
        task_uuid: str,
        phase: str = "",
    ) -> bool:
        normalized_task_uuid = self._text(task_uuid)
        delivery: Optional[FanxingTerminalDelivery] = None
        with self._lock:
            delivery = self._deliveries_by_task.get(normalized_task_uuid)
            if delivery is None:
                self._publish_missing_total += 1
                logging.warning(
                    "[FanxingResultDispatcher] publish_missing task_uuid=%s phase=%s",
                    normalized_task_uuid or "-",
                    self._text(phase) or "-",
                )
                return False
            if normalized_task_uuid in self._published_task_uuids:
                self._duplicate_publish_total += 1
                return False
            self._published_task_uuids.add(normalized_task_uuid)
            self._published_terminal_total += 1
            self._last_published = self._result_summary(delivery.routed)
            if phase:
                self._last_published["publish_phase"] = self._text(phase)
        self._deliver_to_waiters(delivery)
        return True

    def register_waiter(
        self,
        *,
        task_uuid: str,
        source: str = "",
    ) -> FanxingResultWaitHandle:
        normalized_task_uuid = self._text(task_uuid)
        handle = FanxingResultWaitHandle(
            task_uuid=normalized_task_uuid,
            source=source,
        )
        existing_delivery: Optional[FanxingTerminalDelivery] = None
        with self._lock:
            self._waiter_registered_total += 1
            if normalized_task_uuid in self._published_task_uuids:
                existing_delivery = self._deliveries_by_task.get(normalized_task_uuid)
            if existing_delivery is None:
                self._waiters_by_task.setdefault(normalized_task_uuid, []).append(handle)
        if existing_delivery is not None and handle.deliver(existing_delivery):
            self._increment_waiter_delivered()
        return handle

    def unregister_waiter(self, handle: FanxingResultWaitHandle | None) -> None:
        if handle is None:
            return
        normalized_task_uuid = self._text(getattr(handle, "task_uuid", ""))
        with self._lock:
            waiters = self._waiters_by_task.get(normalized_task_uuid)
            if waiters:
                self._waiters_by_task[normalized_task_uuid] = [
                    item for item in waiters if item is not handle
                ]
                if not self._waiters_by_task[normalized_task_uuid]:
                    self._waiters_by_task.pop(normalized_task_uuid, None)
        handle.close()

    def get_defensive_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "terminal_total": int(self._terminal_total),
                "success_total": int(self._success_total),
                "failure_total": int(self._failure_total),
                "missing_ledger_total": int(self._missing_ledger_total),
                "missing_identity_total": int(self._missing_identity_total),
                "without_callback_total": int(self._without_callback_total),
                "duplicate_terminal_total": int(self._duplicate_terminal_total),
                "published_terminal_total": int(self._published_terminal_total),
                "duplicate_publish_total": int(self._duplicate_publish_total),
                "publish_missing_total": int(self._publish_missing_total),
                "waiter_registered_total": int(self._waiter_registered_total),
                "waiter_delivered_total": int(self._waiter_delivered_total),
                "active_waiter_count": sum(
                    len(waiters) for waiters in self._waiters_by_task.values()
                ),
                "tracked_task_count": len(self._results_by_task),
                "last_result": dict(self._last_result),
                "last_duplicate": dict(self._last_duplicate),
                "last_published": dict(self._last_published),
            }

    def _record_result(
        self,
        delivery: FanxingTerminalDelivery,
        *,
        missing_ledger: bool,
    ) -> tuple[FanxingTerminalDelivery, bool]:
        routed = delivery.routed
        summary = self._result_summary(routed)
        with self._lock:
            existing_delivery = self._deliveries_by_task.get(routed.task_uuid)
            if routed.task_uuid and existing_delivery is not None:
                self._duplicate_terminal_total += 1
                self._last_duplicate = summary
                logging.warning(
                    "[FanxingResultDispatcher] duplicate_terminal task_uuid=%s "
                    "success=%s first_success=%s task_type=%s",
                    routed.task_uuid or "-",
                    int(routed.success),
                    int(existing_delivery.routed.success),
                    routed.task_type or "-",
                )
                return existing_delivery, True

            self._terminal_total += 1
            if routed.success:
                self._success_total += 1
            else:
                self._failure_total += 1
            if missing_ledger:
                self._missing_ledger_total += 1
            if not routed.scheduler_task_id or not (
                routed.generation_id or routed.task_type.startswith("image_process_")
            ):
                self._missing_identity_total += 1
            if not routed.has_callback:
                self._without_callback_total += 1
            self._last_result = summary
            if routed.task_uuid:
                self._results_by_task[routed.task_uuid] = summary
                self._deliveries_by_task[routed.task_uuid] = delivery
                if len(self._results_by_task) > 2000:
                    # Keep recent visibility without becoming long-term storage.
                    oldest_keys = list(self._results_by_task.keys())[:500]
                    for key in oldest_keys:
                        self._results_by_task.pop(key, None)
                        self._deliveries_by_task.pop(key, None)
                        self._published_task_uuids.discard(key)
                        self._waiters_by_task.pop(key, None)
            return delivery, False

    def _deliver_to_waiters(self, delivery: FanxingTerminalDelivery) -> None:
        task_uuid = self._text(delivery.routed.task_uuid)
        with self._lock:
            waiters = list(self._waiters_by_task.pop(task_uuid, []))
        delivered = 0
        for waiter in waiters:
            if waiter.deliver(delivery):
                delivered += 1
        if delivered:
            with self._lock:
                self._waiter_delivered_total += delivered

    def _increment_waiter_delivered(self) -> None:
        with self._lock:
            self._waiter_delivered_total += 1

    def _audit_routed_result(
        self,
        routed: FanxingRoutedResult,
        *,
        missing_ledger: bool,
    ) -> None:
        if missing_ledger and not routed.has_callback:
            logging.warning(
                "[FanxingResultDispatcher] missing_ledger task_uuid=%s "
                "success=%s generation_id=%s scheduler_task_id=%s task_type=%s",
                routed.task_uuid or "-",
                int(routed.success),
                routed.generation_id or "-",
                routed.scheduler_task_id or "-",
                routed.task_type or "-",
            )
        if not routed.has_callback:
            logging.warning(
                "[FanxingResultDispatcher] terminal_without_callback task_uuid=%s "
                "success=%s generation_id=%s scheduler_task_id=%s task_type=%s",
                routed.task_uuid or "-",
                int(routed.success),
                routed.generation_id or "-",
                routed.scheduler_task_id or "-",
                routed.task_type or "-",
            )

    @classmethod
    def _result_count(cls, value: Any) -> int:
        if isinstance(value, dict):
            data = value.get("data")
            if isinstance(data, (list, tuple)):
                return len(list(data))
            if value.get("clean_image_url") or value.get("result_url"):
                return 1
            return len(value)
        if isinstance(value, (list, tuple, set)):
            return len(list(value))
        if cls._text(value):
            return 1
        return 0

    @staticmethod
    def _result_summary(routed: FanxingRoutedResult) -> Dict[str, Any]:
        return {
            "task_uuid": routed.task_uuid,
            "success": bool(routed.success),
            "generation_id": routed.generation_id,
            "scheduler_task_id": routed.scheduler_task_id,
            "task_index": routed.task_index,
            "task_type": routed.task_type,
            "capability": routed.capability,
            "has_callback": bool(routed.has_callback),
            "ledger_state": routed.ledger_state,
            "result_count": int(routed.result_count),
            "error_message": routed.error_message,
            "routed_at": float(routed.routed_at),
        }


_fanxing_result_dispatcher: Optional[FanxingResultDispatcher] = None
_fanxing_result_dispatcher_lock = threading.Lock()


def get_fanxing_result_dispatcher() -> FanxingResultDispatcher:
    global _fanxing_result_dispatcher
    if _fanxing_result_dispatcher is None:
        with _fanxing_result_dispatcher_lock:
            if _fanxing_result_dispatcher is None:
                _fanxing_result_dispatcher = FanxingResultDispatcher()
    return _fanxing_result_dispatcher
