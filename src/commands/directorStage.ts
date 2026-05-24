import { invoke } from '@tauri-apps/api/core';

import type { MediaPersistContext } from './media';

export interface TranscodeDirectorStageRecordingPayload {
  webmBytes: Uint8Array;
  outputPath: string;
  outputFileName?: string | null;
  mediaContext?: MediaPersistContext;
}

export interface TranscodeDirectorStageRecordingResult {
  videoUrl: string;
  outputPath: string;
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
        outputPath: payload.outputPath,
        outputFileName: payload.outputFileName?.trim() || null,
      },
      mediaContext: payload.mediaContext ?? null,
    }
  );
}

