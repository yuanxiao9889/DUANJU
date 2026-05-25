import { invoke } from '@tauri-apps/api/core';

import type { MediaPersistContext } from './media';

export interface TranscodeDirectorStageRecordingPayload {
  webmBytes: Uint8Array;
  outputPath?: string | null;
  outputFileName?: string | null;
  targetDurationMs?: number | null;
  mediaContext?: MediaPersistContext;
}

export interface TranscodeDirectorStageRecordingResult {
  videoUrl: string;
  outputPath: string | null;
  outputFileName: string;
}

export async function transcodeDirectorStageRecordingToMp4(
  payload: TranscodeDirectorStageRecordingPayload
): Promise<TranscodeDirectorStageRecordingResult> {
  return await invoke<TranscodeDirectorStageRecordingResult>(
    'transcode_director_stage_recording_to_mp4',
    {
      payload: {
        webmBytes: Array.from(payload.webmBytes),
        outputPath: payload.outputPath?.trim() || null,
        outputFileName: payload.outputFileName?.trim() || null,
        targetDurationMs: Number.isFinite(payload.targetDurationMs)
          ? Math.max(1, Math.round(payload.targetDurationMs ?? 0))
          : null,
      },
      mediaContext: payload.mediaContext ?? null,
    }
  );
}
