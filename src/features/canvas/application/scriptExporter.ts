import { invoke } from '@tauri-apps/api/core';
import type { Edge } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  normalizeEpisodeCards,
  normalizeSceneCards,
  normalizeShootingScriptRows,
  type CanvasEdge,
  type CanvasNode,
  type EpisodeCard,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
  type ShootingScriptNodeData,
  type ShootingScriptRow,
  type ShotRow,
} from '@/features/canvas/domain/canvasNodes';
import {
  NATIVE_SCRIPT_PACKAGE_SCHEMA,
  NATIVE_SCRIPT_PACKAGE_VERSION,
  type BranchInfo,
  type ExportFormat,
  type NativeScriptPackageV1,
  type ScriptExportChapterPreview,
  type ScriptExportPreviewModel,
  type ScriptExportTextUnit,
  type ShootingScriptSheetPreview,
} from '@/features/canvas/application/scriptImportExportTypes';

export type { ExportFormat } from '@/features/canvas/application/scriptImportExportTypes';

type DocxModule = typeof import('docx');

interface ChapterWithId {
  id: string;
  data: ScriptChapterNodeData;
}

interface SceneNodeWithId {
  id: string;
  data: ScriptSceneNodeData;
}

interface ShootingScriptNodeWithId {
  id: string;
  data: ShootingScriptNodeData;
}

interface ScriptData {
  root: ScriptRootNodeData | null;
  chapters: ChapterWithId[];
  sceneNodes: SceneNodeWithId[];
  shootingScriptNodes: ShootingScriptNodeWithId[];
}

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

const SHOOTING_SCRIPT_COLUMN_HEADERS: Array<{
  key: keyof ShootingScriptRow;
  label: string;
}> = [
  { key: 'shotNumber', label: 'Shot' },
  { key: 'beat', label: 'Beat' },
  { key: 'action', label: 'Action' },
  { key: 'composition', label: 'Composition' },
  { key: 'camera', label: 'Camera Move' },
  { key: 'duration', label: 'Duration' },
  { key: 'audio', label: 'Audio' },
  { key: 'blocking', label: 'Blocking' },
  { key: 'artLighting', label: 'Art / Lighting' },
  { key: 'continuityNote', label: 'Continuity Note' },
  { key: 'directorIntent', label: 'Director Intent' },
  { key: 'genTarget', label: 'Generation Target' },
  { key: 'genPrompt', label: 'Generation Prompt' },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&nbsp;': ' ',
    '&quot;': '"',
    '&#39;': '\'',
    '&apos;': '\'',
  };

  return text.replace(/&[^;]+;/g, (match) => entities[match] || match);
}

