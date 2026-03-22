# 剧本分支功能设计方案（LLM 驱动版）

## 核心理念
**AI 生成，用户筛选** - 尽量调用 LLM 来完善文本，用户做选择和筛查

---

## 功能整合

### 整合方案一 + 方案五：LLM 驱动的分支点创建

**交互流程**：
1. 用户点击"创建分支点"
2. 弹出对话框，设置分支数量（2-4个）
3. **调用 LLM** 根据当前章节内容生成多个剧情走向
4. 展示 AI 生成的分支选项（每个包含标题、摘要、条件）
5. 用户选择保留哪些分支，可编辑修改
6. 确认后自动创建分支节点

### 整合方案二：分支合并 + 内容融合

**核心功能**：
- 支持多个分支汇聚到同一章节
- 目标节点显示"合并点"标记
- **关键**：当用户对合并后的章节进行"基于摘要扩写"时，系统自动收集所有分支节点的内容，与摘要一起作为 LLM 的参考输入

**数据结构扩展**：
```typescript
interface ScriptChapterNodeData {
  // ... 现有字段
  isMergePoint?: boolean;           // 是否为合并点
  mergedFromBranches?: string[];    // 合并来源的分支节点 ID 列表
}
```

**内容融合扩写逻辑**：
```typescript
// 当章节是合并点时，收集所有分支内容
const collectMergedBranchContent = (chapterId: string, nodes: CanvasNode[]) => {
  const chapter = nodes.find(n => n.id === chapterId);
  if (!chapter?.data.isMergePoint) return null;
  
  const mergedContents = chapter.data.mergedFromBranches?.map(branchId => {
    const branchNode = nodes.find(n => n.id === branchId);
    return {
      title: branchNode?.data.title,
      content: branchNode?.data.content,
      summary: branchNode?.data.summary,
    };
  });
  
  return mergedContents;
};
```

**扩写提示词设计（合并点专用）**：
```
你是一位专业的剧本编剧助手。请根据以下内容，生成融合后的章节内容。

章节标题：{chapterTitle}
章节摘要：{summary}

以下是合并到此章节的多个分支剧情，请综合考虑这些内容进行创作：

【分支A】
标题：{branchA.title}
内容：{branchA.content}

【分支B】
标题：{branchB.title}
内容：{branchB.content}

请创作一个融合了多个分支走向的章节内容，要求：
1. 保持剧情的连贯性和合理性
2. 可以选择性地融合各分支的精彩元素
3. 或者选择其中一个分支作为主线继续发展

请按照 Markdown 格式输出剧本内容...
```

### 整合方案四：分支预览模式

- 高亮显示选中分支路径
- 快速切换不同分支查看剧情走向

---

## 详细实施计划

### 步骤 1：添加 LLM 分支生成函数

在 `textGen.ts` 中添加：

```typescript
export interface BranchGenerationRequest {
  chapterContent: string;
  chapterTitle: string;
  chapterNumber: number;
  branchCount: number;
  storyContext?: string;
}

export interface GeneratedBranch {
  title: string;
  summary: string;
  condition: string;
  conditionType: 'choice' | 'random' | 'condition';
}

export async function generateBranches(request: BranchGenerationRequest): Promise<GeneratedBranch[]>
```

### 步骤 2：添加合并点扩写函数

```typescript
export interface MergedBranchContent {
  title: string;
  content: string;
  summary: string;
}

export interface MergedExpandRequest {
  chapterTitle: string;
  chapterNumber?: number;
  summary: string;
  mergedBranches: MergedBranchContent[];
  instruction?: string;
}

export async function expandFromMergedBranches(request: MergedExpandRequest): Promise<string>
```

**提示词**：
```
你是一位专业的剧本编剧助手。请根据以下内容，生成融合后的章节内容。

章节标题：{chapterTitle}
章节摘要：{summary}

以下是合并到此章节的多个分支剧情：

{mergedBranches.map(b => `
【${b.title}】
${b.content || b.summary}
`).join('\n')}

{instruction ? `创作要求：${instruction}` : ''}

请创作一个融合了多个分支走向的章节内容，要求：
1. 保持剧情的连贯性和合理性
2. 可以选择性地融合各分支的精彩元素
3. 或者选择其中一个分支作为主线继续发展
4. 如果分支内容有冲突，选择最合理的走向

请按照 Markdown 格式输出剧本内容...
```

### 步骤 3：创建 BranchPointDialog 组件

**UI 结构**：
```
┌─────────────────────────────────────┐
│  创建剧情分支                    ✕  │
├─────────────────────────────────────┤
│  分支数量：[2] [3] [4]              │
│                                     │
│  [🤖 AI 生成分支]                   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 分支A：复仇之路              │   │
│  │ 主角选择复仇，踏上...        │   │
│  │ 条件：选择"复仇"选项         │   │
│  │ [✓ 保留]                    │   │
│  └─────────────────────────────┘   │
│  ...                                │
│                                     │
│  [取消]  [确认创建]                 │
└─────────────────────────────────────┘
```

