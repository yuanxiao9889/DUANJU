# 多节点框选批量连线功能实现计划

## 功能概述

实现画布上的多节点框选和批量连线功能，允许用户框选多个节点后，从选定区域整体拉出分支连线，进行批处理或多对一引用操作。

## 交互流程

1. **多节点框选** - 用户拖动创建矩形选择框，选中多个节点
2. **显示合并锚点** - 框选完成后显示合并连接锚点
3. **拖拽分支连线** - 从合并锚点拖出分支连线
4. **释放触发菜单** - 在释放点弹出上下文菜单
5. **执行操作** - 选择操作后生成新节点并连接

## 当前实现分析

### 关键文件
- **画布组件**: `src/features/canvas/Canvas.tsx`
- **画布 Store**: `src/stores/canvasStore.ts`
- **边类型**: `src/features/canvas/edges/`
- **节点菜单**: `src/features/canvas/NodeSelectionMenu.tsx`

### React Flow 相关功能
- React Flow 已内置框选功能 (`selectionOnDrag`)
- 需要自定义边类型来渲染分支连线
- 需要自定义连接逻辑

## 实现步骤

### 步骤 1: 扩展画布 Store 支持多选状态

**文件**: `src/stores/canvasStore.ts`

**新增状态**:
```typescript
interface MultiSelectionState {
  selectedNodeIds: string[];
  mergedAnchorPosition: { x: number; y: number } | null;
  isDraggingFromMergedAnchor: boolean;
  branchConnectionStart: { sourceNodeIds: string[]; startPosition: { x: number; y: number } } | null;
}

// 新增方法
setMultiSelection: (nodeIds: string[]) => void;
setMergedAnchorPosition: (position: { x: number; y: number } | null) => void;
startBranchConnection: (sourceNodeIds: string[], startPosition: { x: number; y: number }) => void;
endBranchConnection: () => void;
```

### 步骤 2: 创建合并锚点组件

**文件**: `src/features/canvas/ui/MergedConnectionAnchor.tsx`

```typescript
interface MergedConnectionAnchorProps {
  position: { x: number; y: number };
  nodeCount: number;
  onDragStart: (e: React.MouseEvent) => void;
  onDrag: (e: React.MouseEvent) => void;
  onDragEnd: (e: React.MouseEvent) => void;
}

export function MergedConnectionAnchor({ 
  position, 
  nodeCount, 
  onDragStart, 
  onDrag, 
  onDragEnd 
}: MergedConnectionAnchorProps) {
  // 渲染蓝色圆圈加号锚点
  // 显示选中节点数量
  // 处理拖拽事件
}
```

### 步骤 3: 创建分支连线组件

**文件**: `src/features/canvas/edges/BranchEdge.tsx`

```typescript
interface BranchEdgeProps {
  sourceNodeIds: string[];
  targetNodeId: string;
  sourcePositions: { x: number; y: number }[];
  targetPosition: { x: number; y: number };
}

export function BranchEdge({ 
  sourceNodeIds, 
  targetNodeId, 
  sourcePositions, 
  targetPosition 
}: BranchEdgeProps) {
  // 渲染多条从源节点到目标节点的连线
  // 在中间点汇聚成一条主线
  // 使用贝塞尔曲线或直线
}
```

### 步骤 4: 创建拖拽预览连线组件

**文件**: `src/features/canvas/ui/BranchConnectionPreview.tsx`

```typescript
interface BranchConnectionPreviewProps {
  sourceNodeIds: string[];
  sourcePositions: { x: number; y: number }[];
  currentPosition: { x: number; y: number };
  viewport: { x: number; y: number; zoom: number };
}

export function BranchConnectionPreview({ 
  sourceNodeIds, 
  sourcePositions, 
  currentPosition,
  viewport 
}: BranchConnectionPreviewProps) {
  // 渲染拖拽过程中的预览连线
  // 从每个源节点到当前位置的分支线
}
```

### 步骤 5: 创建批量操作上下文菜单

**文件**: `src/features/canvas/ui/BatchOperationMenu.tsx`

```typescript
interface BatchOperationMenuProps {
  position: { x: number; y: number };
  sourceNodeIds: string[];
  sourceNodeType: string;
  onSelectOperation: (operation: string) => void;
  onClose: () => void;
}

export function BatchOperationMenu({ 
  position, 
  sourceNodeIds, 
  sourceNodeType,
  onSelectOperation, 
  onClose 
}: BatchOperationMenuProps) {
  // 显示可选操作列表
  // 根据源节点类型显示不同选项
  // 例如：文本生成、图片生成、视频生成
}
```

