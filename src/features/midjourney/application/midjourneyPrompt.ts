import { generateText } from '@/commands/textGen';
import {
  optimizeCanvasPrompt,
  type ScriptPromptContext,
} from '@/features/canvas/application/promptOptimization';
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
} from '@/features/canvas/models';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useSettingsStore } from '@/stores/settingsStore';

export type MidjourneyPromptTranslationDirection = 'zhToEn' | 'enToZh';

export interface OptimizeMidjourneyPromptInput {
  prompt: string;
}

export interface OptimizeMidjourneyPromptOutput {
  prompt: string;
  context: ScriptPromptContext;
}

export interface TranslateMidjourneyPromptInput {
  prompt: string;
}

export interface TranslateMidjourneyPromptOutput {
  prompt: string;
  direction: MidjourneyPromptTranslationDirection;
  context: ScriptPromptContext;
}

const NO_ACTIVE_SCRIPT_MODEL_MESSAGE =
  '请先在设置中激活一个剧本 API 模型后再使用';
const NO_ACTIVE_SCRIPT_PROVIDER_MODEL_MESSAGE =
  '请先在设置中为当前已激活的剧本 API 选择模型后再使用';
const IMAGE_ANALYSIS_MODEL_HINTS = [
  'vl',
  'vision',
  'omni',
  'image',
  'qvq',
  'gpt-5',
  'gpt-4o',
  'gpt-4.1',
  'gpt-4.5',
  'gemini',
  'glm-4v',
  'internvl',
  'llava',
] as const;
const CODE_BLOCK_PATTERN = /```(?:[\w-]+)?\s*([\s\S]*?)```/i;
const RESULT_PREFIX_PATTERN =
  /^(?:optimized prompt|translated prompt|translation|prompt|optimized mj prompt|translated mj prompt|优化后的提示词|优化提示词|翻译结果|翻译后的提示词|提示词)\s*[:：-]?\s*/i;
const MIDJOURNEY_PARAM_START_PATTERN = /(^|\s)--[a-zA-Z][\w-]*/;

function normalizePromptText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizeMidjourneyPromptResult(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return '';
  }

  const extracted = CODE_BLOCK_PATTERN.exec(trimmed)?.[1]?.trim() ?? trimmed;
  const withoutPrefix = extracted.replace(RESULT_PREFIX_PATTERN, '');

  return stripMidjourneyParams(
    withoutPrefix
      .replace(/^\s*[-*•]+\s*/gm, '')
      .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function countChineseCharacters(text: string): number {
  return text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
}

function countLatinLetters(text: string): number {
  return text.match(/[A-Za-z]/g)?.length ?? 0;
}

function resolveMidjourneyPromptContext(): ScriptPromptContext {
  const settings = useSettingsStore.getState();
  const provider = resolveActivatedScriptProvider(settings);
  if (!provider) {
    openSettingsDialog({ category: 'providers' });
    throw new Error(NO_ACTIVE_SCRIPT_MODEL_MESSAGE);
  }

  const model = resolveConfiguredScriptModel(provider, settings).trim();
  if (!model) {
    openSettingsDialog({ category: 'providers' });
    throw new Error(NO_ACTIVE_SCRIPT_PROVIDER_MODEL_MESSAGE);
  }

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

function buildMidjourneyTranslationInstruction(
  prompt: string,
  direction: MidjourneyPromptTranslationDirection
): string {
  if (direction === 'zhToEn') {
    return [
      'You are translating a Chinese image prompt into natural English prompt text for Midjourney.',
      'Keep the original meaning, subjects, composition, lighting, atmosphere, style, and constraints intact.',
      'Do not add explanations, titles, markdown, bullet points, or quotation marks.',
      'Do not add, keep, or rewrite any Midjourney command parameters or suffixes such as --ar, --raw, --v, --sref, --stylize, --chaos, --weird, --seed, or --no.',
      'Return the translated English prompt text only.',
      '',
      'Source prompt:',
      prompt,
    ].join('\n');
  }

  return [
    'You are translating an English image prompt into fluent Chinese prompt text.',
    'Keep the original meaning, subjects, composition, lighting, atmosphere, style, and constraints intact.',
    'Do not add explanations, titles, markdown, bullet points, or quotation marks.',
    'Do not add, keep, or rewrite any Midjourney command parameters or suffixes such as --ar, --raw, --v, --sref, --stylize, --chaos, --weird, --seed, or --no.',
    'Return the translated Chinese prompt text only.',
    '',
    'Source prompt:',
    prompt,
  ].join('\n');
}

export function stripMidjourneyParams(prompt: string): string {
  const normalizedPrompt = normalizePromptText(prompt);
  if (!normalizedPrompt) {
    return '';
  }

  return normalizedPrompt
    .split('\n')
    .map((line) => {
      const match = MIDJOURNEY_PARAM_START_PATTERN.exec(line);
      MIDJOURNEY_PARAM_START_PATTERN.lastIndex = 0;
      if (!match || typeof match.index !== 'number') {
        return line.trimEnd();
      }

      return line.slice(0, match.index).trimEnd();
    })
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function detectMidjourneyPromptTranslationDirection(
  prompt: string
): MidjourneyPromptTranslationDirection {
  const normalizedPrompt = stripMidjourneyParams(prompt);
  const chineseCount = countChineseCharacters(normalizedPrompt);
  const latinCount = countLatinLetters(normalizedPrompt);

  return chineseCount >= latinCount ? 'zhToEn' : 'enToZh';
}

export async function optimizeMidjourneyPrompt(
  input: OptimizeMidjourneyPromptInput
): Promise<OptimizeMidjourneyPromptOutput> {
  const strippedPrompt = stripMidjourneyParams(input.prompt);
  if (!strippedPrompt) {
    throw new Error('Midjourney prompt is empty');
  }

  const result = await optimizeCanvasPrompt({
    mode: 'image',
    prompt: strippedPrompt,
  });
  const prompt = stripMidjourneyParams(result.prompt);

  if (!prompt) {
    throw new Error('Midjourney prompt optimization returned an empty result');
  }

  return {
    prompt,
    context: result.context,
  };
}

export async function translateMidjourneyPrompt(
  input: TranslateMidjourneyPromptInput
): Promise<TranslateMidjourneyPromptOutput> {
  const strippedPrompt = stripMidjourneyParams(input.prompt);
  if (!strippedPrompt) {
    throw new Error('Midjourney prompt is empty');
  }

  const direction = detectMidjourneyPromptTranslationDirection(strippedPrompt);
  const context = resolveMidjourneyPromptContext();
  const result = await generateText({
    prompt: buildMidjourneyTranslationInstruction(strippedPrompt, direction),
    provider: context.provider,
    model: context.model,
    temperature: 0.18,
    maxTokens: 1200,
  });
  const prompt = normalizeMidjourneyPromptResult(result.text);

  if (!prompt) {
    throw new Error('Midjourney prompt translation returned an empty result');
  }

  return {
    prompt,
    direction,
    context,
  };
}
