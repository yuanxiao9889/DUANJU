export type ScriptImportFormat = 'txt' | 'markdown' | 'fountain' | 'fdx' | 'docx';

export type ScriptImportWarningCode =
  | 'preserved_as_single_chapter'
  | 'preserved_as_single_scene'
  | 'scene_split_is_heuristic'
  | 'docx_formatting_simplified'
  | 'fdx_without_scene_headings';

export interface ImportedScriptScene {
  title: string;
  draftHtml: string;
  plainText: string;
  summary: string;
}

export interface ImportedScriptChapter {
  title: string;
  contentHtml: string;
  plainText: string;
  summary: string;
  scenes: ImportedScriptScene[];
}

export interface ImportedScriptDocument {
  title: string;
  sourceName: string;
  format: ScriptImportFormat;
  chapters: ImportedScriptChapter[];
  warnings: ScriptImportWarningCode[];
  stats: {
    chapterCount: number;
    sceneCount: number;
    wordCount: number;
  };
}

interface TextImportOptions {
  sourceName: string;
  format: Exclude<ScriptImportFormat, 'fdx'>;
}

interface ParagraphLike {
  type?: string;
  text: string;
}

interface ChapterCandidate {
  title: string;
  lines: string[];
}

interface SceneCandidate {
  title: string;
  lines: string[];
}

