import {
  getProjectRecord,
  upsertProjectRecord,
} from '@/commands/projectState';
import { canvasEventBus, canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  ASSET_BATCH_GROUP_GAP_X,
  ASSET_BATCH_GROUP_GAP_Y,
  ASSET_BATCH_GROUP_MAX_ITEMS_PER_LINE,
  layoutGroupChildren,
  resolveGroupLayoutOptions,
} from '@/features/canvas/application/groupLayout';
import {
  createCanvasRect,
  getCanvasNodeRect,
  rectIntersects,
  type CanvasRect,
} from '@/features/canvas/application/nodeGeometry';
import { resolveScriptAssetExtractSource } from '@/features/canvas/application/directorWorkPackage';
import { STORYBOARD_OOPII_MODEL_ID } from '@/features/canvas/models/storyboardOopii';
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_HEIGHT,
  SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_WIDTH,
  SCRIPT_PLOT_LINE_NODE_DEFAULT_HEIGHT,
  SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH,
  createEmptyAssetBatchQueueState,
  type CanvasEdge,
  type CanvasNode,
  type GroupNodeData,
  type ImageEditNodeData,
  type ScriptAssetExtractCharacter,
  type ScriptAssetExtractItem,
  type ScriptAssetExtractNodeData,
  type ScriptAssetExtractionResult,
  type ScriptAssetPanelRow,
  type ScriptPlotLineNodeData,
  type ExtractedScriptScene,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { createDefaultCanvasColorLabelMap } from '@/features/canvas/domain/semanticColors';
import i18n from '@/i18n';
import {
  DEFAULT_VIEWPORT,
  fromProjectRecord,
  toProjectRecord,
  type Project,
  useProjectStore,
} from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';

const BLOCK_COLUMN_GAP = 84;
const BLOCK_ROW_GAP = 32;
const BLOCK_SCAN_GAP = 120;
const BLOCK_COLLISION_MARGIN = 36;
const FALLBACK_VIEWPORT_WIDTH = 1440;
const FALLBACK_VIEWPORT_HEIGHT = 900;

export interface StoryboardProjectCandidate {
  id: string;
  name: string;
  updatedAt: number;
  linkedScriptProjectId: string | null;
  sameSourceScript: boolean;
  fuzzyMatched: boolean;
}

export interface ExpandScriptAssetExtractionInput {
  sourceNodeId: string;
  targetProjectId?: string | null;
  newProjectName?: string | null;
}

interface SourceContext {
  sourceProject: Project;
  sourceNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
    data: ScriptAssetExtractNodeData;
  };
  sourceLabel: string;
  sourceVersion: number | null;
}

interface ExpansionBlockBuildResult {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  bounds: CanvasRect;
}

interface AssetPanelSpec {
  title: string;
  panelKind: ScriptPlotLineNodeData['panelKind'];
  batchKind: NonNullable<GroupNodeData['batchKind']>;
  rows: ScriptAssetPanelRow[];
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveSourceNode(
  nodeId: string
): (CanvasNode & {
  type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
  data: ScriptAssetExtractNodeData;
}) | null {
  const node = useCanvasStore.getState().nodes.find(
    (entry): entry is CanvasNode & {
      type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
      data: ScriptAssetExtractNodeData;
    } => (
      entry.id === nodeId
      && (
        entry.type === CANVAS_NODE_TYPES.scriptAssetExtract
        || entry.type === CANVAS_NODE_TYPES.directorWorkPackage
      )
    )
  );

  return node
    ? {
        ...node,
        type: CANVAS_NODE_TYPES.scriptAssetExtract,
      }
    : null;
}

function buildSourceLabel(sourceNode: ScriptAssetExtractNodeData, nodeId: string): string {
  const { nodes, edges } = useCanvasStore.getState();
  const resolvedSnapshot =
    sourceNode.resolvedSourceSnapshot
    ?? resolveScriptAssetExtractSource({
      nodeId,
      sourceMode: sourceNode.sourceMode,
      selectedChapterIds: sourceNode.selectedChapterIds,
      nodes,
      edges,
    });
  const title = normalizeText(resolvedSnapshot.sourceNodeTitle);
  if (title) {
    return title;
  }
  if (resolvedSnapshot.chapterLabels.length > 0) {
    return resolvedSnapshot.chapterLabels.slice(0, 3).join(' / ');
  }
  return resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptAssetExtract, sourceNode);
}

