import {
  cancelScriptDirectorStoryboardStream,
  listenScriptDirectorStoryboardStream,
  startScriptDirectorStoryboardStream,
  type ScriptDirectorStoryboardStreamEvent,
  type ScriptDirectorStoryboardStreamOutlineRowPayload,
  type ScriptDirectorStoryboardStreamRowCompletedPayload,
} from '@/commands/scriptDirectorStoryboardStream';
import {
  getProjectRecord,
  upsertProjectRecord,
} from '@/commands/projectState';
import { canvasEventBus, canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { resolveScriptAssetExtractSource } from '@/features/canvas/application/directorWorkPackage';
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type DirectorStoryboardDurationGroup,
  type DirectorStoryboardTableRow,
  type DirectorStoryboardTransferSnapshot,
  type ExportImageNodeData,
  type GroupNodeData,
  type AssetMaterialNodeData,
  type ImageEditNodeData,
  type JimengNodeData,
  type ScriptAssetExtractNodeData,
  type ScriptAssetExtractionResult,
  type ScriptAssetExtractSourceSnapshot,
  type ScriptStoryboardTableColumn,
  type ScriptStoryboardTableNodeData,
  type ScriptStoryboardTableSummary,
  type ScriptStoryboardTableStreamState,
  type SeedanceNodeData,
  type SmartDirectorStoryboardGenerationState,
  type SmartDirectorStoryboardNodeData,
  type SmartDirectorStoryboardResult,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { createDefaultCanvasColorLabelMap } from '@/features/canvas/domain/semanticColors';
import { DEFAULT_IMAGE_MODEL_ID } from '@/features/canvas/models';
import {
  DEFAULT_VIEWPORT,
  fromProjectRecord,
  toProjectRecord,
  type Project,
  useProjectStore,
} from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAssetStore } from '@/stores/assetStore';
import i18n from '@/i18n';

export interface ResolveSmartDirectorStoryboardSourceInput {
  nodeId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface ResolvedSmartDirectorStoryboardSource {
  smartNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.smartDirectorStoryboard;
    data: SmartDirectorStoryboardNodeData;
  };
  assetNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
    data: ScriptAssetExtractNodeData;
  };
  resolvedSourceSnapshot: ScriptAssetExtractSourceSnapshot;
  extractionResult: ScriptAssetExtractionResult;
  sourceLabel: string;
  sourceText: string;
}

export type SmartDirectorStoryboardBindingStatus =
  | 'missingAssetNode'
  | 'missingExtractionResult'
  | 'staleExtractionResult'
  | 'ready';

export interface SmartDirectorStoryboardBindingState {
  smartNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.smartDirectorStoryboard;
    data: SmartDirectorStoryboardNodeData;
  };
  assetNode: (CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
    data: ScriptAssetExtractNodeData;
  }) | null;
  bindingStatus: SmartDirectorStoryboardBindingStatus;
  resolvedSourceSnapshot: ScriptAssetExtractSourceSnapshot | null;
  extractionResult: ScriptAssetExtractionResult | null;
  sourceLabel: string | null;
}

export interface RunSmartDirectorStoryboardGenerationInput {
  nodeId: string;
}

export interface OpenStoryboardFromSmartDirectorStoryboardInput {
  nodeId: string;
}

export interface OpenStoryboardFromScriptStoryboardTableInput {
  nodeId: string;
}

export interface CreateOrSelectStoryboardProjectForDirectorTableInput {
  sourceNodeId: string;
  targetProjectId?: string | null;
  newProjectName?: string | null;
}

interface ScriptStoryboardTableSourceContext {
  sourceProject: Project;
  tableNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
    data: ScriptStoryboardTableNodeData;
  };
  sourceSmartNode: (CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.smartDirectorStoryboard;
    data: SmartDirectorStoryboardNodeData;
  }) | null;
  sourceAssetNode: (CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
    data: ScriptAssetExtractNodeData;
  }) | null;
  sourceLabel: string;
  sourceVersion: number;
}

interface CreateScriptStoryboardTableNodeInput {
  smartNodeId: string;
  sourceAssetExtractNodeId: string;
  sourceLabel: string;
  sourceSnapshotVersion: number;
  mode: 'reuse' | 'new';
  targetNodeId?: string | null;
}

interface ApplySmartDirectorStoryboardStreamEventInput {
  smartNodeId: string;
  resultNodeId: string;
  extractionResult: ScriptAssetExtractionResult;
  event: ScriptDirectorStoryboardStreamEvent;
}

const RESULT_NODE_X_OFFSET = 120;
const RESULT_NODE_Y_OFFSET = 48;
const FALLBACK_VIEWPORT_WIDTH = 1440;
const FALLBACK_VIEWPORT_HEIGHT = 900;
const PRODUCTION_CARD_X_OFFSET = 96;
const PRODUCTION_CARD_WIDTH = 2440;
const PRODUCTION_CARD_HEIGHT = 860;
const PRODUCTION_CARD_GAP_X = 72;
const PRODUCTION_CARD_GAP_Y = 72;
const PRODUCTION_CARD_COLUMNS = 2;
const PRODUCTION_ASSET_NODE_WIDTH = 420;
const PRODUCTION_ASSET_NODE_HEIGHT = 520;
const PRODUCTION_IMAGE_NODE_WIDTH = 500;
const PRODUCTION_IMAGE_NODE_HEIGHT = 520;
const PRODUCTION_RESULT_NODE_WIDTH = 360;
const PRODUCTION_RESULT_NODE_HEIGHT = 520;
const PRODUCTION_VIDEO_NODE_WIDTH = 980;
const PRODUCTION_VIDEO_NODE_HEIGHT = 520;
const PRODUCTION_CHILD_TOP = 300;
export type ScriptStoryboardProductionVideoKind = 'jimeng' | 'seedanceOfficial';
const STREAM_PREPARING_MESSAGE = '正在准备导演分镜生成...';
const STREAM_OUTLINING_MESSAGE = '正在创建分镜表框架...';
const STREAM_FAILED_MESSAGE = '导演分镜生成失败，请稍后重试。';
const MISSING_ASSET_MESSAGE = '请先连接并完成剧本资产提取节点，再生成智能导演分镜。';
const STALE_ASSET_SOURCE_MESSAGE = '前置资产提取节点的来源已变化，请先重新提取资产后再生成分镜。';
const EMPTY_SOURCE_MESSAGE = '当前没有可用于导演分镜生成的文本内容。';
const OPEN_STORYBOARD_MISSING_RESULT_MESSAGE = '请先生成剧本分镜表，再去分镜画布。';
export const TABLE_SCHEMA: ScriptStoryboardTableColumn[] = [
  { key: 'status', label: 'Status' },
  { key: 'sceneNumber', label: 'Scene Number' },
  { key: 'shotNumber', label: 'Shot' },
  { key: 'sketch', label: 'Sketch' },
  { key: 'shotSize', label: 'Shot Size' },
  { key: 'cameraAngle', label: 'Camera Angle' },
  { key: 'cameraMovement', label: 'Camera Movement' },
  { key: 'blockingAction', label: 'Blocking Action' },
  { key: 'dialogueOrSound', label: 'Dialogue Or Sound' },
  { key: 'duration', label: 'Duration' },
  { key: 'assets', label: 'Assets' },
  { key: 'remark', label: 'Remark' },
  { key: 'imagePrompt', label: 'Image Prompt' },
];

export interface ScriptStoryboardTableColumnDefinition {
  key: string;
  labelKey: string;
  widthPx: number;
  multiline?: boolean;
  editable?: boolean;
}

export const SCRIPT_STORYBOARD_TABLE_COLUMNS: ScriptStoryboardTableColumnDefinition[] = [
  { key: 'sceneNumber', labelKey: 'scriptStoryboardTable.columns.sceneNumber', widthPx: 110, multiline: true },
  { key: 'shotNumber', labelKey: 'scriptStoryboardTable.columns.shotNumber', widthPx: 72, editable: true },
  { key: 'sketch', labelKey: 'scriptStoryboardTable.columns.sketch', widthPx: 180, multiline: true, editable: true },
  { key: 'shotSize', labelKey: 'scriptStoryboardTable.columns.shotSize', widthPx: 86, editable: true },
  { key: 'cameraAngle', labelKey: 'scriptStoryboardTable.columns.cameraAngle', widthPx: 126, multiline: true, editable: true },
  { key: 'cameraMovement', labelKey: 'scriptStoryboardTable.columns.cameraMovement', widthPx: 126, multiline: true, editable: true },
  { key: 'blockingAction', labelKey: 'scriptStoryboardTable.columns.blockingAction', widthPx: 168, multiline: true, editable: true },
  { key: 'dialogueOrSound', labelKey: 'scriptStoryboardTable.columns.dialogueOrSound', widthPx: 156, multiline: true, editable: true },
  { key: 'duration', labelKey: 'scriptStoryboardTable.columns.duration', widthPx: 72, editable: true },
  { key: 'assets', labelKey: 'scriptStoryboardTable.columns.assets', widthPx: 150, multiline: true, editable: true },
  { key: 'imagePrompt', labelKey: 'scriptStoryboardTable.columns.imagePrompt', widthPx: 260, multiline: true, editable: true },
  { key: 'remark', labelKey: 'scriptStoryboardTable.columns.remark', widthPx: 156, multiline: true, editable: true },
];

export const DEFAULT_SCRIPT_STORYBOARD_VISIBLE_COLUMN_KEYS = [
  'sceneNumber',
  'shotNumber',
  'sketch',
  'shotSize',
  'cameraAngle',
  'cameraMovement',
  'blockingAction',
  'dialogueOrSound',
  'duration',
  'assets',
  'imagePrompt',
  'remark',
];

export const SCRIPT_STORYBOARD_TABLE_DEFAULT_ROW_HEIGHT = 72;
export const SCRIPT_STORYBOARD_TABLE_MIN_ROW_HEIGHT = 56;
export const SCRIPT_STORYBOARD_TABLE_MAX_ROW_HEIGHT = 160;
export const SCRIPT_STORYBOARD_TABLE_ROW_HEIGHT_STEP = 8;

const activeStreamListeners = new Map<string, () => void>();
const activeDisplayQueues = new Map<string, StreamDisplayQueue>();
const activeLocalPreviewTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
const STREAM_ROW_DISPLAY_INTERVAL_MS = 140;
const LOCAL_PREVIEW_ROW_INTERVAL_MS = 120;

type StreamOutlineEvent = Extract<
  ScriptDirectorStoryboardStreamEvent,
  { type: 'outline_row_created' }
>;
type StreamRowStartedEvent = Extract<
  ScriptDirectorStoryboardStreamEvent,
  { type: 'row_generation_started' }
>;
type StreamRowCompletedEvent = Extract<
  ScriptDirectorStoryboardStreamEvent,
  { type: 'row_generation_completed' }
>;
type StreamSummaryEvent = Extract<
  ScriptDirectorStoryboardStreamEvent,
  { type: 'summary_updated' }
>;
type StreamTerminalEvent = Extract<
  ScriptDirectorStoryboardStreamEvent,
  { type: 'stream_completed' | 'stream_failed' | 'stream_cancelled' }
>;