function coerceText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function htmlToPlainText(html: string | null | undefined): string {
  if (typeof html !== 'string' || !html.trim()) {
    return '';
  }

  return decodeHtmlEntities(
    html
      .replace(/<hr\s*\/?>/gi, '\n---\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

function parseHtmlToDocxParagraphs(html: string, docx: DocxModule): any[] {
  if (!html || !html.trim()) {
    return [];
  }

  const paragraphs: any[] = [];

  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(html, 'text/html');
    const body = document.body;

    function processInline(node: Node, runs: any[], bold = false, italics = false): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.trim()) {
          runs.push(new docx.TextRun({
            text: decodeHtmlEntities(text),
            bold,
            italics,
          }));
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'strong' || tagName === 'b') {
        Array.from(element.childNodes).forEach((child) => processInline(child, runs, true, italics));
        return;
      }

      if (tagName === 'em' || tagName === 'i') {
        Array.from(element.childNodes).forEach((child) => processInline(child, runs, bold, true));
        return;
      }

      if (tagName === 'br') {
        runs.push(new docx.TextRun({ text: '', break: 1 }));
        return;
      }

      Array.from(element.childNodes).forEach((child) => processInline(child, runs, bold, italics));
    }

    function processBlock(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          paragraphs.push(new docx.Paragraph({ text: decodeHtmlEntities(text) }));
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'h1' || tagName === 'h2') {
        const runs: any[] = [];
        Array.from(element.childNodes).forEach((child) => processInline(child, runs));
        if (runs.length > 0) {
          paragraphs.push(new docx.Paragraph({
            children: runs,
            heading: docx.HeadingLevel.HEADING_2,
          }));
        }
        return;
      }

      if (tagName === 'h3' || tagName === 'h4' || tagName === 'h5' || tagName === 'h6') {
        const runs: any[] = [];
        Array.from(element.childNodes).forEach((child) => processInline(child, runs));
        if (runs.length > 0) {
          paragraphs.push(new docx.Paragraph({
            children: runs,
            heading: docx.HeadingLevel.HEADING_3,
          }));
        }
        return;
      }

      if (tagName === 'p') {
        const runs: any[] = [];
        Array.from(element.childNodes).forEach((child) => processInline(child, runs));
        paragraphs.push(new docx.Paragraph({
          children: runs.length > 0 ? runs : [new docx.TextRun('')],
        }));
        return;
      }

      if (tagName === 'div' || tagName === 'section' || tagName === 'article') {
        Array.from(element.childNodes).forEach((child) => processBlock(child));
        return;
      }

      const runs: any[] = [];
      Array.from(element.childNodes).forEach((child) => processInline(child, runs));
      if (runs.length > 0) {
        paragraphs.push(new docx.Paragraph({ children: runs }));
      }
    }

    Array.from(body.childNodes).forEach((child) => processBlock(child));
  } catch (error) {
    console.error('Failed to parse HTML for DOCX export:', error);
    paragraphs.push(new docx.Paragraph({ text: decodeHtmlEntities(html) }));
  }

  return paragraphs;
}

function extractScriptData(nodes: CanvasNode[]): ScriptData {
  return {
    root: (nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot)?.data as ScriptRootNodeData) ?? null,
    chapters: nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.scriptChapter)
      .map((node) => ({
        id: node.id,
        data: node.data as ScriptChapterNodeData,
      }))
      .sort((left, right) => left.data.chapterNumber - right.data.chapterNumber),
    sceneNodes: nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.scriptScene)
      .map((node) => ({
        id: node.id,
        data: node.data as ScriptSceneNodeData,
      })),
    shootingScriptNodes: nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.shootingScript)
      .map((node) => ({
        id: node.id,
        data: node.data as ShootingScriptNodeData,
      })),
  };
}

function resolveChapterScenes(chapter: ScriptChapterNodeData) {
  return normalizeSceneCards(chapter.scenes, chapter.content)
    .slice()
    .sort((left, right) => left.order - right.order);
}

function sortEpisodes(episodes: unknown): EpisodeCard[] {
  return normalizeEpisodeCards(episodes)
    .slice()
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      if (left.episodeNumber !== right.episodeNumber) {
        return left.episodeNumber - right.episodeNumber;
      }

      return left.id.localeCompare(right.id);
    });
}

function buildSceneEpisodeSourceKey(sceneNodeId: string, episodeId: string): string {
  return `${sceneNodeId}::${episodeId}`;
}

function mapLegacyShotRows(shotRows: ShotRow[]): ShootingScriptRow[] {
  return shotRows.map((row, index) => ({
    id: row.id,
    shotNumber: row.shotNumber || String(index + 1),
    beat: row.beat,
    action: row.action,
    composition: [row.shotSize, row.framingAngle].filter(Boolean).join(' / '),
    camera: row.cameraMove,
    duration: row.rhythmDuration,
    audio: [row.dialogueCue, row.audioCue].filter(Boolean).join(' / '),
    blocking: row.blocking,
    artLighting: row.artLighting,
    continuityNote: row.continuityNote,
    directorIntent: '',
    genTarget: row.genTarget,
    genPrompt: row.genPrompt,
    status: row.status,
  }));
}

