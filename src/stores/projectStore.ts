import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Viewport } from '@xyflow/react';
import {
  useCanvasStore,
  type CanvasEdge,
  type CanvasHistorySnapshot,
  type CanvasHistoryState,
  type CanvasNode,
  type CanvasNodePatchHistorySnapshot,
  type CanvasNodeData,
} from './canvasStore';
import {
  deleteProjectRecord,
  getProjectRecord,
  listProjectSummaries,
  renameProjectRecord,
  updateProjectViewportRecord,
  upsertProjectRecord,
  type ProjectRecord,
  type ProjectSummaryRecord,
} from '@/commands/projectState';
import {
  createDefaultCanvasColorLabelMap,
  normalizeCanvasColorLabelMap,
  type CanvasColorLabelMap,
} from '@/features/canvas/domain/semanticColors';

const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

function createEmptyHistory(): CanvasHistoryState {
  return {
    past: [],
    future: [],
  };
}

const IMAGE_REF_PREFIX = '__img_ref__:';
const MEDIA_REFERENCE_KEYS = new Set([
  'imageUrl',
  'previewImageUrl',
  'videoUrl',
  'audioUrl',
  'sourceUrl',
  'posterSourceUrl',
  'referenceUrl',
]);
let openProjectRequestSeq = 0;
const UPSERT_DEBOUNCE_MS = 260;
const VIEWPORT_UPSERT_DEBOUNCE_MS = 280;
const VIEWPORT_EPSILON = 0.001;
const IDLE_PERSIST_TIMEOUT_MS = 1200;
const FALLBACK_IDLE_DELAY_MS = 64;
const MAX_PERSISTED_HISTORY_STEPS = 12;
const MAX_PERSISTED_HISTORY_JSON_CHARS = 900_000;
const MAX_HISTORY_RESTORE_JSON_CHARS = 1_500_000;
const DELETE_RETRY_DELAY_MS = 80;
const MAX_DELETE_RETRIES = 10;
const FLUSH_WAIT_INTERVAL_MS = 16;

const queuedProjectUpserts = new Map<string, Project>();
const projectUpsertTimers = new Map<string, ReturnType<typeof setTimeout>>();
const projectUpsertsInFlight = new Set<string>();
const queuedViewportUpserts = new Map<string, string>();
const viewportUpsertTimers = new Map<string, ReturnType<typeof setTimeout>>();
const viewportUpsertsInFlight = new Set<string>();
const deletingProjectIds = new Set<string>();
const historyBudgetWarnedProjectIds = new Set<string>();

export type ProjectType = 'storyboard' | 'script' | 'ad';

export interface ProjectSummary {
  id: string;
  name: string;
  projectType: ProjectType;
  assetLibraryId: string | null;
  clipLibraryId: string | null;
  clipLastFolderId: string | null;
  linkedScriptProjectId: string | null;
  linkedAdProjectId: string | null;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

export interface Project extends ProjectSummary {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport?: Viewport;
  history: CanvasHistoryState;
  colorLabels: CanvasColorLabelMap;
}

type PersistedProject = Project & {
  imagePool?: string[];
};

interface PersistedNodesPayload {
  nodes: CanvasNode[];
  imagePool?: string[];
}

function isCanvasNodePatchHistorySnapshot(
  snapshot: CanvasHistorySnapshot
): snapshot is CanvasNodePatchHistorySnapshot {
  return snapshot.kind === 'nodePatch';
}

function encodeImageReference(
  imageUrl: string | null | undefined,
  imagePool: string[],
  imageIndexMap: Map<string, number>
): string | null | undefined {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
    return imageUrl;
  }

  const existingIndex = imageIndexMap.get(imageUrl);
  if (typeof existingIndex === 'number') {
    return `${IMAGE_REF_PREFIX}${existingIndex}`;
  }

  const nextIndex = imagePool.length;
  imagePool.push(imageUrl);
  imageIndexMap.set(imageUrl, nextIndex);
  return `${IMAGE_REF_PREFIX}${nextIndex}`;
}

function decodeImageReference(
  imageUrl: string | null | undefined,
  imagePool: string[] | undefined
): string | null | undefined {
  if (typeof imageUrl !== 'string' || !imagePool || !imageUrl.startsWith(IMAGE_REF_PREFIX)) {
    return imageUrl;
  }

  const index = Number.parseInt(imageUrl.slice(IMAGE_REF_PREFIX.length), 10);
  if (!Number.isFinite(index) || index < 0) {
    return imageUrl;
  }

  return imagePool[index] ?? null;
}

