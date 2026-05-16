import {
  SCRIPT_COMPATIBLE_API_FORMAT,
  type ScriptCompatibleExtraParamsPayload,
} from './scriptCompatible';

export const SCRIPT_OOPII_PROVIDER_ID = 'oopii';
export const SCRIPT_OOPII_BASE_URL = 'https://www.oopii.cc/';
export const DEFAULT_OOPII_TEXT_MODEL = 'all-5.4';
export const OOPII_TEXT_MODEL_OPTIONS = ['all-5.4', 'all-5.5'] as const;

const OOPII_TEXT_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.4': 'all-5.4',
  'gpt-5.5': 'all-5.5',
};

export function normalizeScriptOopiiModel(requestModel: string): string {
  const trimmed = requestModel.trim();
  if (!trimmed) {
    return '';
  }

  return OOPII_TEXT_MODEL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function toScriptOopiiExtraParamsPayload(
  requestModel: string,
  displayName?: string
): ScriptCompatibleExtraParamsPayload {
  const normalizedModel = normalizeScriptOopiiModel(requestModel);

  return {
    compatible_config: {
      api_format: SCRIPT_COMPATIBLE_API_FORMAT,
      endpoint_url: SCRIPT_OOPII_BASE_URL,
      request_model: normalizedModel,
      display_name:
        normalizeScriptOopiiModel(displayName ?? normalizedModel) || normalizedModel,
    },
  };
}
