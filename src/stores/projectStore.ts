import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { Viewport } from "@xyflow/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useCanvasStore,
  type CanvasEdge,
  type CanvasHistorySnapshot,
  type CanvasHistoryState,
  type CanvasNode,
  type CanvasNodePatchHistorySnapshot,
  type CanvasNodeData,
} from "./canvasStore";
import {
  compactProjectGraphBackup,
  deleteProjectRecord,
  applyProjectGraphPatch,
  getProjectGraphHistory,
  getProjectGraphRecord,
  getProjectGraphRecordIfReady,
  getProjectHistoryRecord,
  getProjectRecord,
  getProjectRecordWithoutHistory,
  listProjectSummaries,
  renameProjectRecord,
  updateProjectViewportRecord,
  upsertProjectGraphSnapshot,
  upsertProjectRecord,
  type ProjectGraphPatch,
  type ProjectGraphRecord,
  type ProjectRecord,
  type ProjectSummaryRecord,
} from "@/commands/projectState";
import {
  claimProjectEditSession,
  focusProjectWindow,
  releaseProjectEditSession,
} from "@/commands/projectWindowSessions";
import {
  createDefaultCanvasColorLabelMap,
  normalizeCanvasColorLabelMap,
  type CanvasColorLabelMap,
} from "@/features/canvas/domain/semanticColors";
import {
  DEFAULT_CANVAS_VIEWPORT,
  normalizeCanvasViewportForPersistence,
  sanitizeCanvasViewport,
} from "@/features/canvas/domain/viewport";
import { setActiveMediaProjectId } from "@/features/canvas/application/mediaPersistenceContext";
import { isTauriRuntime } from "@/lib/tauriRuntime";

function getCurrentWindowLabel(): string | null {
  if (!isTauriRuntime()) {
    return null;
  }
  return getCurrentWindow().label;
}

export const DEFAULT_VIEWPORT: Viewport = {
  ...DEFAULT_CANVAS_VIEWPORT,
};

export function createEmptyHistory(): CanvasHistoryState {
  return {
    past: [],
    future: [],
  };
}

const IMAGE_REF_PREFIX = "__img_ref__:";
const MEDIA_REFERENCE_KEYS = new Set([
  "imageUrl",
  "previewImageUrl",
  "thumbnailUrl",
  "sourceImageUrl",
  "maskImageUrl",
  "videoUrl",
  "audioUrl",
  "sourceUrl",
  "posterSourceUrl",
  "referenceUrl",
]);
const CANVAS_NODE_PERSISTENCE_IGNORED_KEYS = new Set([
  "selected",
  "dragging",
  "measured",
  "positionAbsolute",
  "internals",
  "handleBounds",
]);
const CANVAS_EDGE_PERSISTENCE_IGNORED_KEYS = new Set(["selected"]);
let openProjectRequestSeq = 0;
let projectHistoryLoadSeq = 0;
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
const MAX_PERSIST_DRAIN_WAIT_MS = 8_000;
const PROJECT_PERSIST_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;
const PROJECT_HISTORY_BACKGROUND_LOAD_DELAY_MS = 1800;
const PROJECT_GRAPH_BACKGROUND_WARMUP_DELAY_MS = 6000;

interface QueuedGraphPersist {
  project: Project;
  patch: ProjectGraphPatch | null;
}

const queuedProjectUpserts = new Map<string, QueuedGraphPersist>();
const projectUpsertTimers = new Map<string, ReturnType<typeof setTimeout>>();
const projectPersistRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const projectPersistRetryAttempts = new Map<string, number>();
const projectUpsertsInFlight = new Set<string>();
const graphBackupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const graphBackupInFlight = new Set<string>();
const graphWarmupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const graphWarmupsInFlight = new Map<string, number>();
const backgroundHistoryLoadTimers = new Map<string, ReturnType<typeof setTimeout>>();
const backgroundHistoryLoadsInFlight = new Map<string, number>();
const queuedViewportUpserts = new Map<string, string>();
const viewportUpsertTimers = new Map<string, ReturnType<typeof setTimeout>>();
const viewportUpsertsInFlight = new Set<string>();
const deletingProjectIds = new Set<string>();
const historyBudgetWarnedProjectIds = new Set<string>();
const projectOpenTraceCounts = new Map<string, number>();
const recentClosedProjectCache = new Map<string, Project>();

function logProjectTrace(
  label: string,
  payload: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug(`[project-trace] ${label}`, payload);
}

export type ProjectType = "storyboard" | "script" | "ad" | "commerceAd";
export type ProjectSaveStatus = "idle" | "saving" | "saved" | "error" | "retrying";
export type ProjectSaveReason = "auto" | "manual" | "interval" | "close" | "critical";

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
  scriptWelcomeSkipped: boolean;
}

type PersistedProject = Project & {
  imagePool?: string[];
  graphRevision?: number;
  persistenceVersion?: number;
};

interface PersistedNodesPayload {
  nodes: CanvasNode[];
  imagePool?: string[];
}

interface PersistedHistoryPayload {
  past: CanvasHistoryState["past"];
  future: CanvasHistoryState["future"];
  imagePool?: string[];
}

function isCanvasNodePatchHistorySnapshot(
  snapshot: CanvasHistorySnapshot,
): snapshot is CanvasNodePatchHistorySnapshot {
  return snapshot.kind === "nodePatch";
}

function encodeImageReference(
  imageUrl: string | null | undefined,
  imagePool: string[],
  imageIndexMap: Map<string, number>,
): string | null | undefined {
  if (typeof imageUrl !== "string" || imageUrl.length === 0) {
    return imageUrl;
  }

  if (imageUrl.startsWith(IMAGE_REF_PREFIX)) {
    return imageUrl;
  }

  const existingIndex = imageIndexMap.get(imageUrl);
  if (typeof existingIndex === "number") {
    return `${IMAGE_REF_PREFIX}${existingIndex}`;
  }

  const nextIndex = imagePool.length;
  imagePool.push(imageUrl);
  imageIndexMap.set(imageUrl, nextIndex);
  return `${IMAGE_REF_PREFIX}${nextIndex}`;
}

function decodeImageReference(
  imageUrl: string | null | undefined,
  imagePool: string[] | undefined,
): string | null | undefined {
  if (
    typeof imageUrl !== "string" ||
    !imagePool ||
    !imageUrl.startsWith(IMAGE_REF_PREFIX)
  ) {
    return imageUrl;
  }

  const index = Number.parseInt(imageUrl.slice(IMAGE_REF_PREFIX.length), 10);
  if (!Number.isFinite(index) || index < 0) {
    return imageUrl;
  }

  return imagePool[index] ?? imageUrl;
}

function parseImageReferenceIndex(value: string): number | null {
  if (!value.startsWith(IMAGE_REF_PREFIX)) {
    return null;
  }

  const indexText = value.slice(IMAGE_REF_PREFIX.length);
  if (!/^\d+$/.test(indexText)) {
    return null;
  }

  const index = Number.parseInt(indexText, 10);
  return Number.isSafeInteger(index) ? index : null;
}

function collectMaxImageReferenceIndexInValue(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (maxIndex, item) =>
        Math.max(maxIndex, collectMaxImageReferenceIndexInValue(item)),
      -1,
    );
  }

  if (!value || typeof value !== "object") {
    return -1;
  }

  let maxIndex = -1;
  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (MEDIA_REFERENCE_KEYS.has(key) && typeof nestedValue === "string") {
      const refIndex = parseImageReferenceIndex(nestedValue);
      if (refIndex != null) {
        maxIndex = Math.max(maxIndex, refIndex);
      }
    }

    maxIndex = Math.max(
      maxIndex,
      collectMaxImageReferenceIndexInValue(nestedValue),
    );
  }

  return maxIndex;
}

function collectMaxImageReferenceIndexInHistory(
  history: CanvasHistoryState,
): number {
  return Math.max(
    collectMaxImageReferenceIndexInValue(history.past),
    collectMaxImageReferenceIndexInValue(history.future),
  );
}

function normalizePersistedImagePool(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function resolvePersistedImagePool(
  projectId: string,
  nodes: CanvasNode[],
  history: CanvasHistoryState,
  nodesImagePool: string[] | undefined,
  historyImagePool: string[] | undefined,
): string[] {
  const requiredPoolSize =
    Math.max(
      collectMaxImageReferenceIndexInValue(nodes),
      collectMaxImageReferenceIndexInHistory(history),
    ) + 1;

  if (requiredPoolSize <= 0) {
    return nodesImagePool ?? historyImagePool ?? [];
  }

  if (nodesImagePool && nodesImagePool.length >= requiredPoolSize) {
    return nodesImagePool;
  }

  if (historyImagePool && historyImagePool.length >= requiredPoolSize) {
    if (nodesImagePool && nodesImagePool.length > 0) {
      console.warn(
        `Recovered image pool for project ${projectId} from history because nodes imagePool was incomplete`,
        {
          requiredPoolSize,
          nodesImagePoolSize: nodesImagePool.length,
          historyImagePoolSize: historyImagePool.length,
        },
      );
    }
    return historyImagePool;
  }

  const fallbackPool =
    (nodesImagePool?.length ?? 0) >= (historyImagePool?.length ?? 0)
      ? nodesImagePool
      : historyImagePool;

  console.warn(
    `Project ${projectId} has unresolved image references; preserving ref tokens instead of clearing media fields`,
    {
      requiredPoolSize,
      nodesImagePoolSize: nodesImagePool?.length ?? 0,
      historyImagePoolSize: historyImagePool?.length ?? 0,
    },
  );

  return fallbackPool ?? [];
}

function mapImageReferencesInValue(
  value: unknown,
  mapImageUrl: (
    imageUrl: string | null | undefined,
  ) => string | null | undefined,
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

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  let changed = false;
  const nextRecord: Record<string, unknown> = {};

  for (const [key, currentValue] of Object.entries(record)) {
    let nextValue = currentValue;

    if (
      MEDIA_REFERENCE_KEYS.has(key) &&
      (typeof currentValue === "string" || currentValue == null)
    ) {
      const mappedValue = mapImageUrl(
        currentValue as string | null | undefined,
      );
      if (mappedValue !== currentValue) {
        nextValue = mappedValue ?? null;
        changed = true;
      }
    } else {
      const mappedNestedValue = mapImageReferencesInValue(
        currentValue,
        mapImageUrl,
      );
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
  mapImageUrl: (
    imageUrl: string | null | undefined,
  ) => string | null | undefined,
): CanvasNode[] {
  return nodes.map((node) => {
    const nextData = mapImageReferencesInValue(
      node.data,
      mapImageUrl,
    ) as CanvasNodeData;
    if (nextData === node.data) {
      return node;
    }

    return {
      ...node,
      data: nextData,
    };
  });
}

function stripCanvasNodeRuntimeState(node: CanvasNode): CanvasNode {
  const runtimeNode = node as CanvasNode & Record<string, unknown>;
  const hasRuntimeState =
    "selected" in runtimeNode ||
    "dragging" in runtimeNode ||
    "measured" in runtimeNode ||
    "positionAbsolute" in runtimeNode ||
    "internals" in runtimeNode ||
    "handleBounds" in runtimeNode;

  if (!hasRuntimeState) {
    return node;
  }

  const nextNode = { ...runtimeNode };
  delete nextNode.selected;
  delete nextNode.dragging;
  delete nextNode.measured;
  delete nextNode.positionAbsolute;
  delete nextNode.internals;
  delete nextNode.handleBounds;
  return nextNode as CanvasNode;
}

function stripCanvasNodesRuntimeState(nodes: CanvasNode[]): CanvasNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const nextNode = stripCanvasNodeRuntimeState(node);
    if (nextNode !== node) {
      changed = true;
    }
    return nextNode;
  });

  return changed ? nextNodes : nodes;
}