function mapImageReferencesInValue(
  value: unknown,
  mapImageUrl: (imageUrl: string | null | undefined) => string | null | undefined
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const nextItems = value.map((item) => {
      const mappedItem = mapImageReferencesInValue(item, mapImageUrl);
      if (mappedItem !== item) {
        changed = true;
      }
      return mappedItem;
    });

    return changed ? nextItems : value;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  let changed = false;
  const nextRecord: Record<string, unknown> = {};

  for (const [key, currentValue] of Object.entries(record)) {
    let nextValue = currentValue;

    if (
      MEDIA_REFERENCE_KEYS.has(key)
      && (typeof currentValue === 'string' || currentValue == null)
    ) {
      const mappedValue = mapImageUrl(currentValue as string | null | undefined);
      if (mappedValue !== currentValue) {
        nextValue = mappedValue ?? null;
        changed = true;
      }
    } else {
      const mappedNestedValue = mapImageReferencesInValue(currentValue, mapImageUrl);
      if (mappedNestedValue !== currentValue) {
        nextValue = mappedNestedValue;
        changed = true;
      }
    }

    nextRecord[key] = nextValue;
  }

  return changed ? nextRecord : value;
}

function mapNodeImageReferences(
  nodes: CanvasNode[],
  mapImageUrl: (imageUrl: string | null | undefined) => string | null | undefined
): CanvasNode[] {
  return nodes.map((node) => {
    const nextData = mapImageReferencesInValue(node.data, mapImageUrl) as CanvasNodeData;
    if (nextData === node.data) {
      return node;
    }

    return {
      ...node,
      data: nextData,
    };
  });
}

function mapHistoryImageReferences(
  history: CanvasHistoryState,
  mapImageUrl: (imageUrl: string | null | undefined) => string | null | undefined
): CanvasHistoryState {
  const mapSnapshot = (snapshot: CanvasHistorySnapshot): CanvasHistorySnapshot => {
    if (isCanvasNodePatchHistorySnapshot(snapshot)) {
      return {
        kind: 'nodePatch',
        entries: snapshot.entries.map((entry) => ({
          nodeId: entry.nodeId,
          node: entry.node ? mapNodeImageReferences([entry.node], mapImageUrl)[0] : null,
        })),
      };
    }

    return {
      ...snapshot,
      nodes: mapNodeImageReferences(snapshot.nodes, mapImageUrl),
    };
  };

  return {
    past: history.past.map(mapSnapshot),
    future: history.future.map(mapSnapshot),
  };
}

function trimHistoryForPersistence(history: CanvasHistoryState): CanvasHistoryState {
  return {
    past: history.past.slice(-MAX_PERSISTED_HISTORY_STEPS),
    future: history.future.slice(-MAX_PERSISTED_HISTORY_STEPS),
  };
}

function trimHistoryToJsonBudget(
  history: CanvasHistoryState,
  maxChars: number
): { history: CanvasHistoryState; trimmed: boolean } {
  let nextPast = history.past;
  let nextFuture = history.future;
  let serialized = JSON.stringify({ past: nextPast, future: nextFuture });

  if (serialized.length <= maxChars) {
    return { history, trimmed: false };
  }

  while ((nextPast.length > 0 || nextFuture.length > 0) && serialized.length > maxChars) {
    if (nextPast.length >= nextFuture.length && nextPast.length > 0) {
      nextPast = nextPast.slice(1);
    } else if (nextFuture.length > 0) {
      nextFuture = nextFuture.slice(1);
    } else {
      nextPast = nextPast.slice(1);
    }

    serialized = JSON.stringify({ past: nextPast, future: nextFuture });
  }

  return {
    history: {
      past: nextPast,
      future: nextFuture,
    },
    trimmed: nextPast.length !== history.past.length || nextFuture.length !== history.future.length,
  };
}

function encodeProject(project: Project): PersistedProject {
  const imagePool: string[] = [];
  const imageIndexMap = new Map<string, number>();
  const encode = (imageUrl: string | null | undefined) =>
    encodeImageReference(imageUrl, imagePool, imageIndexMap);

  return {
    ...project,
    nodes: mapNodeImageReferences(project.nodes, encode),
    history: mapHistoryImageReferences(project.history, encode),
    imagePool,
  };
}

function encodeProjectForPersistence(project: Project): PersistedProject {
  const historyWithinStepLimit = trimHistoryForPersistence(project.history);
  const stepLimitedProject: Project = {
    ...project,
    history: historyWithinStepLimit,
  };
  const encodedProject = encodeProject(stepLimitedProject);
  const historyWithinBudget = trimHistoryToJsonBudget(
    encodedProject.history,
    MAX_PERSISTED_HISTORY_JSON_CHARS
  );

  if (!historyWithinBudget.trimmed) {
    historyBudgetWarnedProjectIds.delete(project.id);
    return encodedProject;
  }

  if (!historyBudgetWarnedProjectIds.has(project.id)) {
    historyBudgetWarnedProjectIds.add(project.id);
    console.info(
      `Trim persisted history for project ${project.id} to stay within ${MAX_PERSISTED_HISTORY_JSON_CHARS} chars`
    );
  }

  const nextProject: Project = {
    ...stepLimitedProject,
    history: {
      past: historyWithinStepLimit.past.slice(-historyWithinBudget.history.past.length),
      future: historyWithinStepLimit.future.slice(-historyWithinBudget.history.future.length),
    },
  };

  return encodeProject(nextProject);
}