function resolveSourceContext(sourceNodeId: string): SourceContext {
  const sourceProject = useProjectStore.getState().getCurrentProject();
  if (!sourceProject) {
    throw new Error(i18n.t('project.storyboardAssetExpand.errors.noSourceProject'));
  }

  const sourceNode = resolveSourceNode(sourceNodeId);
  if (!sourceNode) {
    throw new Error(i18n.t('project.storyboardAssetExpand.errors.nodeMissing'));
  }

  if (!sourceNode.data.extractionResult) {
    throw new Error(i18n.t('project.storyboardAssetExpand.errors.noExtractionResult'));
  }

  return {
    sourceProject,
    sourceNode,
    sourceLabel: buildSourceLabel(sourceNode.data, sourceNodeId),
    sourceVersion: sourceNode.data.extractionState.lastGeneratedAt ?? Date.now(),
  };
}

function createEmptyStoryboardProject(projectId: string, projectName: string): Project {
  const now = Date.now();
  return {
    id: projectId,
    name: projectName,
    projectType: 'storyboard',
    assetLibraryId: null,
    clipLibraryId: null,
    clipLastFolderId: null,
    linkedScriptProjectId: null,
    linkedAdProjectId: null,
    createdAt: now,
    updatedAt: now,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    history: { past: [], future: [] },
    colorLabels: createDefaultCanvasColorLabelMap(),
    scriptWelcomeSkipped: false,
  };
}

async function resolveTargetProject(
  sourceProject: Project,
  targetProjectId?: string | null,
  newProjectName?: string | null
): Promise<Project> {
  const projectStore = useProjectStore.getState();

  if (targetProjectId) {
    const currentProject = projectStore.getCurrentProject();
    if (currentProject?.id === targetProjectId) {
      return currentProject;
    }

    const record = await getProjectRecord(targetProjectId);
    if (!record) {
      throw new Error(i18n.t('project.storyboardAssetExpand.errors.targetProjectMissing'));
    }
    return fromProjectRecord(record);
  }

  const nextProjectName =
    normalizeText(newProjectName)
    || i18n.t('project.storyboardAssetExpand.defaultProjectName', {
      source: sourceProject.name,
    });
  const createdProjectId = projectStore.createProject(nextProjectName, 'storyboard');
  if (sourceProject.id) {
    await projectStore.setProjectLinkedScriptProject(createdProjectId, sourceProject.id);
  }
  const createdProject = projectStore.getCurrentProject();
  if (createdProject?.id === createdProjectId) {
    return createdProject;
  }

  return createEmptyStoryboardProject(createdProjectId, nextProjectName);
}

function tokenizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[\s\-_./\\]+/g, '');
}

function matchesAnyToken(haystack: string, needles: string[]): boolean {
  const normalizedHaystack = tokenizeForMatch(haystack);
  return needles.some((needle) => {
    const normalizedNeedle = tokenizeForMatch(needle);
    return normalizedNeedle.length > 0 && normalizedHaystack.includes(normalizedNeedle);
  });
}

export function rankStoryboardProjectCandidates(
  sourceNodeId: string
): StoryboardProjectCandidate[] {
  const projectStore = useProjectStore.getState();
  const currentProject = projectStore.getCurrentProject();
  const sourceNode = resolveSourceNode(sourceNodeId);
  if (!currentProject || !sourceNode) {
    return [];
  }

  const sourceLabel = buildSourceLabel(sourceNode.data, sourceNodeId);
  const fuzzyNeedles = [
    sourceLabel,
    resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptAssetExtract, sourceNode.data),
    ...(sourceNode.data.resolvedSourceSnapshot?.chapterLabels ?? []),
  ].filter((value) => normalizeText(value).length > 0);

  return projectStore.projects
    .filter((project) => project.projectType === 'storyboard')
    .map((project) => {
      const sameSourceScript = project.linkedScriptProjectId === currentProject.id;
      const fuzzyMatched = matchesAnyToken(project.name, fuzzyNeedles);
      return {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        linkedScriptProjectId: project.linkedScriptProjectId,
        sameSourceScript,
        fuzzyMatched,
      };
    })
    .sort((left, right) => {
      if (left.sameSourceScript !== right.sameSourceScript) {
        return left.sameSourceScript ? -1 : 1;
      }
      if (left.fuzzyMatched !== right.fuzzyMatched) {
        return left.fuzzyMatched ? -1 : 1;
      }
      return right.updatedAt - left.updatedAt;
    });
}

