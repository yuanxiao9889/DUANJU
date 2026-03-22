# 章节节点选中文本替换功能修复计划

## 问题描述

章节节点中选中文本进行改写或扩写后，点击替换会把整个编辑框的内容都替换掉，正确的行为应该是只替换选中的文本。

## 问题分析

### 当前实现的问题

1. **选中位置信息丢失**：`RichTextEditor` 组件虽然通过 `lastSelectionRangeRef` 记录了选中的 `{ from, to }` 位置，但这个信息没有传递给父组件

2. **`pendingSelectionReplacement` 未实现**：`RichTextEditor` 定义了 `pendingSelectionReplacement` 和 `onSelectionReplacementApplied` props，但没有实现对应的处理逻辑

3. **`handleAiConfirm` 直接替换整个内容**：
   ```typescript
   updateNodeData(id, { content: result });  // 替换整个 content 字段
   ```

### 正确的数据流应该是

```
用户选中文本
    ↓
RichTextEditor 记录 { from, to } + 调用 onSelect(text)
    ↓
ScriptChapterNode 保存 selectedText + selectionRange
    ↓
AI 生成结果
    ↓
用户点击"确认替换"
    ↓
ScriptChapterNode 设置 pendingSelectionReplacement
    ↓
RichTextEditor 检测到 pendingSelectionReplacement
    ↓
RichTextEditor 使用 Tiptap API 在 { from, to } 位置插入新文本
    ↓
RichTextEditor 调用 onSelectionReplacementApplied
    ↓
ScriptChapterNode 清除状态
```

## 实现步骤

### 步骤 1: 修改 RichTextEditor 组件

**文件**: `src/features/canvas/ui/RichTextEditor.tsx`

1. 添加 `useEffect` 监听 `pendingSelectionReplacement` prop
2. 当检测到新的替换请求时：
   - 使用 `lastSelectionRangeRef.current` 获取选中位置
   - 使用 Tiptap API 执行局部替换：
     ```typescript
     editor.chain()
       .focus()
       .setTextSelection({ from, to })
       .insertContent(text)
       .run();
     ```
3. 替换完成后调用 `onSelectionReplacementApplied` 回调

### 步骤 2: 修改 ScriptChapterNode 组件

**文件**: `src/features/canvas/nodes/ScriptChapterNode.tsx`

1. 添加 `selectionRange` 状态保存选中位置
2. 修改 `onSelect` 回调，同时保存选中文本和位置
3. 添加 `pendingReplacement` 状态用于触发替换
4. 修改 `handleAiConfirm`：
   - 不再直接调用 `updateNodeData`
   - 而是设置 `pendingReplacement` 状态
5. 添加 `handleReplacementApplied` 回调清除状态
6. 将 `pendingReplacement` 和 `onReplacementApplied` 传递给 `RichTextEditor`

### 步骤 3: 测试验证

1. 选中文本 → AI 改写 → 确认替换 → 验证只替换选中部分
2. 选中文本 → AI 扩写 → 确认替换 → 验证只替换选中部分
3. 未选中文本 → AI 生成 → 确认 → 验证正常追加

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/features/canvas/ui/RichTextEditor.tsx` | 修改 | 实现选中替换逻辑 |
| `src/features/canvas/nodes/ScriptChapterNode.tsx` | 修改 | 传递选中位置和替换请求 |

## 代码实现细节

### RichTextEditor.tsx 修改

```typescript
// 添加 useEffect 处理替换请求
useEffect(() => {
  if (!editor || !pendingSelectionReplacement) return;
  
  const { text } = pendingSelectionReplacement;
  const range = lastSelectionRangeRef.current;
  
  if (range) {
    // 有选中范围，执行局部替换
    editor.chain()
      .focus()
      .setTextSelection({ from: range.from, to: range.to })
      .insertContent(text)
      .run();
  } else {
    // 没有选中范围，追加到末尾
    editor.chain()
      .focus()
      .insertContent(text)
      .run();
  }
  
  // 清除选中范围记录
  lastSelectionRangeRef.current = null;
  
  // 通知父组件替换完成
  onSelectionReplacementApplied?.();
}, [editor, pendingSelectionReplacement, onSelectionReplacementApplied]);
```

### ScriptChapterNode.tsx 修改

```typescript
// 添加选中范围状态
const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);

// 添加替换请求状态
const [pendingReplacement, setPendingReplacement] = useState<{ requestId: number; text: string } | null>(null);
const replacementRequestIdRef = useRef(0);

// 修改 onSelect 回调
const handleTextSelect = useCallback((text: string, range?: { from: number; to: number }) => {
  setSelectedText(text);
  setSelectionRange(range ?? null);
}, []);

// 修改 handleAiConfirm
const handleAiConfirm = useCallback((result: string) => {
  if (selectionRange) {
    // 有选中范围，触发局部替换
    replacementRequestIdRef.current += 1;
    setPendingReplacement({
      requestId: replacementRequestIdRef.current,
      text: result,
    });
  } else {
    // 没有选中范围，直接更新内容
    updateNodeData(id, { content: result });
  }
  setAiDialogMode(null);
  setSelectedText('');
}, [id, updateNodeData, selectionRange]);

// 添加替换完成回调
const handleReplacementApplied = useCallback(() => {
  setPendingReplacement(null);
  setSelectionRange(null);
}, []);
```
