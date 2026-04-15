import {
  CANVAS_NODE_TYPES,
  createDefaultSceneCard,
  normalizeSceneCards,
  type CanvasEdge,
  type CanvasNode,
  type SceneCard,
} from '@/features/canvas/domain/canvasNodes';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  importScriptFile,
  type ImportedScriptChapter,
  type ImportedScriptDocument,
  type ImportedScriptScene,
  type ScriptImportFormat,
} from '@/features/canvas/application/scriptImporter';
import { generateText } from '@/commands/textGen';
import {
  NATIVE_SCRIPT_PACKAGE_SCHEMA,
  NATIVE_SCRIPT_PACKAGE_VERSION,
  type ExternalScriptChapterSegment,
  type ExternalScriptSceneSegment,
  type ExternalScriptStructureAnalysis,
  type NativeScriptPackageV1,
  type ScriptImportPreviewModel,
  type ScriptImportPreviewNotice,
} from '@/features/canvas/application/scriptImportExportTypes';

const IMPORT_ROOT_X = 100;
const IMPORT_ROOT_WIDTH = 320;
const IMPORT_ROOT_HEIGHT = 120;
const IMPORT_CHAPTER_X_GAP = 150;
const IMPORT_CHAPTER_Y = 100;
const IMPORT_CHAPTER_HEIGHT = 380;
const IMPORT_CHAPTER_GAP = 60;

const NATIVE_PACKAGE_NODE_TYPES = new Set<string>([
  CANVAS_NODE_TYPES.scriptRoot,
  CANVAS_NODE_TYPES.scriptChapter,
  CANVAS_NODE_TYPES.scriptScene,
  CANVAS_NODE_TYPES.shootingScript,
  CANVAS_NODE_TYPES.scriptWorldview,
  CANVAS_NODE_TYPES.scriptCharacter,
  CANVAS_NODE_TYPES.scriptLocation,
  CANVAS_NODE_TYPES.scriptItem,
  CANVAS_NODE_TYPES.scriptPlotPoint,
]);

export class MissingScriptImportModelError extends Error {
  readonly code = 'missing_script_model';

  constructor() {
    super('Missing configured script model for external import.');
    this.name = 'MissingScriptImportModelError';
  }
}

interface ExternalImportSource {
  sourceName: string;
  title: string;
  format: ScriptImportFormat;
  rawText: string;
  lines: string[];
}

interface ExternalImportLlmOptions {
  provider: string;
  model: string;
}

interface ExternalAnalysisSceneCandidate {
  title?: string;
  summary?: string;
  startLine?: number;
  endLine?: number;
}

interface ExternalAnalysisChapterCandidate {
  title?: string;
  summary?: string;
  startLine?: number;
  endLine?: number;
  scenes?: ExternalAnalysisSceneCandidate[];
}

interface ExternalAnalysisResponse {
  chapters?: ExternalAnalysisChapterCandidate[];
}

interface NormalizedExternalSceneStart {
  title: string;
  summary: string;
  startLine: number;
  order: number;
}

interface NormalizedExternalChapterStart {
  title: string;
  summary: string;
  startLine: number;
  scenes: ExternalAnalysisSceneCandidate[];
  order: number;
}

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

function linesToHtml(lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }

  return lines.map((line) => {
    if (!line.trim()) {
      return '<p><br /></p>';
    }

    const heading = matchMarkdownHeading(line);
    if (heading) {
      const tag = heading.level <= 2 ? 'h2' : 'h3';
      return `<${tag}>${escapeHtml(heading.text)}</${tag}>`;
    }

    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function createNotice(
  kind: ScriptImportPreviewNotice['kind'],
  code: string,
  message: string
): ScriptImportPreviewNotice {
  return { kind, code, message };
}

function createEdge(source: string, target: string): CanvasEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'disconnectableEdge',
  };
}

function resolveExternalFormat(fileName: string): ScriptImportFormat | null {
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
      return null;
  }
}

function extractFdxParagraphText(paragraph: Element): string {
  const textNodes = Array.from(paragraph.getElementsByTagName('Text'));
  if (textNodes.length > 0) {
    return textNodes.map((node) => node.textContent ?? '').join('');
  }

  return paragraph.textContent ?? '';
}