function parsePersistedNodesPayload(value: unknown): PersistedNodesPayload {
  if (Array.isArray(value)) {
    return { nodes: value as CanvasNode[] };
  }

  if (!value || typeof value !== 'object') {
    return { nodes: [] };
  }

  const record = value as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes) ? (record.nodes as CanvasNode[]) : [];
  const imagePool = Array.isArray(record.imagePool)
    ? record.imagePool.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    nodes,
    imagePool,
  };
}

function decodeProject(project: PersistedProject): Project {
  const decode = (imageUrl: string | null | undefined) =>
    decodeImageReference(imageUrl, project.imagePool);

  return {
    ...project,
    nodes: mapNodeImageReferences(project.nodes, decode),
    history: mapHistoryImageReferences(project.history, decode),
  };
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractImagePoolFromHistoryJson(historyJson: string): string[] {
  const imagePoolKey = '"imagePool"';
  const keyIndex = historyJson.indexOf(imagePoolKey);
  if (keyIndex < 0) {
    return [];
  }

  const arrayStart = historyJson.indexOf('[', keyIndex + imagePoolKey.length);
  if (arrayStart < 0) {
    return [];
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let arrayEnd = -1;

  for (let index = arrayStart; index < historyJson.length; index += 1) {
    const char = historyJson[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        arrayEnd = index;
        break;
      }
    }
  }

  if (arrayEnd < 0) {
    return [];
  }

  const rawArrayJson = historyJson.slice(arrayStart, arrayEnd + 1);
  const parsed = safeParseJson<unknown>(rawArrayJson, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === 'string');
}

function toProjectSummary(record: ProjectSummaryRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    projectType: (record.projectType as ProjectType) || 'storyboard',
    assetLibraryId: record.assetLibraryId ?? null,
    clipLibraryId: record.clipLibraryId ?? null,
    clipLastFolderId: record.clipLastFolderId ?? null,
    linkedScriptProjectId: record.linkedScriptProjectId ?? null,
    linkedAdProjectId: record.linkedAdProjectId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodeCount: record.nodeCount,
  };
}

function projectToSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    projectType: project.projectType,
    assetLibraryId: project.assetLibraryId ?? null,
    clipLibraryId: project.clipLibraryId ?? null,
    clipLastFolderId: project.clipLastFolderId ?? null,
    linkedScriptProjectId: project.linkedScriptProjectId ?? null,
    linkedAdProjectId: project.linkedAdProjectId ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodeCount: project.nodeCount,
  };
}

function toProjectRecord(project: Project): ProjectRecord {
  const encodedProject = encodeProjectForPersistence(project);
  const persistedNodesPayload: PersistedNodesPayload = {
    nodes: encodedProject.nodes,
    imagePool: encodedProject.imagePool ?? [],
  };

  return {
    id: encodedProject.id,
    name: encodedProject.name,
    projectType: encodedProject.projectType || 'storyboard',
    assetLibraryId: encodedProject.assetLibraryId ?? null,
    clipLibraryId: encodedProject.clipLibraryId ?? null,
    clipLastFolderId: encodedProject.clipLastFolderId ?? null,
    linkedScriptProjectId: encodedProject.linkedScriptProjectId ?? null,
    linkedAdProjectId: encodedProject.linkedAdProjectId ?? null,
    createdAt: encodedProject.createdAt,
    updatedAt: encodedProject.updatedAt,
    nodeCount: encodedProject.nodeCount,
    nodesJson: JSON.stringify(persistedNodesPayload),
    edgesJson: JSON.stringify(encodedProject.edges),
    viewportJson: JSON.stringify(encodedProject.viewport),
    historyJson: JSON.stringify(encodedProject.history),
    colorLabelsJson: JSON.stringify(encodedProject.colorLabels),
  };
}

