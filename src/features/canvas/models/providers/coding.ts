import type { ModelProviderDefinition } from '../types';

export const CODING_MODEL_OPTIONS = [
  { value: 'qwen3.5-plus', label: 'Qwen3.5 Plus (千问)' },
  { value: 'qwen3-max-2026-01-23', label: 'Qwen3 Max (千问)' },
  { value: 'qwen3-coder-next', label: 'Qwen3 Coder Next' },
  { value: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
  { value: 'glm-5', label: 'GLM-5 (智谱)' },
  { value: 'glm-4.7', label: 'GLM-4.7 (智谱)' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5 (月之暗面)' },
  { value: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
  { value: 'custom', label: 'Custom Endpoint (ep-xxx)' },
] as const;

export const DEFAULT_CODING_MODEL = 'qwen3.5-plus';

export const provider: ModelProviderDefinition = {
  id: 'coding',
  name: 'Alibaba Cloud Coding',
  label: '阿里云 Coding Plan',
};
