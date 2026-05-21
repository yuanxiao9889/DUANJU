import type { Viewport } from '@xyflow/react';

import {
  createNodeOverviewThumbnail,
  DEFAULT_OVERVIEW_THUMBNAIL_MAX_DIMENSION,
} from '@/features/canvas/application/imageData';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import {
  createViewportPreloadRect,
  type ImagePreloadViewportSize,
  type ViewportImagePreloadOptions,
} from '@/features/canvas/application/projectImagePreloader';
import {
  getCanvasNodeRect,
  rectIntersects,
} from '@/features/canvas/application/nodeGeometry';
import { useCanvasStore, type CanvasNode, type CanvasNodeData } from '@/stores/canvasStore';

type DataPathSegment = string | number;

interface ThumbnailBackfillJob {
  nodeId: string;
  path: DataPathSegment[];
  source: string;
  thumbnailMaxDimension: number;
}

interface ThumbnailBackfillScope {
  viewport: Viewport;
  viewportSize: ImagePreloadViewportSize;
  options?: ViewportImagePreloadOptions;
}

interface ThumbnailBackfillScheduleOptions extends ThumbnailBackfillScope {
  paused?: boolean;
}

const BACKFILL_IDLE_DELAY_MS = 900;
const BACKFILL_JOB_DELAY_MS = 140;
const BACKFILL_FAILURE_RETRY_MS = 60_000;
const TRANSIENT_SOURCE_PREFIXES = ['blob:', 'data:'] as const;

let activeProjectId: string | null = null;
let isBackfillPaused = false;
let activeBackfillScope: ThumbnailBackfillScope | null = null;
let backfillTimer: ReturnType<typeof setTimeout> | null = null;
let backfillRunning = false;
let rerunRequested = false;
const failedSourceAt = new Map<string, number>();

function normalizeSource(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized === 'white-placeholder') {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (TRANSIENT_SOURCE_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return null;
  }

  return normalized;
}

function hasRecentFailure(source: string): boolean {
  const failedAt = failedSourceAt.get(source);
  if (!failedAt) {
    return false;
  }

  if (Date.now() - failedAt < BACKFILL_FAILURE_RETRY_MS) {
    return true;
  }

  failedSourceAt.delete(source);
  return false;
}

function normalizeThumbnailMaxDimension(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_OVERVIEW_THUMBNAIL_MAX_DIMENSION;
}

function shouldBackfillThumbnail(
  record: Record<string, unknown>,
  targetThumbnailMaxDimension: number
): boolean {
  const existingThumbnail = normalizeSource(record.thumbnailUrl);
  if (!existingThumbnail) {
    return true;
  }

  return normalizeThumbnailMaxDimension(record.thumbnailMaxDimension) !== targetThumbnailMaxDimension;
}

function collectThumbnailJobsFromValue(
  nodeId: string,
  value: unknown,
  path: DataPathSegment[],
  jobs: ThumbnailBackfillJob[],
  visited: WeakSet<object>,
  targetThumbnailMaxDimension: number
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectThumbnailJobsFromValue(
        nodeId,
        item,
        [...path, index],
        jobs,
        visited,
        targetThumbnailMaxDimension
      );
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  const record = value as Record<string, unknown>;
  const source =
    normalizeSource(record.previewImageUrl)
    ?? normalizeSource(record.imageUrl)
    ?? normalizeSource(record.sourceUrl);

  if (
    shouldBackfillThumbnail(record, targetThumbnailMaxDimension)
    && source
    && !hasRecentFailure(source)
  ) {
    jobs.push({
      nodeId,
      path,
      source,
      thumbnailMaxDimension: targetThumbnailMaxDimension,
    });
  }

  Object.entries(record).forEach(([key, nestedValue]) => {
    if (
      key === 'thumbnailUrl'
      || key === 'imageUrl'
      || key === 'previewImageUrl'
      || key === 'sourceUrl'
    ) {
      return;
    }

    collectThumbnailJobsFromValue(
      nodeId,
      nestedValue,
      [...path, key],
      jobs,
      visited,
      targetThumbnailMaxDimension
    );
  });
}

function collectThumbnailBackfillJobs(
  nodes: CanvasNode[],
  scope: ThumbnailBackfillScope | null = null
): ThumbnailBackfillJob[] {
  const preloadRect = scope
    ? createViewportPreloadRect(scope.viewport, scope.viewportSize, scope.options)
    : null;
  if (scope && !preloadRect) {
    return [];
  }

  const jobs: ThumbnailBackfillJob[] = [];
  const nodeMap = preloadRect ? new Map(nodes.map((node) => [node.id, node] as const)) : null;
  const visited = new WeakSet<object>();
  const targetThumbnailMaxDimension = normalizeThumbnailMaxDimension(
    scope?.options?.thumbnailMaxDimension
  );
  nodes.forEach((node) => {
    if (preloadRect && nodeMap && !rectIntersects(preloadRect, getCanvasNodeRect(node, nodeMap))) {
      return;
    }

    collectThumbnailJobsFromValue(
      node.id,
      node.data,
      [],
      jobs,
      visited,
      targetThumbnailMaxDimension
    );
  });
  return jobs;
}