function buildShootingScriptNodeMap(
  chapterId: string,
  shootingScriptNodes: ShootingScriptNodeWithId[]
): Map<string, ShootingScriptNodeWithId> {
  const map = new Map<string, ShootingScriptNodeWithId>();

  shootingScriptNodes.forEach((node) => {
    if (node.data.sourceChapterId !== chapterId) {
      return;
    }

    if (!node.data.sourceSceneNodeId || !node.data.sourceEpisodeId) {
      return;
    }

    const sourceKey = buildSceneEpisodeSourceKey(
      node.data.sourceSceneNodeId,
      node.data.sourceEpisodeId
    );
    if (!map.has(sourceKey)) {
      map.set(sourceKey, node);
    }
  });

  return map;
}

function buildSelectedChapterIds(
  chapters: ChapterWithId[],
  branches: BranchInfo[],
  branchIds?: string[]
): { selectedBranchIds: string[]; selectedChapters: ChapterWithId[]; branchLabels: string[] } {
  const selectedBranches = branchIds && branchIds.length > 0
    ? branches.filter((branch) => branchIds.includes(branch.id))
    : branches.filter((branch) => branch.isMainBranch);
  const effectiveBranches = selectedBranches.length > 0
    ? selectedBranches
    : branches.filter((branch) => branch.isMainBranch);

  const selectedNodeIds = new Set(effectiveBranches.flatMap((branch) => branch.nodeIds));
  const selectedChapters = chapters.filter((chapter) => (
    selectedNodeIds.size === 0 || selectedNodeIds.has(chapter.id)
  ));

  return {
    selectedBranchIds: effectiveBranches.map((branch) => branch.id),
    selectedChapters,
    branchLabels: effectiveBranches.map((branch) => branch.name),
  };
}

function formatUnitHeading(unit: ScriptExportTextUnit): string {
  const label = unit.label.trim();
  const title = unit.title.trim();

  if (label && title) {
    return `${label}: ${title}`;
  }

  return label || title || 'Script Section';
}

function buildChapterTextUnits(
  chapterId: string,
  chapter: ScriptChapterNodeData,
  sceneNodes: SceneNodeWithId[],
  shootingScriptNodes: ShootingScriptNodeWithId[]
): ScriptExportTextUnit[] {
  const sceneNodeBySceneId = new Map<string, SceneNodeWithId>();
  sceneNodes.forEach((sceneNode) => {
    if (sceneNode.data.sourceChapterId === chapterId && !sceneNodeBySceneId.has(sceneNode.data.sourceSceneId)) {
      sceneNodeBySceneId.set(sceneNode.data.sourceSceneId, sceneNode);
    }
  });

  const shootingScriptBySource = buildShootingScriptNodeMap(chapterId, shootingScriptNodes);
  const units: ScriptExportTextUnit[] = [];

  resolveChapterScenes(chapter).forEach((scene) => {
    const linkedSceneNode = sceneNodeBySceneId.get(scene.id);
    if (!linkedSceneNode) {
      const plainText = htmlToPlainText(scene.draftHtml);
      const summary = coerceText(scene.summary);
      if (!plainText && !summary.trim()) {
        return;
      }

      units.push({
        id: scene.id,
        label: `Scene ${scene.order + 1}`,
        title: coerceText(scene.title) || 'Untitled Scene',
        summary,
        html: scene.draftHtml,
        plainText,
      });
      return;
    }

    const sortedEpisodes = sortEpisodes(linkedSceneNode.data.episodes);
    if (sortedEpisodes.length > 0) {
      const episodeUnits = sortedEpisodes.flatMap((episode) => {
        const linkedShootingNode = shootingScriptBySource.get(
          buildSceneEpisodeSourceKey(linkedSceneNode.id, episode.id)
        );
        const summary =
          coerceText(episode.summary).trim()
          || coerceText(linkedShootingNode?.data.sourceSnapshot?.episodeSummary).trim()
          || '';
        const plainText = htmlToPlainText(episode.draftHtml);

        if (!plainText && !summary) {
          return [];
        }

        return [{
          id: episode.id,
          label: `Episode ${chapter.chapterNumber}-${episode.episodeNumber}`,
          title: coerceText(episode.title) || 'Untitled Episode',
          summary,
          html: episode.draftHtml,
          plainText,
        }];
      });

      if (episodeUnits.length > 0) {
        units.push(...episodeUnits);
        return;
      }
    }

    const summary = coerceText(linkedSceneNode.data.summary).trim();
    const plainText = htmlToPlainText(linkedSceneNode.data.draftHtml);
    if (!plainText && !summary) {
      return;
    }

    units.push({
      id: linkedSceneNode.id,
      label: `Scene ${linkedSceneNode.data.sourceSceneOrder + 1}`,
      title: coerceText(linkedSceneNode.data.title) || coerceText(scene.title) || 'Untitled Scene',
      summary,
      html: coerceText(linkedSceneNode.data.draftHtml),
      plainText,
    });
  });

  if (units.length > 0) {
    return units;
  }

  const legacyPlainText = htmlToPlainText(chapter.content);
  const chapterSummary = coerceText(chapter.summary);
  if (!legacyPlainText && !chapterSummary.trim()) {
    return [];
  }

  return [{
    id: `${chapterId}::chapter-content`,
    label: 'Chapter Body',
    title: coerceText(chapter.title) || 'Untitled Chapter',
    summary: chapterSummary,
    html: coerceText(chapter.content),
    plainText: legacyPlainText,
  }];
}