function fromProjectRecord(record: ProjectRecord): Project {
  const parsedNodesPayload = parsePersistedNodesPayload(safeParseJson<unknown>(record.nodesJson, []));
  const parsedNodes = parsedNodesPayload.nodes;
  const parsedEdges = safeParseJson<CanvasEdge[]>(record.edgesJson, []);
  const parsedViewport = safeParseJson<Viewport>(record.viewportJson, DEFAULT_VIEWPORT);
  const shouldRestoreHistory = record.historyJson.length <= MAX_HISTORY_RESTORE_JSON_CHARS;
  const extractedImagePool =
    parsedNodesPayload.imagePool
    ?? extractImagePoolFromHistoryJson(record.historyJson);
  const parsedHistoryPayload = shouldRestoreHistory
    ? safeParseJson<{
        past?: CanvasHistoryState['past'];
        future?: CanvasHistoryState['future'];
        imagePool?: string[];
      }>(record.historyJson, {})
    : {};

  if (!shouldRestoreHistory) {
    console.warn(
      `Skip restoring oversized history payload (${record.historyJson.length} chars) for project ${record.id}`
    );
  }

  const parsedHistory = {
    past: parsedHistoryPayload.past ?? [],
    future: parsedHistoryPayload.future ?? [],
  };

  const persistedProject: PersistedProject = {
    id: record.id,
    name: record.name,
    projectType: (record.projectType as ProjectType) || 'storyboard',
    assetLibraryId: record.assetLibraryId ?? null,
    clipLibraryId: record.clipLibraryId ?? null,
    clipLastFolderId: record.clipLastFolderId ?? null,
    linkedScriptProjectId: record.linkedScriptProjectId ?? null,
    linkedAdProjectId: record.linkedAdProjectId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodeCount: record.nodeCount,
    nodes: parsedNodes,
    edges: parsedEdges,
    viewport: parsedViewport ?? DEFAULT_VIEWPORT,
    history: parsedHistory,
    colorLabels: normalizeCanvasColorLabelMap(
      safeParseJson<unknown>(record.colorLabelsJson, createDefaultCanvasColorLabelMap())
    ),
    imagePool: parsedNodesPayload.imagePool ?? parsedHistoryPayload.imagePool ?? extractedImagePool,
  };

  const decodedProject = decodeProject(persistedProject);
  return {
    ...decodedProject,
    nodeCount: parsedNodes.length,
    viewport: decodedProject.viewport ?? DEFAULT_VIEWPORT,
    history: decodedProject.history ?? createEmptyHistory(),
    colorLabels: normalizeCanvasColorLabelMap(decodedProject.colorLabels),
  };
}

interface PersistProjectOptions {
  immediate?: boolean;
  debounceMs?: number;
}

interface PersistViewportOptions {
  immediate?: boolean;
  debounceMs?: number;
}

function scheduleIdlePersist(task: () => void): void {
  const idleHost = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };

  if (typeof idleHost.requestIdleCallback === 'function') {
    idleHost.requestIdleCallback(task, { timeout: IDLE_PERSIST_TIMEOUT_MS });
    return;
  }

  setTimeout(task, FALLBACK_IDLE_DELAY_MS);
}

function hasViewportMeaningfulDelta(current: Viewport, next: Viewport): boolean {
  return (
    Math.abs(current.x - next.x) > VIEWPORT_EPSILON ||
    Math.abs(current.y - next.y) > VIEWPORT_EPSILON ||
    Math.abs(current.zoom - next.zoom) > VIEWPORT_EPSILON
  );
}

function normalizeViewport(viewport: Viewport): Viewport {
  return {
    x: Number(viewport.x.toFixed(2)),
    y: Number(viewport.y.toFixed(2)),
    zoom: Number(viewport.zoom.toFixed(4)),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clearQueuedProjectUpsert(projectId: string): void {
  const timer = projectUpsertTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    projectUpsertTimers.delete(projectId);
  }
  queuedProjectUpserts.delete(projectId);
}

function clearQueuedViewportUpsert(projectId: string): void {
  const timer = viewportUpsertTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    viewportUpsertTimers.delete(projectId);
  }
  queuedViewportUpserts.delete(projectId);
}

interface FlushProjectUpsertOptions {
  bypassIdle?: boolean;
}

function flushProjectUpsert(projectId: string, options?: FlushProjectUpsertOptions): void {
  if (deletingProjectIds.has(projectId) || projectUpsertsInFlight.has(projectId)) {
    return;
  }

  const project = queuedProjectUpserts.get(projectId);
  if (!project) {
    return;
  }

  queuedProjectUpserts.delete(projectId);
  projectUpsertsInFlight.add(projectId);

  const settle = () => {
    projectUpsertsInFlight.delete(projectId);

    if (deletingProjectIds.has(projectId)) {
      return;
    }

    if (queuedProjectUpserts.has(projectId)) {
      flushProjectUpsert(projectId);
    }
  };

  const executePersist = () => {
    if (deletingProjectIds.has(projectId)) {
      settle();
      return;
    }

    const record = toProjectRecord(project);
    void upsertProjectRecord(record)
      .catch((error) => {
        console.error('Failed to persist project record', error);
      })
      .finally(settle);
  };

  if (options?.bypassIdle) {
    executePersist();
    return;
  }

  scheduleIdlePersist(executePersist);
}

function queueProjectUpsert(project: Project, options?: PersistProjectOptions): void {
  const projectId = project.id;
  deletingProjectIds.delete(projectId);
  queuedProjectUpserts.set(projectId, project);

  const existingTimer = projectUpsertTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    projectUpsertTimers.delete(projectId);
  }

  const debounceMs = options?.immediate ? 0 : (options?.debounceMs ?? UPSERT_DEBOUNCE_MS);
  if (debounceMs <= 0) {
    flushProjectUpsert(projectId, { bypassIdle: true });
    return;
  }

  const timer = setTimeout(() => {
    projectUpsertTimers.delete(projectId);
    flushProjectUpsert(projectId);
  }, debounceMs);
  projectUpsertTimers.set(projectId, timer);
}

