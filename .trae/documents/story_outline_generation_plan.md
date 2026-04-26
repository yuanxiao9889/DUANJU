# 故事大纲生成流程优化计划

## 目标

优化用户创建剧本的流程，增加以下功能：
1. 生成故事名称
2. 可配置章节数量的大纲生成
3. 确认对话框（支持预览、重新生成、章节数量设置）

## 当前流程

```
用户输入故事概要 → 点击生成 → AI生成大纲 → 创建节点
```

## 新流程

```
用户输入故事概要 → 点击生成 → 显示大纲设置对话框
                                    ↓
                            用户设置章节数量
                                    ↓
                            AI生成故事名称和大纲
                                    ↓
                            显示确认对话框（预览大纲）
                                    ↓
                      用户满意 → 创建节点 | 不满意 → 重新生成
```

## 实现步骤

### 步骤 1: 修改 outlineGenerator.ts

**文件**: `src/features/canvas/application/outlineGenerator.ts`

**修改内容**:
1. 添加 `chapterCount` 参数到 `generateOutline` 函数
2. 修改 AI prompt 让用户可以指定章节数量
3. 确保返回的故事名称 (`title`) 被正确使用

**代码修改**:
```typescript
export interface OutlineGenerationOptions {
  chapterCount: number; // 期望的章节数量
}

export async function generateOutline(
  storyDescription: string,
  options?: OutlineGenerationOptions
): Promise<StoryOutline> {
  const chapterCount = options?.chapterCount || 5;
  // 修改 prompt 包含章节数量要求
}
```

### 步骤 2: 创建 OutlineConfirmDialog 组件

**文件**: `src/features/canvas/ui/OutlineConfirmDialog.tsx` (新建)

**组件结构**:
```typescript
interface OutlineConfirmDialogProps {
  isOpen: boolean;
  storyOutline: string;      // 故事概要
  generatedOutline: StoryOutline | null; // 生成的大纲结果
  isGenerating: boolean;     // 是否正在生成
  onClose: () => void;
  onConfirm: (outline: StoryOutline) => void;
  onRegenerate: (chapterCount: number) => void;
}
```

**UI 设计**:
- 左侧：故事名称 + 章节列表预览
- 右侧：章节数量设置（滑块或输入框，范围 3-15）
- 底部按钮：重新生成 | 确认创建

### 步骤 3: 修改 ScriptWelcomeDialog 组件

**文件**: `src/features/canvas/ui/ScriptWelcomeDialog.tsx`

**修改内容**:
1. 添加状态管理大纲生成流程
2. 在"创建故事"流程中集成 OutlineConfirmDialog
3. 修改 `handleCreateStory` 逻辑

**新状态**:
```typescript
const [outlineDialogOpen, setOutlineDialogOpen] = useState(false);
const [generatedOutline, setGeneratedOutline] = useState<StoryOutline | null>(null);
const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
const [chapterCount, setChapterCount] = useState(5);
```

**新流程**:
```typescript
const handleCreateStory = async () => {
  // 1. 检查 API 配置
  if (!hasScriptProvider) {
    openSettingsDialog({ category: 'providers' });
    return;
  }

  // 2. 打开大纲设置对话框
  setOutlineDialogOpen(true);

  // 3. 自动开始生成
  handleGenerateOutline(5);
};

const handleGenerateOutline = async (count: number) => {
  setIsGeneratingOutline(true);
  try {
    const outline = await generateOutline(storyOutline, { chapterCount: count });
    setGeneratedOutline(outline);
  } catch (err) {
    // 错误处理
  } finally {
    setIsGeneratingOutline(false);
  }
};

const handleConfirmOutline = (outline: StoryOutline) => {
  // 创建节点逻辑
  const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: 50, y: 100 }, {
    displayName: '剧本',
    title: outline.title,
    genre: outline.genre || '',
    totalChapters: outline.chapters.length,
  });

  outline.chapters.forEach((chapter, index) => {
    const chapterId = addNode(CANVAS_NODE_TYPES.scriptChapter, {
      x: 500,
      y: 100 + index * (NODE_HEIGHT + GAP)
    }, {
      displayName: `第${chapter.number}章 ${chapter.title}`,
      chapterNumber: chapter.number,
      title: chapter.title,
      summary: chapter.summary,
      content: '',
      // ... 其他字段
    });

    if (rootId && chapterId) {
      addEdge(rootId, chapterId);
    }
  });

  // 关闭所有对话框
  setOutlineDialogOpen(false);
  onClose();
};
```

### 步骤 4: 更新样式

确保对话框样式与现有 UI 一致：
- 使用 `bg-surface-dark`、`border-border-dark` 等主题色
- 使用 `text-text-dark`、`text-text-muted` 等文字色
- 按钮使用 `UiButton` 组件

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `outlineGenerator.ts` | 修改 | 添加章节数量参数 |
| `OutlineConfirmDialog.tsx` | 新建 | 大纲确认对话框组件 |
| `ScriptWelcomeDialog.tsx` | 修改 | 集成新流程 |

## UI 布局设计

```
┌─────────────────────────────────────────────────────────────┐
│  ✨ 生成故事大纲                                        [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  故事概要：                                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 讲述一个关于友谊和成长的故事...                           ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌───────────────────────┐  ┌───────────────────────────────┐│
│  │ 故事名称               │  │ 大纲设置                      ││
│  │ 《追光少年》           │  │                               ││
│  │                       │  │ 章节数量: [====●=====] 5      ││
│  │ 章节大纲：             │  │                               ││
│  │ 1. 意外的相遇          │  │ [重新生成]                    ││
│  │ 2. 共同的梦想          │  │                               ││
│  │ 3. 分歧与考验          │  └───────────────────────────────┘│
│  │ 4. 重归于好            │                                 │
│  │ 5. 携手前行            │                                 │
│  └───────────────────────┘                                  │
│                                                             │
│                        [取消]  [确认创建大纲]                │
└─────────────────────────────────────────────────────────────┘
```

## 验收标准

1. 用户输入故事概要后，可以设置章节数量（3-15章）
2. AI 生成后显示故事名称和章节列表预览
3. 用户可以调整章节数量并重新生成
4. 确认后正确创建剧本根节点和章节节点
5. 节点位置正确，无重叠
