import type {
  MjBatchImageItem,
  MjResultBatch,
} from '@/features/canvas/domain/canvasNodes';
import type { MidjourneyProviderId } from '@/features/midjourney/domain/providers';

export type MidjourneyTaskPhase =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface MidjourneyTaskSnapshot {
  id: string;
  status: string;
  progress: string;
  imageUrl?: string | null;
  prompt?: string | null;
  promptEn?: string | null;
  finalPrompt?: string | null;
  failReason?: string | null;
  submitTime?: number | null;
  startTime?: number | null;
  finishTime?: number | null;
}

export function normalizeMidjourneyTaskPhase(
  status: string | null | undefined
): MidjourneyTaskPhase {
  const normalized = status?.trim().toUpperCase() ?? '';

  switch (normalized) {
    case 'NOT_START':
    case 'SUBMITTED':
      return 'queued';
    case 'IN_PROGRESS':
    case 'RUNNING':
      return 'running';
    case 'SUCCESS':
      return 'succeeded';
    case 'FAILURE':
      return 'failed';
    case 'CANCEL':
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

export function isMidjourneyTaskTerminal(status: string | null | undefined): boolean {
  const phase = normalizeMidjourneyTaskPhase(status);
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
}

export function createPendingMjBatch(payload: {
  id: string;
  taskId: string;
  providerId: MidjourneyProviderId;
  prompt: string;
  finalPrompt: string;
  submitTime: number;
}): MjResultBatch {
  return {
    id: payload.id,
    taskId: payload.taskId,
    providerId: payload.providerId,
    status: 'SUBMITTED',
    progress: '',
    prompt: payload.prompt,
    promptEn: null,
    finalPrompt: payload.finalPrompt,
    images: [],
    submitTime: payload.submitTime,
    startTime: null,
    finishTime: null,
    failReason: null,
    isPolling: true,
  };
}

export function updateMjBatchFromTask(
  batch: MjResultBatch,
  task: MidjourneyTaskSnapshot,
  images?: MjBatchImageItem[]
): MjResultBatch {
  const phase = normalizeMidjourneyTaskPhase(task.status);
  return {
    ...batch,
    taskId: task.id,
    status: task.status,
    progress: task.progress?.trim() ?? '',
    prompt: task.prompt?.trim() || batch.prompt,
    promptEn: task.promptEn?.trim() || batch.promptEn || null,
    finalPrompt: task.finalPrompt?.trim() || batch.finalPrompt || null,
    images: images ?? batch.images,
    submitTime: task.submitTime ?? batch.submitTime ?? null,
    startTime: task.startTime ?? batch.startTime ?? null,
    finishTime: task.finishTime ?? batch.finishTime ?? null,
    failReason: task.failReason?.trim() || null,
    isPolling: phase === 'queued' || phase === 'running',
  };
}
