# 视频逐帧播放功能实现计划

## 需求概述

为视频播放器增加逐帧播放功能：
1. **触发条件**：视频处于暂停状态时启用
2. **控制方式**：键盘方向键（←上一帧，→下一帧）+ 界面按钮
3. **精度要求**：达到视频实际帧率（24-30帧/秒）
4. **响应时间**：小于100ms
5. **状态保持**：逐帧操作时保持暂停状态

## 技术方案

### 帧时间计算

视频帧率通常为 24-30 fps：
- 24 fps → 约 41.67ms/帧 (1/24 ≈ 0.0417秒)
- 30 fps → 约 33.33ms/帧 (1/30 ≈ 0.0333秒)

默认使用 24fps 作为基准帧率。

### 实现细节

**文件**: `src/features/canvas/nodes/VideoNode.tsx`

#### 1. 新增常量

```typescript
const DEFAULT_FRAME_RATE = 24;
const FRAME_TIME = 1 / DEFAULT_FRAME_RATE;
```

#### 2. 逐帧控制函数

```typescript
const seekToPrevFrame = useCallback(() => {
  if (!videoRef.current || isPlaying) return;
  const newTime = Math.max(0, videoRef.current.currentTime - FRAME_TIME);
  videoRef.current.currentTime = newTime;
  setCurrentTime(newTime);
}, [isPlaying]);

const seekToNextFrame = useCallback(() => {
  if (!videoRef.current || isPlaying) return;
  const newTime = Math.min(duration, videoRef.current.currentTime + FRAME_TIME);
  videoRef.current.currentTime = newTime;
  setCurrentTime(newTime);
}, [isPlaying, duration]);
```

#### 3. 键盘事件处理

扩展现有 `handleKeyDown`，增加方向键支持：

```typescript
if (e.key === 'ArrowLeft') {
  e.preventDefault();
  seekToPrevFrame();
} else if (e.key === 'ArrowRight') {
  e.preventDefault();
  seekToNextFrame();
}
```

#### 4. UI 按钮设计

在播放按钮两侧添加逐帧按钮：
```
[◀◀] [▶/⏸] [▶▶]
上一帧  播放  下一帧
```

按钮样式与现有播放按钮保持一致。

### i18n 翻译

新增翻译 key：
- `node.videoNode.prevFrame` - 上一帧 / Previous Frame
- `node.videoNode.nextFrame` - 下一帧 / Next Frame
- `node.videoNode.frameByFrameHint` - 暂停时可使用方向键逐帧 / Use arrow keys for frame-by-frame when paused

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/features/canvas/nodes/VideoNode.tsx` | 修改 |
| `src/i18n/locales/zh.json` | 修改 |
| `src/i18n/locales/en.json` | 修改 |

## UI 设计

```
┌─────────────────────────────────────────────────────┐
│ [◀◀] [▶] [▶▶] ━━━━●━━━━━━━━━━━━━━  00:12 / 02:30  │
│  ↑    ↑    ↑                                        │
│ 上一帧 播放 下一帧                                   │
├─────────────────────────────────────────────────────┤
│ 暂停时可使用方向键逐帧              [📷 截图]       │
└─────────────────────────────────────────────────────┘
```

## 实现步骤

1. 添加逐帧控制函数（seekToPrevFrame、seekToNextFrame）
2. 扩展键盘事件处理，支持方向键
3. 添加 UI 按钮（使用 ChevronLeft/ChevronRight 图标）
4. 更新 i18n 翻译
5. 运行类型检查验证

## 注意事项

1. 仅在暂停时生效（`!isPlaying`）
2. 边界处理：上一帧 ≥ 0，下一帧 ≤ duration
3. 键盘事件只在节点选中时响应
4. 直接操作 `video.currentTime` 满足 <100ms 响应要求