export function openStoryboardExpandDialogForAssetNode(nodeId: string): void {
  canvasEventBus.publish('storyboard-asset-expand/open', { nodeId });
}

function toCharacterRows(items: ScriptAssetExtractCharacter[]): ScriptAssetPanelRow[] {
  return items.map((item, index) => ({
    id: item.id?.trim() || `character-${index + 1}`,
    title: item.name,
    subtitle: item.aliases?.slice(0, 2).join(' / ') ?? '',
    body: item.visualDesc || item.appearance || item.description || item.personality || '',
    prompt: item.referencePrompt || item.visualDesc || item.appearance || item.description || '',
    meta: [
      item.continuityNotes ? i18n.t('node.scriptAssetExtract.meta.continuity', { value: item.continuityNotes }) : '',
    ].filter(Boolean),
  }));
}

function toSceneRows(items: ExtractedScriptScene[]): ScriptAssetPanelRow[] {
  return items.map((item, index) => ({
    id: item.id?.trim() || `scene-${index + 1}`,
    title: item.name,
    subtitle: item.timeTone || '',
    body: item.sceneDesc || item.description || '',
    prompt: item.referencePrompt || item.sceneDesc || item.description || '',
    meta: [
      item.spaceLayout ? i18n.t('node.scriptAssetExtract.meta.space', { value: item.spaceLayout }) : '',
      item.timeTone ? i18n.t('node.scriptAssetExtract.meta.lighting', { value: item.timeTone }) : '',
    ].filter(Boolean),
  }));
}

function toItemRows(items: ScriptAssetExtractItem[]): ScriptAssetPanelRow[] {
  return items.map((item, index) => ({
    id: item.id?.trim() || `item-${index + 1}`,
    title: item.name,
    subtitle: item.function || '',
    body: item.visualDesc || item.description || item.function || '',
    prompt: item.visualDesc || item.description || item.function || '',
    meta: [
      item.ownerCharacterIds?.length
        ? i18n.t('node.scriptAssetExtract.meta.owner', {
            value: item.ownerCharacterIds.join(' / '),
          })
        : '',
    ].filter(Boolean),
  }));
}

function buildAssetPanelSpecs(result: ScriptAssetExtractionResult): AssetPanelSpec[] {
  return [
    {
      title: i18n.t('node.scriptAssetExtract.tabs.characters'),
      panelKind: 'characters',
      batchKind: 'character',
      rows: toCharacterRows(result.charactersCatalog ?? result.characters ?? []),
    },
    {
      title: i18n.t('node.scriptAssetExtract.tabs.scenes'),
      panelKind: 'scenes',
      batchKind: 'scene',
      rows: toSceneRows(result.scenesCatalog ?? result.scenes ?? []),
    },
    {
      title: i18n.t('node.scriptAssetExtract.tabs.items'),
      panelKind: 'items',
      batchKind: 'item',
      rows: toItemRows(result.itemsCatalog ?? result.items ?? []),
    },
  ];
}

function resolvePanelHeight(rowCount: number): number {
  return Math.max(
    SCRIPT_PLOT_LINE_NODE_DEFAULT_HEIGHT,
    Math.min(560, 140 + rowCount * 88)
  );
}

function resolveBatchChildPrompt(row: ScriptAssetPanelRow): string {
  return normalizeText(row.prompt) || normalizeText(row.body);
}

function resolveBatchChildDescription(row: ScriptAssetPanelRow): string {
  return normalizeText(row.subtitle) || normalizeText(row.body);
}

