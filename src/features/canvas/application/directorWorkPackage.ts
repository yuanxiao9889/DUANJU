import type { ProjectRecord } from '@/commands/projectState';
import {
  extractScriptAssets,
  type ExtractedScriptAssets,
} from '@/commands/textGen';
import { htmlToPlainText } from '@/features/canvas/application/sceneEpisodeGenerator';
import {
  CANVAS_NODE_TYPES,
  normalizeSceneCards,
  normalizeScriptAssetExtractNodeData,
  normalizeScriptChapterNodeData,
  normalizeScriptSceneNodeData,
  SCRIPT_CHARACTER_NODE_DEFAULT_HEIGHT,
  SCRIPT_CHARACTER_NODE_DEFAULT_WIDTH,
  SCRIPT_ITEM_NODE_DEFAULT_HEIGHT,
  SCRIPT_ITEM_NODE_DEFAULT_WIDTH,
  SCRIPT_LOCATION_NODE_DEFAULT_HEIGHT,
  SCRIPT_LOCATION_NODE_DEFAULT_WIDTH,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExtractedScriptScene,
  type EpisodeCard,
  type SceneCard,
  type ScriptAssetExtractCharacter,
  type ScriptAssetExtractItem,
  type ScriptAssetPanelRow,
  type ScriptAssetExtractNodeData,
  type ScriptAssetExtractionResult,
  type ScriptAssetExtractSourceMode,
  type ScriptAssetExtractSourceSnapshot,
  type ScriptChapterNodeData,
  type ScriptSceneNodeData,
  type TextAnnotationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

interface ResolveScriptAssetExtractSourceInput {
  nodeId?: string | null;
  sourceMode?: ScriptAssetExtractSourceMode;
  selectedChapterIds: string[];
  nodes: CanvasNode[];
  edges?: CanvasEdge[];
}

interface RunScriptAssetExtractionInput extends ResolveScriptAssetExtractSourceInput {
  previousResult?: ScriptAssetExtractionResult | null;
}

interface ExpandScriptAssetExtractionResultInput {
  nodeId: string;
  extractionResult: ScriptAssetExtractionResult;
  existingExpandedGroupNodeIds?: string[];
}

type SourceTextNode = CanvasNode & { data: TextAnnotationNodeData };

const EXPANDED_GROUP_STACK_GAP = 56;
const EXPANDED_GROUP_SIDE_PADDING = 20;
const EXPANDED_GROUP_TOP_PADDING = 34;
const EXPANDED_GROUP_BOTTOM_PADDING = 20;
const EXPANDED_GROUP_ITEM_GAP_Y = 24;
const EXPANDED_GROUP_ITEM_GAP_X = 28;
const EXPANDED_GROUP_MIN_WIDTH = 220;
const EXPANDED_GROUP_MIN_HEIGHT = 140;

function resolveExpandedGroupItemGap(_type: CanvasNodeType): { x: number; y: number } {
  return { x: EXPANDED_GROUP_ITEM_GAP_X, y: EXPANDED_GROUP_ITEM_GAP_Y };
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildLabeledBlock(title: string, rows: Array<[string, string | null | undefined]>): string {
  const body = rows
    .map(([label, value]) => {
      const text = normalizeText(value);
      return text ? `【${label}】${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return body ? `## ${title}\n${body}` : '';
}

function buildPlainLabeledBlock(title: string, content: string | null | undefined): string {
  const text = normalizeText(content);
  return text ? `## ${title}\n${text}` : '';
}

function buildExtractionState(
  phase: ScriptAssetExtractNodeData['extractionState']['phase'],
  statusText: string,
  lastError: string | null = null
): ScriptAssetExtractNodeData['extractionState'] {
  return {
    requestId: null,
    phase,
    statusText,
    lastError,
    lastGeneratedAt: Date.now(),
  };
}

function isTextSourceNode(node: CanvasNode | undefined): node is SourceTextNode {
  return Boolean(node && node.type === CANVAS_NODE_TYPES.textAnnotation);
}

function resolveConnectedTextSource(
  nodeId: string | null | undefined,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): SourceTextNode | null {
  if (!nodeId) {
    return null;
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const incomingTextEdge = edges.find((edge) => {
    if (edge.target !== nodeId) {
      return false;
    }
    return isTextSourceNode(nodeMap.get(edge.source));
  });

  if (!incomingTextEdge) {
    return null;
  }

  const sourceNode = nodeMap.get(incomingTextEdge.source);
  return isTextSourceNode(sourceNode) ? sourceNode : null;
}

function buildConnectedTextSourceSnapshot(sourceNode: SourceTextNode): ScriptAssetExtractSourceSnapshot {
  return buildConnectedTextSourceSnapshotV2(sourceNode);
}
function buildChapterSelectionSourceSnapshot(
  selectedChapterIds: string[],
  nodes: CanvasNode[]
): ScriptAssetExtractSourceSnapshot {
  return buildChapterSelectionSourceSnapshotV2(selectedChapterIds, nodes);
}
function buildCleanLabeledBlock(title: string, rows: Array<[string, string | null | undefined]>): string {
  const body = rows
    .map(([label, value]) => {
      const text = normalizeText(value);
      return text ? `【${label}】${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return body ? `## ${title}\n${body}` : '';
}

function buildCleanPlainBlock(title: string, content: string | null | undefined): string {
  const text = normalizeText(content);
  return text ? `## ${title}\n${text}` : '';
}

function hasAnyText(values: Array<string | null | undefined>): boolean {
  return values.some((value) => normalizeText(value).length > 0);
}

function buildSceneContextBlock(
  title: string,
  scene: Pick<SceneCard, 'summary' | 'purpose' | 'povCharacter' | 'goal' | 'conflict' | 'turn' | 'emotionalShift' | 'visualHook' | 'subtext'>
): string {
  return buildCleanLabeledBlock(title, [
    ['摘要', scene.summary],
    ['目的', scene.purpose],
    ['视角人物', scene.povCharacter],
    ['目标', scene.goal],
    ['冲突', scene.conflict],
    ['转折', scene.turn],
    ['情绪变化', scene.emotionalShift],
    ['视觉钩子', scene.visualHook],
    ['潜台词', scene.subtext],
  ]);
}

function buildEpisodeContentBlock(
  episode: EpisodeCard,
  index: number
): string {
  const episodeDraft = htmlToPlainText(episode.draftHtml || episode.sourceDraftHtml || '');
  if (!hasAnyText([
    episode.title,
    episode.summary,
    episode.purpose,
    episode.povCharacter,
    episode.goal,
    episode.conflict,
    episode.turn,
    episode.emotionalShift,
    episode.visualHook,
    episode.subtext,
    episodeDraft,
  ])) {
    return '';
  }

  const episodeLabel = normalizeText(episode.title) || `分集 ${episode.episodeNumber || index + 1}`;
  return [
    buildCleanLabeledBlock(`分集 ${episode.episodeNumber || index + 1}: ${episodeLabel}`, [
      ['摘要', episode.summary],
      ['目的', episode.purpose],
      ['视角人物', episode.povCharacter],
      ['目标', episode.goal],
      ['冲突', episode.conflict],
      ['转折', episode.turn],
      ['情绪变化', episode.emotionalShift],
      ['视觉钩子', episode.visualHook],
      ['潜台词', episode.subtext],
    ]),
    buildCleanPlainBlock('分集正文', episodeDraft),
  ].filter(Boolean).join('\n\n');
}

function buildSceneDraftBlock(
  title: string,
  scene: Pick<SceneCard, 'summary' | 'purpose' | 'povCharacter' | 'goal' | 'conflict' | 'turn' | 'emotionalShift' | 'visualHook' | 'subtext' | 'draftHtml' | 'sourceDraftHtml'>
): string {
  const draftText = htmlToPlainText(scene.draftHtml || scene.sourceDraftHtml || '');
  if (!hasAnyText([
    scene.summary,
    scene.purpose,
    scene.povCharacter,
    scene.goal,
    scene.conflict,
    scene.turn,
    scene.emotionalShift,
    scene.visualHook,
    scene.subtext,
    draftText,
  ])) {
    return '';
  }

  return [
    buildSceneContextBlock(title, scene),
    buildCleanPlainBlock('场景正文', draftText),
  ].filter(Boolean).join('\n\n');
}

function buildConnectedTextSourceSnapshotV2(sourceNode: SourceTextNode): ScriptAssetExtractSourceSnapshot {
  const sourceText = normalizeText(sourceNode.data.content);
  const sourceNodeTitle = normalizeText(sourceNode.data.displayName) || '\u6587\u672c\u8282\u70b9';
  const packagedSourceText = [
    buildCleanLabeledBlock('\u6765\u6e90\u4fe1\u606f', [
      ['\u6765\u6e90\u7c7b\u578b', '\u5df2\u8fde\u63a5\u6587\u672c\u8282\u70b9'],
      ['\u8282\u70b9\u6807\u9898', sourceNodeTitle],
      ['\u4f7f\u7528\u8bf4\u660e', '\u672c\u6b21\u63d0\u53d6\u5c06\u76f4\u63a5\u4f7f\u7528\u8be5\u6587\u672c\u8282\u70b9\u5185\u5bb9'],
    ]),
    buildCleanPlainBlock('\u6587\u672c\u5185\u5bb9', sourceText),
  ].filter(Boolean).join('\n\n');

  return {
    mode: 'connectedText',
    chapterNodeIds: [],
    chapterLabels: [],
    sourceNodeId: sourceNode.id,
    sourceNodeTitle,
    chapterCount: 0,
    sceneCount: 0,
    sourceText: packagedSourceText,
    updatedAt: Date.now(),
  };
}
function buildChapterSelectionSourceSnapshotV2(
  selectedChapterIds: string[],
  nodes: CanvasNode[]
): ScriptAssetExtractSourceSnapshot {
  const chapters = nodes
    .filter((node): node is CanvasNode & { data: ScriptChapterNodeData } =>
      node.type === CANVAS_NODE_TYPES.scriptChapter
    )
    .map((node) => ({
      id: node.id,
      data: normalizeScriptChapterNodeData(node.data as ScriptChapterNodeData),
    }))
    .filter((chapter) => selectedChapterIds.includes(chapter.id))
    .sort((left, right) => left.data.chapterNumber - right.data.chapterNumber);

  const sceneNodes = nodes
    .filter((node): node is CanvasNode & { data: ScriptSceneNodeData } =>
      node.type === CANVAS_NODE_TYPES.scriptScene
    )
    .map((node) => ({
      id: node.id,
      data: normalizeScriptSceneNodeData(node.data as ScriptSceneNodeData),
    }));

  let sceneCount = 0;
  const blocks: string[] = [];

  chapters.forEach(({ id, data }) => {
    const chapterLabel = '\u7b2c' + Math.max(1, data.chapterNumber || 1) + '\u7ae0 ' + (normalizeText(data.title || data.displayName) || '\u672a\u547d\u540d\u7ae0\u8282');
    const relatedSceneNodes = sceneNodes
      .filter((scene) => scene.data.sourceChapterId === id)
      .sort((left, right) => left.data.sourceSceneOrder - right.data.sourceSceneOrder);
    const chapterScenes = normalizeSceneCards(data.scenes, data.content);
    sceneCount += Math.max(relatedSceneNodes.length, chapterScenes.length);

    const sceneBlocks = relatedSceneNodes
      .map(({ data: sceneData }, index) => {
        const sceneTitle = normalizeText(sceneData.title) || (`场景 ${sceneData.sourceSceneOrder + 1 || index + 1}`);
        const sceneLabel = `场景 ${index + 1}: ${sceneTitle}`;
        const episodeBlocks = [...sceneData.episodes]
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
          .map((episode, episodeIndex) => buildEpisodeContentBlock(episode, episodeIndex))
          .filter(Boolean);

        if (episodeBlocks.length > 0) {
          return [
            buildSceneContextBlock(sceneLabel, sceneData),
            ...episodeBlocks,
          ].join('\n\n');
        }

        return buildSceneDraftBlock(sceneLabel, sceneData);
      })
      .filter((block) => block.length > 0);

    const fallbackSceneBlocks = relatedSceneNodes.length > 0
      ? []
      : chapterScenes
        .map((scene, index) => buildSceneDraftBlock(
          `场景 ${index + 1}: ${normalizeText(scene.title) || `未命名场景 ${index + 1}`}`,
          scene
        ))
        .filter((block) => block.length > 0);

    const hasStructuredSceneContent = sceneBlocks.length > 0 || fallbackSceneBlocks.length > 0;

    const chapterBlock = [
      buildCleanLabeledBlock(chapterLabel, [
        ['\u6458\u8981', data.summary],
        ['\u7ae0\u8282\u76ee\u7684', data.chapterPurpose],
        ['\u7ae0\u8282\u95ee\u9898', data.chapterQuestion],
        ['\u89d2\u8272', data.characters.join(' / ')],
        ['\u573a\u666f', data.locations.join(' / ')],
        ['\u7269\u54c1', data.items.join(' / ')],
        ['\u60c5\u7eea\u53d8\u5316', data.emotionalShift],
        ['\u57cb\u7b14', data.setupRef],
        ['\u56de\u6536', data.payoffRef],
      ]),
      hasStructuredSceneContent
        ? ''
        : buildCleanPlainBlock('章节正文', htmlToPlainText(data.content || '')),
      ...sceneBlocks,
      ...fallbackSceneBlocks,
    ].filter((item) => item.length > 0).join('\n\n');

    if (chapterBlock) {
      blocks.push(chapterBlock);
    }
  });

  return {
    mode: 'chapterSelection',
    chapterNodeIds: chapters.map((chapter) => chapter.id),
    chapterLabels: chapters.map((chapter) => '\u7b2c' + Math.max(1, chapter.data.chapterNumber || 1) + '\u7ae0 ' + (normalizeText(chapter.data.title || chapter.data.displayName) || '\u672a\u547d\u540d\u7ae0\u8282')),
    sourceNodeId: null,
    sourceNodeTitle: null,
    chapterCount: chapters.length,
    sceneCount,
    sourceText: [
      buildCleanLabeledBlock('\u6765\u6e90\u4fe1\u606f', [
        ['\u6765\u6e90\u7c7b\u578b', '\u7ae0\u8282\u52fe\u9009'],
        ['\u4f7f\u7528\u8bf4\u660e', '本次提取将优先使用分集正文，其次回退到场景正文；拍摄脚本不会进入提取正文'],
      ]),
      blocks.join('\n\n').trim(),
    ].filter(Boolean).join('\n\n'),
    updatedAt: Date.now(),
  };
}
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  items.forEach((item) => {
    const key = normalizeText(item.name).toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({
      ...item,
      name: normalizeText(item.name),
    });
  });
  return result;
}

function getTextLength(value: string): number {
  return Array.from(value).length;
}

function isLikelyAssetName(value: string, maxLength = 36): boolean {
  const text = normalizeText(value);
  if (!text || getTextLength(text) > maxLength) {
    return false;
  }

  if (/[\r\n。！？?!]/.test(text)) {
    return false;
  }

  if (/^(讲述|描写|描述|关于|围绕|如何|为什么|一段|一场)/.test(text)) {
    return false;
  }

  return true;
}

function normalizeExtractionResult(
  extracted: ExtractedScriptAssets,
  previousResult?: ScriptAssetExtractionResult | null
): ScriptAssetExtractionResult {
  const sourceCharacters = extracted.charactersCatalog?.length
    ? extracted.charactersCatalog
    : extracted.characters;
  const sourceScenes = extracted.scenesCatalog?.length
    ? extracted.scenesCatalog
    : extracted.scenes;
  const sourceItems = extracted.itemsCatalog?.length
    ? extracted.itemsCatalog
    : extracted.items;
  const sceneRows = (sourceScenes?.length ? sourceScenes : extracted.locations.map((location) => ({
    name: location.name,
    description: location.description,
    relatedCharacterNames: [],
  }))) as ExtractedScriptScene[];

  const characters: ScriptAssetExtractCharacter[] = dedupeByName(
    sourceCharacters
      .map((character, index) => ({
        id: normalizeText(character.id) || `c${index + 1}`,
        name: normalizeText(character.name),
        aliases: Array.from(new Set((character.aliases ?? []).map((alias) => normalizeText(alias)).filter(Boolean))),
        roleWeight: Number.isFinite(character.roleWeight) ? Number(character.roleWeight) : undefined,
        description: normalizeText(character.description),
        personality: normalizeText(character.personality),
        appearance: normalizeText(character.appearance),
        visualDesc: normalizeText(character.visualDesc) || normalizeText(character.appearance),
        continuityNotes: normalizeText(character.continuityNotes),
        referencePrompt: normalizeText(character.referencePrompt) || normalizeText(character.visualDesc) || normalizeText(character.appearance),
      }))
      .filter((character) => isLikelyAssetName(character.name))
  );

  const scenes: ExtractedScriptScene[] = dedupeByName(
    sceneRows
      .map((scene, index) => ({
        id: normalizeText(scene.id) || `s${index + 1}`,
        name: normalizeText(scene.name),
        description: normalizeText(scene.description) || normalizeText(scene.sceneDesc),
        relatedCharacterNames: Array.from(new Set((scene.relatedCharacterNames ?? []).map((name) => normalizeText(name)).filter(Boolean))),
        sceneDesc: normalizeText(scene.sceneDesc) || normalizeText(scene.description),
        timeTone: normalizeText(scene.timeTone),
        lightLock: normalizeText(scene.lightLock) || normalizeText(scene.timeTone),
        spaceLayout: normalizeText(scene.spaceLayout),
        referencePrompt: normalizeText(scene.referencePrompt) || [normalizeText(scene.sceneDesc), normalizeText(scene.timeTone), normalizeText(scene.spaceLayout)].filter(Boolean).join('?'),
      }))
      .filter((scene) => isLikelyAssetName(scene.name))
  );

  const items: ScriptAssetExtractItem[] = dedupeByName(
    sourceItems
      .map((item, index) => ({
        id: normalizeText(item.id) || `i${index + 1}`,
        name: normalizeText(item.name),
        description: normalizeText(item.description) || normalizeText(item.function),
        visualDesc: normalizeText(item.visualDesc),
        function: normalizeText(item.function),
        ownerCharacterIds: Array.from(new Set((item.ownerCharacterIds ?? []).map((id) => normalizeText(id)).filter(Boolean))),
        continuityNotes: normalizeText(item.continuityNotes),
      }))
      .filter((item) => isLikelyAssetName(item.name))
  );

  const characterNameSet = new Set(characters.map((character) => character.name));
  const normalizedScenes = scenes.map((scene) => ({
    ...scene,
    relatedCharacterNames: scene.relatedCharacterNames.filter((name) => characterNameSet.has(name)),
  }));

  return {
    schemaVersion: 2,
    version: Math.max(1, (previousResult?.version ?? 0) + 1),
    generatedAt: Date.now(),
    characters,
    scenes: normalizedScenes,
    items,
    plotLines: [],
    emotions: [],
    charactersCatalog: characters,
    scenesCatalog: normalizedScenes,
    itemsCatalog: items,
    lineBlueprints: [],
    promptRows: [],
  };
}

function resolveNodeWidth(node: CanvasNode | undefined): number {
  const width = typeof node?.width === 'number'
    ? node.width
    : typeof node?.style?.width === 'number'
      ? node.style.width
      : typeof node?.measured?.width === 'number'
        ? node.measured.width
        : 620;
  return Number.isFinite(width) ? width : 620;
}

export function resolveScriptAssetExtractSource(
  input: ResolveScriptAssetExtractSourceInput
): ScriptAssetExtractSourceSnapshot {
  const connectedTextSource = resolveConnectedTextSource(
    input.nodeId,
    input.nodes,
    input.edges ?? []
  );

  if (connectedTextSource) {
    return buildConnectedTextSourceSnapshotV2(connectedTextSource);
  }

  return buildChapterSelectionSourceSnapshotV2(input.selectedChapterIds, input.nodes);
}

export const resolveDirectorWorkPackageSource = resolveScriptAssetExtractSource;

async function runScriptAssetExtractionLegacy(
  input: RunScriptAssetExtractionInput
): Promise<{
  resolvedSourceSnapshot: ScriptAssetExtractSourceSnapshot;
  extractionResult: ScriptAssetExtractionResult;
}> {
  return runScriptAssetExtraction(input);
}
export async function runScriptAssetExtraction(
  input: RunScriptAssetExtractionInput
): Promise<{
  resolvedSourceSnapshot: ScriptAssetExtractSourceSnapshot;
  extractionResult: ScriptAssetExtractionResult;
}> {
  const resolvedSourceSnapshot = resolveScriptAssetExtractSource(input);
  const sourceText = normalizeText(resolvedSourceSnapshot.sourceText);
  if (!sourceText) {
    throw new Error('\u672a\u627e\u5230\u53ef\u7528\u7684\u63d0\u53d6\u5185\u5bb9\uff0c\u8bf7\u5148\u8fde\u63a5\u6587\u672c\u8282\u70b9\u6216\u9009\u62e9\u7ae0\u8282\u3002');
  }

  const extracted = await extractScriptAssets({
    content: sourceText,
    batchLabel: resolvedSourceSnapshot.mode === 'connectedText'
      ? resolvedSourceSnapshot.sourceNodeTitle || '\u6587\u672c\u8282\u70b9'
      : resolvedSourceSnapshot.chapterLabels.join(' / '),
  });

  return {
    resolvedSourceSnapshot,
    extractionResult: normalizeExtractionResult(extracted, input.previousResult),
  };
}
export const runScriptDirectorExtraction = runScriptAssetExtraction;
export const normalizeScriptAssetExtractionResultV2 = normalizeExtractionResult;

async function runScriptAssetExtractionForNodeLegacy(
  nodeId: string
): Promise<ScriptAssetExtractionResult | null> {
  return runScriptAssetExtractionForNode(nodeId);
}
export async function runScriptAssetExtractionForNode(
  nodeId: string
): Promise<ScriptAssetExtractionResult | null> {
  const { currentProject } = useProjectStore.getState();
  const { nodes, edges, updateNodeData } = useCanvasStore.getState();
  if (!currentProject || currentProject.projectType !== 'script') {
    return null;
  }

  const targetNode = nodes.find((node) =>
    node.id === nodeId
    && (
      node.type === CANVAS_NODE_TYPES.scriptAssetExtract
      || node.type === CANVAS_NODE_TYPES.directorWorkPackage
    )
  );

  if (!targetNode) {
    return null;
  }

  const nodeData = normalizeScriptAssetExtractNodeData(targetNode.data as ScriptAssetExtractNodeData);
  updateNodeData(nodeId, {
    extractionState: buildExtractionState('extracting', '\u6b63\u5728\u63d0\u53d6\u5267\u672c\u8d44\u4ea7...'),
  }, { historyMode: 'skip' });

  try {
    const { resolvedSourceSnapshot, extractionResult } = await runScriptAssetExtraction({
      nodeId,
      sourceMode: nodeData.sourceMode,
      selectedChapterIds: nodeData.selectedChapterIds,
      nodes,
      edges,
      previousResult: nodeData.extractionResult,
    });

    updateNodeData(nodeId, {
      sourceMode: resolvedSourceSnapshot.mode,
      resolvedSourceSnapshot,
      extractionResult,
      extractionState: buildExtractionState(
        'ready',
        '\u63d0\u53d6\u5b8c\u6210\uff1a'
        + extractionResult.charactersCatalog.length
        + ' \u4e2a\u89d2\u8272\uff0c'
        + extractionResult.scenesCatalog.length
        + ' \u4e2a\u573a\u666f\uff0c'
        + extractionResult.itemsCatalog.length
        + ' \u4e2a\u7269\u54c1'
      ),
    }, { historyMode: 'skip' });

    return extractionResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : '\u63d0\u53d6\u5931\u8d25';
    updateNodeData(nodeId, {
      extractionState: buildExtractionState('error', message, message),
    }, { historyMode: 'skip' });
    throw error;
  }
}

function buildCharacterNodeData(character: ScriptAssetExtractCharacter) {
  return {
    displayName: character.name,
    name: character.name,
    description: character.description,
    personality: character.personality,
    appearance: character.appearance,
  };
}

function buildSceneNodeData(scene: ExtractedScriptScene) {
  return {
    displayName: scene.name,
    name: scene.name,
    description: scene.description,
    appearances: scene.relatedCharacterNames,
  };
}

function buildItemNodeData(item: ScriptAssetExtractItem) {
  return {
    displayName: item.name,
    name: item.name,
    description: item.description,
    appearances: [],
  };
}

function estimateExpandedNodeSize(type: CanvasNodeType): { width: number; height: number } {
  if (type === CANVAS_NODE_TYPES.scriptCharacter) {
    return {
      width: SCRIPT_CHARACTER_NODE_DEFAULT_WIDTH,
      height: SCRIPT_CHARACTER_NODE_DEFAULT_HEIGHT,
    };
  }

  if (type === CANVAS_NODE_TYPES.scriptLocation) {
    return {
      width: SCRIPT_LOCATION_NODE_DEFAULT_WIDTH,
      height: SCRIPT_LOCATION_NODE_DEFAULT_HEIGHT,
    };
  }

  if (type === CANVAS_NODE_TYPES.scriptItem) {
    return {
      width: SCRIPT_ITEM_NODE_DEFAULT_WIDTH,
      height: SCRIPT_ITEM_NODE_DEFAULT_HEIGHT,
    };
  }

  return {
    width: SCRIPT_ITEM_NODE_DEFAULT_WIDTH,
    height: SCRIPT_ITEM_NODE_DEFAULT_HEIGHT,
  };
}

function resolveExpandedGroupColumnCount(type: CanvasNodeType, itemCount: number): number {
  if (itemCount <= 1) {
    return 1;
  }

  if (type === CANVAS_NODE_TYPES.scriptPlotLine) {
    return 1;
  }

  if (itemCount >= 7) {
    return 3;
  }

  return Math.min(2, itemCount);
}

function estimateExpandedGroupSize(type: CanvasNodeType, itemCount: number): { width: number; height: number } {
  const maxItemsPerLine = resolveExpandedGroupColumnCount(type, itemCount);
  const nodeSize = estimateExpandedNodeSize(type);
  const itemGap = resolveExpandedGroupItemGap(type);
  const columnCount = itemCount > 0 ? Math.min(itemCount, maxItemsPerLine) : 1;
  const rowCount = itemCount > 0 ? Math.ceil(itemCount / maxItemsPerLine) : 0;
  const contentHeight = rowCount > 0
    ? rowCount * nodeSize.height + Math.max(0, rowCount - 1) * itemGap.y
    : 0;
  const contentWidth = columnCount > 0
    ? columnCount * nodeSize.width + Math.max(0, columnCount - 1) * itemGap.x
    : nodeSize.width;

  return {
    width: Math.max(EXPANDED_GROUP_MIN_WIDTH, contentWidth + EXPANDED_GROUP_SIDE_PADDING * 2),
    height: Math.max(
      EXPANDED_GROUP_MIN_HEIGHT,
      EXPANDED_GROUP_TOP_PADDING + EXPANDED_GROUP_BOTTOM_PADDING + contentHeight
    ),
  };
}

function resolveExpandedChildPosition(
  type: CanvasNodeType,
  itemCount: number,
  itemIndex: number
): { x: number; y: number } {
  const maxItemsPerLine = resolveExpandedGroupColumnCount(type, itemCount);
  const nodeSize = estimateExpandedNodeSize(type);
  const itemGap = resolveExpandedGroupItemGap(type);
  const columnIndex = itemIndex % maxItemsPerLine;
  const rowIndex = Math.floor(itemIndex / maxItemsPerLine);

  return {
    x: EXPANDED_GROUP_SIDE_PADDING + columnIndex * (nodeSize.width + itemGap.x),
    y: EXPANDED_GROUP_TOP_PADDING + rowIndex * (nodeSize.height + itemGap.y),
  };
}

function expandScriptAssetExtractionResultLegacy(
  input: ExpandScriptAssetExtractionResultInput
): string[] {
  const {
    nodes,
    deleteNodes,
    addNode,
    addEdge,
    updateNodeData,
    updateNodeSize,
    fitGroupNodeToChildren,
  } = useCanvasStore.getState();

  const sourceNode = nodes.find((node) => node.id === input.nodeId);
  if (!sourceNode) {
    return [];
  }

  if (input.existingExpandedGroupNodeIds?.length) {
    deleteNodes(input.existingExpandedGroupNodeIds);
  }
  const baseX = sourceNode.position.x + resolveNodeWidth(sourceNode) + 120;
  const baseY = sourceNode.position.y;
  const createGroupChildren = <T,>(
    groupId: string,
    type: CanvasNodeType,
    items: T[],
    buildData: (item: T) => CanvasNodeData
  ) => {
    items.forEach((item, itemIndex) => {
      const position = resolveExpandedChildPosition(type, items.length, itemIndex);
      const childId = addNode(
        type,
        position,
        buildData(item),
        {
          parentId: groupId,
          positionSpace: 'parent',
        }
      );

      addEdge(input.nodeId, childId);
    });
  };

  const groupConfigs = [
    {
      title: '\u89d2\u8272',
      maxItemsPerLine: resolveExpandedGroupColumnCount(
        CANVAS_NODE_TYPES.scriptCharacter,
        input.extractionResult.characters.length
      ),
      estimatedSize: estimateExpandedGroupSize(
        CANVAS_NODE_TYPES.scriptCharacter,
        input.extractionResult.characters.length
      ),
      createChildren: (groupId: string) => createGroupChildren(
        groupId,
        CANVAS_NODE_TYPES.scriptCharacter,
        input.extractionResult.characters,
        buildCharacterNodeData
      ),
    },
    {
      title: '\u573a\u666f',
      maxItemsPerLine: resolveExpandedGroupColumnCount(
        CANVAS_NODE_TYPES.scriptLocation,
        input.extractionResult.scenes.length
      ),
      estimatedSize: estimateExpandedGroupSize(
        CANVAS_NODE_TYPES.scriptLocation,
        input.extractionResult.scenes.length
      ),
      createChildren: (groupId: string) => createGroupChildren(
        groupId,
        CANVAS_NODE_TYPES.scriptLocation,
        input.extractionResult.scenes,
        buildSceneNodeData
      ),
    },
    {
      title: '\u7269\u54c1',
      maxItemsPerLine: resolveExpandedGroupColumnCount(
        CANVAS_NODE_TYPES.scriptItem,
        input.extractionResult.items.length
      ),
      estimatedSize: estimateExpandedGroupSize(
        CANVAS_NODE_TYPES.scriptItem,
        input.extractionResult.items.length
      ),
      createChildren: (groupId: string) => createGroupChildren(
        groupId,
        CANVAS_NODE_TYPES.scriptItem,
        input.extractionResult.items,
        buildItemNodeData
      ),
    },
  ] as const;

  const createdGroupIds: string[] = [];
  let currentGroupY = baseY;

  groupConfigs.forEach((config) => {
    const groupData: CanvasNodeData = {
      displayName: config.title,
      maxItemsPerLine: config.maxItemsPerLine,
      visualStyle: 'default',
    };

    const groupId = addNode(
      CANVAS_NODE_TYPES.group,
      {
        x: baseX,
        y: currentGroupY,
      },
      groupData
    );
    updateNodeSize(groupId, config.estimatedSize);

    createdGroupIds.push(groupId);
    config.createChildren(groupId);
    fitGroupNodeToChildren(groupId);
    currentGroupY += config.estimatedSize.height + EXPANDED_GROUP_STACK_GAP;
  });

  updateNodeData(input.nodeId, {
    expandedGroupNodeIds: createdGroupIds,
    lastExpandedAt: Date.now(),
  }, { historyMode: 'skip' });

  return createdGroupIds;
}

function toPanelRow(
  id: string,
  title: string,
  body: string,
  subtitle = '',
  meta: string[] = [],
  prompt = ''
): ScriptAssetPanelRow {
  return {
    id,
    title,
    subtitle,
    body,
    meta: meta.filter(Boolean),
    prompt,
  };
}

function buildCharacterPanelRows(characters: ScriptAssetExtractCharacter[]): ScriptAssetPanelRow[] {
  return characters.map((character, index) => toPanelRow(
    character.id || `character-${index + 1}`,
    character.name,
    character.referencePrompt || character.visualDesc || character.appearance || character.description,
    character.description || character.personality,
    [
      character.aliases?.length ? `\u522b\u540d\uff1a${character.aliases.join(' / ')}` : '',
      character.continuityNotes ? `\u8fde\u7eed\u6027\uff1a${character.continuityNotes}` : '',
    ]
  ));
}

function buildScenePanelRows(scenes: ExtractedScriptScene[]): ScriptAssetPanelRow[] {
  return scenes.map((scene, index) => toPanelRow(
    scene.id || `scene-${index + 1}`,
    scene.name,
    scene.referencePrompt || scene.sceneDesc || scene.description,
    scene.timeTone || scene.lightLock,
    [
      scene.lightLock ? `\u5149\u5f71\u9501\u5b9a\uff1a${scene.lightLock}` : '',
      scene.spaceLayout ? `\u7a7a\u95f4\u5c42\u6b21\uff1a${scene.spaceLayout}` : '',
      scene.relatedCharacterNames.length ? `\u76f8\u5173\u89d2\u8272\uff1a${scene.relatedCharacterNames.join(' / ')}` : '',
    ]
  ));
}

function buildItemPanelRows(items: ScriptAssetExtractItem[]): ScriptAssetPanelRow[] {
  return items.map((item, index) => toPanelRow(
    item.id || `item-${index + 1}`,
    item.name,
    item.visualDesc || item.description,
    item.function || item.description,
    [
      item.ownerCharacterIds?.length ? `\u5f52\u5c5e\u89d2\u8272\uff1a${item.ownerCharacterIds.join(' / ')}` : '',
      item.continuityNotes ? `\u8fde\u7eed\u6027\uff1a${item.continuityNotes}` : '',
    ],
    item.visualDesc
  ));
}

function estimateAssetPanelHeight(rowCount: number): number {
  return Math.min(620, Math.max(260, 112 + Math.min(rowCount, 6) * 96));
}

export function expandScriptAssetExtractionResult(
  input: ExpandScriptAssetExtractionResultInput
): string[] {
  const {
    nodes,
    deleteNodes,
    addNode,
    addEdge,
    updateNodeData,
    updateNodeSize,
  } = useCanvasStore.getState();

  const sourceNode = nodes.find((node) => node.id === input.nodeId);
  if (!sourceNode) {
    return [];
  }

  if (input.existingExpandedGroupNodeIds?.length) {
    deleteNodes(input.existingExpandedGroupNodeIds);
  }

  const baseX = sourceNode.position.x + resolveNodeWidth(sourceNode) + 120;
  const baseY = sourceNode.position.y;
  const panelGap = 28;
  const panelWidth = 620;
  const panelConfigs = [
    {
      kind: 'characters' as const,
      title: '\u89d2\u8272',
      rows: buildCharacterPanelRows(input.extractionResult.charactersCatalog),
    },
    {
      kind: 'scenes' as const,
      title: '\u573a\u666f',
      rows: buildScenePanelRows(input.extractionResult.scenesCatalog),
    },
    {
      kind: 'items' as const,
      title: '\u7269\u54c1',
      rows: buildItemPanelRows(input.extractionResult.itemsCatalog),
    },
  ].filter((config) => config.rows.length > 0);

  const createdNodeIds: string[] = [];
  let cursorY = baseY;

  panelConfigs.forEach((config) => {
    const panelHeight = estimateAssetPanelHeight(config.rows.length);
    const childId = addNode(
      CANVAS_NODE_TYPES.scriptPlotLine,
      { x: baseX, y: cursorY },
      {
        panelKind: config.kind,
        displayName: config.title,
        title: config.title,
        summary: '',
        statusTag: '',
        relatedCharacterNames: [],
        relatedSceneNames: [],
        entries: [],
        assetPanelRows: config.rows,
      }
    );
    updateNodeSize(childId, { width: panelWidth, height: panelHeight });
    addEdge(input.nodeId, childId);
    createdNodeIds.push(childId);
    cursorY += panelHeight + panelGap;
  });

  updateNodeData(input.nodeId, {
    expandedGroupNodeIds: createdNodeIds,
    lastExpandedAt: Date.now(),
  }, { historyMode: 'skip' });

  return createdNodeIds;
}

export function expandScriptAssetExtractionResultForNode(nodeId: string): string[] {
  const { currentProject } = useProjectStore.getState();
  const { nodes } = useCanvasStore.getState();
  if (!currentProject || currentProject.projectType !== 'script') {
    return [];
  }

  const targetNode = nodes.find((node) =>
    node.id === nodeId
    && (
      node.type === CANVAS_NODE_TYPES.scriptAssetExtract
      || node.type === CANVAS_NODE_TYPES.directorWorkPackage
    )
  );
  if (!targetNode) {
    return [];
  }

  const nodeData = normalizeScriptAssetExtractNodeData(targetNode.data as ScriptAssetExtractNodeData);
  if (!nodeData.extractionResult) {
    return [];
  }

  return expandScriptAssetExtractionResult({
    nodeId,
    extractionResult: nodeData.extractionResult,
    existingExpandedGroupNodeIds: nodeData.expandedGroupNodeIds,
  });
}

export async function generateDirectorWorkPackageForNode(): Promise<null> {
  return null;
}

export async function createStoryboardProjectFromDirectorWorkPackageNode(): Promise<null> {
  return null;
}

export async function createStoryboardProjectFromDirectorWorkPackage(): Promise<null> {
  return null;
}

export function createDirectorWorkPackageNodeFromSource(): string | null {
  return null;
}

export function resolveDirectorWorkPackagePackageFromNodes(): null {
  return null;
}

export function resolveDirectorWorkPackagePackageFromProjectRecord(
  _record: ProjectRecord,
  _sourceNodeId: string
): null {
  return null;
}

void buildLabeledBlock;
void buildPlainLabeledBlock;
void buildConnectedTextSourceSnapshot;
void buildChapterSelectionSourceSnapshot;
void runScriptAssetExtractionLegacy;
void runScriptAssetExtractionForNodeLegacy;
void expandScriptAssetExtractionResultLegacy;