interface StreamDisplayQueue {
  requestId: string;
  smartNodeId: string;
  resultNodeId: string;
  extractionResult: ScriptAssetExtractionResult;
  outlineEvents: StreamOutlineEvent[];
  pendingStartedEvents: Map<string, StreamRowStartedEvent>;
  pendingCompletedEvents: Map<string, StreamRowCompletedEvent>;
  pendingSummaryEvent: StreamSummaryEvent | null;
  terminalEvent: StreamTerminalEvent | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function buildScriptStoryboardTableSchema(): ScriptStoryboardTableColumn[] {
  return SCRIPT_STORYBOARD_TABLE_COLUMNS.map((column) => ({
    key: column.key,
    label: column.labelKey,
  }));
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLocalPreviewRow(row: DirectorStoryboardTableRow): boolean {
  return row.id.startsWith('local-preview-');
}

function normalizeAssetLookupKey(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/^(人物|角色|场景|物品|道具)\s*/u, '')
    .replace(/[\s:：,，、/\\|"'“”‘’（）()[\]{}<>《》]+/g, '')
    .toLowerCase();
}

function areSameSourceSnapshots(
  left: ScriptAssetExtractSourceSnapshot | null | undefined,
  right: ScriptAssetExtractSourceSnapshot | null | undefined
): boolean {
  if (!left || !right) {
    return true;
  }

  if (left.mode !== right.mode) {
    return false;
  }

  if (left.sourceNodeId !== right.sourceNodeId) {
    return false;
  }

  const leftChapters = [...left.chapterNodeIds].sort().join('|');
  const rightChapters = [...right.chapterNodeIds].sort().join('|');
  if (leftChapters !== rightChapters) {
    return false;
  }

  return normalizeText(left.sourceText) === normalizeText(right.sourceText);
}

function createEmptyTableSummary(): ScriptStoryboardTableSummary {
  return {
    rowCount: 0,
    generatedRowCount: 0,
    totalDurationSeconds: 0,
    continuousGroupCount: 0,
    groups10sCount: 0,
    groups15sCount: 0,
    lastUpdatedAt: null,
  };
}

function createEmptyStreamState(): ScriptStoryboardTableStreamState {
  return {
    requestId: null,
    phase: 'idle',
    statusText: null,
    error: null,
    activeRowId: null,
    completedRowCount: 0,
    totalRowCount: 0,
    lastEventAt: null,
  };
}

function buildGenerationState(
  phase: SmartDirectorStoryboardGenerationState['phase'],
  statusText: string | null,
  lastError: string | null = null,
  requestId: string | null = null
): SmartDirectorStoryboardGenerationState {
  return {
    requestId,
    phase,
    statusText,
    lastError,
    lastGeneratedAt: Date.now(),
  };
}

function isScriptAssetExtractNode(
  node: CanvasNode | undefined
): node is CanvasNode & {
  type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
  data: ScriptAssetExtractNodeData;
} {
  return Boolean(
    node
    && (
      node.type === CANVAS_NODE_TYPES.scriptAssetExtract
      || node.type === CANVAS_NODE_TYPES.directorWorkPackage
    )
  );
}

function findSmartDirectorNode(
  nodeId: string
): (CanvasNode & {
  type: typeof CANVAS_NODE_TYPES.smartDirectorStoryboard;
  data: SmartDirectorStoryboardNodeData;
}) | null {
  const node = useCanvasStore.getState().nodes.find(
    (item): item is CanvasNode & {
      type: typeof CANVAS_NODE_TYPES.smartDirectorStoryboard;
      data: SmartDirectorStoryboardNodeData;
    } => item.id === nodeId && item.type === CANVAS_NODE_TYPES.smartDirectorStoryboard
  );
  return node ?? null;
}

function findScriptStoryboardTableNode(
  nodeId: string
): (CanvasNode & {
  type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
  data: ScriptStoryboardTableNodeData;
}) | null {
  const node = useCanvasStore.getState().nodes.find(
    (item): item is CanvasNode & {
      type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
      data: ScriptStoryboardTableNodeData;
    } => item.id === nodeId && item.type === CANVAS_NODE_TYPES.scriptStoryboardTable
  );
  return node ?? null;
}

function resolveConnectedAssetExtractNode(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): (CanvasNode & {
  type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
  data: ScriptAssetExtractNodeData;
}) | null {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const sourceEdge = edges.find((edge) => {
    if (edge.target !== nodeId) {
      return false;
    }
    return isScriptAssetExtractNode(nodeMap.get(edge.source));
  });

  if (!sourceEdge) {
    return null;
  }

  const sourceNode = nodeMap.get(sourceEdge.source);
  if (!isScriptAssetExtractNode(sourceNode)) {
    return null;
  }

  return {
    ...sourceNode,
    type: CANVAS_NODE_TYPES.scriptAssetExtract,
  };
}

function resolveSourceLabel(
  snapshot: ScriptAssetExtractSourceSnapshot,
  assetNodeData: ScriptAssetExtractNodeData
): string {
  if (normalizeText(snapshot.sourceNodeTitle)) {
    return normalizeText(snapshot.sourceNodeTitle);
  }
  if (snapshot.chapterLabels.length > 0) {
    return snapshot.chapterLabels.slice(0, 3).join(' / ');
  }
  return resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptAssetExtract, assetNodeData);
}

function buildAssetContextAppendix(result: ScriptAssetExtractionResult): string {
  const sections = [
    result.charactersCatalog.length > 0
      ? [
          '## Characters',
          ...result.charactersCatalog.slice(0, 24).map((item, index) => {
            const prompt =
              normalizeText(item.referencePrompt)
              || normalizeText(item.visualDesc)
              || normalizeText(item.appearance)
              || normalizeText(item.description);
            return `${index + 1}. ${item.name}: ${prompt}`;
          }),
        ].join('\n')
      : '',
    result.scenesCatalog.length > 0
      ? [
          '## Scenes',
          ...result.scenesCatalog.slice(0, 24).map((item, index) => {
            const prompt =
              normalizeText(item.referencePrompt)
              || normalizeText(item.sceneDesc)
              || normalizeText(item.description);
            return `${index + 1}. ${item.name}: ${prompt}`;
          }),
        ].join('\n')
      : '',
    result.itemsCatalog.length > 0
      ? [
          '## Items',
          ...result.itemsCatalog.slice(0, 24).map((item, index) => {
            const prompt =
              normalizeText(item.visualDesc)
              || normalizeText(item.description)
              || normalizeText(item.function);
            return `${index + 1}. ${item.name}: ${prompt}`;
          }),
        ].join('\n')
      : '',
  ].filter((value) => value.length > 0);

  return sections.join('\n\n');
}

function buildAssetNameContextAppendix(result: ScriptAssetExtractionResult): string {
  const sections = [
    result.charactersCatalog.length > 0
      ? [
          '## Characters',
          ...result.charactersCatalog.slice(0, 24).map((item, index) => `${index + 1}. ${item.name}`),
        ].join('\n')
      : '',
    result.scenesCatalog.length > 0
      ? [
          '## Scenes',
          ...result.scenesCatalog.slice(0, 24).map((item, index) => `${index + 1}. ${item.name}`),
        ].join('\n')
      : '',
    result.itemsCatalog.length > 0
      ? [
          '## Items',
          ...result.itemsCatalog.slice(0, 24).map((item, index) => `${index + 1}. ${item.name}`),
        ].join('\n')
      : '',
  ].filter((value) => value.length > 0);

  return sections.length > 0
    ? ['## Available Asset Names', ...sections].join('\n\n')
    : '';
}

function extractPreviewSourceText(snapshot: ScriptAssetExtractSourceSnapshot): string {
  const text = normalizeText(snapshot.sourceText);
  const markerIndex = text.lastIndexOf('文本内容');
  const rawText = markerIndex >= 0 ? text.slice(markerIndex + '文本内容'.length) : text;
  return rawText
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[：:>-]+\s*/, '').trim())
    .filter((line) => {
      if (!line) {
        return false;
      }
      return !/^来源(信息|类型)|^节点标题|^使用说明/.test(line);
    })
    .join('\n')
    .trim();
}

function buildLocalPreviewSegments(snapshot: ScriptAssetExtractSourceSnapshot): string[] {
  const sourceText = extractPreviewSourceText(snapshot);
  const normalized = sourceText
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return ['正在读取文本，准备拆解分镜。'];
  }

  const sentenceParts = normalized
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const segments: string[] = [];
  let current = '';

  sentenceParts.forEach((part) => {
    const next = current ? `${current}${part}` : part;
    if (Array.from(next).length >= 42) {
      segments.push(next);
      current = '';
      return;
    }
    current = next;
  });

  if (current) {
    segments.push(current);
  }

  return (segments.length > 0 ? segments : [normalized])
    .map((segment) => Array.from(segment).slice(0, 96).join(''))
    .slice(0, 12);
}

function buildLocalPreviewRows(
  requestId: string,
  snapshot: ScriptAssetExtractSourceSnapshot
): DirectorStoryboardTableRow[] {
  return buildLocalPreviewSegments(snapshot).map((segment, index) => ({
    id: `local-preview-${requestId}-${index + 1}`,
    rowState: index === 0 ? 'generating' : 'queued',
    rowError: null,
    sceneNumber: '拆解中',
    shotNumber: String(index + 1),
    sketch: segment,
    shotSize: '待生成',
    cameraAngle: '待生成',
    cameraMovement: '待生成',
    blockingAction: '正在分析动作与调度',
    dialogueOrSound: '',
    durationSeconds: 3,
    assetRefs: [],
    imagePrompt: '',
    remark: 'AI 分镜大纲生成后会自动替换为正式内容',
    group10sId: '',
    group15sId: '',
    isContinuousWithPrev: index > 0,
  }));
}

function estimateDurationSeconds(
  frameDescription: string,
  motionHint: string,
  hasDialogue: boolean,
  isContinuousWithPrev: boolean
): number {
  const textLength = Array.from(frameDescription).length;
  let duration = textLength <= 12 ? 2 : textLength <= 28 ? 3 : 4;
  if (normalizeText(motionHint)) {
    duration += 0.5;
  }
  if (hasDialogue) {
    duration += 0.5;
  }
  if (!isContinuousWithPrev) {
    duration += 0.5;
  }
  return Math.max(1.5, Math.min(6, Math.round(duration * 2) / 2));
}

function buildDurationGroups(
  rows: DirectorStoryboardTableRow[],
  limitSeconds: number,
  prefix: string
): DirectorStoryboardDurationGroup[] {
  const groups: DirectorStoryboardDurationGroup[] = [];
  let currentRows: DirectorStoryboardTableRow[] = [];
  let currentDuration = 0;

  const flush = () => {
    if (currentRows.length === 0) {
      return;
    }
    const groupIndex = groups.length + 1;
    groups.push({
      id: `${prefix}-${groupIndex}`,
      label: `${limitSeconds}s Group ${groupIndex}`,
      rowIds: currentRows.map((row) => row.id),
      totalDurationSeconds: Math.round(currentDuration * 10) / 10,
      startShotNumber: currentRows[0]?.shotNumber ?? '',
      endShotNumber: currentRows[currentRows.length - 1]?.shotNumber ?? '',
    });
    currentRows = [];
    currentDuration = 0;
  };

  rows.forEach((row) => {
    if (currentRows.length > 0 && currentDuration + row.durationSeconds > limitSeconds) {
      flush();
    }
    currentRows.push(row);
    currentDuration += row.durationSeconds;
  });

  flush();
  return groups;
}

function buildContinuousGroups(
  rows: DirectorStoryboardTableRow[]
): DirectorStoryboardDurationGroup[] {
  const groups: DirectorStoryboardDurationGroup[] = [];
  let currentRows: DirectorStoryboardTableRow[] = [];

  const flush = () => {
    if (currentRows.length === 0) {
      return;
    }
    const totalDurationSeconds = currentRows.reduce((sum, row) => sum + row.durationSeconds, 0);
    const groupIndex = groups.length + 1;
    groups.push({
      id: `continuous-${groupIndex}`,
      label: `Continuous ${groupIndex}`,
      rowIds: currentRows.map((row) => row.id),
      totalDurationSeconds: Math.round(totalDurationSeconds * 10) / 10,
      startShotNumber: currentRows[0]?.shotNumber ?? '',
      endShotNumber: currentRows[currentRows.length - 1]?.shotNumber ?? '',
    });
    currentRows = [];
  };

  rows.forEach((row, index) => {
    if (index === 0 || !row.isContinuousWithPrev) {
      flush();
    }
    currentRows.push(row);
  });

  flush();
  return groups;
}

function rebuildDerivedRows(
  rows: DirectorStoryboardTableRow[]
): {
  rows: DirectorStoryboardTableRow[];
  result: SmartDirectorStoryboardResult;
  summary: ScriptStoryboardTableSummary;
} {
  const ordered = rows
    .slice()
    .map((row) => ({
      ...row,
      group10sId: '',
      group15sId: '',
    }));

  const groups10s = buildDurationGroups(ordered, 10, 'group10s');
  const groups15s = buildDurationGroups(ordered, 15, 'group15s');
  const rowMap = new Map(ordered.map((row) => [row.id, row] as const));

  groups10s.forEach((group) => {
    group.rowIds.forEach((rowId) => {
      const row = rowMap.get(rowId);
      if (row) {
        row.group10sId = group.id;
      }
    });
  });

  groups15s.forEach((group) => {
    group.rowIds.forEach((rowId) => {
      const row = rowMap.get(rowId);
      if (row) {
        row.group15sId = group.id;
      }
    });
  });

  const continuousGroups = buildContinuousGroups(ordered);
  const totalDurationSeconds = Math.round(
    ordered.reduce((sum, row) => sum + row.durationSeconds, 0) * 10
  ) / 10;
  const readyRows = ordered.filter((row) => row.rowState === 'ready');

  return {
    rows: ordered,
    result: {
      schemaVersion: 1,
      version: 1,
      generatedAt: Date.now(),
      rows: ordered,
      continuousGroups,
      groups10s,
      groups15s,
      totalDurationSeconds,
    },
    summary: {
      rowCount: ordered.length,
      generatedRowCount: readyRows.length,
      totalDurationSeconds,
      continuousGroupCount: continuousGroups.length,
      groups10sCount: groups10s.length,
      groups15sCount: groups15s.length,
      lastUpdatedAt: Date.now(),
    },
  };
}

function computeContinuousWithPrevious(
  previousRow: DirectorStoryboardTableRow | null,
  nextSceneNumber: string,
  nextAssetRefs: string[]
): boolean {
  if (!previousRow) {
    return false;
  }

  if (normalizeText(previousRow.sceneNumber) !== normalizeText(nextSceneNumber)) {
    return false;
  }

  const previousAssetRefs = new Set(previousRow.assetRefs.map((item) => item.toLowerCase()));
  return nextAssetRefs.some((item) => previousAssetRefs.has(item.toLowerCase()));
}

export function buildAssetReferenceNames(
  extractionResult: ScriptAssetExtractionResult,
  outline: ScriptDirectorStoryboardStreamOutlineRowPayload
): string[] {
  return buildControlledAssetReferenceNames(extractionResult, outline);
}

function buildAvailableAssetReferenceLookup(
  extractionResult: ScriptAssetExtractionResult
): Map<string, string> {
  const lookup = new Map<string, string>();
  const add = (prefix: string, id: string | undefined, name: string | undefined) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      return;
    }

    const label = `${prefix} ${normalizedName}`;
    [id, normalizedName, label, `${prefix}${normalizedName}`].forEach((value) => {
      const key = normalizeAssetLookupKey(value);
      if (key && !lookup.has(key)) {
        lookup.set(key, label);
      }
    });
  };

  extractionResult.charactersCatalog.forEach((item) => add('角色', item.id, item.name));
  extractionResult.scenesCatalog.forEach((item) => add('场景', item.id, item.name));
  extractionResult.itemsCatalog.forEach((item) => add('物品', item.id, item.name));
  return lookup;
}

