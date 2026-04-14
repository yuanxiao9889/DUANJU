import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  isScriptCompatibleProviderConfigured,
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
  SCRIPT_COMPATIBLE_PROVIDER_ID,
  toScriptCompatibleExtraParamsPayload,
} from '@/features/canvas/models';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useSettingsStore } from '@/stores/settingsStore';

export interface TextGenerationRequest {
  prompt: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  referenceImages?: string[];
  extraParams?: Record<string, unknown>;
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

export interface StoryboardScriptGenerationRequest {
  content: string;
  maxScripts?: number;
}

export interface GeneratedStoryboardScript {
  title: string;
  summary: string;
  content: string;
  sceneHeading: string;
  characters: string[];
  location: string;
  props: string[];
  visualFocus: string;
  soundCue: string;
}

export interface ExtractedScriptCharacter {
  name: string;
  description: string;
  personality: string;
  appearance: string;
}

export interface ExtractedScriptLocation {
  name: string;
  description: string;
}

export interface ExtractedScriptItem {
  name: string;
  description: string;
}

export interface ExtractedScriptAssets {
  characters: ExtractedScriptCharacter[];
  locations: ExtractedScriptLocation[];
  items: ExtractedScriptItem[];
}

export interface ScriptAssetExtractionRequest {
  content: string;
  batchLabel?: string;
}

const STORYBOARD_SCRIPT_OUTPUT_LIMIT = 6;

const NO_ACTIVE_SCRIPT_MODEL_MESSAGE =
  '\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u6fc0\u6d3b\u4e00\u4e2a\u5267\u672c API \u6a21\u578b\u540e\u518d\u4f7f\u7528';
const NO_ACTIVE_SCRIPT_PROVIDER_MODEL_MESSAGE =
  '\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u4e3a\u5f53\u524d\u5df2\u6fc0\u6d3b\u7684\u5267\u672c API \u9009\u62e9\u6a21\u578b\u540e\u518d\u4f7f\u7528';

function openProviderSettingsAndThrow(message: string): never {
  openSettingsDialog({ category: 'providers' });
  throw new Error(message);
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => normalizeNonEmptyString(item))
          .filter((item) => item.length > 0)
      )
    );
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(/[\n,，、;；]/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );
  }

  return [];
}

function readStringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = normalizeNonEmptyString(record[key]);
    if (value.length > 0) {
      return value;
    }
  }
  return '';
}

function readStringArrayValue(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = normalizeStringArray(record[key]);
    if (value.length > 0) {
      return value;
    }
  }
  return [];
}

function clampStoryboardScriptCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return STORYBOARD_SCRIPT_OUTPUT_LIMIT;
  }

  return Math.max(1, Math.min(STORYBOARD_SCRIPT_OUTPUT_LIMIT, Math.floor(value as number)));
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return codeFenceMatch ? codeFenceMatch[1].trim() : trimmed;
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractJsonValue(text: string): unknown {
  const stripped = stripMarkdownCodeFence(text);
  const directValue = tryParseJson<unknown>(stripped);
  if (directValue !== null) {
    return directValue;
  }

  const objectMatch = stripped.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const objectValue = tryParseJson<unknown>(objectMatch[0]);
    if (objectValue !== null) {
      return objectValue;
    }
  }

  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const arrayValue = tryParseJson<unknown>(arrayMatch[0]);
    if (arrayValue !== null) {
      return arrayValue;
    }
  }

  return null;
}

function normalizeGeneratedStoryboardScript(
  value: unknown,
  index: number
): GeneratedStoryboardScript | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const summary = readStringValue(record, ['summary', 'description', 'logline']);
  const content = readStringValue(record, ['content', 'script', 'draft', 'body']) || summary;

  if (!content) {
    return null;
  }

  return {
    title: readStringValue(record, ['title', 'name', 'sceneTitle']) || `Script ${index + 1}`,
    summary,
    content,
    sceneHeading: readStringValue(record, ['sceneHeading', 'scene_heading', 'heading']),
    characters: readStringArrayValue(record, ['characters', 'characterList', 'roles']),
    location: readStringValue(record, ['location', 'sceneLocation', 'setting']),
    props: readStringArrayValue(record, ['props', 'items', 'objects']),
    visualFocus: readStringValue(record, ['visualFocus', 'visual_focus', 'visual']),
    soundCue: readStringValue(record, ['soundCue', 'sound', 'sfx']),
  };
}

