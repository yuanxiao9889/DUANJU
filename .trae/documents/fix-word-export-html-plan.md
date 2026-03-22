# 修复 Word 导出 HTML 标签问题计划

## 问题描述
导出的 Word 格式剧本中，HTML 标签（如 `<h2>`, `<p>`, `<hr>`, `<strong>` 等）被原样输出，而不是被转换为 Word 格式。

## 问题原因
章节内容以 HTML 格式存储在 `ScriptChapterNodeData.content` 字段中，但在 `scriptExporter.ts` 的 `exportAsDocx` 函数中，HTML 内容被直接作为纯文本处理：

```typescript
if (chapter.data.content) {
  docChildren.push(new Paragraph({ text: chapter.data.content })); // ← 问题所在
}
```

## 解决方案

### 方案：添加 HTML 解析器

在 `scriptExporter.ts` 中添加一个 HTML 解析函数，将 HTML 元素转换为 `docx` 库的结构化内容：

| HTML 元素 | docx 对应结构 |
|-----------|---------------|
| `<p>` | `Paragraph` |
| `<h2>` | `Paragraph` + `HeadingLevel.HEADING_2` |
| `<strong>` / `<b>` | `TextRun` + `bold: true` |
| `<br>` | 换行或新段落 |
| `<hr>` | 分隔线段落 |
| `<em>` / `<i>` | `TextRun` + `italics: true` |

## 实现步骤

### 1. 添加 HTML 解析函数

**文件**: `src/features/canvas/application/scriptExporter.ts`

添加 `parseHtmlToDocxParagraphs` 函数：
- 解析 HTML 字符串
- 将 HTML 元素转换为 `Paragraph` 数组
- 处理内联样式（粗体、斜体）
- 处理块级元素（段落、标题、分隔线）

### 2. 修改 exportAsDocx 函数

将原来的：
```typescript
if (chapter.data.content) {
  docChildren.push(new Paragraph({ text: chapter.data.content }));
}
```

改为：
```typescript
if (chapter.data.content) {
  const contentParagraphs = parseHtmlToDocxParagraphs(chapter.data.content);
  docChildren.push(...contentParagraphs);
}
```

### 3. 处理特殊字符

- 解码 HTML 实体（`&lt;`, `&gt;`, `&amp;`, `&nbsp;` 等）
- 处理嵌套标签

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/features/canvas/application/scriptExporter.ts` | 修改 | 添加 HTML 解析函数并修改导出逻辑 |

## 技术细节

### HTML 解析实现

使用浏览器内置的 `DOMParser` 解析 HTML：

```typescript
function parseHtmlToDocxParagraphs(html: string): Paragraph[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const paragraphs: Paragraph[] = [];
  
  // 遍历 DOM 节点，转换为 Paragraph
  function processNode(node: Node, textRuns: TextRun[]): void {
    // 处理文本节点
    // 处理元素节点（<strong>, <em>, <br> 等）
  }
  
  return paragraphs;
}
```

### 支持的 HTML 元素

| 元素 | 处理方式 |
|------|----------|
| `<p>` | 创建新段落 |
| `<h2>` | 创建标题段落 |
| `<strong>`, `<b>` | 粗体文本 |
| `<em>`, `<i>` | 斜体文本 |
| `<br>` | 换行 |
| `<hr>` | 分隔线 |
| 文本节点 | 普通文本 |

## 注意事项

1. **兼容性**：`DOMParser` 在浏览器和 Tauri WebView 中都可用
2. **性能**：HTML 解析应该足够快，因为章节内容通常不会太长
3. **错误处理**：解析失败时回退到纯文本输出