function normalizeAssetReferenceList(
  extractionResult: ScriptAssetExtractionResult,
  values: string[]
): string[] {
  const lookup = buildAvailableAssetReferenceLookup(extractionResult);
  return values
    .map((value) => {
      const key = normalizeAssetLookupKey(value);
      const exact = lookup.get(key);
      if (exact) {
        return exact;
      }

      return Array.from(lookup.entries()).find(([candidate]) => (
        candidate.length >= 2 && key.includes(candidate)
      ))?.[1] ?? '';
    })
    .filter((value, index, self) => value.length > 0 && self.indexOf(value) === index);
}

function buildControlledAssetReferenceNames(
  extractionResult: ScriptAssetExtractionResult,
  outline: ScriptDirectorStoryboardStreamOutlineRowPayload
): string[] {
  return normalizeAssetReferenceList(
    extractionResult,
    [
      ...outline.characterIds,
      outline.sceneId,
      ...outline.itemIds,
      ...outline.assetRefs,
    ]
  );
}

function buildSkeletonRow(
  extractionResult: ScriptAssetExtractionResult,
  outline: ScriptDirectorStoryboardStreamOutlineRowPayload,
  existingRows: DirectorStoryboardTableRow[]
): DirectorStoryboardTableRow {
  const scene = extractionResult.scenesCatalog.find(
    (item) => (item.id || item.name) === outline.sceneId
  ) ?? null;
  const assetRefs = buildAssetReferenceNamesSafe(extractionResult, outline);
  const previousRow = existingRows.length > 0 ? existingRows[existingRows.length - 1] : null;
  const isContinuousWithPrev = computeContinuousWithPrevious(
    previousRow,
    outline.sceneNumber || scene?.name || '',
    assetRefs
  );
  const durationSeconds = Number.isFinite(outline.durationSeconds) && outline.durationSeconds > 0
    ? Math.max(1, Number(outline.durationSeconds))
    : estimateDurationSeconds(
      outline.sketch,
      outline.blockingAction,
      normalizeText(outline.dialogueOrSound).length > 0,
      isContinuousWithPrev
    );

  return {
    id: outline.rowId,
    rowState: 'queued',
    rowError: null,
    sceneNumber: normalizeText(outline.sceneNumber) || normalizeText(scene?.name) || outline.sceneId || '-',
    shotNumber: normalizeText(outline.shotNumber) || String(outline.seq),
    sketch: normalizeText(outline.sketch) || normalizeText(outline.remark) || '-',
    shotSize: normalizeText(outline.shotSize) || '-',
    cameraAngle: normalizeText(outline.cameraAngle) || '-',
    cameraMovement: normalizeText(outline.cameraMovement) || '-',
    blockingAction: normalizeText(outline.blockingAction) || '-',
    dialogueOrSound: normalizeText(outline.dialogueOrSound),
    durationSeconds,
    assetRefs,
    imagePrompt: '',
    remark: normalizeText(outline.remark) || [
      normalizeText(scene?.lightLock),
      normalizeText(scene?.spaceLayout),
      normalizeText(outline.mood),
    ].filter((value) => value.length > 0).join(' / '),
    group10sId: '',
    group15sId: '',
    isContinuousWithPrev,
  };
}

function buildAssetReferenceNamesSafe(
  extractionResult: ScriptAssetExtractionResult,
  outline: ScriptDirectorStoryboardStreamOutlineRowPayload
): string[] {
  return buildControlledAssetReferenceNames(extractionResult, outline);
}

function applyRowCompletion(
  row: DirectorStoryboardTableRow,
  payload: ScriptDirectorStoryboardStreamRowCompletedPayload,
  extractionResult: ScriptAssetExtractionResult
): DirectorStoryboardTableRow {
  const controlledAssetRefs = normalizeAssetReferenceList(extractionResult, payload.referenceAssetHints);
  return {
    ...row,
    rowState: 'ready',
    rowError: null,
    imagePrompt: normalizeText(payload.imagePrompt) || row.imagePrompt,
    assetRefs: controlledAssetRefs.length > 0 ? controlledAssetRefs : row.assetRefs,
  };
}

function findResultNodePlacement(
  smartNodeId: string,
  generatedResultNodeIds: string[]
): { x: number; y: number } {
  const smartNode = findSmartDirectorNode(smartNodeId);
  const baseNode = smartNode;
  const width = typeof baseNode?.width === 'number'
    ? baseNode.width
    : typeof baseNode?.style?.width === 'number'
      ? baseNode.style.width
      : 640;

  return {
    x: (baseNode?.position.x ?? 0) + width + RESULT_NODE_X_OFFSET,
    y: (baseNode?.position.y ?? 0) + generatedResultNodeIds.length * RESULT_NODE_Y_OFFSET,
  };
}

function promptResultNodeMode(
  nodeId: string,
  hasExistingResult: boolean
): Promise<'reuse' | 'new' | null> | 'new' {
  if (!hasExistingResult) {
    return 'new';
  }

  return new Promise<'reuse' | 'new' | null>((resolve) => {
    canvasEventBus.publish('smart-director-storyboard-result-choice/open', {
      nodeId,
      onResolve: resolve,
    });
  });
}

function applyStreamStateToTableNode(
  resultNodeId: string,
  updater: (data: ScriptStoryboardTableNodeData) => Partial<ScriptStoryboardTableNodeData>
): void {
  const currentNode = findScriptStoryboardTableNode(resultNodeId);
  if (!currentNode) {
    return;
  }

  const patch = updater(currentNode.data);
  useCanvasStore.getState().updateNodeData(resultNodeId, patch, { historyMode: 'skip' });
}

function disposeLocalPreviewRows(requestId: string): void {
  const timers = activeLocalPreviewTimers.get(requestId);
  if (timers) {
    timers.forEach((timer) => clearTimeout(timer));
  }
  activeLocalPreviewTimers.delete(requestId);
}

function startLocalPreviewRows(input: {
  requestId: string;
  resultNodeId: string;
  sourceSnapshot: ScriptAssetExtractSourceSnapshot;
}): void {
  disposeLocalPreviewRows(input.requestId);
  const previewRows = buildLocalPreviewRows(input.requestId, input.sourceSnapshot);
  const timers = previewRows.map((row, index) =>
    setTimeout(() => {
      const tableNode = findScriptStoryboardTableNode(input.resultNodeId);
      if (!tableNode || tableNode.data.streamState.requestId !== input.requestId) {
        return;
      }
      if (tableNode.data.rows.some((existingRow) => !isLocalPreviewRow(existingRow))) {
        disposeLocalPreviewRows(input.requestId);
        return;
      }

      const nextRows = [...tableNode.data.rows, row];
      const derived = rebuildDerivedRows(nextRows);
      applyStreamStateToTableNode(input.resultNodeId, (data) => ({
        rows: derived.rows,
        summary: derived.summary,
        streamState: {
          ...data.streamState,
          requestId: input.requestId,
          phase: 'outlining',
          statusText: `正在拆解文本片段 ${index + 1} / ${previewRows.length}，等待 AI 分镜大纲...`,
          error: null,
          activeRowId: row.id,
          completedRowCount: 0,
          totalRowCount: previewRows.length,
          lastEventAt: Date.now(),
        },
      }));
    }, index * LOCAL_PREVIEW_ROW_INTERVAL_MS)
  );
  activeLocalPreviewTimers.set(input.requestId, timers);
}

export function syncTableNodeDerivedState(
  resultNodeId: string,
  options?: {
    historyMode?: 'skip' | 'record';
    extraPatch?: Partial<ScriptStoryboardTableNodeData>;
  }
): void {
  const tableNode = findScriptStoryboardTableNode(resultNodeId);
  if (!tableNode) {
    return;
  }

  const derived = rebuildDerivedRows(tableNode.data.rows);
  useCanvasStore.getState().updateNodeData(
    resultNodeId,
    {
      rows: derived.rows,
      summary: derived.summary,
      ...(options?.extraPatch ?? {}),
    },
    options?.historyMode === 'record' ? undefined : { historyMode: 'skip' }
  );
}

function syncSmartNodeResultFromTable(
  smartNodeId: string,
  resultNodeId: string,
  extraPatch?: Partial<SmartDirectorStoryboardNodeData>
): void {
  const tableNode = findScriptStoryboardTableNode(resultNodeId);
  if (!tableNode) {
    return;
  }

  const derived = rebuildDerivedRows(tableNode.data.rows);
  useCanvasStore.getState().updateNodeData(
    smartNodeId,
    {
      activeResultNodeId: resultNodeId,
      result: derived.result,
      linkedStoryboardProjectId: tableNode.data.linkedStoryboardProjectId,
      storyboardTransferStatus: tableNode.data.storyboardTransferStatus,
      storyboardTransferSnapshot: tableNode.data.storyboardTransferSnapshot,
      ...extraPatch,
    },
    { historyMode: 'skip' }
  );
}

function syncSourceSmartNodeFromTableNode(resultNodeId: string): void {
  const tableNode = findScriptStoryboardTableNode(resultNodeId);
  const smartNodeId = tableNode?.data.sourceSmartDirectorStoryboardNodeId ?? null;
  if (!tableNode || !smartNodeId) {
    return;
  }
  syncSmartNodeResultFromTable(smartNodeId, resultNodeId);
}

function applyOutlineRowCreatedEvent(
  input: ApplySmartDirectorStoryboardStreamEventInput & { event: StreamOutlineEvent }
): void {
  const { event, extractionResult, smartNodeId, resultNodeId } = input;
  disposeLocalPreviewRows(event.requestId);
  const currentNode = findScriptStoryboardTableNode(resultNodeId);
  if (!currentNode) {
    return;
  }

  const existingRows = currentNode.data.rows.filter((row) => !isLocalPreviewRow(row));
  const skeletonRow = buildSkeletonRow(
    extractionResult,
    event.row,
    existingRows
  );
  const derived = rebuildDerivedRows([...existingRows, skeletonRow]);
  applyStreamStateToTableNode(resultNodeId, () => ({
    rows: derived.rows,
    summary: derived.summary,
    streamState: {
      requestId: event.requestId,
      phase: 'outlining',
      statusText: STREAM_OUTLINING_MESSAGE,
      error: null,
      activeRowId: skeletonRow.id,
      completedRowCount: derived.summary.generatedRowCount,
      totalRowCount: Math.max(event.totalRows, derived.summary.rowCount),
      lastEventAt: Date.now(),
    },
  }));
  syncSmartNodeResultFromTable(smartNodeId, resultNodeId, {
    generationState: buildGenerationState('generating', STREAM_OUTLINING_MESSAGE, null, event.requestId),
  });
}

function applyRowGenerationStartedEvent(
  input: ApplySmartDirectorStoryboardStreamEventInput & { event: StreamRowStartedEvent }
): void {
  const { event, smartNodeId, resultNodeId } = input;
  applyStreamStateToTableNode(resultNodeId, (data) => ({
    rows: data.rows.map((row) => (
      row.id === event.rowId && !(data.manuallyEditedRowIds ?? []).includes(row.id)
        ? { ...row, rowState: 'generating', rowError: null }
        : row
    )),
    streamState: {
      ...data.streamState,
      requestId: event.requestId,
      phase: 'streaming',
      statusText: event.message,
      error: null,
      activeRowId: event.rowId,
      totalRowCount: Math.max(data.streamState.totalRowCount, event.totalRows),
      lastEventAt: Date.now(),
    },
  }));
  syncSmartNodeResultFromTable(smartNodeId, resultNodeId, {
    generationState: buildGenerationState('generating', event.message, null, event.requestId),
  });
}

function applyRowGenerationCompletedEvent(
  input: ApplySmartDirectorStoryboardStreamEventInput & { event: StreamRowCompletedEvent }
): void {
  const { event, extractionResult, smartNodeId, resultNodeId } = input;
  applyStreamStateToTableNode(resultNodeId, (data) => {
    const completedRows = data.rows.map((row) => (
      row.id === event.row.rowId && !(data.manuallyEditedRowIds ?? []).includes(row.id)
        ? applyRowCompletion(row, event.row, extractionResult)
        : row
    ));
    const derived = rebuildDerivedRows(completedRows);
    return {
      rows: derived.rows,
      summary: derived.summary,
      streamState: {
        ...data.streamState,
        requestId: event.requestId,
        phase: 'streaming',
        statusText: event.message,
        error: null,
        activeRowId: event.row.rowId,
        completedRowCount: event.generatedRowCount,
        totalRowCount: Math.max(data.streamState.totalRowCount, event.totalRows),
        lastEventAt: Date.now(),
      },
    };
  });
  syncSmartNodeResultFromTable(smartNodeId, resultNodeId, {
    generationState: buildGenerationState('generating', event.message, null, event.requestId),
  });
}

