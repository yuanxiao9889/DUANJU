# 摘要扩写功能实施计划

## 需求概述
在章节节点的摘要区域旁边添加一个"扩写"按钮，点击后基于摘要内容调用 AI 生成更丰富的章节文本内容。

## 现有代码分析

### 相关文件
1. **ScriptChapterNode.tsx** - 章节节点组件
   - 已有 `summary` 字段显示区域（第326-332行）
   - 已有 `AiWriterDialog` 集成（用于选中文本的扩写/改写）
   - 已有 `expandScript` 函数调用能力

2. **AiWriterDialog.tsx** - AI 写作对话框
   - 支持 `expand` 和 `rewrite` 两种模式
   - 可锚定到节点旁边显示

3. **textGen.ts** - 文本生成命令
   - `expandScript()` 函数已实现扩写逻辑

### 数据结构
- `ScriptChapterNodeData.summary` - 章节摘要
- `ScriptChapterNodeData.content` - 章节正文内容

## 实施步骤

### 步骤 1: 修改 ScriptChapterNode.tsx
在摘要显示区域添加扩写按钮：

```tsx
{data.summary && (
  <div className="pt-2 border-t border-border-dark mt-3 shrink-0">
    <div className="flex items-center justify-between">
      <p className="text-xs text-text-muted flex-1">
        <span className="font-medium">摘要:</span> {data.summary}
      </p>
      <button
        type="button"
        onClick={() => setAiDialogMode('expandFromSummary')}
        className="ml-2 p-1 rounded hover:bg-amber-500/20 text-amber-400"
        title="基于摘要扩写"
      >
        <Sparkles className="w-4 h-4" />
      </button>
    </div>
  </div>
)}
```

### 步骤 2: 扩展 AiWriterDialog 模式
在 `AiWriterDialog` 中添加新的模式 `'expandFromSummary'`：

- 修改 `mode` 类型定义：`'expand' | 'rewrite' | 'expandFromSummary'`
- 新模式的处理逻辑：
  - 标题显示"基于摘要扩写"
  - 原文显示摘要内容
  - 扩写要求可选输入
  - 生成后替换章节 content 字段

### 步骤 3: 添加新的扩写函数
在 `textGen.ts` 中添加专门用于摘要扩写的函数：

```typescript
export async function expandFromSummary(request: {
  summary: string;
  chapterTitle: string;
  instruction?: string;
}): Promise<string>
```

提示词设计：
- 输入：章节标题、摘要、可选的扩写要求
- 输出：完整的章节正文内容
- 风格：剧本格式，包含场景描述、对白等

### 步骤 4: 更新 i18n 翻译
在 `zh.json` 和 `en.json` 中添加相关文案：
- `script.expandFromSummary`: "基于摘要扩写"
- `script.expandFromSummaryDesc`: "根据章节摘要生成完整的剧本内容"

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/features/canvas/nodes/ScriptChapterNode.tsx` | 添加摘要扩写按钮，处理新模式 |
| `src/features/canvas/ui/AiWriterDialog.tsx` | 支持 `expandFromSummary` 模式 |
| `src/commands/textGen.ts` | 添加 `expandFromSummary` 函数 |
| `src/i18n/locales/zh.json` | 添加中文翻译 |
| `src/i18n/locales/en.json` | 添加英文翻译 |

## 交互流程

1. 用户创建故事大纲，章节节点自动生成摘要
2. 用户看到摘要区域旁边有一个 ✨ 按钮
3. 点击按钮后，弹出 AI 扩写对话框
4. 对话框显示摘要内容，用户可输入额外要求
5. 点击"开始扩写"，AI 生成完整章节内容
6. 用户预览结果后点击"确认替换"
7. 生成的内容填入章节的正文编辑区域
