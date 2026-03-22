# 合并点节点显示分支编号标签

## 需求分析

### 问题一：弹窗中分支来源不显示
**现状**：AiWriterDialog 中分支来源信息只在 `mode === 'expandFromMerged'` 时显示
**问题**：用户点击"基于摘要扩写"时 `mode` 是 `'expandFromSummary'`，分支来源不显示
**需求**：只要是合并点节点，无论哪种扩写模式，都应该显示分支来源信息

### 问题二：节点上没有直观显示
**现状**：合并点节点本身没有显示哪些分支连接到了这里
**需求**：在合并点节点上直接显示连接的分支编号标签

---

## 实施步骤

### 步骤 1: 修改 AiWriterDialog.tsx 显示条件

将分支来源显示的条件从 `mode === 'expandFromMerged'` 改为只要有 `mergedBranchContents` 就显示：

```tsx
// 修改前
{mode === 'expandFromMerged' && mergedBranchContents && mergedBranchContents.length > 0 && (

// 修改后
{mergedBranchContents && mergedBranchContents.length > 0 && (
```

### 步骤 2: 在 ScriptChapterNode.tsx 中添加合并点分支来源显示

在节点标题下方添加分支来源标签：

```tsx
{isMergePoint && (
  <div className="flex items-center gap-1 flex-wrap mt-1">
    <GitFork className="w-3 h-3 text-cyan-400" />
    <span className="text-xs text-cyan-400">来自</span>
    {collectMergedBranchContents().map((branch, index) => (
      <Fragment key={index}>
        {index > 0 && <span className="text-xs text-cyan-400">,</span>}
        <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 text-xs font-medium">
          {branch.branchLabel}
        </span>
      </Fragment>
    ))}
  </div>
)}
```

---

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/features/canvas/ui/AiWriterDialog.tsx` | 修改分支来源显示条件，只要有 mergedBranchContents 就显示 |
| `src/features/canvas/nodes/ScriptChapterNode.tsx` | 在节点上添加合并点分支来源标签显示 |

---

## 预期效果

### 弹窗中
- 合并点节点点击"基于摘要扩写"或"基于分支融合扩写"
- 都会显示"合并的分支内容"区域
- 每个分支显示编号标签（如 "3-1"）和标题

### 节点上
```
┌─────────────────────────────────┐
│  📄 第4章 重逢                  │
│  🔀 来自 3-1, 3-2, 3-3          │  ← 新增显示
│  ─────────────────────────────  │
│  摘要: 主角在经历了不同的选择后...│
│  [🔄] [✨]                       │
└─────────────────────────────────┘
```
