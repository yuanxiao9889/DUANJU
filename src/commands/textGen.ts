import { invoke, isTauri } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/stores/settingsStore';

export interface TextGenerationRequest {
  prompt: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TextGenerationResponse {
  text: string;
  model: string;
}

export interface ScriptExpandRequest {
  content: string;
  instruction: string;
  style?: string;
  model?: string;
}

export interface ScriptRewriteRequest {
  content: string;
  requirement: string;
  model?: string;
}

function resolveProviderAndModel(request: TextGenerationRequest): { provider: string; model: string } {
  const settings = useSettingsStore.getState();
  
  // 优先使用请求指定的 provider，其次是设置中的 scriptProviderEnabled，最后兜底 alibaba
  const candidateProvider = request.provider || settings.scriptProviderEnabled || 'alibaba';
  
  // 确保 provider 是合法的（目前主要支持 alibaba 和 coding）
  // 注意：如果未来支持更多，这里需要更新
  const provider =
    candidateProvider === 'alibaba' || candidateProvider === 'coding'
      ? candidateProvider
      : 'alibaba';

  if (request.model && request.model.trim()) {
    return { provider, model: request.model.trim() };
  }

  if (provider === 'coding') {
    return {
      provider,
      model: settings.codingModel || 'qwen3.5-plus',
    };
  }

  return {
    provider,
    model: settings.alibabaTextModel || 'qwen-plus',
  };
}

export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
  const settings = useSettingsStore.getState();
  const { provider, model } = resolveProviderAndModel(request);
  const apiKey = (settings.apiKeys[provider] || '').trim();
  
  console.info('[AI] generate_text request', {
    promptLength: request.prompt.length,
    provider,
    model,
    hasApiKey: !!apiKey,
    tauri: isTauri(),
    settingsScriptProvider: settings.scriptProviderEnabled,
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  if (!apiKey) {
    throw new Error(`请先在设置中配置${provider === 'alibaba' ? '阿里云百炼' : provider === 'coding' ? 'Coding Plan' : provider}的API Key`);
  }

  if (provider === 'coding' && !apiKey.startsWith('sk-sp-')) {
    // 只是一个警告，不强制阻断，因为也许格式变了
    console.warn('[AI] Coding Plan key might be invalid format (expected sk-sp-...)');
  }

  try {
    const result = await invoke<{ text: string; model: string }>('generate_text', {
      request: {
        prompt: request.prompt,
        model,
        provider,
        api_key: apiKey,
        temperature: request.temperature || 0.7,
        max_tokens: request.maxTokens || 2048,
      },
    });

    console.info('[AI] generate_text success', {
      textLength: result.text.length,
      model: result.model,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : (() => {
              try {
                return JSON.stringify(error);
              } catch {
                return '生成失败，请重试';
              }
            })();
    console.error('[AI] generate_text failed', { error, request, message });
    throw new Error(message || '生成失败，请重试');
  }
}

export async function expandScript(request: ScriptExpandRequest): Promise<string> {
  const prompt = `你是一位专业的剧本编剧助手。请根据以下内容进行扩写。

原文内容：
${request.content}

扩写要求：
${request.instruction}

${request.style ? `风格要求：${request.style}` : ''}

请直接输出扩写后的内容，不要添加任何解释或额外文本。`;

  const result = await generateText({
    prompt,
    model: request.model,
    temperature: 0.8,
    maxTokens: 4096,
  });

  return result.text;
}

export async function rewriteScript(request: ScriptRewriteRequest): Promise<string> {
  const prompt = `你是一位专业的剧本编剧助手。请根据以下要求改写剧本内容。

原文内容：
${request.content}

改写要求：
${request.requirement}

请直接输出改写后的内容，不要添加任何解释或额外文本。`;

  const result = await generateText({
    prompt,
    model: request.model,
    temperature: 0.7,
    maxTokens: 4096,
  });

  return result.text;
}

export async function analyzeScriptStructure(content: string): Promise<{
  chapters: { title: string; summary: string }[];
  characters: { name: string; description: string }[];
  locations: string[];
}> {
  const prompt = `请分析以下剧本内容，提取结构化信息。以 JSON 格式输出。

剧本内容：
${content}

请按以下 JSON 格式输出（不要添加任何解释）：
{
  "chapters": [{"title": "章节标题", "summary": "章节摘要"}],
  "characters": [{"name": "角色名", "description": "角色描述"}],
  "locations": ["场景1", "场景2"]
}`;

  const result = await generateText({
    prompt,
    model: undefined,
    temperature: 0.3,
    maxTokens: 4096,
  });

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[AI] Failed to parse structure analysis result', e);
  }

  return { chapters: [], characters: [], locations: [] };
}

export interface TestConnectionRequest {
  provider: string;
  apiKey: string;
  model: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
}

export interface ActiveTextModelStatus {
  active: boolean;
  provider?: string;
  model?: string;
  switched_at_ms?: number;
  switch_cost_ms?: number;
}

export async function testProviderConnection(
  request: TestConnectionRequest
): Promise<TestConnectionResponse> {
  console.info('[AI] test_provider_connection request', {
    provider: request.provider,
    model: request.model,
    tauri: isTauri(),
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    const result = await invoke<TestConnectionResponse>('test_provider_connection', {
      request: {
        provider: request.provider,
        api_key: request.apiKey,
        model: request.model,
      },
    });

    console.info('[AI] test_provider_connection result', result);
    return result;
  } catch (error) {
    console.error('[AI] test_provider_connection failed', { error, request });
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getActiveTextModelStatus(): Promise<ActiveTextModelStatus> {
  if (!isTauri()) {
    return { active: false };
  }
  return await invoke<ActiveTextModelStatus>('get_active_text_model_status');
}
