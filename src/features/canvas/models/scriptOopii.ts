import {
  SCRIPT_COMPATIBLE_API_FORMAT,
  type ScriptCompatibleExtraParamsPayload,
} from './scriptCompatible';

export const SCRIPT_OOPII_PROVIDER_ID = 'oopii';
export const SCRIPT_OOPII_BASE_URL = 'https://www.oopii.cn/';
export const DEFAULT_OOPII_TEXT_MODEL = 'gpt-5.4';

export function toScriptOopiiExtraParamsPayload(
  requestModel: string,
  displayName?: string
): ScriptCompatibleExtraParamsPayload {
  const normalizedModel = requestModel.trim();

  return {
    compatible_config: {
      api_format: SCRIPT_COMPATIBLE_API_FORMAT,
      endpoint_url: SCRIPT_OOPII_BASE_URL,
      request_model: normalizedModel,
      display_name: (displayName ?? normalizedModel).trim() || normalizedModel,
    },
  };
}