function buildManualStoryboardRow(
  rows: DirectorStoryboardTableRow[],
  insertIndex = rows.length
): DirectorStoryboardTableRow {
  const nextIndex = insertIndex + 1;
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `storyboard-row-${Date.now()}-${nextIndex}`,
    rowState: 'ready',
    rowError: null,
    sceneNumber: '',
    shotNumber: String(nextIndex),
    sketch: '',
    shotSize: '',
    cameraAngle: '',
    cameraMovement: '',
    blockingAction: '',
    dialogueOrSound: '',
    durationSeconds: 3,
    assetRefs: [],
    imagePrompt: '',
    remark: '',
    group10sId: '',
    group15sId: '',
    isContinuousWithPrev: false,
  };
}

export function parseStoryboardDurationSeconds(value: string, fallback: number): number {
  const normalized = value.replace(/[sS秒]/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0.5, parsed) : fallback;
}

export function parseStoryboardAssetRefs(value: string): string[] {
  return value
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

export function readStoryboardCellValue(row: DirectorStoryboardTableRow, columnKey: string): string {
  switch (columnKey) {
    case 'duration':
      return String(row.durationSeconds ?? '');
    case 'assets':
      return row.assetRefs.join('\n');
    default:
      return String((row as unknown as Record<string, unknown>)[columnKey] ?? '');
  }
}

function parseStoryboardDurationSecondsSafe(value: string, fallback: number): number {
  const normalized = value.replace(/[^0-9.]+/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0.5, parsed) : fallback;
}

function parseStoryboardAssetRefsSafe(value: string): string[] {
  return value
    .split(/[\n,\uFF0C\u3001]+/)
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

function updateStoryboardRowValue(
  row: DirectorStoryboardTableRow,
  columnKey: string,
  value: string
): DirectorStoryboardTableRow {
  switch (columnKey) {
    case 'duration':
      return {
        ...row,
        durationSeconds: parseStoryboardDurationSecondsSafe(value, row.durationSeconds),
      };
    case 'assets':
      return {
        ...row,
        assetRefs: parseStoryboardAssetRefsSafe(value),
      };
    default:
      return {
        ...row,
        [columnKey]: value,
      } as DirectorStoryboardTableRow;
  }
}

function bumpManualEditState(
  data: ScriptStoryboardTableNodeData,
  rowId?: string | null
): Pick<ScriptStoryboardTableNodeData, 'manualEditVersion' | 'manuallyEditedRowIds'> {
  return {
    manualEditVersion: (data.manualEditVersion ?? 0) + 1,
    manuallyEditedRowIds: rowId
      ? Array.from(new Set([...(data.manuallyEditedRowIds ?? []), rowId]))
      : [...(data.manuallyEditedRowIds ?? [])],
  };
}

function migrateLegacyResultNode(smartNodeId: string): string | null {
  const smartNode = findSmartDirectorNode(smartNodeId);
  if (!smartNode || !smartNode.data.result || smartNode.data.activeResultNodeId) {
    return smartNode?.data.activeResultNodeId ?? null;
  }

  const boundAssetNodeId = smartNode.data.sourceAssetExtractNodeId ?? '';
  const sourceLabel = smartNode.data.resolvedSourceSnapshot?.sourceNodeTitle
    || resolveNodeDisplayName(CANVAS_NODE_TYPES.smartDirectorStoryboard, smartNode.data);

  const resultNodeId = createScriptStoryboardTableNode({
    smartNodeId,
    sourceAssetExtractNodeId: boundAssetNodeId,
    sourceLabel,
    sourceSnapshotVersion: Date.now(),
    mode: 'new',
  });

  const legacyResult = smartNode.data.result;
  const derived = rebuildDerivedRows(
    legacyResult.rows.map((row) => ({
      ...row,
      rowState: row.rowState ?? 'ready',
      rowError: row.rowError ?? null,
    }))
  );

  useCanvasStore.getState().updateNodeData(
    resultNodeId,
    {
      rows: derived.rows,
      summary: derived.summary,
      streamState: {
        requestId: null,
        phase: 'completed',
        statusText: '已从旧版结果迁移',
        error: null,
        activeRowId: null,
        completedRowCount: derived.summary.generatedRowCount,
        totalRowCount: derived.summary.rowCount,
        lastEventAt: Date.now(),
      },
    },
    { historyMode: 'skip' }
  );

  useCanvasStore.getState().updateNodeData(
    smartNodeId,
    {
      activeResultNodeId: resultNodeId,
      generatedResultNodeIds: Array.from(new Set([...(smartNode.data.generatedResultNodeIds || []), resultNodeId])),
      result: derived.result,
    },
    { historyMode: 'skip' }
  );

  return resultNodeId;
}

function ensureResultEdge(smartNodeId: string, resultNodeId: string): void {
  const { edges, addEdge } = useCanvasStore.getState();
  const exists = edges.some((edge) => edge.source === smartNodeId && edge.target === resultNodeId);
  if (!exists) {
    addEdge(smartNodeId, resultNodeId);
  }
}

export function resolveSmartDirectorStoryboardBindingState(
  input: ResolveSmartDirectorStoryboardSourceInput
): SmartDirectorStoryboardBindingState | null {
  const smartNode = input.nodes.find(
    (node): node is CanvasNode & {
      type: typeof CANVAS_NODE_TYPES.smartDirectorStoryboard;
      data: SmartDirectorStoryboardNodeData;
    } => node.id === input.nodeId && node.type === CANVAS_NODE_TYPES.smartDirectorStoryboard
  );
  if (!smartNode) {
    return null;
  }

  const assetNode = resolveConnectedAssetExtractNode(input.nodeId, input.nodes, input.edges);
  if (!assetNode) {
    return {
      smartNode,
      assetNode: null,
      bindingStatus: 'missingAssetNode',
      resolvedSourceSnapshot: null,
      extractionResult: null,
      sourceLabel: null,
    };
  }

  const resolvedSourceSnapshot = resolveScriptAssetExtractSource({
    nodeId: assetNode.id,
    sourceMode: assetNode.data.sourceMode,
    selectedChapterIds: assetNode.data.selectedChapterIds,
    nodes: input.nodes,
    edges: input.edges,
  });
  const extractionResult = assetNode.data.extractionResult;
  if (!extractionResult) {
    return {
      smartNode,
      assetNode,
      bindingStatus: 'missingExtractionResult',
      resolvedSourceSnapshot,
      extractionResult: null,
      sourceLabel: resolveSourceLabel(resolvedSourceSnapshot, assetNode.data),
    };
  }

  if (!areSameSourceSnapshots(assetNode.data.resolvedSourceSnapshot, resolvedSourceSnapshot)) {
    return {
      smartNode,
      assetNode,
      bindingStatus: 'staleExtractionResult',
      resolvedSourceSnapshot,
      extractionResult,
      sourceLabel: resolveSourceLabel(resolvedSourceSnapshot, assetNode.data),
    };
  }

  return {
    smartNode,
    assetNode,
    bindingStatus: 'ready',
    resolvedSourceSnapshot,
    extractionResult,
    sourceLabel: resolveSourceLabel(resolvedSourceSnapshot, assetNode.data),
  };
}

export function canUseSmartDirectorStoryboard(
  bindingState: SmartDirectorStoryboardBindingState | null
): boolean {
  return bindingState?.bindingStatus === 'ready'
    || bindingState?.bindingStatus === 'staleExtractionResult';
}

export function resolveSmartDirectorStoryboardUnavailableReason(
  bindingState: SmartDirectorStoryboardBindingState | null
): string {
  if (!bindingState || bindingState.bindingStatus === 'missingAssetNode') {
    return MISSING_ASSET_MESSAGE;
  }

  if (bindingState.bindingStatus === 'missingExtractionResult') {
    return '请先在前置剧本资产提取节点完成资产提取。';
  }

  if (bindingState.bindingStatus === 'staleExtractionResult') {
    return STALE_ASSET_SOURCE_MESSAGE;
  }

  return '';
}

export function buildSmartDirectorStoryboardAssetGroups(
  extractionResult: ScriptAssetExtractionResult | null
): Array<{
  key: 'characters' | 'scenes' | 'items';
  items: string[];
}> {
  if (!extractionResult) {
    return [];
  }

  return [
    {
      key: 'characters' as const,
      items: extractionResult.charactersCatalog
        .map((item) => normalizeText(item.name))
        .filter((value) => value.length > 0),
    },
    {
      key: 'scenes' as const,
      items: extractionResult.scenesCatalog
        .map((item) => normalizeText(item.name))
        .filter((value) => value.length > 0),
    },
    {
      key: 'items' as const,
      items: extractionResult.itemsCatalog
        .map((item) => normalizeText(item.name))
        .filter((value) => value.length > 0),
    },
  ].filter((group) => group.items.length > 0);
}

export function countSmartDirectorStoryboardAssets(
  extractionResult: ScriptAssetExtractionResult | null
): number {
  return buildSmartDirectorStoryboardAssetGroups(extractionResult).reduce(
    (total, group) => total + group.items.length,
    0
  );
}

export function resolveSmartDirectorStoryboardSource(
  input: ResolveSmartDirectorStoryboardSourceInput
): ResolvedSmartDirectorStoryboardSource | null {
  const bindingState = resolveSmartDirectorStoryboardBindingState(input);
  if (
    !bindingState
    || (
      bindingState.bindingStatus !== 'ready'
      && bindingState.bindingStatus !== 'staleExtractionResult'
    )
    || !bindingState.assetNode
    || !bindingState.resolvedSourceSnapshot
    || !bindingState.extractionResult
    || !bindingState.sourceLabel
  ) {
    return null;
  }

  const sourceText = [
    normalizeText(bindingState.resolvedSourceSnapshot.sourceText),
    bindingState.bindingStatus === 'staleExtractionResult'
      ? buildAssetNameContextAppendix(bindingState.extractionResult)
      : buildAssetContextAppendix(bindingState.extractionResult),
  ].filter((value) => value.length > 0).join('\n\n');

  if (!sourceText.trim()) {
    return null;
  }

  return {
    smartNode: bindingState.smartNode,
    assetNode: bindingState.assetNode,
    resolvedSourceSnapshot: bindingState.resolvedSourceSnapshot,
    extractionResult: bindingState.extractionResult,
    sourceLabel: bindingState.sourceLabel,
    sourceText,
  };
}

export function buildSmartDirectorStoryboardTable(
  rows: DirectorStoryboardTableRow[]
): SmartDirectorStoryboardResult {
  return rebuildDerivedRows(rows).result;
}

export function computeDirectorStoryboardDurationGroups(
  rows: DirectorStoryboardTableRow[]
): {
  continuousGroups: DirectorStoryboardDurationGroup[];
  groups10s: DirectorStoryboardDurationGroup[];
  groups15s: DirectorStoryboardDurationGroup[];
} {
  const derived = rebuildDerivedRows(rows);
  return {
    continuousGroups: derived.result.continuousGroups,
    groups10s: derived.result.groups10s,
    groups15s: derived.result.groups15s,
  };
}

function resolveProductionGroupsForMode(
  rows: DirectorStoryboardTableRow[],
  mode: '10s' | '15s'
): DirectorStoryboardDurationGroup[] {
  const groups = computeDirectorStoryboardDurationGroups(rows);
  return mode === '10s' ? groups.groups10s : groups.groups15s;
}

function resolveStoryboardFrameDescription(row: DirectorStoryboardTableRow): string {
  return [
    normalizeText(row.imagePrompt),
    normalizeText(row.sketch),
    normalizeText(row.blockingAction),
    normalizeText(row.remark),
  ].find((value) => value.length > 0) ?? '';
}

function normalizeAssetMatchName(value: string): string {
  return value.replace(/^@+/, '').trim().toLowerCase();
}

function resolveProductionCardPosition(
  tableNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
    data: ScriptStoryboardTableNodeData;
  },
  index: number
): { x: number; y: number } {
  const column = index % PRODUCTION_CARD_COLUMNS;
  const row = Math.floor(index / PRODUCTION_CARD_COLUMNS);
  return {
    x: tableNode.position.x + resolveNodeWidth(tableNode) + PRODUCTION_CARD_X_OFFSET
      + column * (PRODUCTION_CARD_WIDTH + PRODUCTION_CARD_GAP_X),
    y: tableNode.position.y + row * (PRODUCTION_CARD_HEIGHT + PRODUCTION_CARD_GAP_Y),
  };
}

function resolveGroupRows(
  tableNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
    data: ScriptStoryboardTableNodeData;
  },
  durationGroup: DirectorStoryboardDurationGroup
): DirectorStoryboardTableRow[] {
  const rowMap = new Map(tableNode.data.rows.map((row) => [row.id, row] as const));
  return durationGroup.rowIds
    .map((rowId) => rowMap.get(rowId))
    .filter((row): row is DirectorStoryboardTableRow => Boolean(row));
}

function resolveMatchedAssetIds(input: {
  assetLibraryId: string | null;
  assetNames: string[];
}): string[] {
  const assetNameSet = new Set(input.assetNames.map(normalizeAssetMatchName).filter(Boolean));
  if (!input.assetLibraryId || assetNameSet.size === 0) {
    return [];
  }

  const library = useAssetStore.getState().libraries.find((item) => item.id === input.assetLibraryId);
  if (!library) {
    return [];
  }

  const imageItems = library.items.filter((item) =>
    item.mediaType === 'image'
    && (item.category === 'character' || item.category === 'scene' || item.category === 'prop')
  );
  const exactMatches = imageItems.filter((item) => assetNameSet.has(normalizeAssetMatchName(item.name)));
  const matches = exactMatches.length > 0
    ? exactMatches
    : imageItems.filter((item) => {
        const itemName = normalizeAssetMatchName(item.name);
        return Array.from(assetNameSet).some((assetName) =>
          assetName.includes(itemName) || itemName.includes(assetName)
        );
      });

  return Array.from(new Set(matches.map((item) => item.id)));
}