function persistProject(project: Project, options?: PersistProjectOptions): void {
  clearQueuedViewportUpsert(project.id);
  queueProjectUpsert(project, options);
}

async function persistProjectImmediately(project: Project): Promise<void> {
  const projectId = project.id;
  deletingProjectIds.delete(projectId);
  clearQueuedProjectUpsert(projectId);
  clearQueuedViewportUpsert(projectId);

  while (projectUpsertsInFlight.has(projectId) || viewportUpsertsInFlight.has(projectId)) {
    await delay(FLUSH_WAIT_INTERVAL_MS);
  }

  await upsertProjectRecord(toProjectRecord(project));
}

function flushViewportUpsert(projectId: string): void {
  if (deletingProjectIds.has(projectId) || viewportUpsertsInFlight.has(projectId)) {
    return;
  }

  const viewportJson = queuedViewportUpserts.get(projectId);
  if (typeof viewportJson !== 'string') {
    return;
  }

  queuedViewportUpserts.delete(projectId);
  viewportUpsertsInFlight.add(projectId);

  void updateProjectViewportRecord(projectId, viewportJson)
    .catch((error) => {
      console.error('Failed to persist project viewport', error);
    })
    .finally(() => {
      viewportUpsertsInFlight.delete(projectId);

      if (deletingProjectIds.has(projectId)) {
        return;
      }

      if (queuedViewportUpserts.has(projectId)) {
        flushViewportUpsert(projectId);
      }
    });
}

function queueViewportUpsert(
  projectId: string,
  viewport: Viewport,
  options?: PersistViewportOptions
): void {
  deletingProjectIds.delete(projectId);
  queuedViewportUpserts.set(projectId, JSON.stringify(viewport));

  const existingTimer = viewportUpsertTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    viewportUpsertTimers.delete(projectId);
  }

  const debounceMs = options?.immediate ? 0 : (options?.debounceMs ?? VIEWPORT_UPSERT_DEBOUNCE_MS);
  if (debounceMs <= 0) {
    flushViewportUpsert(projectId);
    return;
  }

  const timer = setTimeout(() => {
    viewportUpsertTimers.delete(projectId);
    flushViewportUpsert(projectId);
  }, debounceMs);
  viewportUpsertTimers.set(projectId, timer);
}

function persistProjectDelete(projectId: string): void {
  deletingProjectIds.add(projectId);
  historyBudgetWarnedProjectIds.delete(projectId);
  clearQueuedProjectUpsert(projectId);
  clearQueuedViewportUpsert(projectId);

  const attemptDelete = (retryCount: number): void => {
    if (projectUpsertsInFlight.has(projectId) || viewportUpsertsInFlight.has(projectId)) {
      if (retryCount >= MAX_DELETE_RETRIES) {
        deletingProjectIds.delete(projectId);
        return;
      }

      setTimeout(() => {
        attemptDelete(retryCount + 1);
      }, DELETE_RETRY_DELAY_MS);
      return;
    }

    void deleteProjectRecord(projectId)
      .catch((error) => {
        console.error('Failed to delete project record', error);
      })
      .finally(() => {
        deletingProjectIds.delete(projectId);
      });
  };

  attemptDelete(0);
}

function updateProjectSummary(
  summaries: ProjectSummary[],
  updated: ProjectSummary
): ProjectSummary[] {
  const next = summaries.map((summary) => (summary.id === updated.id ? updated : summary));
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return next;
}

interface ProjectState {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  currentProject: Project | null;
  isHydrated: boolean;
  isOpeningProject: boolean;

  hydrate: () => Promise<void>;
  refreshProjectSummaries: () => Promise<void>;
  createProject: (name: string, projectType: ProjectType) => string;
  deleteProject: (id: string) => void;
  deleteProjects: (ids: string[]) => void;
  renameProject: (id: string, name: string) => void;
  setProjectLinkedScriptProject: (
    projectId: string,
    linkedScriptProjectId: string | null
  ) => Promise<void>;
  setProjectLinkedAdProject: (
    projectId: string,
    linkedAdProjectId: string | null
  ) => Promise<void>;
  setProjectClipLibrary: (
    projectId: string,
    clipLibraryId: string | null,
    clipLastFolderId?: string | null
  ) => Promise<void>;
  setProjectClipLastFolder: (
    projectId: string,
    clipLastFolderId: string | null
  ) => Promise<void>;
  setCurrentProjectAssetLibrary: (assetLibraryId: string | null) => void;
  setCurrentProjectClipLibrary: (clipLibraryId: string | null) => void;
  setCurrentProjectColorLabels: (colorLabels: CanvasColorLabelMap) => void;
  openProject: (id: string) => void;
  closeProject: () => void;
  getCurrentProject: () => Project | null;
  saveCurrentProject: (
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    viewport?: Viewport,
    history?: CanvasHistoryState
  ) => void;
  saveCurrentProjectViewport: (viewport: Viewport) => void;
  cancelPendingViewportPersist: () => void;
  flushCurrentProjectToDisk: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  currentProject: null,
  isHydrated: false,
  isOpeningProject: false,