function buildShootingScriptSheets(
  chapters: ChapterWithId[],
  sceneNodes: SceneNodeWithId[],
  shootingScriptNodes: ShootingScriptNodeWithId[]
): ShootingScriptSheetPreview[] {
  const sheets: ShootingScriptSheetPreview[] = [];

  chapters.forEach((chapter) => {
    const sceneNodesForChapter = sceneNodes
      .filter((sceneNode) => sceneNode.data.sourceChapterId === chapter.id)
      .sort((left, right) => left.data.sourceSceneOrder - right.data.sourceSceneOrder);
    const shootingScriptBySource = buildShootingScriptNodeMap(chapter.id, shootingScriptNodes);

    sceneNodesForChapter.forEach((sceneNode) => {
      sortEpisodes(sceneNode.data.episodes).forEach((episode) => {
        const linkedShootingNode = shootingScriptBySource.get(
          buildSceneEpisodeSourceKey(sceneNode.id, episode.id)
        );

        const rows = linkedShootingNode?.data.rows?.length
          ? linkedShootingNode.data.rows
          : normalizeShootingScriptRows(
              mapLegacyShotRows(episode.shotRows),
              {
                chapterNumber: chapter.data.chapterNumber,
                sceneNumber: sceneNode.data.sourceSceneOrder + 1,
                episodeNumber: episode.episodeNumber,
              }
            );

        if (rows.length === 0) {
          return;
        }

        sheets.push({
          id: `${chapter.id}::${sceneNode.id}::${episode.id}`,
          name: buildWorksheetName(
            chapter.data.chapterNumber,
            sceneNode.data.sourceSceneOrder + 1,
            episode.episodeNumber,
            episode.title || sceneNode.data.title
          ),
          chapterNumber: chapter.data.chapterNumber,
          sceneNumber: sceneNode.data.sourceSceneOrder + 1,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.title || 'Untitled Episode',
          rows,
        });
      });
    });
  });

  return sheets;
}

function renderPreviewHtml(
  title: string,
  chapters: ScriptExportChapterPreview[]
): string {
  const parts = [`<h1>${escapeHtml(title)}</h1>`];

  chapters.forEach((chapter) => {
    parts.push(
      `<section data-chapter-id="${escapeHtml(chapter.id)}">`,
      `<h2>${escapeHtml(`Chapter ${chapter.chapterNumber}: ${chapter.title || 'Untitled Chapter'}`)}</h2>`
    );

    if (chapter.summary.trim()) {
      parts.push(`<p>${escapeHtml(chapter.summary.trim())}</p>`);
    }

    chapter.units.forEach((unit) => {
      parts.push(`<h3>${escapeHtml(formatUnitHeading(unit))}</h3>`);
      if (unit.summary.trim()) {
        parts.push(`<p>${escapeHtml(unit.summary.trim())}</p>`);
      }
      if (unit.html.trim()) {
        parts.push(unit.html.trim());
      }
    });

    parts.push('</section>');
  });

  return parts.join('');
}

