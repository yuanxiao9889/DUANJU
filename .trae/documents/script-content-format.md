# 剧本内容格式优化计划

## 问题分析
AI 生成的剧本内容填充到章节正文编辑区后，没有段落显示和分割线，阅读体验差。

## 解决方案

### 方案：让 AI 输出 Markdown 格式 + 后处理转换

1. **修改 AI 提示词**：让 AI 输出 Markdown 格式的剧本内容
2. **后处理转换**：将 Markdown 转换为格式化的 HTML 填充到编辑器

### Markdown 格式设计

```markdown
## 场景一：咖啡馆 - 日 - 内

阳光透过落地窗洒进咖啡馆，轻柔的爵士乐在空气中流淌。

---

**小明**：（推门而入，环顾四周）这里环境不错。

**小红**：（招手）这边！

---

## 场景二：咖啡馆座位 - 日 - 内

小明走到小红对面的座位坐下。

**小明**：你来得真早。

**小红**：（微笑）因为期待今天的讨论。
```

### 格式特点
- `##` 用于场景标题
- `---` 用于场景分隔线
- `**角色名**：` 用于对白
- `（）` 用于动作/表情说明
- 空行分隔段落

## 实施步骤

### 步骤 1: 修改 textGen.ts 中的提示词
更新 `expandFromSummary` 函数的提示词，要求 AI 输出 Markdown 格式：

```typescript
const prompt = `你是一位专业的剧本编剧助手。请根据以下章节摘要，扩写成完整的剧本内容。

章节标题：${request.chapterTitle}
${request.chapterNumber ? `章节序号：第${request.chapterNumber}章` : ''}

章节摘要：
${request.summary}

${request.instruction ? `扩写要求：${request.instruction}` : ''}

请按照以下 Markdown 格式输出剧本内容：

## 场景X：地点 - 时间 - 内/外景

场景描述文字...

---

**角色名**：（动作/表情）对白内容

**角色名**：对白内容

---

## 场景Y：...

格式说明：
- 使用 ## 标记场景标题
- 使用 --- 分隔不同场景
- 使用 **角色名**： 标记对白
- 使用（）标记动作或表情说明
- 场景描述使用普通段落

请直接输出 Markdown 格式的剧本内容，不要添加任何解释。`;
```

### 步骤 2: 添加 Markdown 转 HTML 工具函数
创建 `src/utils/markdownToHtml.ts`：

```typescript
import { marked } from 'marked';

export function markdownToHtml(markdown: string): string {
  // 配置 marked 选项
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
  
  return marked.parse(markdown) as string;
}
```

### 步骤 3: 在 AiWriterDialog 中使用转换
修改 `handleGenerate` 函数，对 `expandFromSummary` 模式的结果进行 Markdown 转 HTML：

```typescript
if (mode === 'expandFromSummary') {
  const rawText = await expandFromSummary({...});
  generatedText = markdownToHtml(rawText);
}
```

### 步骤 4: 优化 CSS 样式（可选）
在 `index.css` 中为编辑器内的剧本内容添加样式：

```css
/* 剧本内容格式化 */
.prose hr {
  border-color: rgba(245, 158, 11, 0.3);
  margin: 1.5em 0;
}

.prose h2 {
  color: #f59e0b;
  border-bottom: 1px solid rgba(245, 158, 11, 0.2);
  padding-bottom: 0.5em;
}

.prose strong {
  color: #fbbf24;
}
```

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/commands/textGen.ts` | 修改提示词，要求输出 Markdown 格式 |
| `src/features/canvas/ui/AiWriterDialog.tsx` | 添加 Markdown 转 HTML 处理 |
| `src/index.css` | 添加剧本内容样式（可选） |

## 依赖说明
项目已有 `react-markdown` 依赖，但需要检查是否有 `marked` 库。如果没有，可以使用 `react-markdown` 的解析能力，或添加 `marked` 依赖。

### 备选方案：使用 react-markdown
如果不想添加新依赖，可以创建一个简单的 Markdown 解析函数：

```typescript
export function simpleMarkdownToHtml(text: string): string {
  return text
    // 场景标题
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // 分隔线
    .replace(/^---$/gm, '<hr>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 段落（空行分隔）
    .split('\n\n')
    .map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '')
    .join('\n');
}
```

## 预期效果
- 场景标题使用醒目的 H2 样式
- 场景之间有分隔线
- 角色名高亮显示
- 段落有合适的间距
- 整体阅读体验更佳