function buildBatchGroupNodes(
  panelSpec: AssetPanelSpec,
  position: { x: number; y: number },
  sourceContext: SourceContext,
  sourceMirrorNodeId: string,
  sourcePanelNodeId: string
): { groupNode: CanvasNode; childNodes: CanvasNode[] } {
  const groupNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.group,
    position,
    {
      displayName: panelSpec.title,
      label: panelSpec.title,
      visualStyle: 'assetBatchGroup',
      batchKind: panelSpec.batchKind,
      batchSource: {
        sourceMirrorNodeId,
        sourcePanelNodeId,
        sourceProjectId: sourceContext.sourceProject.id,
        sourceNodeId: sourceContext.sourceNode.id,
      },
      globalOverrideEnabled: false,
      globalModelId: STORYBOARD_OOPII_MODEL_ID,
      globalSize: null,
      globalAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
      globalStyleTemplateId: null,
      globalStyleTemplateName: null,
      globalStyleTemplatePrompt: null,
      optimizePromptBeforeGenerate: false,
      queueState: createEmptyAssetBatchQueueState(),
    } satisfies Partial<GroupNodeData>
  );

  const childNodes = panelSpec.rows.map((row, index) => {
    const childNode = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.imageEdit,
      {
        x:
          (index % ASSET_BATCH_GROUP_MAX_ITEMS_PER_LINE)
          * (IMAGE_EDIT_NODE_DEFAULT_WIDTH + ASSET_BATCH_GROUP_GAP_X),
        y:
          Math.floor(index / ASSET_BATCH_GROUP_MAX_ITEMS_PER_LINE)
          * (IMAGE_EDIT_NODE_DEFAULT_HEIGHT + ASSET_BATCH_GROUP_GAP_Y),
      },
      {
        displayName: row.title,
        nodeDescription: resolveBatchChildDescription(row),
        prompt: resolveBatchChildPrompt(row),
        model: STORYBOARD_OOPII_MODEL_ID,
      } satisfies Partial<ImageEditNodeData>
    );

    return {
      ...childNode,
      parentId: groupNode.id,
      position: childNode.position,
      width: IMAGE_EDIT_NODE_DEFAULT_WIDTH,
      height: IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
      style: {
        ...(childNode.style ?? {}),
        width: IMAGE_EDIT_NODE_DEFAULT_WIDTH,
        height: IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
      },
    };
  });

  const layoutResult = layoutGroupChildren(childNodes, [], {
    ...resolveGroupLayoutOptions(groupNode.data as GroupNodeData, {
      maxItemsPerLine: ASSET_BATCH_GROUP_MAX_ITEMS_PER_LINE,
      gapX: ASSET_BATCH_GROUP_GAP_X,
      gapY: ASSET_BATCH_GROUP_GAP_Y,
    }),
  });

  const positionedChildren = childNodes.map((childNode) => ({
    ...childNode,
    position: layoutResult.positions.get(childNode.id) ?? childNode.position,
  }));

  return {
    groupNode: {
      ...groupNode,
      width: layoutResult.size.width,
      height: layoutResult.size.height,
      style: {
        ...(groupNode.style ?? {}),
        width: layoutResult.size.width,
        height: layoutResult.size.height,
      },
      data: {
        ...groupNode.data,
        layoutDirection: layoutResult.direction,
        maxItemsPerLine: layoutResult.maxItemsPerLine,
      },
    },
    childNodes: positionedChildren,
  };
}

