# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from data.generation_config import SERVER_ID_FANXING
from managers.auth import ActiveAuthContextResolver, BillingIdentityResolver
from managers.config_manager import get_active_config_manager
from managers.task_ledger import get_task_ledger_store
from managers.task_scheduler import get_global_image_task_scheduler
from workers.fanxing.enhancement_config import get_enhancement_config


@dataclass(frozen=True)
class FanxingSubmittedTask:
    task_uuid: str
    base_url: str
    headers: Dict[str, Any]
    task_index: int
    capability: str = "image_generation"
    scheduler_task_id: str = ""
    task_type: str = ""
    generation_id: str = ""
    dispatch_batch_id: str = ""
    tile_id: str = ""
    placeholder_id: str = ""
    lifecycle_type: str = ""
    render_mode: str = ""
    source: str = ""
    feature_key: str = ""
    function_name: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)


class FanxingTaskDispatcher:
    """Phase 2 boundary for submitted Fanxing remote tasks.

    The first integration keeps the existing worker wait path intact. This
    dispatcher owns the local "remote task submitted" record and exposes a
    poller registration seam that later detached-result routing can reuse.
    """

    def __init__(
        self,
        *,
        ledger_store_factory: Callable[[], Any] = get_task_ledger_store,
        scheduler_factory: Callable[[], Any] = get_global_image_task_scheduler,
        config_manager_factory: Callable[[], Any] = get_active_config_manager,
    ):
        self._ledger_store_factory = ledger_store_factory
        self._scheduler_factory = scheduler_factory
        self._config_manager_factory = config_manager_factory
        self._metrics_lock = threading.RLock()
        self._remote_submitted_total = 0
        self._poller_registered_total = 0
        self._identity_warning_total = 0
        self._last_remote_submitted = {}
        self._last_poller_registered = {}
        self._identity_warning_keys = set()

    @staticmethod
    def _text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return int(default)

    def resolve_submission(
        self,
        *,
        worker_context: Any,
        request_payload: Dict[str, Any],
        task_uuid: str,
        base_url: str,
        headers: Dict[str, Any],
        task_index: int,
        capability: str = "image_generation",
    ) -> FanxingSubmittedTask:
        payload = dict(request_payload or {})
        generation_id = self._text(getattr(worker_context, "generation_id", ""))
        lifecycle_type = self._text(payload.get("lifecycle_type")).lower()
        render_mode = self._text(payload.get("render_mode")).lower()
        source = self._text(payload.get("source")).lower()
        task_index_int = self._int(task_index, 0)

        scheduler_task_id = self._text(payload.get("scheduler_task_id"))
        scheduler_task_map = getattr(worker_context, "scheduler_task_id_map", {}) or {}

        dispatch_batch_id = ""
        tile_id = ""
        task_type = "canvas_generation"
        if (
            lifecycle_type == "interactive_image_generation" and render_mode == "canvas"
        ) or (generation_id and generation_id.startswith("gen_")):
            scheduler_task_id = scheduler_task_id or self._text(
                scheduler_task_map.get(task_index_int)
            )
            task_type = "canvas_generation"
        elif (
            lifecycle_type == "interactive_image_generation" and render_mode == "grid"
        ) or (generation_id and generation_id.startswith("grid_")):
            scheduler_task_id = scheduler_task_id or self._text(
                scheduler_task_map.get(task_index_int)
            )
            task_type = "grid_generation"
        elif (
            lifecycle_type == "interactive_image_generation" and render_mode == "batch"
        ) or source == "batch_generation":
            dispatch_batch_id = (
                self._text(payload.get("dispatch_batch_id")) or generation_id
            )
            tile_id = self._text(payload.get("batch_task_id"))
            task_type = "batch_generation"
        else:
            dispatch_batch_id = (
                self._text(payload.get("dispatch_batch_id")) or generation_id
            )
            tile_id = self._text(payload.get("tile_id"))
            task_type = "ecom_single_tile_generation"

        placeholder_map = getattr(worker_context, "placeholder_id_map", {}) or {}
        placeholder_id = (
            self._text(placeholder_map.get(task_index_int))
            or self._text(payload.get("placeholder_id"))
        )
        return FanxingSubmittedTask(
            task_uuid=self._text(task_uuid),
            base_url=self._text(base_url),
            headers=dict(headers or {}),
            task_index=task_index_int,
            capability=self._text(capability) or "image_generation",
            scheduler_task_id=scheduler_task_id,
            task_type=task_type,
            generation_id=generation_id,
            dispatch_batch_id=dispatch_batch_id,
            tile_id=tile_id,
            placeholder_id=placeholder_id,
            lifecycle_type=lifecycle_type,
            render_mode=render_mode,
            source=self._text(payload.get("source")),
            feature_key=self._text(payload.get("feature_key")),
            function_name=self._text(payload.get("function_name")),
            meta={
                "api_mode": self._text(getattr(worker_context, "api_mode", "")),
                "model_type": self._text(getattr(worker_context, "model_type", "")),
                "source": self._text(payload.get("source")),
                "feature_key": self._text(payload.get("feature_key")),
                "function_name": self._text(payload.get("function_name")),
                "lifecycle_type": lifecycle_type,
                "render_mode": render_mode,
            },
        )

    def record_remote_submitted(
        self,
        *,
        worker_context: Any,
        request_payload: Dict[str, Any],
        task_uuid: str,
        base_url: str,
        headers: Dict[str, Any],
        task_index: int,
        capability: str = "image_generation",
        api_key: str = "",
    ) -> FanxingSubmittedTask:
        submission = self.resolve_submission(
            worker_context=worker_context,
            request_payload=request_payload,
            task_uuid=task_uuid,
            base_url=base_url,
            headers=headers,
            task_index=task_index,
            capability=capability,
        )
        self._audit_submission_identity(submission, phase="remote_submitted")
        self._record_remote_submitted(submission)
        config_manager = self._config_manager_factory()
        active_auth_context = ActiveAuthContextResolver(config_manager).resolve(
            server_id=SERVER_ID_FANXING,
            base_url=submission.base_url,
            bearer_token=self._text(api_key)
            or self._extract_bearer_token(submission.headers),
            visible_only=False,
        )
        billing_identity = BillingIdentityResolver(config_manager).resolve(
            active_auth_context=active_auth_context
        )
        meta = dict(submission.meta)
        meta.update(
            {
                "auth_mode": active_auth_context.normalized_auth_mode,
                "tenant_id": active_auth_context.normalized_tenant_id,
                "billing_owner_type": billing_identity.billing_owner_type,
                "billing_owner_id": billing_identity.billing_owner_id,
                "billing_owner_name": billing_identity.billing_owner_name,
            }
        )
        self._ledger_store_factory().upsert_submitted_task(
            scheduler_task_id=submission.scheduler_task_id,
            task_type=submission.task_type,
            generation_id=submission.generation_id,
            dispatch_batch_id=submission.dispatch_batch_id,
            tile_id=submission.tile_id,
            task_index=submission.task_index,
            provider="fanxing",
            provider_task_uuid=submission.task_uuid,
            base_url=submission.base_url,
            placeholder_id=submission.placeholder_id,
            headers=submission.headers,
            meta=meta,
        )
        if submission.scheduler_task_id:
            self._scheduler_factory().bind_provider_task(
                submission.scheduler_task_id,
                submission.task_uuid,
            )
        enhancement_config = get_enhancement_config()
        if bool(getattr(enhancement_config, "task_dispatcher_shadow_log", True)):
            snapshot = self.get_defensive_snapshot()
            logging.info(
                "[FanxingDispatcher] remote_submitted task_uuid=%s generation_id=%s "
                "task_index=%s scheduler_task_id=%s task_type=%s detached_wait=%s "
                "submitted_total=%s poller_registered_total=%s delta=%s",
                submission.task_uuid,
                submission.generation_id or "-",
                submission.task_index,
                submission.scheduler_task_id or "-",
                submission.task_type or "-",
                int(bool(getattr(enhancement_config, "dispatcher_detached_wait", False))),
                snapshot["remote_submitted_total"],
                snapshot["poller_registered_total"],
                snapshot["submit_register_delta"],
            )
        return submission

    def register_poller_task(
        self,
        *,
        poller: Any,
        submission: FanxingSubmittedTask,
        callback,
        timeout: int,
        progress_callback=None,
        status_callback=None,
        network_error_callback=None,
        concurrency_acquired: bool = False,
        restored: bool = False,
    ) -> None:
        self._audit_submission_identity(submission, phase="poller_register")
        poller.register_task(
            task_uuid=submission.task_uuid,
            base_url=submission.base_url,
            headers=submission.headers,
            callback=callback,
            timeout=timeout,
            task_index=submission.task_index,
            progress_callback=progress_callback,
            status_callback=status_callback,
            network_error_callback=network_error_callback,
            capability=submission.capability,
            generation_id=submission.generation_id,
            concurrency_acquired=concurrency_acquired,
            restored=restored,
            task_type=submission.task_type,
            lifecycle_type=submission.lifecycle_type,
            scheduler_task_id=submission.scheduler_task_id,
        )
        self._record_poller_registered(submission)
        snapshot = self.get_defensive_snapshot()
        logging.info(
            "[FanxingDispatcher] poller_register task_uuid=%s generation_id=%s "
            "task_index=%s scheduler_task_id=%s task_type=%s submitted_total=%s "
            "poller_registered_total=%s delta=%s",
            submission.task_uuid,
            submission.generation_id or "-",
            submission.task_index,
            submission.scheduler_task_id or "-",
            submission.task_type or "-",
            snapshot["remote_submitted_total"],
            snapshot["poller_registered_total"],
            snapshot["submit_register_delta"],
        )

    def get_defensive_snapshot(self) -> Dict[str, Any]:
        with self._metrics_lock:
            submitted = int(self._remote_submitted_total)
            registered = int(self._poller_registered_total)
            warnings = int(self._identity_warning_total)
            last_submitted = dict(self._last_remote_submitted)
            last_registered = dict(self._last_poller_registered)
        return {
            "remote_submitted_total": submitted,
            "poller_registered_total": registered,
            "identity_warning_total": warnings,
            "submit_register_delta": submitted - registered,
            "last_remote_submitted": last_submitted,
            "last_poller_registered": last_registered,
        }

    def _record_remote_submitted(self, submission: FanxingSubmittedTask) -> None:
        with self._metrics_lock:
            self._remote_submitted_total += 1
            self._last_remote_submitted = self._submission_summary(submission)

    def _record_poller_registered(self, submission: FanxingSubmittedTask) -> None:
        with self._metrics_lock:
            self._poller_registered_total += 1
            self._last_poller_registered = self._submission_summary(submission)

    def _record_identity_warning(self) -> None:
        with self._metrics_lock:
            self._identity_warning_total += 1

    def _should_log_identity_warning(
        self,
        *,
        phase: str,
        submission: FanxingSubmittedTask,
        missing: list,
    ) -> bool:
        key = (
            self._text(phase) or "-",
            self._text(submission.task_type) or "-",
            self._text(submission.generation_id) or "-",
            self._text(submission.dispatch_batch_id) or "-",
            self._text(submission.scheduler_task_id) or "-",
            ",".join(list(missing or [])),
        )
        with self._metrics_lock:
            if len(self._identity_warning_keys) > 2000:
                self._identity_warning_keys.clear()
            if key in self._identity_warning_keys:
                return False
            self._identity_warning_keys.add(key)
        return True

    def _audit_submission_identity(
        self,
        submission: FanxingSubmittedTask,
        *,
        phase: str,
    ) -> None:
        missing = []
        task_type = self._text(submission.task_type)
        if not self._text(submission.task_uuid):
            missing.append("provider_task_uuid")
        if not task_type:
            missing.append("task_type")
        identity_task_types = {
            "canvas_generation",
            "grid_generation",
            "batch_generation",
            "ecom_single_tile_generation",
        }
        if task_type in identity_task_types:
            if not (
                self._text(submission.generation_id)
                or self._text(submission.dispatch_batch_id)
            ):
                missing.append("generation_id_or_dispatch_batch_id")
            if not self._text(submission.scheduler_task_id):
                missing.append("scheduler_task_id")
        if not missing:
            return
        self._record_identity_warning()
        if not self._should_log_identity_warning(
            phase=phase,
            submission=submission,
            missing=missing,
        ):
            return
        logging.warning(
            "[FanxingDispatcher] identity_incomplete phase=%s task_uuid=%s "
            "task_type=%s generation_id=%s dispatch_batch_id=%s task_index=%s "
            "scheduler_task_id=%s missing=%s",
            self._text(phase) or "-",
            submission.task_uuid or "-",
            task_type or "-",
            submission.generation_id or "-",
            submission.dispatch_batch_id or "-",
            submission.task_index,
            submission.scheduler_task_id or "-",
            ",".join(missing),
        )

    def _submission_summary(self, submission: FanxingSubmittedTask) -> Dict[str, Any]:
        return {
            "task_uuid": self._text(submission.task_uuid),
            "task_type": self._text(submission.task_type),
            "generation_id": self._text(submission.generation_id),
            "dispatch_batch_id": self._text(submission.dispatch_batch_id),
            "task_index": int(submission.task_index or 0),
            "scheduler_task_id": self._text(submission.scheduler_task_id),
            "capability": self._text(submission.capability),
        }

    @staticmethod
    def _extract_bearer_token(headers: Dict[str, Any]) -> str:
        auth = str((headers or {}).get("Authorization") or "").strip()
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return ""


_fanxing_task_dispatcher: Optional[FanxingTaskDispatcher] = None
_fanxing_task_dispatcher_lock = threading.Lock()


def get_fanxing_task_dispatcher() -> FanxingTaskDispatcher:
    global _fanxing_task_dispatcher
    if _fanxing_task_dispatcher is None:
        with _fanxing_task_dispatcher_lock:
            if _fanxing_task_dispatcher is None:
                _fanxing_task_dispatcher = FanxingTaskDispatcher()
    return _fanxing_task_dispatcher
