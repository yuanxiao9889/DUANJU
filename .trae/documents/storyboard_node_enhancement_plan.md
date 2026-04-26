# 切图结果节点功能增强计划

## 目标

为 StoryboardNode（切图结果节点）新增以下功能：
1. 删除和新增格子功能
2. 自动排列宫格布局（支持 4/6/9/12/16 等宫格）
3. 图片数量不足时填充白色占位格
4. 优化图片合并导出功能，支持节点间直接数据传递

## 当前实现分析

### 关键文件
- **节点组件**: `src/features/canvas/nodes/StoryboardNode.tsx`
- **数据类型**: `src/features/canvas/domain/canvasNodes.ts`
- **Store 操作**: `src/stores/canvasStore.ts`
- **合并功能**: `src/commands/image.ts` + `src-tauri/src/commands/image.rs`

### 当前数据结构
```typescript
interface StoryboardSplitNodeData {
  gridRows: number;      // 行数
  gridCols: number;      // 列数
  frames: StoryboardFrameItem[];  // 帧数组
  exportOptions?: StoryboardExportOptions;
}

interface StoryboardFrameItem {
  id: string;
  imageUrl: string | null;  // null 表示空白格
  note: string;
  order: number;
}
```

## 实现步骤

### 步骤 1: 添加格子增删功能到 canvasStore

**文件**: `src/stores/canvasStore.ts`

**新增方法**:
```typescript
// 添加空白格
addStoryboardFrame: (nodeId: string) => void;

// 删除指定格
removeStoryboardFrame: (nodeId: string, frameId: string) => void;

// 更新宫格布局
updateStoryboardGridLayout: (nodeId: string, rows: number, cols: number) => void;

// 填充空白格
fillStoryboardEmptyFrames: (nodeId: string) => void;
```

### 步骤 2: 实现自动宫格布局计算

**逻辑**:
- 当格子数量变化时，自动计算最佳的行列布局
- 支持的布局：1x1, 1x2, 2x2, 2x3, 3x3, 3x4, 4x4 等
- 布局优先级：尽量接近正方形

```typescript
function calculateGridLayout(frameCount: number): { rows: number; cols: number } {
  if (frameCount <= 1) return { rows: 1, cols: 1 };
  if (frameCount <= 2) return { rows: 1, cols: 2 };
  if (frameCount <= 4) return { rows: 2, cols: 2 };
  if (frameCount <= 6) return { rows: 2, cols: 3 };
  if (frameCount <= 9) return { rows: 3, cols: 3 };
  if (frameCount <= 12) return { rows: 3, cols: 4 };
  return { rows: Math.ceil(Math.sqrt(frameCount)), cols: Math.ceil(frameCount / Math.ceil(Math.sqrt(frameCount))) };
}
```

### 步骤 3: 添加 UI 控制按钮

**文件**: `src/features/canvas/nodes/StoryboardNode.tsx`

**新增 UI 元素**:
1. **添加格子按钮**: 在节点头部或底部添加 "+" 按钮
2. **删除格子按钮**: 在每个格子上添加删除图标（悬停显示）
3. **填充空白按钮**: 自动填充空白格到当前宫格满
4. **布局选择器**: 可选，让用户手动选择布局

### 步骤 4: 实现空白格显示和填充

**修改 FrameCard 组件**:
- 当 `imageUrl === null` 时显示白色占位背景
- 添加 "+" 图标提示用户可以填充图片
- **支持用户手动填充**: 点击空白格可上传图片或从剪贴板粘贴
- **支持拖放图片到空白格**: 用户可拖拽图片文件到空白格填充
- **支持从画布其他节点拖入**: 用户可从上传节点等拖拽图片连接到空白格
- **支持添加纯白色占位格**: 用户可主动添加纯白色格子作为占位，合并输出时该格子显示为纯白色区域

### 步骤 5: 优化图片合并导出功能

**当前流程**:
```
合并图片 → 导出文件 → 用户重新导入画布
```

**优化后流程**:
```
合并图片 → 创建新节点（ExportImageNode）并传递图片数据
```

**实现方式**:
1. 在 StoryboardNode 中添加"合并为新节点"按钮
2. 调用 `mergeStoryboardImages` 获取合并后的图片数据
3. 使用 `addNode` 创建新的 ExportImageNode 或 ImageEditNode
4. 将合并后的图片 URL 传递给新节点

### 步骤 6: 添加节点间数据传递支持

**文件**: `src/stores/canvasStore.ts`

**新增方法**:
```typescript
// 从分镜节点创建合并图片节点
createMergedImageNode: (sourceNodeId: string) => Promise<string>;
```

**实现逻辑**:
1. 获取源节点的帧数据和导出选项
2. 调用 `mergeStoryboardImages` 合并图片
3. 创建新的 ExportImageNode 或 ImageEditNode
4. 设置新节点的图片数据
5. 可选：自动连接源节点和新节点

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `canvasStore.ts` | 修改 | 添加格子增删、布局更新、合并节点创建方法 |
| `StoryboardNode.tsx` | 修改 | 添加增删按钮、空白格显示、合并节点按钮 |
| `canvasNodes.ts` | 可能修改 | 如需扩展数据结构 |
| `image.ts` | 无需修改 | 复用现有合并功能 |

## UI 设计

### 节点头部控制区
```
[分镜结果]  [+添加] [填充空白] [合并导出]
```

### 格子操作（悬停显示）
```
┌─────────────┐
│   [删除]    │
│             │
│   [图片]    │
│             │
│   [备注]    │
└─────────────┘
```

### 空白格显示
```
┌─────────────┐
│             │
│     +       │  ← 白色背景 + 加号提示
│             │
│             │
└─────────────┘
```

## 验收标准

1. ✅ 可以添加新格子到分镜节点
2. ✅ 可以删除指定格子
3. ✅ 删增后自动调整宫格布局
4. ✅ 空白格显示白色占位
5. ✅ 可以手动填充空白格（上传图片/粘贴/拖放）
6. ✅ 可以一键填充所有空白格
7. ✅ **用户可主动添加纯白色占位格**，合并输出时该格子为纯白色
8. ✅ 合并图片可直接创建新节点
9. ✅ 新节点自动获取合并后的图片数据
