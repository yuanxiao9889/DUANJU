# -*- coding: utf-8 -*-
"""Fanxing LLM client for sk-web chat."""

import json
import logging
import time
import threading
from typing import Dict, List

import requests

from data.generation_config import SERVER_ID_FANXING
from managers.auth import ActiveAuthContextResolver
from managers.config_manager import get_active_config_manager
from utils import classify_runtime_issue, get_runtime_issue_message
from workers.channel_protocols import AuthContext, HuanyuApiSysProtocol
from workers.fanxing import _fanxing_batch_poller
from workers.llm.task_errors import coerce_llm_task_error
from .base import BaseLLMClient


class FanxingLLMClient(BaseLLMClient):
    """繁星 LLM 客户端（sk-web Chat）。"""

    def chat(self, messages: List[Dict], **kwargs) -> str:
        model = kwargs.get("model")
        max_tokens = int(kwargs.get("max_tokens", 3000))
        timeout = max(30, int(kwargs.get("timeout", 180)))
        should_cancel = kwargs.get("should_cancel")
        if not model:
            raise ValueError("Fanxing chat requires model")

        prompt = self._build_prompt_from_messages(messages)

        payload = {
            "task_type": "sk-web",
            "input_params": {
                "model": model,
                "prompt": prompt,
                "messages": json.dumps(messages, ensure_ascii=False),
                "max_tokens": max_tokens,
            },
        }
        try:
            message_count = len(messages)
            message_chars = 0
            for item in messages:
                if isinstance(item, dict):
                    content = item.get("content")
                    if isinstance(content, str):
                        message_chars += len(content)
                    elif isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict):
                                text = part.get("text") or part.get("content")
                                if isinstance(text, str):
                                    message_chars += len(text)
                            elif isinstance(part, str):
                                message_chars += len(part)
            payload_preview = {
                "task_type": payload.get("task_type"),
                "model": payload.get("input_params", {}).get("model"),
                "max_tokens": payload.get("input_params", {}).get("max_tokens"),
                "message_count": message_count,
                "message_chars": message_chars,
            }
            logging.debug("[FanxingLLMClient] submit payload=%s", payload_preview)
        except Exception as exc:
            logging.debug("[FanxingLLMClient] payload logging failed: %s", exc)
        protocol = HuanyuApiSysProtocol()
        resolved = ActiveAuthContextResolver(get_active_config_manager()).resolve(
            server_id=SERVER_ID_FANXING,
            base_url=str(self.base_url or "").strip(),
            bearer_token=str(self.api_key or "").strip(),
            visible_only=False,
        )
        auth = AuthContext(
            base_url=resolved.normalized_base_url,
            bearer_token=resolved.normalized_bearer_token,
            tenant_id=resolved.normalized_tenant_id,
            auth_mode=resolved.normalized_auth_mode,
            use_host_tenant=False,
        )
        headers = protocol.build_headers(auth, include_json_content_type=True)
        submit_url = protocol.build_task_routes(auth).create
        logging.debug("[Fanxing] submit url=%s", submit_url)
        response = requests.post(submit_url, json=payload, headers=headers, timeout=60)
        if response.status_code != 200:
            raise RuntimeError(f"Fanxing 请求失败: HTTP {response.status_code}")
        data = response.json()
        if not data.get("success"):
            raise RuntimeError(f"Fanxing 返回失败: {data.get('msg', '未知错误')}")
        content = self._extract_sync_content(data)
        if content:
            return content

        task_uuid = str((data.get("data") or {}).get("task_uuid") or "").strip()
        if not task_uuid:
            try:
                payload_preview = json.dumps(data, ensure_ascii=False)
                if len(payload_preview) > 2000:
                    payload_preview = payload_preview[:2000] + "..."
                logging.debug("[FanxingLLMClient] no content/task_uuid response=%s", payload_preview)
            except Exception as exc:
                logging.debug("[FanxingLLMClient] response logging failed: %s", exc)
            raise RuntimeError("Fanxing 未返回可解析内容或 task_uuid")

        content = self._poll_task_content_via_batch_poller(
            protocol=protocol,
            auth=auth,
            headers=headers,
            task_uuid=task_uuid,
            timeout=timeout,
            should_cancel=should_cancel,
        )
        try:
            usage = (data.get("data") or {}).get("usage") if isinstance(data.get("data"), dict) else None
            logging.debug(
                "[FanxingLLMClient] response meta model=%s task_uuid=%s usage=%s content_len=%s",
                str(model),
                str(task_uuid or ""),
                usage,
                len(str(content or "")),
            )
        except Exception as exc:
            logging.debug("[FanxingLLMClient] response meta logging failed: %s", exc)

        return content

    def complete(self, prompt: str, **kwargs) -> str:
        raise NotImplementedError("Fanxing 仅实现 chat")

    @staticmethod
    def _build_prompt_from_messages(messages: List[Dict]) -> str:
        parts: List[str] = []
        for message in list(messages or []):
            if not isinstance(message, dict):
                continue
            role = str(message.get("role") or "user").strip()
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                parts.append(f"{role}: {content.strip()}")
                continue
            if isinstance(content, list):
                text_parts = []
                for item in content:
                    if isinstance(item, dict):
                        if str(item.get("type") or "").strip() == "text":
                            text = str(item.get("text") or item.get("content") or "").strip()
                            if text:
                                text_parts.append(text)
                    elif isinstance(item, str) and item.strip():
                        text_parts.append(item.strip())
                if text_parts:
                    parts.append(f"{role}: {' '.join(text_parts)}")
        prompt = "\n".join(parts).strip()
        return prompt or "请根据消息内容给出简洁准确的回复。"

    @staticmethod
    def _extract_sync_content(payload: dict) -> str:
        choices = (payload.get("data") or {}).get("choices", [])
        if not isinstance(choices, list) or not choices:
            return ""
        choice0 = choices[0] if isinstance(choices[0], dict) else {}
        msg0 = choice0.get("message") if isinstance(choice0.get("message"), dict) else {}
        return str(msg0.get("content") or "").strip()

    def _poll_task_content(
        self,
        *,
        protocol: HuanyuApiSysProtocol,
        auth: AuthContext,
        headers: dict,
        task_uuid: str,
        timeout: int,
    ) -> str:
        query_url = protocol.build_task_query_url(auth, task_uuid)
        deadline = time.time() + max(1, int(timeout or 1))
        while time.time() < deadline:
            response = requests.get(query_url, headers=headers, timeout=30)
            if response.status_code != 200:
                raise RuntimeError(f"Fanxing 查询失败: HTTP {response.status_code}")
            data = response.json()
            if not data.get("success"):
                raise RuntimeError(f"Fanxing 查询返回失败: {data.get('msg', '未知错误')}")
            task = data.get("data") or {}
            status = str(task.get("status") or "").strip().lower()
            if status in {"failed", "failure", "cancelled", "canceled", "aborted"}:
                raw_error = str(task.get("error_message") or task.get("msg") or "任务失败")
                logging.warning(
                    "[FanxingLLMClient] task_failed task_uuid=%s diagnostic=%s reason=%s",
                    task_uuid,
                    classify_runtime_issue(raw_error) or "generic_failure",
                    raw_error,
                )
                raise RuntimeError(get_runtime_issue_message(raw_error))
            content = self._extract_task_content(task)
            if content:
                return content
            if status in {"completed", "succeeded", "success"}:
                logging.warning(
                    "[FanxingLLMClient] completed_without_results task_uuid=%s status=%s task=%s",
                    task_uuid,
                    status,
                    task,
                )
                break
            time.sleep(2)
        raise RuntimeError("Fanxing 聊天任务未返回可解析文本")

    def _poll_task_content_via_batch_poller(
        self,
        *,
        protocol: HuanyuApiSysProtocol,
        auth: AuthContext,
        headers: dict,
        task_uuid: str,
        timeout: int,
        should_cancel=None,
    ) -> str:
        del protocol
        result_event = threading.Event()
        result_container = {"success": None, "data": None}

        def _on_task_complete(uuid: str, success: bool, result_or_error):
            result_container["success"] = success
            result_container["data"] = result_or_error
            result_event.set()

        _fanxing_batch_poller.register_task(
            task_uuid=str(task_uuid or "").strip(),
            base_url=str(
                getattr(auth, "normalized_base_url", "") or auth.base_url or ""
            ).strip(),
            headers=dict(headers or {}),
            callback=_on_task_complete,
            timeout=max(1, int(timeout or 1)),
            task_index=0,
            capability="fanxing_llm_short",
            generation_id=f"fanxing_llm::{str(task_uuid or '').strip()}",
            task_type="fanxing_llm_short",
        )

        while not result_event.is_set():
            if callable(should_cancel) and should_cancel():
                _fanxing_batch_poller.unregister_task(str(task_uuid or "").strip())
                raise RuntimeError("chain_task_canceled")
            result_event.wait(0.1)

        if not result_container["success"]:
            raise RuntimeError(
                str(result_container["data"] or "Fanxing 聊天任务失败")
            )

        task = result_container["data"] or {}
        if not isinstance(task, dict):
            raise RuntimeError("Fanxing 聊天任务返回结构错误")

        status = str(task.get("status") or "").strip().lower()
        content = self._extract_task_content(task)
        if content:
            return content
        if status in {"completed", "succeeded", "success"}:
            logging.warning(
                "[FanxingLLMClient] completed_without_results task_uuid=%s status=%s task=%s",
                task_uuid,
                status,
                task,
            )
        raise RuntimeError("Fanxing 聊天任务未返回可解析文本")

    @staticmethod
    def _extract_task_content(task: dict) -> str:
        if not isinstance(task, dict):
            return ""
        candidates = []
        for key in ("content", "text", "output_text", "answer", "result_text"):
            value = str(task.get(key) or "").strip()
            if value:
                candidates.append(value)
        result = task.get("result")
        if isinstance(result, dict):
            for key in ("content", "text", "output_text", "answer", "result_text"):
                value = str(result.get(key) or "").strip()
                if value:
                    candidates.append(value)
            choices = result.get("choices")
            if isinstance(choices, list) and choices:
                choice0 = choices[0] if isinstance(choices[0], dict) else {}
                msg0 = choice0.get("message") if isinstance(choice0.get("message"), dict) else {}
                value = str(msg0.get("content") or "").strip()
                if value:
                    candidates.append(value)
        output_list = task.get("output_list")
        if isinstance(output_list, dict):
            for key in ("content", "text", "output_text", "answer", "result_text"):
                value = str(output_list.get(key) or "").strip()
                if value:
                    candidates.append(value)
        for value in candidates:
            if value:
                return value
        return ""
