# 故事创建增强功能实现计划

## 目标

增强故事创建功能，添加可选项配置、世界观节点和资产栏可视化功能。

## 实现步骤

### 步骤 1: 添加新的节点类型 - 世界观节点

**文件**: `src/features/canvas/domain/canvasNodes.ts`

**修改内容**:
```typescript
export const CANVAS_NODE_TYPES = {
  // ... 现有类型
  scriptWorldview: 'scriptWorldviewNode', // 新增：世界观节点
} as const;
```

### 步骤 2: 注册世界观节点定义

**文件**: `src/features/canvas/domain/nodeRegistry.ts`

**修改内容**:
- 添加 `scriptWorldview` 节点注册
- 设置 `targetHandle: false`, `sourceHandle: false`（独立节点，无连接点）
- 设置 `visibleInMenu: false`（不在菜单中显示，仅通过资产栏创建）

**节点数据结构**:
```typescript
interface ScriptWorldviewNodeData {
  displayName: string;
  worldviewName: string;      // 世界观名称
  description: string;        // 世界观描述
  rules: string[];            // 世界观规则/法则
  era: string;                // 时代背景
  technology: string;         // 科技水平
  magic: string;              // 魔法/超自然设定
  society: string;            // 社会结构
  geography: string;          // 地理环境
}
```

### 步骤 3: 创建世界观节点渲染组件

**文件**: `src/features/canvas/nodes/ScriptWorldviewNode.tsx` (新建)

**设计要点**:
- 独特的视觉样式：使用 **蓝绿色 (teal/cyan)** 作为主色调，与其他节点区分
- 无 Handle 连接点
- 可折叠/展开的内容区域
- 支持编辑功能

**样式设计**:
```tsx
// 主色调：cyan-500/teal-500
// 背景：渐变效果，从 cyan-900/20 到 transparent
// 图标：Globe 图标
// 边框：cyan-500/30
```

### 步骤 4: 注册节点渲染组件

**文件**: `src/features/canvas/nodes/index.ts`

**修改内容**:
```typescript
import { ScriptWorldviewNode } from './ScriptWorldviewNode';

export const nodeTypes = {
  // ... 现有类型
  [CANVAS_NODE_TYPES.scriptWorldview]: ScriptWorldviewNode,
};
```

### 步骤 5: 更新节点显示名称

**文件**: `src/features/canvas/domain/nodeDisplay.ts`

**修改内容**:
```typescript
[CANVAS_NODE_TYPES.scriptWorldview]: '世界观',
```

### 步骤 6: 修改 OutlineConfirmDialog 添加可选项配置

**文件**: `src/features/canvas/ui/OutlineConfirmDialog.tsx`

**新增功能**:
1. **故事风格选择器**:
   - 预设选项：悬疑、爱情、科幻、奇幻、历史、现代、喜剧、悲剧
   - 支持自定义输入

2. **世界观概述输入区**:
   - 多行文本输入
   - 占位符提示：描述故事的世界观设定...

**UI 布局**:
```
┌─────────────────────────────────────────────────────────────┐
│  ✨ 生成故事大纲                                        [X]  │
├─────────────────────────────────────────────────────────────┤
│  故事概要：[显示用户输入的故事概要]                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 高级设置（可选）                              [展开/收起] ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ 故事风格：[悬疑 ▼] 或 [自定义输入___]                    ││
│  │                                                         ││
│  │ 世界观概述：                                            ││
│  │ ┌─────────────────────────────────────────────────────┐ ││
│  │ │ 这是一个充满魔法的中世纪奇幻世界...                   │ ││
│  │ │                                                     │ ││
│  │ └─────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  章节数量: [====●=====] 5 章                                │
│                                                             │
│  [故事名称预览]                                             │
│  [章节大纲预览]                                             │
│                                                             │
│                    [取消]  [确认创建大纲]                    │
└─────────────────────────────────────────────────────────────┘
```

### 步骤 7: 更新 outlineGenerator.ts 支持新参数

**文件**: `src/features/canvas/application/outlineGenerator.ts`

**修改内容**:
```typescript
export interface OutlineGenerationOptions {
  chapterCount?: number;
  style?: string;           // 新增：故事风格
  worldviewDescription?: string;  // 新增：世界观概述
}

// 更新 prompt 模板，包含风格和世界观信息
```

### 步骤 8: 更新 ScriptWelcomeDialog 集成新功能

**文件**: `src/features/canvas/ui/ScriptWelcomeDialog.tsx`

**修改内容**:
1. 添加故事风格和世界观的状态管理
2. 传递新参数到 OutlineConfirmDialog
3. 在创建节点时同时创建世界观节点

### 步骤 9: 更新 ScriptBiblePanel 资产栏

**文件**: `src/features/canvas/ui/ScriptBiblePanel.tsx`

**新增功能**:
1. 添加"世界观"分区
2. 实现资产项的可视化功能：
   - 每个资产项旁边添加"显示到画布"按钮
   - 点击后创建对应的独立节点

**资产栏结构更新**:
```
┌─────────────────────────────────┐
│ 📖 剧本资产                     │
├─────────────────────────────────┤
│ ▼ 世界观                    [📍] │  ← 新增分区
│   魔法世界设定              [📍] │
├─────────────────────────────────┤
│ ▼ 角色档案                     │
│   主角：张三               [📍] │
│   配角：李四               [📍] │
├─────────────────────────────────┤
│ ▼ 场景地点                     │
│   古城                     [📍] │
├─────────────────────────────────┤
│ ▼ 关键道具                     │
│   魔法剑                   [📍] │
└─────────────────────────────────┘
```

### 步骤 10: 实现资产可视化功能

**文件**: `src/features/canvas/ui/ScriptBiblePanel.tsx`

**新增功能**:
- 为每个资产项添加"显示到画布"按钮（📍图标）
- 点击按钮时调用 `canvasStore.addNode` 创建对应节点
- 节点位置智能计算，避免重叠

### 步骤 11: 更新 canvasStore 支持新节点类型

**文件**: `src/stores/canvasStore.ts`

**修改内容**:
- 确保新节点类型在类型定义中正确声明
- 添加创建世界观节点的辅助方法（如需要）

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `canvasNodes.ts` | 修改 | 添加 scriptWorldview 类型 |
| `nodeRegistry.ts` | 修改 | 注册世界观节点定义 |
| `nodeDisplay.ts` | 修改 | 添加节点显示名称 |
| `ScriptWorldviewNode.tsx` | 新建 | 世界观节点渲染组件 |
| `nodes/index.ts` | 修改 | 注册渲染组件 |
| `OutlineConfirmDialog.tsx` | 修改 | 添加风格和世界观输入 |
| `outlineGenerator.ts` | 修改 | 支持新参数 |
| `ScriptWelcomeDialog.tsx` | 修改 | 集成新功能 |
| `ScriptBiblePanel.tsx` | 修改 | 添加世界观分区和可视化功能 |

## 验收标准

1. 用户可以在创建故事时选择故事风格（预设或自定义）
2. 用户可以在创建故事时输入世界观概述
3. 世界观节点有独特的蓝绿色视觉样式
4. 世界观节点无连接点，为独立节点
5. 资产栏显示世界观分区
6. 资产栏中所有资产项都可以显示到画布
7. 显示到画布的节点为独立节点，无连接
