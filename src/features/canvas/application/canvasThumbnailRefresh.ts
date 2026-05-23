import {
  collectCanvasThumbnailTargetsFromNodes,
  type CanvasThumbnailUpdate,
  type CanvasThumbnailTarget,
} from "@/features/canvas/application/canvasThumbnailRecords";
import { createNodeOverviewThumbnail } from "@/features/canvas/application/imageData";
import { createCurrentProjectMediaContext } from "@/features/canvas/application/mediaPersistenceContext";
import {
  useCanvasStore,
  type CanvasHistorySnapshot,
} from "@/stores/canvasStore";

export type CanvasThumbnailRefreshStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface CanvasThumbnailRefreshProgress {
  projectId: string | null;
  thumbnailMaxDimension: number | null;
  total: number;
  completed: number;
  failed: number;
  status: CanvasThumbnailRefreshStatus;
}

export interface StartCanvasThumbnailRefreshOptions {
  projectId: string;
  thumbnailMaxDimension: number;
  onProgress?: (progress: CanvasThumbnailRefreshProgress) => void;
}

const REFRESH_APPLY_BATCH_SIZE = 8;
const REFRESH_APPLY_BATCH_DELAY_MS = 180;

let currentProgress: CanvasThumbnailRefreshProgress = {
  projectId: null,
  thumbnailMaxDimension: null,
  total: 0,
  completed: 0,
  failed: 0,
  status: "idle",
};
let activeRefreshToken: symbol | null = null;
const progressListeners = new Set<(progress: CanvasThumbnailRefreshProgress) => void>();

function emitProgress(progress: CanvasThumbnailRefreshProgress): void {
  currentProgress = progress;
  progressListeners.forEach((listener) => listener(progress));
}

function updateProgress(
  patch: Partial<CanvasThumbnailRefreshProgress>,
  onProgress?: (progress: CanvasThumbnailRefreshProgress) => void,
): void {
  const nextProgress = {
    ...currentProgress,
    ...patch,
  };
  emitProgress(nextProgress);
  onProgress?.(nextProgress);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isNodePatchSnapshot(
  snapshot: CanvasHistorySnapshot,
): snapshot is Extract<CanvasHistorySnapshot, { kind: "nodePatch" }> {
  return snapshot.kind === "nodePatch";
}

function collectCanvasThumbnailTargetsFromSnapshot(
  snapshot: CanvasHistorySnapshot,
): CanvasThumbnailTarget[] {
  if (isNodePatchSnapshot(snapshot)) {
    return collectCanvasThumbnailTargetsFromNodes(
      snapshot.entries
        .map((entry) => entry.node)
        .filter((node): node is NonNullable<typeof node> => Boolean(node)),
    );
  }

  return collectCanvasThumbnailTargetsFromNodes(snapshot.nodes);
}

function dedupeTargets(targets: CanvasThumbnailTarget[]): CanvasThumbnailTarget[] {
  const seen = new Set<string>();
  const uniqueTargets: CanvasThumbnailTarget[] = [];
  targets.forEach((target) => {
    const key = `${target.nodeId}\n${target.path.join(".")}\n${target.source}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    uniqueTargets.push(target);
  });
  return uniqueTargets;
}

function collectCurrentCanvasThumbnailTargets(): CanvasThumbnailTarget[] {
  const { nodes, history } = useCanvasStore.getState();
  return dedupeTargets([
    ...collectCanvasThumbnailTargetsFromNodes(nodes),
    ...history.past.flatMap(collectCanvasThumbnailTargetsFromSnapshot),
    ...history.future.flatMap(collectCanvasThumbnailTargetsFromSnapshot),
  ]);
}

async function flushUpdates(
  updates: CanvasThumbnailUpdate[],
): Promise<CanvasThumbnailUpdate[]> {
  if (updates.length === 0) {
    return updates;
  }

  useCanvasStore.getState().replaceThumbnailFieldsInNodesAndHistory(updates);
  await sleep(REFRESH_APPLY_BATCH_DELAY_MS);
  return [];
}

export function getCanvasThumbnailRefreshProgress(): CanvasThumbnailRefreshProgress {
  return currentProgress;
}

export function subscribeCanvasThumbnailRefreshProgress(
  listener: (progress: CanvasThumbnailRefreshProgress) => void,
): () => void {
  progressListeners.add(listener);
  listener(currentProgress);
  return () => {
    progressListeners.delete(listener);
  };
}

export async function startCanvasThumbnailRefresh({
  projectId,
  thumbnailMaxDimension,
  onProgress,
}: StartCanvasThumbnailRefreshOptions): Promise<CanvasThumbnailRefreshProgress> {
  const refreshToken = Symbol("canvas-thumbnail-refresh");
  activeRefreshToken = refreshToken;

  const targets = collectCurrentCanvasThumbnailTargets();
  updateProgress(
    {
      projectId,
      thumbnailMaxDimension,
      total: targets.length,
      completed: 0,
      failed: 0,
      status: targets.length > 0 ? "running" : "completed",
    },
    onProgress,
  );

  if (targets.length === 0) {
    return currentProgress;
  }

  let pendingUpdates: CanvasThumbnailUpdate[] = [];
  try {
    for (const target of targets) {
      if (activeRefreshToken !== refreshToken) {
        break;
      }

      try {
        const thumbnailUrl = await createNodeOverviewThumbnail(
          target.source,
          createCurrentProjectMediaContext("image"),
          thumbnailMaxDimension,
        );
        if (activeRefreshToken !== refreshToken) {
          break;
        }
        pendingUpdates.push({
          nodeId: target.nodeId,
          path: target.path,
          source: target.source,
          thumbnailUrl,
          thumbnailMaxDimension,
        });
        if (pendingUpdates.length >= REFRESH_APPLY_BATCH_SIZE) {
          pendingUpdates = await flushUpdates(pendingUpdates);
        }
        if (activeRefreshToken !== refreshToken) {
          break;
        }
        updateProgress({ completed: currentProgress.completed + 1 }, onProgress);
      } catch (error) {
        if (activeRefreshToken !== refreshToken) {
          break;
        }
        console.debug("[thumbnailRefresh] failed to create thumbnail", {
          source: target.source,
          error,
        });
        updateProgress(
          {
            completed: currentProgress.completed + 1,
            failed: currentProgress.failed + 1,
          },
          onProgress,
        );
      }
    }

    if (activeRefreshToken !== refreshToken) {
      return currentProgress;
    }
    pendingUpdates = await flushUpdates(pendingUpdates);
    if (activeRefreshToken !== refreshToken) {
      return currentProgress;
    }
    const status =
      currentProgress.failed >= currentProgress.total
        ? "failed"
        : "completed";
    updateProgress({ status }, onProgress);
    return currentProgress;
  } catch (error) {
    console.error("[thumbnailRefresh] failed to refresh thumbnails", error);
    updateProgress({ status: "failed" }, onProgress);
    return currentProgress;
  } finally {
    if (activeRefreshToken === refreshToken) {
      activeRefreshToken = null;
    }
  }
}