function mapHistoryImageReferences(
  history: CanvasHistoryState,
  mapImageUrl: (
    imageUrl: string | null | undefined,
  ) => string | null | undefined,
): CanvasHistoryState {
  const mapSnapshot = (
    snapshot: CanvasHistorySnapshot,
  ): CanvasHistorySnapshot => {
    if (isCanvasNodePatchHistorySnapshot(snapshot)) {
      return {
        kind: "nodePatch",
        entries: snapshot.entries.map((entry) => ({
          nodeId: entry.nodeId,
          node: entry.node
            ? mapNodeImageReferences([entry.node], mapImageUrl)[0]
            : null,
        })),
        edges: snapshot.edges,
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

function trimHistoryForPersistence(
  history: CanvasHistoryState,
): CanvasHistoryState {
  return {
    past: history.past.slice(-MAX_PERSISTED_HISTORY_STEPS),
    future: history.future.slice(-MAX_PERSISTED_HISTORY_STEPS),
  };
}

function trimHistoryToJsonBudget(
  history: CanvasHistoryState,
  maxChars: number,
): { history: CanvasHistoryState; trimmed: boolean } {
  let nextPast = history.past;
  let nextFuture = history.future;
  let serialized = JSON.stringify({ past: nextPast, future: nextFuture });

  if (serialized.length <= maxChars) {
    return { history, trimmed: false };
  }

  while (
    (nextPast.length > 0 || nextFuture.length > 0) &&
    serialized.length > maxChars
  ) {
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
    trimmed:
      nextPast.length !== history.past.length ||
      nextFuture.length !== history.future.length,
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
    MAX_PERSISTED_HISTORY_JSON_CHARS,
  );

  if (!historyWithinBudget.trimmed) {
    historyBudgetWarnedProjectIds.delete(project.id);
    return encodedProject;
  }

  if (!historyBudgetWarnedProjectIds.has(project.id)) {
    historyBudgetWarnedProjectIds.add(project.id);
    console.info(
      `Trim persisted history for project ${project.id} to stay within ${MAX_PERSISTED_HISTORY_JSON_CHARS} chars`,
    );
  }

  const nextProject: Project = {
    ...stepLimitedProject,
    history: {
      past: historyWithinStepLimit.past.slice(
        -historyWithinBudget.history.past.length,
      ),
      future: historyWithinStepLimit.future.slice(
        -historyWithinBudget.history.future.length,
      ),
    },
  };

  return encodeProject(nextProject);
}

function toPersistedHistoryPayload(
  encodedProject: PersistedProject,
): PersistedHistoryPayload {
  return {
    past: encodedProject.history?.past ?? [],
    future: encodedProject.history?.future ?? [],
    imagePool: encodedProject.imagePool ?? [],
  };
}

function parsePersistedNodesPayload(value: unknown): PersistedNodesPayload {
  if (Array.isArray(value)) {
    return { nodes: value as CanvasNode[] };
  }

  if (!value || typeof value !== "object") {
    return { nodes: [] };
  }

  const record = value as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes)
    ? (record.nodes as CanvasNode[])
    : [];
  const imagePool = normalizePersistedImagePool(record.imagePool);

  return {
    nodes,
    imagePool,
  };
}

function hasEncodedImageReferencesInValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasEncodedImageReferencesInValue);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      MEDIA_REFERENCE_KEYS.has(key) &&
      typeof nestedValue === "string" &&
      nestedValue.startsWith(IMAGE_REF_PREFIX)
    ) {
      return true;
    }

    if (hasEncodedImageReferencesInValue(nestedValue)) {
      return true;
    }
  }

  return false;
}

function recoverImagePoolFromDecodedNodes(nodes: CanvasNode[]): string[] | undefined {
  if (hasEncodedImageReferencesInValue(nodes)) {
    return undefined;
  }

  const imagePool: string[] = [];
  const imageIndexMap = new Map<string, number>();
  const encode = (imageUrl: string | null | undefined) =>
    encodeImageReference(imageUrl, imagePool, imageIndexMap);

  mapNodeImageReferences(nodes, encode);
  return imagePool;
}