function removePreviousExpansionBlock(
  project: Project,
  sourceProjectId: string,
  sourceNodeId: string
): Project {
  const mirrorNodeIds = new Set(
    project.nodes
      .filter((node) => (
        (
          node.type === CANVAS_NODE_TYPES.scriptAssetExtract
          || node.type === CANVAS_NODE_TYPES.directorWorkPackage
        )
        && (node.data as ScriptAssetExtractNodeData).expansionSource?.sourceProjectId === sourceProjectId
        && (node.data as ScriptAssetExtractNodeData).expansionSource?.sourceNodeId === sourceNodeId
      ))
      .map((node) => node.id)
  );

  if (mirrorNodeIds.size === 0) {
    return project;
  }

  const panelNodeIds = new Set(
    project.nodes
      .filter((node) => (
        node.type === CANVAS_NODE_TYPES.scriptPlotLine
        && (
          (node.data as Record<string, unknown>).sourceProjectId === sourceProjectId
          || mirrorNodeIds.has(normalizeText((node.data as Record<string, unknown>).sourceMirrorNodeId as string | null))
        )
        && (node.data as Record<string, unknown>).sourceNodeId === sourceNodeId
      ))
      .map((node) => node.id)
  );

  const groupNodeIds = new Set(
    project.nodes
      .filter((node) => (
        node.type === CANVAS_NODE_TYPES.group
        && (
          (node.data as GroupNodeData).batchSource?.sourceProjectId === sourceProjectId
          && (node.data as GroupNodeData).batchSource?.sourceNodeId === sourceNodeId
        )
      ))
      .map((node) => node.id)
  );

  const childNodeIds = new Set(
    project.nodes
      .filter((node) => node.parentId && groupNodeIds.has(node.parentId))
      .map((node) => node.id)
  );

  const deleteIds = new Set<string>([
    ...mirrorNodeIds,
    ...panelNodeIds,
    ...groupNodeIds,
    ...childNodeIds,
  ]);

  return {
    ...project,
    nodes: project.nodes.filter((node) => !deleteIds.has(node.id)),
    edges: project.edges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)),
  };
}

function estimateBlockSize(
  mirrorSize: { width: number; height: number },
  panelHeights: number[],
  groupHeights: number[],
  maxGroupWidth: number
): { width: number; height: number } {
  const rowOffsets = panelHeights.reduce<number[]>((acc, _height, index) => {
    if (index === 0) {
      return [0];
    }

    return [...acc, acc[index - 1] + Math.max(panelHeights[index - 1], groupHeights[index - 1]) + BLOCK_ROW_GAP];
  }, []);
  const lastPanelHeight = panelHeights.length > 0 ? panelHeights[panelHeights.length - 1] : 0;
  const lastGroupHeight = groupHeights.length > 0 ? groupHeights[groupHeights.length - 1] : 0;
  const totalHeight = Math.max(
    mirrorSize.height,
    rowOffsets[rowOffsets.length - 1] + Math.max(lastPanelHeight, lastGroupHeight)
  );

  return {
    width:
      mirrorSize.width
      + BLOCK_COLUMN_GAP
      + SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH
      + BLOCK_COLUMN_GAP
      + maxGroupWidth,
    height: totalHeight,
  };
}

function resolveViewportCanvasCenter(viewport: Project['viewport'] | undefined): { x: number; y: number } {
  const viewportState = viewport ?? DEFAULT_VIEWPORT;
  const { canvasViewportSize } = useCanvasStore.getState();
  const width = canvasViewportSize.width > 0 ? canvasViewportSize.width : FALLBACK_VIEWPORT_WIDTH;
  const height = canvasViewportSize.height > 0 ? canvasViewportSize.height : FALLBACK_VIEWPORT_HEIGHT;
  const zoom = Math.max(0.01, viewportState.zoom || 1);

  return {
    x: (-viewportState.x + width / 2) / zoom,
    y: (-viewportState.y + height / 2) / zoom,
  };
}

