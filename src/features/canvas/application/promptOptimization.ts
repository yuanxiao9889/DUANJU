import { generateText } from '@/commands/textGen';
import { useSettingsStore } from '@/stores/settingsStore';

type PromptOptimizationMode = 'image' | 'jimeng';

interface OptimizePromptRequest {
  mode: PromptOptimizationMode;
  prompt: string;
  referenceImages?: string[];
}

interface ScriptPromptContext {
  provider: string;
  model: string;
  supportsImageAnalysis: boolean;
}

interface OptimizePromptResult {
  prompt: string;
  context: ScriptPromptContext;
  usedReferenceImages: boolean;
}

const REFERENCE_TOKEN_PATTERN = /@\u56FE\u7247\d+/g;
const IMAGE_ANALYSIS_MODEL_HINTS = [
  'vl',
  'vision',
  'omni',
  'image',
  'qvq',
  'gpt-4o',
  'gpt-4.1',
  'gpt-4.5',
  'gemini',
  'glm-4v',
  'internvl',
  'llava',
] as const;

function dedupeReferenceTokens(text: string): string[] {
  const matches = text.match(REFERENCE_TOKEN_PATTERN) ?? [];
  const result: string[] = [];

  for (const token of matches) {
    if (!result.includes(token)) {
      result.push(token);
    }
  }

  return result;
}

function normalizeOptimizedPrompt(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return '';
  }

  const fencedMatch = trimmed.match(/```(?:[\w-]+)?\s*([\s\S]*?)```/);
  const extracted = fencedMatch?.[1]?.trim() ?? trimmed;
  const withoutPrefix = extracted.replace(
    /^(?:optimized prompt|prompt|优化后的?提示词|优化提示词|最终提示词)\s*[:：]\s*/i,
    ''
  );

  return withoutPrefix
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function restoreReferenceTokens(originalPrompt: string, optimizedPrompt: string): string {
  const originalTokens = dedupeReferenceTokens(originalPrompt);
  if (originalTokens.length === 0) {
    return optimizedPrompt.trim();
  }

  let nextPrompt = optimizedPrompt.replace(REFERENCE_TOKEN_PATTERN, (token) =>
    originalTokens.includes(token) ? token : ''
  );
  nextPrompt = nextPrompt
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const existingTokens = dedupeReferenceTokens(nextPrompt);
  const missingTokens = originalTokens.filter((token) => !existingTokens.includes(token));
  if (missingTokens.length === 0) {
    return nextPrompt;
  }

  return `${nextPrompt}${nextPrompt ? '\n' : ''}${missingTokens.join(' ')}`.trim();
}

function sanitizeReferenceImages(referenceImages: string[] | undefined): string[] {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
    return [];
  }

  const result: string[] = [];
  for (const image of referenceImages) {
    const trimmed = typeof image === 'string' ? image.trim() : '';
    if (!trimmed || result.includes(trimmed)) {
      continue;
    }
    result.push(trimmed);
    if (result.length >= 4) {
      break;
    }
  }

  return result;
}

function resolveScriptPromptContext(): ScriptPromptContext {
  const settings = useSettingsStore.getState();
  const provider = settings.scriptProviderEnabled === 'coding' ? 'coding' : 'alibaba';
  const model = provider === 'coding'
    ? (settings.codingModel || 'qwen3.5-plus').trim()
    : (settings.alibabaTextModel || 'qwen-plus').trim();
  const normalizedModel = model.toLowerCase();
  const supportsImageAnalysis = IMAGE_ANALYSIS_MODEL_HINTS.some((hint) =>
    normalizedModel.includes(hint)
  );

  return {
    provider,
    model,
    supportsImageAnalysis,
  };
}

function buildPromptOptimizationInstruction(
  mode: PromptOptimizationMode,
  prompt: string,
  useReferenceImages: boolean
): string {
  const modeSpecificInstruction =
    mode === 'image'
      ? [
          '你现在做的是 AI 图片提示词轻度优化。',
          '请只在不改变原意的前提下，把提示词整理得更适合图片生成。',
          '可以从氛围、构图、色彩、光线、镜头、景深、材质质感这些视觉维度做专业化表达，但不要凭空新增主体、道具、动作、场景、剧情或情绪转折。',
          '如果原文已经明确，就只做轻微润色，不要过度扩写。',
        ].join('\n')
      : [
          '你现在做的是 AI 视频提示词轻度优化。',
          '请只在不改变原意的前提下，把提示词整理得更适合视频生成。',
          '可以从运镜、景别、镜头衔接、影片风格、动作描述、节奏感这些维度做专业化表达，但不要凭空新增主体、动作、剧情、镜头事件或额外设定。',
          '如果原文没有复杂运镜，就保持克制，只做轻度补足。',
        ].join('\n');

  const imageInstruction = useReferenceImages
    ? '会同时提供参考图片。你只能把参考图片用于校准主体外观、构图、氛围、色彩和动作方向，不得根据图片或想象添加原提示词中没有的新事实。'
    : '本次不会提供参考图片，请只根据原提示词本身进行轻度优化。';

  return [
    modeSpecificInstruction,
    imageInstruction,
    '必须保留原提示词里所有明确事实，包括人物数量、身份关系、服装、道具、地点、时间、风格、比例、时长和限定词。',
    '如果提示词中出现 @图片1、@图片2 这类引用，你必须原样保留，不能改名、删除、增补，也不要改变它们的含义。',
    '不要输出解释，不要输出分析，不要加标题，不要加引号，只输出最终优化后的提示词正文。',
    '',
    '原始提示词：',
    prompt.trim(),
  ].join('\n');
}

export async function optimizeCanvasPrompt(
  request: OptimizePromptRequest
): Promise<OptimizePromptResult> {
  const normalizedPrompt = request.prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('请先输入提示词');
  }

  const context = resolveScriptPromptContext();
  const candidateReferenceImages = sanitizeReferenceImages(request.referenceImages);
  const referenceImages = context.supportsImageAnalysis ? candidateReferenceImages : [];

  const result = await generateText({
    prompt: buildPromptOptimizationInstruction(
      request.mode,
      normalizedPrompt,
      referenceImages.length > 0
    ),
    provider: context.provider,
    model: context.model,
    temperature: 0.25,
    maxTokens: 900,
    referenceImages,
  });

  const normalizedResult = restoreReferenceTokens(
    normalizedPrompt,
    normalizeOptimizedPrompt(result.text)
  );
  if (!normalizedResult) {
    throw new Error('提示词优化结果为空，请重试');
  }

  return {
    prompt: normalizedResult,
    context,
    usedReferenceImages: referenceImages.length > 0,
  };
}