function normalizeExtractedScriptCharacter(value: unknown): ExtractedScriptCharacter | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = readStringValue(record, ['name', 'characterName', 'label']);
  if (!name) {
    return null;
  }

  return {
    name,
    description: readStringValue(record, ['description', 'summary', 'role']),
    personality: readStringValue(record, ['personality', 'temperament', 'traits']),
    appearance: readStringValue(record, ['appearance', 'look', 'visual']),
  };
}

function normalizeExtractedScriptLocation(value: unknown): ExtractedScriptLocation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = readStringValue(record, ['name', 'locationName', 'label']);
  if (!name) {
    return null;
  }

  return {
    name,
    description: readStringValue(record, ['description', 'summary', 'function']),
  };
}

function normalizeExtractedScriptItem(value: unknown): ExtractedScriptItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = readStringValue(record, ['name', 'itemName', 'propName', 'label']);
  if (!name) {
    return null;
  }

  return {
    name,
    description: readStringValue(record, ['description', 'summary', 'function']),
  };
}

function normalizeExtractedScriptAssets(value: unknown): ExtractedScriptAssets {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return {
    characters: (Array.isArray(record.characters) ? record.characters : [])
      .map((item) => normalizeExtractedScriptCharacter(item))
      .filter((item): item is ExtractedScriptCharacter => Boolean(item)),
    locations: (Array.isArray(record.locations) ? record.locations : [])
      .map((item) => normalizeExtractedScriptLocation(item))
      .filter((item): item is ExtractedScriptLocation => Boolean(item)),
    items: (Array.isArray(record.items) ? record.items : [])
      .map((item) => normalizeExtractedScriptItem(item))
      .filter((item): item is ExtractedScriptItem => Boolean(item)),
  };
}

function resolveProviderAndModel(request: TextGenerationRequest): { provider: string; model: string } {
  const settings = useSettingsStore.getState();
  const provider = resolveActivatedScriptProvider(settings);
  if (!provider) {
    return openProviderSettingsAndThrow(NO_ACTIVE_SCRIPT_MODEL_MESSAGE);
  }

  if (request.provider && request.provider.trim() && request.provider.trim() !== provider) {
    console.warn('[AI] ignoring non-active script provider override', {
      requestedProvider: request.provider,
      activeProvider: provider,
    });
  }

  const model = resolveConfiguredScriptModel(provider, settings).trim();
  if (!model) {
    return openProviderSettingsAndThrow(NO_ACTIVE_SCRIPT_PROVIDER_MODEL_MESSAGE);
  }

  if (request.model && request.model.trim() && request.model.trim() !== model) {
    console.warn('[AI] ignoring non-active script model override', {
      requestedModel: request.model,
      activeModel: model,
      provider,
    });
  }

  return { provider, model };
}

