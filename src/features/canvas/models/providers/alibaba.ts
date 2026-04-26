import type { ModelProviderDefinition } from '../types';

export const ALIBABA_TEXT_MODEL_OPTIONS = [
  { value: 'qwen-turbo', label: 'Qwen Turbo (快速)' },
  { value: 'qwen-plus', label: 'Qwen Plus (平衡)' },
  { value: 'qwen-max', label: 'Qwen Max (最强)' },
  { value: 'qwen2.5-7b-instruct', label: 'Qwen2.5 7B' },
  { value: 'qwen2.5-14b-instruct', label: 'Qwen2.5 14B' },
  { value: 'qwen2.5-72b-instruct', label: 'Qwen2.5 72B' },
] as const;

export const DEFAULT_ALIBABA_TEXT_MODEL = 'qwen-plus';

export const provider: ModelProviderDefinition = {
  id: 'alibaba',
  name: 'Alibaba Cloud',
  label: '阿里云百炼',
};