async function readExternalImportSource(file: File): Promise<ExternalImportSource> {
  const format = resolveExternalFormat(file.name);
  if (!format) {
    throw new Error(`Unsupported script format: ${file.name}`);
  }

  if (format === 'docx') {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const rawText = normalizeLineEndings(result.value);
    return {
      sourceName: file.name,
      title: sanitizeFileStem(file.name),
      format,
      rawText,
      lines: rawText.split('\n'),
    };
  }

  if (format === 'fdx') {
    const parser = new DOMParser();
    const xmlDocument = parser.parseFromString(await file.text(), 'application/xml');
    const parserError = xmlDocument.querySelector('parsererror');
    if (parserError) {
      throw new Error('Failed to parse FDX file.');
    }

    const paragraphs = Array.from(xmlDocument.getElementsByTagName('Paragraph'))
      .map((paragraph) => ({
        type: paragraph.getAttribute('Type') ?? '',
        text: extractFdxParagraphText(paragraph).trim(),
      }))
      .filter((paragraph) => paragraph.text.length > 0);

    const title = paragraphs.find((paragraph) => paragraph.type.toLowerCase() === 'title')?.text
      || sanitizeFileStem(file.name);
    const rawText = normalizeLineEndings(paragraphs.map((paragraph) => paragraph.text).join('\n'));
    return {
      sourceName: file.name,
      title,
      format,
      rawText,
      lines: rawText.split('\n'),
    };
  }

  const rawText = normalizeLineEndings(await file.text());
  return {
    sourceName: file.name,
    title: sanitizeFileStem(file.name),
    format,
    rawText,
    lines: rawText.split('\n'),
  };
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractJsonValue(text: string): unknown {
  const normalized = stripMarkdownCodeFence(text);

  try {
    return JSON.parse(normalized);
  } catch {
    // noop
  }

  const objectMatch = normalized.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // noop
    }
  }

  return null;
}

function toPositiveLineNumber(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(Number(value));
  return normalized >= 1 ? normalized : null;
}

function normalizeSceneSegments(
  chapter: ExternalAnalysisChapterCandidate | undefined,
  chapterStartLine: number,
  chapterEndLine: number
): ExternalScriptSceneSegment[] {
  const rawScenes: ExternalAnalysisSceneCandidate[] = Array.isArray(chapter?.scenes)
    ? chapter.scenes
    : [];
  const sortedStarts: NormalizedExternalSceneStart[] = rawScenes
    .map((scene: ExternalAnalysisSceneCandidate, index: number) => {
      const startLine = toPositiveLineNumber(scene.startLine) ?? (index === 0 ? chapterStartLine : null);
      if (startLine === null) {
        return null;
      }

      return {
        title: typeof scene.title === 'string' ? scene.title.trim() : '',
        summary: typeof scene.summary === 'string' ? scene.summary.trim() : '',
        startLine,
        order: index,
      };
    })
    .filter((scene): scene is NormalizedExternalSceneStart => scene !== null)
    .sort((left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
      }
      return left.order - right.order;
    });

  if (sortedStarts.length === 0) {
    return [{
      title: 'Scene 1',
      summary: '',
      startLine: chapterStartLine,
      endLine: chapterEndLine,
    }];
  }

  const uniqueStarts = sortedStarts.filter((scene, index) => (
    index === 0 || scene.startLine !== sortedStarts[index - 1].startLine
  ));

  return uniqueStarts.map((scene, index) => {
    const nextStart = uniqueStarts[index + 1]?.startLine ?? (chapterEndLine + 1);
    const startLine = index === 0
      ? chapterStartLine
      : Math.max(chapterStartLine, Math.min(scene.startLine, chapterEndLine));
    const endLine = Math.max(startLine, Math.min(chapterEndLine, nextStart - 1));

    return {
      title: scene.title || `Scene ${index + 1}`,
      summary: scene.summary,
      startLine,
      endLine,
    };
  });
}