const SCREENPLAY_SCENE_HEADING_PATTERN =
  /^(?:#{2,6}\s*)?(?:(?:INT|EXT|EST|INT\/EXT|I\/E)\.?|内景|外景|内\/外景|外\/内景|场景)\b/i;

const IMPORTED_SCENE_LABEL_PATTERN =
  /^(?:#{2,6}\s*)?(?:scene|场景)\s*[\d一二三四五六七八九十百千零]*\s*[:：\-]?\s*/i;

const CHAPTER_HEADING_PATTERN =
  /^(?:#{1,3}\s*)?(?:(?:chapter|act)\s+[\w一二三四五六七八九十百千零\d]+(?:\s*[:：\-]\s*.*)?|第[\d一二三四五六七八九十百千零]+[章节幕回].*)$/i;

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function normalizeLineEndings(text: string): string {
  return stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sanitizeFileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'Imported Script';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function countWords(text: string): number {
  const tokens = text.match(/[\u3400-\u9fff]|[A-Za-z0-9_]+/g);
  return tokens?.length ?? 0;
}

function summarizeText(text: string, fallback: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 80
    ? `${normalized.slice(0, 80).trim()}...`
    : normalized;
}

function matchMarkdownHeading(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

function stripHeadingMarkup(line: string): string {
  const markdownHeading = matchMarkdownHeading(line);
  if (markdownHeading) {
    return markdownHeading.text;
  }

  return line.trim();
}

function isChapterHeading(line: string): boolean {
  const normalized = stripHeadingMarkup(line);
  return CHAPTER_HEADING_PATTERN.test(normalized);
}

function isSceneHeading(line: string): boolean {
  const normalized = stripHeadingMarkup(line);
  return SCREENPLAY_SCENE_HEADING_PATTERN.test(normalized)
    || IMPORTED_SCENE_LABEL_PATTERN.test(normalized);
}

function isCharacterCue(line: string): boolean {
  const normalized = line.trim();
  if (!normalized || normalized.length > 36 || isSceneHeading(normalized)) {
    return false;
  }

  return /^[A-Z0-9\u3400-\u9fff .'\-()]+$/.test(normalized)
    && normalized === normalized.toUpperCase();
}

function linesToHtml(lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }

  return lines.map((line) => {
    if (!line.trim()) {
      return '<p><br /></p>';
    }

    const markdownHeading = matchMarkdownHeading(line);
    if (markdownHeading) {
      const tag = markdownHeading.level <= 2 ? 'h2' : 'h3';
      return `<${tag}>${escapeHtml(markdownHeading.text)}</${tag}>`;
    }

    const escapedLine = escapeHtml(line);

    if (isSceneHeading(line) || isCharacterCue(line)) {
      return `<p><strong>${escapedLine}</strong></p>`;
    }

    return `<p>${escapedLine}</p>`;
  }).join('');
}

function resolveDocumentTitle(lines: string[], fileStem: string): { title: string; lines: string[] } {
  const nextLines = [...lines];

  while (nextLines.length > 0 && !nextLines[0].trim()) {
    nextLines.shift();
  }

  const firstLine = nextLines[0]?.trim() ?? '';
  const markdownHeading = matchMarkdownHeading(firstLine);
  if (markdownHeading?.level === 1) {
    nextLines.shift();
    return { title: markdownHeading.text, lines: nextLines };
  }

  const titleMatch = firstLine.match(/^title\s*:\s*(.+)$/i);
  if (titleMatch) {
    nextLines.shift();
    return { title: titleMatch[1].trim(), lines: nextLines };
  }

  return { title: fileStem, lines: nextLines };
}

function splitIntoChapters(lines: string[], fallbackTitle: string): ChapterCandidate[] {
  const chapters: ChapterCandidate[] = [];
  let currentTitle = fallbackTitle;
  let currentLines: string[] = [];
  let foundChapterHeading = false;

  for (const line of lines) {
    if (isChapterHeading(line)) {
      foundChapterHeading = true;
      if (currentLines.length > 0) {
        chapters.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = stripHeadingMarkup(line);
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0 || chapters.length === 0) {
    chapters.push({ title: currentTitle, lines: currentLines });
  }

  if (!foundChapterHeading && chapters.length === 0) {
    chapters.push({ title: fallbackTitle, lines });
  }

  return chapters;
}

function splitIntoScenes(lines: string[], fallbackTitle: string): {
  scenes: SceneCandidate[];
  foundSceneHeading: boolean;
} {
  const scenes: SceneCandidate[] = [];
  let currentTitle = fallbackTitle;
  let currentLines: string[] = [];
  let foundSceneHeading = false;

  for (const line of lines) {
    if (isSceneHeading(line)) {
      foundSceneHeading = true;
      if (currentLines.length > 0) {
        scenes.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = stripHeadingMarkup(line);
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0 || scenes.length === 0) {
    scenes.push({ title: currentTitle, lines: currentLines });
  }

  return { scenes, foundSceneHeading };
}

function buildImportedScene(scene: SceneCandidate, fallbackTitle: string): ImportedScriptScene {
  const plainText = scene.lines.join('\n').trim();
  const title = scene.title.trim() || fallbackTitle;

  return {
    title,
    plainText,
    draftHtml: linesToHtml(scene.lines),
    summary: summarizeText(plainText, title),
  };
}

function buildImportedChapter(
  chapter: ChapterCandidate,
  fallbackTitle: string
): { chapter: ImportedScriptChapter; foundSceneHeading: boolean } {
  const plainText = chapter.lines.join('\n').trim();
  const chapterTitle = chapter.title.trim() || fallbackTitle;
  const { scenes, foundSceneHeading } = splitIntoScenes(chapter.lines, `${chapterTitle} Scene`);

  return {
    foundSceneHeading,
    chapter: {
      title: chapterTitle,
      plainText,
      contentHtml: linesToHtml(chapter.lines),
      summary: summarizeText(plainText, chapterTitle),
      scenes: scenes.map((scene, index) =>
        buildImportedScene(scene, `${chapterTitle} Scene ${index + 1}`)
      ),
    },
  };
}

function parseTextBasedScript(
  text: string,
  options: TextImportOptions
): ImportedScriptDocument {
  const normalizedText = normalizeLineEndings(text);
  const fileStem = sanitizeFileStem(options.sourceName);
  const { title, lines } = resolveDocumentTitle(normalizedText.split('\n'), fileStem);
  const warnings = new Set<ScriptImportWarningCode>();
  const chapterCandidates = splitIntoChapters(lines, 'Imported Chapter');

  if (chapterCandidates.length <= 1) {
    warnings.add('preserved_as_single_chapter');
  }

  let foundSceneHeadingAnywhere = false;
  const chapters = chapterCandidates.map((chapterCandidate, index) => {
    const { chapter, foundSceneHeading } = buildImportedChapter(
      chapterCandidate,
      `Chapter ${index + 1}`
    );
    foundSceneHeadingAnywhere = foundSceneHeadingAnywhere || foundSceneHeading;
    return chapter;
  });

  if (!foundSceneHeadingAnywhere) {
    warnings.add('preserved_as_single_scene');
  } else if (options.format !== 'fountain') {
    warnings.add('scene_split_is_heuristic');
  }

  const sceneCount = chapters.reduce((count, chapter) => count + chapter.scenes.length, 0);
  const wordCount = countWords(normalizedText);

  return {
    title,
    sourceName: options.sourceName,
    format: options.format,
    chapters,
    warnings: Array.from(warnings),
    stats: {
      chapterCount: chapters.length,
      sceneCount,
      wordCount,
    },
  };
}

function extractFdxParagraphText(paragraph: Element): string {
  const textNodes = Array.from(paragraph.getElementsByTagName('Text'));
  if (textNodes.length > 0) {
    return textNodes.map((node) => node.textContent ?? '').join('');
  }

  return paragraph.textContent ?? '';
}

function buildFdxSceneTitle(lines: string[], fallbackTitle: string): string {
  const explicitHeading = lines.find((line) => isSceneHeading(line));
  return explicitHeading ? stripHeadingMarkup(explicitHeading) : fallbackTitle;
}

function parseFdxScript(text: string, sourceName: string): ImportedScriptDocument {
  const parser = new DOMParser();
  const xmlDocument = parser.parseFromString(text, 'application/xml');
  const parserError = xmlDocument.querySelector('parsererror');
  if (parserError) {
    throw new Error('Failed to parse FDX file.');
  }

  const paragraphs = Array.from(xmlDocument.getElementsByTagName('Paragraph'))
    .map((paragraph) => ({
      type: paragraph.getAttribute('Type') ?? undefined,
      text: extractFdxParagraphText(paragraph).trim(),
    }))
    .filter((paragraph) => paragraph.text.length > 0);

  const titleParagraph = paragraphs.find((paragraph) => paragraph.type?.toLowerCase() === 'title');
  const title = titleParagraph?.text || sanitizeFileStem(sourceName);
  const warnings = new Set<ScriptImportWarningCode>(['preserved_as_single_chapter']);

  const scenes: ParagraphLike[][] = [];
  let currentScene: ParagraphLike[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.type?.toLowerCase() === 'scene heading' && currentScene.length > 0) {
      scenes.push(currentScene);
      currentScene = [paragraph];
      continue;
    }

    currentScene.push(paragraph);
  }

  if (currentScene.length > 0) {
    scenes.push(currentScene);
  }

  if (!paragraphs.some((paragraph) => paragraph.type?.toLowerCase() === 'scene heading')) {
    warnings.add('fdx_without_scene_headings');
    warnings.add('preserved_as_single_scene');
  }

  const importedScenes = (scenes.length > 0 ? scenes : [paragraphs]).map((sceneParagraphs, index) => {
    const lines = sceneParagraphs.map((paragraph) => paragraph.text);
    const plainText = lines.join('\n').trim();
    const titleFallback = `Scene ${index + 1}`;
    const sceneTitle = buildFdxSceneTitle(lines, titleFallback);

    return {
      title: sceneTitle,
      plainText,
      draftHtml: linesToHtml(lines),
      summary: summarizeText(plainText, sceneTitle),
    } satisfies ImportedScriptScene;
  });

  const chapterPlainText = paragraphs.map((paragraph) => paragraph.text).join('\n').trim();
  const chapterTitle = 'Imported Draft';

  return {
    title,
    sourceName,
    format: 'fdx',
    chapters: [
      {
        title: chapterTitle,
        plainText: chapterPlainText,
        contentHtml: linesToHtml(paragraphs.map((paragraph) => paragraph.text)),
        summary: summarizeText(chapterPlainText, chapterTitle),
        scenes: importedScenes,
      },
    ],
    warnings: Array.from(warnings),
    stats: {
      chapterCount: 1,
      sceneCount: importedScenes.length,
      wordCount: countWords(chapterPlainText),
    },
  };
}

async function parseDocxScript(file: File): Promise<ImportedScriptDocument> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const parsed = parseTextBasedScript(result.value, {
    sourceName: file.name,
    format: 'docx',
  });

  return {
    ...parsed,
    warnings: Array.from(new Set([...parsed.warnings, 'docx_formatting_simplified'])),
  };
}

function resolveImportFormat(fileName: string): ScriptImportFormat {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  switch (extension) {
    case 'txt':
      return 'txt';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'fountain':
    case 'spmd':
      return 'fountain';
    case 'fdx':
      return 'fdx';
    case 'docx':
      return 'docx';
    default:
      throw new Error(`Unsupported script format: .${extension || 'unknown'}`);
  }
}

export async function importScriptFile(file: File): Promise<ImportedScriptDocument> {
  const format = resolveImportFormat(file.name);

  if (format === 'fdx') {
    return parseFdxScript(await file.text(), file.name);
  }

  if (format === 'docx') {
    return parseDocxScript(file);
  }

  return parseTextBasedScript(await file.text(), {
    sourceName: file.name,
    format,
  });
}