function resolveTextGenerationExtraParams(
  provider: string,
  model: string,
  request: TextGenerationRequest
): Record<string, unknown> | undefined {
  if (request.extraParams && Object.keys(request.extraParams).length > 0) {
    return request.extraParams;
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

export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
  const settings = useSettingsStore.getState();
  const { provider, model } = resolveProviderAndModel(request);
  const apiKey = (settings.scriptApiKeys[provider] || '').trim();
  const extraParams = resolveTextGenerationExtraParams(provider, model, request);
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
    return openProviderSettingsAndThrow(
      `Please configure the API key for ${provider} in Settings first.`
    );
  }

  if (!model) {
    return openProviderSettingsAndThrow(
      `Please add and select a model for ${provider} in Settings first.`
    );
  }

  if (
    provider === SCRIPT_COMPATIBLE_PROVIDER_ID
    && !isScriptCompatibleProviderConfigured(settings.scriptCompatibleProviderConfig)
  ) {
    return openProviderSettingsAndThrow(
      'Please configure the custom script API endpoint in Settings first.'
    );
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
        extra_params: extraParams,
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

export async function generateStoryboardScriptsFromText(
  request: StoryboardScriptGenerationRequest
): Promise<GeneratedStoryboardScript[]> {
  const content = request.content.trim();
  if (!content) {
    throw new Error('Please enter script text first.');
  }

  const maxScripts = clampStoryboardScriptCount(request.maxScripts);
  const prompt = [
    'You are a professional storyboard writer.',
    `Break the user input into at most ${maxScripts} sequential storyboard script drafts.`,
    'Each output item must represent one usable script node for downstream processing.',
    'Preserve story order. If the source material is longer than the limit, merge adjacent beats instead of exceeding the count.',
    'Keep the output language consistent with the user input.',
    'Return JSON only. Do not wrap it in Markdown fences. Do not add commentary.',
    '',
    'Return exactly this JSON shape:',
    '{',
    '  "scripts": [',
    '    {',
    '      "title": "short scene title",',
    '      "summary": "1-2 sentence summary",',
    '      "content": "plain text script draft, can contain line breaks",',
    '      "sceneHeading": "optional scene heading",',
    '      "characters": ["name"],',
    '      "location": "optional location",',
    '      "props": ["important prop"],',
    '      "visualFocus": "optional visual focus",',
    '      "soundCue": "optional sound cue"',
    '    }',
    '  ]',
    '}',
    '',
    'Constraints:',
    `- scripts.length must be between 1 and ${maxScripts}`,
    '- content must stay concise, concrete, and production-usable',
    '- Use empty strings or empty arrays for missing optional fields',
    '',
    'User input:',
    content,
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.4,
    maxTokens: 4096,
  });

  const parsed = extractJsonValue(result.text);
  if (!parsed) {
    throw new Error('Failed to parse storyboard script JSON.');
  }

  const rawScripts = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { scripts?: unknown }).scripts)
      ? (parsed as { scripts: unknown[] }).scripts
      : [];

  const scripts = rawScripts
    .map((item, index) => normalizeGeneratedStoryboardScript(item, index))
    .filter((item): item is GeneratedStoryboardScript => Boolean(item))
    .slice(0, maxScripts);

  if (scripts.length === 0) {
    throw new Error('No storyboard scripts were generated.');
  }

  return scripts;
}

export interface SummaryExpandRequest {
  summary: string;
  chapterTitle: string;
  chapterNumber?: number;
  instruction?: string;
  model?: string;
}

export interface SceneEpisodeGenerationRequest {
  chapterNumber?: number;
  chapterTitle?: string;
  chapterSummary?: string;
  sceneTitle: string;
  sceneSummary?: string;
  purpose?: string;
  povCharacter?: string;
  goal?: string;
  conflict?: string;
  turn?: string;
  emotionalShift?: string;
  visualHook?: string;
  subtext?: string;
  sceneDraft?: string;
  episodeCount?: number;
}

export interface GeneratedSceneEpisode {
  title: string;
  summary: string;
  purpose: string;
  povCharacter: string;
  goal: string;
  conflict: string;
  turn: string;
  emotionalShift: string;
  visualHook: string;
  subtext: string;
  plot: string;
  coreConflict: string;
  emotionProgression: string;
  endingHook: string;
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

function clampSceneEpisodeCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 3;
  }

  return Math.max(1, Math.min(12, Math.floor(value as number)));
}

function normalizeGeneratedSceneEpisode(
  value: unknown,
  index: number
): GeneratedSceneEpisode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const plot = readStringValue(record, ['plot', 'body', 'content', 'story', 'episodePlot']);
  const summary = readStringValue(record, ['summary', 'description', 'logline']) || plot;

  if (!summary && !plot) {
    return null;
  }

  return {
    title: readStringValue(record, ['title', 'name']) || `分集 ${index + 1}`,
    summary,
    purpose: readStringValue(record, ['purpose']),
    povCharacter: readStringValue(record, ['povCharacter', 'pov', 'pointOfView']),
    goal: readStringValue(record, ['goal']),
    conflict: readStringValue(record, ['conflict']),
    turn: readStringValue(record, ['turn', 'twist']),
    emotionalShift: readStringValue(record, ['emotionalShift', 'emotion', 'emotionShift']),
    visualHook: readStringValue(record, ['visualHook', 'visual']),
    subtext: readStringValue(record, ['subtext']),
    plot,
    coreConflict: readStringValue(record, ['coreConflict', 'conflictCore']) || readStringValue(record, ['conflict']),
    emotionProgression: readStringValue(record, ['emotionProgression', 'emotionalProgression', 'emotionArc']),
    endingHook: readStringValue(record, ['endingHook', 'hook', 'cliffhanger']),
  };
}

