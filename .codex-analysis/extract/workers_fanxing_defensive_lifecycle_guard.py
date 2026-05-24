# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from ..enhancement_config import get_enhancement_config

logger = logging.getLogger(__name__)


@dataclass
class IdentityCheckResult:
    ok: bool
    issues: List[str] = field(default_factory=list)


class FanxingLifecycleGuard:
    """Defensive runtime checks for Fanxing task lifecycle boundaries.

    This guard is intentionally observational in phase 1: it records violations,
    watermarks and health snapshots without changing business flow.
    """

    _instance: Optional["FanxingLifecycleGuard"] = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._lock = threading.RLock()
        self._identity_violation_count = 0
        self._identity_collision_count = 0
        self._orphan_poller_task_count = 0
        self._resource_violation_count = 0
        self._waiting_orphan_count = 0
        self._waiting_threads: Dict[str, Dict[str, Any]] = {}
        self._logged_keys: set[tuple[str, str]] = set()
        self._last_health_log_at: Dict[str, float] = {}

    def _config(self):
        return get_enhancement_config()

    def _is_enabled(self) -> bool:
        return bool(getattr(self._config(), "use_lifecycle_guard", True))

    def _is_strict(self) -> bool:
        return bool(getattr(self._config(), "lifecycle_guard_strict", False))

    @classmethod
    def get_instance(cls) -> "FanxingLifecycleGuard":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @staticmethod
    def _normalize_text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _parse_task_index(task_index: Any) -> int | None:
        try:
            return int(task_index)
        except Exception:
            return None

    def _log_once(
        self,
        *,
        category: str,
        key: str,
        level: int,
        message: str,
        args: tuple = (),
    ) -> None:
        normalized_key = self._normalize_text(key) or "-"
        log_key = (self._normalize_text(category), normalized_key)
        with self._lock:
            if len(self._logged_keys) > 2000:
                self._logged_keys.clear()
            if log_key in self._logged_keys:
                return
            self._logged_keys.add(log_key)
        logger.log(level, message, *tuple(args or ()))

    def validate_identity(
        self,
        *,
        phase: str,
        scheduler_task_id: str = "",
        generation_id: str = "",
        task_index: Any = None,
        provider_task_uuid: str = "",
        require_scheduler_task_id: bool = False,
        require_generation_id: bool = False,
        require_task_index: bool = False,
        require_provider_task_uuid: bool = False,
        task_type: str = "",
        lifecycle_type: str = "",
        render_mode: str = "",
    ) -> IdentityCheckResult:
        if not self._is_enabled():
            return IdentityCheckResult(ok=True, issues=[])

        issues: List[str] = []
        normalized_scheduler_task_id = self._normalize_text(scheduler_task_id)
        normalized_generation_id = self._normalize_text(generation_id)
        normalized_provider_task_uuid = self._normalize_text(provider_task_uuid)
        parsed_task_index = self._parse_task_index(task_index)

        if require_scheduler_task_id and not normalized_scheduler_task_id:
            issues.append("missing_scheduler_task_id")
        if require_generation_id and not normalized_generation_id:
            issues.append("missing_generation_id")
        if require_provider_task_uuid and not normalized_provider_task_uuid:
            issues.append("missing_provider_task_uuid")
        if require_task_index and (parsed_task_index is None or parsed_task_index < 0):
            issues.append("invalid_task_index")

        if issues:
            with self._lock:
                self._identity_violation_count += 1
            self._log_once(
                category="identity",
                key="|".join(
                    [
                        self._normalize_text(phase),
                        normalized_provider_task_uuid,
                        normalized_scheduler_task_id,
                        ",".join(issues),
                    ]
                ),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] identity_violation phase=%s issues=%s "
                    "scheduler_task_id=%s generation_id=%s task_index=%s "
                    "provider_task_uuid=%s task_type=%s lifecycle=%s render=%s"
                ),
                args=(
                    self._normalize_text(phase),
                    ",".join(issues),
                    normalized_scheduler_task_id or "-",
                    normalized_generation_id or "-",
                    str(task_index),
                    normalized_provider_task_uuid or "-",
                    self._normalize_text(task_type) or "-",
                    self._normalize_text(lifecycle_type) or "-",
                    self._normalize_text(render_mode) or "-",
                ),
            )
            if self._is_strict():
                raise RuntimeError(
                    "fanxing_identity_violation:" + ",".join(issues)
                )

        return IdentityCheckResult(ok=not issues, issues=issues)

    def register_waiting_thread(
        self,
        *,
        task_uuid: str,
        generation_id: str = "",
        task_index: Any = None,
        scheduler_task_id: str = "",
        timeout_sec: int = 0,
        capability: str = "",
    ) -> int:
        if not self._is_enabled():
            return self.get_waiting_thread_count()

        normalized_task_uuid = self._normalize_text(task_uuid)
        if not normalized_task_uuid:
            normalized_task_uuid = f"missing-task-uuid:{threading.get_ident()}"
        now = time.time()
        thread = threading.current_thread()
        with self._lock:
            self._waiting_threads[normalized_task_uuid] = {
                "task_uuid": normalized_task_uuid,
                "generation_id": self._normalize_text(generation_id),
                "task_index": task_index,
                "scheduler_task_id": self._normalize_text(scheduler_task_id),
                "timeout_sec": int(timeout_sec or 0),
                "capability": self._normalize_text(capability),
                "thread_name": thread.name,
                "thread_ident": thread.ident,
                "started_at": now,
            }
            count = len(self._waiting_threads)
        logger.info(
            "[FanxingDefensive] wait_thread_start task_uuid=%s generation_id=%s "
            "task_index=%s scheduler_task_id=%s thread=%s waiting=%s timeout=%ss",
            normalized_task_uuid,
            self._normalize_text(generation_id) or "-",
            str(task_index),
            self._normalize_text(scheduler_task_id) or "-",
            thread.name,
            count,
            int(timeout_sec or 0),
        )
        self.audit_waiting_threads(phase="wait_thread_start")
        return count

    def unregister_waiting_thread(self, *, task_uuid: str, reason: str = "") -> int:
        if not self._is_enabled():
            return self.get_waiting_thread_count()

        normalized_task_uuid = self._normalize_text(task_uuid)
        now = time.time()
        with self._lock:
            item = self._waiting_threads.pop(normalized_task_uuid, None)
            count = len(self._waiting_threads)
        if item:
            duration = now - float(item.get("started_at") or now)
            logger.info(
                "[FanxingDefensive] wait_thread_end task_uuid=%s generation_id=%s "
                "task_index=%s scheduler_task_id=%s thread=%s duration=%.2fs "
                "waiting=%s reason=%s",
                normalized_task_uuid,
                self._normalize_text(item.get("generation_id")) or "-",
                str(item.get("task_index")),
                self._normalize_text(item.get("scheduler_task_id")) or "-",
                self._normalize_text(item.get("thread_name")) or "-",
                duration,
                count,
                self._normalize_text(reason) or "-",
            )
        return count

    def audit_waiting_threads(self, *, phase: str = "") -> None:
        if not self._is_enabled():
            return
        config = self._config()
        threshold = max(
            1,
            int(
                getattr(
                    config,
                    "lifecycle_guard_waiting_thread_warning",
                    12,
                )
                or 12
            ),
        )
        snapshot = self.get_waiting_thread_snapshot()
        count = int(snapshot.get("count", 0) or 0)
        if count < threshold:
            self._audit_stale_waiting_threads(snapshot, phase=phase)
            return
        sample = []
        for item in list(snapshot.get("items") or [])[:5]:
            sample.append(
                f"{self._normalize_text(item.get('task_uuid'))[:8]}:"
                f"{self._normalize_text(item.get('generation_id')) or '-'}:"
                f"{float(item.get('age_sec') or 0.0):.0f}s"
            )
        self._log_once(
            category="waiting_thread_high_watermark",
            key=f"{threshold}:{count}",
            level=logging.WARNING,
            message=(
                "[FanxingDefensive] waiting_thread_high_watermark phase=%s "
                "count=%s threshold=%s sample=%s"
            ),
            args=(
                self._normalize_text(phase) or "-",
                count,
                threshold,
                ";".join(sample),
            ),
        )
        self._audit_stale_waiting_threads(snapshot, phase=phase)

    def _audit_stale_waiting_threads(
        self,
        snapshot: Dict[str, Any],
        *,
        phase: str = "",
    ) -> None:
        config = self._config()
        default_threshold = max(
            10.0,
            float(
                getattr(
                    config,
                    "lifecycle_guard_waiting_thread_age_warning",
                    300.0,
                )
                or 300.0
            ),
        )
        for item in list(snapshot.get("items") or []):
            age_sec = float(item.get("age_sec") or 0.0)
            timeout_sec = int(item.get("timeout_sec") or 0)
            if timeout_sec > 0:
                warn_after = min(default_threshold, max(10.0, timeout_sec * 0.8))
            else:
                warn_after = default_threshold
            if age_sec < warn_after:
                continue
            self._log_once(
                category="waiting_thread_stale",
                key=(
                    f"{self._normalize_text(item.get('task_uuid'))}:"
                    f"{int(warn_after)}"
                ),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] waiting_thread_stale phase=%s "
                    "task_uuid=%s generation_id=%s task_index=%s "
                    "scheduler_task_id=%s age=%.1fs warn_after=%.1fs timeout=%ss "
                    "thread=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    self._normalize_text(item.get("task_uuid")) or "-",
                    self._normalize_text(item.get("generation_id")) or "-",
                    str(item.get("task_index")),
                    self._normalize_text(item.get("scheduler_task_id")) or "-",
                    age_sec,
                    warn_after,
                    timeout_sec,
                    self._normalize_text(item.get("thread_name")) or "-",
                ),
            )

    def get_waiting_thread_count(self) -> int:
        with self._lock:
            return len(self._waiting_threads)

    def get_waiting_thread_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            items = [dict(item) for item in self._waiting_threads.values()]
        now = time.time()
        for item in items:
            item["age_sec"] = max(0.0, now - float(item.get("started_at") or now))
        return {
            "count": len(items),
            "items": items[:20],
        }

    def audit_orphan_poller_task(
        self,
        *,
        task_uuid: str,
        generation_id: str = "",
        scheduler_task_id: str = "",
        task_type: str = "",
        reason: str = "",
    ) -> None:
        if not self._is_enabled():
            return

        normalized_task_uuid = self._normalize_text(task_uuid)
        if not normalized_task_uuid:
            return
        with self._lock:
            self._orphan_poller_task_count += 1
        self._log_once(
            category="orphan_poller_task",
            key=normalized_task_uuid,
            level=logging.WARNING,
            message=(
                "[FanxingDefensive] orphan_poller_task task_uuid=%s "
                "generation_id=%s scheduler_task_id=%s task_type=%s reason=%s"
            ),
            args=(
                normalized_task_uuid,
                self._normalize_text(generation_id) or "-",
                self._normalize_text(scheduler_task_id) or "-",
                self._normalize_text(task_type) or "-",
                self._normalize_text(reason) or "-",
            ),
        )

    def audit_scheduler_snapshot(
        self,
        snapshot: Dict[str, Any] | None,
        *,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return

        data = dict(snapshot or {})
        resources = dict(data.get("resources") or {})
        for resource_name, resource_state in resources.items():
            state = dict(resource_state or {})
            capacity = int(state.get("capacity", 0) or 0)
            active_count = int(state.get("active_count", 0) or 0)
            active_task_ids = list(state.get("active_task_ids") or [])
            if capacity >= 0 and active_count > capacity:
                with self._lock:
                    self._resource_violation_count += 1
                self._log_once(
                    category="resource_over_capacity",
                    key=f"{resource_name}:{active_count}:{capacity}",
                    level=logging.ERROR,
                    message=(
                        "[FanxingDefensive] resource_over_capacity phase=%s "
                        "resource=%s active=%s capacity=%s active_task_ids=%s"
                    ),
                    args=(
                        self._normalize_text(phase) or "-",
                        self._normalize_text(resource_name),
                        active_count,
                        capacity,
                        ",".join(str(item) for item in active_task_ids[:10]),
                    ),
                )
            if active_task_ids and len(active_task_ids) != active_count:
                self._log_once(
                    category="resource_count_mismatch",
                    key=f"{resource_name}:{len(active_task_ids)}:{active_count}",
                    level=logging.WARNING,
                    message=(
                        "[FanxingDefensive] resource_count_mismatch phase=%s "
                        "resource=%s listed_active=%s active_count=%s"
                    ),
                    args=(
                        self._normalize_text(phase) or "-",
                        self._normalize_text(resource_name),
                        len(active_task_ids),
                        active_count,
                    ),
                )

    def audit_scheduler_terminal_leases(
        self,
        *,
        scheduler_snapshot: Dict[str, Any] | None,
        task_lookup,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        resources = dict((scheduler_snapshot or {}).get("resources") or {})
        terminal_states = {"completed", "failed", "canceled"}
        for resource_name, resource_state in resources.items():
            state = dict(resource_state or {})
            for scheduler_task_id in list(state.get("active_task_ids") or []):
                task = {}
                try:
                    task = dict(task_lookup(str(scheduler_task_id or "").strip()) or {})
                except Exception:
                    task = {}
                task_state = self._normalize_text(task.get("state"))
                if task_state not in terminal_states:
                    continue
                self._log_once(
                    category="terminal_task_active_lease",
                    key=f"{resource_name}:{scheduler_task_id}:{task_state}",
                    level=logging.ERROR,
                    message=(
                        "[FanxingDefensive] terminal_task_active_lease phase=%s "
                        "resource=%s scheduler_task_id=%s state=%s "
                        "provider_task_uuid=%s generation_id=%s"
                    ),
                    args=(
                        self._normalize_text(phase) or "-",
                        self._normalize_text(resource_name),
                        self._normalize_text(scheduler_task_id),
                        task_state,
                        self._normalize_text(task.get("provider_task_uuid")) or "-",
                        self._normalize_text(task.get("generation_id")) or "-",
                    ),
                )

    def audit_poller_snapshot(
        self,
        poller_snapshot: Dict[str, Any] | None,
        *,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        config = self._config()
        snapshot = dict(poller_snapshot or {})
        callback_active_count = int(snapshot.get("callback_active_count", 0) or 0)
        callback_threshold = max(
            1,
            int(getattr(config, "lifecycle_guard_callback_warning", 20) or 20),
        )
        if callback_active_count >= callback_threshold:
            self._log_once(
                category="callback_high_watermark",
                key=f"{callback_threshold}:{callback_active_count}",
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] callback_high_watermark phase=%s "
                    "callbacks=%s threshold=%s active=%s detached=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    callback_active_count,
                    callback_threshold,
                    int(snapshot.get("active_count", 0) or 0),
                    int(snapshot.get("callbacks_detached_count", 0) or 0),
                ),
            )

        self._audit_active_poller_identity(snapshot, phase=phase)

        terminal_states = {"completed", "failed", "cancelled", "canceled", "timeout"}
        for task in list(snapshot.get("tasks") or []):
            item = dict(task or {})
            state = self._normalize_text(item.get("state")).lower()
            has_callback = bool(item.get("has_callback"))
            if state in terminal_states and has_callback:
                self._log_once(
                    category="terminal_task_active_callback",
                    key=f"{item.get('task_uuid')}:{state}",
                    level=logging.ERROR,
                    message=(
                        "[FanxingDefensive] terminal_task_active_callback phase=%s "
                        "task_uuid=%s state=%s generation_id=%s scheduler_task_id=%s"
                    ),
                    args=(
                        self._normalize_text(phase) or "-",
                        self._normalize_text(item.get("task_uuid")),
                        state,
                        self._normalize_text(item.get("generation_id")) or "-",
                        self._normalize_text(item.get("scheduler_task_id")) or "-",
                    ),
                )

    def _audit_active_poller_identity(
        self,
        snapshot: Dict[str, Any],
        *,
        phase: str = "",
    ) -> None:
        tasks = [dict(item or {}) for item in list(snapshot.get("tasks") or [])]
        task_uuid_counts: Dict[str, int] = {}
        scheduler_to_task: Dict[str, Dict[str, Any]] = {}
        generation_index_to_task: Dict[str, Dict[str, Any]] = {}

        for task in tasks:
            task_uuid = self._normalize_text(task.get("task_uuid"))
            scheduler_task_id = self._normalize_text(task.get("scheduler_task_id"))
            generation_id = self._normalize_text(task.get("generation_id"))
            task_type = self._normalize_text(task.get("task_type"))
            task_index = task.get("task_index")
            strict_identity = bool(task.get("defensive_strict_identity"))

            if task_uuid:
                task_uuid_counts[task_uuid] = task_uuid_counts.get(task_uuid, 0) + 1

            if strict_identity:
                self.validate_identity(
                    phase=f"{self._normalize_text(phase) or 'poller'}_active_identity",
                    scheduler_task_id=scheduler_task_id,
                    generation_id=generation_id,
                    task_index=task_index,
                    provider_task_uuid=task_uuid,
                    require_scheduler_task_id=True,
                    require_generation_id=True,
                    require_task_index=True,
                    require_provider_task_uuid=True,
                    task_type=task_type,
                )

            if scheduler_task_id:
                existing = scheduler_to_task.get(scheduler_task_id)
                if (
                    existing
                    and self._normalize_text(existing.get("task_uuid")) != task_uuid
                ):
                    with self._lock:
                        self._identity_collision_count += 1
                    self._log_once(
                        category="duplicate_active_scheduler_task",
                        key=f"{scheduler_task_id}:{task_uuid}",
                        level=logging.ERROR,
                        message=(
                            "[FanxingDefensive] duplicate_active_scheduler_task "
                            "phase=%s scheduler_task_id=%s first_task_uuid=%s "
                            "second_task_uuid=%s generation_id=%s"
                        ),
                        args=(
                            self._normalize_text(phase) or "-",
                            scheduler_task_id,
                            self._normalize_text(existing.get("task_uuid")) or "-",
                            task_uuid or "-",
                            generation_id or "-",
                        ),
                    )
                else:
                    scheduler_to_task[scheduler_task_id] = task

            parsed_index = self._parse_task_index(task_index)
            if generation_id and parsed_index is not None and parsed_index >= 0:
                generation_index_key = f"{task_type}:{generation_id}:{parsed_index}"
                existing = generation_index_to_task.get(generation_index_key)
                if (
                    existing
                    and self._normalize_text(existing.get("task_uuid")) != task_uuid
                ):
                    with self._lock:
                        self._identity_collision_count += 1
                    self._log_once(
                        category="duplicate_active_generation_index",
                        key=f"{generation_index_key}:{task_uuid}",
                        level=logging.ERROR,
                        message=(
                            "[FanxingDefensive] duplicate_active_generation_index "
                            "phase=%s task_type=%s generation_id=%s task_index=%s "
                            "first_task_uuid=%s second_task_uuid=%s"
                        ),
                        args=(
                            self._normalize_text(phase) or "-",
                            task_type or "-",
                            generation_id,
                            parsed_index,
                            self._normalize_text(existing.get("task_uuid")) or "-",
                            task_uuid or "-",
                        ),
                    )
                else:
                    generation_index_to_task[generation_index_key] = task

        for task_uuid, count in task_uuid_counts.items():
            if count <= 1:
                continue
            with self._lock:
                self._identity_collision_count += 1
            self._log_once(
                category="duplicate_active_provider_task",
                key=f"{task_uuid}:{count}",
                level=logging.ERROR,
                message=(
                    "[FanxingDefensive] duplicate_active_provider_task "
                    "phase=%s task_uuid=%s count=%s"
                ),
                args=(self._normalize_text(phase) or "-", task_uuid, count),
            )

    def audit_waiting_poller_consistency(
        self,
        *,
        poller_snapshot: Dict[str, Any] | None,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        config = self._config()
        grace_seconds = max(
            1.0,
            float(
                getattr(
                    config,
                    "lifecycle_guard_waiting_orphan_grace_seconds",
                    10.0,
                )
                or 10.0
            ),
        )
        active_task_uuids = {
            self._normalize_text(task_uuid)
            for task_uuid in list((poller_snapshot or {}).get("all_task_uuids") or [])
            if self._normalize_text(task_uuid)
        }
        waiting_snapshot = self.get_waiting_thread_snapshot()
        for item in list(waiting_snapshot.get("items") or []):
            task_uuid = self._normalize_text(item.get("task_uuid"))
            if not task_uuid or task_uuid.startswith("missing-task-uuid:"):
                continue
            if task_uuid in active_task_uuids:
                continue
            age_sec = float(item.get("age_sec") or 0.0)
            if age_sec < grace_seconds:
                continue
            with self._lock:
                self._waiting_orphan_count += 1
            self._log_once(
                category="waiting_thread_missing_poller",
                key=task_uuid,
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] waiting_thread_missing_poller phase=%s "
                    "task_uuid=%s generation_id=%s task_index=%s "
                    "scheduler_task_id=%s age=%.1fs active_poller=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    task_uuid,
                    self._normalize_text(item.get("generation_id")) or "-",
                    str(item.get("task_index")),
                    self._normalize_text(item.get("scheduler_task_id")) or "-",
                    age_sec,
                    len(active_task_uuids),
                ),
            )

    def audit_ledger_poller_consistency(
        self,
        *,
        active_ledger_records: List[Dict[str, Any]] | None,
        poller_snapshot: Dict[str, Any] | None,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        records = [dict(item or {}) for item in list(active_ledger_records or [])]
        poller_task_ids = {
            self._normalize_text(task_uuid)
            for task_uuid in list((poller_snapshot or {}).get("active_task_uuids") or [])
            if self._normalize_text(task_uuid)
        }
        ledger_task_ids = {
            self._normalize_text(record.get("provider_task_uuid"))
            for record in records
            if self._normalize_text(record.get("provider_task_uuid"))
            and self._normalize_text(record.get("state")) in {"submitted", "polling"}
        }

        for missing_in_ledger in sorted(poller_task_ids - ledger_task_ids)[:20]:
            self.audit_orphan_poller_task(
                task_uuid=missing_in_ledger,
                reason=f"poller_active_missing_ledger:{self._normalize_text(phase) or '-'}",
            )

        if not poller_task_ids:
            return

        for missing_in_poller in sorted(ledger_task_ids - poller_task_ids)[:20]:
            record = next(
                (
                    item
                    for item in records
                    if self._normalize_text(item.get("provider_task_uuid"))
                    == missing_in_poller
                ),
                {},
            )
            self._log_once(
                category="ledger_active_missing_poller",
                key=missing_in_poller,
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] ledger_active_missing_poller phase=%s "
                    "task_uuid=%s generation_id=%s scheduler_task_id=%s state=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    missing_in_poller,
                    self._normalize_text(record.get("generation_id")) or "-",
                    self._normalize_text(record.get("scheduler_task_id")) or "-",
                    self._normalize_text(record.get("state")) or "-",
                ),
            )

    def audit_dispatcher_snapshot(
        self,
        dispatcher_snapshot: Dict[str, Any] | None,
        *,
        poller_snapshot: Dict[str, Any] | None = None,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        dispatcher_data = dict(dispatcher_snapshot or {})
        poller_data = dict(poller_snapshot or {})
        submitted_total = int(dispatcher_data.get("remote_submitted_total", 0) or 0)
        registered_total = int(dispatcher_data.get("poller_registered_total", 0) or 0)
        identity_warnings = int(dispatcher_data.get("identity_warning_total", 0) or 0)
        delta = int(dispatcher_data.get("submit_register_delta", 0) or 0)
        poller_active = int(poller_data.get("active_count", 0) or 0)

        if delta != 0:
            self._log_once(
                category="dispatcher_submit_register_delta",
                key=f"{submitted_total}:{registered_total}:{delta}",
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] dispatcher_submit_register_delta "
                    "phase=%s submitted_total=%s poller_registered_total=%s "
                    "delta=%s poller_active=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    submitted_total,
                    registered_total,
                    delta,
                    poller_active,
                ),
            )

        if identity_warnings > 0:
            self._log_once(
                category="dispatcher_identity_warnings",
                key=str(identity_warnings),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] dispatcher_identity_warnings "
                    "phase=%s identity_warnings=%s last_submitted=%s "
                    "last_registered=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    identity_warnings,
                    dict(dispatcher_data.get("last_remote_submitted") or {}),
                    dict(dispatcher_data.get("last_poller_registered") or {}),
                ),
            )

    def audit_result_dispatcher_snapshot(
        self,
        result_dispatcher_snapshot: Dict[str, Any] | None,
        *,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        data = dict(result_dispatcher_snapshot or {})
        without_callback = int(data.get("without_callback_total", 0) or 0)
        missing_ledger = int(data.get("missing_ledger_total", 0) or 0)
        missing_identity = int(data.get("missing_identity_total", 0) or 0)
        duplicate_terminal = int(data.get("duplicate_terminal_total", 0) or 0)
        publish_missing = int(data.get("publish_missing_total", 0) or 0)
        active_waiters = int(data.get("active_waiter_count", 0) or 0)
        with self._lock:
            waiting_count = len(self._waiting_threads)

        if without_callback > 0:
            self._log_once(
                category="result_terminal_without_callback",
                key=str(without_callback),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_terminal_without_callback "
                    "phase=%s count=%s last_result=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    without_callback,
                    dict(data.get("last_result") or {}),
                ),
            )
        if without_callback > 0 and (missing_ledger > 0 or missing_identity > 0):
            self._log_once(
                category="result_dispatcher_incomplete_route",
                key=f"{missing_ledger}:{missing_identity}",
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_dispatcher_incomplete_route "
                    "phase=%s missing_ledger=%s missing_identity=%s last_result=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    missing_ledger,
                    missing_identity,
                    dict(data.get("last_result") or {}),
                ),
            )
        if duplicate_terminal > 0:
            self._log_once(
                category="result_dispatcher_duplicate_terminal",
                key=str(duplicate_terminal),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_dispatcher_duplicate_terminal "
                    "phase=%s duplicate_terminal=%s last_duplicate=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    duplicate_terminal,
                    dict(data.get("last_duplicate") or {}),
                ),
            )
        if active_waiters > waiting_count:
            self._log_once(
                category="result_waiter_leak_or_high_watermark",
                key=f"{active_waiters}:{waiting_count}",
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_waiter_leak_or_high_watermark "
                    "phase=%s active_waiters=%s waiting_threads=%s "
                    "registered=%s delivered=%s last_result=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    active_waiters,
                    waiting_count,
                    int(data.get("waiter_registered_total", 0) or 0),
                    int(data.get("waiter_delivered_total", 0) or 0),
                    dict(data.get("last_result") or {}),
                ),
            )
        if publish_missing > 0:
            self._log_once(
                category="result_publish_missing",
                key=str(publish_missing),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_publish_missing "
                    "phase=%s publish_missing=%s last_published=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    publish_missing,
                    dict(data.get("last_published") or {}),
                ),
            )

    def audit_result_delivery_bridge_snapshot(
        self,
        result_delivery_bridge_snapshot: Dict[str, Any] | None,
        *,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        data = dict(result_delivery_bridge_snapshot or {})
        missing_identity = int(data.get("missing_identity_total", 0) or 0)
        missing_payload = int(data.get("missing_payload_total", 0) or 0)
        unsupported_mode = int(data.get("unsupported_mode_total", 0) or 0)
        duplicate_delivery = int(data.get("duplicate_delivery_total", 0) or 0)
        adapter_fallback = int(data.get("adapter_fallback_total", 0) or 0)

        if missing_identity > 0:
            self._log_once(
                category="result_delivery_missing_identity",
                key=str(missing_identity),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_delivery_missing_identity "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    missing_identity,
                    dict(data.get("last_missing_identity") or {}),
                ),
            )
        if missing_payload > 0:
            self._log_once(
                category="result_delivery_missing_payload",
                key=str(missing_payload),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_delivery_missing_payload "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    missing_payload,
                    dict(data.get("last_missing_payload") or {}),
                ),
            )
        if unsupported_mode > 0:
            self._log_once(
                category="result_delivery_unsupported_mode",
                key=str(unsupported_mode),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_delivery_unsupported_mode "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    unsupported_mode,
                    dict(data.get("last_delivery") or {}),
                ),
            )
        if duplicate_delivery > 0:
            self._log_once(
                category="result_delivery_duplicate",
                key=str(duplicate_delivery),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_delivery_duplicate "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    duplicate_delivery,
                    dict(data.get("last_duplicate") or {}),
                ),
            )
        if adapter_fallback > 0:
            self._log_once(
                category="result_delivery_adapter_fallback",
                key=str(adapter_fallback),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_delivery_adapter_fallback "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    adapter_fallback,
                    dict(data.get("last_adapter_blocked") or {}),
                ),
            )

    def audit_result_finish_bridge_snapshot(
        self,
        result_finish_bridge_snapshot: Dict[str, Any] | None,
        *,
        phase: str = "",
    ) -> None:
        if not self._is_enabled():
            return
        data = dict(result_finish_bridge_snapshot or {})
        missing_identity = int(data.get("missing_identity_total", 0) or 0)
        duplicate_ok = int(data.get("duplicate_ok_total", 0) or 0)
        duplicate_err = int(data.get("duplicate_err_total", 0) or 0)
        conflicting_terminal = int(data.get("conflicting_terminal_total", 0) or 0)
        error_after_delivery = int(data.get("error_after_delivery_total", 0) or 0)
        missing_after_delivery = int(
            data.get("missing_after_delivery_total", 0) or 0
        )

        if missing_identity > 0:
            self._log_once(
                category="result_finish_missing_identity",
                key=str(missing_identity),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] result_finish_missing_identity "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    missing_identity,
                    dict(data.get("last_missing_identity") or {}),
                ),
            )
        if duplicate_ok > 0:
            self._log_once(
                category="finish_duplicate_ok",
                key=str(duplicate_ok),
                level=logging.WARNING,
                message="[FanxingDefensive] finish_duplicate_ok phase=%s count=%s last=%s",
                args=(
                    self._normalize_text(phase) or "-",
                    duplicate_ok,
                    dict(data.get("last_duplicate_ok") or {}),
                ),
            )
        if duplicate_err > 0:
            self._log_once(
                category="finish_duplicate_err",
                key=str(duplicate_err),
                level=logging.WARNING,
                message="[FanxingDefensive] finish_duplicate_err phase=%s count=%s last=%s",
                args=(
                    self._normalize_text(phase) or "-",
                    duplicate_err,
                    dict(data.get("last_duplicate_err") or {}),
                ),
            )
        if conflicting_terminal > 0:
            self._log_once(
                category="finish_conflicting_terminal",
                key=str(conflicting_terminal),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] finish_conflicting_terminal "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    conflicting_terminal,
                    dict(data.get("last_conflict") or {}),
                ),
            )
        if error_after_delivery > 0:
            self._log_once(
                category="finish_error_after_delivery",
                key=str(error_after_delivery),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] finish_error_after_delivery "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    error_after_delivery,
                    dict(data.get("last_error_after_delivery") or {}),
                ),
            )
        if missing_after_delivery > 0:
            self._log_once(
                category="finish_missing_after_delivery",
                key=str(missing_after_delivery),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] finish_missing_after_delivery "
                    "phase=%s count=%s last=%s"
                ),
                args=(
                    self._normalize_text(phase) or "-",
                    missing_after_delivery,
                    dict(data.get("last_missing_after_delivery") or {}),
                ),
            )

    def log_health_snapshot(
        self,
        *,
        reason: str,
        scheduler_snapshot: Dict[str, Any] | None = None,
        poller_snapshot: Dict[str, Any] | None = None,
        dispatcher_snapshot: Dict[str, Any] | None = None,
        result_dispatcher_snapshot: Dict[str, Any] | None = None,
        result_delivery_bridge_snapshot: Dict[str, Any] | None = None,
        result_finish_bridge_snapshot: Dict[str, Any] | None = None,
        min_interval_sec: float = 30.0,
    ) -> None:
        if not self._is_enabled():
            return
        normalized_reason = self._normalize_text(reason) or "periodic"
        now = time.time()
        config = self._config()
        interval = max(
            1.0,
            float(
                min_interval_sec
                if min_interval_sec is not None
                else getattr(config, "lifecycle_guard_health_interval", 30.0)
            ),
        )
        with self._lock:
            last_logged = float(self._last_health_log_at.get(normalized_reason, 0.0))
            if now - last_logged < interval:
                return
            self._last_health_log_at[normalized_reason] = now
            waiting_count = len(self._waiting_threads)
            identity_violations = self._identity_violation_count
            identity_collisions = self._identity_collision_count
            orphan_count = self._orphan_poller_task_count
            resource_violations = self._resource_violation_count
            waiting_orphans = self._waiting_orphan_count

        scheduler_queue = dict((scheduler_snapshot or {}).get("queue") or {})
        scheduler_unfinished = dict((scheduler_snapshot or {}).get("unfinished") or {})
        poller_data = dict(poller_snapshot or {})
        dispatcher_data = dict(dispatcher_snapshot or {})
        result_data = dict(result_dispatcher_snapshot or {})
        delivery_data = dict(result_delivery_bridge_snapshot or {})
        finish_data = dict(result_finish_bridge_snapshot or {})
        release_status = {}
        release_status_provider = getattr(config, "worker_wait_release_status", None)
        if callable(release_status_provider):
            try:
                release_status = dict(release_status_provider() or {})
            except Exception:
                release_status = {}
        if release_status.get("requested") and not release_status.get("armed"):
            self._log_once(
                category="worker_wait_release_blocked",
                key=str(release_status.get("blocked_reason") or "not_armed"),
                level=logging.WARNING,
                message=(
                    "[FanxingDefensive] worker_wait_release_blocked "
                    "phase=%s reason=%s detached_wait=%s bridge_ready=%s"
                ),
                args=(
                    normalized_reason,
                    str(release_status.get("blocked_reason") or "not_armed"),
                    int(bool(release_status.get("detached_wait"))),
                    int(bool(release_status.get("bridge_ready"))),
                ),
            )
        logger.info(
            "[FanxingDefensive] health_snapshot reason=%s waiting_threads=%s "
            "identity_violations=%s identity_collisions=%s "
            "orphan_poller_tasks=%s waiting_orphans=%s resource_violations=%s "
            "scheduler_queue=%s scheduler_unfinished=%s poller_active=%s "
            "poller_callbacks=%s poller_detached=%s dispatcher_submitted=%s "
            "dispatcher_registered=%s dispatcher_delta=%s dispatcher_identity_warnings=%s "
            "result_terminal=%s result_success=%s result_failure=%s "
            "result_without_callback=%s result_duplicate=%s result_published=%s "
            "result_publish_missing=%s result_waiters=%s result_waiter_delivered=%s "
            "delivery_observed=%s delivery_success=%s delivery_failure=%s "
            "delivery_missing_identity=%s delivery_missing_payload=%s "
            "delivery_unsupported_mode=%s delivery_duplicate=%s "
            "delivery_adapter_attempt=%s delivery_adapter_delivered=%s "
            "delivery_adapter_blocked=%s delivery_adapter_fallback=%s "
            "finish_observed=%s finish_ok=%s finish_err=%s "
            "finish_cancel=%s finish_timeout=%s finish_missing_identity=%s "
            "finish_duplicate_ok=%s finish_duplicate_err=%s "
            "finish_conflicting_terminal=%s finish_error_after_delivery=%s "
            "finish_missing_after_delivery=%s "
            "worker_wait_release_requested=%s worker_wait_release_armed=%s",
            normalized_reason,
            waiting_count,
            identity_violations,
            identity_collisions,
            orphan_count,
            waiting_orphans,
            resource_violations,
            int(scheduler_queue.get("count", 0) or 0),
            int(scheduler_unfinished.get("count", 0) or 0),
            int(poller_data.get("active_count", 0) or 0),
            int(poller_data.get("callback_active_count", 0) or 0),
            int(poller_data.get("callbacks_detached_count", 0) or 0),
            int(dispatcher_data.get("remote_submitted_total", 0) or 0),
            int(dispatcher_data.get("poller_registered_total", 0) or 0),
            int(dispatcher_data.get("submit_register_delta", 0) or 0),
            int(dispatcher_data.get("identity_warning_total", 0) or 0),
            int(result_data.get("terminal_total", 0) or 0),
            int(result_data.get("success_total", 0) or 0),
            int(result_data.get("failure_total", 0) or 0),
            int(result_data.get("without_callback_total", 0) or 0),
            int(result_data.get("duplicate_terminal_total", 0) or 0),
            int(result_data.get("published_terminal_total", 0) or 0),
            int(result_data.get("publish_missing_total", 0) or 0),
            int(result_data.get("active_waiter_count", 0) or 0),
            int(result_data.get("waiter_delivered_total", 0) or 0),
            int(delivery_data.get("observed_total", 0) or 0),
            int(delivery_data.get("success_total", 0) or 0),
            int(delivery_data.get("failure_total", 0) or 0),
            int(delivery_data.get("missing_identity_total", 0) or 0),
            int(delivery_data.get("missing_payload_total", 0) or 0),
            int(delivery_data.get("unsupported_mode_total", 0) or 0),
            int(delivery_data.get("duplicate_delivery_total", 0) or 0),
            int(delivery_data.get("adapter_attempt_total", 0) or 0),
            int(delivery_data.get("adapter_delivered_total", 0) or 0),
            int(delivery_data.get("adapter_blocked_total", 0) or 0),
            int(delivery_data.get("adapter_fallback_total", 0) or 0),
            int(finish_data.get("observed_total", 0) or 0),
            int(finish_data.get("ok_total", 0) or 0),
            int(finish_data.get("err_total", 0) or 0),
            int(finish_data.get("cancel_total", 0) or 0),
            int(finish_data.get("timeout_total", 0) or 0),
            int(finish_data.get("missing_identity_total", 0) or 0),
            int(finish_data.get("duplicate_ok_total", 0) or 0),
            int(finish_data.get("duplicate_err_total", 0) or 0),
            int(finish_data.get("conflicting_terminal_total", 0) or 0),
            int(finish_data.get("error_after_delivery_total", 0) or 0),
            int(finish_data.get("missing_after_delivery_total", 0) or 0),
            int(bool(release_status.get("requested"))),
            int(bool(release_status.get("armed"))),
        )


_lifecycle_guard: Optional[FanxingLifecycleGuard] = None
_lifecycle_guard_lock = threading.Lock()


def get_lifecycle_guard() -> FanxingLifecycleGuard:
    global _lifecycle_guard
    if _lifecycle_guard is None:
        with _lifecycle_guard_lock:
            if _lifecycle_guard is None:
                _lifecycle_guard = FanxingLifecycleGuard.get_instance()
    return _lifecycle_guard
