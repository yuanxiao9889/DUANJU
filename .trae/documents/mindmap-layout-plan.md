# 节点布局优化计划：向右分支的思维导图式结构

## 目标
将当前节点局部流程图调整为向右发散的思维导图布局方式，以剧本主标题为核心起点，章节节点向右延伸形成层级关系。

## 当前实现分析

### 现有布局逻辑
1. **节点创建位置**：`canvasStore.ts` 中的 `findNodePosition` 函数
   - 默认从源节点右侧锚点开始
   - 使用碰撞检测和环形采样搜索可用位置
   - 简单派生位置：`getDerivedNodePosition` 直接在源节点右侧 +100px

2. **脚本分析创建章节**：`scriptAnalyzer.ts` 中的 `createChapterNodesFromAnalysis`
   - 线性水平排列：`x = baseX + index * spacingX`
   - 添加随机 Y 偏移

3. **分支节点创建**：`Canvas.tsx` 中的 `handleNodeSelect`
   - 分支节点位置由 `flowPosition` 决定（用户释放鼠标的位置）

### 问题
- 当前布局缺乏层级结构
- 分支节点位置不够智能
- 没有实现思维导图式的发散布局

## 实现方案

### 步骤 1：设计思维导图布局数据结构

在 `canvasNodes.ts` 中增强节点数据结构：
- `depth`: 节点层级深度（0=根节点，1=主线章节，2=分支章节）
- `branchIndex`: 同级分支索引
- `layoutBranch`: 布局分支标识（主线/分支A/分支B等）

### 步骤 2：创建布局计算工具函数

新建文件 `src/features/canvas/application/mindMapLayout.ts`：

```typescript
interface LayoutConfig {
  rootX: number;           // 根节点起始 X
  rootY: number;           // 根节点起始 Y
  levelSpacingX: number;   // 层级间水平间距
  branchSpacingY: number;  // 分支间垂直间距
  nodeWidth: number;       // 节点默认宽度
  nodeHeight: number;      // 节点默认高度
}

// 计算思维导图式布局位置
function calculateMindMapPosition(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  config: LayoutConfig
): Map<string, XYPosition>;
```

### 步骤 3：更新节点创建逻辑

修改 `Canvas.tsx` 中的 `handleNodeSelect`：
- 主线节点：在源节点右侧，Y 坐标与源节点对齐
- 分支节点：在父节点右侧，根据分支索引计算 Y 偏移

### 步骤 4：更新脚本分析创建逻辑

修改 `scriptAnalyzer.ts` 中的 `createChapterNodesFromAnalysis`：
- 第一个章节作为主线，Y 坐标与根节点对齐
- 后续章节根据连接关系确定位置

### 步骤 5：添加布局重排功能

在画布工具栏添加"自动布局"按钮，支持：
- 一键重排所有节点为思维导图布局
- 保持节点间连接关系

## 详细实现

### 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `canvasNodes.ts` | 增强 ScriptChapterNodeData 的布局字段 |
| `mindMapLayout.ts` | 新建，实现思维导图布局算法 |
| `Canvas.tsx` | 更新节点创建时的位置计算 |
| `scriptAnalyzer.ts` | 更新章节节点创建时的位置计算 |
| `canvasStore.ts` | 添加自动布局 action |

### 布局算法核心逻辑

```
根节点(ScriptRoot)
    │
    ├── 章节1 (主线, depth=1)
    │       │
    │       ├── 分支1-1 (depth=2)
    │       │       └── ...
    │       └── 分支1-2 (depth=2)
    │               └── ...
    │
    ├── 章节2 (主线, depth=1)
    │       └── ...
    │
    └── 章节3 (主线, depth=1)
            └── ...
```

### 位置计算公式

```
主线节点位置:
  x = parentX + levelSpacingX
  y = parentY

分支节点位置:
  x = parentX + levelSpacingX
  y = parentY + (branchIndex - totalBranches/2) * branchSpacingY
```

## 预期效果

1. ScriptRoot 节点位于画布左侧中央
2. 主线章节从根节点向右水平延伸
3. 分支章节从父节点向右发散，垂直方向错开
4. 整体呈现清晰的层级思维导图结构
