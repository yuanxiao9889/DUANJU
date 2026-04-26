# 视频节点问题修复计划

## 问题概述

1. **视频画面超出节点圆角区域**：视频画面没有遵循节点的圆角边界
2. **滑块拖动仍然不好用**：拖动滑块时仍然会触发画布移动

## 问题分析

### 问题1：视频超出圆角
当前视频容器没有圆角，导致视频画面超出节点的圆角区域：
```tsx
<div className={`h-full w-full overflow-hidden ${flashFrame ? 'animate-pulse bg-white/20' : ''}`}>
  <video className="h-full w-full object-cover bg-black" ... />
</div>
```

### 问题2：滑块拖动问题
滑块上的 `onPointerDown` 没有调用 `setPointerCapture`，导致事件仍然可能被画布拦截：
```tsx
<div
  className="absolute top-1/2 w-4 h-4 ..."
  onPointerDown={(e) => {
    e.stopPropagation();
    setIsDraggingProgress(true);  // 缺少 setPointerCapture
  }}
/>
```

## 解决方案

### 修复1：添加圆角
在视频容器上添加 `rounded-[var(--node-radius)]` 圆角：
```tsx
<div className={`h-full w-full overflow-hidden rounded-[var(--node-radius)] ${flashFrame ? '...' : ''}`}>
  <video ... />
</div>
```

### 修复2：滑块添加 setPointerCapture
在滑块的 `onPointerDown` 中也调用 `setPointerCapture`：
```tsx
<div
  className="absolute top-1/2 w-4 h-4 ..."
  onPointerDown={(e) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingProgress(true);
  }}
/>
```

## 文件变更

| 文件 | 操作 |
|------|------|
| `src/features/canvas/nodes/VideoNode.tsx` | 修改 |

## 实现步骤

1. 在视频容器添加 `rounded-[var(--node-radius)]` 圆角
2. 在滑块的 `onPointerDown` 中添加 `setPointerCapture`
3. 运行类型检查验证
