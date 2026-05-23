import type {
  CanvasNode,
  CanvasNodeData,
} from "@/stores/canvasStore";

export type CanvasThumbnailPathSegment = string | number;

export interface CanvasThumbnailTarget {
  nodeId: string;
  path: CanvasThumbnailPathSegment[];
  source: string;
}

export interface CanvasThumbnailUpdate {
  nodeId: string;
  path: CanvasThumbnailPathSegment[];
  source: string;
  thumbnailUrl: string;
  thumbnailMaxDimension: number;
}

const TRANSIENT_SOURCE_PREFIXES = ["blob:", "data:"] as const;

function normalizeSource(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized === "white-placeholder") {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (TRANSIENT_SOURCE_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return null;
  }

  return normalized;
}

function resolveThumbnailRecordSource(record: Record<string, unknown>): string | null {
  return (
    normalizeSource(record.previewImageUrl) ??
    normalizeSource(record.imageUrl) ??
    normalizeSource(record.sourceUrl)
  );
}

function normalizeThumbnailMaxDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function collectThumbnailTargetsFromValue(
  nodeId: string,
  value: unknown,
  path: CanvasThumbnailPathSegment[],
  targets: CanvasThumbnailTarget[],
  visited: WeakSet<object>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectThumbnailTargetsFromValue(
        nodeId,
        item,
        [...path, index],
        targets,
        visited,
      );
    });
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  const record = value as Record<string, unknown>;
  const source = resolveThumbnailRecordSource(record);
  if (source) {
    targets.push({
      nodeId,
      path,
      source,
    });
  }

  Object.entries(record).forEach(([key, nestedValue]) => {
    if (
      key === "thumbnailUrl" ||
      key === "imageUrl" ||
      key === "previewImageUrl" ||
      key === "sourceUrl"
    ) {
      return;
    }

    collectThumbnailTargetsFromValue(
      nodeId,
      nestedValue,
      [...path, key],
      targets,
      visited,
    );
  });
}

export function collectCanvasThumbnailTargetsFromNodes(
  nodes: CanvasNode[],
): CanvasThumbnailTarget[] {
  const targets: CanvasThumbnailTarget[] = [];
  const visited = new WeakSet<object>();
  nodes.forEach((node) => {
    collectThumbnailTargetsFromValue(
      node.id,
      node.data,
      [],
      targets,
      visited,
    );
  });
  return targets;
}

function setThumbnailAtPath(
  value: unknown,
  path: CanvasThumbnailPathSegment[],
  update: CanvasThumbnailUpdate,
): { value: unknown; changed: boolean } {
  if (path.length === 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { value, changed: false };
    }

    const record = value as Record<string, unknown>;
    if (resolveThumbnailRecordSource(record) !== update.source) {
      return { value, changed: false };
    }

    if (
      normalizeSource(record.thumbnailUrl) === update.thumbnailUrl &&
      normalizeThumbnailMaxDimension(
        record.thumbnailMaxDimension,
        update.thumbnailMaxDimension,
      ) === update.thumbnailMaxDimension
    ) {
      return { value, changed: false };
    }

    return {
      value: {
        ...record,
        thumbnailUrl: update.thumbnailUrl,
        thumbnailMaxDimension: update.thumbnailMaxDimension,
      },
      changed: true,
    };
  }

  if (Array.isArray(value)) {
    const [head, ...rest] = path;
    if (typeof head !== "number" || head < 0 || head >= value.length) {
      return { value, changed: false };
    }

    const updatedChild = setThumbnailAtPath(value[head], rest, update);
    if (!updatedChild.changed) {
      return { value, changed: false };
    }

    const nextArray = [...value];
    nextArray[head] = updatedChild.value;
    return { value: nextArray, changed: true };
  }

  if (!value || typeof value !== "object") {
    return { value, changed: false };
  }

  const [head, ...rest] = path;
  if (typeof head !== "string") {
    return { value, changed: false };
  }

  const record = value as Record<string, unknown>;
  if (!(head in record)) {
    return { value, changed: false };
  }

  const updatedChild = setThumbnailAtPath(record[head], rest, update);
  if (!updatedChild.changed) {
    return { value, changed: false };
  }

  return {
    value: {
      ...record,
      [head]: updatedChild.value,
    },
    changed: true,
  };
}

export function applyCanvasThumbnailUpdatesToNodes(
  nodes: CanvasNode[],
  updates: CanvasThumbnailUpdate[],
): { nodes: CanvasNode[]; changed: boolean } {
  if (updates.length === 0) {
    return { nodes, changed: false };
  }

  const updatesByNodeId = new Map<string, CanvasThumbnailUpdate[]>();
  updates.forEach((update) => {
    const nodeUpdates = updatesByNodeId.get(update.nodeId);
    if (nodeUpdates) {
      nodeUpdates.push(update);
      return;
    }
    updatesByNodeId.set(update.nodeId, [update]);
  });

  let changed = false;
  const nextNodes = nodes.map((node) => {
    const nodeUpdates = updatesByNodeId.get(node.id);
    if (!nodeUpdates || nodeUpdates.length === 0) {
      return node;
    }

    let nextData: unknown = node.data;
    let nodeChanged = false;
    nodeUpdates.forEach((update) => {
      const result = setThumbnailAtPath(nextData, update.path, update);
      nextData = result.value;
      nodeChanged ||= result.changed;
    });

    if (!nodeChanged) {
      return node;
    }

    changed = true;
    return {
      ...node,
      data: nextData as CanvasNodeData,
    };
  });

  return {
    nodes: changed ? nextNodes : nodes,
    changed,
  };
}