  hydrate: async () => {
    if (get().isHydrated) {
      return;
    }

    try {
      const records = await listProjectSummaries();
      const projects = records.map(toProjectSummary).sort((a, b) => b.updatedAt - a.updatedAt);
      set({
        projects,
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
      });
    } catch (error) {
      console.error('Failed to hydrate project summaries from SQLite', error);
      set({
        projects: [],
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
      });
    }
  },

  refreshProjectSummaries: async () => {
    try {
      const records = await listProjectSummaries();
      const projects = records.map(toProjectSummary).sort((a, b) => b.updatedAt - a.updatedAt);
      set((state) => ({
        projects,
        currentProject:
          state.currentProject && state.currentProjectId
            ? {
                ...state.currentProject,
                linkedScriptProjectId:
                  projects.find((project) => project.id === state.currentProjectId)?.linkedScriptProjectId
                  ?? state.currentProject.linkedScriptProjectId
                  ?? null,
                linkedAdProjectId:
                  projects.find((project) => project.id === state.currentProjectId)?.linkedAdProjectId
                  ?? state.currentProject.linkedAdProjectId
                  ?? null,
                clipLibraryId:
                  projects.find((project) => project.id === state.currentProjectId)?.clipLibraryId
                  ?? state.currentProject.clipLibraryId
                  ?? null,
                clipLastFolderId:
                  projects.find((project) => project.id === state.currentProjectId)?.clipLastFolderId
                  ?? state.currentProject.clipLastFolderId
                  ?? null,
              }
            : state.currentProject,
        isHydrated: true,
      }));
    } catch (error) {
      console.error('Failed to refresh project summaries from SQLite', error);
    }
  },

  createProject: (name, projectType) => {
    const id = uuidv4();
    const now = Date.now();
    const project: Project = {
      id,
      name,
      projectType,
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
      history: createEmptyHistory(),
      colorLabels: createDefaultCanvasColorLabelMap(),
    };

    set((state) => ({
      projects: [{ ...project }, ...state.projects],
      currentProjectId: id,
      currentProject: project,
      isOpeningProject: false,
    }));
    persistProject(project, { immediate: true });
    return id;
  },

