import {
  extractScriptAssets,
  type ExtractedScriptAssets,
  type ExtractedScriptCharacter,
  type ExtractedScriptItem,
  type ExtractedScriptLocation,
  type ExtractedScriptWorldview,
} from '@/commands/textGen';
import {
  CANVAS_NODE_TYPES,
  normalizeSceneCards,
  type CanvasNode,
  type CanvasNodeType,
  type ScriptChapterNodeData,
  type ScriptWorldviewNodeData,
} from '../domain/canvasNodes';

const MAX_CHARS_PER_EXTRACTION_CHUNK = 2600;
const CHARACTER_NODE_X = 600;
const LOCATION_NODE_X = 850;
const ITEM_NODE_X = 1100;
const WORLDVIEW_NODE_X = 1350;
const NODE_START_Y = 100;
const NODE_GAP_Y = 120;
const DEFAULT_WORLDVIEW_NAME = '世界观';
const GENERIC_WORLDVIEW_NAMES = new Set([
  '世界观',
  '设定',
  '世界/设定',
  '世界 / 设定',
  'worldview',
  'setting',
  'world setting',
]);

export interface AssetExtractionChunk {
  id: string;
  label: string;
  chapterId: string;
  chapterTitle: string;
  content: string;
  charCount: number;
}

export interface AssetExtractionApplyResult {
  characters: number;
  locations: number;
  items: number;
  worldviews: number;
}

interface AddNodeFn {
  (
    type: CanvasNodeType,
    position: { x: number; y: number },
    data?: Record<string, unknown>
  ): string;
}

interface ApplyExtractedAssetsOptions {
  extractedAssets: ExtractedScriptAssets;
  nodes: CanvasNode[];
  addNode: AddNodeFn;
}

function stripHtmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return (document.body.innerText || document.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|h[1-6]|li|ul|ol|pre)>/gi, '$&\n')
    .replace(/<(li)\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function pickLongerText(primary: string, secondary: string): string {
  return primary.length >= secondary.length ? primary : secondary;
}

function mergeStringLists(primary: string[], secondary: string[]): string[] {
  return Array.from(
    new Set(
      [...primary, ...secondary]
        .map((item) => normalizeName(item))
        .filter((item) => item.length > 0)
    )
  );
}

function isGenericWorldviewName(value: string): boolean {
  return GENERIC_WORLDVIEW_NAMES.has(normalizeName(value).toLowerCase());
}

function pickWorldviewName(primary: string, secondary: string): string {
  const normalizedPrimary = normalizeName(primary);
  const normalizedSecondary = normalizeName(secondary);

  if (!normalizedPrimary) {
    return normalizedSecondary;
  }

  if (!normalizedSecondary) {
    return normalizedPrimary;
  }

  if (isGenericWorldviewName(normalizedPrimary) && !isGenericWorldviewName(normalizedSecondary)) {
    return normalizedSecondary;
  }

  if (!isGenericWorldviewName(normalizedPrimary) && isGenericWorldviewName(normalizedSecondary)) {
    return normalizedPrimary;
  }

  return normalizedPrimary.length >= normalizedSecondary.length
    ? normalizedPrimary
    : normalizedSecondary;
}

function normalizeWorldview(worldview: ExtractedScriptWorldview): ExtractedScriptWorldview {
  return {
    name: normalizeName(worldview.name),
    description: worldview.description.trim(),
    era: worldview.era.trim(),
    technology: worldview.technology.trim(),
    magic: worldview.magic.trim(),
    society: worldview.society.trim(),
    geography: worldview.geography.trim(),
    rules: mergeStringLists([], worldview.rules),
  };
}

export function hasExtractedWorldviewContent(
  worldview: ExtractedScriptWorldview | null | undefined
): worldview is ExtractedScriptWorldview {
  if (!worldview) {
    return false;
  }

  const normalized = normalizeWorldview(worldview);
  return Boolean(
    normalized.name
    || normalized.description
    || normalized.era
    || normalized.technology
    || normalized.magic
    || normalized.society
    || normalized.geography
    || normalized.rules.length > 0
  );
}

export function mergeExtractedWorldviews(
  primary: ExtractedScriptWorldview | null | undefined,
  secondary: ExtractedScriptWorldview | null | undefined
): ExtractedScriptWorldview | null {
  const normalizedPrimary = hasExtractedWorldviewContent(primary)
    ? normalizeWorldview(primary)
    : null;
  const normalizedSecondary = hasExtractedWorldviewContent(secondary)
    ? normalizeWorldview(secondary)
    : null;

  if (!normalizedPrimary) {
    return normalizedSecondary;
  }

  if (!normalizedSecondary) {
    return normalizedPrimary;
  }

  return {
    name: pickWorldviewName(normalizedPrimary.name, normalizedSecondary.name),
    description: pickLongerText(normalizedPrimary.description, normalizedSecondary.description),
    era: pickLongerText(normalizedPrimary.era, normalizedSecondary.era),
    technology: pickLongerText(normalizedPrimary.technology, normalizedSecondary.technology),
    magic: pickLongerText(normalizedPrimary.magic, normalizedSecondary.magic),
    society: pickLongerText(normalizedPrimary.society, normalizedSecondary.society),
    geography: pickLongerText(normalizedPrimary.geography, normalizedSecondary.geography),
    rules: mergeStringLists(normalizedPrimary.rules, normalizedSecondary.rules),
  };
}

function toExtractedWorldview(data: ScriptWorldviewNodeData): ExtractedScriptWorldview {
  return {
    name: data.worldviewName || '',
    description: data.description || '',
    era: data.era || '',
    technology: data.technology || '',
    magic: data.magic || '',
    society: data.society || '',
    geography: data.geography || '',
    rules: Array.isArray(data.rules) ? data.rules : [],
  };
}

export function toWorldviewNodeData(worldview: ExtractedScriptWorldview): ScriptWorldviewNodeData {
  const normalized = mergeExtractedWorldviews(null, worldview);
  const worldviewName = normalized?.name ?? '';

  return {
    displayName: worldviewName || DEFAULT_WORLDVIEW_NAME,
    worldviewName,
    description: normalized?.description ?? '',
    era: normalized?.era ?? '',
    technology: normalized?.technology ?? '',
    magic: normalized?.magic ?? '',
    society: normalized?.society ?? '',
    geography: normalized?.geography ?? '',
    rules: normalized?.rules ?? [],
  };
}

export function mergeWorldviewNodeData(
  existingData: ScriptWorldviewNodeData | null | undefined,
  worldview: ExtractedScriptWorldview
): ScriptWorldviewNodeData {
  const merged = mergeExtractedWorldviews(
    existingData ? toExtractedWorldview(existingData) : null,
    worldview
  );

  if (!merged) {
    return existingData ?? toWorldviewNodeData(worldview);
  }

  return {
    ...(existingData ?? {}),
    displayName: pickWorldviewName(existingData?.displayName ?? existingData?.worldviewName ?? '', merged.name)
      || DEFAULT_WORLDVIEW_NAME,
    worldviewName: merged.name,
    description: merged.description,
    era: merged.era,
    technology: merged.technology,
    magic: merged.magic,
    society: merged.society,
    geography: merged.geography,
    rules: merged.rules,
  };
}

export function hasWorldviewNodeDataChanged(
  previous: ScriptWorldviewNodeData,
  next: ScriptWorldviewNodeData
): boolean {
  if (
    (previous.displayName ?? '') !== (next.displayName ?? '')
    || previous.worldviewName !== next.worldviewName
    || previous.description !== next.description
    || previous.era !== next.era
    || previous.technology !== next.technology
    || previous.magic !== next.magic
    || previous.society !== next.society
    || previous.geography !== next.geography
  ) {
    return true;
  }

  const previousRules = Array.isArray(previous.rules) ? previous.rules : [];
  const nextRules = Array.isArray(next.rules) ? next.rules : [];
  return previousRules.length !== nextRules.length
    || previousRules.some((rule, index) => rule !== nextRules[index]);
}

function splitLongTextBlock(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (paragraphs.length <= 1) {
    const parts: string[] = [];
    let start = 0;
    while (start < normalized.length) {
      parts.push(normalized.slice(start, start + maxChars).trim());
      start += maxChars;
    }
    return parts.filter((item) => item.length > 0);
  }

  const chunks: string[] = [];
  let current = '';

  paragraphs.forEach((paragraph) => {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      return;
    }

    splitLongTextBlock(paragraph, maxChars).forEach((part) => chunks.push(part));
    current = '';
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function collectChapterBlocks(data: ScriptChapterNodeData): string[] {
  const scenes = normalizeSceneCards(data.scenes, data.content);
  const sceneBlocks = scenes
    .map((scene, index) => {
      const parts = [
        `场景 ${index + 1}${scene.title ? `：${scene.title}` : ''}`,
        scene.summary ? `摘要：${scene.summary}` : '',
        scene.visualHook ? `画面钩子：${scene.visualHook}` : '',
        stripHtmlToPlainText(scene.draftHtml || ''),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      return parts.join('\n');
    })
    .filter((value) => value.length > 0);

  if (sceneBlocks.length > 0) {
    return sceneBlocks;
  }

  return splitLongTextBlock(stripHtmlToPlainText(data.content || ''), MAX_CHARS_PER_EXTRACTION_CHUNK - 200);
}

export function buildAssetExtractionChunks(nodes: CanvasNode[]): AssetExtractionChunk[] {
  const chapters = nodes.filter((node) => node.type === CANVAS_NODE_TYPES.scriptChapter) as Array<{
    id: string;
    data: ScriptChapterNodeData;
  }>;

  const chunks: AssetExtractionChunk[] = [];

  chapters.forEach((chapter) => {
    const chapterTitle = normalizeName(chapter.data.title || chapter.data.displayName || '未命名章节');
    const chapterLabel = chapter.data.chapterNumber
      ? `第${chapter.data.chapterNumber}章 ${chapterTitle}`
      : chapterTitle;
    const chapterHeader = [
      `章节：${chapterLabel}`,
      chapter.data.summary?.trim() ? `章节摘要：${chapter.data.summary.trim()}` : '',
    ]
      .filter((value) => value.length > 0)
      .join('\n');

    const rawBlocks = collectChapterBlocks(chapter.data);
    const expandedBlocks = rawBlocks.flatMap((block) =>
      splitLongTextBlock(block, MAX_CHARS_PER_EXTRACTION_CHUNK - 200)
    );

    if (expandedBlocks.length === 0 && chapterHeader) {
      chunks.push({
        id: `${chapter.id}-1`,
        label: `${chapterLabel} · 片段 1`,
        chapterId: chapter.id,
        chapterTitle,
        content: chapterHeader,
        charCount: chapterHeader.length,
      });
      return;
    }

    let partIndex = 1;
    let currentBody = '';

    const flushCurrentChunk = () => {
      const content = [chapterHeader, currentBody.trim()]
        .filter((value) => value.length > 0)
        .join('\n\n');

      if (!content.trim()) {
        return;
      }

      chunks.push({
        id: `${chapter.id}-${partIndex}`,
        label: `${chapterLabel} · 片段 ${partIndex}`,
        chapterId: chapter.id,
        chapterTitle,
        content,
        charCount: content.length,
      });
      partIndex += 1;
      currentBody = '';
    };

    expandedBlocks.forEach((block) => {
      const nextBody = currentBody ? `${currentBody}\n\n${block}` : block;
      const nextLength = [chapterHeader, nextBody]
        .filter((value) => value.length > 0)
        .join('\n\n')
        .length;

      if (currentBody && nextLength > MAX_CHARS_PER_EXTRACTION_CHUNK) {
        flushCurrentChunk();
      }

      currentBody = currentBody ? `${currentBody}\n\n${block}` : block;
    });

    flushCurrentChunk();
  });

  return chunks;
}

function dedupeCharacters(items: ExtractedScriptCharacter[]): ExtractedScriptCharacter[] {
  const map = new Map<string, ExtractedScriptCharacter>();

  items.forEach((item) => {
    const key = normalizeName(item.name).toLowerCase();
    if (!key) {
      return;
    }

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...item,
        name: normalizeName(item.name),
      });
      return;
    }

    map.set(key, {
      name: existing.name,
      description: existing.description.length >= item.description.length
        ? existing.description
        : item.description,
      personality: existing.personality.length >= item.personality.length
        ? existing.personality
        : item.personality,
      appearance: existing.appearance.length >= item.appearance.length
        ? existing.appearance
        : item.appearance,
    });
  });

  return Array.from(map.values());
}

function dedupeLocations(items: ExtractedScriptLocation[]): ExtractedScriptLocation[] {
  const map = new Map<string, ExtractedScriptLocation>();

  items.forEach((item) => {
    const key = normalizeName(item.name).toLowerCase();
    if (!key) {
      return;
    }

    const existing = map.get(key);
    if (!existing || item.description.length > existing.description.length) {
      map.set(key, {
        name: normalizeName(item.name),
        description: item.description,
      });
    }
  });

  return Array.from(map.values());
}

function dedupeItems(items: ExtractedScriptItem[]): ExtractedScriptItem[] {
  const map = new Map<string, ExtractedScriptItem>();

  items.forEach((item) => {
    const key = normalizeName(item.name).toLowerCase();
    if (!key) {
      return;
    }

    const existing = map.get(key);
    if (!existing || item.description.length > existing.description.length) {
      map.set(key, {
        name: normalizeName(item.name),
        description: item.description,
      });
    }
  });

  return Array.from(map.values());
}

export async function extractAssetsFromChunk(chunk: AssetExtractionChunk): Promise<ExtractedScriptAssets> {
  const result = await extractScriptAssets({
    content: chunk.content,
    batchLabel: chunk.label,
  });

  return {
    characters: dedupeCharacters(result.characters),
    locations: dedupeLocations(result.locations),
    items: dedupeItems(result.items),
    worldview: mergeExtractedWorldviews(null, result.worldview),
  };
}

function countNodesByType(nodes: CanvasNode[], type: CanvasNodeType): number {
  return nodes.filter((node) => node.type === type).length;
}

export function applyExtractedAssetsToCanvas({
  extractedAssets,
  nodes,
  addNode,
}: ApplyExtractedAssetsOptions): AssetExtractionApplyResult {
  const existingCharacterNames = new Set(
    nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.scriptCharacter)
      .map((node) => ('name' in node.data && typeof node.data.name === 'string' ? normalizeName(node.data.name) : ''))
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase())
  );
  const existingLocationNames = new Set(
    nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.scriptLocation)
      .map((node) => ('name' in node.data && typeof node.data.name === 'string' ? normalizeName(node.data.name) : ''))
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase())
  );
  const existingItemNames = new Set(
    nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.scriptItem)
      .map((node) => ('name' in node.data && typeof node.data.name === 'string' ? normalizeName(node.data.name) : ''))
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase())
  );
  let nextCharacterIndex = countNodesByType(nodes, CANVAS_NODE_TYPES.scriptCharacter);
  let nextLocationIndex = countNodesByType(nodes, CANVAS_NODE_TYPES.scriptLocation);
  let nextItemIndex = countNodesByType(nodes, CANVAS_NODE_TYPES.scriptItem);
  const hasWorldviewNode = nodes.some((node) => node.type === CANVAS_NODE_TYPES.scriptWorldview);

  let characterCount = 0;
  let locationCount = 0;
  let itemCount = 0;
  let worldviewCount = 0;

  dedupeCharacters(extractedAssets.characters).forEach((character) => {
    const key = normalizeName(character.name).toLowerCase();
    if (!key || existingCharacterNames.has(key)) {
      return;
    }

    addNode(CANVAS_NODE_TYPES.scriptCharacter, {
      x: CHARACTER_NODE_X,
      y: NODE_START_Y + nextCharacterIndex * NODE_GAP_Y,
    }, {
      displayName: character.name,
      name: character.name,
      description: character.description,
      personality: character.personality,
      appearance: character.appearance,
    });

    existingCharacterNames.add(key);
    nextCharacterIndex += 1;
    characterCount += 1;
  });

  dedupeLocations(extractedAssets.locations).forEach((location) => {
    const key = normalizeName(location.name).toLowerCase();
    if (!key || existingLocationNames.has(key)) {
      return;
    }

    addNode(CANVAS_NODE_TYPES.scriptLocation, {
      x: LOCATION_NODE_X,
      y: NODE_START_Y + nextLocationIndex * NODE_GAP_Y,
    }, {
      displayName: location.name,
      name: location.name,
      description: location.description,
      appearances: [],
    });

    existingLocationNames.add(key);
    nextLocationIndex += 1;
    locationCount += 1;
  });

  dedupeItems(extractedAssets.items).forEach((item) => {
    const key = normalizeName(item.name).toLowerCase();
    if (!key || existingItemNames.has(key)) {
      return;
    }

    addNode(CANVAS_NODE_TYPES.scriptItem, {
      x: ITEM_NODE_X,
      y: NODE_START_Y + nextItemIndex * NODE_GAP_Y,
    }, {
      displayName: item.name,
      name: item.name,
      description: item.description,
      appearances: [],
    });

    existingItemNames.add(key);
    nextItemIndex += 1;
    itemCount += 1;
  });

  if (!hasWorldviewNode && hasExtractedWorldviewContent(extractedAssets.worldview)) {
    addNode(CANVAS_NODE_TYPES.scriptWorldview, {
      x: WORLDVIEW_NODE_X,
      y: NODE_START_Y,
    }, toWorldviewNodeData(extractedAssets.worldview));
    worldviewCount = 1;
  }

  return {
    characters: characterCount,
    locations: locationCount,
    items: itemCount,
    worldviews: worldviewCount,
  };
}