function buildAssetReferenceTokens(assetNames: string[]): string[] {
  const nameCounts = new Map<string, number>();
  return assetNames
    .map((name) => name.replace(/\s+/g, '').trim())
    .filter(Boolean)
    .map((name) => {
      const count = nameCounts.get(name) ?? 0;
      nameCounts.set(name, count + 1);
      return `@${name}${count > 0 ? count + 1 : ''}`;
    });
}

function buildImagePromptForRows(rows: DirectorStoryboardTableRow[], assetNames: string[]): string {
  const referenceTokens = buildAssetReferenceTokens(assetNames);
  return [
    referenceTokens.length > 0 ? referenceTokens.join(' ') : '',
    rows
      .map((row, index) => {
        const shotLabel = row.shotNumber || `${index + 1}`;
        return `${shotLabel}：${resolveStoryboardFrameDescription(row)}`;
      })
      .join('\n'),
  ].filter((value) => value.trim().length > 0).join('\n');
}

function buildVideoPromptForRows(rows: DirectorStoryboardTableRow[]): string {
  return rows
    .map((row, index) => {
      const parts = [
        row.shotNumber || `镜头${index + 1}`,
        row.sketch,
        row.blockingAction,
        row.cameraMovement,
        row.dialogueOrSound,
      ].map(normalizeText).filter(Boolean);
      return parts.join('，');
    })
    .join('\n');
}

function buildVideoPromptForRowsWithAssets(rows: DirectorStoryboardTableRow[], assetNames: string[]): string {
  const referenceTokens = buildAssetReferenceTokens(assetNames);
  return [
    referenceTokens.length > 0 ? referenceTokens.join(' ') : '',
    buildVideoPromptForRows(rows),
  ].filter((value) => value.trim().length > 0).join('\n');
}

function buildProductionShotSummaries(rows: DirectorStoryboardTableRow[]): Array<{
  shotNumber: string;
  durationSeconds: number;
  content: string;
}> {
  return rows.map((row, index) => ({
    shotNumber: row.shotNumber || row.sceneNumber || `镜头${index + 1}`,
    durationSeconds: row.durationSeconds,
    content: [
      row.sketch,
      row.blockingAction,
      row.dialogueOrSound,
    ].map(normalizeText).filter(Boolean).join(' / '),
  }));
}

function buildProductionCardAndChildren(input: {
  tableNode: CanvasNode & {
    type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
    data: ScriptStoryboardTableNodeData;
  };
  durationGroup: DirectorStoryboardDurationGroup;
  mode: '10s' | '15s';
  videoKind: ScriptStoryboardProductionVideoKind;
  position: { x: number; y: number };
  index: number;
  previousImageNodeId: string | null;
  previousRowId: string | null;
}): { groupNode: CanvasNode; childNodes: CanvasNode[]; edges: CanvasEdge[]; imageNodeId: string } {
  const rows = resolveGroupRows(input.tableNode, input.durationGroup);
  const targetVideoDurationSeconds = input.mode === '15s' ? 15 : 10;
  const assetNames = Array.from(new Set(rows.flatMap((row) => row.assetRefs).map(normalizeText).filter(Boolean)));
  const assetLibraryId =
    useProjectStore.getState().currentProject?.assetLibraryId
    ?? useAssetStore.getState().libraries[0]?.id
    ?? null;
  const selectedAssetIds = resolveMatchedAssetIds({ assetLibraryId, assetNames });
  const groupTitle = `${input.durationGroup.label} · ${input.mode}`;
  const groupNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.group,
    input.position,
    {
      displayName: groupTitle,
      label: groupTitle,
      visualStyle: 'storyboardProductionGroup',
      batchKind: input.mode === '15s' ? 'storyboard15s' : 'storyboard10s',
      maxItemsPerLine: 3,
      sourceStoryboardTableNodeId: input.tableNode.id,
      sourceStoryboardRowIds: rows.map((row) => row.id),
      sourceStoryboardShotLabels: rows.map((row) => row.shotNumber || row.sceneNumber).filter(Boolean),
      sourceStoryboardShotSummaries: buildProductionShotSummaries(rows),
      sourceDurationGroupId: input.durationGroup.id,
      storyboardProductionMode: input.mode,
      continuousReferenceEnabled: input.tableNode.data.continuousReferenceEnabled === true,
      totalDurationSeconds: targetVideoDurationSeconds,
      targetVideoDurationSeconds,
      videoKind: input.videoKind,
    } satisfies Partial<GroupNodeData> & Record<string, unknown>
  );
  groupNode.width = PRODUCTION_CARD_WIDTH;
  groupNode.height = PRODUCTION_CARD_HEIGHT;
  groupNode.style = {
    ...(groupNode.style ?? {}),
    width: PRODUCTION_CARD_WIDTH,
    height: PRODUCTION_CARD_HEIGHT,
  };

  const assetNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.assetMaterial,
    { x: 24, y: PRODUCTION_CHILD_TOP },
    {
      displayName: i18n.t('node.assetMaterial.displayName'),
      assetLibraryId,
      selectedAssetIds,
      sourceStoryboardTableNodeId: input.tableNode.id,
      sourceStoryboardRowIds: rows.map((row) => row.id),
      sourceDurationGroupId: input.durationGroup.id,
      defaultMatchedAssetNames: assetNames,
      displayMode: 'nameOnlyAccordion',
    } satisfies Partial<AssetMaterialNodeData>
  );
  const imageNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.imageEdit,
    { x: 24 + PRODUCTION_ASSET_NODE_WIDTH + 24, y: PRODUCTION_CHILD_TOP },
    {
      displayName: i18n.t('node.storyboardProductionGroup.imageNodeTitle', { index: input.index + 1 }),
      prompt: buildImagePromptForRows(rows, assetNames),
      model: DEFAULT_IMAGE_MODEL_ID,
      size: '2K',
      requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
      sourceStoryboardTableNodeId: input.tableNode.id,
      sourceStoryboardRowIds: rows.map((row) => row.id),
      sourceDurationGroupId: input.durationGroup.id,
      targetVideoDurationSeconds,
      sourceAssetMaterialNodeId: assetNode.id,
      referenceTokenMode: 'namedAsset',
      continuousReferenceChain:
        input.tableNode.data.continuousReferenceEnabled === true
          ? {
              enabled: true,
              previousImageNodeId: input.previousImageNodeId,
              previousRowId: input.previousRowId,
            }
          : undefined,
    } satisfies Partial<ImageEditNodeData>
  );
  const imageResultNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.exportImage,
    {
      x: 24 + PRODUCTION_ASSET_NODE_WIDTH + 24 + PRODUCTION_IMAGE_NODE_WIDTH + 24,
      y: PRODUCTION_CHILD_TOP,
    },
    {
      displayName: i18n.t('node.storyboardProductionGroup.imageResultTitle', { index: input.index + 1 }),
      imageUrl: null,
      previewImageUrl: null,
      resultKind: 'generic',
      generationSummary: null,
      generationPhase: null,
      generationFailureStage: null,
      isStoryboardProductionPlaceholder: true,
      sourceImageNodeId: imageNode.id,
      sourceStoryboardTableNodeId: input.tableNode.id,
      sourceStoryboardRowIds: rows.map((row) => row.id),
      sourceDurationGroupId: input.durationGroup.id,
    } satisfies Partial<ExportImageNodeData>
  );
  imageNode.data = {
    ...imageNode.data,
    sourceImageResultNodeId: imageResultNode.id,
  };
  const videoType = input.videoKind === 'jimeng'
    ? CANVAS_NODE_TYPES.jimeng
    : CANVAS_NODE_TYPES.seedance;
  const videoNode = canvasNodeFactory.createNode(
    videoType,
    {
      x: 24
        + PRODUCTION_ASSET_NODE_WIDTH + 24
        + PRODUCTION_IMAGE_NODE_WIDTH + 24
        + PRODUCTION_RESULT_NODE_WIDTH + 24,
      y: PRODUCTION_CHILD_TOP,
    },
    input.videoKind === 'jimeng'
      ? ({
          displayName: i18n.t('node.storyboardProductionGroup.jimengVideoTitle', { index: input.index + 1 }),
          prompt: buildVideoPromptForRowsWithAssets(rows, assetNames),
          durationSeconds: targetVideoDurationSeconds,
          sourceStoryboardTableNodeId: input.tableNode.id,
          sourceStoryboardRowIds: rows.map((row) => row.id),
          sourceDurationGroupId: input.durationGroup.id,
          targetVideoDurationSeconds,
          sourceImageNodeId: imageNode.id,
          sourceAssetMaterialNodeId: assetNode.id,
          sourceImageResultNodeId: imageResultNode.id,
          referenceTokenMode: 'namedAsset',
        } satisfies Partial<JimengNodeData>)
      : ({
          displayName: i18n.t('node.storyboardProductionGroup.seedanceVideoTitle', { index: input.index + 1 }),
          prompt: buildVideoPromptForRowsWithAssets(rows, assetNames),
          durationSeconds: targetVideoDurationSeconds,
          sourceStoryboardTableNodeId: input.tableNode.id,
          sourceStoryboardRowIds: rows.map((row) => row.id),
          sourceDurationGroupId: input.durationGroup.id,
          targetVideoDurationSeconds,
          sourceImageNodeId: imageNode.id,
          sourceAssetMaterialNodeId: assetNode.id,
          sourceImageResultNodeId: imageResultNode.id,
          referenceTokenMode: 'namedAsset',
        } satisfies Partial<SeedanceNodeData>)
  );

  const sizedChildren = [
    {
      node: assetNode,
      width: PRODUCTION_ASSET_NODE_WIDTH,
      height: PRODUCTION_ASSET_NODE_HEIGHT,
    },
    {
      node: imageNode,
      width: PRODUCTION_IMAGE_NODE_WIDTH,
      height: PRODUCTION_IMAGE_NODE_HEIGHT,
    },
    {
      node: imageResultNode,
      width: PRODUCTION_RESULT_NODE_WIDTH,
      height: PRODUCTION_RESULT_NODE_HEIGHT,
    },
    {
      node: videoNode,
      width: PRODUCTION_VIDEO_NODE_WIDTH,
      height: PRODUCTION_VIDEO_NODE_HEIGHT,
    },
  ].map(({ node, width, height }) => ({
    ...node,
    parentId: groupNode.id,
    width,
    height,
    style: {
      ...(node.style ?? {}),
      width,
      height,
    },
  }));

  const edges: CanvasEdge[] = [
    {
      id: `e-${assetNode.id}-${imageNode.id}`,
      source: assetNode.id,
      target: imageNode.id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
    },
    {
      id: `e-${imageNode.id}-${imageResultNode.id}`,
      source: imageNode.id,
      target: imageResultNode.id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
    },
    {
      id: `e-${imageResultNode.id}-${videoNode.id}`,
      source: imageResultNode.id,
      target: videoNode.id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
    },
    {
      id: `e-${assetNode.id}-${videoNode.id}`,
      source: assetNode.id,
      target: videoNode.id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
    },
  ];

  return {
    groupNode,
    childNodes: sizedChildren,
    edges,
    imageNodeId: imageNode.id,
  };
}

export function setScriptStoryboardTableContinuousReference(input: {
  nodeId: string;
  enabled: boolean;
}): void {
  const tableNode = findScriptStoryboardTableNode(input.nodeId);
  if (!tableNode || tableNode.data.presentationMode !== 'storyboardMirror') {
    return;
  }

  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    { continuousReferenceEnabled: input.enabled },
    { historyMode: 'skip' }
  );
}

export function removePreviousScriptStoryboardProductionGroups(input: {
  sourceNodeId: string;
  mode: '10s' | '15s';
}): void {
  const state = useCanvasStore.getState();
  const groupIds = state.nodes
    .filter((node) => {
      if (node.type !== CANVAS_NODE_TYPES.group) {
        return false;
      }
      const data = node.data as GroupNodeData & {
        sourceStoryboardTableNodeId?: string | null;
        storyboardProductionMode?: string | null;
      };
      return (
        data.visualStyle === 'storyboardProductionGroup'
        && data.sourceStoryboardTableNodeId === input.sourceNodeId
        && data.storyboardProductionMode === input.mode
      );
    })
    .map((node) => node.id);

  if (groupIds.length > 0) {
    state.deleteNodes(groupIds);
  }
}

