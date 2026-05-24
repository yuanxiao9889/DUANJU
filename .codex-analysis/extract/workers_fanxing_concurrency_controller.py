# -*- coding: utf-8 -*-

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from queue import PriorityQueue
from typing import Dict, Optional

from .enhancement_config import get_enhancement_config

logger = logging.getLogger(__name__)


class TaskPriority(Enum):
    LOW = 1
    NORMAL = 5
    HIGH = 10


@dataclass
class ConcurrencyLevel:
    max_concurrent: int = 5
    queue_size: int = 20
    timeout_seconds: float = 300.0
    _semaphore: threading.Semaphore = field(init=False, repr=False)
    _lock: threading.Lock = field(init=False, repr=False)
    _current_count: int = field(default=0, init=False, repr=False)
    _waiting_queue: PriorityQueue = field(init=False, repr=False)

    def __post_init__(self):
        self._semaphore = threading.Semaphore(self.max_concurrent)
        self._lock = threading.Lock()
        self._waiting_queue = PriorityQueue(maxsize=self.queue_size)


class FanxingConcurrencyController:
    DEFAULT_CONFIG = {
        "channel:fanxing": ConcurrencyLevel(max_concurrent=5),
        "capability:image_generation": ConcurrencyLevel(max_concurrent=6),
        "capability:cf_task": ConcurrencyLevel(max_concurrent=10),
        "capability:image_upload": ConcurrencyLevel(max_concurrent=4),
        "global": ConcurrencyLevel(max_concurrent=16),
    }

    def __init__(self, config: Optional[Dict[str, ConcurrencyLevel]] = None):
        self._levels: Dict[str, ConcurrencyLevel] = (
            config or self._clone_default_config()
        )
        self._lock = threading.Lock()
        self._stats = {
            "total_acquired": 0,
            "total_released": 0,
            "total_waited": 0,
            "total_timeout": 0,
        }

    def _clone_default_config(self) -> Dict[str, ConcurrencyLevel]:
        return {
            key: ConcurrencyLevel(
                max_concurrent=value.max_concurrent,
                queue_size=value.queue_size,
                timeout_seconds=value.timeout_seconds,
            )
            for key, value in self.DEFAULT_CONFIG.items()
        }

    def _is_enabled(self) -> bool:
        return bool(get_enhancement_config().use_concurrency_control)

    def acquire(
        self,
        channel: str,
        capability: str,
        priority: TaskPriority = TaskPriority.NORMAL,
        blocking: bool = True,
        timeout: Optional[float] = None,
    ) -> bool:
        if not self._is_enabled():
            return True

        del priority
        level_keys = self._resolve_level_keys(channel, capability)
        acquired_levels = []
        start_time = time.time()

        try:
            for key in level_keys:
                level = self._levels.get(key)
                if not level:
                    continue

                wait_timeout = timeout
                if blocking and wait_timeout is not None:
                    elapsed = time.time() - start_time
                    wait_timeout = max(0.0, wait_timeout - elapsed)

                if blocking:
                    if wait_timeout is None:
                        acquired = level._semaphore.acquire(blocking=True)
                    else:
                        acquired = level._semaphore.acquire(
                            blocking=True,
                            timeout=wait_timeout,
                        )
                else:
                    acquired = level._semaphore.acquire(blocking=False)
                if not acquired:
                    if blocking:
                        with self._lock:
                            self._stats["total_timeout"] += 1
                        logger.warning(
                            "[FanxingConcurrencyController] 获取额度超时: %s/%s",
                            channel,
                            capability,
                        )
                    self._rollback_acquire(acquired_levels)
                    return False
                acquired_levels.append(key)

            with self._lock:
                self._stats["total_acquired"] += 1
                waited_seconds = time.time() - start_time
                if waited_seconds > 0.01:
                    self._stats["total_waited"] += 1
                for key in acquired_levels:
                    level = self._levels.get(key)
                    if level:
                        level._current_count += 1
            return True
        except Exception as exc:
            self._rollback_acquire(acquired_levels)
            logger.error("[FanxingConcurrencyController] 获取额度异常: %s", exc)
            return False

    def release(self, channel: str, capability: str) -> None:
        if not self._is_enabled():
            return

        with self._lock:
            for key in self._resolve_level_keys(channel, capability):
                level = self._levels.get(key)
                if not level or level._current_count <= 0:
                    continue
                level._current_count -= 1
                level._semaphore.release()
            self._stats["total_released"] += 1

    def update_global_limit(self, max_concurrent: int) -> None:
        normalized = max(1, int(max_concurrent or 1))
        with self._lock:
            level = self._levels.get("global")
            if level is None:
                self._levels["global"] = ConcurrencyLevel(max_concurrent=normalized)
                return
            if level.max_concurrent == normalized:
                return
            if level._current_count > 0:
                logger.debug(
                    "[FanxingConcurrencyController] 跳过活动中的全局并发上限更新: current=%s, target=%s",
                    level._current_count,
                    normalized,
                )
                return
            self._levels["global"] = ConcurrencyLevel(max_concurrent=normalized)

    def get_current_concurrency(self, channel: str, capability: str) -> int:
        with self._lock:
            counts = []
            for key in self._resolve_level_keys(channel, capability):
                level = self._levels.get(key)
                if level:
                    counts.append(level._current_count)
        return max(counts) if counts else 0

    def get_stats(self) -> Dict[str, object]:
        with self._lock:
            stats = dict(self._stats)
            stats["levels"] = {
                key: {
                    "current": level._current_count,
                    "max": level.max_concurrent,
                }
                for key, level in self._levels.items()
            }
            return stats

    def _resolve_level_keys(self, channel: str, capability: str):
        return ["global", f"channel:{channel}", f"capability:{capability}"]

    def _rollback_acquire(self, acquired_levels) -> None:
        with self._lock:
            for key in reversed(list(acquired_levels)):
                level = self._levels.get(key)
                if not level:
                    continue
                if level._current_count > 0:
                    level._current_count -= 1
                try:
                    level._semaphore.release()
                except ValueError:
                    pass


_fanxing_concurrency_controller: Optional[FanxingConcurrencyController] = None
_fanxing_concurrency_lock = threading.Lock()


def get_concurrency_controller() -> FanxingConcurrencyController:
    global _fanxing_concurrency_controller
    if _fanxing_concurrency_controller is None:
        with _fanxing_concurrency_lock:
            if _fanxing_concurrency_controller is None:
                _fanxing_concurrency_controller = FanxingConcurrencyController()
    controller = _fanxing_concurrency_controller
    controller.update_global_limit(get_enhancement_config().max_concurrent_tasks)
    return controller
