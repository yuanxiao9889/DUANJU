# 剧本导入优化计划

## 一、需求分析

### 当前问题
1. **章节内容丢失**：当前导入时只保存 LLM 生成的摘要，原始内容被丢弃
2. **段落拆分不合理**：没有按原始段落结构拆分章节

### 期望行为
1. **保留原始内容**：章节节点 `content` 字段保存原始文本内容
2. **段落拆分**：按文档段落/场景拆分章节，每个段落/场景作为一个章节节点
3. **继续提取资产**：人物、场景、道具、世界观等资产提取保持不变
4. **导出 Markdown**：已支持，无需修改

## 二、修改方案

### 修改文件
1. `src/features/canvas/application/documentParser.ts` - 文档解析器
2. `src/features/canvas/application/scriptAnalyzer.ts` - 剧本分析器
3. `src/features/canvas/ui/ScriptBiblePanel.tsx` - 导入处理

### 具体修改

#### 2.1 修改文档解析器

**目标**：按段落/场景拆分文档，保留原始内容

```typescript
// 修改 ParsedScriptContent 接口
export interface ParsedScriptContent {
  title: string;
  rawText: string;
  scenes: ParsedScene[];
  paragraphs: ParsedParagraph[];  // 新增：段落列表
}

export interface ParsedParagraph {
  index: number;
  content: string;
  lineStart: number;
  lineEnd: number;
}
```

#### 2.2 修改剧本分析器

**目标**：
1. 章节分析结果包含原始内容
2. 资产提取保持不变

```typescript
// 修改 ChapterAnalysis 接口
export interface ChapterAnalysis {
  chapterNumber: number;
  title: string;
  content: string;        // 原始内容
  summary: string;        // LLM 生成的摘要
  setupPoints: string[];
  payoffPoints: string[];
  emotionalShift: string;
  characters: string[];
  locations: string[];
}

// 修改 createChapterNodesFromAnalysis 函数
// content 字段保存原始内容，而不是空字符串
```

#### 2.3 修改导入处理流程

**目标**：
1. 解析文档时保留段落内容
2. 创建章节节点时填入原始内容
3. LLM 分析只用于提取资产信息

```typescript
// 修改 handleImport 函数
const handleImport = useCallback(async (event) => {
  // 1. 解析文档，保留原始段落
  const parsed = await parseDocument(file);
  
  // 2. LLM 分析提取资产（人物、场景、道具、世界观）
  const analysis = await analyzeScript(parsed);
  
  // 3. 创建章节节点，填入原始内容
  const chapterNodes = createChapterNodesWithContent(parsed, analysis);
  
  // 4. 创建资产节点（保持不变）
  const characterNodes = createCharacterNodesFromAnalysis(analysis);
  // ...
}, []);
```

## 三、新增函数

### 3.1 createChapterNodesWithContent

```typescript
export function createChapterNodesWithContent(
  parsed: ParsedScriptContent,
  analysis: ScriptAnalysisResult
): Array<{ id: string; type: string; data: ScriptChapterNodeData; position: { x: number; y: number } }> {
  // 按段落/场景创建章节节点
  // 每个节点的 content 字段保存原始内容
  // summary 字段保存 LLM 生成的摘要（如果有）
}
```

## 四、验证清单

- [ ] 导入时章节内容完整保留
- [ ] 段落/场景正确拆分
- [ ] 人物资产正确提取
- [ ] 场景资产正确提取
- [ ] 道具资产正确提取
- [ ] 世界观资产正确提取
- [ ] 导出 Markdown 格式正常
- [ ] TypeScript 类型检查通过