function normalizeChapterSegments(
  lineCount: number,
  rawResponse: ExternalAnalysisResponse
): ExternalScriptStructureAnalysis {
  const rawChapters: ExternalAnalysisChapterCandidate[] = Array.isArray(rawResponse.chapters)
    ? rawResponse.chapters
    : [];
  const sortedStarts: NormalizedExternalChapterStart[] = rawChapters
    .map((chapter: ExternalAnalysisChapterCandidate, index: number) => {
      const startLine = toPositiveLineNumber(chapter.startLine) ?? (index === 0 ? 1 : null);
      if (startLine === null) {
        return null;
      }

      return {
        title: typeof chapter.title === 'string' ? chapter.title.trim() : '',
        summary: typeof chapter.summary === 'string' ? chapter.summary.trim() : '',
        startLine,
        scenes: Array.isArray(chapter.scenes) ? chapter.scenes : [],
        order: index,
      };
    })
    .filter((chapter): chapter is NormalizedExternalChapterStart => chapter !== null)
    .sort((left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
      }
      return left.order - right.order;
    });

  if (sortedStarts.length === 0) {
    throw new Error('LLM did not return usable chapter ranges.');
  }

  const uniqueStarts = sortedStarts.filter((chapter, index) => (
    index === 0 || chapter.startLine !== sortedStarts[index - 1].startLine
  ));

  return {
    chapters: uniqueStarts.map((chapter, index) => {
      const nextStart = uniqueStarts[index + 1]?.startLine ?? (lineCount + 1);
      const startLine = index === 0
        ? 1
        : Math.max(1, Math.min(chapter.startLine, lineCount));
      const endLine = Math.max(startLine, Math.min(lineCount, nextStart - 1));

      return {
        title: chapter.title || `Chapter ${index + 1}`,
        summary: chapter.summary,
        startLine,
        endLine,
        scenes: normalizeSceneSegments(chapter, startLine, endLine),
      };
    }),
  };
}

function buildImportedSceneFromSegment(
  segment: ExternalScriptSceneSegment,
  lines: string[]
): ImportedScriptScene {
  const contentLines = lines.slice(segment.startLine - 1, segment.endLine);
  const plainText = contentLines.join('\n').trim();

  return {
    title: segment.title,
    plainText,
    draftHtml: linesToHtml(contentLines),
    summary: segment.summary || summarizeText(plainText, segment.title),
  };
}

function buildImportedChapterFromSegment(
  segment: ExternalScriptChapterSegment,
  lines: string[]
): ImportedScriptChapter {
  const contentLines = lines.slice(segment.startLine - 1, segment.endLine);
  const plainText = contentLines.join('\n').trim();

  return {
    title: segment.title,
    plainText,
    contentHtml: linesToHtml(contentLines),
    summary: segment.summary || summarizeText(plainText, segment.title),
    scenes: segment.scenes.map((scene) => buildImportedSceneFromSegment(scene, lines)),
  };
}

async function analyzeExternalImportStructure(
  source: ExternalImportSource,
  llm: ExternalImportLlmOptions
): Promise<ExternalScriptStructureAnalysis> {
  const numberedLines = source.lines
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');

  const prompt = [
    '你是一名专业的剧本结构分析助手。',
    '任务不是改写正文，而是定位原文里的章节和场景区段。',
    '必须只返回区段定位信息，不能重写、润色、补写正文。',
    '所有正文内容后续都会直接从原文切片，所以请尽量保证区段起点准确。',
    '',
    '硬性要求：',
    '1. 只输出 JSON，不要输出 Markdown 代码块或解释。',
    '2. 必须覆盖全文，不要遗漏，不要重叠。',
    '3. 章节和场景都要给出 startLine / endLine，行号从 1 开始。',
    '4. 如果无法可靠识别章节，至少返回 1 个章节覆盖全文。',
    '5. 每个章节里至少返回 1 个场景，场景也必须覆盖对应章节全文。',
    '6. title 和 summary 可以概括，但不能改写正文。',
    '7. 输出语言尽量与原文保持一致。',
    '',
    '输出 JSON 结构：',
    '{',
    '  "chapters": [',
    '    {',
    '      "title": "章节标题",',
    '      "summary": "章节摘要",',
    '      "startLine": 1,',
    '      "endLine": 120,',
    '      "scenes": [',
    '        {',
    '          "title": "场景标题",',
    '          "summary": "场景摘要",',
    '          "startLine": 1,',
    '          "endLine": 20',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    `剧本标题：${source.title}`,
    `源文件：${source.sourceName}`,
    `总行数：${source.lines.length}`,
    '',
    '原文（带行号）：',
    numberedLines,
  ].join('\n');

  const result = await generateText({
    prompt,
    provider: llm.provider,
    model: llm.model,
    temperature: 0.2,
    maxTokens: 4096,
  });
  const parsed = extractJsonValue(result.text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM returned invalid structure JSON.');
  }

  return normalizeChapterSegments(source.lines.length, parsed as ExternalAnalysisResponse);
}

