# 多节点框选批量连线菜单优化计划

## 问题描述

当前多节点框选批量连线功能弹出的菜单与单选弹出的菜单不一致：
- 当前菜单硬编码了"文本生成"、"图片生成"、"视频生成"选项
- 应该复用单选菜单的选项（AI生图、分镜生成等）
- 选择节点后应该自动连接相关的节点

## 目标

1. 复用 `NodeSelectionMenu` 组件的菜单逻辑
2. 显示与单选菜单相同的选项（AI生图、分镜生成等）
3. 选择节点类型后自动创建节点并连接所有选中的源节点

## 当前实现分析

### NodeSelectionMenu 组件
- 使用 `nodeCatalog.getMenuDefinitions()` 获取菜单项
- 支持 `allowedTypes` 过滤可选节点类型
- 支持特殊操作（创建分支、创建补充）

### BatchOperationMenu 组件（需要修改）
- 当前硬编码了操作选项
- 没有使用 `nodeCatalog`

## 实现步骤

### 步骤 1: 修改 BatchOperationMenu 组件

**文件**: `src/features/canvas/ui/BatchOperationMenu.tsx`

**修改内容**:
1. 使用 `nodeCatalog` 获取菜单定义
2. 复用 `NodeSelectionMenu` 的图标映射和样式
3. 修改回调函数签名，返回节点类型而非操作字符串

```typescript
interface BatchOperationMenuProps {
  position: { x: number; y: number };
  sourceNodeIds: string[];
  sourceNodeType: string;
  onSelectNodeType: (nodeType: CanvasNodeType) => void;
  onClose: () => void;
}
```

### 步骤 2: 更新 Canvas.tsx 中的调用

**文件**: `src/features/canvas/Canvas.tsx`

**修改内容**:
1. 修改 `handleBatchOperationSelect` 为 `handleBatchNodeTypeSelect`
2. 接收节点类型参数而非操作字符串
3. 创建节点后自动创建到所有源节点的连线

```typescript
const handleBatchNodeTypeSelect = useCallback((nodeType: CanvasNodeType) => {
  if (branchConnectionSource.length === 0) return;

  const bounds = calculateNodesBounds(branchConnectionSource);
  const newNodePosition = {
    x: bounds.right + 100,
    y: bounds.centerY,
  };

  // 创建新节点
  const newNodeId = addNode(nodeType, newNodePosition, undefined);

  // 自动连接所有源节点到新节点
  for (const sourceNode of branchConnectionSource) {
    connectNodes({
      source: sourceNode.id,
      target: newNodeId,
      sourceHandle: 'source',
      targetHandle: 'target',
    });
  }

  setShowBatchMenu(false);
  setBranchConnectionSource([]);
  setBranchConnectionPosition(null);
}, [branchConnectionSource, addNode, connectNodes]);
```

### 步骤 3: 添加菜单标题提示

**文件**: `src/features/canvas/ui/BatchOperationMenu.tsx`

在菜单顶部添加标题，显示选中节点数量：
```
引用选中的 3 个节点生成
```

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `BatchOperationMenu.tsx` | 修改 | 使用 nodeCatalog 获取菜单项 |
| `Canvas.tsx` | 修改 | 更新回调函数，添加自动连线逻辑 |

## UI 设计

### 修改后的菜单样式
```
┌─────────────────────────────┐
│ 引用选中的 3 个节点生成      │
├─────────────────────────────┤
│ 🖼️ AI生图                   │
│ 📋 分镜生成                  │
│ ... (其他节点类型)           │
└─────────────────────────────┘
```

### 连线效果
```
[节点A] ─────┐
             │
[节点B] ─────┼──── [新节点]
             │
[节点C] ─────┘
```

## 验收标准

1. ✅ 多选菜单显示与单选菜单相同的选项
2. ✅ 菜单标题显示选中节点数量
3. ✅ 选择节点类型后创建新节点
4. ✅ 新节点自动连接所有源节点
5. ✅ 连线使用正确的边类型