### 步骤 4：修改 ScriptChapterNode.tsx

1. 在节点底部添加"创建分支"按钮
2. 在摘要扩写逻辑中检测是否为合并点
3. 如果是合并点，收集分支内容并调用 `expandFromMergedBranches`

```tsx
// 检测是否为合并点
const isMergePoint = data.isMergePoint && data.mergedFromBranches?.length > 0;

// 点击扩写按钮时
const handleExpandFromSummary = () => {
  if (isMergePoint) {
    // 收集合并的分支内容
    const mergedContents = collectMergedBranchContent(id, nodes);
    setAiDialogMode('expandFromMerged');
    setMergedBranchContents(mergedContents);
  } else {
    setAiDialogMode('expandFromSummary');
  }
};
```

### 步骤 5：扩展 AiWriterDialog

添加新模式 `expandFromMerged`：

```tsx
interface AiWriterDialogProps {
  // ... 现有字段
  mode: 'expand' | 'rewrite' | 'expandFromSummary' | 'expandFromMerged';
  mergedBranchContents?: MergedBranchContent[];
}
```

### 步骤 6：实现分支合并交互

**方式一：拖拽连线**
- 从多个分支节点连线到目标章节节点
- 目标节点自动标记为合并点
- 记录 `mergedFromBranches`

**方式二：右键菜单**
- 右键点击章节节点
- 选择"设为合并点"
- 弹出对话框选择要合并的分支

### 步骤 7：分支节点自动布局

```typescript
const createBranchNodes = (sourceNode, branches, selectedIndices) => {
  const BRANCH_NODE_WIDTH = 420;
  const BRANCH_NODE_HEIGHT = 380;
  const HORIZONTAL_GAP = 50;
  const VERTICAL_GAP = 80;
  
  const selectedBranches = branches.filter((_, i) => selectedIndices.has(i));
  const totalWidth = selectedBranches.length * BRANCH_NODE_WIDTH + 
                     (selectedBranches.length - 1) * HORIZONTAL_GAP;
  
  const startX = sourceNode.position.x - totalWidth / 2 + BRANCH_NODE_WIDTH / 2;
  const startY = sourceNode.position.y + BRANCH_NODE_HEIGHT + VERTICAL_GAP;
  
  selectedBranches.forEach((branch, index) => {
    const position = {
      x: startX + index * (BRANCH_NODE_WIDTH + HORIZONTAL_GAP),
      y: startY,
    };
    
    addNode(CANVAS_NODE_TYPES.scriptChapter, position, {
      branchType: 'branch',
      parentId: sourceNode.id,
      title: branch.title,
      summary: branch.summary,
      chapterNumber: sourceData.chapterNumber,
      branchIndex: index + 1,
    });
  });
};
```

### 步骤 8：分支预览模式

在画布工具栏添加切换按钮，高亮当前选中分支路径。

---

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/commands/textGen.ts` | 添加 `generateBranches`、`expandFromMergedBranches` 函数 |
| `src/features/canvas/ui/BranchPointDialog.tsx` | 新建：分支点创建对话框 |
| `src/features/canvas/ui/AiWriterDialog.tsx` | 添加 `expandFromMerged` 模式 |
| `src/features/canvas/nodes/ScriptChapterNode.tsx` | 添加"创建分支"按钮、合并点检测逻辑 |
| `src/features/canvas/Canvas.tsx` | 添加分支创建、合并处理逻辑 |
| `src/features/canvas/domain/canvasNodes.ts` | 扩展 `ScriptChapterNodeData` 添加 `isMergePoint`、`mergedFromBranches` |
| `src/i18n/locales/zh.json` | 添加中文翻译 |
| `src/i18n/locales/en.json` | 添加英文翻译 |

---

## 交互流程图

### 分支创建流程
```
用户点击"创建分支"
        ↓
弹出对话框，选择分支数量
        ↓
点击"AI 生成分支"
        ↓
调用 LLM 生成 N 个分支选项
        ↓
展示生成的分支（标题、摘要、条件）
        ↓
用户勾选要保留的分支
        ↓
用户可编辑修改分支内容
        ↓
点击"确认创建"
        ↓
自动创建分支节点（横向排列）
        ↓
自动创建连线
```

### 分支合并 + 内容融合流程
```
多个分支节点连线到目标章节
        ↓
目标章节标记为"合并点"
        ↓
记录 mergedFromBranches
        ↓
用户点击"基于摘要扩写"
        ↓
系统检测到是合并点
        ↓
收集所有分支节点的内容
        ↓
调用 expandFromMergedBranches
        ↓
LLM 融合多个分支内容生成章节
```

---

## UI 标识设计

### 合并点节点样式
- 节点边框使用特殊颜色（如青色）
- 显示"合并点"徽章
- 显示合并来源数量（如"来自 3 个分支"）

### 分支连线样式
- 分支连线使用紫色
- 连线上显示条件标签
- 合并连线使用青色虚线