function decodeProject(project: PersistedProject): Project {
  const decode = (imageUrl: string | null | undefined) =>
    decodeImageReference(imageUrl, project.imagePool);

  return {
    ...project,
    nodes: stripCanvasNodesRuntimeState(
      mapNodeImageReferences(project.nodes, decode),
    ),
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

function parseProjectJson<T>(
  value: string,
  fieldName: string,
  projectId: string,
): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse project ${fieldName} for ${projectId}: ${formatSaveError(error)}`,
    );
  }
}

function extractImagePoolFromHistoryJson(historyJson: string): string[] {
  const imagePoolKey = '"imagePool"';
  const keyIndex = historyJson.indexOf(imagePoolKey);
  if (keyIndex < 0) {
    return [];
  }

  const arrayStart = historyJson.indexOf("[", keyIndex + imagePoolKey.length);
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
      } else if (char === "\\") {
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

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
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

  return parsed.filter((item): item is string => typeof item === "string");
}

function toProjectSummary(record: ProjectSummaryRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    projectType: (record.projectType as ProjectType) || "storyboard",
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

export function projectToSummary(project: Project): ProjectSummary {
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

export function toProjectRecord(project: Project): ProjectRecord {
  const startedAt = performance.now();
  const encodedProject = encodeProjectForPersistence(project);
  const persistedNodesPayload: PersistedNodesPayload = {
    nodes: encodedProject.nodes,
    imagePool: encodedProject.imagePool ?? [],
  };

  const record = {
    id: encodedProject.id,
    name: encodedProject.name,
    projectType: encodedProject.projectType || "storyboard",
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
    viewportJson: JSON.stringify(
      normalizeViewport(encodedProject.viewport ?? DEFAULT_VIEWPORT),
    ),
    historyJson: JSON.stringify(toPersistedHistoryPayload(encodedProject)),
    colorLabelsJson: JSON.stringify(encodedProject.colorLabels),
    scriptWelcomeSkipped: encodedProject.scriptWelcomeSkipped ?? false,
  };
  logProjectTrace("toProjectRecord", {
    projectId: project.id,
    nodeCount: project.nodes.length,
    edgeCount: project.edges.length,
    historyPastCount: project.history?.past?.length ?? 0,
    nodesJsonChars: record.nodesJson.length,
    historyJsonChars: record.historyJson.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
  return record;
}

export function fromProjectRecord(
  record: ProjectRecord,
  options?: { recoverImagePoolFromDecodedNodes?: boolean },
): Project {
  const startedAt = performance.now();
  const parsedNodesPayload = parsePersistedNodesPayload(
    parseProjectJson<unknown>(record.nodesJson, "nodesJson", record.id),
  );
  const parsedNodes = parsedNodesPayload.nodes;
  if (record.nodeCount > 0 && parsedNodes.length === 0) {
    throw new Error(
      `Refusing to open project ${record.id} with empty parsed nodes while nodeCount is ${record.nodeCount}`,
    );
  }
  const parsedEdges = parseProjectJson<CanvasEdge[]>(
    record.edgesJson,
    "edgesJson",
    record.id,
  );
  const parsedViewport = safeParseJson<Viewport>(
    record.viewportJson,
    DEFAULT_VIEWPORT,
  );
  const safeViewport = sanitizeCanvasViewport(parsedViewport);
  const shouldRestoreHistory =
    record.historyJson.length <= MAX_HISTORY_RESTORE_JSON_CHARS;
  const parsedHistoryPayload = shouldRestoreHistory
    ? safeParseJson<{
        past?: CanvasHistoryState["past"];
        future?: CanvasHistoryState["future"];
        imagePool?: string[];
      }>(record.historyJson, {})
    : {};

  if (!shouldRestoreHistory) {
    console.warn(
      `Skip restoring oversized history payload (${record.historyJson.length} chars) for project ${record.id}`,
    );
  }

  const parsedHistory = {
    past: parsedHistoryPayload.past ?? [],
    future: parsedHistoryPayload.future ?? [],
  };
  const historyImagePool =
    normalizePersistedImagePool(parsedHistoryPayload.imagePool) ??
    extractImagePoolFromHistoryJson(record.historyJson);
  const shouldRecoverImagePoolFromNodes =
    options?.recoverImagePoolFromDecodedNodes === true ||
    parsedNodesPayload.imagePool == null;
  const nodesImagePool =
    parsedNodesPayload.imagePool ??
    (shouldRecoverImagePoolFromNodes
      ? recoverImagePoolFromDecodedNodes(parsedNodes)
      : undefined);
  const imagePool = resolvePersistedImagePool(
    record.id,
    parsedNodes,
    parsedHistory,
    nodesImagePool,
    historyImagePool,
  );

  const persistedProject: PersistedProject = {
    id: record.id,
    name: record.name,
    projectType: (record.projectType as ProjectType) || "storyboard",
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
    viewport: safeViewport,
    history: parsedHistory,
    colorLabels: normalizeCanvasColorLabelMap(
      safeParseJson<unknown>(
        record.colorLabelsJson,
        createDefaultCanvasColorLabelMap(),
      ),
    ),
    scriptWelcomeSkipped: record.scriptWelcomeSkipped ?? false,
    imagePool,
  };

  const decodedProject = decodeProject(persistedProject);
  const project = {
    ...decodedProject,
    nodeCount: parsedNodes.length,
    viewport: sanitizeCanvasViewport(decodedProject.viewport),
    history: decodedProject.history ?? createEmptyHistory(),
    colorLabels: normalizeCanvasColorLabelMap(decodedProject.colorLabels),
  };
  logProjectTrace("fromProjectRecord", {
    projectId: record.id,
    nodeCount: parsedNodes.length,
    edgeCount: parsedEdges.length,
    restoredHistory: shouldRestoreHistory,
    historyPastCount: parsedHistory.past.length,
    nodesJsonChars: record.nodesJson.length,
    historyJsonChars: record.historyJson.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
  return project;
}

function fromProjectGraphRecord(graphRecord: ProjectGraphRecord): Project {
  const project = fromProjectRecord(graphRecord.record, {
    recoverImagePoolFromDecodedNodes: true,
  }) as PersistedProject;
  const persistedProject: PersistedProject = {
    ...project,
    graphRevision: graphRecord.graphRevision,
    persistenceVersion: graphRecord.persistenceVersion,
  };
  return persistedProject;
}

interface PersistProjectOptions {
  immediate?: boolean;
  debounceMs?: number;
  previousProject?: Project | null;
}

interface PersistViewportOptions {
  immediate?: boolean;
  debounceMs?: number;
}

function areValuesEqualForPersistence(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (left == null || right == null) {
    return left == null && right == null;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  if (typeof left !== "object") {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!areValuesEqualForPersistence(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);
  for (const key of keys) {
    if (!areValuesEqualForPersistence(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

function areCanvasNodeRecordsEqualForPersistence(
  left: CanvasNode,
  right: CanvasNode,
): boolean {
  if (left === right) {
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);
  for (const key of keys) {
    if (CANVAS_NODE_PERSISTENCE_IGNORED_KEYS.has(key)) {
      continue;
    }

    if (!areValuesEqualForPersistence(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

function areCanvasEdgeRecordsEqualForPersistence(
  left: CanvasEdge,
  right: CanvasEdge,
): boolean {
  if (left === right) {
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);
  for (const key of keys) {
    if (CANVAS_EDGE_PERSISTENCE_IGNORED_KEYS.has(key)) {
      continue;
    }

    if (!areValuesEqualForPersistence(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

function areCanvasNodesEqualForPersistence(
  left: CanvasNode[],
  right: CanvasNode[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areCanvasNodeRecordsEqualForPersistence(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function areCanvasEdgesEqualForPersistence(
  left: CanvasEdge[],
  right: CanvasEdge[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areCanvasEdgeRecordsEqualForPersistence(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function buildProjectGraphPatch(
  previousProject: Project | null | undefined,
  nextProject: Project,
): ProjectGraphPatch | null {
  if (!previousProject || previousProject.id !== nextProject.id) {
    return null;
  }

  const previousNodesById = new Map(
    previousProject.nodes.map((node) => [node.id, node] as const),
  );
  const nextNodesById = new Map(
    nextProject.nodes.map((node) => [node.id, node] as const),
  );
  const upsertNodes = nextProject.nodes
    .filter((node) => {
      const previousNode = previousNodesById.get(node.id);
      return (
        !previousNode ||
        !areCanvasNodeRecordsEqualForPersistence(previousNode, node)
      );
    })
    .map((node) => ({
      nodeId: node.id,
      nodeType: node.type ?? null,
      nodeJson: JSON.stringify(node),
    }));
  const deleteNodeIds = previousProject.nodes
    .filter((node) => !nextNodesById.has(node.id))
    .map((node) => node.id);

  const previousEdgesById = new Map(
    previousProject.edges.map((edge) => [edge.id, edge] as const),
  );
  const nextEdgesById = new Map(
    nextProject.edges.map((edge) => [edge.id, edge] as const),
  );
  const upsertEdges = nextProject.edges
    .filter((edge) => {
      const previousEdge = previousEdgesById.get(edge.id);
      return (
        !previousEdge ||
        !areCanvasEdgeRecordsEqualForPersistence(previousEdge, edge)
      );
    })
    .map((edge) => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      edgeJson: JSON.stringify(edge),
    }));
  const deleteEdgeIds = previousProject.edges
    .filter((edge) => !nextEdgesById.has(edge.id))
    .map((edge) => edge.id);

  const historyChanged = !areCanvasHistoriesEquivalentForPersistence(
    previousProject.history ?? createEmptyHistory(),
    nextProject.history ?? createEmptyHistory(),
  );
  const encodedProject = historyChanged
    ? encodeProjectForPersistence(nextProject)
    : null;
  const viewportChanged = hasViewportMeaningfulDelta(
    previousProject.viewport ?? DEFAULT_VIEWPORT,
    nextProject.viewport ?? DEFAULT_VIEWPORT,
  );
  const metaChanged =
    previousProject.name !== nextProject.name ||
    previousProject.projectType !== nextProject.projectType ||
    (previousProject.assetLibraryId ?? null) !==
      (nextProject.assetLibraryId ?? null) ||
    (previousProject.clipLibraryId ?? null) !==
      (nextProject.clipLibraryId ?? null) ||
    (previousProject.clipLastFolderId ?? null) !==
      (nextProject.clipLastFolderId ?? null) ||
    (previousProject.linkedScriptProjectId ?? null) !==
      (nextProject.linkedScriptProjectId ?? null) ||
    (previousProject.linkedAdProjectId ?? null) !==
      (nextProject.linkedAdProjectId ?? null) ||
    previousProject.scriptWelcomeSkipped !== nextProject.scriptWelcomeSkipped ||
    !areValuesEqualForPersistence(
      previousProject.colorLabels,
      nextProject.colorLabels,
    );

  if (
    upsertNodes.length === 0 &&
    deleteNodeIds.length === 0 &&
    upsertEdges.length === 0 &&
    deleteEdgeIds.length === 0 &&
    !historyChanged &&
    !viewportChanged &&
    !metaChanged
  ) {
    return null;
  }

  return {
    projectId: nextProject.id,
    upsertNodes,
    deleteNodeIds,
    upsertEdges,
    deleteEdgeIds,
    viewportJson: viewportChanged
      ? JSON.stringify(normalizeViewport(nextProject.viewport ?? DEFAULT_VIEWPORT))
      : undefined,
    history: historyChanged
      ? { historyJson: JSON.stringify(toPersistedHistoryPayload(encodedProject!)) }
      : undefined,
    meta: metaChanged
      ? {
          name: nextProject.name,
          projectType: nextProject.projectType,
          assetLibraryId: nextProject.assetLibraryId ?? null,
          clipLibraryId: nextProject.clipLibraryId ?? null,
          clipLastFolderId: nextProject.clipLastFolderId ?? null,
          linkedScriptProjectId: nextProject.linkedScriptProjectId ?? null,
          linkedAdProjectId: nextProject.linkedAdProjectId ?? null,
          colorLabelsJson: JSON.stringify(nextProject.colorLabels),
          scriptWelcomeSkipped: nextProject.scriptWelcomeSkipped,
        }
      : undefined,
    updatedAt: nextProject.updatedAt,
  };
}

function mergeGraphPatches(
  current: ProjectGraphPatch | null,
  incoming: ProjectGraphPatch | null,
): ProjectGraphPatch | null {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const upsertNodesById = new Map(
    (current.upsertNodes ?? []).map((node) => [node.nodeId, node] as const),
  );
  const deleteNodeIds = new Set(current.deleteNodeIds ?? []);
  for (const nodeId of incoming.deleteNodeIds ?? []) {
    upsertNodesById.delete(nodeId);
    deleteNodeIds.add(nodeId);
  }
  for (const node of incoming.upsertNodes ?? []) {
    deleteNodeIds.delete(node.nodeId);
    upsertNodesById.set(node.nodeId, node);
  }

  const upsertEdgesById = new Map(
    (current.upsertEdges ?? []).map((edge) => [edge.edgeId, edge] as const),
  );
  const deleteEdgeIds = new Set(current.deleteEdgeIds ?? []);
  for (const edgeId of incoming.deleteEdgeIds ?? []) {
    upsertEdgesById.delete(edgeId);
    deleteEdgeIds.add(edgeId);
  }
  for (const edge of incoming.upsertEdges ?? []) {
    deleteEdgeIds.delete(edge.edgeId);
    upsertEdgesById.set(edge.edgeId, edge);
  }

  return {
    projectId: incoming.projectId,
    upsertNodes: Array.from(upsertNodesById.values()),
    deleteNodeIds: Array.from(deleteNodeIds),
    upsertEdges: Array.from(upsertEdgesById.values()),
    deleteEdgeIds: Array.from(deleteEdgeIds),
    viewportJson: incoming.viewportJson ?? current.viewportJson,
    history: incoming.history ?? current.history,
    meta: incoming.meta ?? current.meta,
    updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
  };
}

function getHistorySnapshotSignature(snapshot: CanvasHistorySnapshot): string {
  if ("kind" in snapshot && snapshot.kind === "nodePatch") {
    return `patch:${snapshot.entries.length}:${snapshot.edges?.length ?? 0}`;
  }

  return `full:${snapshot.nodes.length}:${snapshot.edges.length}`;
}

function getCanvasHistoryLightSignature(history: CanvasHistoryState): string {
  const past = history.past.map(getHistorySnapshotSignature).join(",");
  const future = history.future.map(getHistorySnapshotSignature).join(",");
  return `${history.past.length}[${past}]|${history.future.length}[${future}]`;
}

function areCanvasHistoriesEquivalentForPersistence(
  left: CanvasHistoryState,
  right: CanvasHistoryState,
): boolean {
  if (left === right) {
    return true;
  }

  return (
    getCanvasHistoryLightSignature(left) ===
    getCanvasHistoryLightSignature(right)
  );
}

function scheduleIdlePersist(task: () => void): void {
  const idleHost = globalThis as typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };

  if (typeof idleHost.requestIdleCallback === "function") {
    idleHost.requestIdleCallback(task, { timeout: IDLE_PERSIST_TIMEOUT_MS });
    return;
  }

  setTimeout(task, FALLBACK_IDLE_DELAY_MS);
}

function hasViewportMeaningfulDelta(
  current: Viewport,
  next: Viewport,
): boolean {
  const safeCurrent = sanitizeCanvasViewport(current);
  const safeNext = sanitizeCanvasViewport(next);
  return (
    Math.abs(safeCurrent.x - safeNext.x) > VIEWPORT_EPSILON ||
    Math.abs(safeCurrent.y - safeNext.y) > VIEWPORT_EPSILON ||
    Math.abs(safeCurrent.zoom - safeNext.zoom) > VIEWPORT_EPSILON
  );
}

function normalizeViewport(viewport: Viewport): Viewport {
  return normalizeCanvasViewportForPersistence(viewport);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function incrementInFlightCount(
  counts: Map<string, number>,
  projectId: string,
): void {
  counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
}

function decrementInFlightCount(
  counts: Map<string, number>,
  projectId: string,
): void {
  const nextCount = (counts.get(projectId) ?? 0) - 1;
  if (nextCount <= 0) {
    counts.delete(projectId);
    return;
  }

  counts.set(projectId, nextCount);
}

function hasInFlightCount(
  counts: Map<string, number>,
  projectId: string,
): boolean {
  return (counts.get(projectId) ?? 0) > 0;
}

function formatSaveError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function updateProjectSaveState(
  projectId: string,
  patch: Partial<
    Pick<
      ProjectState,
      "saveStatus" | "lastSuccessfulSaveAt" | "lastSaveError" | "lastSaveReason"
    >
  >,
): void {
  const store = useProjectStore.getState();
  if (store.currentProjectId !== projectId) {
    return;
  }
  useProjectStore.setState(patch);
}

function updateProjectSuccessfulSaveState(
  projectId: string,
  reason: ProjectSaveReason,
): void {
  const store = useProjectStore.getState();
  if (store.currentProjectId !== projectId) {
    return;
  }

  const lastSuccessfulSaveAt = Date.now();
  const isManualSaveInFlight =
    store.saveStatus === "saving" && store.lastSaveReason === "manual";
  useProjectStore.setState({
    saveStatus: isManualSaveInFlight ? store.saveStatus : "saved",
    lastSuccessfulSaveAt,
    lastSaveError: null,
    lastSaveReason: reason,
  });
}

function clearQueuedProjectUpsert(projectId: string): void {
  const timer = projectUpsertTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    projectUpsertTimers.delete(projectId);
  }
  const retryTimer = projectPersistRetryTimers.get(projectId);
  if (retryTimer) {
    clearTimeout(retryTimer);
    projectPersistRetryTimers.delete(projectId);
  }
  projectPersistRetryAttempts.delete(projectId);
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

function scheduleGraphBackupCompact(projectId: string): void {
  if (!isTauriRuntime()) {
    return;
  }

  const existingTimer = graphBackupTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    graphBackupTimers.delete(projectId);
  }

  const timer = setTimeout(() => {
    graphBackupTimers.delete(projectId);
    if (graphBackupInFlight.has(projectId)) {
      scheduleGraphBackupCompact(projectId);
      return;
    }

    graphBackupInFlight.add(projectId);
    void compactProjectGraphBackup(projectId)
      .catch((error) => {
        console.warn("Failed to compact project graph backup", error);
      })
      .finally(() => {
        graphBackupInFlight.delete(projectId);
      });
  }, 1500);
  graphBackupTimers.set(projectId, timer);
}

function cancelGraphBackupCompact(projectId: string): void {
  const timer = graphBackupTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    graphBackupTimers.delete(projectId);
  }
}

async function compactProjectGraphBackupNow(projectId: string): Promise<void> {
  cancelGraphBackupCompact(projectId);
  while (graphBackupInFlight.has(projectId)) {
    await delay(FLUSH_WAIT_INTERVAL_MS);
  }

  graphBackupInFlight.add(projectId);
  try {
    await compactProjectGraphBackup(projectId);
  } finally {
    graphBackupInFlight.delete(projectId);
  }
}

function rememberRecentlyClosedProject(project: Project): void {
  recentClosedProjectCache.set(project.id, {
    ...project,
    history: createEmptyHistory(),
  });
  if (recentClosedProjectCache.size <= 3) {
    return;
  }

  const oldestProjectId = recentClosedProjectCache.keys().next().value;
  if (typeof oldestProjectId === "string") {
    recentClosedProjectCache.delete(oldestProjectId);
  }
}

function releaseProjectWindowSession(projectId: string | null | undefined): void {
  const windowLabel = getCurrentWindowLabel();
  if (!projectId || !windowLabel) {
    return;
  }
  void releaseProjectEditSession(projectId, windowLabel).catch((error) => {
    console.warn("Failed to release project edit session", error);
  });
}

function projectFromSummary(summary: ProjectSummary): Project {
  return {
    ...summary,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    history: createEmptyHistory(),
    colorLabels: createDefaultCanvasColorLabelMap(),
    scriptWelcomeSkipped: false,
  };
}

interface FlushProjectUpsertOptions {
  bypassIdle?: boolean;
  isRetry?: boolean;
}

function scheduleProjectPersistRetry(
  projectId: string,
  queuedPersist: QueuedGraphPersist,
  error: unknown,
): void {
  if (deletingProjectIds.has(projectId)) {
    return;
  }

  if (!queuedProjectUpserts.has(projectId)) {
    queuedProjectUpserts.set(projectId, queuedPersist);
  }

  const previousTimer = projectPersistRetryTimers.get(projectId);
  if (previousTimer) {
    clearTimeout(previousTimer);
    projectPersistRetryTimers.delete(projectId);
  }

  const attempt = (projectPersistRetryAttempts.get(projectId) ?? 0) + 1;
  projectPersistRetryAttempts.set(projectId, attempt);
  const delayMs =
    PROJECT_PERSIST_RETRY_DELAYS_MS[
      Math.min(attempt - 1, PROJECT_PERSIST_RETRY_DELAYS_MS.length - 1)
    ];

  updateProjectSaveState(projectId, {
    saveStatus: "error",
    lastSaveError: formatSaveError(error),
  });

  const retryTimer = setTimeout(() => {
    projectPersistRetryTimers.delete(projectId);
    flushProjectUpsert(projectId, { bypassIdle: true, isRetry: true });
  }, delayMs);
  projectPersistRetryTimers.set(projectId, retryTimer);
}

function flushProjectUpsert(
  projectId: string,
  options?: FlushProjectUpsertOptions,
): void {
  if (
    deletingProjectIds.has(projectId) ||
    projectUpsertsInFlight.has(projectId)
  ) {
    return;
  }

  const project = queuedProjectUpserts.get(projectId);
  if (!project) {
    return;
  }

  queuedProjectUpserts.delete(projectId);
  const retryTimer = projectPersistRetryTimers.get(projectId);
  if (retryTimer) {
    clearTimeout(retryTimer);
    projectPersistRetryTimers.delete(projectId);
  }
  projectUpsertsInFlight.add(projectId);
  const flushStartedAt = performance.now();
  logProjectTrace("persist:flush-start", {
    projectId,
    bypassIdle: options?.bypassIdle === true,
    queuedProjectCount: queuedProjectUpserts.size,
    viewportInFlight: viewportUpsertsInFlight.has(projectId),
  });

  const settle = () => {
    logProjectTrace("persist:flush-done", {
      projectId,
      elapsedMs: Math.round(performance.now() - flushStartedAt),
      queuedAgain: queuedProjectUpserts.has(projectId),
    });
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

    const buildFallbackRecord = () => toProjectRecord(project.project);
    const graphPersist = project.patch
      ? applyProjectGraphPatch(project.patch)
      : upsertProjectGraphSnapshot(buildFallbackRecord());
    void graphPersist
      .catch((error) => {
        console.warn("Failed to persist project graph snapshot; falling back to legacy record", error);
        return upsertProjectRecord(buildFallbackRecord());
      })
      .then(() => {
        projectPersistRetryAttempts.delete(projectId);
        scheduleGraphBackupCompact(projectId);
        updateProjectSuccessfulSaveState(
          projectId,
          options?.isRetry ? "critical" : "auto",
        );
      })
      .catch((error) => {
        console.error("Failed to persist project record", error);
        scheduleProjectPersistRetry(projectId, project, error);
      })
      .finally(settle);
  };

  if (options?.bypassIdle) {
    executePersist();
    return;
  }

  scheduleIdlePersist(executePersist);
}

function queueProjectUpsert(
  project: Project,
  options?: PersistProjectOptions,
): void {
  const projectId = project.id;
  deletingProjectIds.delete(projectId);
  const previousProject =
    options?.previousProject ?? useProjectStore.getState().currentProject;
  const patch = buildProjectGraphPatch(previousProject, project);
  const existingPersist = queuedProjectUpserts.get(projectId);
  queuedProjectUpserts.set(projectId, {
    project,
    patch: existingPersist
      ? mergeGraphPatches(existingPersist.patch, patch)
      : patch,
  });

  const existingTimer = projectUpsertTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    projectUpsertTimers.delete(projectId);
  }

  const debounceMs = options?.immediate
    ? 0
    : (options?.debounceMs ?? UPSERT_DEBOUNCE_MS);
  logProjectTrace("persist:queue", {
    projectId,
    nodeCount: project.nodes.length,
    edgeCount: project.edges.length,
    historyPastCount: project.history?.past?.length ?? 0,
    graphPatch:
      patch != null
        ? {
            upsertNodes: patch.upsertNodes?.length ?? 0,
            deleteNodes: patch.deleteNodeIds?.length ?? 0,
            upsertEdges: patch.upsertEdges?.length ?? 0,
            deleteEdges: patch.deleteEdgeIds?.length ?? 0,
            history: Boolean(patch.history),
            viewport: Boolean(patch.viewportJson),
          }
        : null,
    immediate: options?.immediate === true,
    debounceMs,
    inFlight: projectUpsertsInFlight.has(projectId),
  });
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

function persistProject(
  project: Project,
  options?: PersistProjectOptions,
): void {
  clearQueuedViewportUpsert(project.id);
  queueProjectUpsert(project, options);
}

async function persistProjectImmediatelyWithPrevious(
  project: Project,
  previousProject?: Project | null,
): Promise<void> {
  const projectId = project.id;
  deletingProjectIds.delete(projectId);
  clearQueuedProjectUpsert(projectId);
  clearQueuedViewportUpsert(projectId);

  while (
    projectUpsertsInFlight.has(projectId) ||
    viewportUpsertsInFlight.has(projectId)
  ) {
    await delay(FLUSH_WAIT_INTERVAL_MS);
  }

  const patch = buildProjectGraphPatch(previousProject, project);
  try {
    if (patch) {
      await applyProjectGraphPatch(patch);
    } else {
      const record = toProjectRecord(project);
      await upsertProjectGraphSnapshot(record);
    }
    scheduleGraphBackupCompact(projectId);
    projectPersistRetryAttempts.delete(projectId);
  } catch (error) {
    console.warn("Failed to persist project graph; falling back to legacy record", error);
    const record = toProjectRecord(project);
    try {
      await upsertProjectRecord(record);
      projectPersistRetryAttempts.delete(projectId);
    } catch (fallbackError) {
      updateProjectSaveState(projectId, {
        saveStatus: "error",
        lastSaveError: formatSaveError(fallbackError),
      });
      throw fallbackError;
    }
  }
}

async function waitForProjectPersistenceIdle(
  projectId: string,
  timeoutMs = MAX_PERSIST_DRAIN_WAIT_MS,
  options?: { throwOnTimeout?: boolean },
): Promise<void> {
  const startedAt = performance.now();
  while (
    queuedProjectUpserts.has(projectId) ||
    queuedViewportUpserts.has(projectId) ||
    projectUpsertsInFlight.has(projectId) ||
    viewportUpsertsInFlight.has(projectId) ||
    graphBackupInFlight.has(projectId) ||
    hasInFlightCount(graphWarmupsInFlight, projectId) ||
    hasInFlightCount(backgroundHistoryLoadsInFlight, projectId)
  ) {
    if (performance.now() - startedAt > timeoutMs) {
      const detail = {
        projectId,
        queuedProject: queuedProjectUpserts.has(projectId),
        queuedViewport: queuedViewportUpserts.has(projectId),
        projectInFlight: projectUpsertsInFlight.has(projectId),
        viewportInFlight: viewportUpsertsInFlight.has(projectId),
        graphBackupInFlight: graphBackupInFlight.has(projectId),
        graphWarmupInFlight: hasInFlightCount(graphWarmupsInFlight, projectId),
        backgroundHistoryLoadInFlight:
          hasInFlightCount(backgroundHistoryLoadsInFlight, projectId),
      };
      console.warn("Timed out while waiting for project persistence to settle", detail);
      if (options?.throwOnTimeout) {
        throw new Error(
          `Timed out while waiting for project ${projectId} persistence to settle`,
        );
      }
      return;
    }
    await delay(FLUSH_WAIT_INTERVAL_MS);
  }
}

function flushViewportUpsert(projectId: string): void {
  if (
    deletingProjectIds.has(projectId) ||
    viewportUpsertsInFlight.has(projectId)
  ) {
    return;
  }

  const viewportJson = queuedViewportUpserts.get(projectId);
  if (typeof viewportJson !== "string") {
    return;
  }

  queuedViewportUpserts.delete(projectId);
  viewportUpsertsInFlight.add(projectId);
  let shouldRetryViewportLater = false;

  void updateProjectViewportRecord(projectId, viewportJson)
    .then(() => {
      updateProjectSuccessfulSaveState(projectId, "auto");
    })
    .catch((error) => {
      console.error("Failed to persist project viewport", error);
      queuedViewportUpserts.set(projectId, viewportJson);
      shouldRetryViewportLater = true;
      updateProjectSaveState(projectId, {
        saveStatus: "error",
        lastSaveError: formatSaveError(error),
      });
    })
    .finally(() => {
      viewportUpsertsInFlight.delete(projectId);

      if (deletingProjectIds.has(projectId)) {
        return;
      }

      if (shouldRetryViewportLater && queuedViewportUpserts.has(projectId)) {
        const retryTimer = setTimeout(() => {
          viewportUpsertTimers.delete(projectId);
          flushViewportUpsert(projectId);
        }, PROJECT_PERSIST_RETRY_DELAYS_MS[0]);
        viewportUpsertTimers.set(projectId, retryTimer);
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
  options?: PersistViewportOptions,
): void {
  deletingProjectIds.delete(projectId);
  queuedViewportUpserts.set(projectId, JSON.stringify(normalizeViewport(viewport)));

  const existingTimer = viewportUpsertTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    viewportUpsertTimers.delete(projectId);
  }

  const debounceMs = options?.immediate
    ? 0
    : (options?.debounceMs ?? VIEWPORT_UPSERT_DEBOUNCE_MS);
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
    if (
      projectUpsertsInFlight.has(projectId) ||
      viewportUpsertsInFlight.has(projectId)
    ) {
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
        console.error("Failed to delete project record", error);
      })
      .finally(() => {
        deletingProjectIds.delete(projectId);
      });
  };

  attemptDelete(0);
}

function updateProjectSummary(
  summaries: ProjectSummary[],
  updated: ProjectSummary,
): ProjectSummary[] {
  const next = summaries.map((summary) =>
    summary.id === updated.id ? updated : summary,
  );
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return next;
}

function parseHistoryFromRecord(
  projectId: string,
  historyJson: string,
  imagePool?: string[],
): CanvasHistoryState {
  const parsedHistoryPayload = parseProjectJson<{
    past?: CanvasHistoryState["past"];
    future?: CanvasHistoryState["future"];
    imagePool?: string[];
  }>(historyJson, "historyJson", projectId);
  const history = {
    past: parsedHistoryPayload.past ?? [],
    future: parsedHistoryPayload.future ?? [],
  };
  const historyImagePool =
    normalizePersistedImagePool(parsedHistoryPayload.imagePool) ??
    extractImagePoolFromHistoryJson(historyJson);
  const resolvedImagePool = resolvePersistedImagePool(
    projectId,
    [],
    history,
    imagePool,
    historyImagePool,
  );

  return decodeProject({
    id: projectId,
    name: "",
    projectType: "storyboard",
    assetLibraryId: null,
    clipLibraryId: null,
    clipLastFolderId: null,
    linkedScriptProjectId: null,
    linkedAdProjectId: null,
    createdAt: 0,
    updatedAt: 0,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    history,
    colorLabels: createDefaultCanvasColorLabelMap(),
    scriptWelcomeSkipped: false,
    imagePool: resolvedImagePool,
  }).history;
}

function scheduleBackgroundHistoryLoad(
  projectId: string,
  requestSeq: number,
): void {
  const historySeq = ++projectHistoryLoadSeq;
  const existingTimer = backgroundHistoryLoadTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    backgroundHistoryLoadTimers.delete(projectId);
  }

  const timer = setTimeout(() => {
    backgroundHistoryLoadTimers.delete(projectId);
    if (
      requestSeq !== openProjectRequestSeq ||
      useProjectStore.getState().currentProjectId !== projectId
    ) {
      return;
    }

    incrementInFlightCount(backgroundHistoryLoadsInFlight, projectId);
    void (async () => {
      try {
        const graphHistoryRecord = await getProjectGraphHistory(projectId)
          .catch((error) => {
            console.warn("Failed to load graph project history; falling back to legacy history", error);
            return null;
          });
        const record = graphHistoryRecord
          ? null
          : await getProjectHistoryRecord(projectId);
        if (
          (!graphHistoryRecord && !record) ||
          (graphHistoryRecord?.projectId ?? record?.projectId) !== projectId ||
          requestSeq !== openProjectRequestSeq ||
          historySeq !== projectHistoryLoadSeq
        ) {
          return;
        }

        const currentProject = useProjectStore.getState().currentProject;
        let restoredHistory: CanvasHistoryState;
        try {
          restoredHistory = graphHistoryRecord
            ? parseHistoryFromRecord(
                projectId,
                graphHistoryRecord.historyJson,
                (currentProject as PersistedProject | null)?.imagePool,
              )
            : parseHistoryFromRecord(
                projectId,
                record?.historyJson ?? '{"past":[],"future":[]}',
                (currentProject as PersistedProject | null)?.imagePool,
              );
        } catch (error) {
          console.warn("Failed to parse project history during background restore", error);
          return;
        }
        if (
          restoredHistory.past.length === 0 &&
          restoredHistory.future.length === 0
        ) {
          return;
        }

        useProjectStore.setState((state) => {
          if (state.currentProjectId !== projectId || !state.currentProject) {
            return state;
          }

          return {
            currentProject: {
              ...state.currentProject,
              history: restoredHistory,
            },
          };
        });

        if (useProjectStore.getState().currentProjectId === projectId) {
          useCanvasStore
            .getState()
            .setCanvasHistory(restoredHistory, { source: "restore" });
        }
      } catch (error) {
        console.error("Failed to load project history in background", error);
      } finally {
        decrementInFlightCount(backgroundHistoryLoadsInFlight, projectId);
      }
    })();
  }, PROJECT_HISTORY_BACKGROUND_LOAD_DELAY_MS);
  backgroundHistoryLoadTimers.set(projectId, timer);
}

function cancelBackgroundHistoryLoad(projectId: string): void {
  const timer = backgroundHistoryLoadTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    backgroundHistoryLoadTimers.delete(projectId);
  }
}

function scheduleBackgroundGraphWarmup(
  projectId: string,
  requestSeq: number,
): void {
  const existingTimer = graphWarmupTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    graphWarmupTimers.delete(projectId);
  }

  const timer = setTimeout(() => {
    graphWarmupTimers.delete(projectId);
    if (
      requestSeq !== openProjectRequestSeq ||
      useProjectStore.getState().currentProjectId !== projectId
    ) {
      return;
    }

    incrementInFlightCount(graphWarmupsInFlight, projectId);
    void getProjectGraphRecord(projectId)
      .catch((error) => {
        console.warn("Skipped background project graph warmup", error);
        return null;
      })
      .finally(() => {
        decrementInFlightCount(graphWarmupsInFlight, projectId);
      });
  }, PROJECT_GRAPH_BACKGROUND_WARMUP_DELAY_MS);
  graphWarmupTimers.set(projectId, timer);
}

function cancelBackgroundGraphWarmup(projectId: string): void {
  const timer = graphWarmupTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    graphWarmupTimers.delete(projectId);
  }
}

interface ProjectState {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  currentProject: Project | null;
  isHydrated: boolean;
  isOpeningProject: boolean;
  saveStatus: ProjectSaveStatus;
  lastSuccessfulSaveAt: number | null;
  lastSaveError: string | null;
  lastSaveReason: ProjectSaveReason | null;

  hydrate: () => Promise<void>;
  refreshProjectSummaries: () => Promise<void>;
  createProject: (name: string, projectType: ProjectType) => string;
  deleteProject: (id: string) => void;
  deleteProjects: (ids: string[]) => void;
  renameProject: (id: string, name: string) => void;
  setProjectLinkedScriptProject: (
    projectId: string,
    linkedScriptProjectId: string | null,
  ) => Promise<void>;
  setProjectLinkedAdProject: (
    projectId: string,
    linkedAdProjectId: string | null,
  ) => Promise<void>;
  setProjectClipLibrary: (
    projectId: string,
    clipLibraryId: string | null,
    clipLastFolderId?: string | null,
  ) => Promise<void>;
  setProjectClipLastFolder: (
    projectId: string,
    clipLastFolderId: string | null,
  ) => Promise<void>;
  setCurrentProjectAssetLibrary: (assetLibraryId: string | null) => void;
  setCurrentProjectClipLibrary: (clipLibraryId: string | null) => void;
  setCurrentProjectColorLabels: (colorLabels: CanvasColorLabelMap) => void;
  setCurrentProjectScriptWelcomeSkipped: (
    scriptWelcomeSkipped: boolean,
  ) => void;
  openProject: (id: string) => void;
  closeProject: (options?: { skipPersist?: boolean }) => void;
  getCurrentProject: () => Project | null;
  saveCurrentProject: (
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    viewport?: Viewport,
    history?: CanvasHistoryState,
  ) => void;
  saveCurrentProjectViewport: (viewport: Viewport) => void;
  cancelPendingViewportPersist: () => void;
  waitForCurrentProjectPersistenceIdle: () => Promise<void>;
  flushCurrentProjectToDisk: () => Promise<void>;
  saveCurrentProjectFully: (options?: { reason?: ProjectSaveReason }) => Promise<void>;
  finalizeCurrentProjectBeforeClose: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  currentProject: null,
  isHydrated: false,
  isOpeningProject: false,
  saveStatus: "idle",
  lastSuccessfulSaveAt: null,
  lastSaveError: null,
  lastSaveReason: null,

  hydrate: async () => {
    if (get().isHydrated) {
      return;
    }

    if (!isTauriRuntime()) {
      set({
        projects: [],
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
        saveStatus: "idle",
        lastSaveError: null,
        lastSaveReason: null,
      });
      setActiveMediaProjectId(null);
      return;
    }

    try {
      const records = await listProjectSummaries();
      const projects = records
        .map(toProjectSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      set({
        projects,
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
        saveStatus: "idle",
        lastSaveError: null,
        lastSaveReason: null,
      });
      setActiveMediaProjectId(null);
    } catch (error) {
      console.error("Failed to hydrate project summaries from SQLite", error);
      set({
        projects: [],
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
        saveStatus: "idle",
        lastSaveError: null,
        lastSaveReason: null,
      });
      setActiveMediaProjectId(null);
    }
  },

  refreshProjectSummaries: async () => {
    try {
      const records = await listProjectSummaries();
      const projects = records
        .map(toProjectSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      set((state) => ({
        projects,
        currentProject:
          state.currentProject && state.currentProjectId
            ? {
                ...state.currentProject,
                linkedScriptProjectId:
                  projects.find(
                    (project) => project.id === state.currentProjectId,
                  )?.linkedScriptProjectId ??
                  state.currentProject.linkedScriptProjectId ??
                  null,
                linkedAdProjectId:
                  projects.find(
                    (project) => project.id === state.currentProjectId,
                  )?.linkedAdProjectId ??
                  state.currentProject.linkedAdProjectId ??
                  null,
                clipLibraryId:
                  projects.find(
                    (project) => project.id === state.currentProjectId,
                  )?.clipLibraryId ??
                  state.currentProject.clipLibraryId ??
                  null,
                clipLastFolderId:
                  projects.find(
                    (project) => project.id === state.currentProjectId,
                  )?.clipLastFolderId ??
                  state.currentProject.clipLastFolderId ??
                  null,
              }
            : state.currentProject,
        isHydrated: true,
      }));
    } catch (error) {
      console.error("Failed to refresh project summaries from SQLite", error);
    }
  },

  createProject: (name, projectType) => {
    const id = uuidv4();
    const now = Date.now();
    useCanvasStore.getState().resetCanvasSession();
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
      scriptWelcomeSkipped: false,
    };

    set((state) => ({
      projects: [{ ...project }, ...state.projects],
      currentProjectId: id,
      currentProject: project,
      isOpeningProject: false,
    }));
    setActiveMediaProjectId(id, name);
    persistProject(project, { immediate: true, previousProject: null });
    return id;
  },

  deleteProject: (id) => {
    const shouldClearActiveMediaProject = get().currentProjectId === id;
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      currentProjectId:
        state.currentProjectId === id ? null : state.currentProjectId,
      currentProject:
        state.currentProject?.id === id ? null : state.currentProject,
      isOpeningProject: false,
    }));
    if (shouldClearActiveMediaProject) {
      setActiveMediaProjectId(null);
    }

    persistProjectDelete(id);
  },

  deleteProjects: (ids) => {
    const idSet = new Set(ids);
    const shouldClearActiveMediaProject = idSet.has(
      get().currentProjectId ?? "",
    );
    set((state) => ({
      projects: state.projects.filter((project) => !idSet.has(project.id)),
      currentProjectId: idSet.has(state.currentProjectId ?? "")
        ? null
        : state.currentProjectId,
      currentProject: idSet.has(state.currentProject?.id ?? "")
        ? null
        : state.currentProject,
      isOpeningProject: false,
    }));
    if (shouldClearActiveMediaProject) {
      setActiveMediaProjectId(null);
    }

    ids.forEach((id) => persistProjectDelete(id));
  },

  renameProject: (id, name) => {
    const now = Date.now();
    const previousCurrentProject = get().currentProject;

    set((state) => {
      const projects = state.projects.map((summary) =>
        summary.id === id
          ? {
              ...summary,
              name,
              updatedAt: now,
            }
          : summary,
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

    const nextCurrentProject =
      get().currentProject?.id === id ? get().currentProject : null;
    if (nextCurrentProject) {
      setActiveMediaProjectId(id, nextCurrentProject.name);
      persistProject(nextCurrentProject, {
        immediate: true,
        previousProject: previousCurrentProject,
      });
      return;
    }

    void renameProjectRecord(id, name, now).catch((error) => {
      console.error("Failed to rename project record", error);
    });
  },

  setProjectLinkedScriptProject: async (projectId, linkedScriptProjectId) => {
    const normalizedLinkedScriptProjectId =
      linkedScriptProjectId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      if (
        (currentProject.linkedScriptProjectId ?? null) ===
          normalizedLinkedScriptProjectId &&
        (currentProject.linkedAdProjectId ?? null) === null
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
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      if (
        (existingProject.linkedScriptProjectId ?? null) ===
          normalizedLinkedScriptProjectId &&
        (existingProject.linkedAdProjectId ?? null) === null
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
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      await persistProjectImmediatelyWithPrevious(nextProject, existingProject);
    } catch (error) {
      console.error("Failed to update linked script project", error);
    }
  },

  setProjectLinkedAdProject: async (projectId, linkedAdProjectId) => {
    const normalizedLinkedAdProjectId = linkedAdProjectId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      if (
        (currentProject.linkedAdProjectId ?? null) ===
          normalizedLinkedAdProjectId &&
        (currentProject.linkedScriptProjectId ?? null) === null
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
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      if (
        (existingProject.linkedAdProjectId ?? null) ===
          normalizedLinkedAdProjectId &&
        (existingProject.linkedScriptProjectId ?? null) === null
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
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      await persistProjectImmediatelyWithPrevious(nextProject, existingProject);
    } catch (error) {
      console.error("Failed to update linked ad project", error);
    }
  },

  setProjectClipLibrary: async (
    projectId,
    clipLibraryId,
    clipLastFolderId = null,
  ) => {
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
        (currentProject.clipLibraryId ?? null) === normalizedClipLibraryId &&
        (currentProject.clipLastFolderId ?? null) === nextClipLastFolderId
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
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
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
        (existingProject.clipLibraryId ?? null) === normalizedClipLibraryId &&
        (existingProject.clipLastFolderId ?? null) === nextClipLastFolderId
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
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      await persistProjectImmediatelyWithPrevious(nextProject, existingProject);
    } catch (error) {
      console.error("Failed to update clip library binding", error);
    }
  },

  setProjectClipLastFolder: async (projectId, clipLastFolderId) => {
    const normalizedClipLastFolderId = clipLastFolderId?.trim() || null;
    const updatedAt = Date.now();

    const { currentProjectId, currentProject } = get();
    if (currentProjectId === projectId && currentProject?.id === projectId) {
      if (
        (currentProject.clipLastFolderId ?? null) === normalizedClipLastFolderId
      ) {
        return;
      }

      const nextProject: Project = {
        ...currentProject,
        clipLastFolderId: normalizedClipLastFolderId,
        updatedAt,
      };

      set((state) => ({
        currentProject: nextProject,
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
      return;
    }

    try {
      const record = await getProjectRecord(projectId);
      if (!record) {
        return;
      }

      const existingProject = fromProjectRecord(record);
      if (
        (existingProject.clipLastFolderId ?? null) ===
        normalizedClipLastFolderId
      ) {
        return;
      }

      const nextProject: Project = {
        ...existingProject,
        clipLastFolderId: normalizedClipLastFolderId,
        updatedAt,
      };

      set((state) => ({
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));
      await persistProjectImmediatelyWithPrevious(nextProject, existingProject);
    } catch (error) {
      console.error("Failed to update clip library last folder", error);
    }
  },

  openProject: (id) => {
    const reqSeq = ++openProjectRequestSeq;
    projectHistoryLoadSeq += 1;
    cancelGraphBackupCompact(id);
    useCanvasStore.getState().closeImageViewer();
    const openStartedAt = performance.now();
    const openCount = (projectOpenTraceCounts.get(id) ?? 0) + 1;
    projectOpenTraceCounts.set(id, openCount);
    logProjectTrace("open:start", {
      projectId: id,
      openCount,
      projectPersistInFlight: projectUpsertsInFlight.has(id),
      viewportPersistInFlight: viewportUpsertsInFlight.has(id),
      queuedProjectPersist: queuedProjectUpserts.has(id),
      queuedViewportPersist: queuedViewportUpserts.has(id),
    });
    set((state) => {
      const summary = state.projects.find((project) => project.id === id);
      if (!summary) {
        return { isOpeningProject: true };
      }

      return {
        currentProjectId: id,
        currentProject: projectFromSummary(summary),
        isOpeningProject: true,
        saveStatus: "idle",
        lastSaveError: null,
        lastSaveReason: null,
      };
    });
    setActiveMediaProjectId(id, get().currentProject?.name ?? null);

    void (async () => {
      let claimedWindowLabel: string | null = null;
      let keepClaim = false;
      try {
        const windowLabel = getCurrentWindowLabel();
        if (windowLabel) {
          const claim = await claimProjectEditSession(id, windowLabel);
          if (!claim.claimed) {
            if (claim.ownerWindowLabel) {
              await focusProjectWindow(claim.ownerWindowLabel).catch((error) => {
                console.warn("Failed to focus occupied project window", error);
              });
            }
            if (reqSeq === openProjectRequestSeq) {
              set({
                currentProjectId: null,
                currentProject: null,
                isOpeningProject: false,
                saveStatus: "idle",
                lastSaveError: null,
                lastSaveReason: null,
              });
              setActiveMediaProjectId(null);
            }
            return;
          }
          claimedWindowLabel = windowLabel;
        }

        const cachedProject = recentClosedProjectCache.get(id);
        if (cachedProject) {
          if (reqSeq !== openProjectRequestSeq) {
            return;
          }
          set((state) => ({
            currentProjectId: id,
            currentProject: cachedProject,
            isOpeningProject: false,
            projects: updateProjectSummary(
              state.projects,
              projectToSummary(cachedProject),
            ),
          }));
          setActiveMediaProjectId(id, cachedProject.name);
          scheduleBackgroundHistoryLoad(id, reqSeq);
          logProjectTrace("open:memory-cache-hit", {
            projectId: id,
            openCount,
            nodeCount: cachedProject.nodes.length,
            elapsedSinceOpenMs: Math.round(performance.now() - openStartedAt),
          });
          keepClaim = true;
          return;
        }

        const graphReadStartedAt = performance.now();
        const graphRecord = await getProjectGraphRecordIfReady(id).catch((error) => {
          console.warn("Failed to open ready project graph; falling back to legacy record", error);
          return null;
        });
        logProjectTrace("open:graph-record-loaded", {
          projectId: id,
          openCount,
          elapsedMs: Math.round(performance.now() - graphReadStartedAt),
          elapsedSinceOpenMs: Math.round(performance.now() - openStartedAt),
          found: Boolean(graphRecord),
          persistenceVersion: graphRecord?.persistenceVersion ?? null,
          graphRevision: graphRecord?.graphRevision ?? null,
          nodesJsonChars: graphRecord?.record.nodesJson.length ?? 0,
          historyJsonChars: graphRecord?.record.historyJson.length ?? 0,
        });
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        const parseStartedAt = performance.now();
        let didOpenGraphRecord = false;
        let project: Project | null = null;
        if (graphRecord) {
          try {
            project = fromProjectGraphRecord(graphRecord);
            didOpenGraphRecord = true;
          } catch (error) {
            console.warn(
              "Failed to parse ready project graph; falling back to legacy record",
              error,
            );
          }
        }
        if (!project) {
          const readStartedAt = performance.now();
          const record = await getProjectRecordWithoutHistory(id);
          logProjectTrace("open:legacy-record-loaded", {
            projectId: id,
            openCount,
            elapsedMs: Math.round(performance.now() - readStartedAt),
            elapsedSinceOpenMs: Math.round(performance.now() - openStartedAt),
            found: Boolean(record),
            nodesJsonChars: record?.nodesJson.length ?? 0,
            historyJsonChars: record?.historyJson.length ?? 0,
          });
          if (reqSeq !== openProjectRequestSeq) {
            return;
          }
          if (!record) {
            set({ isOpeningProject: false });
            return;
          }
          project = fromProjectRecord(record);
        }
        logProjectTrace("open:project-parsed", {
          projectId: id,
          openCount,
          nodeCount: project.nodes.length,
          edgeCount: project.edges.length,
          elapsedMs: Math.round(performance.now() - parseStartedAt),
          elapsedSinceOpenMs: Math.round(performance.now() - openStartedAt),
        });
        set((state) => ({
          currentProjectId: id,
          currentProject: project,
          isOpeningProject: false,
          projects: updateProjectSummary(
            state.projects,
            projectToSummary(project),
          ),
        }));
        setActiveMediaProjectId(id, project.name);
        scheduleBackgroundHistoryLoad(id, reqSeq);
        if (!didOpenGraphRecord) {
          scheduleBackgroundGraphWarmup(id, reqSeq);
        }
        logProjectTrace("open:state-set", {
          projectId: id,
          openCount,
          elapsedSinceOpenMs: Math.round(performance.now() - openStartedAt),
        });
        keepClaim = true;
      } catch (error) {
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        console.error("Failed to open project", error);
        set({ isOpeningProject: false });
      } finally {
        if (!keepClaim && claimedWindowLabel) {
          await releaseProjectEditSession(id, claimedWindowLabel).catch((error) => {
            console.warn("Failed to release abandoned project edit session", error);
          });
        }
      }
    })();
  },

  closeProject: (options) => {
    openProjectRequestSeq += 1;
    projectHistoryLoadSeq += 1;
    const shouldPersistOnClose = options?.skipPersist !== true;
    const closeStartedAt = performance.now();
    const canvasState = useCanvasStore.getState();
    canvasState.closeImageViewer();
    const { currentProjectId, currentProject } = get();
    let persistedSummary: ProjectSummary | null = null;

    if (!shouldPersistOnClose) {
      if (
        currentProjectId &&
        currentProject &&
        currentProject.id === currentProjectId
      ) {
        persistedSummary = projectToSummary(currentProject);
        rememberRecentlyClosedProject(currentProject);
      }
      canvasState.resetCanvasSession();
      set((state) => ({
        projects: persistedSummary
          ? updateProjectSummary(state.projects, persistedSummary)
          : state.projects,
        currentProjectId: null,
        currentProject: null,
        isOpeningProject: false,
        saveStatus: "idle",
        lastSaveError: null,
        lastSaveReason: null,
      }));
      setActiveMediaProjectId(null);
      releaseProjectWindowSession(currentProjectId);
      return;
    }

    if (
      currentProjectId &&
      currentProject &&
      currentProject.id === currentProjectId
    ) {
      if (currentProject.projectType === "ad") {
        const nextProject = shouldPersistOnClose
          ? {
              ...currentProject,
              updatedAt: Date.now(),
            }
          : currentProject;
        persistedSummary = projectToSummary(nextProject);
        if (shouldPersistOnClose) {
          persistProject(nextProject, { previousProject: currentProject });
        }
        rememberRecentlyClosedProject(nextProject);
      } else {
        const nextViewport =
          canvasState.currentViewport ??
          currentProject.viewport ??
          DEFAULT_VIEWPORT;
        const nextHistory =
          canvasState.history ?? currentProject.history ?? createEmptyHistory();
        const hasContentChanged =
          !areCanvasNodesEqualForPersistence(
            currentProject.nodes,
            canvasState.nodes,
          ) ||
          !areCanvasEdgesEqualForPersistence(
            currentProject.edges,
            canvasState.edges,
          ) ||
          !areCanvasHistoriesEquivalentForPersistence(
            currentProject.history ?? createEmptyHistory(),
            nextHistory,
          );
        const hasViewportChanged = hasViewportMeaningfulDelta(
          currentProject.viewport ?? DEFAULT_VIEWPORT,
          normalizeViewport(nextViewport),
        );
        logProjectTrace("close:compare", {
          projectId: currentProjectId,
          nodeCount: canvasState.nodes.length,
          edgeCount: canvasState.edges.length,
          hasContentChanged,
          hasViewportChanged,
          historyPastCount: nextHistory.past.length,
          elapsedMs: Math.round(performance.now() - closeStartedAt),
        });

        if (!hasContentChanged) {
          if (hasViewportChanged) {
            if (shouldPersistOnClose) {
              queueViewportUpsert(
                currentProjectId,
                normalizeViewport(nextViewport),
                { immediate: true },
              );
            }
            persistedSummary = projectToSummary({
              ...currentProject,
              viewport: normalizeViewport(nextViewport),
            });
          }
          rememberRecentlyClosedProject({
            ...currentProject,
            viewport: normalizeViewport(nextViewport),
          });
          canvasState.resetCanvasSession();
          set((state) => ({
            projects: persistedSummary
              ? updateProjectSummary(state.projects, persistedSummary)
              : state.projects,
            currentProjectId: null,
            currentProject: null,
            isOpeningProject: false,
            saveStatus: "idle",
            lastSaveError: null,
            lastSaveReason: null,
          }));
          setActiveMediaProjectId(null);
          releaseProjectWindowSession(currentProjectId);
          return;
        }

        const nextProject: Project = {
          ...currentProject,
          nodes: canvasState.nodes,
          edges: canvasState.edges,
          viewport: nextViewport,
          history: nextHistory,
          nodeCount: canvasState.nodes.length,
          updatedAt: Date.now(),
        };

        persistedSummary = projectToSummary(nextProject);
        if (shouldPersistOnClose) {
          persistProject(nextProject, { previousProject: currentProject });
        }
        rememberRecentlyClosedProject(nextProject);
      }
    }

    canvasState.resetCanvasSession();
    set((state) => ({
      projects: persistedSummary
        ? updateProjectSummary(state.projects, persistedSummary)
        : state.projects,
      currentProjectId: null,
      currentProject: null,
      isOpeningProject: false,
      saveStatus: "idle",
      lastSaveError: null,
      lastSaveReason: null,
    }));
    setActiveMediaProjectId(null);
    releaseProjectWindowSession(currentProjectId);
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
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    const normalizedAssetLibraryId = assetLibraryId?.trim()
      ? assetLibraryId
      : null;
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
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));

    persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
  },

  setCurrentProjectClipLibrary: (clipLibraryId) => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    const normalizedClipLibraryId = clipLibraryId?.trim()
      ? clipLibraryId
      : null;
    if ((currentProject.clipLibraryId ?? null) === normalizedClipLibraryId) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      clipLibraryId: normalizedClipLibraryId,
      clipLastFolderId:
        normalizedClipLibraryId &&
        normalizedClipLibraryId === (currentProject.clipLibraryId ?? null)
          ? (currentProject.clipLastFolderId ?? null)
          : null,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));

    persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
  },

  setCurrentProjectColorLabels: (colorLabels) => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    const nextColorLabels = normalizeCanvasColorLabelMap(colorLabels);
    const hasChanged =
      currentProject.colorLabels.red !== nextColorLabels.red ||
      currentProject.colorLabels.purple !== nextColorLabels.purple ||
      currentProject.colorLabels.yellow !== nextColorLabels.yellow ||
      currentProject.colorLabels.green !== nextColorLabels.green;
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
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));

    persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
  },

  setCurrentProjectScriptWelcomeSkipped: (scriptWelcomeSkipped) => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    if (currentProject.scriptWelcomeSkipped === scriptWelcomeSkipped) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      scriptWelcomeSkipped,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));

    persistProject(nextProject, { debounceMs: 0, previousProject: currentProject });
  },

  saveCurrentProject: (nodes, edges, viewport, history) => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    const currentViewport = currentProject.viewport ?? DEFAULT_VIEWPORT;
    const nextViewport =
      viewport ?? currentProject.viewport ?? DEFAULT_VIEWPORT;
    const nextHistory =
      history ?? currentProject.history ?? createEmptyHistory();
    const nextNodeCount = nodes.length;

    const hasViewportChanged =
      currentViewport.x !== nextViewport.x ||
      currentViewport.y !== nextViewport.y ||
      currentViewport.zoom !== nextViewport.zoom;
    const hasChanged =
      currentProject.nodes !== nodes ||
      currentProject.edges !== edges ||
      !areCanvasHistoriesEquivalentForPersistence(
        currentProject.history ?? createEmptyHistory(),
        nextHistory,
      ) ||
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
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));
    persistProject(nextProject, { previousProject: currentProject });
  },

  saveCurrentProjectViewport: (viewport) => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    const nextViewport = normalizeViewport(viewport);
    const currentViewport = currentProject.viewport ?? DEFAULT_VIEWPORT;
    const hasChanged = hasViewportMeaningfulDelta(
      currentViewport,
      nextViewport,
    );
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

  waitForCurrentProjectPersistenceIdle: async () => {
    const { currentProjectId } = get();
    if (!currentProjectId) {
      return;
    }

    await waitForProjectPersistenceIdle(currentProjectId);
  },

  flushCurrentProjectToDisk: async () => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    if (currentProject.projectType !== "ad") {
      const canvasState = useCanvasStore.getState();
      const nextViewport = normalizeViewport(
        canvasState.currentViewport ??
          currentProject.viewport ??
          DEFAULT_VIEWPORT,
      );
      const nextHistory =
        canvasState.history ?? currentProject.history ?? createEmptyHistory();
      const hasContentChanged =
        !areCanvasNodesEqualForPersistence(
          currentProject.nodes,
          canvasState.nodes,
        ) ||
        !areCanvasEdgesEqualForPersistence(
          currentProject.edges,
          canvasState.edges,
        ) ||
        !areCanvasHistoriesEquivalentForPersistence(
          currentProject.history ?? createEmptyHistory(),
          nextHistory,
        );
      const hasViewportChanged = hasViewportMeaningfulDelta(
        currentProject.viewport ?? DEFAULT_VIEWPORT,
        nextViewport,
      );

      if (!hasContentChanged) {
        if (hasViewportChanged) {
          const viewportOnlyProject: Project = {
            ...currentProject,
            viewport: nextViewport,
          };

          set({ currentProject: viewportOnlyProject });
          queueViewportUpsert(currentProjectId, nextViewport, {
            immediate: true,
          });
        }

        await waitForProjectPersistenceIdle(currentProjectId);
        return;
      }

      const nextProject: Project = {
        ...currentProject,
        nodes: canvasState.nodes,
        edges: canvasState.edges,
        viewport: nextViewport,
        history: nextHistory,
        nodeCount: canvasState.nodes.length,
        updatedAt: Date.now(),
      };

      set((state) => ({
        currentProject: nextProject,
        projects: updateProjectSummary(
          state.projects,
          projectToSummary(nextProject),
        ),
      }));

      await persistProjectImmediatelyWithPrevious(nextProject, currentProject);
      await waitForProjectPersistenceIdle(currentProjectId);
      updateProjectSuccessfulSaveState(currentProjectId, "auto");
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      nodeCount: currentProject.nodes.length,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));

    await persistProjectImmediatelyWithPrevious(nextProject, currentProject);
    await waitForProjectPersistenceIdle(currentProjectId);
    updateProjectSuccessfulSaveState(currentProjectId, "auto");
  },

  saveCurrentProjectFully: async (options) => {
    const reason = options?.reason ?? "manual";
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    updateProjectSaveState(currentProjectId, {
      saveStatus: "saving",
      lastSaveReason: reason,
      lastSaveError: null,
    });

    const buildProjectForFullSave = (): Project => {
      if (currentProject.projectType === "ad") {
        return {
          ...currentProject,
          nodeCount: currentProject.nodes.length,
          updatedAt: Date.now(),
        };
      }

      const canvasState = useCanvasStore.getState();
      const nextViewport = normalizeViewport(
        canvasState.currentViewport ??
          currentProject.viewport ??
          DEFAULT_VIEWPORT,
      );
      return {
        ...currentProject,
        nodes: canvasState.nodes,
        edges: canvasState.edges,
        viewport: nextViewport,
        history: canvasState.history ?? currentProject.history ?? createEmptyHistory(),
        nodeCount: canvasState.nodes.length,
        updatedAt: Date.now(),
      };
    };

    const nextProject = buildProjectForFullSave();
    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(
        state.projects,
        projectToSummary(nextProject),
      ),
    }));

    try {
      await persistProjectImmediatelyWithPrevious(nextProject, currentProject);
      await waitForProjectPersistenceIdle(currentProjectId);
      await compactProjectGraphBackupNow(currentProjectId);
      await waitForProjectPersistenceIdle(currentProjectId);
      updateProjectSuccessfulSaveState(currentProjectId, reason);
    } catch (error) {
      updateProjectSaveState(currentProjectId, {
        saveStatus: "error",
        lastSaveError: formatSaveError(error),
        lastSaveReason: reason,
      });
      throw error;
    }
  },

  finalizeCurrentProjectBeforeClose: async () => {
    const { currentProjectId, currentProject } = get();
    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId
    ) {
      return;
    }

    cancelBackgroundHistoryLoad(currentProjectId);
    cancelBackgroundGraphWarmup(currentProjectId);
    cancelGraphBackupCompact(currentProjectId);
    await waitForProjectPersistenceIdle(currentProjectId, undefined, {
      throwOnTimeout: true,
    });
    await get().saveCurrentProjectFully({ reason: "close" });

    try {
      await getProjectGraphHistory(currentProjectId);
    } catch (error) {
      console.warn("Failed to finalize project graph history before close", error);
      throw error;
    }

    await waitForProjectPersistenceIdle(currentProjectId, undefined, {
      throwOnTimeout: true,
    });
  },
}));
