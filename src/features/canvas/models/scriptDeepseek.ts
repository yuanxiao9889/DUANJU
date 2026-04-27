import {
  SCRIPT_COMPATIBLE_API_FORMAT,
  type ScriptCompatibleExtraParamsPayload,
} from './scriptCompatible';

export const SCRIPT_DEEPSEEK_PROVIDER_ID = 'deepseek';
export const SCRIPT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_TEXT_MODEL = 'deepseek-v4-flash';
export const DEEPSEEK_PRO_TEXT_MODEL = 'deepseek-v4-pro';

export function toScriptDeepseekExtraParamsPayload(
  requestModel: string,
  displayName?: string
): ScriptCompatibleExtraParamsPayload {
  const normalizedModel = requestModel.trim();

  return {
    compatible_config: {
      api_format: SCRIPT_COMPATIBLE_API_FORMAT,
      endpoint_url: SCRIPT_DEEPSEEK_BASE_URL,
      request_model: normalizedModel,
      display_name: (displayName ?? normalizedModel).trim() || normalizedModel,
    },
  };
}