function buildExternalImportedDocument(
  source: ExternalImportSource,
  analysis: ExternalScriptStructureAnalysis
): ImportedScriptDocument {
  const chapters = analysis.chapters.map((chapter) => buildImportedChapterFromSegment(chapter, source.lines));
  const sceneCount = chapters.reduce((count, chapter) => count + chapter.scenes.length, 0);

  return {
    title: source.title,
    sourceName: source.sourceName,
    format: source.format,
    chapters,
    warnings: [],
    stats: {
      chapterCount: chapters.length,
      sceneCount,
      wordCount: countWords(source.rawText),
    },
  };
}

function buildSceneCards(sourceName: string, scenes: ImportedScriptScene[]): SceneCard[] {
  return scenes.map((scene, sceneIndex) => ({
    ...createDefaultSceneCard(sceneIndex),
    title: scene.title,
    summary: scene.summary,
    draftHtml: scene.draftHtml,
    sourceDraftHtml: scene.draftHtml,
    sourceDraftLabel: sourceName,
    status: 'drafting',
  }));
}

function buildExternalImportGraph(document: ImportedScriptDocument) {
  const chapterCount = document.chapters.length;
  const totalChaptersHeight =
    chapterCount * IMPORT_CHAPTER_HEIGHT + Math.max(0, chapterCount - 1) * IMPORT_CHAPTER_GAP;
  const rootY = IMPORT_CHAPTER_Y + totalChaptersHeight / 2 - IMPORT_ROOT_HEIGHT / 2;
  const chapterX = IMPORT_ROOT_X + IMPORT_ROOT_WIDTH + IMPORT_CHAPTER_X_GAP;

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  const rootNode = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.scriptRoot, {
    x: IMPORT_ROOT_X,
    y: rootY,
  }, {
    displayName: document.title,
    title: document.title,
    genre: '',
    totalChapters: chapterCount,
    premise: '',
    theme: '',
    protagonist: '',
    want: '',
    need: '',
    stakes: '',
    tone: '',
    directorVision: '',
    beats: [],
    assetLibraryCharacters: [],
    assetLibraryLocations: [],
    assetLibraryItems: [],
  });
  nodes.push(rootNode);

  let firstChapterId: string | null = null;

  document.chapters.forEach((chapter, index) => {
    const chapterNode = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.scriptChapter, {
      x: chapterX,
      y: IMPORT_CHAPTER_Y + index * (IMPORT_CHAPTER_HEIGHT + IMPORT_CHAPTER_GAP),
    }, {
      displayName: `Chapter ${index + 1} ${chapter.title}`.trim(),
      chapterNumber: index + 1,
      title: chapter.title,
      summary: chapter.summary,
      chapterPurpose: '',
      chapterQuestion: '',
      content: chapter.contentHtml,
      sceneHeadings: chapter.scenes
        .map((scene) => scene.title.trim())
        .filter((value) => value.length > 0),
      scenes: buildSceneCards(document.sourceName, chapter.scenes),
      characters: [],
      locations: [],
      items: [],
      emotionalShift: '',
      isBranchPoint: false,
      branchType: 'main',
      depth: 1,
      tables: [],
      plotPoints: [],
    });

    if (!firstChapterId) {
      firstChapterId = chapterNode.id;
    }

    nodes.push(chapterNode);
    edges.push(createEdge(rootNode.id, chapterNode.id));
  });

  return {
    nodes,
    edges,
    selectedNodeId: firstChapterId ?? rootNode.id,
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function isNativeScriptPackage(value: unknown): value is NativeScriptPackageV1 {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.schema === NATIVE_SCRIPT_PACKAGE_SCHEMA
    && record.version === NATIVE_SCRIPT_PACKAGE_VERSION
    && record.projectType === 'script'
    && Array.isArray(record.nodes)
    && Array.isArray(record.edges);
}

function filterNativePackageNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter((node) => NATIVE_PACKAGE_NODE_TYPES.has(node.type));
}

