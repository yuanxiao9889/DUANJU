# 剧本导入方案重新设计

## 一、设计原则

1. **保留原文**：章节内容原封不动保留，不做任何删减或改写
2. **LLM 辅助**：LLM 只负责判断分割点和提取资产信息，不修改原文
3. **程序执行**：程序负责按分割点切分原文并填入节点

## 二、现有数据结构

### 节点类型
| 节点类型 | 用途 | 关键字段 |
|---------|------|---------|
| ScriptRootNodeData | 剧本根节点 | title, genre, totalChapters |
| ScriptChapterNodeData | 章节节点 | content(原文), summary(摘要), characters, locations |
| ScriptCharacterNodeData | 人物节点 | name, description, personality, appearance |
| ScriptLocationNodeData | 场景节点 | name, description |
| ScriptItemNodeData | 道具节点 | name, description |
| ScriptWorldviewNodeData | 世界观节点 | worldviewName, era, technology, society |

## 三、导入流程设计

### 阶段一：文档解析（本地程序）

```
文件 → 解析为纯文本 → 返回 rawText
```

- 支持 TXT、DOCX、PDF、Markdown
- 返回原始文本内容，不做任何处理

### 阶段二：LLM 分析

**输入**：带行号的原文（前 500 行）

**输出**：
```json
{
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "第一章 开端",
      "startLine": 1,
      "endLine": 80,
      "summary": "简短摘要（50字以内）",
      "characters": ["张三", "李四"],
      "locations": ["城市A"]
    }
  ],
  "characters": [
    {
      "name": "张三",
      "description": "主角描述",
      "personality": "性格特点",
      "appearance": "外貌特征"
    }
  ],
  "locations": [...],
  "items": [...],
  "worldview": {...}
}
```

**关键点**：
- LLM 只返回行号范围，不返回章节内容
- 摘要控制在 50 字以内，避免过度概括
- 资产信息保持简洁

### 阶段三：程序分割（本地程序）

```typescript
function splitContentByChapters(rawText, chapters) {
  const lines = rawText.split('\n');
  
  return chapters.map(chapter => ({
    ...chapter,
    content: lines.slice(chapter.startLine - 1, chapter.endLine).join('\n')
  }));
}
```

### 阶段四：创建节点

```typescript
// 章节节点
{
  content: originalContent,  // 原文内容
  summary: llmSummary,       // LLM 摘要
  characters: [...],         // 出场人物
  locations: [...]           // 出现场景
}

// 人物节点
{
  name: characterName,
  description: llmDescription,
  ...
}
```

## 四、提示词优化

```
你是一位剧本分析师。请分析以下剧本，完成两个任务：

任务一：章节分割
- 判断如何分割章节（控制在 20 个以内）
- 返回每个章节的起始和结束行号
- 章节应该是一个完整的故事单元

任务二：资产提取
- 提取主要人物、场景、道具
- 提取世界观信息

重要：不要修改或概括原文内容，只返回行号范围和资产信息。

原文（带行号）:
1: 第一行内容
2: 第二行内容
...
```

## 五、修改文件

### 5.1 `documentParser.ts`
- 简化解析逻辑，只返回原始文本
- 移除场景分割逻辑

### 5.2 `scriptAnalyzer.ts`
- 优化提示词，强调不修改原文
- 简化摘要要求（50 字以内）
- 保留分割函数

### 5.3 `ScriptBiblePanel.tsx`
- 更新导入流程

## 六、验证清单

- [ ] 章节内容完整保留原文
- [ ] 摘要简洁（50 字以内）
- [ ] 人物、场景、道具正确提取
- [ ] 节点位置不重叠
- [ ] TypeScript 类型检查通过
