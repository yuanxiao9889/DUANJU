import type { AudioNodeData } from '@/features/canvas/domain/canvasNodes';
import type { GeneratedQwenTtsAudioAsset } from '@/features/extensions/application/extensionRuntime';
import { resolveErrorContent } from '@/features/canvas/application/errorDialog';
import i18n from '@/i18n';
import { useCanvasStore } from '@/stores/canvasStore';

interface QwenTtsAudioQueueJob {
  audioNodeId: string;
  sourceNodeId: string;
  run: () => Promise<GeneratedQwenTtsAudioAsset>;
}

const PROGRESS_PREPARING_VALUE = 12;
const PROGRESS_RENDERING_START_VALUE = 28;
const PROGRESS_RENDERING_MAX_VALUE = 82;
const PROGRESS_TICK_MS = 900;
const PROGRESS_STEP = 6;
const PREPARING_DELAY_MS = 320;

let activeJob: QwenTtsAudioQueueJob | null = null;
const pendingJobs: QwenTtsAudioQueueJob[] = [];
let progressTimerId: number | null = null;
let progressStageTimerId: number | null = null;

function resolveErrorMessage(error: unknown): string {
  return resolveErrorContent(error, i18n.t('node.qwenTts.generateFailed')).message;
}

function nodeExists(nodeId: string): boolean {
  return useCanvasStore.getState().nodes.some((node) => node.id === nodeId);
}

function updateAudioNodeState(nodeId: string, patch: Partial<AudioNodeData>): void {
  useCanvasStore.getState().updateNodeData(nodeId, patch, { historyMode: 'skip' });
}

function updateSourceNodeState(nodeId: string, patch: Record<string, unknown>): void {
  useCanvasStore.getState().updateNodeData(nodeId, patch, { historyMode: 'skip' });
}

function clearProgressTimers(): void {
  if (progressTimerId !== null) {
    window.clearInterval(progressTimerId);
    progressTimerId = null;
  }

  if (progressStageTimerId !== null) {
    window.clearTimeout(progressStageTimerId);
    progressStageTimerId = null;
  }
}

function syncQueuedNodeStates(): void {
  pendingJobs.forEach((job, index) => {
    if (!nodeExists(job.audioNodeId)) {
      return;
    }

    const tasksAhead = index + (activeJob ? 1 : 0);
    const statusText =
      tasksAhead > 0
        ? i18n.t('node.audioNode.queueWaiting', { count: tasksAhead })
        : i18n.t('node.audioNode.queueStarting');

    updateAudioNodeState(job.audioNodeId, {
      isGenerating: false,
      generationProgress: 0,
      queuePosition: tasksAhead,
      statusText,
      lastError: null,
    });
  });
}

function startRunningProgress(audioNodeId: string): void {
  clearProgressTimers();

  updateAudioNodeState(audioNodeId, {
    isGenerating: true,
    generationProgress: PROGRESS_PREPARING_VALUE,
    queuePosition: null,
    statusText: i18n.t('node.qwenTts.statusPreparing'),
    lastError: null,
  });

  progressStageTimerId = window.setTimeout(() => {
    if (!nodeExists(audioNodeId)) {
      return;
    }

    updateAudioNodeState(audioNodeId, {
      generationProgress: PROGRESS_RENDERING_START_VALUE,
      statusText: i18n.t('node.qwenTts.statusRendering'),
    });
  }, PREPARING_DELAY_MS);

  progressTimerId = window.setInterval(() => {
    const audioNode = useCanvasStore.getState().nodes.find((node) => node.id === audioNodeId);
    if (!audioNode) {
      clearProgressTimers();
      return;
    }

    const audioData = audioNode.data as AudioNodeData;
    if (!audioData.isGenerating || audioData.audioUrl) {
      clearProgressTimers();
      return;
    }

    const currentValue =
      typeof audioData.generationProgress === 'number' ? audioData.generationProgress : 0;
    const nextValue = Math.min(PROGRESS_RENDERING_MAX_VALUE, currentValue + PROGRESS_STEP);

    if (nextValue !== currentValue) {
      updateAudioNodeState(audioNodeId, {
        generationProgress: nextValue,
        statusText: i18n.t('node.qwenTts.statusRendering'),
      });
    }
  }, PROGRESS_TICK_MS);
}

async function processNextJob(): Promise<void> {
  if (activeJob) {
    return;
  }

  while (pendingJobs.length > 0) {
    const nextJob = pendingJobs.shift() ?? null;
    if (!nextJob) {
      return;
    }

    if (!nodeExists(nextJob.audioNodeId)) {
      continue;
    }

    activeJob = nextJob;
    syncQueuedNodeStates();
    startRunningProgress(nextJob.audioNodeId);

    try {
      const generatedAudio = await nextJob.run();
      const completedAt = Date.now();

      clearProgressTimers();

      if (nodeExists(nextJob.audioNodeId)) {
        updateAudioNodeState(nextJob.audioNodeId, {
          audioUrl: generatedAudio.audioUrl,
          previewImageUrl: generatedAudio.previewImageUrl,
          audioFileName: generatedAudio.audioFileName,
          duration: generatedAudio.duration,
          mimeType: generatedAudio.mimeType,
          isGenerating: false,
          generationProgress: 100,
          queuePosition: null,
          statusText: null,
          lastError: null,
          lastGeneratedAt: completedAt,
        });
      }

      if (nodeExists(nextJob.sourceNodeId)) {
        updateSourceNodeState(nextJob.sourceNodeId, {
          lastGeneratedAt: completedAt,
          lastError: null,
          statusText: null,
        });
      }
    } catch (error) {
      const errorMessage = resolveErrorMessage(error);
      clearProgressTimers();

      if (nodeExists(nextJob.audioNodeId)) {
        updateAudioNodeState(nextJob.audioNodeId, {
          isGenerating: false,
          generationProgress: 0,
          queuePosition: null,
          statusText: errorMessage,
          lastError: errorMessage,
        });
      }

      if (nodeExists(nextJob.sourceNodeId)) {
        updateSourceNodeState(nextJob.sourceNodeId, {
          lastError: errorMessage,
          statusText: null,
        });
      }
    } finally {
      activeJob = null;
      syncQueuedNodeStates();
    }
  }
}

export function enqueueQwenTtsAudioGeneration(job: QwenTtsAudioQueueJob): void {
  pendingJobs.push(job);
  syncQueuedNodeStates();
  void processNextJob();
}