function filterNativePackageEdges(edges: CanvasEdge[], nodes: CanvasNode[]): CanvasEdge[] {
  const validNodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target));
}

function buildNativePackagePreviewDocument(
  nativePackage: NativeScriptPackageV1,
  nodes: CanvasNode[]
): ScriptImportPreviewModel['document'] {
  const rootNode = nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot);
  const chapters = nodes
    .filter((node) => node.type === CANVAS_NODE_TYPES.scriptChapter)
    .sort((left, right) => {
      const leftNumber = Number((left.data as { chapterNumber?: unknown }).chapterNumber) || 0;
      const rightNumber = Number((right.data as { chapterNumber?: unknown }).chapterNumber) || 0;
      return leftNumber - rightNumber;
    })
    .map((chapterNode): ImportedScriptChapter => {
      const data = chapterNode.data as {
        title?: string;
        content?: string;
        summary?: string;
        scenes?: unknown;
      };
      const scenes = normalizeSceneCards(data.scenes, data.content).map((scene) => ({
        title: scene.title,
        plainText: htmlToPlainText(scene.draftHtml),
        draftHtml: scene.draftHtml,
        summary: scene.summary,
      }));

      return {
        title: data.title?.trim() || 'Untitled Chapter',
        plainText: htmlToPlainText(data.content ?? ''),
        contentHtml: data.content ?? '',
        summary: data.summary?.trim() || '',
        scenes,
      };
    });

  const title = nativePackage.title
    || (rootNode?.data as { title?: string } | undefined)?.title?.trim()
    || 'Imported Script';

  return {
    title,
    sourceName: title,
    format: 'nativePackage',
    chapters,
    warnings: [],
    stats: {
      chapterCount: chapters.length,
      sceneCount: chapters.reduce((count, chapter) => count + chapter.scenes.length, 0),
      wordCount: countWords(chapters.map((chapter) => chapter.plainText).join('\n')),
    },
  };
}

function buildNativePackagePreview(
  nativePackage: NativeScriptPackageV1,
  sourceName: string
): ScriptImportPreviewModel {
  const nodes = filterNativePackageNodes(nativePackage.nodes);
  const edges = filterNativePackageEdges(nativePackage.edges, nodes);
  const document = buildNativePackagePreviewDocument(nativePackage, nodes);
  const assetNodeCount = nodes.filter((node) => (
    node.type === CANVAS_NODE_TYPES.scriptWorldview
    || node.type === CANVAS_NODE_TYPES.scriptCharacter
    || node.type === CANVAS_NODE_TYPES.scriptLocation
    || node.type === CANVAS_NODE_TYPES.scriptItem
    || node.type === CANVAS_NODE_TYPES.scriptPlotPoint
  )).length;
  const selectedNodeId =
    nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot)?.id
    ?? nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptChapter)?.id
    ?? nodes[0]?.id
    ?? null;

  return {
    kind: 'nativePackage',
    title: document.title,
    sourceName,
    description: 'This native package will fully restore script nodes, shooting scripts, assets, edges, and layout.',
    format: 'nativePackage',
    document,
    notices: [
      createNotice('info', 'replace_current_content', 'Importing will replace the current script content.'),
    ],
    stats: {
      chapterCount: document.stats.chapterCount,
      sceneCount: document.stats.sceneCount,
      wordCount: document.stats.wordCount,
      scriptSceneNodeCount: nodes.filter((node) => node.type === CANVAS_NODE_TYPES.scriptScene).length,
      shootingScriptNodeCount: nodes.filter((node) => node.type === CANVAS_NODE_TYPES.shootingScript).length,
      assetNodeCount,
      edgeCount: edges.length,
    },
    details: [
      { label: 'Schema', value: nativePackage.schema },
      { label: 'Version', value: String(nativePackage.version) },
      { label: 'Exported At', value: formatDateTime(nativePackage.exportedAt) },
      { label: 'Nodes', value: String(nodes.length) },
      { label: 'Edges', value: String(edges.length) },
    ],
    nativePackage: {
      schema: nativePackage.schema,
      version: nativePackage.version,
      exportedAt: nativePackage.exportedAt,
      appVersion: nativePackage.appVersion,
      projectType: nativePackage.projectType,
    },
    usedFallback: false,
    applyPayload: {
      nodes,
      edges,
      selectedNodeId,
    },
  };
}