  deleteProject: (id) => {
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
      isOpeningProject: false,
    }));

    persistProjectDelete(id);
  },

  deleteProjects: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      projects: state.projects.filter((project) => !idSet.has(project.id)),
      currentProjectId: idSet.has(state.currentProjectId ?? '') ? null : state.currentProjectId,
      currentProject: idSet.has(state.currentProject?.id ?? '') ? null : state.currentProject,
      isOpeningProject: false,
    }));

    ids.forEach((id) => persistProjectDelete(id));
  },

  renameProject: (id, name) => {
    const now = Date.now();

    set((state) => {
      const projects = state.projects.map((summary) =>
        summary.id === id
          ? {
              ...summary,
              name,
              updatedAt: now,
            }
          : summary
      );

      return {
        projects: projects.sort((a, b) => b.updatedAt - a.updatedAt),
        currentProject:
          state.currentProject?.id === id
            ? {
                ...state.currentProject,
                name,
                updatedAt: now,
              }
            : state.currentProject,
      };
    });

    const nextCurrentProject = get().currentProject?.id === id ? get().currentProject : null;
    if (nextCurrentProject) {
      persistProject(nextCurrentProject, { immediate: true });
      return;
    }

    void renameProjectRecord(id, name, now).catch((error) => {
      console.error('Failed to rename project record', error);
    });
  },

  setProjectLinkedScriptProject: async (projectId, linkedScriptProjectId) => {
    const normalizedLinkedScriptProjectId = linkedScriptProjectId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      if (
        (currentProject.linkedScriptProjectId ?? null) === normalizedLinkedScriptProjectId
        && (currentProject.linkedAdProjectId ?? null) === null
      ) {
        return;
      }

      const nextProject: Project = {
        ...currentProject,
        linkedScriptProjectId: normalizedLinkedScriptProjectId,
        linkedAdProjectId: null,
        updatedAt,
      };

      set((state) => ({
        currentProject: nextProject,
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      persistProject(nextProject, { debounceMs: 0 });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      if (
        (existingProject.linkedScriptProjectId ?? null) === normalizedLinkedScriptProjectId
        && (existingProject.linkedAdProjectId ?? null) === null
      ) {
        return;
      }

      const nextProject: Project = {
        ...existingProject,
        linkedScriptProjectId: normalizedLinkedScriptProjectId,
        linkedAdProjectId: null,
        updatedAt,
      };

      set((state) => ({
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      await persistProjectImmediately(nextProject);
    } catch (error) {
      console.error('Failed to update linked script project', error);
    }
  },

  setProjectLinkedAdProject: async (projectId, linkedAdProjectId) => {
    const normalizedLinkedAdProjectId = linkedAdProjectId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      if (
        (currentProject.linkedAdProjectId ?? null) === normalizedLinkedAdProjectId
        && (currentProject.linkedScriptProjectId ?? null) === null
      ) {
        return;
      }

      const nextProject: Project = {
        ...currentProject,
        linkedScriptProjectId: null,
        linkedAdProjectId: normalizedLinkedAdProjectId,
        updatedAt,
      };

      set((state) => ({
        currentProject: nextProject,
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      persistProject(nextProject, { debounceMs: 0 });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      if (
        (existingProject.linkedAdProjectId ?? null) === normalizedLinkedAdProjectId
        && (existingProject.linkedScriptProjectId ?? null) === null
      ) {
        return;
      }

      const nextProject: Project = {
        ...existingProject,
        linkedScriptProjectId: null,
        linkedAdProjectId: normalizedLinkedAdProjectId,
        updatedAt,
      };

      set((state) => ({
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      await persistProjectImmediately(nextProject);
    } catch (error) {
      console.error('Failed to update linked ad project', error);
    }
  },

  setProjectClipLibrary: async (projectId, clipLibraryId, clipLastFolderId = null) => {
    const normalizedClipLibraryId = clipLibraryId?.trim() || null;
    const normalizedClipLastFolderId = clipLastFolderId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      const nextClipLastFolderId =
        normalizedClipLibraryId === currentProject.clipLibraryId
          ? normalizedClipLastFolderId
          : null;
      if (
        (currentProject.clipLibraryId ?? null) === normalizedClipLibraryId
        && (currentProject.clipLastFolderId ?? null) === nextClipLastFolderId
      ) {
        return;
      }

      const nextProject: Project = {
        ...currentProject,
        clipLibraryId: normalizedClipLibraryId,
        clipLastFolderId: nextClipLastFolderId,
        updatedAt,
      };

      set((state) => ({
        currentProject: nextProject,
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      persistProject(nextProject, { debounceMs: 0 });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      const nextClipLastFolderId =
        normalizedClipLibraryId === (existingProject.clipLibraryId ?? null)
          ? normalizedClipLastFolderId
          : null;
      if (
        (existingProject.clipLibraryId ?? null) === normalizedClipLibraryId
        && (existingProject.clipLastFolderId ?? null) === nextClipLastFolderId
      ) {
        return;
      }

      const nextProject: Project = {
        ...existingProject,
        clipLibraryId: normalizedClipLibraryId,
        clipLastFolderId: nextClipLastFolderId,
        updatedAt,
      };

      set((state) => ({
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      await persistProjectImmediately(nextProject);
    } catch (error) {
      console.error('Failed to update clip library binding', error);
    }
  },

  setProjectClipLastFolder: async (projectId, clipLastFolderId) => {
    const normalizedClipLastFolderId = clipLastFolderId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      if ((currentProject.clipLastFolderId ?? null) === normalizedClipLastFolderId) {
        return;
      }

      const nextProject: Project = {
        ...currentProject,
        clipLastFolderId: normalizedClipLastFolderId,
        updatedAt,
      };

      set((state) => ({
        currentProject: nextProject,
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      persistProject(nextProject, { debounceMs: 0 });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      if ((existingProject.clipLastFolderId ?? null) === normalizedClipLastFolderId) {
        return;
      }

      const nextProject: Project = {
        ...existingProject,
        clipLastFolderId: normalizedClipLastFolderId,
        updatedAt,
      };

      set((state) => ({
        projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
      }));
      await persistProjectImmediately(nextProject);
    } catch (error) {
      console.error('Failed to update clip library last folder', error);
    }
  },

  openProject: (id) => {
    const reqSeq = ++openProjectRequestSeq;
    useCanvasStore.getState().closeImageViewer();
    set({ isOpeningProject: true });

    void (async () => {
      try {
        const record = await getProjectRecord(id);
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        if (!record) {
          set({ isOpeningProject: false });
          return;
        }

        const project = fromProjectRecord(record);
        set((state) => ({
          currentProjectId: id,
          currentProject: project,
          isOpeningProject: false,
          projects: updateProjectSummary(state.projects, projectToSummary(project)),
        }));
      } catch (error) {
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        console.error('Failed to open project', error);
        set({ isOpeningProject: false });
      }
    })();
  },

  closeProject: () => {
    openProjectRequestSeq += 1;
    useCanvasStore.getState().closeImageViewer();
    const { currentProjectId, currentProject } = get();
    let persistedSummary: ProjectSummary | null = null;

    if (currentProjectId && currentProject && currentProject.id === currentProjectId) {
      if (currentProject.projectType === 'ad') {
        persistedSummary = projectToSummary({
          ...currentProject,
          updatedAt: Date.now(),
        });
        persistProject(
          {
            ...currentProject,
            updatedAt: persistedSummary.updatedAt,
          },
          { immediate: true }
        );
      } else {
        const canvasState = useCanvasStore.getState();
        const nextProject: Project = {
          ...currentProject,
          nodes: canvasState.nodes,
          edges: canvasState.edges,
          viewport: canvasState.currentViewport ?? currentProject.viewport ?? DEFAULT_VIEWPORT,
          history: canvasState.history ?? currentProject.history ?? createEmptyHistory(),
          nodeCount: canvasState.nodes.length,
          updatedAt: Date.now(),
        };

        persistedSummary = projectToSummary(nextProject);
        persistProject(nextProject, { immediate: true });
      }
    }

    set((state) => ({
      projects: persistedSummary
        ? updateProjectSummary(state.projects, persistedSummary)
        : state.projects,
      currentProjectId: null,
      currentProject: null,
      isOpeningProject: false,
    }));
  },

  getCurrentProject: () => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject) {
      return null;
    }
    if (currentProject.id !== currentProjectId) {
      return null;
    }
    return currentProject;
  },

  setCurrentProjectAssetLibrary: (assetLibraryId) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const normalizedAssetLibraryId = assetLibraryId?.trim() ? assetLibraryId : null;
    if ((currentProject.assetLibraryId ?? null) === normalizedAssetLibraryId) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      assetLibraryId: normalizedAssetLibraryId,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
    }));

    persistProject(nextProject, { debounceMs: 0 });
  },

  setCurrentProjectClipLibrary: (clipLibraryId) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const normalizedClipLibraryId = clipLibraryId?.trim() ? clipLibraryId : null;
    if ((currentProject.clipLibraryId ?? null) === normalizedClipLibraryId) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      clipLibraryId: normalizedClipLibraryId,
      clipLastFolderId:
        normalizedClipLibraryId && normalizedClipLibraryId === (currentProject.clipLibraryId ?? null)
          ? currentProject.clipLastFolderId ?? null
          : null,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
    }));

    persistProject(nextProject, { debounceMs: 0 });
  },

  setCurrentProjectColorLabels: (colorLabels) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const nextColorLabels = normalizeCanvasColorLabelMap(colorLabels);
    const hasChanged = (
      currentProject.colorLabels.red !== nextColorLabels.red ||
      currentProject.colorLabels.purple !== nextColorLabels.purple ||
      currentProject.colorLabels.yellow !== nextColorLabels.yellow ||
      currentProject.colorLabels.green !== nextColorLabels.green
    );
    if (!hasChanged) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      colorLabels: nextColorLabels,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
    }));

    persistProject(nextProject, { debounceMs: 0 });
  },

  saveCurrentProject: (nodes, edges, viewport, history) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const currentViewport = currentProject.viewport ?? DEFAULT_VIEWPORT;
    const nextViewport = viewport ?? currentProject.viewport ?? DEFAULT_VIEWPORT;
    const nextHistory = history ?? currentProject.history ?? createEmptyHistory();
    const nextNodeCount = nodes.length;

    const hasViewportChanged =
      currentViewport.x !== nextViewport.x ||
      currentViewport.y !== nextViewport.y ||
      currentViewport.zoom !== nextViewport.zoom;
    const hasChanged =
      currentProject.nodes !== nodes ||
      currentProject.edges !== edges ||
      currentProject.history !== nextHistory ||
      currentProject.nodeCount !== nextNodeCount ||
      hasViewportChanged;
    if (!hasChanged) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      nodes,
      edges,
      viewport: nextViewport,
      history: nextHistory,
      nodeCount: nextNodeCount,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
    }));
    persistProject(nextProject);
  },

  saveCurrentProjectViewport: (viewport) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const nextViewport = normalizeViewport(viewport);
    const currentViewport = currentProject.viewport ?? DEFAULT_VIEWPORT;
    const hasChanged = hasViewportMeaningfulDelta(currentViewport, nextViewport);
    if (!hasChanged) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      viewport: nextViewport,
    };

    set({ currentProject: nextProject });
    queueViewportUpsert(currentProjectId, nextViewport);
  },

  cancelPendingViewportPersist: () => {
    const currentProjectId = get().currentProjectId;
    if (!currentProjectId) {
      return;
    }
    clearQueuedViewportUpsert(currentProjectId);
  },

  flushCurrentProjectToDisk: async () => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const nextProject: Project =
      currentProject.projectType === 'ad'
        ? {
            ...currentProject,
            nodeCount: currentProject.nodes.length,
            updatedAt: Date.now(),
          }
        : (() => {
            const canvasState = useCanvasStore.getState();
            return {
              ...currentProject,
              nodes: canvasState.nodes,
              edges: canvasState.edges,
              viewport: canvasState.currentViewport ?? currentProject.viewport ?? DEFAULT_VIEWPORT,
              history: canvasState.history ?? currentProject.history ?? createEmptyHistory(),
              nodeCount: canvasState.nodes.length,
              updatedAt: Date.now(),
            };
          })();

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(state.projects, projectToSummary(nextProject)),
    }));

    await persistProjectImmediately(nextProject);
  },
}));
