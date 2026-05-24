# -*- coding: utf-8 -*-
"""繁星参考图上传缓存模块

缓存已上传图片的 URL，避免重复上传相同图片。
"""

import hashlib
import logging
import threading
import time
import weakref
import atexit
from typing import Dict, Optional


class FanxingImageCache:
    """繁星参考图上传缓存

    缓存已上传图片的 URL，避免重复上传相同图片。

    特性：
    - 使用图片内容的 MD5 哈希作为缓存键
    - 1 小时过期时间（避免服务器 URL 被回收后污染）
    - 最大缓存 100 条记录（内存保护）
    - 线程安全
    """

    EXPIRE_SECONDS = 1 * 60 * 60  # 1 小时（缩短以避免服务器 URL 被回收后污染）
    MAX_CACHE_SIZE = 100  # 最大缓存条目数
    MAX_CACHE_BYTES = 50 * 1024 * 1024  # 50MB 近似内存阈值
    CLEANUP_INTERVAL_SECONDS = 60.0

    def __init__(self):
        self._cache: Dict[str, dict] = {}  # {hash: {"url": str, "upload_time": float}}
        self._lock = threading.Lock()
        self._approx_bytes = 0
        self._last_cleanup_time = 0.0
        self._cleanup_stop_event = threading.Event()
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop,
            name="FanxingImageCacheCleanup",
            daemon=True,
        )
        self._cleanup_thread.start()
        atexit.register(self.stop)
        weakref.finalize(self, self.stop)

    def _compute_hash(self, image_data: bytes) -> str:
        """计算图片内容的 MD5 哈希"""
        return hashlib.md5(image_data).hexdigest()

    def _is_expired(self, upload_time: float) -> bool:
        """检查缓存是否已过期"""
        return time.time() - upload_time > self.EXPIRE_SECONDS

    def _cleanup_expired(self):
        """清理过期的缓存条目（需要在锁内调用）"""
        current_time = time.time()
        expired_keys = [
            key
            for key, value in self._cache.items()
            if current_time - value["upload_time"] > self.EXPIRE_SECONDS
        ]
        for key in expired_keys:
            entry = self._cache.pop(key, None)
            if entry:
                self._approx_bytes = max(
                    0, self._approx_bytes - int(entry.get("size_bytes", 0) or 0)
                )

    def _cleanup_oldest(self):
        """清理最旧的缓存条目以满足内存限制（需要在锁内调用）

        当缓存条目数超过 MAX_CACHE_SIZE 时，删除最旧的条目
        """
        should_cleanup = (
            len(self._cache) >= self.MAX_CACHE_SIZE
            or self._approx_bytes > self.MAX_CACHE_BYTES
        )
        if not should_cleanup:
            return

        sorted_items = sorted(self._cache.items(), key=lambda x: x[1]["upload_time"])

        while sorted_items and (
            len(self._cache) >= self.MAX_CACHE_SIZE
            or self._approx_bytes > self.MAX_CACHE_BYTES
        ):
            key, _ = sorted_items.pop(0)
            entry = self._cache.pop(key, None)
            if entry:
                self._approx_bytes = max(
                    0, self._approx_bytes - int(entry.get("size_bytes", 0) or 0)
                )

    def _estimate_entry_size(self, hash_key: str, url: str, image_data: bytes) -> int:
        return (
            len(hash_key.encode("utf-8")) + len(url.encode("utf-8")) + len(image_data)
        )

    def _maybe_periodic_cleanup(self, current_time: Optional[float] = None) -> None:
        now = current_time if current_time is not None else time.time()
        if now - self._last_cleanup_time < self.CLEANUP_INTERVAL_SECONDS:
            return
        self._cleanup_expired()
        self._cleanup_oldest()
        self._last_cleanup_time = now

    def _run_cleanup_cycle(self) -> None:
        with self._lock:
            self._cleanup_expired()
            self._cleanup_oldest()
            self._last_cleanup_time = time.time()

    def _cleanup_loop(self) -> None:
        while not self._cleanup_stop_event.wait(self.CLEANUP_INTERVAL_SECONDS):
            try:
                self._run_cleanup_cycle()
            except Exception as exc:
                logging.debug("[FanxingImageCache] 定时清理异常: %s", exc)

    def stop(self) -> None:
        self._cleanup_stop_event.set()
        cleanup_thread = getattr(self, "_cleanup_thread", None)
        if (
            cleanup_thread
            and cleanup_thread.is_alive()
            and cleanup_thread is not threading.current_thread()
        ):
            cleanup_thread.join(timeout=1.0)

    def get(self, image_data: bytes) -> Optional[str]:
        """获取缓存的图片 URL

        Args:
            image_data: 图片二进制数据

        Returns:
            缓存的 URL，如果未命中或已过期则返回 None
        """
        hash_key = self._compute_hash(image_data)

        with self._lock:
            self._maybe_periodic_cleanup()
            if hash_key not in self._cache:
                return None

            entry = self._cache[hash_key]
            if self._is_expired(entry["upload_time"]):
                # 已过期，删除缓存
                removed_entry = self._cache.pop(hash_key, None)
                if removed_entry:
                    self._approx_bytes = max(
                        0,
                        self._approx_bytes
                        - int(removed_entry.get("size_bytes", 0) or 0),
                    )
                return None

            return entry["url"]

    def set(self, image_data: bytes, url: str):
        """缓存图片 URL

        Args:
            image_data: 图片二进制数据
            url: 上传后的图片 URL
        """
        hash_key = self._compute_hash(image_data)
        current_time = time.time()
        entry_size = self._estimate_entry_size(hash_key, url, image_data)

        with self._lock:
            # 先清理过期条目
            self._cleanup_expired()
            self._maybe_periodic_cleanup(current_time)

            previous_entry = self._cache.get(hash_key)
            if previous_entry:
                self._approx_bytes = max(
                    0,
                    self._approx_bytes - int(previous_entry.get("size_bytes", 0) or 0),
                )

            # 添加新条目
            self._cache[hash_key] = {
                "url": url,
                "upload_time": current_time,
                "size_bytes": entry_size,
            }
            self._approx_bytes += entry_size

            # 检查内存限制
            self._cleanup_oldest()
            self._last_cleanup_time = current_time

    def invalidate(self, image_data: bytes):
        """使指定图片的缓存失效（URL 不可用时调用）

        Args:
            image_data: 图片二进制数据
        """
        hash_key = self._compute_hash(image_data)
        with self._lock:
            entry = self._cache.pop(hash_key, None)
            if entry:
                self._approx_bytes = max(
                    0, self._approx_bytes - int(entry.get("size_bytes", 0) or 0)
                )

    def clear(self):
        """清空缓存"""
        with self._lock:
            self._cache.clear()
            self._approx_bytes = 0
            self._last_cleanup_time = time.time()

    def stats(self) -> dict:
        """获取缓存统计信息"""
        with self._lock:
            self._maybe_periodic_cleanup()
            return {
                "size": len(self._cache),
                "max_size": self.MAX_CACHE_SIZE,
                "expire_hours": self.EXPIRE_SECONDS / 3600,
                "approx_bytes": self._approx_bytes,
                "max_bytes": self.MAX_CACHE_BYTES,
            }


def clear_fanxing_image_cache(cache_instance: FanxingImageCache):
    """清空繁星参考图上传缓存

    当用户删除、清空或重排参考图时调用此函数，
    确保下次生成时重新上传参考图，避免使用过期的 URL。

    此函数由 ImageManager 在以下场景调用：
    - remove_image: 删除单张参考图
    - clear_all: 清空所有参考图
    - reorder_image: 调整参考图顺序

    Args:
        cache_instance: 缓存实例
    """
    cache_instance.clear()
    logging.info("[FanxingImageCache] 缓存已清空（用户修改了参考图）")