### 步骤 6: 在 Canvas 中集成功能

**文件**: `src/features/canvas/Canvas.tsx`

**修改内容**:

1. **监听选择变化**:
```typescript
const selectedNodes = nodes.filter(n => n.selected);
const multiSelectionActive = selectedNodes.length > 1;
```

2. **计算合并锚点位置**:
```typescript
const mergedAnchorPosition = useMemo(() => {
  if (selectedNodes.length < 2) return null;
  
  // 计算选中节点的边界框
  const bounds = calculateNodesBounds(selectedNodes);
  
  // 返回右侧中点位置
  return {
    x: bounds.right + 20,
    y: bounds.centerY
  };
}, [selectedNodes]);
```

3. **处理拖拽连线**:
```typescript
const handleMergedAnchorDragStart = useCallback((e: React.MouseEvent) => {
  // 开始拖拽分支连线
  const sourceIds = selectedNodes.map(n => n.id);
  startBranchConnection(sourceIds, mergedAnchorPosition);
}, [selectedNodes, mergedAnchorPosition]);

const handleMergedAnchorDrag = useCallback((e: React.MouseEvent) => {
  // 更新预览连线位置
  updateConnectionPreview({ x: e.clientX, y: e.clientY });
}, []);

const handleMergedAnchorDragEnd = useCallback((e: React.MouseEvent) => {
  // 结束拖拽，显示菜单
  showBatchOperationMenu({ x: e.clientX, y: e.clientY });
}, []);
```

4. **执行批量操作**:
```typescript
const handleBatchOperation = useCallback((operation: string) => {
  // 创建新节点
  const newNode = createNodeForOperation(operation, menuPosition);
  
  // 创建分支连线
  const newEdges = sourceNodeIds.map(sourceId => ({
    id: `edge-${sourceId}-${newNode.id}`,
    source: sourceId,
    target: newNode.id,
    type: 'branchEdge'
  }));
  
  // 更新画布
  addNode(newNode);
  addEdges(newEdges);
}, []);
```

### 步骤 7: 实现节点边界计算

**文件**: `src/features/canvas/application/nodeBounds.ts`

```typescript
interface NodeBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export function calculateNodesBounds(nodes: Node[]): NodeBounds {
  if (nodes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const width = node.width ?? 200;
    const height = node.height ?? 100;
    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + width);
    minY = Math.min(minY, node.position.y);
    maxY = Math.max(maxY, node.position.y + height);
  }

  return {
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY
  };
}
```

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `canvasStore.ts` | 修改 | 添加多选状态和方法 |
| `MergedConnectionAnchor.tsx` | 新建 | 合并锚点组件 |
| `BranchEdge.tsx` | 新建 | 分支连线边组件 |
| `BranchConnectionPreview.tsx` | 新建 | 拖拽预览连线组件 |
| `BatchOperationMenu.tsx` | 新建 | 批量操作菜单组件 |
| `nodeBounds.ts` | 新建 | 节点边界计算工具 |
| `Canvas.tsx` | 修改 | 集成所有功能 |

## UI 设计

### 选择框样式
```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│                 │  <- 虚线矩形框
│   [节点A] [节点B]│
│                 │
└ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

### 合并锚点样式
```
┌──────────┐
│ [节点A]  │
│ [节点B]  │ ⊕  <- 蓝色圆圈加号锚点
└──────────┘
```

### 分支连线样式
```
[节点A] ─────┐
             │
[节点B] ─────┼──── [目标节点]
             │
[节点C] ─────┘
```

### 上下文菜单样式
```
┌─────────────────────────┐
│ 引用选中的3个图片节点生成 │
├─────────────────────────┤
│ 📝 文本生成              │
│ 🖼️ 图片生成              │
│ 🎬 视频生成              │
└─────────────────────────┘
```

## 验收标准

1. ✅ 用户可以框选多个节点
2. ✅ 框选后显示合并锚点
3. ✅ 可以从合并锚点拖出分支连线
4. ✅ 拖拽过程中显示预览连线
5. ✅ 释放时显示上下文菜单
6. ✅ 菜单显示正确的操作选项
7. ✅ 选择操作后创建新节点
8. ✅ 新节点与所有源节点正确连接
9. ✅ 分支连线有正确的视觉样式