export function expandScriptStoryboardTableToProductionGroups(input: {
  nodeId: string;
  mode: '10s' | '15s';
  videoKind: ScriptStoryboardProductionVideoKind;
}): string | null {
  const tableNode = findScriptStoryboardTableNode(input.nodeId);
  if (!tableNode || tableNode.data.presentationMode !== 'storyboardMirror') {
    return null;
  }

  const groups = resolveProductionGroupsForMode(tableNode.data.rows, input.mode);
  if (groups.length === 0) {
    return null;
  }

  removePreviousScriptStoryboardProductionGroups({
    sourceNodeId: input.nodeId,
    mode: input.mode,
  });

  const latestTableNode = findScriptStoryboardTableNode(input.nodeId) ?? tableNode;
  let previousImageNodeId: string | null = null;
  let previousRowId: string | null = null;
  const builtCards = groups.map((durationGroup, index) => {
    const built = buildProductionCardAndChildren({
      tableNode: latestTableNode,
      durationGroup,
      mode: input.mode,
      videoKind: input.videoKind,
      position: resolveProductionCardPosition(latestTableNode, index),
      index,
      previousImageNodeId,
      previousRowId,
    });
    const rows = resolveGroupRows(latestTableNode, durationGroup);
    previousImageNodeId = built.imageNodeId;
    previousRowId = rows[rows.length - 1]?.id ?? previousRowId;
    return built;
  });
  const groupNodes = builtCards.map((item) => item.groupNode);
  const childNodes = builtCards.flatMap((item) => item.childNodes);
  const edges: CanvasEdge[] = builtCards.flatMap((item) => item.edges);

  useCanvasStore.setState((state) => {
    const existingNodeIds = new Set(state.nodes.map((node) => node.id));
    const nextExpandedIds = Array.from(
      new Set([
        ...(latestTableNode.data.expandedProductionGroupNodeIds ?? []).filter(
          (nodeId) => existingNodeIds.has(nodeId) && !groupNodes.some((groupNode) => groupNode.id === nodeId)
        ),
        ...groupNodes.map((groupNode) => groupNode.id),
      ])
    );
    return {
      nodes: [
        ...state.nodes.map((node) =>
          node.id === latestTableNode.id
            ? {
                ...node,
                selected: false,
                data: {
                  ...node.data,
                  storyboardProductionMode: input.mode,
                  expandedProductionGroupNodeIds: nextExpandedIds,
                },
              }
            : { ...node, selected: false }
        ),
        ...groupNodes.map((groupNode, index) => ({ ...groupNode, selected: index === 0 })),
        ...childNodes,
      ],
      edges: [
        ...state.edges.filter((edge) =>
          !edges.some((nextEdge) => nextEdge.id === edge.id)
        ),
        ...edges,
      ],
      selectedNodeId: groupNodes[0]?.id ?? null,
      currentViewport: buildFocusViewport({
        x: groupNodes[0]?.position.x ?? latestTableNode.position.x,
        y: groupNodes[0]?.position.y ?? latestTableNode.position.y,
        width: PRODUCTION_CARD_WIDTH,
        height: PRODUCTION_CARD_HEIGHT,
      }) ?? DEFAULT_VIEWPORT,
      history: {
        past: state.history.past,
        future: state.history.future,
      },
      dragHistorySnapshot: null,
    };
  });

  groupNodes.forEach((groupNode) => {
    useCanvasStore.getState().fitGroupNodeToChildren(groupNode.id);
  });
  const firstGroupNodeId = groupNodes[0]?.id ?? null;
  const fittedGroupNode = firstGroupNodeId
    ? useCanvasStore.getState().nodes.find((node) => node.id === firstGroupNodeId)
    : null;
  if (fittedGroupNode) {
    useCanvasStore.getState().setViewportState(buildFocusViewport({
      x: fittedGroupNode.position.x,
      y: fittedGroupNode.position.y,
      width: resolveNodeWidth(fittedGroupNode),
      height: resolveNodeHeight(fittedGroupNode),
    }) ?? DEFAULT_VIEWPORT);
  }
  return firstGroupNodeId;
}

export function recomputeScriptStoryboardTableSummary(
  rows: DirectorStoryboardTableRow[]
): ScriptStoryboardTableSummary {
  return rebuildDerivedRows(rows).summary;
}

export function updateScriptStoryboardTableCell(input: {
  nodeId: string;
  rowId: string;
  columnKey: string;
  value: string;
}): void {
  const tableNode = findScriptStoryboardTableNode(input.nodeId);
  if (!tableNode) {
    return;
  }

  const nextRows = tableNode.data.rows.map((row) => (
    row.id === input.rowId
      ? updateStoryboardRowValue(row, input.columnKey, input.value)
      : row
  ));
  const manualState = bumpManualEditState(tableNode.data, input.rowId);
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      rows: rebuildDerivedRows(nextRows).rows,
      summary: recomputeScriptStoryboardTableSummary(nextRows),
      activeEditingCell: null,
      ...manualState,
    },
    { historyMode: 'skip' }
  );
  syncSourceSmartNodeFromTableNode(input.nodeId);
}

export function addScriptStoryboardTableRow(input: {
  nodeId: string;
  afterRowId?: string | null;
}): string | null {
  const tableNode = findScriptStoryboardTableNode(input.nodeId);
  if (!tableNode) {
    return null;
  }

  const currentIndex =
    input.afterRowId
      ? tableNode.data.rows.findIndex((row) => row.id === input.afterRowId)
      : -1;
  const insertIndex =
    currentIndex >= 0 ? currentIndex + 1 : tableNode.data.rows.length;
  const newRow = buildManualStoryboardRow(tableNode.data.rows, insertIndex);
  const nextRows = [...tableNode.data.rows];
  nextRows.splice(insertIndex, 0, newRow);
  const manualState = bumpManualEditState(tableNode.data, newRow.id);
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      rows: rebuildDerivedRows(nextRows).rows,
      summary: recomputeScriptStoryboardTableSummary(nextRows),
      activeEditingCell: {
        rowId: newRow.id,
        columnKey: 'sketch',
      },
      ...manualState,
    }
  );
  syncSourceSmartNodeFromTableNode(input.nodeId);
  return newRow.id;
}

export function deleteScriptStoryboardTableRow(input: {
  nodeId: string;
  rowId: string;
}): void {
  const tableNode = findScriptStoryboardTableNode(input.nodeId);
  if (!tableNode) {
    return;
  }

  const nextRows = tableNode.data.rows.filter((row) => row.id !== input.rowId);
  const manualState = bumpManualEditState(tableNode.data);
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      rows: rebuildDerivedRows(nextRows).rows,
      summary: recomputeScriptStoryboardTableSummary(nextRows),
      activeEditingCell:
        tableNode.data.activeEditingCell?.rowId === input.rowId
          ? null
          : tableNode.data.activeEditingCell ?? null,
      ...manualState,
    }
  );
  syncSourceSmartNodeFromTableNode(input.nodeId);
}

export function moveScriptStoryboardTableRow(input: {
  nodeId: string;
  rowId: string;
  direction: 'up' | 'down';
}): void {
  const tableNode = findScriptStoryboardTableNode(input.nodeId);
  if (!tableNode) {
    return;
  }

  const currentIndex = tableNode.data.rows.findIndex((row) => row.id === input.rowId);
  if (currentIndex < 0) {
    return;
  }

  const targetIndex = input.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= tableNode.data.rows.length) {
    return;
  }

  const nextRows = [...tableNode.data.rows];
  const [movedRow] = nextRows.splice(currentIndex, 1);
  nextRows.splice(targetIndex, 0, movedRow);
  const manualState = bumpManualEditState(tableNode.data, movedRow.id);
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      rows: rebuildDerivedRows(nextRows).rows,
      summary: recomputeScriptStoryboardTableSummary(nextRows),
      ...manualState,
    }
  );
  syncSourceSmartNodeFromTableNode(input.nodeId);
}

export function setScriptStoryboardTableRowHeight(input: {
  nodeId: string;
  rowHeight: number;
}): void {
  const normalizedHeight = Math.min(
    SCRIPT_STORYBOARD_TABLE_MAX_ROW_HEIGHT,
    Math.max(SCRIPT_STORYBOARD_TABLE_MIN_ROW_HEIGHT, Math.round(input.rowHeight))
  );
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      rowHeight: normalizedHeight,
    },
    { historyMode: 'skip' }
  );
}

export function setScriptStoryboardVisibleColumns(input: {
  nodeId: string;
  visibleColumnKeys: string[];
}): void {
  const nextKeys = SCRIPT_STORYBOARD_TABLE_COLUMNS
    .map((column) => column.key)
    .filter((key) => input.visibleColumnKeys.includes(key));
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      visibleColumnKeys: nextKeys.length > 0
        ? nextKeys
        : [SCRIPT_STORYBOARD_TABLE_COLUMNS[0]?.key ?? 'shotNumber'],
    },
    { historyMode: 'skip' }
  );
}

export function setScriptStoryboardActiveEditingCell(input: {
  nodeId: string;
  activeEditingCell: ScriptStoryboardTableNodeData['activeEditingCell'];
}): void {
  useCanvasStore.getState().updateNodeData(
    input.nodeId,
    {
      activeEditingCell: input.activeEditingCell ?? null,
    },
    { historyMode: 'skip' }
  );
}

export function createScriptStoryboardTableNode(
  input: CreateScriptStoryboardTableNodeInput
): string {
  const {
    addNode,
    updateNodeData,
  } = useCanvasStore.getState();
  const smartNode = findSmartDirectorNode(input.smartNodeId);
  if (!smartNode) {
    throw new Error('未找到智能导演分镜节点。');
  }

  if (input.mode === 'reuse' && input.targetNodeId) {
    const existingNode = findScriptStoryboardTableNode(input.targetNodeId);
    if (existingNode) {
      updateNodeData(
        existingNode.id,
        {
          sourceSmartDirectorStoryboardNodeId: input.smartNodeId,
          sourceAssetExtractNodeId: input.sourceAssetExtractNodeId,
          sourceSnapshotVersion: input.sourceSnapshotVersion,
          sourceLabel: input.sourceLabel,
          tableSchema: buildScriptStoryboardTableSchema(),
          rows: [],
          summary: createEmptyTableSummary(),
          streamState: {
            ...createEmptyStreamState(),
            phase: 'preparing',
            statusText: STREAM_PREPARING_MESSAGE,
          },
          activeEditingCell: null,
          manualEditVersion: 0,
          manuallyEditedRowIds: [],
          storyboardProductionMode: 'none',
          continuousReferenceEnabled: false,
          expandedProductionGroupNodeIds: [],
          storyboardTransferStatus: 'idle',
          storyboardTransferSnapshot: null,
        },
        { historyMode: 'skip' }
      );
      ensureResultEdge(input.smartNodeId, existingNode.id);
      return existingNode.id;
    }
  }

  const position = findResultNodePlacement(
    input.smartNodeId,
    smartNode.data.generatedResultNodeIds || []
  );

  const nodeId = addNode(
    CANVAS_NODE_TYPES.scriptStoryboardTable,
    position,
    {
      sourceSmartDirectorStoryboardNodeId: input.smartNodeId,
      sourceAssetExtractNodeId: input.sourceAssetExtractNodeId,
      sourceSnapshotVersion: input.sourceSnapshotVersion,
      sourceLabel: input.sourceLabel,
      tableSchema: buildScriptStoryboardTableSchema(),
      rows: [],
      summary: createEmptyTableSummary(),
      streamState: {
        ...createEmptyStreamState(),
        phase: 'preparing',
        statusText: STREAM_PREPARING_MESSAGE,
      },
      rowHeight: SCRIPT_STORYBOARD_TABLE_DEFAULT_ROW_HEIGHT,
      visibleColumnKeys: [...DEFAULT_SCRIPT_STORYBOARD_VISIBLE_COLUMN_KEYS],
      activeEditingCell: null,
      manualEditVersion: 0,
    manuallyEditedRowIds: [],
    storyboardProductionMode: 'none',
    continuousReferenceEnabled: false,
    expandedProductionGroupNodeIds: [],
    linkedStoryboardProjectId: smartNode.data.linkedStoryboardProjectId,
      storyboardTransferStatus: 'idle',
      storyboardTransferSnapshot: null,
    }
  );

  const createdNode = findScriptStoryboardTableNode(nodeId);
  if (!createdNode) {
    throw new Error('????????????');
  }

  ensureResultEdge(input.smartNodeId, nodeId);
  return nodeId;
}