export function buildCanvasThumbnailBackfillSignature(nodes: CanvasNode[]): string {
  return collectThumbnailBackfillJobs(nodes)
    .map((job) => `${job.nodeId}:${job.path.join('.')}:${job.source}:${job.thumbnailMaxDimension}`)
    .sort()
    .join('\n');
}

export function buildCanvasViewportThumbnailBackfillSignature(
  nodes: CanvasNode[],
  viewport: Viewport,
  viewportSize: ImagePreloadViewportSize,
  options?: ViewportImagePreloadOptions
): string {
  return collectThumbnailBackfillJobs(nodes, { viewport, viewportSize, options })
    .map((job) => `${job.nodeId}:${job.path.join('.')}:${job.source}:${job.thumbnailMaxDimension}`)
    .sort()
    .join('\n');
}

function setThumbnailAtPath(
  value: unknown,
  path: DataPathSegment[],
  thumbnailUrl: string,
  thumbnailMaxDimension: number
): { value: unknown; changed: boolean } {
  if (path.length === 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { value, changed: false };
    }

    const record = value as Record<string, unknown>;
    if (
      normalizeSource(record.thumbnailUrl) === thumbnailUrl
      && normalizeThumbnailMaxDimension(record.thumbnailMaxDimension) === thumbnailMaxDimension
    ) {
      return { value, changed: false };
    }

    return {
      value: {
        ...record,
        thumbnailUrl,
        thumbnailMaxDimension,
      },
      changed: true,
    };
  }

  if (Array.isArray(value)) {
    const [head, ...rest] = path;
    if (typeof head !== 'number' || head < 0 || head >= value.length) {
      return { value, changed: false };
    }

    const updatedChild = setThumbnailAtPath(
      value[head],
      rest,
      thumbnailUrl,
      thumbnailMaxDimension
    );
    if (!updatedChild.changed) {
      return { value, changed: false };
    }

    const nextArray = [...value];
    nextArray[head] = updatedChild.value;
    return { value: nextArray, changed: true };
  }

  if (!value || typeof value !== 'object') {
    return { value, changed: false };
  }

  const [head, ...rest] = path;
  if (typeof head !== 'string') {
    return { value, changed: false };
  }

  const record = value as Record<string, unknown>;
  if (!(head in record)) {
    return { value, changed: false };
  }

  const updatedChild = setThumbnailAtPath(
    record[head],
    rest,
    thumbnailUrl,
    thumbnailMaxDimension
  );
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

function applyThumbnailBackfill(job: ThumbnailBackfillJob, thumbnailUrl: string): void {
  const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === job.nodeId);
  if (!node) {
    return;
  }

  const updatedData = setThumbnailAtPath(
    node.data,
    job.path,
    thumbnailUrl,
    job.thumbnailMaxDimension
  );
  if (!updatedData.changed) {
    return;
  }

  useCanvasStore.getState().updateNodeData(
    job.nodeId,
    updatedData.value as Partial<CanvasNodeData>,
    { historyMode: 'skip' }
  );
}

async function runThumbnailBackfill(projectId: string): Promise<void> {
  if (backfillRunning) {
    rerunRequested = true;
    return;
  }

  backfillRunning = true;
  try {
    do {
      rerunRequested = false;
      while (activeProjectId === projectId && !isBackfillPaused) {
        const jobs = collectThumbnailBackfillJobs(
          useCanvasStore.getState().nodes,
          activeBackfillScope
        );
        const job = jobs[0];
        if (!job) {
          break;
        }

        try {
          const thumbnailUrl = await createNodeOverviewThumbnail(
            job.source,
            createCurrentProjectMediaContext('image'),
            job.thumbnailMaxDimension
          );
          if (activeProjectId !== projectId || isBackfillPaused) {
            break;
          }
          applyThumbnailBackfill(job, thumbnailUrl);
        } catch (error) {
          failedSourceAt.set(job.source, Date.now());
          console.debug('[thumbnailBackfill] failed to create thumbnail', {
            source: job.source,
            error,
          });
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, BACKFILL_JOB_DELAY_MS);
        });
      }
    } while (rerunRequested && activeProjectId === projectId);
  } finally {
    backfillRunning = false;
  }
}

export function scheduleCanvasThumbnailBackfill(
  projectId: string | null | undefined,
  options: Partial<ThumbnailBackfillScheduleOptions> = {}
): void {
  if (!projectId) {
    activeProjectId = null;
    isBackfillPaused = false;
    activeBackfillScope = null;
    if (backfillTimer) {
      clearTimeout(backfillTimer);
      backfillTimer = null;
    }
    return;
  }

  activeProjectId = projectId;
  isBackfillPaused = options.paused === true;
  activeBackfillScope =
    options.viewport && options.viewportSize
      ? {
        viewport: options.viewport,
        viewportSize: options.viewportSize,
        options: options.options,
      }
      : null;
  if (backfillTimer) {
    clearTimeout(backfillTimer);
    backfillTimer = null;
  }

  if (isBackfillPaused) {
    rerunRequested = true;
    return;
  }

  backfillTimer = setTimeout(() => {
    backfillTimer = null;
    void runThumbnailBackfill(projectId);
  }, BACKFILL_IDLE_DELAY_MS);
}
