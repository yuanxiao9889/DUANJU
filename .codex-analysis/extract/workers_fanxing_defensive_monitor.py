# -*- coding: utf-8 -*-

from __future__ import annotations

import gc
import logging
import os
import threading
import time
from dataclasses import dataclass
from queue import Empty, Queue
from typing import Callable, Dict, Optional

from ..enhancement_config import get_enhancement_config

logger = logging.getLogger(__name__)


@dataclass
class StuckTaskInfo:
    task_id: str
    state: str
    last_progress: int
    stuck_duration_seconds: float


class TaskMonitor:
    _instance: Optional["TaskMonitor"] = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._lock = threading.Lock()
        self._enabled = False
        self._monitor_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._check_interval = 10.0
        self._stuck_threshold = 300.0
        self._memory_threshold_mb = 200
        self._memory_spike_ratio = 1.5
        self._tracked_tasks: Dict[str, dict] = {}
        self._memory_samples = []
        self._stuck_callback: Optional[Callable[[StuckTaskInfo], None]] = None
        self._memory_callback: Optional[Callable[[int], None]] = None
        self._notification_queue: "Queue[tuple]" = Queue()

    @classmethod
    def get_instance(cls) -> "TaskMonitor":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def configure(self) -> None:
        config = get_enhancement_config()
        with self._lock:
            self._check_interval = max(1.0, float(config.monitor_interval or 10.0))
            self._stuck_threshold = max(
                5.0, float(config.stuck_task_threshold or 300.0)
            )
            self._memory_threshold_mb = max(
                1,
                int(
                    getattr(
                        config, "memory_warning_threshold_mb", self._memory_threshold_mb
                    )
                    or self._memory_threshold_mb
                ),
            )
            self._memory_spike_ratio = max(
                1.0,
                float(
                    getattr(config, "memory_spike_ratio", self._memory_spike_ratio)
                    or self._memory_spike_ratio
                ),
            )
            self._enabled = bool(config.use_task_monitor)

    def ensure_started(self) -> None:
        self.configure()
        with self._lock:
            if not self._enabled:
                return
            if self._monitor_thread is not None and self._monitor_thread.is_alive():
                return
            self._stop_event.clear()
            self._monitor_thread = threading.Thread(
                target=self._monitor_loop,
                daemon=True,
                name="FanxingTaskMonitor",
            )
            self._monitor_thread.start()

    def stop(self) -> None:
        with self._lock:
            self._enabled = False
            self._tracked_tasks.clear()
            self._stop_event.set()
            thread = self._monitor_thread
            self._monitor_thread = None
        if thread and thread.is_alive():
            thread.join(timeout=5)

    def set_stuck_callback(
        self, callback: Optional[Callable[[StuckTaskInfo], None]]
    ) -> None:
        with self._lock:
            self._stuck_callback = callback

    def set_memory_callback(self, callback: Optional[Callable[[int], None]]) -> None:
        with self._lock:
            self._memory_callback = callback

    def register_task(
        self, task_id: str, *, state: str = "pending", progress: int = 0
    ) -> None:
        self.ensure_started()
        with self._lock:
            if not self._enabled:
                return
            now = time.time()
            self._tracked_tasks[task_id] = {
                "state": state,
                "last_progress": int(progress or 0),
                "last_update": now,
                "last_warned_at": 0.0,
            }

    def touch_task(self, task_id: str, *, state: Optional[str] = None) -> None:
        with self._lock:
            if not self._enabled:
                return
            task = self._tracked_tasks.get(task_id)
            if not task:
                return
            task["last_update"] = time.time()
            if state is not None:
                task["state"] = state

    def track_progress(
        self, task_id: str, progress: int, *, state: Optional[str] = None
    ) -> None:
        with self._lock:
            if not self._enabled:
                return
            task = self._tracked_tasks.get(task_id)
            if not task:
                return
            task["last_progress"] = int(progress or 0)
            task["last_update"] = time.time()
            if state is not None:
                task["state"] = state

    def unregister_task(self, task_id: str) -> None:
        with self._lock:
            self._tracked_tasks.pop(task_id, None)

    def get_stats(self) -> Dict[str, object]:
        with self._lock:
            return {
                "enabled": self._enabled,
                "tracked_tasks": len(self._tracked_tasks),
                "memory_samples": len(self._memory_samples),
                "current_memory_mb": self._memory_samples[-1]
                if self._memory_samples
                else 0,
            }

    def _monitor_loop(self) -> None:
        while not self._stop_event.wait(self._check_interval):
            try:
                self._check_stuck_tasks()
                self._check_memory()
            except Exception as exc:
                logger.error("[TaskMonitor] 监控异常: %s", exc)

    def _check_stuck_tasks(self) -> None:
        now = time.time()
        stuck_events = []
        callback = None
        with self._lock:
            if not self._enabled:
                return
            callback = self._stuck_callback
            for task_id, task in self._tracked_tasks.items():
                idle_seconds = now - float(task.get("last_update", now))
                if idle_seconds < self._stuck_threshold:
                    continue
                last_warned_at = float(task.get("last_warned_at", 0.0) or 0.0)
                if now - last_warned_at < self._check_interval:
                    continue
                task["last_warned_at"] = now
                stuck_events.append(
                    StuckTaskInfo(
                        task_id=task_id,
                        state=str(task.get("state") or "unknown"),
                        last_progress=int(task.get("last_progress", 0) or 0),
                        stuck_duration_seconds=idle_seconds,
                    )
                )
        for event in stuck_events:
            logger.warning(
                "[TaskMonitor] 检测到卡住任务: %s, state=%s, progress=%s, idle=%.1fs",
                event.task_id,
                event.state,
                event.last_progress,
                event.stuck_duration_seconds,
            )
            if callback:
                self._notification_queue.put(("stuck", event))

    def _check_memory(self) -> None:
        try:
            import psutil
        except ImportError:
            return

        callback = None
        current_memory_mb = 0
        with self._lock:
            if not self._enabled:
                return
            callback = self._memory_callback
        process = psutil.Process(os.getpid())
        current_memory_mb = int(process.memory_info().rss / (1024 * 1024))
        should_collect = False
        with self._lock:
            self._memory_samples.append(current_memory_mb)
            if len(self._memory_samples) > 60:
                self._memory_samples.pop(0)
            average_memory_mb = (
                sum(self._memory_samples) / len(self._memory_samples)
                if self._memory_samples
                else float(current_memory_mb)
            )
            should_collect = (
                current_memory_mb > self._memory_threshold_mb
                and current_memory_mb > average_memory_mb * self._memory_spike_ratio
            )
        if not should_collect:
            return
        logger.warning(
            "[TaskMonitor] 内存使用异常: %sMB",
            current_memory_mb,
        )
        if callback:
            self._notification_queue.put(("memory", int(current_memory_mb)))
        gc.collect()

    def drain_notifications(self) -> None:
        """在主线程中分发监控通知。"""
        while True:
            try:
                kind, payload = self._notification_queue.get_nowait()
            except Empty:
                return

            if kind == "stuck":
                callback = None
                with self._lock:
                    callback = self._stuck_callback
                if callback:
                    try:
                        callback(payload)
                    except Exception as exc:
                        logger.error("[TaskMonitor] 卡住任务回调异常: %s", exc)
            elif kind == "memory":
                callback = None
                with self._lock:
                    callback = self._memory_callback
                if callback:
                    try:
                        callback(int(payload or 0))
                    except Exception as exc:
                        logger.error("[TaskMonitor] 内存警告回调异常: %s", exc)


_task_monitor: Optional[TaskMonitor] = None
_task_monitor_lock = threading.Lock()


def get_task_monitor() -> TaskMonitor:
    global _task_monitor
    if _task_monitor is None:
        with _task_monitor_lock:
            if _task_monitor is None:
                _task_monitor = TaskMonitor.get_instance()
    return _task_monitor
