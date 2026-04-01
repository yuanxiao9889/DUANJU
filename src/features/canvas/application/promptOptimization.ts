import { generateText } from "@/commands/textGen";
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
} from "@/features/canvas/models";
import { openSettingsDialog } from "@/features/settings/settingsEvents";
import { useSettingsStore } from "@/stores/settingsStore";

type PromptOptimizationMode = "image" | "video" | "jimeng";

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

export interface PromptDurationRecommendation {
  recommendedDurationSeconds: number;
  estimatedDurationSeconds: number;
  exceedsMaxDuration: boolean;
  reason: string | null;
}

interface OptimizePromptResult {
  prompt: string;
  context: ScriptPromptContext;
  usedReferenceImages: boolean;
  durationRecommendation?: PromptDurationRecommendation | null;
}

const REFERENCE_TOKEN_PATTERN = /@\u56fe(?:\u7247)?\d+/g;
const AUDIO_REFERENCE_TOKEN_PATTERN = /@\u97f3(?:\u9891)?\d+/g;
const ALL_REFERENCE_TOKEN_PATTERN =
  /@\u56fe(?:\u7247)?\d+|@\u97f3(?:\u9891)?\d+/g;
const MAX_JIMENG_DURATION_SECONDS = 15;
const JIMENG_CINEMATIC_DETAIL_DIMENSIONS = [
  "motivated practical lighting, low-key contrast, backlight separation, and controlled highlight roll-off",
  "lens choice, focal length feel, widescreen composition, foreground-middle-background layering, and focus falloff",
  "texture details such as fabric fibers, skin texture, smoke, dust, rain mist, reflections, and material realism",
  "filmic color separation, atmospheric haze, shadow density, restrained grading, and realistic exposure mood",
  "subject blocking, restrained camera movement, shot continuity, and natural motion blur with cinematic rhythm",
] as const;
const JIMENG_CINEMATIC_TERM_EXAMPLES = [
  "cinematic",
  "filmic",
  "widescreen composition",
  "shallow depth of field",
  "layered depth",
  "close-up",
  "medium shot",
  "over-the-shoulder shot",
  "slow push-in",
  "slow dolly-in",
  "low-angle shot",
  "backlight silhouette",
  "practical lighting",
  "rim light",
  "volumetric lighting",
  "atmospheric haze",
  "specular highlights",
  "subtle film grain",
  "shadow roll-off",
  "moody contrast",
  "cool-warm color contrast",
  "natural motion blur",
] as const;
const IMAGE_ANALYSIS_MODEL_HINTS = [
  "vl",
  "vision",
  "omni",
  "image",
  "qvq",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.5",
  "gemini",
  "glm-4v",
  "internvl",
  "llava",
] as const;

function dedupeReferenceTokens(text: string): string[] {
  const matches = text.match(ALL_REFERENCE_TOKEN_PATTERN) ?? [];
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
    return "";
  }

  const fencedMatch = trimmed.match(/```(?:[\w-]+)?\s*([\s\S]*?)```/);
  const extracted = fencedMatch?.[1]?.trim() ?? trimmed;
  const withoutPrefix = extracted.replace(
    /^(?:optimized prompt|prompt|优化后的?提示词|优化提示词|最终提示词)\s*[:：]\s*/i,
    "",
  );

  return withoutPrefix
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^[`"'“”]+|[`"'“”]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? "",
    trimmed.match(/\{[\s\S]*\}/)?.[0]?.trim() ?? "",
  ].filter(
    (candidate, index, source) =>
      candidate.length > 0 && source.indexOf(candidate) === index,
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore and try the next candidate.
    }
  }

  return null;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.round(parsed));
    }
  }

  return null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function restoreReferenceTokens(
  originalPrompt: string,
  optimizedPrompt: string,
): string {
  const originalTokens = dedupeReferenceTokens(originalPrompt);
  if (originalTokens.length === 0) {
    return optimizedPrompt.trim();
  }

  let nextPrompt = optimizedPrompt
    .replace(REFERENCE_TOKEN_PATTERN, (token) =>
      originalTokens.includes(token) ? token : "",
    )
    .replace(AUDIO_REFERENCE_TOKEN_PATTERN, (token) =>
      originalTokens.includes(token) ? token : "",
    );
  nextPrompt = nextPrompt
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const existingTokens = dedupeReferenceTokens(nextPrompt);
  const missingTokens = originalTokens.filter(
    (token) => !existingTokens.includes(token),
  );
  if (missingTokens.length === 0) {
    return nextPrompt;
  }

  return `${nextPrompt}${nextPrompt ? "\n" : ""}${missingTokens.join(" ")}`.trim();
}

