import type {
  JimengAspectRatio,
  JimengDurationSeconds,
  JimengReferenceMode,
  JimengVideoModelId,
  JimengVideoResolution,
} from "@/features/canvas/domain/canvasNodes";

export const JIMENG_VIDEO_QUEUE_MAX_ACTIVE_JOBS = 1;
export const JIMENG_VIDEO_QUEUE_MAX_ATTEMPTS = 3;
export const JIMENG_VIDEO_QUEUE_RETRY_DELAY_MS = 15_000;
export const JIMENG_VIDEO_QUEUE_CONCURRENCY_BACKOFF_MAX_MS = 5 * 60 * 1_000;
export const JIMENG_VIDEO_QUEUE_POLL_INTERVAL_MS = 2_500;
export const JIMENG_VIDEO_QUEUE_ATTEMPT_TIMEOUT_MS = 10 * 60 * 1_000;

export type JimengVideoQueueJobStatus =
  | "waiting"
  | "waitingConcurrency"
  | "submitting"
  | "submitted"
  | "generating"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export interface JimengVideoQueuePayload {
  prompt: string;
  modelVersion?: JimengVideoModelId | null;
  referenceMode?: JimengReferenceMode | null;
  aspectRatio?: JimengAspectRatio | null;
  durationSeconds?: JimengDurationSeconds | number | null;
  videoResolution?: JimengVideoResolution | null;
  referenceImageSources: string[];
  referenceVideoSources: string[];
  referenceAudioSources: string[];
}

export interface JimengVideoQueueJob {
  jobId: string;
  projectId: string;
  sourceNodeId: string;
  resultNodeId: string;
  title: string;
  status: JimengVideoQueueJobStatus;
  scheduledAt: number | null;
  submitId: string | null;
  payload: JimengVideoQueuePayload;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  warnings: string[];
  startedAt: number | null;
  nextRetryAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function isJimengVideoQueueTerminalStatus(
  status: JimengVideoQueueJobStatus,
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function isJimengVideoQueueActiveStatus(
  status: JimengVideoQueueJobStatus,
): boolean {
  return (
    status === "submitting" ||
    status === "submitted" ||
    status === "generating"
  );
}

export function canJimengVideoQueueJobBeRescheduled(
  status: JimengVideoQueueJobStatus,
): boolean {
  return (
    status === "waiting" ||
    status === "waitingConcurrency" ||
    status === "retrying" ||
    status === "failed"
  );
}

export function isJimengVideoQueueServerConcurrencyMessage(
  message: string | null | undefined,
): boolean {
  const normalized = message?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("exceedconcurrencylimit") ||
    normalized.includes("ret=1310") ||
    normalized.includes("concurrency limit") ||
    normalized.includes("concurrent limit")
  );
}
