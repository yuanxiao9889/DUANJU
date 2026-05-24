# -*- coding: utf-8 -*-

from __future__ import annotations

import logging
from typing import Dict, Set

from ..enhancement_config import get_enhancement_config
from ..task_state import FanxingTaskState

logger = logging.getLogger(__name__)


class StateTransitionValidator:
    VALID_TRANSITIONS: Dict[FanxingTaskState, Set[FanxingTaskState]] = {
        FanxingTaskState.CREATED: {
            FanxingTaskState.PENDING,
            FanxingTaskState.CANCELLED,
        },
        FanxingTaskState.PENDING: {
            FanxingTaskState.UPLOADING,
            FanxingTaskState.SUBMITTING,
            FanxingTaskState.CANCELLED,
        },
        FanxingTaskState.UPLOADING: {
            FanxingTaskState.SUBMITTING,
            FanxingTaskState.FAILED,
            FanxingTaskState.CANCELLED,
        },
        FanxingTaskState.SUBMITTING: {
            FanxingTaskState.QUEUED,
            FanxingTaskState.PROCESSING,
            FanxingTaskState.FAILED,
            FanxingTaskState.CANCELLED,
        },
        FanxingTaskState.QUEUED: {
            FanxingTaskState.PROCESSING,
            FanxingTaskState.FAILED,
            FanxingTaskState.TIMEOUT,
            FanxingTaskState.CANCELLED,
        },
        FanxingTaskState.PROCESSING: {
            FanxingTaskState.DOWNLOADING,
            FanxingTaskState.COMPLETED,
            FanxingTaskState.FAILED,
            FanxingTaskState.CANCELLED,
        },
        FanxingTaskState.DOWNLOADING: {
            FanxingTaskState.COMPLETED,
            FanxingTaskState.FAILED,
        },
        FanxingTaskState.COMPLETED: set(),
        FanxingTaskState.FAILED: set(),
        FanxingTaskState.CANCELLED: set(),
        FanxingTaskState.TIMEOUT: set(),
    }

    def __init__(self, strict: bool = False):
        self._strict = bool(strict)
        self._invalid_transitions = 0

    def validate(self, from_state: FanxingTaskState, to_state: FanxingTaskState) -> bool:
        if from_state == to_state:
            return True
        valid_next = self.VALID_TRANSITIONS.get(from_state, set())
        if to_state in valid_next:
            return True
        self._invalid_transitions += 1
        logger.warning(
            "[StateValidator] 非法状态转换: %s -> %s, 有效转换=%s",
            from_state.name,
            to_state.name,
            [state.name for state in valid_next],
        )
        if self._strict:
            raise ValueError(f"非法状态转换: {from_state.name} -> {to_state.name}")
        return False

    def get_stats(self) -> Dict[str, object]:
        return {
            "invalid_transitions": self._invalid_transitions,
            "strict_mode": self._strict,
        }


_validator_instance: StateTransitionValidator | None = None


def get_state_validator() -> StateTransitionValidator:
    global _validator_instance
    config = get_enhancement_config()
    strict = bool(config.state_validation_strict)
    if _validator_instance is None or _validator_instance.get_stats().get("strict_mode") != strict:
        _validator_instance = StateTransitionValidator(strict=strict)
    return _validator_instance
