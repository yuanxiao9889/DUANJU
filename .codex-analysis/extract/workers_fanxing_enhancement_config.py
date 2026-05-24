# -*- coding: utf-8 -*-

from __future__ import annotations

import logging
from dataclasses import dataclass


logger = logging.getLogger(__name__)


@dataclass
class FanxingEnhancementConfig:
    use_event_bus: bool = False
    event_bus_history_size: int = 1000
    use_concurrency_control: bool = False
    max_concurrent_tasks: int = 16
    callback_timeout_seconds: float = 5.0
    network_error_notify_interval: float = 5.0
    batch_query_connect_timeout_seconds: float = 3.0
    batch_query_read_timeout_seconds: float = 15.0
    use_task_monitor: bool = False
    monitor_interval: float = 10.0
    stuck_task_threshold: float = 300.0
    memory_warning_threshold_mb: int = 200
    memory_spike_ratio: float = 1.5
    use_state_validation: bool = False
    state_validation_strict: bool = False
    task_dispatcher_shadow_log: bool = True
    dispatcher_detached_wait: bool = False
    dispatcher_release_worker_wait: bool = False
    result_delivery_bridge_shadow_log: bool = True
    result_delivery_adapter_takeover: bool = False
    result_finish_bridge_shadow_log: bool = True
    result_finish_missing_after_delivery_grace_seconds: float = 30.0
    use_lifecycle_guard: bool = True
    lifecycle_guard_health_interval: float = 30.0
    lifecycle_guard_waiting_thread_warning: int = 12
    lifecycle_guard_waiting_thread_age_warning: float = 300.0
    lifecycle_guard_waiting_orphan_grace_seconds: float = 10.0
    lifecycle_guard_callback_warning: int = 20
    lifecycle_guard_strict: bool = False

    def worker_wait_release_status(self) -> dict:
        requested = bool(self.dispatcher_release_worker_wait)
        detached_wait = bool(self.dispatcher_detached_wait)
        bridge_ready = False
        reason = ""
        if requested and not detached_wait:
            reason = "detached_wait_disabled"
        elif requested and not bridge_ready:
            reason = "result_delivery_bridge_missing"
        return {
            "requested": requested,
            "detached_wait": detached_wait,
            "bridge_ready": bridge_ready,
            "armed": False,
            "blocked_reason": reason,
        }


_enhancement_config = FanxingEnhancementConfig()


def get_enhancement_config() -> FanxingEnhancementConfig:
    return _enhancement_config


def configure_enhancements(**kwargs) -> FanxingEnhancementConfig:
    for key, value in kwargs.items():
        if hasattr(_enhancement_config, key):
            setattr(_enhancement_config, key, value)
    release_status = _enhancement_config.worker_wait_release_status()
    if release_status["requested"] and not release_status["armed"]:
        logger.warning(
            "[FanxingEnhancement] worker_wait_release_blocked reason=%s detached_wait=%s bridge_ready=%s",
            release_status["blocked_reason"] or "not_armed",
            int(bool(release_status["detached_wait"])),
            int(bool(release_status["bridge_ready"])),
        )
    return _enhancement_config
