# -*- coding: utf-8 -*-
"""繁星任务事件总线模块

提供线程安全的任务事件分发，使用 Qt 信号机制确保跨线程安全。

使用示例：
    from workers.fanxing.task_events import FanxingTaskEventBus, FanxingTaskEvent, FanxingEventType

    bus = FanxingTaskEventBus.get_instance()

    # 订阅事件
    def on_task_completed(event):
        print(f"任务完成: {event.task_id}")

    bus.subscribe(FanxingEventType.TASK_COMPLETED, on_task_completed)

    # 发送事件（可从任何线程调用）
    event = FanxingTaskEvent(
        event_type=FanxingEventType.TASK_COMPLETED,
        task_id="task_abc123"
    )
    bus.emit(event)
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Callable, Any, Optional, Set

logger = logging.getLogger(__name__)


# =============================================================================
# 事件类型定义
# =============================================================================


class FanxingEventType:
    """繁星任务事件类型常量"""

    # -------------------------------------------------------------------------
    # 任务生命周期事件
    # -------------------------------------------------------------------------
    TASK_CREATED = "task.created"  # 任务已创建
    TASK_STARTED = "task.started"  # 任务开始执行
    TASK_PROGRESS = "task.progress"  # 任务进度更新
    TASK_COMPLETED = "task.completed"  # 任务成功完成
    TASK_FAILED = "task.failed"  # 任务执行失败
    TASK_CANCELLED = "task.cancelled"  # 任务已取消
    TASK_TIMEOUT = "task.timeout"  # 任务超时
    TASK_CANCEL_REQUEST = "task.cancel_request"  # 取消请求

    # -------------------------------------------------------------------------
    # 占位符事件
    # -------------------------------------------------------------------------
    PLACEHOLDER_CREATED = "placeholder.created"  # 占位符已创建
    PLACEHOLDER_PROGRESS = "placeholder.progress"  # 占位符进度更新
    PLACEHOLDER_UPDATED = "placeholder.updated"  # 占位符更新
    PLACEHOLDER_COMPLETED = "placeholder.completed"  # 占位符完成（图片就绪）
    PLACEHOLDER_FAILED = "placeholder.failed"  # 占位符失败

    # -------------------------------------------------------------------------
    # 参考图上传事件
    # -------------------------------------------------------------------------
    IMAGE_UPLOAD_STARTED = "image.upload_started"  # 上传开始
    IMAGE_UPLOAD_PROGRESS = "image.upload_progress"  # 上传进度
    IMAGE_UPLOAD_COMPLETED = "image.upload_completed"  # 上传完成
    IMAGE_UPLOAD_FAILED = "image.upload_failed"  # 上传失败

    # -------------------------------------------------------------------------
    # 图片下载事件
    # -------------------------------------------------------------------------
    IMAGE_DOWNLOAD_STARTED = "image.download_started"  # 下载开始
    IMAGE_DOWNLOAD_PROGRESS = "image.download_progress"  # 下载进度
    IMAGE_DOWNLOAD_COMPLETED = "image.download_completed"  # 下载完成
    IMAGE_DOWNLOAD_FAILED = "image.download_failed"  # 下载失败

    # -------------------------------------------------------------------------
    # 系统事件
    # -------------------------------------------------------------------------
    SYSTEM_ERROR = "system.error"  # 系统错误
    SYSTEM_WARNING = "system.warning"  # 系统警告
    REGISTRY_UPDATED = "registry.updated"  # 注册表更新


# =============================================================================
# 事件数据类
# =============================================================================


@dataclass
class FanxingTaskEvent:
    """繁星任务事件

    包含事件的完整信息，用于在组件间传递。

    属性：
        event_id: 事件唯一 ID
        event_type: 事件类型（FanxingEventType 常量）
        task_id: 关联的任务 ID
        generation_id: 关联的生成组 ID
        timestamp: 事件时间戳
        data: 事件数据（字典）
        source: 事件来源组件
    """

    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str = ""
    task_id: str = ""
    generation_id: str = ""
    timestamp: datetime = field(default_factory=datetime.now)
    data: Dict[str, Any] = field(default_factory=dict)
    source: str = ""

    @property
    def is_task_event(self) -> bool:
        """是否为任务相关事件"""
        return self.event_type.startswith("task.")

    @property
    def is_placeholder_event(self) -> bool:
        """是否为占位符相关事件"""
        return self.event_type.startswith("placeholder.")

    @property
    def is_image_event(self) -> bool:
        """是否为图片相关事件"""
        return self.event_type.startswith("image.")

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "task_id": self.task_id,
            "generation_id": self.generation_id,
            "timestamp": self.timestamp.isoformat(),
            "data": self.data,
            "source": self.source,
        }


# =============================================================================
# Qt 信号安全的事件总线
# =============================================================================

# 全局事件总线实例
_event_bus_instance: Optional["FanxingTaskEventBus"] = None
_event_bus_lock = threading.Lock()


class FanxingTaskEventBus:
    """繁星任务事件总线（线程安全）

    使用 Qt 信号机制确保跨线程安全：
    - Worker 线程发出事件 -> Qt 信号 -> 主线程回调

    特性：
    - 单例模式
    - 线程安全的事件订阅/取消
    - Qt 信号桥接（自动编组到主线程）
    - 通配符订阅（*）

    使用示例：
        # 订阅特定事件
        bus.subscribe(FanxingEventType.TASK_COMPLETED, callback)

        # 订阅任务的所有事件
        bus.subscribe_task(task_id, callback)

        # 订阅生成组的所有事件
        bus.subscribe_generation(generation_id, callback)

        # 发送事件
        bus.emit(event)
    """

    @classmethod
    def get_instance(cls) -> "FanxingTaskEventBus":
        """获取单例实例"""
        global _event_bus_instance
        if _event_bus_instance is None:
            with _event_bus_lock:
                if _event_bus_instance is None:
                    _event_bus_instance = cls()
        return _event_bus_instance

    def __init__(self):
        # 防止重复初始化
        if hasattr(self, "_initialized") and self._initialized:
            return

        self._subscribers: Dict[
            str, Set[Callable]
        ] = {}  # {event_type: {callback, ...}}
        self._task_subscribers: Dict[
            str, Set[Callable]
        ] = {}  # {task_id: {callback, ...}}
        self._generation_subscribers: Dict[
            str, Set[Callable]
        ] = {}  # {generation_id: {callback, ...}}
        self._lock = threading.Lock()
        self._qt_signal_bridge: Optional["QtSignalBridge"] = None
        self._initialized = True

        # 尝试初始化 Qt 信号桥接
        self._try_init_qt_bridge()

        logger.info("[FanxingTaskEventBus] 初始化完成")

    def _try_init_qt_bridge(self) -> None:
        """尝试初始化 Qt 信号桥接"""
        QtSignalBridgeClass = _create_qt_signal_bridge()
        if QtSignalBridgeClass is not None:
            self._qt_signal_bridge = QtSignalBridgeClass()
            logger.info("[FanxingTaskEventBus] Qt 信号桥接已启用")
        else:
            logger.warning(
                "[FanxingTaskEventBus] Qt bridge unavailable, fallback to direct dispatch in current thread"
            )
            self._qt_signal_bridge = None

    # -------------------------------------------------------------------------
    # 事件发送（emit）
    # -------------------------------------------------------------------------

    def emit(self, event: FanxingTaskEvent) -> None:
        """发送事件（线程安全）

        可以从任何线程调用，事件会自动编组到主线程（如果 Qt 可用）。

        Args:
            event: 事件对象
        """
        # 验证事件
        if not event.event_type:
            logger.warning("[FanxingTaskEventBus] 忽略无类型事件")
            return

        # 如果有 Qt 桥接，通过信号发送（自动到主线程）
        if self._qt_signal_bridge is not None:
            self._qt_signal_bridge.emit_event(event)
            return

        # 否则直接分发（仍在当前线程）
        logger.warning(
            "[FanxingTaskEventBus] direct_dispatch type=%s task_id=%s generation_id=%s",
            str(event.event_type or ""),
            str(event.task_id or ""),
            str(event.generation_id or ""),
        )
        self._dispatch_event(event)

    def _dispatch_event(self, event: FanxingTaskEvent) -> None:
        """分发事件到订阅者"""
        callbacks_to_call: List[Callable] = []

        with self._lock:
            # 1. 获取事件类型的订阅者
            event_callbacks = self._subscribers.get(event.event_type, set()).copy()

            # 2. 获取通配符订阅者 (*)
            wildcard_callbacks = self._subscribers.get("*", set()).copy()

            # 3. 获取任务订阅者
            task_callbacks = self._task_subscribers.get(event.task_id, set()).copy()

            # 4. 获取生成组订阅者
            gen_callbacks = self._generation_subscribers.get(
                event.generation_id, set()
            ).copy()

            # 合并所有回调
            all_callbacks = (
                event_callbacks | wildcard_callbacks | task_callbacks | gen_callbacks
            )

        # 锁外执行回调
        for callback in all_callbacks:
            try:
                callback(event)
            except Exception as e:
                logger.error(f"[FanxingTaskEventBus] 事件回调异常: {e}")

        # 调试日志
        if all_callbacks:
            logger.debug(
                f"[FanxingTaskEventBus] 分发事件: type={event.event_type}, "
                f"task_id={event.task_id}, receivers={len(all_callbacks)}"
            )

    # -------------------------------------------------------------------------
    # 事件订阅
    # -------------------------------------------------------------------------

    def subscribe(self, event_type: str, callback: Callable) -> None:
        """订阅事件

        Args:
            event_type: 事件类型（FanxingEventType 常量或字符串）
            callback: 回调函数 (event: FanxingTaskEvent) -> None
        """
        with self._lock:
            if event_type not in self._subscribers:
                self._subscribers[event_type] = set()
            self._subscribers[event_type].add(callback)

        logger.debug(f"[FanxingTaskEventBus] 订阅事件: type={event_type}")

    def unsubscribe(self, event_type: str, callback: Callable) -> bool:
        """取消订阅

        Args:
            event_type: 事件类型
            callback: 回调函数

        Returns:
            bool: 是否成功取消
        """
        with self._lock:
            if event_type not in self._subscribers:
                return False
            try:
                self._subscribers[event_type].remove(callback)
                return True
            except KeyError:
                return False

    def subscribe_task(self, task_id: str, callback: Callable) -> None:
        """订阅特定任务的所有事件

        Args:
            task_id: 任务 ID
            callback: 回调函数
        """
        with self._lock:
            if task_id not in self._task_subscribers:
                self._task_subscribers[task_id] = set()
            self._task_subscribers[task_id].add(callback)

        logger.debug(f"[FanxingTaskEventBus] 订阅任务: task_id={task_id}")

    def unsubscribe_task(self, task_id: str, callback: Callable) -> bool:
        """取消任务订阅

        Args:
            task_id: 任务 ID
            callback: 回调函数

        Returns:
            bool: 是否成功取消
        """
        with self._lock:
            if task_id not in self._task_subscribers:
                return False
            try:
                self._task_subscribers[task_id].remove(callback)
                return True
            except KeyError:
                return False

    def subscribe_generation(self, generation_id: str, callback: Callable) -> None:
        """订阅整个生成组的所有事件

        Args:
            generation_id: 生成组 ID
            callback: 回调函数
        """
        with self._lock:
            if generation_id not in self._generation_subscribers:
                self._generation_subscribers[generation_id] = set()
            self._generation_subscribers[generation_id].add(callback)

        logger.debug(f"[FanxingTaskEventBus] 订阅生成组: generation_id={generation_id}")

    def unsubscribe_generation(self, generation_id: str, callback: Callable) -> bool:
        """取消生成组订阅

        Args:
            generation_id: 生成组 ID
            callback: 回调函数

        Returns:
            bool: 是否成功取消
        """
        with self._lock:
            if generation_id not in self._generation_subscribers:
                return False
            try:
                self._generation_subscribers[generation_id].remove(callback)
                return True
            except KeyError:
                return False

    # -------------------------------------------------------------------------
    # 便捷工厂方法
    # -------------------------------------------------------------------------

    @staticmethod
    def create_task_event(
        event_type: str, task_id: str, generation_id: str = "", **kwargs
    ) -> FanxingTaskEvent:
        """创建任务事件的便捷方法

        Args:
            event_type: 事件类型
            task_id: 任务 ID
            generation_id: 生成组 ID
            **kwargs: 其他事件数据

        Returns:
            FanxingTaskEvent: 事件对象
        """
        return FanxingTaskEvent(
            event_type=event_type,
            task_id=task_id,
            generation_id=generation_id,
            data=kwargs,
        )

    def emit_task_progress(
        self, task_id: str, progress: int, message: str = "", generation_id: str = ""
    ) -> None:
        """发送任务进度事件

        Args:
            task_id: 任务 ID
            progress: 进度值 (0-100)
            message: 进度消息
            generation_id: 生成组 ID
        """
        event = self.create_task_event(
            FanxingEventType.TASK_PROGRESS,
            task_id=task_id,
            generation_id=generation_id,
            progress=progress,
            message=message,
        )
        self.emit(event)

    def emit_task_completed(
        self, task_id: str, result: Any = None, generation_id: str = ""
    ) -> None:
        """发送任务完成事件

        Args:
            task_id: 任务 ID
            result: 任务结果
            generation_id: 生成组 ID
        """
        event = self.create_task_event(
            FanxingEventType.TASK_COMPLETED,
            task_id=task_id,
            generation_id=generation_id,
            result=result,
        )
        self.emit(event)

    def emit_task_failed(
        self, task_id: str, error: Any = None, generation_id: str = ""
    ) -> None:
        """发送任务失败事件

        Args:
            task_id: 任务 ID
            error: 错误信息
            generation_id: 生成组 ID
        """
        event = self.create_task_event(
            FanxingEventType.TASK_FAILED,
            task_id=task_id,
            generation_id=generation_id,
            error=error,
        )
        self.emit(event)

    def emit_placeholder_completed(
        self, task_id: str, index: int, image_data: Any = None, generation_id: str = ""
    ) -> None:
        """发送占位符完成事件（图片就绪）

        Args:
            task_id: 任务 ID
            index: 占位符索引
            image_data: 图片数据
            generation_id: 生成组 ID
        """
        event = self.create_task_event(
            FanxingEventType.PLACEHOLDER_COMPLETED,
            task_id=task_id,
            generation_id=generation_id,
            index=index,
            image_data=image_data,
        )
        self.emit(event)

    # -------------------------------------------------------------------------
    # 清理
    # -------------------------------------------------------------------------

    def clear(self) -> None:
        """清空所有订阅"""
        with self._lock:
            self._subscribers.clear()
            self._task_subscribers.clear()
            self._generation_subscribers.clear()
        logger.info("[FanxingTaskEventBus] 已清空")

    def clear_task_subscriptions(self, task_id: str) -> None:
        """清空任务的订阅"""
        with self._lock:
            if task_id in self._task_subscribers:
                del self._task_subscribers[task_id]
        logger.debug(f"[FanxingTaskEventBus] 清空任务订阅: task_id={task_id}")

    def clear_generation_subscriptions(self, generation_id: str) -> None:
        """清空生成组的订阅"""
        with self._lock:
            if generation_id in self._generation_subscribers:
                del self._generation_subscribers[generation_id]
        logger.debug(
            f"[FanxingTaskEventBus] 清空生成组订阅: generation_id={generation_id}"
        )

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            return {
                "event_types": len(self._subscribers),
                "task_subscriptions": len(self._task_subscribers),
                "generation_subscriptions": len(self._generation_subscribers),
                "qt_bridge_enabled": self._qt_signal_bridge is not None,
            }


# =============================================================================
# Qt 信号桥接（延迟加载）
# =============================================================================


def _create_qt_signal_bridge():
    """延迟创建 Qt 信号桥接类

    只有在 PyQt5 可用时才会创建，避免导入错误。
    """
    try:
        from PyQt5.QtCore import QObject, pyqtSignal

        class QtSignalBridge(QObject):
            """Qt 信号桥接

            用于在非主线程中发送事件时，自动通过 Qt 信号机制编组到主线程执行。
            """

            # Qt 信号（自动跨线程编组）
            _event_signal = pyqtSignal(object)

            def __init__(self):
                super().__init__()
                # 连接信号到分发方法
                self._event_signal.connect(self._on_event_in_main_thread)

            def emit_event(self, event: "FanxingTaskEvent") -> None:
                """发送事件到主线程

                Args:
                    event: 事件对象
                """
                if self._event_signal is not None:
                    self._event_signal.emit(event)

            def _on_event_in_main_thread(self, event: "FanxingTaskEvent") -> None:
                """在主线程中处理事件

                Args:
                    event: 事件对象
                """
                try:
                    bus = FanxingTaskEventBus.get_instance()
                    bus._dispatch_event(event)
                except Exception as e:
                    logger.error(f"[QtSignalBridge] 事件处理异常: {e}")

        return QtSignalBridge
    except ImportError:
        return None