function sanitizeReferenceImages(
  referenceImages: string[] | undefined,
): string[] {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
    return [];
  }

  const result: string[] = [];
  for (const image of referenceImages) {
    const trimmed = typeof image === "string" ? image.trim() : "";
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
  const provider = resolveActivatedScriptProvider(settings);
  if (!provider) {
    openSettingsDialog({ category: "providers" });
    throw new Error(
      "\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u6fc0\u6d3b\u4e00\u4e2a\u5267\u672c API \u6a21\u578b\u540e\u518d\u4f7f\u7528",
    );
  }
  const model = resolveConfiguredScriptModel(provider, settings).trim();
  if (!model) {
    openSettingsDialog({ category: "providers" });
    throw new Error(
      "\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u4e3a\u5f53\u524d\u5df2\u6fc0\u6d3b\u7684\u5267\u672c API \u9009\u62e9\u6a21\u578b\u540e\u518d\u4f7f\u7528",
    );
  }
  const normalizedModel = model.toLowerCase();
  const supportsImageAnalysis = IMAGE_ANALYSIS_MODEL_HINTS.some((hint) =>
    normalizedModel.includes(hint),
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
  useReferenceImages: boolean,
): string {
  const modeSpecificInstruction =
    mode === "image"
      ? [
          "你现在做的是 AI 图片提示词轻度优化。",
          "请只在不改变原意的前提下，把提示词整理得更适合图片生成。",
          "可以从氛围、构图、色彩、光线、镜头、景深、材质质感这些视觉维度做专业化表达，但不要凭空新增主体、道具、动作、场景、剧情或情绪转折。",
          "可以适度补足空间层次、材质细节、光影关系和镜头感，让画面更完整一点，但不要扩写成一大段。",
          "优先补充 2 到 4 个真正有帮助的视觉信息，不要堆叠空泛形容词。",
          "如果原文已经明确，就只做轻微润色，不要过度扩写。",
        ].join("\n")
      : [
          "你现在做的是 AI 视频提示词轻度优化。",
          "请只在不改变原意的前提下，把提示词整理得更适合视频生成。",
          "可以从运镜、景别、镜头衔接、影片风格、动作描述、节奏感这些维度做专业化表达，但不要凭空新增主体、动作、剧情、镜头事件或额外设定。",
          "可以适度补足镜头起势、主体运动、环境反馈和节奏停顿，让动态画面更具体一点，但不要改写成全新的分镜脚本。",
          "优先补充 2 到 4 个真正有帮助的动态或镜头信息，不要堆叠空泛形容词。",
          "如果原文没有复杂运镜，就保持克制，只做轻度补足。",
        ].join("\n");

  const imageInstruction = useReferenceImages
    ? "会同时提供参考图片。你只能把参考图片用于校准主体外观、构图、氛围、色彩和动作方向，不得根据图片或想象添加原提示词中没有的新事实。"
    : "本次不会提供参考图片，请只根据原提示词本身进行轻度优化。";

  return [
    modeSpecificInstruction,
    imageInstruction,
    "必须保留原提示词里所有明确事实，包括人物数量、身份关系、服装、道具、地点、时间、风格、比例、时长和限定词。",
    "如果提示词中出现 @图片1、@图片2 这类引用，你必须原样保留，不能改名、删除、增补，也不要改变它们的含义。",
    "结果要比原文稍微更丰满一点，但仍然保持紧凑、可直接用于生成。",
    "不要输出解释，不要输出分析，不要加标题，不要加引号，只输出最终优化后的提示词正文。",
    "",
    "原始提示词：",
    prompt.trim(),
  ].join("\n");
}

function buildJimengPromptOptimizationInstruction(
  prompt: string,
  useReferenceImages: boolean,
): string {
  return buildJimengFilmicPromptOptimizationInstruction(
    prompt,
    useReferenceImages,
  );

  const imageInstruction = useReferenceImages
    ? "Reference images are attached. Use them only to reinforce subject appearance, composition, lighting, texture, and atmosphere. Do not invent new plot events, props, or actions that are not grounded in the source prompt."
    : "No reference images are attached. Optimize only from the source prompt itself.";

  return [
    "You are optimizing a Chinese AI video prompt for Jimeng.",
    "Keep the original meaning, characters, actions, story beats, setting, and all hard constraints intact.",
    'Write the final "optimizedPrompt" in polished Chinese, as one usable production-ready prompt, not as a dry keyword pile.',
    "Bias the result toward cinematic texture and photographed scene realism, closer to a film shot than an advertising slogan or a pile of flashy adjectives.",
    "Upgrade the prompt with stronger cinematic texture, visual style, atmosphere, lighting, lens language, motion rhythm, and scene coherence, but stay grounded in what is already written.",
    "Moderately enrich the visual detail so the scene feels more vivid on screen. Favor concrete cinematic description, photographed space, and tactile atmosphere over abstract praise.",
    `Good enrichment directions include: ${JIMENG_CINEMATIC_DETAIL_DIMENSIONS.join("; ")}.`,
    `When it fits the source, you may selectively use concise professional film descriptors such as: ${JIMENG_CINEMATIC_TERM_EXAMPLES.join(", ")}.`,
    "Add a slightly fuller amount of extra detail that clarifies the existing scene. Prefer 2 to 4 strong cinematic embellishments over a long stack of adjectives.",
    "Let the final prompt feel modestly richer than the source, roughly like one small layer of added cinematic specificity, not a full rewrite.",
    "Prefer movie-like atmosphere, lensing, lighting logic, and spatial depth. Avoid glossy commercial polish, exaggerated fantasy ornament, or poster-style tag clouds unless the source prompt explicitly asks for them.",
    "Do not invent new characters, new props, new locations, new camera events, or extra plot twists.",
    "If the prompt already has a clear camera move, refine it. If it does not, keep the camera language restrained and natural. Do not force montage, multi-shot editing, or flashy camera choreography unless the source already implies it.",
    imageInstruction,
    "The added detail should mainly enrich lighting, texture, atmosphere, composition, motion quality, and a small amount of scene detail. It must not change the narrative facts.",
    "If the prompt contains reference tokens like @图1, @图片2, @音1, or @音频2, preserve them exactly as written and ignore any malformed legacy examples caused by encoding noise.",
    "Ignore any malformed legacy token examples caused by encoding noise. Only valid examples are @图1 and @图片2.",
    "If the prompt contains tokens like @图1 or @图片2, preserve them exactly as written.",
    "If the prompt contains tokens like @图1 or @图片2, preserve them exactly as written.",
    "If the prompt contains tokens like @\u56fe1 or @\u56fe\u72472, preserve them exactly as written.",
    "If the prompt contains tokens like @图1 or @图片2, preserve them exactly as written.",
    `Also estimate the suitable video duration. "recommendedDurationSeconds" must be an integer from 1 to ${MAX_JIMENG_DURATION_SECONDS}.`,
    `If the content clearly needs more than ${MAX_JIMENG_DURATION_SECONDS} seconds, set "recommendedDurationSeconds" to ${MAX_JIMENG_DURATION_SECONDS}, set "estimatedDurationSeconds" to your best real estimate above ${MAX_JIMENG_DURATION_SECONDS}, and set "exceedsMaxDuration" to true.`,
    "Return strict JSON only. Do not return markdown fences or any explanation.",
    "JSON schema:",
    "{",
    '  "optimizedPrompt": "string",',
    `  "recommendedDurationSeconds": 1-${MAX_JIMENG_DURATION_SECONDS},`,
    '  "estimatedDurationSeconds": integer >= 1,',
    '  "exceedsMaxDuration": boolean,',
    '  "reason": "one short sentence about pacing and shot density"',
    "}",
    "",
    "Source prompt:",
    prompt.trim(),
  ].join("\n");
}

function buildJimengFilmicPromptOptimizationInstruction(
  prompt: string,
  useReferenceImages: boolean,
): string {
  return buildJimengCinemaPromptOptimizationInstruction(
    prompt,
    useReferenceImages,
  );

  const imageInstruction = useReferenceImages
    ? "Reference images are attached. Use them only to reinforce subject appearance, composition, lighting, texture, and atmosphere. Do not invent new plot events, props, or actions that are not grounded in the source prompt."
    : "No reference images are attached. Optimize only from the source prompt itself.";

  return [
    "You are optimizing a Chinese AI video prompt for Jimeng.",
    "Keep the original meaning, characters, actions, story beats, setting, and all hard constraints intact.",
    'Write the final "optimizedPrompt" in polished Chinese, as one production-ready prompt with flowing cinematic language, not as a dry keyword list.',
    "Bias the result toward filmic realism, photographed scene texture, and cinematic atmosphere, closer to a movie shot than an advertising slogan or a pile of flashy adjectives.",
    "Upgrade the prompt with stronger cinematic texture, visual style, atmosphere, lighting logic, lens language, motion rhythm, and scene coherence, but stay grounded in what is already written.",
    "Moderately enrich the visual detail so the scene feels more vivid on screen. Favor concrete cinematic description, photographed space, and tactile atmosphere over abstract praise.",
    `Good enrichment directions include: ${JIMENG_CINEMATIC_DETAIL_DIMENSIONS.join("; ")}.`,
    `When it fits the source, you may selectively use concise professional film descriptors such as: ${JIMENG_CINEMATIC_TERM_EXAMPLES.join(", ")}.`,
    "Add only a small amount of extra detail that clarifies the existing scene. Prefer 1 to 3 strong cinematic embellishments over a long stack of adjectives.",
    "Prefer movie-like atmosphere, lensing, lighting logic, and spatial depth. Avoid glossy commercial polish, exaggerated fantasy ornament, or poster-style tag clouds unless the source prompt explicitly asks for them.",
    "Do not invent new characters, new props, new locations, new camera events, or extra plot twists.",
    "If the prompt already has a clear camera move, refine it. If it does not, keep the camera language restrained and natural. Do not force montage, multi-shot editing, or flashy camera choreography unless the source already implies it.",
    imageInstruction,
    "The added detail should mainly enrich lighting, texture, atmosphere, composition, and motion quality. It must not change the narrative facts.",
    "If the prompt contains tokens like @图1 or @图片2, preserve them exactly as written.",
    `Also estimate the suitable video duration. "recommendedDurationSeconds" must be an integer from 1 to ${MAX_JIMENG_DURATION_SECONDS}.`,
    `If the content clearly needs more than ${MAX_JIMENG_DURATION_SECONDS} seconds, set "recommendedDurationSeconds" to ${MAX_JIMENG_DURATION_SECONDS}, set "estimatedDurationSeconds" to your best real estimate above ${MAX_JIMENG_DURATION_SECONDS}, and set "exceedsMaxDuration" to true.`,
    "Return strict JSON only. Do not return markdown fences or any explanation.",
    "JSON schema:",
    "{",
    '  "optimizedPrompt": "string",',
    `  "recommendedDurationSeconds": 1-${MAX_JIMENG_DURATION_SECONDS},`,
    '  "estimatedDurationSeconds": integer >= 1,',
    '  "exceedsMaxDuration": boolean,',
    '  "reason": "one short sentence about pacing and shot density"',
    "}",
    "",
    "Source prompt:",
    prompt.trim(),
  ].join("\n");
}

function buildJimengCinemaPromptOptimizationInstruction(
  prompt: string,
  useReferenceImages: boolean,
): string {
  return buildJimengCinemaPromptOptimizationInstructionFinal(
    prompt,
    useReferenceImages,
  );

  const imageInstruction = useReferenceImages
    ? "Reference images are attached. Use them only to reinforce subject appearance, composition, lighting, texture, and atmosphere. Do not invent new plot events, props, or actions that are not grounded in the source prompt."
    : "No reference images are attached. Optimize only from the source prompt itself.";

  return [
    "You are optimizing a Chinese AI video prompt for Jimeng.",
    "Keep the original meaning, characters, actions, story beats, setting, and all hard constraints intact.",
    'Write the final "optimizedPrompt" in polished Chinese, as one production-ready prompt with flowing cinematic language, not as a dry keyword list.',
    "Bias the result toward filmic realism, photographed scene texture, and cinematic atmosphere, closer to a movie shot than an advertising slogan or a pile of flashy adjectives.",
    "Upgrade the prompt with stronger cinematic texture, visual style, atmosphere, lighting logic, lens language, motion rhythm, and scene coherence, but stay grounded in what is already written.",
    "Moderately enrich the visual detail so the scene feels more vivid on screen. Favor concrete cinematic description, photographed space, and tactile atmosphere over abstract praise.",
    `Good enrichment directions include: ${JIMENG_CINEMATIC_DETAIL_DIMENSIONS.join("; ")}.`,
    `When it fits the source, you may selectively use concise professional film descriptors such as: ${JIMENG_CINEMATIC_TERM_EXAMPLES.join(", ")}.`,
    "Add only a small amount of extra detail that clarifies the existing scene. Prefer 1 to 3 strong cinematic embellishments over a long stack of adjectives.",
    "Prefer movie-like atmosphere, lensing, lighting logic, and spatial depth. Avoid glossy commercial polish, exaggerated fantasy ornament, or poster-style tag clouds unless the source prompt explicitly asks for them.",
    "Do not invent new characters, new props, new locations, new camera events, or extra plot twists.",
    "If the prompt already has a clear camera move, refine it. If it does not, keep the camera language restrained and natural. Do not force montage, multi-shot editing, or flashy camera choreography unless the source already implies it.",
    imageInstruction,
    "The added detail should mainly enrich lighting, texture, atmosphere, composition, and motion quality. It must not change the narrative facts.",
    "If the prompt contains tokens like @图1 or @图片2, preserve them exactly as written.",
    `Also estimate the suitable video duration. "recommendedDurationSeconds" must be an integer from 1 to ${MAX_JIMENG_DURATION_SECONDS}.`,
    `If the content clearly needs more than ${MAX_JIMENG_DURATION_SECONDS} seconds, set "recommendedDurationSeconds" to ${MAX_JIMENG_DURATION_SECONDS}, set "estimatedDurationSeconds" to your best real estimate above ${MAX_JIMENG_DURATION_SECONDS}, and set "exceedsMaxDuration" to true.`,
    "Return strict JSON only. Do not return markdown fences or any explanation.",
    "JSON schema:",
    "{",
    '  "optimizedPrompt": "string",',
    `  "recommendedDurationSeconds": 1-${MAX_JIMENG_DURATION_SECONDS},`,
    '  "estimatedDurationSeconds": integer >= 1,',
    '  "exceedsMaxDuration": boolean,',
    '  "reason": "one short sentence about pacing and shot density"',
    "}",
    "",
    "Source prompt:",
    prompt.trim(),
  ].join("\n");
}

function buildJimengCinemaPromptOptimizationInstructionFinal(
  prompt: string,
  useReferenceImages: boolean,
): string {
  return buildJimengCinemaPromptOptimizationInstructionRuntime(
    prompt,
    useReferenceImages,
  );

  const imageInstruction = useReferenceImages
    ? "Reference images are attached. Use them only to reinforce subject appearance, composition, lighting, texture, and atmosphere. Do not invent new plot events, props, or actions that are not grounded in the source prompt."
    : "No reference images are attached. Optimize only from the source prompt itself.";

  return [
    "You are optimizing a Chinese AI video prompt for Jimeng.",
    "Keep the original meaning, characters, actions, story beats, setting, and all hard constraints intact.",
    'Write the final "optimizedPrompt" in polished Chinese, as one production-ready prompt with flowing cinematic language, not as a dry keyword list.',
    "Bias the result toward filmic realism, photographed scene texture, and cinematic atmosphere, closer to a movie shot than an advertising slogan or a pile of flashy adjectives.",
    "Upgrade the prompt with stronger cinematic texture, visual style, atmosphere, lighting logic, lens language, motion rhythm, and scene coherence, but stay grounded in what is already written.",
    "Moderately enrich the visual detail so the scene feels more vivid on screen. Favor concrete cinematic description, photographed space, and tactile atmosphere over abstract praise.",
    `Good enrichment directions include: ${JIMENG_CINEMATIC_DETAIL_DIMENSIONS.join("; ")}.`,
    `When it fits the source, you may selectively use concise professional film descriptors such as: ${JIMENG_CINEMATIC_TERM_EXAMPLES.join(", ")}.`,
    "Add only a small amount of extra detail that clarifies the existing scene. Prefer 1 to 3 strong cinematic embellishments over a long stack of adjectives.",
    "Prefer movie-like atmosphere, lensing, lighting logic, and spatial depth. Avoid glossy commercial polish, exaggerated fantasy ornament, or poster-style tag clouds unless the source prompt explicitly asks for them.",
    "Do not invent new characters, new props, new locations, new camera events, or extra plot twists.",
    "If the prompt already has a clear camera move, refine it. If it does not, keep the camera language restrained and natural. Do not force montage, multi-shot editing, or flashy camera choreography unless the source already implies it.",
    imageInstruction,
    "The added detail should mainly enrich lighting, texture, atmosphere, composition, and motion quality. It must not change the narrative facts.",
    "If the prompt contains tokens like @图1 or @图片2, preserve them exactly as written.",
    `Also estimate the suitable video duration. "recommendedDurationSeconds" must be an integer from 1 to ${MAX_JIMENG_DURATION_SECONDS}.`,
    `If the content clearly needs more than ${MAX_JIMENG_DURATION_SECONDS} seconds, set "recommendedDurationSeconds" to ${MAX_JIMENG_DURATION_SECONDS}, set "estimatedDurationSeconds" to your best real estimate above ${MAX_JIMENG_DURATION_SECONDS}, and set "exceedsMaxDuration" to true.`,
    "Return strict JSON only. Do not return markdown fences or any explanation.",
    "JSON schema:",
    "{",
    '  "optimizedPrompt": "string",',
    `  "recommendedDurationSeconds": 1-${MAX_JIMENG_DURATION_SECONDS},`,
    '  "estimatedDurationSeconds": integer >= 1,',
    '  "exceedsMaxDuration": boolean,',
    '  "reason": "one short sentence about pacing and shot density"',
    "}",
    "",
    "Source prompt:",
    prompt.trim(),
  ].join("\n");
}

function buildJimengCinemaPromptOptimizationInstructionRuntime(
  prompt: string,
  useReferenceImages: boolean,
): string {
  const imageInstruction = useReferenceImages
    ? "Reference images are attached. Use them only to reinforce subject appearance, composition, lighting, texture, and atmosphere. Do not invent new plot events, props, or actions that are not grounded in the source prompt."
    : "No reference images are attached. Optimize only from the source prompt itself.";

  return [
    "You are optimizing a Chinese AI video prompt for Jimeng.",
    "Keep the original meaning, characters, actions, story beats, setting, and all hard constraints intact.",
    'Write the final "optimizedPrompt" in polished Chinese, as one production-ready prompt with flowing cinematic language, not as a dry keyword list.',
    "Bias the result toward filmic realism, photographed scene texture, and cinematic atmosphere, closer to a movie shot than an advertising slogan or a pile of flashy adjectives.",
    "Upgrade the prompt with stronger cinematic texture, visual style, atmosphere, lighting logic, lens language, motion rhythm, and scene coherence, but stay grounded in what is already written.",
    "Moderately enrich the visual detail so the scene feels more vivid on screen. Favor concrete cinematic description, photographed space, and tactile atmosphere over abstract praise.",
    `Good enrichment directions include: ${JIMENG_CINEMATIC_DETAIL_DIMENSIONS.join("; ")}.`,
    `When it fits the source, you may selectively use concise professional film descriptors such as: ${JIMENG_CINEMATIC_TERM_EXAMPLES.join(", ")}.`,
    "Add a slightly fuller amount of extra detail that clarifies the existing scene. Prefer 2 to 4 strong cinematic embellishments over a long stack of adjectives.",
    "Let the final prompt feel modestly richer than the source, roughly like one small layer of added cinematic specificity, not a full rewrite.",
    "Prefer movie-like atmosphere, lensing, lighting logic, and spatial depth. Avoid glossy commercial polish, exaggerated fantasy ornament, or poster-style tag clouds unless the source prompt explicitly asks for them.",
    "Do not invent new characters, new props, new locations, new camera events, or extra plot twists.",
    "If the prompt already has a clear camera move, refine it. If it does not, keep the camera language restrained and natural. Do not force montage, multi-shot editing, or flashy camera choreography unless the source already implies it.",
    imageInstruction,
    "The added detail should mainly enrich lighting, texture, atmosphere, composition, motion quality, and a small amount of scene detail. It must not change the narrative facts.",
    "If the prompt contains reference tokens like @图1, @图片2, @音1, or @音频2, preserve them exactly as written.",
    `Also estimate the suitable video duration. "recommendedDurationSeconds" must be an integer from 1 to ${MAX_JIMENG_DURATION_SECONDS}.`,
    `If the content clearly needs more than ${MAX_JIMENG_DURATION_SECONDS} seconds, set "recommendedDurationSeconds" to ${MAX_JIMENG_DURATION_SECONDS}, set "estimatedDurationSeconds" to your best real estimate above ${MAX_JIMENG_DURATION_SECONDS}, and set "exceedsMaxDuration" to true.`,
    "Return strict JSON only. Do not return markdown fences or any explanation.",
    "JSON schema:",
    "{",
    '  "optimizedPrompt": "string",',
    `  "recommendedDurationSeconds": 1-${MAX_JIMENG_DURATION_SECONDS},`,
    '  "estimatedDurationSeconds": integer >= 1,',
    '  "exceedsMaxDuration": boolean,',
    '  "reason": "one short sentence about pacing and shot density"',
    "}",
    "",
    "Source prompt:",
    prompt.trim(),
  ].join("\n");
}

function parseJimengOptimizationResult(
  originalPrompt: string,
  rawText: string,
): {
  prompt: string;
  durationRecommendation: PromptDurationRecommendation | null;
} {
  const parsed = extractJsonObject(rawText);
  const rawPrompt =
    typeof parsed?.optimizedPrompt === "string"
      ? parsed.optimizedPrompt
      : typeof parsed?.prompt === "string"
        ? parsed.prompt
        : rawText;
  const optimizedPrompt = restoreReferenceTokens(
    originalPrompt,
    normalizeOptimizedPrompt(rawPrompt),
  );

  const parsedRecommendedSeconds = parsePositiveInteger(
    parsed?.recommendedDurationSeconds,
  );
  const parsedEstimatedSeconds = parsePositiveInteger(
    parsed?.estimatedDurationSeconds,
  );
  const estimatedDurationSeconds =
    parsedEstimatedSeconds ?? parsedRecommendedSeconds;
  const exceedsMaxDuration =
    parseBoolean(parsed?.exceedsMaxDuration) ??
    (typeof estimatedDurationSeconds === "number"
      ? estimatedDurationSeconds > MAX_JIMENG_DURATION_SECONDS
      : false);

  const recommendedDurationSeconds =
    parsedRecommendedSeconds != null
      ? clampInteger(parsedRecommendedSeconds, 1, MAX_JIMENG_DURATION_SECONDS)
      : exceedsMaxDuration
        ? MAX_JIMENG_DURATION_SECONDS
        : typeof estimatedDurationSeconds === "number"
          ? clampInteger(
              estimatedDurationSeconds,
              1,
              MAX_JIMENG_DURATION_SECONDS,
            )
          : null;

  if (recommendedDurationSeconds == null) {
    return {
      prompt: optimizedPrompt,
      durationRecommendation: null,
    };
  }

  const reason =
    typeof parsed?.reason === "string" && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : null;

  return {
    prompt: optimizedPrompt,
    durationRecommendation: {
      recommendedDurationSeconds,
      estimatedDurationSeconds: Math.max(
        recommendedDurationSeconds,
        estimatedDurationSeconds ?? recommendedDurationSeconds,
      ),
      exceedsMaxDuration,
      reason,
    },
  };
}

export async function optimizeCanvasPrompt(
  request: OptimizePromptRequest,
): Promise<OptimizePromptResult> {
  const normalizedPrompt = request.prompt.trim();
  if (!normalizedPrompt) {
    throw new Error("请先输入提示词");
  }

  const context = resolveScriptPromptContext();
  const candidateReferenceImages = sanitizeReferenceImages(
    request.referenceImages,
  );
  const referenceImages = context.supportsImageAnalysis
    ? candidateReferenceImages
    : [];

  const result = await generateText({
    prompt:
      request.mode === "jimeng" || request.mode === "video"
        ? buildJimengPromptOptimizationInstruction(
            normalizedPrompt,
            referenceImages.length > 0,
          )
        : buildPromptOptimizationInstruction(
            request.mode,
            normalizedPrompt,
            referenceImages.length > 0,
          ),
    provider: context.provider,
    model: context.model,
    temperature: 0.28,
    maxTokens: 1100,
    referenceImages,
  });

  if (request.mode === "jimeng" || request.mode === "video") {
    const parsedResult = parseJimengOptimizationResult(
      normalizedPrompt,
      result.text,
    );
    if (!parsedResult.prompt) {
      throw new Error("提示词优化结果为空，请重试");
    }

    return {
      prompt: parsedResult.prompt,
      context,
      usedReferenceImages: referenceImages.length > 0,
      durationRecommendation: parsedResult.durationRecommendation,
    };
  }

  const normalizedResult = restoreReferenceTokens(
    normalizedPrompt,
    normalizeOptimizedPrompt(result.text),
  );
  if (!normalizedResult) {
    throw new Error("提示词优化结果为空，请重试");
  }

  return {
    prompt: normalizedResult,
    context,
    usedReferenceImages: referenceImages.length > 0,
    durationRecommendation: null,
  };
}