function applySmartDirectorStoryboardStreamEventImmediate(
  input: ApplySmartDirectorStoryboardStreamEventInput
): void {
  const { event, smartNodeId, resultNodeId } = input;
  const currentNode = findScriptStoryboardTableNode(resultNodeId);
  if (!currentNode) {
    return;
  }

  switch (event.type) {
    case 'stream_started':
      applyStreamStateToTableNode(resultNodeId, () => ({
        tableSchema: buildScriptStoryboardTableSchema(),
        streamState: {
          requestId: event.requestId,
          phase: 'preparing',
          statusText: event.message,
          error: null,
          activeRowId: null,
          completedRowCount: 0,
          totalRowCount: 0,
          lastEventAt: Date.now(),
        },
      }));
      break;
    case 'outline_row_created':
      applyOutlineRowCreatedEvent({
        ...input,
        event,
      });
      break;
    case 'row_generation_started':
      applyRowGenerationStartedEvent({
        ...input,
        event,
      });
      break;
    case 'row_generation_completed':
      applyRowGenerationCompletedEvent({
        ...input,
        event,
      });
      break;
    case 'summary_updated':
      applyStreamStateToTableNode(resultNodeId, (data) => ({
        summary: {
          rowCount: event.rowCount,
          generatedRowCount: event.generatedRowCount,
          totalDurationSeconds: event.totalDurationSeconds,
          continuousGroupCount: event.continuousGroupCount,
          groups10sCount: event.groups10sCount,
          groups15sCount: event.groups15sCount,
          lastUpdatedAt: Date.now(),
        },
        streamState: {
          ...data.streamState,
          requestId: event.requestId,
          statusText: event.message,
          completedRowCount: event.generatedRowCount,
          totalRowCount: event.rowCount,
          lastEventAt: Date.now(),
        },
      }));
      break;
    case 'stream_completed': {
      const derived = rebuildDerivedRows(currentNode.data.rows);
      const snapshot: DirectorStoryboardTransferSnapshot = {
        version: Math.max(1, currentNode.data.storyboardTransferSnapshot?.version ?? 0) + 1,
        generatedAt: event.generatedAt,
        rowCount: derived.summary.rowCount,
        totalDurationSeconds: derived.summary.totalDurationSeconds,
      };
      applyStreamStateToTableNode(resultNodeId, () => ({
        rows: derived.rows,
        summary: derived.summary,
        streamState: {
          requestId: event.requestId,
          phase: 'completed',
          statusText: event.message,
          error: null,
          activeRowId: null,
          completedRowCount: derived.summary.generatedRowCount,
          totalRowCount: derived.summary.rowCount,
          lastEventAt: Date.now(),
        },
        storyboardTransferStatus: 'idle',
        storyboardTransferSnapshot: snapshot,
      }));
      syncSmartNodeResultFromTable(smartNodeId, resultNodeId, {
        generationState: buildGenerationState('ready', event.message, null, event.requestId),
        storyboardTransferStatus: 'idle',
        storyboardTransferSnapshot: snapshot,
      });
      break;
    }
    case 'stream_cancelled':
      applyStreamStateToTableNode(resultNodeId, (data) => ({
        streamState: {
          ...data.streamState,
          requestId: event.requestId,
          phase: 'cancelled',
          statusText: event.message,
          error: null,
          activeRowId: null,
          lastEventAt: Date.now(),
        },
      }));
      useCanvasStore.getState().updateNodeData(
        smartNodeId,
        {
          generationState: buildGenerationState('idle', event.message, null, event.requestId),
        },
        { historyMode: 'skip' }
      );
      break;
    case 'stream_failed':
      applyStreamStateToTableNode(resultNodeId, (data) => ({
        rows: data.rows.map((row) => (
          event.rowId && row.id === event.rowId
            ? { ...row, rowState: 'error', rowError: event.message }
            : row
        )),
        streamState: {
          ...data.streamState,
          requestId: event.requestId,
          phase: 'error',
          statusText: event.message,
          error: event.message,
          activeRowId: event.rowId ?? null,
          lastEventAt: Date.now(),
        },
      }));
      useCanvasStore.getState().updateNodeData(
        smartNodeId,
        {
          generationState: buildGenerationState('error', event.message, event.message, event.requestId),
          storyboardTransferStatus: 'error',
        },
        { historyMode: 'skip' }
      );
      break;
  }
}

function disposeStreamDisplayQueue(requestId: string): void {
  const queue = activeDisplayQueues.get(requestId);
  if (queue?.timer) {
    clearTimeout(queue.timer);
  }
  activeDisplayQueues.delete(requestId);
  disposeLocalPreviewRows(requestId);
}

function hasDisplayedStoryboardRow(resultNodeId: string, rowId: string): boolean {
  const tableNode = findScriptStoryboardTableNode(resultNodeId);
  return Boolean(tableNode?.data.rows.some((row) => row.id === rowId));
}

function getOrCreateStreamDisplayQueue(
  input: ApplySmartDirectorStoryboardStreamEventInput
): StreamDisplayQueue {
  const existingQueue = activeDisplayQueues.get(input.event.requestId);
  if (existingQueue) {
    return existingQueue;
  }

  const queue: StreamDisplayQueue = {
    requestId: input.event.requestId,
    smartNodeId: input.smartNodeId,
    resultNodeId: input.resultNodeId,
    extractionResult: input.extractionResult,
    outlineEvents: [],
    pendingStartedEvents: new Map(),
    pendingCompletedEvents: new Map(),
    pendingSummaryEvent: null,
    terminalEvent: null,
    timer: null,
  };
  activeDisplayQueues.set(input.event.requestId, queue);
  return queue;
}

function applyQueuedEvent(
  queue: StreamDisplayQueue,
  event: ScriptDirectorStoryboardStreamEvent
): void {
  applySmartDirectorStoryboardStreamEventImmediate({
    smartNodeId: queue.smartNodeId,
    resultNodeId: queue.resultNodeId,
    extractionResult: queue.extractionResult,
    event,
  });
}

function scheduleStreamDisplayQueueFlush(queue: StreamDisplayQueue): void {
  if (queue.timer) {
    return;
  }

  queue.timer = setTimeout(() => {
    queue.timer = null;
    flushStreamDisplayQueue(queue.requestId);
  }, STREAM_ROW_DISPLAY_INTERVAL_MS);
}

function flushStreamDisplayQueue(requestId: string): void {
  const queue = activeDisplayQueues.get(requestId);
  if (!queue) {
    return;
  }

  const nextOutline = queue.outlineEvents.shift();
  if (nextOutline) {
    applyQueuedEvent(queue, nextOutline);

    const startedEvent = queue.pendingStartedEvents.get(nextOutline.row.rowId);
    if (startedEvent) {
      queue.pendingStartedEvents.delete(nextOutline.row.rowId);
      applyQueuedEvent(queue, startedEvent);
    }

    const completedEvent = queue.pendingCompletedEvents.get(nextOutline.row.rowId);
    if (completedEvent) {
      queue.pendingCompletedEvents.delete(nextOutline.row.rowId);
      applyQueuedEvent(queue, completedEvent);
    }

    scheduleStreamDisplayQueueFlush(queue);
    return;
  }

  if (queue.pendingSummaryEvent) {
    applyQueuedEvent(queue, queue.pendingSummaryEvent);
    queue.pendingSummaryEvent = null;
  }

  if (queue.terminalEvent) {
    applyQueuedEvent(queue, queue.terminalEvent);
    disposeStreamDisplayQueue(requestId);
  }
}

export function applySmartDirectorStoryboardStreamEvent(
  input: ApplySmartDirectorStoryboardStreamEventInput
): void {
  const { event, resultNodeId } = input;

  if (event.type === 'stream_started') {
    disposeStreamDisplayQueue(event.requestId);
    applySmartDirectorStoryboardStreamEventImmediate(input);
    getOrCreateStreamDisplayQueue(input);
    return;
  }

  if (event.type === 'outline_row_created') {
    const queue = getOrCreateStreamDisplayQueue(input);
    queue.outlineEvents.push(event);
    scheduleStreamDisplayQueueFlush(queue);
    return;
  }

  if (event.type === 'row_generation_started') {
    const queue = getOrCreateStreamDisplayQueue(input);
    if (hasDisplayedStoryboardRow(resultNodeId, event.rowId)) {
      applySmartDirectorStoryboardStreamEventImmediate(input);
    } else {
      queue.pendingStartedEvents.set(event.rowId, event);
    }
    return;
  }

  if (event.type === 'row_generation_completed') {
    const queue = getOrCreateStreamDisplayQueue(input);
    if (hasDisplayedStoryboardRow(resultNodeId, event.row.rowId)) {
      applySmartDirectorStoryboardStreamEventImmediate(input);
    } else {
      queue.pendingCompletedEvents.set(event.row.rowId, event);
    }
    return;
  }

  if (event.type === 'summary_updated') {
    const queue = getOrCreateStreamDisplayQueue(input);
    queue.pendingSummaryEvent = event;
    if (queue.outlineEvents.length === 0) {
      scheduleStreamDisplayQueueFlush(queue);
    }
    return;
  }

  if (
    event.type === 'stream_completed'
    || event.type === 'stream_failed'
    || event.type === 'stream_cancelled'
  ) {
    const queue = getOrCreateStreamDisplayQueue(input);
    queue.terminalEvent = event;
    if (queue.outlineEvents.length === 0) {
      scheduleStreamDisplayQueueFlush(queue);
    }
    return;
  }

  applySmartDirectorStoryboardStreamEventImmediate(input);
}

async function registerStreamListener(input: {
  requestId: string;
  smartNodeId: string;
  resultNodeId: string;
  extractionResult: ScriptAssetExtractionResult;
}): Promise<void> {
  const unlisten = await listenScriptDirectorStoryboardStream((event) => {
    if (event.requestId !== input.requestId) {
      return;
    }

    applySmartDirectorStoryboardStreamEvent({
      smartNodeId: input.smartNodeId,
      resultNodeId: input.resultNodeId,
      extractionResult: input.extractionResult,
      event,
    });

    if (
      event.type === 'stream_completed'
      || event.type === 'stream_failed'
      || event.type === 'stream_cancelled'
    ) {
      const dispose = activeStreamListeners.get(input.requestId);
      if (dispose) {
        dispose();
        activeStreamListeners.delete(input.requestId);
      }
    }
  });

  activeStreamListeners.set(input.requestId, unlisten);
}