function renderPlainText(
  title: string,
  chapters: ScriptExportChapterPreview[]
): string {
  const lines: string[] = [title, ''];

  chapters.forEach((chapter) => {
    lines.push(`Chapter ${chapter.chapterNumber}: ${chapter.title || 'Untitled Chapter'}`);
    if (chapter.summary.trim()) {
      lines.push(chapter.summary.trim());
    }
    lines.push('');

    chapter.units.forEach((unit) => {
      lines.push(formatUnitHeading(unit));
      if (unit.summary.trim()) {
        lines.push(unit.summary.trim());
      }
      if (unit.plainText.trim()) {
        lines.push(unit.plainText.trim());
      }
      lines.push('');
    });
  });

  return lines.join('\n').trim();
}

function renderMarkdown(
  title: string,
  chapters: ScriptExportChapterPreview[]
): string {
  const lines: string[] = [`# ${title}`, ''];

  chapters.forEach((chapter) => {
    lines.push(`## Chapter ${chapter.chapterNumber}: ${chapter.title || 'Untitled Chapter'}`);
    lines.push('');
    if (chapter.summary.trim()) {
      lines.push(`> ${chapter.summary.trim()}`);
      lines.push('');
    }

    chapter.units.forEach((unit) => {
      lines.push(`### ${formatUnitHeading(unit)}`);
      lines.push('');
      if (unit.summary.trim()) {
        lines.push(`> ${unit.summary.trim()}`);
        lines.push('');
      }
      if (unit.plainText.trim()) {
        lines.push(unit.plainText.trim());
        lines.push('');
      }
    });
  });

  return lines.join('\n').trim();
}

function buildWorksheetName(
  chapterNumber: number,
  sceneNumber: number,
  episodeNumber: number,
  title: string | null | undefined
): string {
  const baseName = `C${chapterNumber}-S${sceneNumber}-E${episodeNumber}`;
  const normalizedTitle = coerceText(title).trim();
  const suffix = normalizedTitle ? ` ${normalizedTitle}` : '';
  const safe = `${baseName}${suffix}`
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim();

  return safe.slice(0, 31) || baseName;
}

export function detectBranches(
  chapters: ChapterWithId[],
  edges: Edge[] | CanvasEdge[]
): BranchInfo[] {
  if (chapters.length === 0) {
    return [{
      id: 'main',
      name: 'Main',
      startChapter: 1,
      endChapter: 1,
      path: ['1'],
      nodeIds: [],
      isMainBranch: true,
    }];
  }

  const sortedChapters = [...chapters].sort((left, right) => left.data.chapterNumber - right.data.chapterNumber);
  const chapterIdSet = new Set(sortedChapters.map((chapter) => chapter.id));
  const adjacency = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (!chapterIdSet.has(edge.source) || !chapterIdSet.has(edge.target)) {
      return;
    }

    const targets = adjacency.get(edge.source) ?? [];
    if (!targets.includes(edge.target)) {
      targets.push(edge.target);
      adjacency.set(edge.source, targets);
    }
  });

  const mainNodes = sortedChapters.filter((chapter) => chapter.data.branchType !== 'branch');
  const mainBranchNodes = (mainNodes.length > 0 ? mainNodes : sortedChapters).map((chapter) => chapter.id);
  const branches: BranchInfo[] = [{
    id: 'main',
    name: 'Main',
    startChapter: sortedChapters[0]?.data.chapterNumber ?? 1,
    endChapter: sortedChapters[sortedChapters.length - 1]?.data.chapterNumber ?? 1,
    path: mainBranchNodes.map((nodeId) => String(sortedChapters.find((chapter) => chapter.id === nodeId)?.data.chapterNumber ?? '')),
    nodeIds: mainBranchNodes,
    isMainBranch: true,
  }];

  const branchStartIds = new Set<string>();

  sortedChapters.forEach((chapter) => {
    if (chapter.data.branchType === 'branch') {
      branchStartIds.add(chapter.id);
    }
  });

  adjacency.forEach((targets) => {
    if (targets.length <= 1) {
      return;
    }

    targets.forEach((targetId) => {
      if (!mainBranchNodes.includes(targetId) || branchStartIds.has(targetId)) {
        branchStartIds.add(targetId);
      }
    });
  });

  const tracePath = (startId: string): string[] => {
    const path: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = startId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      path.push(currentId);
      const nextTargets: string[] = adjacency.get(currentId) ?? [];
      if (nextTargets.length !== 1) {
        break;
      }
      currentId = nextTargets[0];
    }

    return path;
  };

  Array.from(branchStartIds).forEach((startId, index) => {
    const path = tracePath(startId);
    if (path.length === 0) {
      return;
    }

    const startChapter = sortedChapters.find((chapter) => chapter.id === path[0])?.data.chapterNumber ?? 1;
    const endChapter = sortedChapters.find((chapter) => chapter.id === path[path.length - 1])?.data.chapterNumber ?? startChapter;

    branches.push({
      id: `branch-${index + 1}`,
      name: `Branch ${String.fromCharCode(65 + index)}`,
      startChapter,
      endChapter,
      path: path.map((nodeId) => String(sortedChapters.find((chapter) => chapter.id === nodeId)?.data.chapterNumber ?? '')),
      nodeIds: path,
      isMainBranch: false,
    });
  });

  return branches;
}