async function readNativePackage(file: File): Promise<NativeScriptPackageV1 | null> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension !== 'json') {
    return null;
  }

  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The selected JSON file is not a valid native script package.');
  }

  if (!isNativeScriptPackage(parsed)) {
    throw new Error('Unsupported native package schema or version.');
  }

  return parsed;
}

async function buildExternalImportPreview(
  file: File,
  llm: ExternalImportLlmOptions | null
): Promise<ScriptImportPreviewModel> {
  if (!llm) {
    throw new MissingScriptImportModelError();
  }

  const [source, fallbackDocument] = await Promise.all([
    readExternalImportSource(file),
    importScriptFile(file),
  ]);

  const notices: ScriptImportPreviewNotice[] = [
    createNotice('info', 'replace_current_content', 'Importing will replace the current script content.'),
  ];

  let document = fallbackDocument;
  let usedFallback = false;

  try {
    const analysis = await analyzeExternalImportStructure(source, llm);
    document = buildExternalImportedDocument(source, analysis);
    if (source.format === 'docx') {
      notices.push(createNotice(
        'info',
        'docx_formatting_simplified',
        'DOCX import preserves text first. Some Word-specific formatting may be simplified.'
      ));
    }
  } catch (error) {
    usedFallback = true;
    const message = error instanceof Error
      ? error.message
      : 'LLM structure analysis failed.';
    notices.push(createNotice(
      'warning',
      'llm_analysis_failed',
      `LLM structure analysis failed and the import preview has fallen back to heuristic parsing: ${message}`
    ));
    fallbackDocument.warnings.forEach((warning) => {
      notices.push(createNotice('info', warning, warning));
    });
  }

  const graph = buildExternalImportGraph(document);

  return {
    kind: 'external',
    title: document.title,
    sourceName: file.name,
    description: 'External import keeps only the script root, chapter nodes, and chapter scene content. It will not auto-create scene nodes or shooting-script nodes.',
    format: document.format,
    document: {
      ...document,
      format: document.format,
    },
    notices,
    stats: {
      chapterCount: document.stats.chapterCount,
      sceneCount: document.stats.sceneCount,
      wordCount: document.stats.wordCount,
      scriptSceneNodeCount: 0,
      shootingScriptNodeCount: 0,
      assetNodeCount: 0,
      edgeCount: graph.edges.length,
    },
    details: [
      { label: 'Format', value: document.format },
      { label: 'Chapters', value: String(document.stats.chapterCount) },
      { label: 'Scenes', value: String(document.stats.sceneCount) },
      { label: 'Words', value: String(document.stats.wordCount) },
    ],
    usedFallback,
    applyPayload: graph,
  };
}

export async function prepareScriptImportPreview(
  file: File,
  options?: {
    llm?: ExternalImportLlmOptions | null;
  }
): Promise<ScriptImportPreviewModel> {
  const nativePackage = await readNativePackage(file).catch((error) => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (extension === 'json') {
      throw error;
    }
    return null;
  });

  if (nativePackage) {
    return buildNativePackagePreview(nativePackage, file.name);
  }

  return buildExternalImportPreview(file, options?.llm ?? null);
}

export function applyScriptImportPreview(
  preview: ScriptImportPreviewModel
): ScriptImportPreviewModel['applyPayload'] {
  return preview.applyPayload;
}
