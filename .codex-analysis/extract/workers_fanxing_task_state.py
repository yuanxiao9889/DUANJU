# -*- coding: utf-8 -*-
"""繁星任务状态与错误定义模块

提供统一的任务状态枚举和结构化错误信息，作为整个繁星任务管理系统的基础。

【设计原则】
- 这是纯数据/枚举定义，不包含执行逻辑
- 状态定义覆盖所有任务类型的生命周期
- 错误码用于精确的问题定位
- 不依赖任何业务逻辑模块

使用示例：
    from workers.fanxing.task_state import FanxingTaskState, FanxingTaskError, FanxingErrorCode

    # 状态检查
    if task.state == FanxingTaskState.PROCESSING:
        print("任务正在处理中")

    # 错误处理
    if task.error:
        print(f"错误码: {task.error.code}")
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


# =============================================================================
# 任务状态枚举
# =============================================================================

class FanxingTaskState(Enum):
    """繁星任务状态枚举

    统一的任务状态定义，覆盖所有任务类型的生命周期。

    状态转换规则：
    - 初始状态: CREATED -> PENDING
    - 执行状态: PENDING -> UPLOADING -> SUBMITTING -> QUEUED -> PROCESSING -> DOWNLOADING
    - 终态: COMPLETED | FAILED | CANCELLED | TIMEOUT
    """

    # -------------------------------------------------------------------------
    # 初始状态
    # -------------------------------------------------------------------------
    CREATED = auto()      # 任务已创建（未提交）
    PENDING = auto()      # 等待处理（已入队）

    # -------------------------------------------------------------------------
    # 参考图上传阶段（图像生成任务特有）
    # -------------------------------------------------------------------------
    UPLOADING = auto()    # 参考图上传中

    # -------------------------------------------------------------------------
    # 任务提交阶段
    # -------------------------------------------------------------------------
    SUBMITTING = auto()   # 任务提交中（正在调用 API）

    # -------------------------------------------------------------------------
    # 服务器执行阶段
    # -------------------------------------------------------------------------
    QUEUED = auto()       # 服务器排队中
    PROCESSING = auto()   # 处理中（有进度）

    # -------------------------------------------------------------------------
    # 结果下载阶段
    # -------------------------------------------------------------------------
    DOWNLOADING = auto()  # 下载中

    # -------------------------------------------------------------------------
    # 终态（不可转换）
    # -------------------------------------------------------------------------
    COMPLETED = auto()    # 成功完成
    FAILED = auto()       # 执行失败
    CANCELLED = auto()    # 用户取消
    TIMEOUT = auto()      # 超时失败（FAILED 的子状态）

    def is_terminal(self) -> bool:
        """判断是否为终态"""
        return self in {
            FanxingTaskState.COMPLETED,
            FanxingTaskState.FAILED,
            FanxingTaskState.CANCELLED,
            FanxingTaskState.TIMEOUT,
        }

    def is_active(self) -> bool:
        """判断是否为活跃状态（非终态）"""
        return not self.is_terminal()

    def is_executing(self) -> bool:
        """判断是否为执行中状态"""
        return self in {
            FanxingTaskState.UPLOADING,
            FanxingTaskState.SUBMITTING,
            FanxingTaskState.QUEUED,
            FanxingTaskState.PROCESSING,
            FanxingTaskState.DOWNLOADING,
        }

    @property
    def display_name(self) -> str:
        """获取用户友好的显示名称"""
        names = {
            FanxingTaskState.CREATED: "已创建",
            FanxingTaskState.PENDING: "等待中",
            FanxingTaskState.UPLOADING: "上传参考图",
            FanxingTaskState.SUBMITTING: "提交任务",
            FanxingTaskState.QUEUED: "排队中",
            FanxingTaskState.PROCESSING: "处理中",
            FanxingTaskState.DOWNLOADING: "下载中",
            FanxingTaskState.COMPLETED: "已完成",
            FanxingTaskState.FAILED: "失败",
            FanxingTaskState.CANCELLED: "已取消",
            FanxingTaskState.TIMEOUT: "超时",
        }
        return names.get(self, self.name)


# =============================================================================
# 错误码定义
# =============================================================================

class FanxingErrorCode(Enum):
    """繁星任务错误码枚举

    结构化错误码，便于精确处理和日志分析。
    """

    # 网络错误（可重试）
    NETWORK_CONNECTION_FAILED = ("NETWORK_001", True, "网络连接失败")
    NETWORK_TIMEOUT = ("NETWORK_002", True, "网络请求超时")
    NETWORK_SSL_FAILED = ("NETWORK_004", True, "SSL 连接失败")

    # API 错误
    API_REQUEST_FAILED = ("API_001", False, "API 请求失败")
    API_RESPONSE_INVALID = ("API_002", False, "API 响应格式无效")
    API_RATE_LIMITED = ("API_003", True, "API 请求频率超限")

    # 认证/权限错误（不可重试）
    AUTH_INVALID_KEY = ("AUTH_001", False, "认证凭据无效")
    AUTH_EXPIRED_KEY = ("AUTH_002", False, "认证凭据已过期")
    AUTH_PERMISSION_DENIED = ("AUTH_003", False, "权限不足")

    # 配额错误（不可重试）
    QUOTA_NOT_ENOUGH = ("QUOTA_001", False, "额度不足")
    QUOTA_DAILY_LIMIT = ("QUOTA_002", False, "日额度用尽")

    # 服务器错误（可重试）
    SERVER_INTERNAL_ERROR = ("SERVER_001", True, "服务器内部错误")
    SERVER_UNAVAILABLE = ("SERVER_002", True, "服务器不可用")

    # 客户端错误（不可重试）
    CLIENT_INVALID_PARAMS = ("CLIENT_001", False, "参数无效")
    CLIENT_IMAGE_TOO_LARGE = ("CLIENT_002", False, "图片过大")

    # 超时错误
    TIMEOUT_SUBMIT = ("TIMEOUT_001", True, "任务提交超时")
    TIMEOUT_PROCESS = ("TIMEOUT_002", True, "任务处理超时")
    TIMEOUT_DOWNLOAD = ("TIMEOUT_003", True, "结果下载超时")

    # 取消错误
    CANCEL_USER_REQUEST = ("CANCEL_001", False, "用户取消")

    # 通用错误
    UNKNOWN = ("UNKNOWN_001", True, "未知错误")

    def __init__(self, code: str, retryable: bool, description: str):
        self.code = code
        self.retryable = retryable
        self.description = description

    @property
    def is_retryable(self) -> bool:
        """是否可重试"""
        return self.retryable


# =============================================================================
# 错误信息类
# =============================================================================

@dataclass
class FanxingTaskError:
    """繁星任务错误信息

    结构化错误信息，包含错误码、消息、详情。

    【轻量级数据类】
    - 不包含执行逻辑
    - 仅用于携带错误信息
    """

    code: FanxingErrorCode = FanxingErrorCode.UNKNOWN
    message: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    retry_count: int = 0

    def __post_init__(self):
        if not self.message:
            self.message = self.code.description

    @property
    def is_retryable(self) -> bool:
        """是否可重试"""
        return self.code.is_retryable and self.retry_count < 3

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "code": self.code.code,
            "message": self.message,
            "details": self.details,
            "retryable": self.is_retryable,
        }

    def __str__(self) -> str:
        return f"[{self.code.code}] {self.message}"