export async function generateSceneEpisodes(
  request: SceneEpisodeGenerationRequest
): Promise<GeneratedSceneEpisode[]> {
  const sceneTitle = request.sceneTitle.trim();
  if (!sceneTitle) {
    throw new Error('Scene title is required before generating episodes.');
  }

  const episodeCount = clampSceneEpisodeCount(request.episodeCount);
  const prompt = [
    '你是一位专业的剧集编剧统筹，负责把单个场景改造成更适合连载呈现的多个分集条目。',
    '请基于给定的章节与场景信息，生成连续推进的分集列表。',
    '每一集都要有明确推进、核心冲突、情绪变化，并且在结尾保留钩子或断章感。',
    '允许你在不违背场景核心意图的前提下，适度调整细节、节奏与信息揭示顺序，让分集更好看。',
    '输出语言必须与输入内容保持一致。',
    '只返回 JSON，不要使用 Markdown 代码块，不要添加解释。',
    '',
    '请严格返回如下结构：',
    '{',
    '  "episodes": [',
    '    {',
    '      "title": "分集标题",',
    '      "summary": "该集一句话摘要",',
    '      "purpose": "该集承担的叙事功能",',
    '      "povCharacter": "主要视角角色，没有则空字符串",',
    '      "goal": "该集人物目标",',
    '      "conflict": "该集核心冲突",',
    '      "turn": "该集转折",',
    '      "emotionalShift": "该集情绪推进",',
    '      "visualHook": "该集视觉钩子",',
    '      "subtext": "该集潜台词",',
    '      "plot": "本集剧情的完整正文",',
    '      "coreConflict": "可直接放入“核心冲突”小节的内容",',
    '      "emotionProgression": "可直接放入“情绪推进”小节的内容",',
    '      "endingHook": "可直接放入“结尾钩子”小节的内容"',
    '    }',
    '  ]',
    '}',
    '',
    `约束：episodes.length 必须等于 ${episodeCount}`,
    '- 分集之间必须连续递进，不要相互重复。',
    '- 每一集都要像正式创作条目，避免空泛概述。',
    '- 如果原场景信息较少，可以谨慎补足戏剧推进，但不要引入脱离上下文的新主线。',
    '- 字段缺失时返回空字符串，不要省略 key。',
    '',
    '章节上下文：',
    `- 章节序号：${request.chapterNumber ?? 1}`,
    `- 章节标题：${request.chapterTitle?.trim() || '未命名章节'}`,
    `- 章节摘要：${request.chapterSummary?.trim() || '无'}`,
    '',
    '场景上下文：',
    `- 场景标题：${sceneTitle}`,
    `- 场景摘要：${request.sceneSummary?.trim() || '无'}`,
    `- 场景作用：${request.purpose?.trim() || '无'}`,
    `- POV 角色：${request.povCharacter?.trim() || '无'}`,
    `- 人物目标：${request.goal?.trim() || '无'}`,
    `- 核心冲突：${request.conflict?.trim() || '无'}`,
    `- 转折：${request.turn?.trim() || '无'}`,
    `- 情绪变化：${request.emotionalShift?.trim() || '无'}`,
    `- 视觉钩子：${request.visualHook?.trim() || '无'}`,
    `- 潜台词：${request.subtext?.trim() || '无'}`,
    '',
    '场景正文/素材：',
    request.sceneDraft?.trim() || '无',
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.65,
    maxTokens: 4096,
  });

  const parsed = extractJsonValue(result.text);
  if (!parsed) {
    throw new Error('Failed to parse generated scene episodes.');
  }

  const rawEpisodes = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { episodes?: unknown }).episodes)
      ? (parsed as { episodes: unknown[] }).episodes
      : [];

  const episodes = rawEpisodes
    .map((item, index) => normalizeGeneratedSceneEpisode(item, index))
    .filter((item): item is GeneratedSceneEpisode => Boolean(item))
    .slice(0, episodeCount);

  if (episodes.length === 0) {
    throw new Error('No episodes were generated for the scene.');
  }

  return episodes;
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