function findExpansionOrigin(
  nodes: CanvasNode[],
  blockSize: { width: number; height: number },
  viewport: Project['viewport']
): { x: number; y: number } {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const nodeRects = nodes.map((node) => getCanvasNodeRect(node, nodeMap));
  const minTop = nodeRects.reduce((min, rect) => Math.min(min, rect.top), 120);
  const maxRight = nodeRects.reduce((max, rect) => Math.max(max, rect.right), 120);
  const viewportCenter = resolveViewportCanvasCenter(viewport);

  const candidates: Array<{ x: number; y: number }> = [
    {
      x: maxRight + BLOCK_SCAN_GAP,
      y: Math.round(viewportCenter.y - blockSize.height / 2),
    },
    {
      x: Math.round(viewportCenter.x + BLOCK_SCAN_GAP),
      y: Math.round(viewportCenter.y - blockSize.height / 2),
    },
    {
      x: 120,
      y: minTop,
    },
  ];

  const isFree = (x: number, y: number) => {
    const candidateRect = createCanvasRect(x, y, blockSize.width, blockSize.height);
    return !nodeRects.some((rect) => rectIntersects(candidateRect, rect, BLOCK_COLLISION_MARGIN));
  };

  for (const candidate of candidates) {
    if (isFree(candidate.x, candidate.y)) {
      return candidate;
    }
  }

  const baseX = Math.max(120, Math.round(viewportCenter.x - blockSize.width / 2));
  const baseY = Math.max(120, Math.round(viewportCenter.y - blockSize.height / 2));
  for (let col = 0; col < 18; col += 1) {
    for (let row = 0; row < 18; row += 1) {
      const nextX = baseX + col * (blockSize.width + BLOCK_SCAN_GAP);
      const nextY = baseY + row * (blockSize.height + BLOCK_SCAN_GAP);
      if (isFree(nextX, nextY)) {
        return { x: nextX, y: nextY };
      }
    }
  }

  return {
    x: maxRight + BLOCK_SCAN_GAP,
    y: Math.max(120, Math.round(viewportCenter.y - blockSize.height / 2)),
  };
}

function buildFocusViewport(bounds: CanvasRect): Project['viewport'] {
  const { canvasViewportSize } = useCanvasStore.getState();
  const viewportWidth = canvasViewportSize.width > 0 ? canvasViewportSize.width : FALLBACK_VIEWPORT_WIDTH;
  const viewportHeight = canvasViewportSize.height > 0 ? canvasViewportSize.height : FALLBACK_VIEWPORT_HEIGHT;
  const zoom = Math.max(
    0.45,
    Math.min(
      1,
      Math.min(
        viewportWidth / Math.max(bounds.width + 220, 1),
        viewportHeight / Math.max(bounds.height + 180, 1),
      )
    )
  );
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;

  return {
    x: Math.round(-centerX * zoom + viewportWidth / 2),
    y: Math.round(-centerY * zoom + viewportHeight / 2),
    zoom: Number(zoom.toFixed(4)),
  };
}

