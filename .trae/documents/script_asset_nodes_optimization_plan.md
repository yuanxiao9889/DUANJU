# 剧本资产节点优化计划

## 目标

优化剧本资产相关节点的视觉效果和交互体验：
1. 为角色、场景、道具、埋点节点创建独立渲染组件（参考世界观样式）
2. 优化世界观节点的编辑交互
3. 限制节点删除入口
4. 简化剧本根节点设计

## 实现步骤

### 步骤 1: 创建角色节点渲染组件

**文件**: `src/features/canvas/nodes/ScriptCharacterNode.tsx` (新建)

**设计要点**:
- 参考世界观节点的样式结构
- 使用 **紫色 (purple)** 作为主色调
- 无 Handle 连接点
- 显示：角色名称、描述、性格特点、外貌特征
- 无删除按钮

### 步骤 2: 创建场景节点渲染组件

**文件**: `src/features/canvas/nodes/ScriptLocationNode.tsx` (新建)

**设计要点**:
- 参考世界观节点的样式结构
- 使用 **绿色 (green)** 作为主色调
- 无 Handle 连接点
- 显示：场景名称、描述、出现章节
- 无删除按钮

### 步骤 3: 创建道具节点渲染组件

**文件**: `src/features/canvas/nodes/ScriptItemNode.tsx` (新建)

**设计要点**:
- 参考世界观节点的样式结构
- 使用 **橙色 (orange)** 作为主色调
- 无 Handle 连接点
- 显示：道具名称、描述、出现章节
- 无删除按钮

### 步骤 4: 创建埋点节点渲染组件

**文件**: `src/features/canvas/nodes/ScriptPlotPointNode.tsx` (新建)

**设计要点**:
- 参考世界观节点的样式结构
- 使用 **粉色 (pink)** 作为主色调
- 无 Handle 连接点
- 显示：类型（伏笔/响应）、描述
- 无删除按钮

### 步骤 5: 注册渲染组件

**文件**: `src/features/canvas/nodes/index.ts`

**修改内容**:
```typescript
import { ScriptCharacterNode } from './ScriptCharacterNode';
import { ScriptLocationNode } from './ScriptLocationNode';
import { ScriptItemNode } from './ScriptItemNode';
import { ScriptPlotPointNode } from './ScriptPlotPointNode';

export const nodeTypes = {
  // ... 现有类型
  scriptCharacterNode: ScriptCharacterNode,
  scriptLocationNode: ScriptLocationNode,
  scriptItemNode: ScriptItemNode,
  scriptPlotPointNode: ScriptPlotPointNode,
};
```

### 步骤 6: 优化世界观节点

**文件**: `src/features/canvas/nodes/ScriptWorldviewNode.tsx`

**修改内容**:
1. 移除收起/展开按钮
2. 优化编辑按钮的点击区域（增大按钮尺寸和 padding）
3. 始终显示编辑按钮（不仅限于选中状态）
4. 移除删除按钮

### 步骤 7: 简化剧本根节点

**文件**: `src/features/canvas/nodes/ScriptRootNode.tsx`

**修改内容**:
1. 移除类型选择器
2. 只保留大的标题显示
3. 简化整体布局，更加美观

### 步骤 8: 限制节点删除入口

**文件**: `src/features/canvas/ui/NodeActionToolbar.tsx`

**修改内容**:
- 对于 scriptCharacter、scriptLocation、scriptItem、scriptPlotPoint、scriptWorldview 节点类型，隐藏删除按钮

## 颜色方案

| 节点类型 | 主色调 | Tailwind 类 |
|---------|--------|-------------|
| 世界观 | 青色 | cyan-500 |
| 角色 | 紫色 | purple-500 |
| 场景 | 绿色 | green-500 |
| 道具 | 橙色 | orange-500 |
| 埋点 | 粉色 | pink-500 |

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `ScriptCharacterNode.tsx` | 新建 | 角色节点渲染组件 |
| `ScriptLocationNode.tsx` | 新建 | 场景节点渲染组件 |
| `ScriptItemNode.tsx` | 新建 | 道具节点渲染组件 |
| `ScriptPlotPointNode.tsx` | 新建 | 埋点节点渲染组件 |
| `nodes/index.ts` | 修改 | 注册渲染组件 |
| `ScriptWorldviewNode.tsx` | 修改 | 优化编辑按钮，移除收起按钮 |
| `ScriptRootNode.tsx` | 修改 | 简化设计 |
| `NodeActionToolbar.tsx` | 修改 | 隐藏特定节点类型的删除按钮 |

## 验收标准

1. 角色、场景、道具、埋点节点有独立的渲染组件
2. 各节点使用不同颜色区分
3. 世界观节点编辑按钮易于点击
4. 世界观节点无收起按钮
5. 这些节点在画布上无删除按钮
6. 剧本根节点设计简洁美观