export async function extractScriptAssets(
  request: ScriptAssetExtractionRequest
): Promise<ExtractedScriptAssets> {
  const content = request.content.trim();
  if (!content) {
    return {
      characters: [],
      locations: [],
      items: [],
    };
  }

  const prompt = [
    '你是一名专业的编剧开发顾问，负责从剧本片段中提炼结构化资产。',
    '目标是只保留后续做分镜和美术最需要的核心资产：人物、场景、道具。',
    '请只提取文本中已经明确出现、或被强烈明确暗示且足够稳定的资产，不要脑补，不要补全未出现设定。',
    '输出语言必须与输入内容保持一致。',
    '返回 JSON，不要使用 Markdown 代码块，不要添加解释。',
    '',
    '请严格只提取三类资产：',
    '1. characters：核心人物。只保留具名主角、关键配角、关键反派，或反复承担明确剧情功能的无名角色；一次性路人、背景人群、泛称身份不要提取。',
    '2. locations：核心场景。只保留对剧情推进、视觉设计或反复出场有意义的具体空间；同一物理空间的不同叫法或局部区域要合并成一个稳定名称；抽象地点、过场背景不要提取。',
    '3. items：关键道具。只保留推动冲突、承载线索、体现身份、或反复使用的物件；普通家具、普通武器、普通日用品如果不是关键物，不要提取。',
    '',
    '提炼流程：',
    '1. 先判断这一批文本里真正值得沉淀成资产卡的核心对象，宁缺毋滥。',
    '2. 再把同一人物的不同代称、同一场景的不同叫法合并，统一为最稳定、最常用的名称。',
    '3. 最后只保留便于直接落成节点的关键信息，描述要短、准、可视觉化。',
    '',
    'JSON 结构必须严格如下：',
    '{',
    '  "characters": [',
    '    {',
    '      "name": "角色名",',
    '      "description": "角色的核心身份、剧情作用或关系定位，一句话以内",',
    '      "personality": "稳定且有证据的性格特征，2-4 个短词或短语；没有就空字符串",',
    '      "appearance": "最关键的辨识特征，例如年龄段、性别、发型、服装或显著外观；没有就空字符串"',
    '    }',
    '  ],',
    '  "locations": [',
    '    {',
    '      "name": "场景主名称",',
    '      "description": "空镜头式的场景描述，只保留空间类型、时间/光线、2-3 个关键陈设或氛围；不要出现人物"',
    '    }',
    '  ],',
    '  "items": [',
    '    {',
    '      "name": "道具名",',
    '      "description": "道具的关键用途、归属或最醒目的视觉特征，没有就空字符串"',
    '    }',
    '  ]',
    '}',
    '',
    '约束：',
    '- 只输出核心和关键的，不要追求全量覆盖。',
    '- 去重后再输出，不同字段不要重复换说法。',
    '- 如果某类没有结果，返回空数组。',
    '- name 必须稳定、简洁、便于跨批次去重，不要为了文艺化改名。',
    '- description / personality / appearance 尽量简短，适合直接落成资产节点。',
    '- 人物外形只写文本中明确出现或强烈支撑的辨识点，不要擅自补完整套服装设定。',
    '- 场景描述默认采用空镜头视角，不出现人物姓名、代词或动作主体。',
    '- 不要输出剧情摘要，不要输出章节列表。',
    '',
    request.batchLabel ? `当前批次：${request.batchLabel}` : '',
    '待提取文本：',
    content,
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.2,
    maxTokens: 4096,
  });

  const parsed = extractJsonValue(result.text);
  if (!parsed) {
    throw new Error('Failed to parse extracted script assets JSON.');
  }

  return normalizeExtractedScriptAssets(parsed);
}

export interface TestConnectionRequest {
  provider: string;
  apiKey: string;
  model: string;
  extraParams?: Record<string, unknown>;
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
        extra_params: request.extraParams,
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
