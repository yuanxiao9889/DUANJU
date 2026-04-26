# 网格吸附功能实现计划

## 目标

为画布添加网格吸附功能，使节点拖动时自动对齐到网格。

## 当前实现分析

### 关键文件
- **画布组件**: `src/features/canvas/Canvas.tsx`
- **画布 Store**: `src/stores/canvasStore.ts`
- **React Flow 配置**: 画布使用 `@xyflow/react` 库

### React Flow 网格吸附支持
React Flow 已内置网格吸附功能，通过以下属性配置：
```tsx
<ReactFlow
  snapToGrid={true}        // 启用网格吸附
  snapGrid={[20, 20]}      // 网格大小 [x, y]
/>
```

## 实现步骤

### 步骤 1: 添加网格设置到 Store

**文件**: `src/stores/canvasStore.ts`

**新增状态**:
```typescript
interface CanvasState {
  // ... 现有状态
  
  // 网格设置
  snapToGrid: boolean;      // 是否启用网格吸附
  snapGridSize: number;     // 网格大小（正方形网格）
  showGrid: boolean;        // 是否显示网格背景
  
  // 设置方法
  setSnapToGrid: (enabled: boolean) => void;
  setSnapGridSize: (size: number) => void;
  setShowGrid: (show: boolean) => void;
}
```

**默认值**:
```typescript
snapToGrid: true,
snapGridSize: 20,
showGrid: true,
```

### 步骤 2: 在 Canvas 组件中应用网格设置

**文件**: `src/features/canvas/Canvas.tsx`

**修改 ReactFlow 组件**:
```tsx
<ReactFlow
  // ... 现有属性
  snapToGrid={snapToGrid}
  snapGrid={[snapGridSize, snapGridSize]}
/>
```

### 步骤 3: 添加网格背景显示（可选）

**文件**: `src/features/canvas/Canvas.tsx`

**添加网格背景组件**:
```tsx
{showGrid && (
  <div 
    className="absolute inset-0 pointer-events-none"
    style={{
      backgroundImage: `
        linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
      `,
      backgroundSize: `${snapGridSize}px ${snapGridSize}px`,
    }}
  />
)}
```

### 步骤 4: 添加网格设置 UI

**文件**: `src/features/canvas/CanvasToolbar.tsx` 或设置面板

**添加控制按钮**:
```tsx
<div className="flex items-center gap-2">
  {/* 网格吸附开关 */}
  <button
    onClick={() => setSnapToGrid(!snapToGrid)}
    className={`p-2 rounded ${snapToGrid ? 'bg-accent text-white' : 'bg-bg-dark text-text-muted'}`}
    title={snapToGrid ? '关闭网格吸附' : '开启网格吸附'}
  >
    <Grid3x3 className="w-4 h-4" />
  </button>
  
  {/* 网格大小选择 */}
  <select
    value={snapGridSize}
    onChange={(e) => setSnapGridSize(Number(e.target.value))}
    className="h-8 px-2 rounded bg-bg-dark text-text-dark text-sm"
  >
    <option value={10}>10px</option>
    <option value={20}>20px</option>
    <option value={50}>50px</option>
    <option value={100}>100px</option>
  </select>
</div>
```

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `canvasStore.ts` | 修改 | 添加网格设置状态和方法 |
| `Canvas.tsx` | 修改 | 应用网格设置到 ReactFlow |
| `CanvasToolbar.tsx` | 修改 | 添加网格控制 UI |

## UI 设计

### 工具栏网格控制
```
[网格图标] [20px ▼]
```

### 网格背景效果
- 淡色网格线（rgba(255,255,255,0.05)）
- 不干扰节点操作（pointer-events-none）

## 验收标准

1. ✅ 节点拖动时自动吸附到网格
2. ✅ 可以开启/关闭网格吸附
3. ✅ 可以调整网格大小（10/20/50/100px）
4. ✅ 网格背景可见但不干扰操作
5. ✅ 设置持久化（可选）