export function buildScriptExportPreview(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  options?: {
    branchIds?: string[];
  }
): ScriptExportPreviewModel {
  const data = extractScriptData(nodes);
  const branches = detectBranches(data.chapters, edges);
  const { selectedBranchIds, selectedChapters, branchLabels } = buildSelectedChapterIds(
    data.chapters,
    branches,
    options?.branchIds
  );

  const chapters = selectedChapters.map((chapter) => ({
    id: chapter.id,
    chapterNumber: chapter.data.chapterNumber,
    title: coerceText(chapter.data.title),
    summary: coerceText(chapter.data.summary),
    units: buildChapterTextUnits(
      chapter.id,
      chapter.data,
      data.sceneNodes,
      data.shootingScriptNodes
    ),
  })).filter((chapter) => chapter.units.length > 0 || chapter.summary.trim().length > 0);

  const title = coerceText(data.root?.title).trim() || 'Untitled Script';
  const shootingScriptSheets = buildShootingScriptSheets(
    selectedChapters,
    data.sceneNodes,
    data.shootingScriptNodes
  );

  return {
    title,
    chapters,
    branchLabels,
    branchIds: selectedBranchIds,
    scriptHtml: renderPreviewHtml(title, chapters),
    scriptPlainText: renderPlainText(title, chapters),
    scriptMarkdown: renderMarkdown(title, chapters),
    shootingScriptSheets,
  };
}

export function buildDefaultExportFileName(title: string, format: ExportFormat): string {
  const extension = resolveExportExtension(format);
  return `${title || 'Untitled Script'}.${extension}`;
}

export function buildDefaultNativePackageFileName(title: string): string {
  return `${title || 'Untitled Script'}.script-package.json`;
}

export function resolveExportExtension(format: ExportFormat): string {
  switch (format) {
    case 'txt':
      return 'txt';
    case 'markdown':
      return 'md';
    case 'docx':
      return 'docx';
    default:
      return 'txt';
  }
}

export function replaceFileExtension(filePath: string, format: ExportFormat): string {
  const extension = resolveExportExtension(format);
  if (!filePath.trim()) {
    return filePath;
  }

  return filePath.replace(/\.[^.]+$/, '') + `.${extension}`;
}

export function buildShootingScriptFilePath(mainFilePath: string): string {
  if (!mainFilePath.trim()) {
    return '';
  }

  return `${mainFilePath.replace(/\.[^.]+$/, '')}-拍摄脚本.xlsx`;
}

