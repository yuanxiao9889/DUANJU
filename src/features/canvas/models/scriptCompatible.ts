export const SCRIPT_COMPATIBLE_PROVIDER_ID = 'compatible';
export const SCRIPT_COMPATIBLE_API_FORMAT = 'openai-chat';

export interface ScriptCompatibleProviderConfig {
  endpointUrl: string;
}

export interface ScriptCompatibleExtraParamsPayload {
  compatible_config: {
    api_format: typeof SCRIPT_COMPATIBLE_API_FORMAT;
    endpoint_url: string;
    request_model: string;
    display_name: string;
  };
}

export function normalizeScriptCompatibleProviderConfig(
  input: Partial<ScriptCompatibleProviderConfig> | null | undefined
): ScriptCompatibleProviderConfig {
  return {
    endpointUrl: (input?.endpointUrl ?? '').trim(),
  };
}

export function isScriptCompatibleProviderConfigured(
  config: ScriptCompatibleProviderConfig | null | undefined
): boolean {
  return Boolean(config && config.endpointUrl.trim());
}

export function toScriptCompatibleExtraParamsPayload(
  config: ScriptCompatibleProviderConfig,
  requestModel: string,
  displayName?: string
): ScriptCompatibleExtraParamsPayload {
  const normalizedConfig = normalizeScriptCompatibleProviderConfig(config);
  const normalizedModel = requestModel.trim();

  return {
    compatible_config: {
      api_format: SCRIPT_COMPATIBLE_API_FORMAT,
      endpoint_url: normalizedConfig.endpointUrl,
      request_model: normalizedModel,
      display_name: (displayName ?? normalizedModel).trim() || normalizedModel,
    },
  };
}