export async function runSmartDirectorStoryboardGeneration(
  input: RunSmartDirectorStoryboardGenerationInput
): Promise<{ requestId: string; resultNodeId: string } | null> {
  const { currentProject } = useProjectStore.getState();
  const { nodes, edges, updateNodeData } = useCanvasStore.getState();
  if (!currentProject || currentProject.projectType !== 'script') {
    return null;
  }

  const resolvedSource = resolveSmartDirectorStoryboardSource({
    nodeId: input.nodeId,
    nodes,
    edges,
  });
  if (!resolvedSource) {
    const message = nodes.some((node) => node.id === input.nodeId)
      ? MISSING_ASSET_MESSAGE
      : EMPTY_SOURCE_MESSAGE;
    updateNodeData(
      input.nodeId,
      {
        generationState: buildGenerationState('error', message, message),
      },
      { historyMode: 'skip' }
    );
    throw new Error(message);
  }

  const sourceText = normalizeText(resolvedSource.sourceText);
  if (!sourceText) {
    updateNodeData(
      input.nodeId,
      {
        generationState: buildGenerationState('error', EMPTY_SOURCE_MESSAGE, EMPTY_SOURCE_MESSAGE),
      },
      { historyMode: 'skip' }
    );
    throw new Error(EMPTY_SOURCE_MESSAGE);
  }

  const smartNode = findSmartDirectorNode(input.nodeId);
  if (smartNode?.data.generationState.requestId) {
    await cancelScriptDirectorStoryboardStream(smartNode.data.generationState.requestId);
    disposeStreamDisplayQueue(smartNode.data.generationState.requestId);
  }

  const legacyResultNodeId = migrateLegacyResultNode(input.nodeId);
  const existingResultNodeId = smartNode?.data.activeResultNodeId || legacyResultNodeId || null;
  const targetMode = await promptResultNodeMode(input.nodeId, Boolean(existingResultNodeId));
  if (!targetMode) {
    return null;
  }

  const resultNodeId = createScriptStoryboardTableNode({
    smartNodeId: input.nodeId,
    sourceAssetExtractNodeId: resolvedSource.assetNode.id,
    sourceLabel: resolvedSource.sourceLabel,
    sourceSnapshotVersion: Date.now(),
    mode: targetMode === 'reuse' ? 'reuse' : 'new',
    targetNodeId: targetMode === 'reuse' ? existingResultNodeId : null,
  });
  const requestId = globalThis.crypto?.randomUUID?.()
    ?? `director-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  disposeStreamDisplayQueue(requestId);

  await registerStreamListener({
    requestId,
    smartNodeId: input.nodeId,
    resultNodeId,
    extractionResult: resolvedSource.extractionResult,
  });

  const nextGeneratedNodeIds = Array.from(new Set([
    ...(smartNode?.data.generatedResultNodeIds ?? []),
    resultNodeId,
  ]));

  updateNodeData(
    input.nodeId,
    {
      sourceAssetExtractNodeId: resolvedSource.assetNode.id,
      resolvedSourceSnapshot: resolvedSource.resolvedSourceSnapshot,
      activeResultNodeId: resultNodeId,
      generatedResultNodeIds: nextGeneratedNodeIds,
      generationState: buildGenerationState('generating', STREAM_PREPARING_MESSAGE, null, requestId),
      storyboardTransferStatus: 'idle',
    },
    { historyMode: 'skip' }
  );

  applyStreamStateToTableNode(resultNodeId, () => ({
    sourceSmartDirectorStoryboardNodeId: input.nodeId,
    sourceAssetExtractNodeId: resolvedSource.assetNode.id,
    sourceSnapshotVersion: Date.now(),
    sourceLabel: resolvedSource.sourceLabel,
    tableSchema: buildScriptStoryboardTableSchema(),
    rows: [],
    summary: createEmptyTableSummary(),
    streamState: {
      requestId,
      phase: 'preparing',
      statusText: STREAM_PREPARING_MESSAGE,
      error: null,
      activeRowId: null,
      completedRowCount: 0,
      totalRowCount: 0,
      lastEventAt: Date.now(),
    },
    storyboardTransferStatus: 'idle',
    storyboardTransferSnapshot: null,
  }));
  startLocalPreviewRows({
    requestId,
    resultNodeId,
    sourceSnapshot: resolvedSource.resolvedSourceSnapshot,
  });

  try {
    await startScriptDirectorStoryboardStream({
      requestId,
      content: sourceText,
      batchLabel: resolvedSource.sourceLabel,
    });
    return { requestId, resultNodeId };
  } catch (error) {
    const dispose = activeStreamListeners.get(requestId);
    if (dispose) {
      dispose();
      activeStreamListeners.delete(requestId);
    }
    disposeStreamDisplayQueue(requestId);

    const message = error instanceof Error && normalizeText(error.message)
      ? error.message
      : STREAM_FAILED_MESSAGE;

    updateNodeData(
      input.nodeId,
      {
        generationState: buildGenerationState('error', message, message, requestId),
        storyboardTransferStatus: 'error',
      },
      { historyMode: 'skip' }
    );
    applyStreamStateToTableNode(resultNodeId, (data) => ({
      streamState: {
        ...data.streamState,
        requestId,
        phase: 'error',
        statusText: message,
        error: message,
        activeRowId: null,
        lastEventAt: Date.now(),
      },
    }));
    throw error;
  }
}

export async function cancelSmartDirectorStoryboardGeneration(
  nodeId: string
): Promise<void> {
  const smartNode = findSmartDirectorNode(nodeId);
  const requestId = smartNode?.data.generationState.requestId;
  if (!requestId) {
    return;
  }

  await cancelScriptDirectorStoryboardStream(requestId);
}

function resolveNodeWidth(node: CanvasNode | undefined): number {
  const width = typeof node?.width === 'number'
    ? node.width
    : typeof node?.style?.width === 'number'
      ? node.style.width
      : 1120;
  return Number.isFinite(width) ? width : 1120;
}

function resolveNodeHeight(node: CanvasNode | undefined): number {
  const height = typeof node?.height === 'number'
    ? node.height
    : typeof node?.style?.height === 'number'
      ? node.style.height
      : 720;
  return Number.isFinite(height) ? height : 720;
}

function resolveTableSourceContext(sourceNodeId: string): ScriptStoryboardTableSourceContext {
  const sourceProject = useProjectStore.getState().getCurrentProject();
  if (!sourceProject || sourceProject.projectType !== 'script') {
    throw new Error('未找到当前剧本项目。');
  }

  const tableNode = findScriptStoryboardTableNode(sourceNodeId);
  if (!tableNode) {
    throw new Error('未找到剧本分镜表节点。');
  }
  if (tableNode.data.rows.length === 0) {
    throw new Error(OPEN_STORYBOARD_MISSING_RESULT_MESSAGE);
  }

  const sourceSmartNode = tableNode.data.sourceSmartDirectorStoryboardNodeId
    ? findSmartDirectorNode(tableNode.data.sourceSmartDirectorStoryboardNodeId)
    : null;
  const sourceAssetNode = tableNode.data.sourceAssetExtractNodeId
    ? useCanvasStore.getState().nodes.find(
        (node): node is CanvasNode & {
          type: typeof CANVAS_NODE_TYPES.scriptAssetExtract;
          data: ScriptAssetExtractNodeData;
        } =>
          node.id === tableNode.data.sourceAssetExtractNodeId
          && node.type === CANVAS_NODE_TYPES.scriptAssetExtract
      ) ?? null
    : null;

  return {
    sourceProject,
    tableNode,
    sourceSmartNode,
    sourceAssetNode,
    sourceLabel: tableNode.data.sourceLabel
      || sourceSmartNode?.data.expansionSource?.sourceLabel
      || resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptStoryboardTable, tableNode.data),
    sourceVersion:
      tableNode.data.storyboardTransferSnapshot?.version
      ?? tableNode.data.sourceSnapshotVersion
      ?? Date.now(),
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
      throw new Error('未找到目标分镜项目。');
    }
    return fromProjectRecord(record);
  }

  const projectName =
    normalizeText(newProjectName)
    || `${sourceProject.name} - 分镜画布`;
  const createdProjectId = projectStore.createProject(projectName, 'storyboard');
  if (sourceProject.id) {
    await projectStore.setProjectLinkedScriptProject(createdProjectId, sourceProject.id);
  }
  const createdProject = projectStore.getCurrentProject();
  if (createdProject?.id === createdProjectId) {
    return createdProject;
  }

  return createEmptyStoryboardProject(createdProjectId, projectName);
}

function removePreviousMirrorNodes(
  project: Project,
  sourceProjectId: string,
  sourceNodeId: string
): Project {
  const mirrorNodeIds = new Set(
    project.nodes
      .filter((node) =>
        node.type === CANVAS_NODE_TYPES.scriptStoryboardTable
        && (node.data as ScriptStoryboardTableNodeData).expansionSource?.sourceProjectId === sourceProjectId
        && (node.data as ScriptStoryboardTableNodeData).expansionSource?.sourceNodeId === sourceNodeId
      )
      .map((node) => node.id)
  );
  if (mirrorNodeIds.size === 0) {
    return project;
  }

  const nextNodes = project.nodes.filter((node) => !mirrorNodeIds.has(node.id));
  return {
    ...project,
    nodes: nextNodes,
    edges: project.edges.filter(
      (edge) => !mirrorNodeIds.has(edge.source) && !mirrorNodeIds.has(edge.target)
    ),
    nodeCount: nextNodes.length,
  };
}

function findMirrorPosition(project: Project): { x: number; y: number } {
  const viewport = project.viewport ?? DEFAULT_VIEWPORT;
  const { canvasViewportSize } = useCanvasStore.getState();
  const viewportWidth = canvasViewportSize.width > 0 ? canvasViewportSize.width : FALLBACK_VIEWPORT_WIDTH;
  const viewportHeight = canvasViewportSize.height > 0 ? canvasViewportSize.height : FALLBACK_VIEWPORT_HEIGHT;
  const zoom = Math.max(0.01, viewport.zoom || 1);
  const viewportCenter = {
    x: (-viewport.x + viewportWidth / 2) / zoom,
    y: (-viewport.y + viewportHeight / 2) / zoom,
  };

  if (project.nodes.length === 0) {
    return {
      x: Math.max(120, Math.round(viewportCenter.x - 560)),
      y: Math.max(120, Math.round(viewportCenter.y - 360)),
    };
  }

  const maxX = Math.max(
    ...project.nodes.map((node) => {
      const width = typeof node.width === 'number'
        ? node.width
        : typeof node.style?.width === 'number'
          ? node.style.width
          : 320;
      return node.position.x + width;
    })
  );

  return {
    x: maxX + 96,
    y: Math.max(120, Math.round(viewportCenter.y - 360)),
  };
}

function buildFocusViewport(bounds: { x: number; y: number; width: number; height: number }): Project['viewport'] {
  const { canvasViewportSize } = useCanvasStore.getState();
  const viewportWidth = canvasViewportSize.width > 0 ? canvasViewportSize.width : FALLBACK_VIEWPORT_WIDTH;
  const viewportHeight = canvasViewportSize.height > 0 ? canvasViewportSize.height : FALLBACK_VIEWPORT_HEIGHT;
  const zoom = Math.max(
    0.45,
    Math.min(
      0.92,
      Math.min(
        viewportWidth / Math.max(bounds.width + 220, 1),
        viewportHeight / Math.max(bounds.height + 180, 1),
      )
    )
  );
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    x: Math.round(-centerX * zoom + viewportWidth / 2),
    y: Math.round(-centerY * zoom + viewportHeight / 2),
    zoom: Number(zoom.toFixed(4)),
  };
}

async function tryResolveExistingStoryboardProjectId(
  context: ScriptStoryboardTableSourceContext
): Promise<string | null> {
  const projectStore = useProjectStore.getState();
  if (
    context.tableNode.data.linkedStoryboardProjectId
    && projectStore.projects.some(
      (project) => project.id === context.tableNode.data.linkedStoryboardProjectId
    )
  ) {
    return context.tableNode.data.linkedStoryboardProjectId;
  }

  const sameScriptProjects = projectStore.projects.filter(
    (project) =>
      project.projectType === 'storyboard'
      && project.linkedScriptProjectId === context.sourceProject.id
  );

  for (const summary of sameScriptProjects) {
    const record = await getProjectRecord(summary.id);
    if (!record) {
      continue;
    }
    const targetProject = fromProjectRecord(record);
    const hasMirror = targetProject.nodes.some((node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptStoryboardTable) {
        return false;
      }
      const data = node.data as ScriptStoryboardTableNodeData;
      return (
        data.expansionSource?.sourceProjectId === context.sourceProject.id
        && data.expansionSource?.sourceNodeId === context.tableNode.id
      );
    });
    if (hasMirror) {
      return summary.id;
    }
  }

  return null;
}

export async function createOrSelectStoryboardProjectForDirectorTable(
  input: CreateOrSelectStoryboardProjectForDirectorTableInput
): Promise<{ projectId: string }> {
  const projectStore = useProjectStore.getState();
  const context = resolveTableSourceContext(input.sourceNodeId);
  await projectStore.flushCurrentProjectToDisk();

  let targetProject = await resolveTargetProject(
    context.sourceProject,
    input.targetProjectId,
    input.newProjectName
  );
  targetProject = removePreviousMirrorNodes(
    targetProject,
    context.sourceProject.id,
    context.tableNode.id
  );

  const position = findMirrorPosition(targetProject);
  const mirrorWidth = resolveNodeWidth(context.tableNode);
  const mirrorHeight = resolveNodeHeight(context.tableNode);
  const mirrorData: ScriptStoryboardTableNodeData = {
    ...context.tableNode.data,
    presentationMode: 'storyboardMirror',
    expansionSource: {
      sourceProjectId: context.sourceProject.id,
      sourceProjectName: context.sourceProject.name,
      sourceNodeId: context.tableNode.id,
      sourceNodeVersion: context.sourceVersion,
      sourceLabel: context.sourceLabel,
    },
    linkedStoryboardProjectId: targetProject.id,
    storyboardProductionMode: 'none',
    continuousReferenceEnabled: false,
    expandedProductionGroupNodeIds: [],
    storyboardTransferStatus: 'ready',
    storyboardTransferSnapshot: {
      version: Math.max(1, context.tableNode.data.storyboardTransferSnapshot?.version ?? 0) + 1,
      generatedAt: Date.now(),
      rowCount: context.tableNode.data.summary.rowCount,
      totalDurationSeconds: context.tableNode.data.summary.totalDurationSeconds,
    },
    streamState: {
      ...context.tableNode.data.streamState,
      phase: 'completed',
    },
  };

  const mirrorNode: CanvasNode = {
    ...context.tableNode,
    id: `${context.tableNode.id}-mirror-${Date.now()}`,
    position,
    width: mirrorWidth,
    height: mirrorHeight,
    data: mirrorData,
    style: {
      ...(context.tableNode.style ?? {}),
      width: mirrorWidth,
      height: mirrorHeight,
    },
    selected: true,
    dragging: false,
  };

  const nextProject: Project = {
    ...targetProject,
    linkedScriptProjectId: context.sourceProject.id,
    nodes: [
      ...targetProject.nodes.map((node) => ({ ...node, selected: false })),
      mirrorNode,
    ],
    edges: [...targetProject.edges],
    viewport: buildFocusViewport({
      x: position.x,
      y: position.y,
      width: mirrorWidth,
      height: mirrorHeight,
    }),
    nodeCount: targetProject.nodes.length + 1,
    updatedAt: Date.now(),
  };

  const nextSnapshot: DirectorStoryboardTransferSnapshot = {
    version: Math.max(1, context.tableNode.data.storyboardTransferSnapshot?.version ?? 0) + 1,
    generatedAt: Date.now(),
    rowCount: context.tableNode.data.summary.rowCount,
    totalDurationSeconds: context.tableNode.data.summary.totalDurationSeconds,
  };

  useCanvasStore.getState().updateNodeData(
    context.tableNode.id,
    {
      linkedStoryboardProjectId: nextProject.id,
      storyboardTransferStatus: 'ready',
      storyboardTransferSnapshot: nextSnapshot,
    },
    { historyMode: 'skip' }
  );

  if (context.sourceSmartNode) {
    useCanvasStore.getState().updateNodeData(
      context.sourceSmartNode.id,
      {
        linkedStoryboardProjectId: nextProject.id,
        storyboardTransferStatus: 'ready',
        storyboardTransferSnapshot: nextSnapshot,
      },
      { historyMode: 'skip' }
    );
  }

  await projectStore.flushCurrentProjectToDisk();
  await upsertProjectRecord(toProjectRecord(nextProject));
  projectStore.openProject(nextProject.id);
  return { projectId: nextProject.id };
}

export function openSmartDirectorStoryboardTransferDialog(nodeId: string): void {
  canvasEventBus.publish('smart-director-storyboard-transfer/open', { nodeId });
}

export async function openStoryboardFromScriptStoryboardTable(
  input: OpenStoryboardFromScriptStoryboardTableInput
): Promise<{ projectId: string } | null> {
  const context = resolveTableSourceContext(input.nodeId);
  const existingProjectId = await tryResolveExistingStoryboardProjectId(context);

  if (existingProjectId) {
    return createOrSelectStoryboardProjectForDirectorTable({
      sourceNodeId: input.nodeId,
      targetProjectId: existingProjectId,
    });
  }

  openSmartDirectorStoryboardTransferDialog(input.nodeId);
  return null;
}

export async function openStoryboardFromSmartDirectorStoryboard(
  input: OpenStoryboardFromSmartDirectorStoryboardInput
): Promise<{ projectId: string } | null> {
  const smartNode = findSmartDirectorNode(input.nodeId);
  if (!smartNode) {
    return null;
  }

  const resultNodeId = smartNode.data.activeResultNodeId || migrateLegacyResultNode(input.nodeId);
  if (!resultNodeId) {
    throw new Error(OPEN_STORYBOARD_MISSING_RESULT_MESSAGE);
  }

  return openStoryboardFromScriptStoryboardTable({ nodeId: resultNodeId });
}