function buildExpansionBlock(
  project: Project,
  sourceContext: SourceContext
): ExpansionBlockBuildResult {
  const extractionResult = sourceContext.sourceNode.data.extractionResult as ScriptAssetExtractionResult;
  const sourceMirrorWidth =
    typeof sourceContext.sourceNode.width === 'number'
      ? sourceContext.sourceNode.width
      : typeof sourceContext.sourceNode.style?.width === 'number'
        ? sourceContext.sourceNode.style.width
        : SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_WIDTH;
  const sourceMirrorHeight =
    typeof sourceContext.sourceNode.height === 'number'
      ? sourceContext.sourceNode.height
      : typeof sourceContext.sourceNode.style?.height === 'number'
        ? sourceContext.sourceNode.style.height
        : SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_HEIGHT;
  const panelSpecs = buildAssetPanelSpecs(extractionResult);
  const batchPrelayout = panelSpecs.map((panelSpec) =>
    buildBatchGroupNodes(
      panelSpec,
      { x: 0, y: 0 },
      sourceContext,
      'source-mirror',
      'source-panel'
    )
  );
  const blockSize = estimateBlockSize(
    { width: sourceMirrorWidth, height: sourceMirrorHeight },
    panelSpecs.map((panelSpec) => resolvePanelHeight(panelSpec.rows.length)),
    batchPrelayout.map((item) => item.groupNode.height ?? 220),
    Math.max(...batchPrelayout.map((item) => item.groupNode.width ?? 560), 560)
  );
  const origin = findExpansionOrigin(project.nodes, blockSize, project.viewport);

  const mirrorNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.scriptAssetExtract,
    origin,
    {
      ...sourceContext.sourceNode.data,
      presentationMode: 'storyboardMirror',
      expansionSource: {
        sourceProjectId: sourceContext.sourceProject.id,
        sourceProjectName: sourceContext.sourceProject.name,
        sourceNodeId: sourceContext.sourceNode.id,
        sourceNodeVersion: sourceContext.sourceVersion,
        sourceLabel: sourceContext.sourceLabel,
      },
      extractionState: {
        ...sourceContext.sourceNode.data.extractionState,
        phase: 'ready',
      },
      expandedGroupNodeIds: [],
      lastExpandedAt: Date.now(),
    } satisfies Partial<ScriptAssetExtractNodeData>
  );
  mirrorNode.width = sourceMirrorWidth;
  mirrorNode.height = sourceMirrorHeight;
  mirrorNode.style = {
    ...(mirrorNode.style ?? {}),
    width: sourceMirrorWidth,
    height: sourceMirrorHeight,
  };

  const builtNodes: CanvasNode[] = [mirrorNode];
  const builtEdges: CanvasEdge[] = [];
  let currentY = origin.y;

  panelSpecs.forEach((panelSpec) => {
    const panelHeight = resolvePanelHeight(panelSpec.rows.length);
    const panelX = origin.x + sourceMirrorWidth + BLOCK_COLUMN_GAP;
    const panelPosition = { x: panelX, y: currentY };
    const panelNode = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.scriptPlotLine,
      panelPosition,
      {
        displayName: panelSpec.title,
        title: panelSpec.title,
        panelKind: panelSpec.panelKind,
        assetPanelRows: panelSpec.rows,
        sourceMirrorNodeId: mirrorNode.id,
        sourceProjectId: sourceContext.sourceProject.id,
        sourceNodeId: sourceContext.sourceNode.id,
      } satisfies Partial<ScriptPlotLineNodeData> & Record<string, unknown>
    );
    panelNode.width = SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH;
    panelNode.height = panelHeight;
    panelNode.style = {
      ...(panelNode.style ?? {}),
      width: SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH,
      height: panelHeight,
    };

    const groupX = panelX + SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH + BLOCK_COLUMN_GAP;
    const { groupNode, childNodes } = buildBatchGroupNodes(
      panelSpec,
      { x: groupX, y: currentY },
      sourceContext,
      mirrorNode.id,
      panelNode.id
    );

    builtNodes.push(panelNode, groupNode, ...childNodes);
    builtEdges.push({
      id: `e-${mirrorNode.id}-${panelNode.id}`,
      source: mirrorNode.id,
      target: panelNode.id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
      style: {
        stroke: 'rgb(77 141 255 / 0.78)',
        strokeWidth: 2.2,
      },
    });
    childNodes.forEach((childNode) => {
      builtEdges.push({
        id: `e-${panelNode.id}-${childNode.id}`,
        source: panelNode.id,
        target: childNode.id,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'disconnectableEdge',
        style: {
          stroke: 'rgb(77 141 255 / 0.72)',
          strokeWidth: 2,
        },
      });
    });

    currentY += Math.max(panelHeight, groupNode.height ?? 220) + BLOCK_ROW_GAP;
  });

  return {
    nodes: builtNodes,
    edges: builtEdges,
    bounds: createCanvasRect(origin.x, origin.y, blockSize.width, blockSize.height),
  };
}

export async function expandScriptAssetExtractionToStoryboardProject(
  input: ExpandScriptAssetExtractionInput
): Promise<{ projectId: string }> {
  const projectStore = useProjectStore.getState();
  const sourceContext = resolveSourceContext(input.sourceNodeId);
  await projectStore.flushCurrentProjectToDisk();

  let targetProject = await resolveTargetProject(
    sourceContext.sourceProject,
    input.targetProjectId,
    input.newProjectName
  );
  targetProject = removePreviousExpansionBlock(
    targetProject,
    sourceContext.sourceProject.id,
    sourceContext.sourceNode.id
  );

  const expansionBlock = buildExpansionBlock(targetProject, sourceContext);
  const nextProject: Project = {
    ...targetProject,
    linkedScriptProjectId: sourceContext.sourceProject.id,
    nodes: [...targetProject.nodes, ...expansionBlock.nodes],
    edges: [...targetProject.edges, ...expansionBlock.edges],
    viewport: buildFocusViewport(expansionBlock.bounds),
    nodeCount: targetProject.nodes.length + expansionBlock.nodes.length,
    updatedAt: Date.now(),
  };

  await upsertProjectRecord(toProjectRecord(nextProject));
  projectStore.openProject(nextProject.id);
  return { projectId: nextProject.id };
}
