# 章节拆分与节点布局优化计划

## 一、问题分析

### 问题1：章节拆分太细
- 当前没有限制章节数量
- LLM 可能返回过多小章节

### 问题2：节点位置重叠
- 当前使用固定间距 `spacingY = 180`
- 没有考虑节点实际高度
- 节点区域位置有重叠

## 二、解决方案

### 2.1 优化章节拆分

**修改 `buildAnalysisPrompt` 提示词**：

```
重要规则：
1. 章节数量控制在 20 个以内
2. 按照剧情逻辑分割，每个章节应该是一个完整的故事单元
3. 章节之间不应该有重叠，也不应该有遗漏
```

### 2.2 动态计算节点位置

**修改 `createChapterNodesFromAnalysis` 函数**：

根据内容长度动态计算节点位置，避免重叠：

```typescript
export function createChapterNodesFromAnalysis(
  analysis: ScriptAnalysisResult,
  parsedContent?: ParsedScriptContent
): Array<...> {
  const baseX = 100;
  const baseY = 100;
  const NODE_BASE_HEIGHT = 200;  // 节点基础高度（包含标题、摘要等）
  const LINE_HEIGHT = 18;        // 每行文字高度
  const GAP = 60;                // 节点之间的间距
  
  let currentY = baseY;
  
  return chaptersWithContent.map(({ chapter, content }, index) => {
    // 计算内容行数
    const lineCount = content.split('\n').length;
    // 计算节点实际高度
    const nodeHeight = NODE_BASE_HEIGHT + lineCount * LINE_HEIGHT;
    
    const node = {
      id: uuidv4(),
      type: CANVAS_NODE_TYPES.scriptChapter,
      data: { ... },
      position: {
        x: baseX,
        y: currentY,
      },
    };
    
    // 累加高度，下一个节点从当前节点底部 + 间距开始
    currentY += nodeHeight + GAP;
    
    return node;
  });
}
```

## 三、修改文件

### 3.1 `scriptAnalyzer.ts`

**修改内容**：
1. 修改 `buildAnalysisPrompt`，限制章节数量在 20 个以内
2. 修改 `createChapterNodesFromAnalysis`，动态计算节点位置避免重叠

## 四、验证清单

- [ ] 章节数量控制在 20 个以内
- [ ] 节点位置不重叠
- [ ] 长内容节点正确显示
- [ ] TypeScript 类型检查通过

## 五、执行顺序

```
修改提示词 → 修改节点位置计算 → 验证
```
