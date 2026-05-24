# -*- coding: utf-8 -*-
"""繁星接口适配模块

提供繁星 API 的完整支持，包括：
- 图片上传缓存（FanxingImageCache）
- 批量轮询管理（FanxingBatchPoller）
- 请求处理逻辑（FanxingRequestMixin）
- 任务状态枚举（FanxingTaskState）【可选增强】
- 任务事件总线（FanxingTaskEventBus）【可选增强】

【设计原则】
- 不重复已有实现
- 可选的增强模块，不强制使用
- 保持向后兼容

使用方法：
    # 基础使用（现有流程不变）
    from workers.fanxing import FanxingRequestMixin, _fanxing_batch_poller

    # 可选增强：状态枚举
    from workers.fanxing.task_state import FanxingTaskState, FanxingTaskError

    # 可选增强：事件总线
    from workers.fanxing.task_events import FanxingTaskEventBus, FanxingEventType
"""

# 核心业务模块（无循环依赖）
from .image_cache import FanxingImageCache
from .batch_poller import FanxingBatchPoller
from .cf_task_builder import (
    build_fanxing_cf_task_params,
    normalize_cf_task_options,
    resolve_fanxing_source_image_url,
)
from .concurrency_controller import (
    ConcurrencyLevel,
    FanxingConcurrencyController,
    TaskPriority,
    get_concurrency_controller,
)
from .enhancement_config import (
    FanxingEnhancementConfig,
    configure_enhancements,
    get_enhancement_config,
)
from .task_dispatcher import (
    FanxingSubmittedTask,
    FanxingTaskDispatcher,
    get_fanxing_task_dispatcher,
)
from .result_dispatcher import (
    FanxingResultDispatcher,
    FanxingResultWaitHandle,
    FanxingRoutedResult,
    FanxingTerminalDelivery,
    get_fanxing_result_dispatcher,
)
from .result_delivery_bridge import (
    FanxingResultDeliveryBridge,
    FanxingUiDeliverySnapshot,
    get_fanxing_result_delivery_bridge,
)
from .result_finish_bridge import (
    FanxingResultFinishBridge,
    FanxingWorkerFinishSnapshot,
    get_fanxing_result_finish_bridge,
)
from .defensive import (
    FanxingLifecycleGuard,
    StuckTaskInfo,
    StateTransitionValidator,
    TaskMonitor,
    get_lifecycle_guard,
    get_state_validator,
    get_task_monitor,
)

# 可选增强模块（轻量级数据定义，不含执行逻辑）
from .task_state import (
    FanxingTaskState,
    FanxingTaskError,
    FanxingErrorCode,
)
from .task_events import (
    FanxingTaskEventBus,
    FanxingTaskEvent,
    FanxingEventType,
)

# FanxingRequestMixin 依赖 managers.logging_manager，可能产生循环导入
# 延迟导入：在 __all__ 中导出，但不在模块加载时立即导入
_FanxingRequestMixin = None


def _get_fanxing_request_mixin():
    """延迟加载 FanxingRequestMixin"""
    global _FanxingRequestMixin
    if _FanxingRequestMixin is None:
        from .request_handler import FanxingRequestMixin

        _FanxingRequestMixin = FanxingRequestMixin
    return _FanxingRequestMixin


def __getattr__(name):
    """支持延迟导入"""
    if name == "FanxingRequestMixin":
        return _get_fanxing_request_mixin()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


# 全局单例
_fanxing_image_cache = FanxingImageCache()
_fanxing_batch_poller = FanxingBatchPoller()

__all__ = [
    # 原有核心模块
    "FanxingImageCache",
    "FanxingBatchPoller",
    "build_fanxing_cf_task_params",
    "normalize_cf_task_options",
    "resolve_fanxing_source_image_url",
    "FanxingRequestMixin",  # 延迟导入
    "_fanxing_image_cache",
    "_fanxing_batch_poller",
    # 可选增强：状态枚举（轻量级，不含执行逻辑）
    "FanxingTaskState",
    "FanxingTaskError",
    "FanxingErrorCode",
    # 可选增强：事件总线
    "FanxingTaskEventBus",
    "FanxingTaskEvent",
    "FanxingEventType",
    # 增强配置与并发控制器相关入口
    "ConcurrencyLevel",
    "FanxingConcurrencyController",
    "TaskPriority",
    "get_concurrency_controller",
    "FanxingEnhancementConfig",
    "configure_enhancements",
    "get_enhancement_config",
    "FanxingSubmittedTask",
    "FanxingTaskDispatcher",
    "get_fanxing_task_dispatcher",
    "FanxingResultDispatcher",
    "FanxingResultWaitHandle",
    "FanxingRoutedResult",
    "FanxingTerminalDelivery",
    "get_fanxing_result_dispatcher",
    "FanxingResultDeliveryBridge",
    "FanxingUiDeliverySnapshot",
    "get_fanxing_result_delivery_bridge",
    "FanxingResultFinishBridge",
    "FanxingWorkerFinishSnapshot",
    "get_fanxing_result_finish_bridge",
    "StuckTaskInfo",
    "FanxingLifecycleGuard",
    "StateTransitionValidator",
    "TaskMonitor",
    "get_lifecycle_guard",
    "get_state_validator",
    "get_task_monitor",
]
