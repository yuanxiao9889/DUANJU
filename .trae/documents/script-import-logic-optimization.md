# 剧本导入逻辑优化计划

## 一、问题分析

### 当前逻辑
1. **文档解析**：`documentParser.ts` 使用正则表达式（`INT.`、`EXT.`）分割场景
2. **LLM 分析**：`scriptAnalyzer.ts` 让 LLM 分析前15个场景，生成章节摘要

### 存在问题
1. **分割方式局限**：正则表达式只能识别标准剧本格式，对小说、散文等格式无法正确分割
2. **内容丢失**：LLM 只生成摘要，没有指导程序如何分割原文
3. **章节与原文不对应**：章节节点的内容是摘要而非原文

## 二、优化方案

### 核心思路
**LLM 负责判断分割点，程序负责执行分割**

### 流程设计

```
原文 → LLM分析返回分割点 → 程序按分割点切分原文 → 创建章节节点（含原文）
```

### 具体实现

#### 步骤1：修改 LLM 提示词

让 LLM 返回章节分割信息：

```json
{
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "第一章 开端",
      "startLine": 1,
      "endLine": 50,
      "summary": "章节摘要",
      "characters": ["角色A"],
      "locations": ["场景A"]
    }
  ],
  "characters": [...],
  "locations": [...],
  ...
}
```

#### 步骤2：新增分割函数

```typescript
function splitContentByChapters(
  rawText: string,
  chapters: ChapterAnalysis[]
): Array<{ chapter: ChapterAnalysis; content: string }> {
  const lines = rawText.split('\n');
  
  return chapters.map((chapter) => {
    const content = lines
      .slice(chapter.startLine - 1, chapter.endLine)
      .join('\n');
    
    return {
      chapter,
      content,
    };
  });
}
```

#### 步骤3：修改章节节点创建

```typescript
export function createChapterNodesFromAnalysis(
  analysis: ScriptAnalysisResult,
  parsedContent: ParsedScriptContent
): Array<...> {
  const chaptersWithContent = splitContentByChapters(
    parsedContent.rawText,
    analysis.chapters
  );
  
  return chaptersWithContent.map(({ chapter, content }) => ({
    data: {
      title: chapter.title,
      content: content,  // 原文内容
      summary: chapter.summary,  // LLM 摘要
      ...
    }
  }));
}
```

## 三、修改文件

### 3.1 `scriptAnalyzer.ts`

**修改内容**：
1. 修改 `ChapterAnalysis` 接口，添加 `startLine` 和 `endLine`
2. 修改 `buildAnalysisPrompt`，让 LLM 返回行号
3. 新增 `splitContentByChapters` 函数
4. 修改 `createChapterNodesFromAnalysis`，使用分割后的内容

### 3.2 提示词优化

```
请分析以下剧本内容，判断如何分割章节。

重要：你需要返回每个章节的起始行号和结束行号（从1开始计数）。

原文（带行号）:
1: 第一行内容
2: 第二行内容
...

请按以下JSON格式输出:
{
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "章节标题",
      "startLine": 1,
      "endLine": 50,
      "summary": "摘要",
      ...
    }
  ],
  ...
}
```

## 四、验证清单

- [ ] LLM 正确返回章节分割行号
- [ ] 程序正确按行号分割原文
- [ ] 章节节点包含完整原文内容
- [ ] 章节节点包含 LLM 生成的摘要
- [ ] 人物、场景、道具提取正常
- [ ] TypeScript 类型检查通过

## 五、执行顺序

```
修改接口定义 → 修改提示词 → 新增分割函数 → 修改节点创建 → 验证
```