export async function exportScriptPreview(
  preview: ScriptExportPreviewModel,
  options: {
    format: ExportFormat;
    mainFilePath: string;
    includeShootingScript?: boolean;
    shootingScriptFilePath?: string;
  }
): Promise<void> {
  const mainFilePath = options.mainFilePath.trim();
  if (!mainFilePath) {
    throw new Error('Export path is required.');
  }

  switch (options.format) {
    case 'txt':
      await invoke('save_text_file', {
        path: mainFilePath,
        content: preview.scriptPlainText,
      });
      break;
    case 'markdown':
      await invoke('save_text_file', {
        path: mainFilePath,
        content: preview.scriptMarkdown,
      });
      break;
    case 'docx':
      await exportDocx(preview, mainFilePath);
      break;
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }

  if (options.includeShootingScript) {
    const shootingScriptPath = options.shootingScriptFilePath?.trim();
    if (!shootingScriptPath) {
      throw new Error('Shooting script export path is required.');
    }

    if (preview.shootingScriptSheets.length === 0) {
      throw new Error('No shooting-script rows are available for export.');
    }

    await exportShootingScriptWorkbook(preview.shootingScriptSheets, shootingScriptPath);
  }
}

async function exportDocx(
  preview: ScriptExportPreviewModel,
  filePath: string
): Promise<void> {
  const docx = await import('docx');
  const children: any[] = [];

  children.push(new docx.Paragraph({
    text: preview.title,
    heading: docx.HeadingLevel.TITLE,
    alignment: docx.AlignmentType.CENTER,
  }));
  children.push(new docx.Paragraph({ text: '' }));

  preview.chapters.forEach((chapter) => {
    children.push(new docx.Paragraph({
      text: `Chapter ${chapter.chapterNumber}: ${chapter.title || 'Untitled Chapter'}`,
      heading: docx.HeadingLevel.HEADING_1,
    }));

    if (chapter.summary.trim()) {
      children.push(new docx.Paragraph({ text: chapter.summary.trim() }));
      children.push(new docx.Paragraph({ text: '' }));
    }

    chapter.units.forEach((unit) => {
      children.push(new docx.Paragraph({
        text: formatUnitHeading(unit),
        heading: docx.HeadingLevel.HEADING_2,
      }));
      if (unit.summary.trim()) {
        children.push(new docx.Paragraph({ text: unit.summary.trim() }));
      }
      children.push(...parseHtmlToDocxParagraphs(unit.html, docx));
      children.push(new docx.Paragraph({ text: '' }));
    });
  });

  const document = new docx.Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  const blob = await docx.Packer.toBlob(document);
  const buffer = await blob.arrayBuffer();
  await invoke('save_binary_file', {
    path: filePath,
    content: Array.from(new Uint8Array(buffer)),
  });
}

async function exportShootingScriptWorkbook(
  sheets: ShootingScriptSheetPreview[],
  filePath: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const rows = [
      SHOOTING_SCRIPT_COLUMN_HEADERS.map((column) => column.label),
      ...sheet.rows.map((row) => SHOOTING_SCRIPT_COLUMN_HEADERS.map((column) => String(row[column.key] ?? ''))),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  });

  const buffer = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer;

  await invoke('save_binary_file', {
    path: filePath,
    content: Array.from(new Uint8Array(buffer)),
  });
}

export function buildNativeScriptPackage(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): NativeScriptPackageV1 {
  const filteredNodes = nodes.filter((node) => NATIVE_PACKAGE_NODE_TYPES.has(node.type));
  const validNodeIds = new Set(filteredNodes.map((node) => node.id));
  const filteredEdges = edges.filter((edge) => (
    validNodeIds.has(edge.source) && validNodeIds.has(edge.target)
  ));
  const rootNode = filteredNodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot);
  const title = (rootNode?.data as ScriptRootNodeData | undefined)?.title?.trim() || 'Untitled Script';

  return {
    schema: NATIVE_SCRIPT_PACKAGE_SCHEMA,
    version: NATIVE_SCRIPT_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    projectType: 'script',
    title,
    nodes: filteredNodes,
    edges: filteredEdges,
  };
}

export async function exportNativeScriptPackage(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  filePath: string
): Promise<void> {
  const nativePackage = buildNativeScriptPackage(nodes, edges);
  await invoke('save_text_file', {
    path: filePath,
    content: JSON.stringify(nativePackage, null, 2),
  });
}
