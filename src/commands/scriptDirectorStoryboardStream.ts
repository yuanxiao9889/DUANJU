import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  isScriptCompatibleProviderConfigured,
  SCRIPT_COMPATIBLE_PROVIDER_ID,
  SCRIPT_DEEPSEEK_PROVIDER_ID,
  SCRIPT_OOPII_PROVIDER_ID,
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
  toScriptCompatibleExtraParamsPayload,
  toScriptDeepseekExtraParamsPayload,
  toScriptOopiiExtraParamsPayload,
} from '@/features/canvas/models';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useSettingsStore } from '@/stores/settingsStore';

const NO_ACTIVE_SCRIPT_MODEL_MESSAGE = '请先在设置中激活一个剧本模型后再使用。';
const NO_ACTIVE_SCRIPT_PROVIDER_MODEL_MESSAGE =
  '请先为当前已激活的剧本供应商选择一个模型后再使用。';

export const SCRIPT_DIRECTOR_STORYBOARD_STREAM_EVENT =
  'script-director-storyboard-stream';

export interface StartScriptDirectorStoryboardStreamInput {
  requestId: string;
  content: string;
  batchLabel?: string;
}

export interface StartScriptDirectorStoryboardStreamResponse {
  requestId: string;
}

export interface ScriptDirectorStoryboardStreamOutlineRowPayload {
  rowId: string;
  seq: number;
  sceneNumber: string;
  shotNumber: string;
  sketch: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  blockingAction: string;
  dialogueOrSound: string;
  durationSeconds: number;
  characterIds: string[];
  sceneId: string;
  itemIds: string[];
  mood: string;
  remark: string;
  assetRefs: string[];
}

export interface ScriptDirectorStoryboardStreamRowCompletedPayload {
  rowId: string;
  imagePrompt: string;
  referenceAssetHints: string[];
}

export type ScriptDirectorStoryboardStreamEvent =
  | {
      type: 'stream_started';
      requestId: string;
      message: string;
    }
  | {
      type: 'outline_row_created';
      requestId: string;
      row: ScriptDirectorStoryboardStreamOutlineRowPayload;
      totalRows: number;
    }
  | {
      type: 'row_generation_started';
      requestId: string;
      rowId: string;
      index: number;
      totalRows: number;
      message: string;
    }
  | {
      type: 'row_generation_completed';
      requestId: string;
      row: ScriptDirectorStoryboardStreamRowCompletedPayload;
      generatedRowCount: number;
      totalRows: number;
      message: string;
    }
  | {
      type: 'summary_updated';
      requestId: string;
      rowCount: number;
      generatedRowCount: number;
      totalDurationSeconds: number;
      continuousGroupCount: number;
      groups10sCount: number;
      groups15sCount: number;
      message: string;
    }
  | {
      type: 'stream_completed';
      requestId: string;
      rowCount: number;
      generatedAt: number;
      message: string;
    }
  | {
      type: 'stream_failed';
      requestId: string;
      message: string;
      rowId?: string | null;
    }
  | {
      type: 'stream_cancelled';
      requestId: string;
      message: string;
    };

function openProviderSettingsAndThrow(message: string): never {
  openSettingsDialog({ category: 'providers' });
  throw new Error(message);
}

function resolveProviderAndModel(): { provider: string; model: string } {
  const settings = useSettingsStore.getState();
  const provider = resolveActivatedScriptProvider(settings);
  if (!provider) {
    return openProviderSettingsAndThrow(NO_ACTIVE_SCRIPT_MODEL_MESSAGE);
  }

  const model = resolveConfiguredScriptModel(provider, settings).trim();
  if (!model) {
    return openProviderSettingsAndThrow(NO_ACTIVE_SCRIPT_PROVIDER_MODEL_MESSAGE);
  }

  return { provider, model };
}

function resolveTextGenerationExtraParams(
  provider: string,
  model: string
): Record<string, unknown> | undefined {
  if (provider === SCRIPT_OOPII_PROVIDER_ID) {
    return toScriptOopiiExtraParamsPayload(model, model) as unknown as Record<string, unknown>;
  }

  if (provider === SCRIPT_DEEPSEEK_PROVIDER_ID) {
    return toScriptDeepseekExtraParamsPayload(model, model) as unknown as Record<string, unknown>;
  }

  if (provider !== SCRIPT_COMPATIBLE_PROVIDER_ID) {
    return undefined;
  }

  const settings = useSettingsStore.getState();
  if (!isScriptCompatibleProviderConfigured(settings.scriptCompatibleProviderConfig)) {
    return undefined;
  }

  return toScriptCompatibleExtraParamsPayload(
    settings.scriptCompatibleProviderConfig,
    model,
    model
  ) as unknown as Record<string, unknown>;
}

export async function startScriptDirectorStoryboardStream(
  input: StartScriptDirectorStoryboardStreamInput
): Promise<StartScriptDirectorStoryboardStreamResponse> {
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 环境，请使用 `npm run tauri dev` 启动应用。');
  }

  const settings = useSettingsStore.getState();
  const { provider, model } = resolveProviderAndModel();
  const apiKey = (settings.scriptApiKeys[provider] || '').trim();
  if (!apiKey) {
    return openProviderSettingsAndThrow(
      `Please configure the API key for ${provider} in Settings first.`
    );
  }

  const extraParams = resolveTextGenerationExtraParams(provider, model);
  return invoke<StartScriptDirectorStoryboardStreamResponse>(
    'start_script_director_storyboard_stream',
    {
      request: {
        content: input.content,
        request_id: input.requestId,
        batch_label: input.batchLabel || null,
        model,
        provider,
        api_key: apiKey,
        temperature: 0.18,
        max_tokens: 4096,
        extra_params: extraParams,
      },
    }
  );
}

export async function cancelScriptDirectorStoryboardStream(
  requestId: string
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke('cancel_script_director_storyboard_stream', { requestId });
}

export async function listenScriptDirectorStoryboardStream(
  handler: (event: ScriptDirectorStoryboardStreamEvent) => void
): Promise<UnlistenFn> {
  return listen<ScriptDirectorStoryboardStreamEvent>(
    SCRIPT_DIRECTOR_STORYBOARD_STREAM_EVENT,
    (event) => {
      if (event.payload) {
        handler(event.payload);
      }
    }
  );
}
