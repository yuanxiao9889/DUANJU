import { generateText } from "@/commands/textGen";
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
} from "@/features/canvas/models";
import type { PromptReferenceImageBinding } from "@/features/canvas/application/promptReferenceImageBindings";
import { openSettingsDialog } from "@/features/settings/settingsEvents";
import { useSettingsStore } from "@/stores/settingsStore";

type PromptOptimizationMode =
  | "image"
  | "video"
  | "jimeng"
  | "ttsVoice"
  | "dialogue";

interface OptimizePromptRequest {
  mode: PromptOptimizationMode;
  prompt: string;
  referenceImages?: string[];
  referenceImageBindings?: PromptReferenceImageBinding[];
  maxPromptLength?: number;
}

export interface ScriptPromptContext {
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
  usedReferenceImageCount: number;
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
const JIMENG_STRUCTURAL_CONTENT_PRESERVATION_INSTRUCTIONS = [
  "If the source prompt contains spoken dialogue, character lines, narration, voice-over, inner thoughts, psychological activity, or other explicit verbal content, preserve them in the optimized prompt instead of omitting them or flattening them into generic visual description.",
  'Do not delete, summarize away, or rewrite out segments labeled or implied as dialogue, lines, 台词, 对白, 旁白, 独白, 内心独白, 心理活动, OS, or VO unless the source itself marks them as optional.',
  "Keep the original speaker relationship, line order, and dramatic function whenever possible. You may polish wording for fluency and cinematic cohesion, but retain the substantive verbal content, emotional intent, and information value.",
  "If the source prompt includes speaker labels, role names, or dialogue prefixes such as `角色名：`, preserve those names and prefixes explicitly instead of removing them, merging them away, or replacing them with generic narration.",
  "If any dialogue appears inside quotation marks or other explicit quote delimiters, keep it as direct quoted speech. Do not convert quoted lines into third-person narration, paraphrase them as scene description, or dissolve them into action prose.",
  "Treat dialogue, narration, and inner thoughts as first-class content that should coexist with the cinematic description, not as expendable notes.",
] as const;
const IMAGE_ANALYSIS_MODEL_HINTS = [
  "vl",
  "vision",
  "omni",
  "image",
  "qvq",
  "gpt-5",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.5",
  "gemini",
  "glm-4v",
  "internvl",
  "llava",
] as const;
const VALID_IMAGE_REFERENCE_TOKEN_PATTERN = /^@\u56fe(?:\u7247)?\d+$/;

type ReferenceImageAnalysisBias = "static" | "dynamic";

interface ResolvedReferenceImageInputs {
  referenceImages: string[];
  referenceImageBindings: PromptReferenceImageBinding[];
}

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

function normalizeMaxPromptLength(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(1, Math.floor(value));
}

function truncatePromptAtBoundary(text: string, maxLength: number): string {
  const normalizedText = text.trim();
  if (normalizedText.length <= maxLength) {
    return normalizedText;
  }

  const sliced = normalizedText.slice(0, maxLength).trimEnd();
  const boundarySearchStart = Math.max(0, maxLength - 80);
  const boundaryCharacters = [
    "\n",
    "。",
    "！",
    "？",
    "；",
    "，",
    "、",
    ".",
    "!",
    "?",
    ";",
    ",",
    ":",
    " ",
  ];

  let bestBoundaryIndex = -1;
  for (const boundaryCharacter of boundaryCharacters) {
    const index = sliced.lastIndexOf(boundaryCharacter);
    if (index > bestBoundaryIndex) {
      bestBoundaryIndex = index;
    }
  }

  if (bestBoundaryIndex >= boundarySearchStart) {
    return sliced.slice(0, bestBoundaryIndex).trimEnd();
  }

  return sliced;
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

function applyOptimizedPromptLengthLimit(
  originalPrompt: string,
  optimizedPrompt: string,
  maxPromptLength: number | undefined,
): string {
  const normalizedMaxPromptLength = normalizeMaxPromptLength(maxPromptLength);
  const normalizedPrompt = optimizedPrompt.trim();

  if (
    normalizedMaxPromptLength == null
    || normalizedPrompt.length <= normalizedMaxPromptLength
  ) {
    return normalizedPrompt;
  }

  const requiredTokens = dedupeReferenceTokens(originalPrompt);
  if (requiredTokens.length === 0) {
    return truncatePromptAtBoundary(normalizedPrompt, normalizedMaxPromptLength);
  }

  const tokenSuffix = requiredTokens.join(" ");
  if (tokenSuffix.length >= normalizedMaxPromptLength) {
    return tokenSuffix.slice(0, normalizedMaxPromptLength).trim();
  }

  const contentBudget = normalizedMaxPromptLength - tokenSuffix.length - 1;
  const promptWithoutTokens = normalizedPrompt
    .replace(ALL_REFERENCE_TOKEN_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const truncatedContent =
    contentBudget > 0
      ? truncatePromptAtBoundary(promptWithoutTokens, contentBudget)
      : "";
  const nextPrompt = truncatedContent
    ? `${truncatedContent}\n${tokenSuffix}`
    : tokenSuffix;

  if (nextPrompt.length <= normalizedMaxPromptLength) {
    return nextPrompt.trim();
  }

  return truncatePromptAtBoundary(nextPrompt, normalizedMaxPromptLength);
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

function sanitizeReferenceImageBindings(
  referenceImageBindings: PromptReferenceImageBinding[] | undefined,
): PromptReferenceImageBinding[] {
  if (
    !Array.isArray(referenceImageBindings)
    || referenceImageBindings.length === 0
  ) {
    return [];
  }

  const result: PromptReferenceImageBinding[] = [];
  const seenTokens = new Set<string>();

  for (const binding of referenceImageBindings) {
    const token =
      typeof binding?.token === "string" ? binding.token.trim() : "";
    const imageUrl =
      typeof binding?.imageUrl === "string" ? binding.imageUrl.trim() : "";
    if (
      !token
      || !imageUrl
      || seenTokens.has(token)
      || !VALID_IMAGE_REFERENCE_TOKEN_PATTERN.test(token)
    ) {
      continue;
    }

    result.push({
      token,
      imageUrl,
    });
    seenTokens.add(token);
    if (result.length >= 4) {
      break;
    }
  }

  return result;
}

function resolveOptimizationReferenceImageInputs(
  request: OptimizePromptRequest,
  supportsImageAnalysis: boolean,
): ResolvedReferenceImageInputs {
  if (!supportsImageAnalysis) {
    return {
      referenceImages: [],
      referenceImageBindings: [],
    };
  }

  const referenceImageBindings = sanitizeReferenceImageBindings(
    request.referenceImageBindings,
  );
  if (referenceImageBindings.length > 0) {
    return {
      referenceImages: referenceImageBindings.map((binding) => binding.imageUrl),
      referenceImageBindings,
    };
  }

  return {
    referenceImages: sanitizeReferenceImages(request.referenceImages),
    referenceImageBindings: [],
  };
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

function buildReferenceImageInstruction(
  bias: ReferenceImageAnalysisBias,
  useReferenceImages: boolean,
  referenceImageBindings: PromptReferenceImageBinding[],
): string {
  if (!useReferenceImages) {
    return "No reference images are attached for this optimization pass. Optimize only from the source prompt itself.";
  }

  const biasInstruction =
    bias === "static"
      ? "Treat each attached reference image as a static visual anchor for subject appearance, wardrobe, material details, composition, lighting, color palette, spatial relationships, and style continuity. Do not infer new motion, camera moves, or plot beats from a still image."
      : "Treat each attached reference image as a motion-oriented anchor for character or scene continuity, likely starting frame or pose, action direction, lens distance or angle tendency, movement energy, and rhythm mood. You may translate a still image into a plausible dynamic cue, but do not invent extra story events or a full shot list.";

  const bindingLines =
    referenceImageBindings.length > 0
      ? [
          "Attachment-to-token mapping:",
          ...referenceImageBindings.map(
            (binding, index) =>
              `Attachment ${index + 1} corresponds to ${binding.token}.`,
          ),
          "Only use each attachment to interpret its mapped token. Do not swap attachments or merge mapped details unless the source prompt explicitly asks for it.",
        ]
      : [];

  return [
    referenceImageBindings.length > 0
      ? "Reference images are attached for explicit token analysis."
      : "Reference images are attached for prompt optimization.",
    biasInstruction,
    "Use attached reference images only to reinforce facts already grounded in the source prompt. Do not invent new characters, props, locations, story events, or hard constraints from the images alone.",
    ...bindingLines,
  ].join("\n");
}

function buildReferenceAwarePromptOptimizationInstruction(
  mode: PromptOptimizationMode,
  prompt: string,
  useReferenceImages: boolean,
  referenceImageBindings: PromptReferenceImageBinding[],
): string {
  const modeSpecificInstruction =
    mode === "image"
      ? [
          "You are lightly optimizing an AI image-generation prompt.",
          "Keep the original meaning and all hard facts unchanged.",
          "Improve clarity around composition, lighting, texture, color, material cues, and spatial detail, but do not invent new subjects, props, actions, scenes, plot beats, or constraints.",
          "Prefer 2 to 4 concrete visual improvements over long adjective stacks.",
          "If the source prompt is already specific, keep the rewrite restrained.",
        ].join("\n")
      : [
          "You are lightly optimizing an AI video-generation prompt.",
          "Keep the original meaning and all hard facts unchanged.",
          "Improve clarity around motion, shot feel, pacing, camera tendency, and action readability, but do not invent new characters, props, locations, plot beats, or extra shot events.",
          "Prefer 2 to 4 concrete dynamic or cinematic improvements over long adjective stacks.",
          "If the source prompt does not imply complex camera movement, keep the rewrite restrained.",
        ].join("\n");

  return [
    modeSpecificInstruction,
    buildReferenceImageInstruction(
      mode === "image" ? "static" : "dynamic",
      useReferenceImages,
      referenceImageBindings,
    ),
    "Keep the optimized prompt in the same primary language as the source prompt. If the source prompt is mainly English, return English. If it is mainly Chinese, return Chinese. Do not translate it into another language.",
    "Preserve all explicit facts from the source prompt, including subject count, identity, relationships, wardrobe, props, setting, time, style, aspect ratio, duration, and any other hard constraints.",
    "If the prompt contains tokens like @\u56fe1 or @\u56fe\u72472, preserve them exactly as written. Do not rename, renumber, delete, add, or reinterpret those tokens.",
    "Make the result slightly richer than the source while keeping it compact and directly usable for generation.",
    "Do not output explanations, analysis, headings, or quotation marks. Output only the final optimized prompt text.",
    "",
    "Source prompt:",
    prompt.trim(),
  ].join("\n");
}

function buildReferenceAwareJimengPromptOptimizationInstruction(
  prompt: string,
  useReferenceImages: boolean,
  referenceImageBindings: PromptReferenceImageBinding[],
): string {
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
    buildReferenceImageInstruction(
      "dynamic",
      useReferenceImages,
      referenceImageBindings,
    ),
    "The added detail should mainly enrich lighting, texture, atmosphere, composition, motion quality, and a small amount of scene detail. It must not change the narrative facts.",
    ...JIMENG_STRUCTURAL_CONTENT_PRESERVATION_INSTRUCTIONS,
    "If the prompt contains reference tokens like @\u56fe1, @\u56fe\u72472, @\u97f31, or @\u97f3\u98912, preserve them exactly as written.",
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

function buildPromptOptimizationInstruction(
  mode: PromptOptimizationMode,
  prompt: string,
  useReferenceImages: boolean,
  referenceImageBindings: PromptReferenceImageBinding[],
): string {
  return buildReferenceAwarePromptOptimizationInstruction(
    mode,
    prompt,
    useReferenceImages,
    referenceImageBindings,
  );

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
    "Keep the optimized prompt in the same primary language as the source prompt. If the source prompt is mainly English, return English. If it is mainly Chinese, return Chinese. Do not translate it into another language.",
    "必须保留原提示词里所有明确事实，包括人物数量、身份关系、服装、道具、地点、时间、风格、比例、时长和限定词。",
    "如果提示词中出现 @图片1、@图片2 这类引用，你必须原样保留，不能改名、删除、增补，也不要改变它们的含义。",
    "结果要比原文稍微更丰满一点，但仍然保持紧凑、可直接用于生成。",
    "不要输出解释，不要输出分析，不要加标题，不要加引号，只输出最终优化后的提示词正文。",
    "",
    "原始提示词：",
    prompt.trim(),
  ].join("\n");
}

function buildTtsVoicePromptOptimizationInstruction(prompt: string): string {
  return buildTtsVoicePromptOptimizationInstructionEnhanced(prompt);

  // Legacy fallback kept in place for historical context.
  return [
    "你现在要优化一段中文 TTS 声音画像提示词。",
    "请在不改变原意和已明确身份特征的前提下，把它润色成更成熟、更细腻、更适合直接用于声音设计模型的中文描述。",
    "保留原文中已经明确写出的年龄感、性别气质、情绪状态、音色方向、语言风格、口音方言、说话速度、亲密度、叙述距离等信息，不要改掉核心设定。",
    "允许做一层中等强度的丰富化优化，不要只做轻微同义替换；可以适度补足声音质感、气息感、共鸣位置、咬字方式、情绪克制或张力、温度感、贴耳感、陪伴感、清冷感、明亮度、沙哑度、成熟度等对声音有帮助的维度。",
    "如果原文比较简短或泛泛，可以在不凭空编造剧情和人物设定的前提下，把它整理成更完整、更有可执行性的声音画像。",
    "优先让结果听起来像专业的声音设定文案，而不是关键词堆砌；既要有画面感，也要让模型容易理解和执行。",
    "不要添加剧情、镜头、场景、美术、配乐、音效、世界观或无关设定。",
    "不要添加技术参数、停顿控制符、括号注释、项目符号、标题或解释说明。",
    "结果可以比原文更丰富一点，但仍然要紧凑、清晰、自然，通常控制在 2 到 4 个短分句内。",
    "只输出最终优化后的中文声音画像正文。",
    "",
    "原始声音画像：",
    prompt.trim(),
  ].join("\n");
}

function buildTtsVoicePromptOptimizationInstructionEnhanced(
  prompt: string,
): string {
  return [
    "你现在要优化一段中文 TTS 声音画像提示词。",
    "请在不改变原意和已明确身份特征的前提下，把它整理成更成熟、更细腻、更适合直接用于声音设计模型的中文描述。",
    "优先从这些角度提炼和优化：音高、情绪、气势、年龄感、语速、音色质感、语调、性格、自然感。",
    "如果输入里提供了角色信息、人物设定、身份背景、气质描述或剧情语境，请先从角色信息中提炼出对声音最关键的特征，再转写成可直接用于声音画像的描述。",
    "保留原文中已经明确写出的年龄感、性别气质、情绪状态、音色方向、语言风格、口音方言、说话速度、亲密度、叙述距离等信息，不要改掉核心设定。",
    "允许做一层中等强度的丰富化优化，不要只做轻微同义替换；可以适度补足声音的高低位置、明暗冷暖、厚薄虚实、气息松紧、共鸣位置、咬字方式、语调起伏、性格锋利度或亲和度、情绪张力和自然交流感。",
    "如果原文比较简短、笼统或泛泛，可以在不凭空编造剧情和人物设定的前提下，把它补成更完整、更有执行性的声音画像。",
    "结果要像专业的声音设定文案，而不是关键词堆砌；既要有画面感，也要让模型容易理解和执行。",
    "不要添加剧情、镜头、场景、美术、配乐、音效、世界观或无关设定。",
    "不要添加技术参数、停顿控制符、括号注释、项目符号、标题或解释说明。",
    "结果可以比原文更丰富一点，但仍然要紧凑、自然、清晰，通常控制在 2 到 4 个短分句内。",
    "只输出最终优化后的中文声音画像正文。",
    "",
    "原始声音画像：",
    prompt.trim(),
  ].join("\n");
}

function buildDialoguePromptOptimizationInstruction(prompt: string): string {
  return [
    "你现在要优化一段中文对白模板、台词草稿或旁白文案。",
    "请在不改变原意、人物关系、关键信息、场景事实和情绪走向的前提下，把文本润色得更自然、更顺口、更有画面感，也更适合直接用于对白创作、旁白文案或配音录制。",
    "如果原文已经有角色名、分行、段落、对话格式或 Markdown 结构，请尽量保留原有结构，只优化表达、节奏、停顿感和语言质感。",
    "如果原文是对白模板，可以适度增强人物说话方式、口语节奏、情绪层次、潜台词和张力，但不要凭空增加新人物、新剧情、新设定或额外场景。",
    "如果原文是旁白、独白或说明性文字，可以适度增强镜头感、情绪递进、叙述流动性和可听感，让文本更像成熟文案，而不是口号或提纲。",
    "允许做一层中等强度的丰富化优化，不要只是轻微改字词，也不要改写成完全不同的内容。",
    "优先优化这些维度：口语自然度、表达清晰度、人物语气区分、节奏停顿、情绪递进、潜台词、台词张力、可配音朗读性。",
    "如果原文偏短，可以在不改变事实的前提下适度补全半句、语气连接、动作感受或情绪承接，让成品更完整一些。",
    "避免空泛抒情、避免堆砌辞藻、避免模板腔、避免分析说明、避免输出标题、引号、编号或注释。",
    "只输出最终优化后的正文内容。",
    "",
    "原始文本：",
    prompt.trim(),
  ].join("\n");
}

function buildJimengPromptOptimizationInstruction(
  prompt: string,
  useReferenceImages: boolean,
  referenceImageBindings: PromptReferenceImageBinding[],
): string {
  return buildReferenceAwareJimengPromptOptimizationInstruction(
    prompt,
    useReferenceImages,
    referenceImageBindings,
  );

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
    ...JIMENG_STRUCTURAL_CONTENT_PRESERVATION_INSTRUCTIONS,
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
  const {
    referenceImages,
    referenceImageBindings,
  } = resolveOptimizationReferenceImageInputs(
    request,
    context.supportsImageAnalysis,
  );

  const result = await generateText({
    prompt:
      request.mode === "jimeng" || request.mode === "video"
        ? buildJimengPromptOptimizationInstruction(
            normalizedPrompt,
            referenceImages.length > 0,
            referenceImageBindings,
          )
        : request.mode === "dialogue"
          ? buildDialoguePromptOptimizationInstruction(normalizedPrompt)
        : request.mode === "ttsVoice"
          ? buildTtsVoicePromptOptimizationInstruction(normalizedPrompt)
        : buildPromptOptimizationInstruction(
            request.mode,
            normalizedPrompt,
            referenceImages.length > 0,
            referenceImageBindings,
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
      prompt: applyOptimizedPromptLengthLimit(
        normalizedPrompt,
        parsedResult.prompt,
        request.maxPromptLength,
      ),
      context,
      usedReferenceImages: referenceImages.length > 0,
      usedReferenceImageCount: referenceImages.length,
      durationRecommendation: parsedResult.durationRecommendation,
    };
  }

  const normalizedResult = applyOptimizedPromptLengthLimit(
    normalizedPrompt,
    restoreReferenceTokens(
      normalizedPrompt,
      normalizeOptimizedPrompt(result.text),
    ),
    request.maxPromptLength,
  );
  if (!normalizedResult) {
    throw new Error("提示词优化结果为空，请重试");
  }

  return {
    prompt: normalizedResult,
    context,
    usedReferenceImages: referenceImages.length > 0,
    usedReferenceImageCount: referenceImages.length,
    durationRecommendation: null,
  };
}
