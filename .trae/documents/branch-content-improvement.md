# 分支功能优化计划

## 需求分析

### 需求一：分支节点内容直接填充
**现状**：分支创建后，`content` 为空，只有 `summary` 填充了 AI 生成的摘要
**需求**：直接将 AI 生成的分支内容填充到 `content` 字段，使用 Markdown 格式便于阅读

### 需求二：合并点对话框显示分支来源
**现状**：AiWriterDialog 中显示分支内容，但没有显示分支编号和来源节点信息
**需求**：显示分支编号（如 "3-1"、"3-2"）和节点标题，让用户直观看到哪些分支节点连接到了这里

---

## 实施步骤

### 步骤 1: 修改 textGen.ts 中的 generateBranches 函数
让 AI 生成的分支内容使用 Markdown 格式，包含场景标题、对白等：

```typescript
// 提示词中增加 Markdown 格式要求
const prompt = `...
请为每个分支生成：
1. 标题（简短有力）
2. 摘要（50-100字）
3. 触发条件
4. 内容（使用 Markdown 格式的剧本内容，包含场景标题、对白等）
...`;
```

### 步骤 2: 扩展 GeneratedBranch 接口
```typescript
export interface GeneratedBranch {
  title: string;
  summary: string;
  condition: string;
  conditionType: 'choice' | 'random' | 'condition';
  content: string;  // 新增：Markdown 格式的剧本内容
}
```

### 步骤 3: 修改 ScriptChapterNode.tsx 的 handleBranchConfirm
将 AI 生成的 content（Markdown 格式）转换为 HTML 后填充到分支节点：

```typescript
branches.forEach((branch, index) => {
  const chapterId = addNode(
    CANVAS_NODE_TYPES.scriptChapter,
    position,
    {
      displayName: branch.title,
      title: branch.title,
      summary: branch.summary,
      content: simpleMarkdownToHtml(branch.content),  // 转换后填充
      // ...其他字段
    }
  );
});
```

### 步骤 4: 扩展 MergedBranchContent 接口
```typescript
export interface MergedBranchContent {
  title: string;
  content: string;
  summary: string;
  branchIndex?: number;    // 新增：分支编号
  chapterNumber?: number;  // 新增：章节号
  branchLabel?: string;    // 新增：完整标签如 "3-1"
}
```

### 步骤 5: 修改 ScriptChapterNode.tsx 的 collectMergedBranchContents
收集分支编号信息：

```typescript
const collectMergedBranchContents = useCallback(() => {
  if (!data.mergedFromBranches) return [];
  return data.mergedFromBranches.map(branchId => {
    const branchNode = nodes.find(n => n.id === branchId);
    const branchData = branchNode?.data as ScriptChapterNodeData | undefined;
    return {
      title: branchData?.title || '',
      content: branchData?.content || '',
      summary: branchData?.summary || '',
      branchIndex: branchData?.branchIndex,
      chapterNumber: branchData?.chapterNumber,
      branchLabel: branchData?.chapterNumber && branchData?.branchIndex
        ? `${branchData.chapterNumber}-${branchData.branchIndex}`
        : undefined,
    };
  });
}, [data.mergedFromBranches, nodes]);
```

### 步骤 6: 修改 AiWriterDialog.tsx 显示分支来源
在"合并的分支内容"区域显示分支编号和标题：

```tsx
{mergedBranchContents.map((branch, index) => (
  <div key={index} className="p-2 bg-bg-dark rounded-lg text-xs">
    <div className="flex items-center gap-2 mb-1">
      <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-medium">
        {branch.branchLabel || `分支${String.fromCharCode(65 + index)}`}
      </span>
      <span className="font-medium text-text-dark">
        {branch.title}
      </span>
    </div>
    <div className="text-text-muted line-clamp-2">
      {branch.content || branch.summary}
    </div>
  </div>
))}
```

---

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/commands/textGen.ts` | 扩展 `GeneratedBranch` 接口，修改提示词让 AI 输出 Markdown 格式内容 |
| `src/features/canvas/nodes/ScriptChapterNode.tsx` | 修改 `handleBranchConfirm` 填充 content，修改 `collectMergedBranchContents` 收集分支编号 |
| `src/features/canvas/ui/AiWriterDialog.tsx` | 扩展 `MergedBranchContent` 接口，优化分支来源显示 |

---

## 预期效果

### 分支节点创建后
- 编辑框内直接显示格式化的剧本内容
- 包含场景标题（H2）、分隔线、角色对白等
- 用户可以直接阅读和编辑

### 合并点对话框
- 显示 "3-1 复仇之路"、"3-2 宽恕之路" 等标签
- 用户直观看到哪些分支节点的内容被合并进来
