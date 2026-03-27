import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  resolveConfiguredScriptModel,
  resolveConfiguredScriptProvider,
} from '@/features/canvas/models';
import { useSettingsStore } from '@/stores/settingsStore';

export interface TextGenerationRequest {
  prompt: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  referenceImages?: string[];
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
  const provider = resolveConfiguredScriptProvider(settings, request.provider);

  if (request.model && request.model.trim()) {
    return { provider, model: request.model.trim() };
  }

  return {
    provider,
    model: resolveConfiguredScriptModel(provider, settings),
  };
}

export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
  const settings = useSettingsStore.getState();
  const { provider, model } = resolveProviderAndModel(request);
  const apiKey = (settings.apiKeys[provider] || '').trim();
  const referenceImages = Array.isArray(request.referenceImages)
    ? request.referenceImages
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    : [];
  
  console.info('[AI] generate_text request', {
    promptLength: request.prompt.length,
    provider,
    model,
    hasApiKey: !!apiKey,
    referenceImageCount: referenceImages.length,
    tauri: isTauri(),
    settingsScriptProvider: settings.scriptProviderEnabled,
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  if (!apiKey) {
    throw new Error(`Please configure the API key for ${provider} in Settings first.`);
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
        reference_images: referenceImages.length > 0 ? referenceImages : undefined,
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

export interface SummaryExpandRequest {
  summary: string;
  chapterTitle: string;
  chapterNumber?: number;
  instruction?: string;
  model?: string;
}

export async function expandFromSummary(request: SummaryExpandRequest): Promise<string> {
  const prompt = `你是一位专业的剧本编剧助手。请根据以下章节摘要，扩写成完整的剧本内容。

章节标题：${request.chapterTitle}
${request.chapterNumber ? `章节序号：第${request.chapterNumber}章` : ''}

章节摘要：
${request.summary}

${request.instruction ? `扩写要求：${request.instruction}` : ''}

请按照以下 Markdown 格式输出剧本内容：

## 场景X：地点 - 时间 - 内/外景

场景描述文字...

---

**角色名**：（动作/表情）对白内容

**角色名**：对白内容

---

## 场景Y：...

格式说明：
- 使用 ## 标记场景标题
- 使用 --- 分隔不同场景
- 使用 **角色名**： 标记对白
- 使用（）标记动作或表情说明
- 场景描述使用普通段落
- 每个段落之间用空行分隔

请直接输出 Markdown 格式的剧本内容，不要添加任何解释。`;

  const result = await generateText({
    prompt,
    model: request.model,
    temperature: 0.8,
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

export interface BranchGenerationRequest {
  chapterContent: string;
  chapterTitle: string;
  chapterNumber: number;
  branchCount: number;
  storyContext?: string;
}

export interface GeneratedBranch {
  title: string;
  summary: string;
  condition: string;
  conditionType: 'choice' | 'random' | 'condition';
  content: string;
}

export async function generateBranches(request: BranchGenerationRequest): Promise<GeneratedBranch[]> {
  const prompt = `你是一位专业的剧本编剧助手。请根据以下章节内容，生成 ${request.branchCount} 个不同的剧情分支走向。

当前章节：第${request.chapterNumber}章 ${request.chapterTitle}

章节内容/摘要：
${request.chapterContent}

${request.storyContext ? `故事背景：${request.storyContext}` : ''}

请生成 ${request.branchCount} 个不同的剧情走向，每个分支应该：
1. 有一个吸引人的标题（简短有力）
2. 有 50-100 字的摘要描述剧情发展
3. 有一个触发条件（如"选择A"、"如果..."、"随机触发"等）
4. 有 200-400 字的剧本内容（使用 Markdown 格式）

剧本内容格式要求：
## 场景X：地点 - 时间 - 内/外景

场景描述文字...

---

**角色名**：（动作/表情）对白内容

---

以 JSON 数组格式输出，不要添加任何解释：
[
  {
    "title": "分支标题",
    "summary": "分支摘要描述...",
    "condition": "触发条件描述",
    "conditionType": "choice",
    "content": "## 场景一：...\\n\\n场景描述...\\n\\n---\\n\\n**角色**：对白..."
  }
]

conditionType 说明：
- choice: 玩家/读者主动选择
- random: 随机触发
- condition: 特定条件满足时触发`;

  const result = await generateText({
    prompt,
    temperature: 0.9,
    maxTokens: 4096,
  });

  try {
    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const branches = JSON.parse(jsonMatch[0]) as GeneratedBranch[];
      return branches.map(branch => ({
        ...branch,
        conditionType: branch.conditionType || 'choice',
        content: branch.content || '',
      }));
    }
  } catch (e) {
    console.error('[AI] Failed to parse branches result', e);
  }

  return [];
}

export interface MergedBranchContent {
  title: string;
  content: string;
  summary: string;
  branchIndex?: number;
  chapterNumber?: number;
  branchLabel?: string;
}

export interface MergedExpandRequest {
  chapterTitle: string;
  chapterNumber?: number;
  summary: string;
  mergedBranches: MergedBranchContent[];
  instruction?: string;
}

export async function expandFromMergedBranches(request: MergedExpandRequest): Promise<string> {
  const branchesText = request.mergedBranches.map((b, i) => `
【分支${String.fromCharCode(65 + i)}：${b.title}】
${b.content || b.summary}
`).join('\n');

  const prompt = `你是一位专业的剧本编剧助手。请根据以下内容，生成融合后的章节内容。

章节标题：${request.chapterTitle}
${request.chapterNumber ? `章节序号：第${request.chapterNumber}章` : ''}

章节摘要：
${request.summary}

以下是合并到此章节的多个分支剧情，请综合考虑这些内容进行创作：
${branchesText}

${request.instruction ? `创作要求：${request.instruction}` : ''}

请创作一个融合了多个分支走向的章节内容，要求：
1. 保持剧情的连贯性和合理性
2. 可以选择性地融合各分支的精彩元素
3. 或者选择其中一个分支作为主线继续发展
4. 如果分支内容有冲突，选择最合理的走向

请按照以下 Markdown 格式输出剧本内容：

## 场景X：地点 - 时间 - 内/外景

场景描述文字...

---

**角色名**：（动作/表情）对白内容

**角色名**：对白内容

---

## 场景Y：...

格式说明：
- 使用 ## 标记场景标题
- 使用 --- 分隔不同场景
- 使用 **角色名**： 标记对白
- 使用（）标记动作或表情说明
- 场景描述使用普通段落
- 每个段落之间用空行分隔

请直接输出 Markdown 格式的剧本内容，不要添加任何解释。`;

  const result = await generateText({
    prompt,
    temperature: 0.8,
    maxTokens: 4096,
  });

  return result.text;
}
