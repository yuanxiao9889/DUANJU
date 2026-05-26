import { generateText } from '@/commands/textGen';
import {
  type CommerceAdAgentAction,
  type CommerceAdAgentGuidance,
  type CommerceAdAgentMessage,
  type CommerceAdBatchGenerateState,
  type CommerceAdBriefState,
  type CommerceAdDetailPage,
  type CommerceAdDesignDirection,
  type CommerceAdGuidanceQuestion,
  type CommerceAdProductState,
  type CommerceAdVisualPreferenceState,
  createDefaultCommerceAdVisualPreferenceState,
  normalizeCommerceAdVisualPreferenceState,
} from '@/features/commerce-ad/types';

export interface CommerceAdAgentTurnInput {
  userMessage: string;
  product: CommerceAdProductState | null;
  brief: CommerceAdBriefState | null;
  visualPreference: CommerceAdVisualPreferenceState | null;
  batch: CommerceAdBatchGenerateState | null;
  referenceImages: string[];
  canUseVisionModel: boolean;
}

export interface CommerceAdAgentTurnResult {
  assistantMessage: CommerceAdAgentMessage;
  actions: CommerceAdAgentAction[];
}

function createMessage(
  role: CommerceAdAgentMessage['role'],
  content: string,
  guidance?: CommerceAdAgentGuidance
): CommerceAdAgentMessage {
  return {
    id: `commerce-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(guidance ? { guidance } : {}),
  };
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = (() => {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  })();
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRecordArray(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  ));
}

function normalizeId(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeGuidanceStage(value: string): CommerceAdAgentGuidance['stage'] {
  return ['upload', 'infer', 'brief', 'direction', 'generation'].includes(value)
    ? value as CommerceAdAgentGuidance['stage']
    : 'brief';
}

function readGuidanceQuestions(record: Record<string, unknown>): CommerceAdGuidanceQuestion[] {
  return readRecordArray(record, 'questions')
    .map((item, index): CommerceAdGuidanceQuestion | null => {
      const label = readString(item, 'label') || readString(item, 'question');
      if (!label) {
        return null;
      }
      const rawOptions = Array.isArray(item.options) ? item.options : [];
      const options = rawOptions
        .map((option, optionIndex) => {
          if (typeof option === 'string') {
            const value = option.trim();
            return value
              ? {
                  id: normalizeId(value, `question-${index + 1}-option-${optionIndex + 1}`),
                  label: value,
                  value,
                }
              : null;
          }
          if (!option || typeof option !== 'object' || Array.isArray(option)) {
            return null;
          }
          const optionRecord = option as Record<string, unknown>;
          const optionLabel = readString(optionRecord, 'label') || readString(optionRecord, 'title');
          const optionValue = readString(optionRecord, 'value') || optionLabel;
          return optionLabel
            ? {
                id: normalizeId(readString(optionRecord, 'id') || optionLabel, `question-${index + 1}-option-${optionIndex + 1}`),
                label: optionLabel,
                value: optionValue,
              }
            : null;
        })
        .filter((option): option is CommerceAdGuidanceQuestion['options'][number] => Boolean(option));

      return {
        id: normalizeId(readString(item, 'id') || label, `question-${index + 1}`),
        label,
        allowMultiple: Boolean(item.allowMultiple ?? true),
        options,
      };
    })
    .filter((item): item is CommerceAdGuidanceQuestion => Boolean(item));
}

function readDesignDirections(record: Record<string, unknown>): CommerceAdDesignDirection[] {
  return readRecordArray(record, 'designDirections')
    .map((item, index): CommerceAdDesignDirection | null => {
      const title = readString(item, 'title') || readString(item, 'label');
      const description = readString(item, 'description') || readString(item, 'value');
      if (!title && !description) {
        return null;
      }
      const fallbackTitle = title || description;
      return {
        id: normalizeId(readString(item, 'id') || fallbackTitle, `direction-${index + 1}`),
        title: fallbackTitle,
        description,
        tags: readStringArray(item, 'tags'),
      };
    })
    .filter((item): item is CommerceAdDesignDirection => Boolean(item));
}

function readDetailPages(record: Record<string, unknown>, fallbackLockedCopy: string): CommerceAdDetailPage[] {
  return readRecordArray(record, 'detailPages')
    .map((item, index): CommerceAdDetailPage | null => {
      const title = readString(item, 'title');
      const lockedCopy = readString(item, 'lockedCopy');
      const optimizedCopy = readString(item, 'optimizedCopy');
      const layoutNotes = readString(item, 'layoutNotes');
      const prompt = readString(item, 'prompt');
      if (!title && !lockedCopy && !optimizedCopy && !layoutNotes && !prompt) {
        return null;
      }

      return {
        id: normalizeId(readString(item, 'id') || title || `detail-page-${index + 1}`, `detail-page-${index + 1}`),
        pageNo: Math.max(1, Math.round(Number(item.pageNo) || index + 1)),
        title,
        lockedCopy: lockedCopy || (index === 0 ? fallbackLockedCopy : ''),
        optimizedCopy,
        layoutNotes,
        prompt,
      };
    })
    .filter((item): item is CommerceAdDetailPage => Boolean(item))
    .sort((left, right) => left.pageNo - right.pageNo)
    .map((item, index) => ({
      ...item,
      pageNo: index + 1,
    }));
}

function readGuidance(record: Record<string, unknown>): CommerceAdAgentGuidance | undefined {
  const guidanceRecord = readRecord(record, 'guidance');
  if (Object.keys(guidanceRecord).length === 0) {
    return undefined;
  }

  return {
    stage: normalizeGuidanceStage(readString(guidanceRecord, 'stage')),
    summary: readString(guidanceRecord, 'summary'),
    confirmedFacts: readStringArray(guidanceRecord, 'confirmedFacts'),
    missingFields: readStringArray(guidanceRecord, 'missingFields'),
    questions: readGuidanceQuestions(guidanceRecord),
    designDirections: readDesignDirections(guidanceRecord),
    quickReplies: readStringArray(guidanceRecord, 'quickReplies'),
    readinessHint: readString(guidanceRecord, 'readinessHint'),
  };
}

function buildFallbackGuidance(
  product: CommerceAdProductState | null,
  brief: Partial<CommerceAdBriefState> | null,
  stage: CommerceAdAgentGuidance['stage'] = 'brief'
): CommerceAdAgentGuidance {
  const confirmedFacts = [
    product?.productName || product?.inference?.productType || product?.category || '',
    product?.brand ? `品牌：${product.brand}` : '',
    brief?.platform ? `平台：${brief.platform}` : '',
    brief?.audience ? `人群：${brief.audience}` : '',
    brief?.style ? `风格：${brief.style}` : '',
  ].filter(Boolean);

  return {
    stage,
    summary: product?.inference?.summary || product?.userInfo || brief?.normalizedBrief || '',
    confirmedFacts,
    missingFields: ['平台/投放场景', '目标人群', '主卖点', '画面风格', '必须出现的文案'],
    questions: [
      {
        id: 'platform',
        label: '这组图主要投放在哪个平台或场景？',
        allowMultiple: true,
        options: [
          { id: 'xiaohongshu', label: '小红书种草', value: '小红书种草' },
          { id: 'tmall', label: '淘宝/天猫主图', value: '淘宝/天猫主图' },
          { id: 'douyin', label: '抖音信息流', value: '抖音信息流' },
        ],
      },
      {
        id: 'style',
        label: '你更想优先探索哪类视觉方向？',
        allowMultiple: true,
        options: [
          { id: 'minimal-premium', label: '极简高级', value: '极简高级' },
          { id: 'lifestyle-scene', label: '生活场景', value: '生活场景' },
          { id: 'promotion-benefit', label: '促销利益点', value: '促销利益点' },
        ],
      },
    ],
    designDirections: [
      {
        id: 'hero-clean',
        title: '极简产品主视觉',
        description: '突出产品外观、质感和核心卖点，适合主图或品牌感广告。',
        tags: ['主图', '质感', '留白'],
      },
      {
        id: 'lifestyle-scene',
        title: '场景化使用图',
        description: '把产品放进真实使用场景，帮助用户快速理解使用价值。',
        tags: ['场景', '人群', '种草'],
      },
      {
        id: 'benefit-poster',
        title: '利益点海报',
        description: '用更强标题和视觉层级放大卖点、优惠或活动信息。',
        tags: ['转化', '标题', '促销'],
      },
    ],
    quickReplies: ['帮我补成小红书风格', '突出高级感和质感', '先做主图和详情页首图'],
    readinessHint: '先确认平台、人群和视觉方向，我会把这些信息同步到左侧 Brief 节点。',
  };
}

function mergeGuidance(
  guidance: CommerceAdAgentGuidance | undefined,
  fallback: CommerceAdAgentGuidance
): CommerceAdAgentGuidance {
  if (!guidance) {
    return fallback;
  }

  return {
    stage: guidance.stage || fallback.stage,
    summary: guidance.summary || fallback.summary,
    confirmedFacts: guidance.confirmedFacts.length > 0 ? guidance.confirmedFacts : fallback.confirmedFacts,
    missingFields: guidance.missingFields.length > 0 ? guidance.missingFields : fallback.missingFields,
    questions: guidance.questions.length > 0 ? guidance.questions : fallback.questions,
    designDirections: guidance.designDirections.length > 0 ? guidance.designDirections : fallback.designDirections,
    quickReplies: guidance.quickReplies.length > 0 ? guidance.quickReplies : fallback.quickReplies,
    readinessHint: guidance.readinessHint || fallback.readinessHint,
  };
}

function buildFallbackBrief(product: CommerceAdProductState | null, userMessage: string): Partial<CommerceAdBriefState> {
  const sellingPoints = product?.inference?.visibleSellingPoints ?? [];
  const productName = product?.productName || product?.inference?.productType || product?.category || '商品';
  const normalizedBrief = [
    `商品：${productName}`,
    product?.brand ? `品牌：${product.brand}` : '',
    userMessage ? `用户需求：${userMessage}` : '',
    sellingPoints.length > 0 ? `可见卖点：${sellingPoints.join('、')}` : '',
  ].filter(Boolean).join('\n');

  return {
    normalizedBrief,
    sellingPoints,
    updatedAt: Date.now(),
  };
}

function buildDetailFallbackBrief(product: CommerceAdProductState | null, userMessage: string): Partial<CommerceAdBriefState> {
  const base = buildFallbackBrief(product, userMessage);
  const lockedDocumentInfo = product?.lockedDocumentInfo?.trim() ?? '';
  const userIdeaInfo = product?.userIdeaInfo?.trim() || product?.userInfo?.trim() || userMessage.trim();
  const optimizedUserIdeaInfo = userIdeaInfo ? `围绕详情页目标优化表达：${userIdeaInfo}` : '';
  const productName = product?.productName || product?.inference?.productType || product?.category || '商品';
  const normalizedBrief = [
    base.normalizedBrief,
    lockedDocumentInfo ? `不可改文档信息：${lockedDocumentInfo}` : '',
    optimizedUserIdeaInfo,
  ].filter(Boolean).join('\n');

  return {
    ...base,
    normalizedBrief,
    optimizedUserIdeaInfo,
    detailPages: [
      {
        id: 'detail-page-1',
        pageNo: 1,
        title: productName || '产品核心卖点',
        lockedCopy: lockedDocumentInfo,
        optimizedCopy: optimizedUserIdeaInfo,
        layoutNotes: '详情页首屏，突出商品主体、核心卖点和信任信息。',
        prompt: [
          `制作电商详情页第 1 页：${productName || '产品核心卖点'}`,
          lockedDocumentInfo ? `必须原样展示以下文档信息：${lockedDocumentInfo}` : '',
          optimizedUserIdeaInfo,
        ].filter(Boolean).join('\n'),
      },
    ],
    updatedAt: Date.now(),
  };
}

function buildDetailFallbackCorePrompt(
  product: CommerceAdProductState | null,
  brief: Partial<CommerceAdBriefState>
): string {
  return [
    buildFallbackCorePrompt(product, brief),
    '目标是制作电商详情页分页图片，而不是单张通用广告图；每页一张图，信息主题清晰。',
    product?.lockedDocumentInfo ? `不可改文档信息必须原样进入相关页面：${product.lockedDocumentInfo}` : '',
    brief.optimizedUserIdeaInfo ? `用户想法优化表达：${brief.optimizedUserIdeaInfo}` : '',
  ].filter(Boolean).join(' ');
}

function buildFallbackCorePrompt(product: CommerceAdProductState | null, brief: Partial<CommerceAdBriefState>): string {
  const productName = product?.productName || product?.inference?.productType || product?.category || '该商品';
  const style = brief.style || '干净、高级、有电商转化感';
  const headline = brief.headline ? `画面中可加入清晰可读的广告文案：“${brief.headline}”。` : '';
  const sellingPoints = brief.sellingPoints?.length ? `重点卖点：${brief.sellingPoints.join('、')}。` : '';

  return [
    `为${productName}生成一张高完成度的电商广告图。`,
    `画面风格：${style}。`,
    sellingPoints,
    headline,
    brief.cta ? `行动号召文案：${brief.cta}。` : '',
    brief.constraints ? `限制要求：${brief.constraints}。` : '',
    '严格保持参考商品的外观、比例、结构和关键细节一致；使用高级商业布光、清晰构图和真实材质表现；只有在明确要求时才生成画面文字。',
  ].filter(Boolean).join(' ');
}

function composeVisualPreferencePromptFragment(
  visualPreference: CommerceAdVisualPreferenceState
): string {
  const accent = visualPreference.brandAccentColor.toLowerCase() === 'auto'
    ? '品牌强调色自动从商品主色或品牌识别中提取'
    : `品牌强调色使用 ${visualPreference.brandAccentColor}`;
  return [
    '视觉与排版偏好：',
    `设计风格为${visualPreference.designStyle}`,
    `整体配色为${visualPreference.colorPalette}`,
    `平台视觉偏好为${visualPreference.platformVisual}`,
    `画面语言为${visualPreference.language}`,
    accent,
    visualPreference.summary ? `偏好摘要：${visualPreference.summary}` : '',
  ].filter(Boolean).join('，') + '。';
}

function buildFallbackVisualPreference(
  product: CommerceAdProductState | null,
  brief: Partial<CommerceAdBriefState> | null,
  current: CommerceAdVisualPreferenceState | null
): CommerceAdVisualPreferenceState {
  const base = normalizeCommerceAdVisualPreferenceState(current ?? null);
  const inferredPlatform = brief?.platform?.trim();
  const inferredStyle = brief?.style?.trim();
  const inferredProduct = product?.productName || product?.inference?.productType || product?.category || '商品';
  const next: CommerceAdVisualPreferenceState = {
    ...base,
    designStyle: inferredStyle || base.designStyle,
    platformVisual: inferredPlatform || base.platformVisual,
    summary: base.summary || `围绕${inferredProduct}自动匹配视觉风格、配色层级和平台版式。`,
    updatedAt: Date.now(),
  };
  return {
    ...next,
    promptFragment: composeVisualPreferencePromptFragment(next),
  };
}

function appendVisualPreferenceToPrompt(
  prompt: string,
  visualPreference: CommerceAdVisualPreferenceState
): string {
  const fragment = visualPreference.promptFragment || composeVisualPreferencePromptFragment(visualPreference);
  if (!fragment.trim()) {
    return prompt;
  }
  if (prompt.includes(fragment)) {
    return prompt;
  }
  return [prompt.trim(), fragment.trim()].filter(Boolean).join(' ');
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function isMostlyEnglishText(value: string): boolean {
  const letters = value.match(/[a-z]/gi)?.length ?? 0;
  const cjk = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  return letters >= 8 && cjk === 0;
}

function extractChineseSellingPoints(...texts: string[]): string[] {
  const candidates: string[] = [];

  for (const text of texts) {
    const normalized = text.trim();
    if (!normalized || !hasCjkText(normalized)) {
      continue;
    }

    const focusedMatch = normalized.match(/(?:优势|卖点|特点|亮点)(?:是|包括|为)?[:：]([^。！？\n]+)/u);
    const source = focusedMatch?.[1] ?? normalized;
    source
      .split(/[、，,；;\n]/u)
      .map((item) => item.replace(/^[\s：:.-]+|[\s。.!?；;，,]+$/gu, '').trim())
      .filter((item) => hasCjkText(item) && item.length >= 2 && item.length <= 18)
      .forEach((item) => candidates.push(item));
  }

  return Array.from(new Set(candidates)).slice(0, 6);
}

function preferChineseSellingPoints(values: string[], fallbackTexts: string[]): string[] {
  const chineseValues = values.filter((item) => hasCjkText(item) || !isMostlyEnglishText(item));
  if (chineseValues.length === values.length) {
    return values;
  }

  const extracted = extractChineseSellingPoints(...fallbackTexts);
  return extracted.length > 0 ? extracted : chineseValues;
}

export function isLikelyVisionTextModel(provider: string | null | undefined, model: string | null | undefined): boolean {
  const normalizedProvider = (provider ?? '').trim().toLowerCase();
  const normalizedModel = (model ?? '').trim().toLowerCase();
  const haystack = `${normalizedProvider} ${normalizedModel}`;

  if (
    normalizedProvider === 'oopii'
    && /^(all|gpt)-5(?:\.\d+)?(?:[-_].*)?$/.test(normalizedModel)
  ) {
    return true;
  }

  const knownVisionKeywords = [
    'vision',
    'vl',
    'qwen-vl',
    'qwen2.5-vl',
    'qwen2-vl',
    'omni',
    'gpt-4o',
    'gpt-5',
    'gemini',
    'claude-3',
    'doubao',
    'seed',
    'multimodal',
  ];

  if (knownVisionKeywords.some((keyword) => haystack.includes(keyword))) {
    return true;
  }

  return [
    /\bgpt-4o(?:\b|[-_])/,
    /\bgpt-4\.1(?:\b|[-_])/,
    /\bgpt-4\.5(?:\b|[-_])/,
    /\bclaude-(?:3|3\.5|3\.7|4)(?:\b|[-_])/,
    /\bclaude-(?:sonnet|opus|haiku)-4(?:\b|[-_])/,
    /\bgemini-(?:1\.5|2|2\.0|2\.5|3|3\.0|3\.1)(?:\b|[-_])/,
    /\bqwen(?:2|2\.5|3|3\.5)?[-_.]?(?:vl|omni)(?:\b|[-_])/,
    /\bdoubao-(?:.*-)?(?:vision|thinking-vision|seed)(?:\b|[-_])/,
    /\b(?:glm-4v|glm-4\.5v|kimi-vl|step-1v|internvl|llava|pixtral)(?:\b|[-_])/,
  ].some((pattern) => pattern.test(haystack));
}

export async function runCommerceAdAgentTurn(
  input: CommerceAdAgentTurnInput
): Promise<CommerceAdAgentTurnResult> {
  const actions: CommerceAdAgentAction[] = [];
  const message = input.userMessage.trim();

  if (
    input.referenceImages.length > 0
    && !input.canUseVisionModel
    && !input.product?.userInfo.trim()
    && !input.product?.lockedDocumentInfo.trim()
    && !input.product?.userIdeaInfo.trim()
  ) {
    const assistantMessage = createMessage(
      'assistant',
      '我已经收到商品图，但当前文本模型看起来不支持视觉理解。你可以切换到多模态 LLM 后再反推，或先手动补充商品名称、卖点、目标人群，我会继续帮你完善出图 Brief。',
      buildFallbackGuidance(input.product, input.brief, 'infer')
    );
    actions.push({
      type: 'upsertProduct',
      data: {
        lastError: '当前文本模型可能无法识别图片，请切换多模态 LLM 或手动补充商品信息。',
      },
    });
    return { assistantMessage, actions };
  }

  const prompt = [
    'You are the ecommerce ad image design strategist inside a node-canvas app for Chinese users.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    JSON.stringify({
      assistant: '',
      guidance: {
        stage: 'brief',
        summary: '',
        confirmedFacts: [''],
        missingFields: [''],
        questions: [
          {
            id: '',
            label: '',
            allowMultiple: true,
            options: [
              { id: '', label: '', value: '' },
            ],
          },
        ],
        designDirections: [
          {
            id: '',
            title: '',
            description: '',
            tags: [''],
          },
        ],
        quickReplies: [''],
        readinessHint: '',
      },
      product: {
        brand: '',
        productName: '',
        category: '',
        detailInputMode: 'auto',
        lockedDocumentInfo: '',
        userIdeaInfo: '',
        userInfo: '',
        inference: {
          summary: '',
          productType: '',
          visualDescription: '',
          visibleSellingPoints: [''],
          suggestedUseCases: [''],
          uncertaintyNotes: [''],
          followUpQuestions: [''],
        },
      },
      brief: {
        usage: '',
        platform: '',
        audience: '',
        style: '',
        headline: '',
        sellingPoints: [''],
        cta: '',
        mustInclude: '',
        constraints: '',
        normalizedBrief: '',
        optimizedUserIdeaInfo: '',
        detailPages: [
          {
            id: '',
            pageNo: 1,
            title: '',
            lockedCopy: '',
            optimizedCopy: '',
            layoutNotes: '',
            prompt: '',
          },
        ],
      },
      visualPreference: {
        designStyle: '智能匹配',
        colorPalette: '商品主色延展',
        platformVisual: '全平台通用',
        language: '中文（简体）',
        brandAccentColor: 'auto',
        summary: '',
        promptFragment: '',
      },
      batch: {
        generationMode: 'detailPages',
        aspectRatios: ['4:5'],
        variantsPerRatio: 1,
        corePrompt: '',
        ratioPrompts: {
          '4:5': '',
        },
        detailPageIds: [''],
        detailPageCount: 1,
      },
    }),
    '',
    'Rules:',
    '- 默认用简体中文输出所有面向用户展示的 JSON 值，包括 assistant、guidance、product.inference、brief、batch.corePrompt、batch.ratioPrompts。',
    '- 如果用户明确用其他语言要求输出，再跟随用户语言；但用户没有输入或只是上传图片时，必须输出简体中文。',
    '- 品牌名、型号名、平台名、必要的英文广告文案可以保留原文，其余说明尽量中文。',
    '- batch.corePrompt 和 batch.ratioPrompts 也要尽量写中文，保持可读、可直接用于出图。',
    '- This agent now targets ecommerce detail-page images: output brief.detailPages and plan one generated image per page.',
    '- product.lockedDocumentInfo is source copy that MUST NOT be rewritten. Copy it verbatim into product.lockedDocumentInfo and into relevant detailPages[].lockedCopy.',
    '- Never paraphrase lockedDocumentInfo inside optimizedCopy. If a page needs that copy, place the exact original text in lockedCopy and make the page prompt explicitly require it verbatim.',
    '- product.userIdeaInfo can be optimized for clarity and conversion, but do not change facts. Put the polished version in brief.optimizedUserIdeaInfo and related detailPages[].optimizedCopy.',
    '- brief.detailPages must contain id, pageNo, title, lockedCopy, optimizedCopy, layoutNotes, prompt. Each prompt should be production-ready for one detail-page image.',
    '- If product.detailInputMode is manualPages and existing detailPages are provided, preserve page count, page order, pageNo, title, and lockedCopy. Only optimize/fill optimizedCopy, layoutNotes, and prompt.',
    '- batch.generationMode must be detailPages, variantsPerRatio must be 1, and detailPageCount must match brief.detailPages.length.',
    '- Product inference may use the reference image when provided.',
    '- Act like a Chinese visual design consultant, not a command executor.',
    '- Every assistant reply must explain in Chinese what is understood, what is uncertain, and what the user can choose next.',
    '- Always populate guidance with structured cards for the UI.',
    '- If key information is missing, ask 2-4 high-impact Chinese follow-up questions in guidance.questions and product.inference.followUpQuestions.',
    '- Include 2-3 concrete Chinese designDirections when the product is understood or partially understood.',
    '- Before platform, audience, selling points, and style are clear, prioritize Chinese brief refinement instead of pushing generation settings.',
    '- guidance.quickReplies should be short Chinese phrases users can click and edit before sending.',
    '- The image text strategy is baked into the generated image, not editable overlay layers.',
    '- Keep corePrompt production-ready for ecommerce image generation with faithful product preservation, but write it in Chinese by default.',
    '- visualPreference must be Chinese by default and include designStyle, colorPalette, platformVisual, language, brandAccentColor, summary, and a production-ready promptFragment.',
    '- batch.corePrompt and every batch.ratioPrompts value must explicitly include visualPreference.promptFragment constraints.',
    '',
    'Current product state:',
    JSON.stringify(input.product, null, 2),
    '',
    'Current brief state:',
    JSON.stringify(input.brief, null, 2),
    '',
    'Current visual preference state:',
    JSON.stringify(input.visualPreference, null, 2),
    '',
    'Current batch state:',
    JSON.stringify(input.batch, null, 2),
    '',
    'User message:',
    message || '(no new message; analyze current uploaded product image and state)',
  ].join('\n');

  try {
    const result = await generateText({
      prompt,
      temperature: 0.35,
      maxTokens: 2800,
      referenceImages: input.canUseVisionModel ? input.referenceImages : [],
    });
    const parsed = tryParseJsonObject(result.text);
    if (!parsed) {
      throw new Error('Failed to parse commerce agent JSON.');
    }

    const productRecord = readRecord(parsed, 'product');
    const inferenceRecord = readRecord(productRecord, 'inference');
    const briefRecord = readRecord(parsed, 'brief');
    const visualPreferenceRecord = readRecord(parsed, 'visualPreference');
    const batchRecord = readRecord(parsed, 'batch');
    const inferenceSummary = readString(inferenceRecord, 'summary');
    const inferenceVisualDescription = readString(inferenceRecord, 'visualDescription');
    const briefNormalizedBrief = readString(briefRecord, 'normalizedBrief');
    const visibleSellingPoints = preferChineseSellingPoints(
      readStringArray(inferenceRecord, 'visibleSellingPoints'),
      [inferenceSummary, inferenceVisualDescription, briefNormalizedBrief]
    );
    const briefSellingPoints = preferChineseSellingPoints(
      readStringArray(briefRecord, 'sellingPoints'),
      [briefNormalizedBrief, inferenceSummary, inferenceVisualDescription]
    );
    const ratioPrompts: Record<string, string> = batchRecord.ratioPrompts && typeof batchRecord.ratioPrompts === 'object'
      ? Object.fromEntries(
          Object.entries(batchRecord.ratioPrompts as Record<string, unknown>)
            .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
            .filter(([, value]) => value.length > 0)
        )
      : {};
    const lockedDocumentInfo = readString(productRecord, 'lockedDocumentInfo') || input.product?.lockedDocumentInfo || '';
    const userIdeaInfo = readString(productRecord, 'userIdeaInfo') || input.product?.userIdeaInfo || input.product?.userInfo || message;
    const parsedDetailPages = readDetailPages(briefRecord, lockedDocumentInfo);

    const productData: Partial<CommerceAdProductState> = {
      brand: readString(productRecord, 'brand') || input.product?.brand || '',
      productName: readString(productRecord, 'productName') || input.product?.productName || '',
      category: readString(productRecord, 'category') || input.product?.category || '',
      detailInputMode: productRecord.detailInputMode === 'manualPages'
        ? 'manualPages'
        : input.product?.detailInputMode ?? 'auto',
      lockedDocumentInfo,
      userIdeaInfo,
      userInfo: readString(productRecord, 'userInfo') || input.product?.userInfo || [
        lockedDocumentInfo,
        userIdeaInfo,
      ].filter(Boolean).join('\n\n'),
      inference: {
        summary: inferenceSummary,
        productType: readString(inferenceRecord, 'productType'),
        visualDescription: inferenceVisualDescription,
        visibleSellingPoints,
        suggestedUseCases: readStringArray(inferenceRecord, 'suggestedUseCases'),
        uncertaintyNotes: readStringArray(inferenceRecord, 'uncertaintyNotes'),
        followUpQuestions: readStringArray(inferenceRecord, 'followUpQuestions'),
      },
      lastAnalyzedAt: input.referenceImages.length > 0 ? Date.now() : input.product?.lastAnalyzedAt ?? null,
      lastError: null,
    };
    const briefData: Partial<CommerceAdBriefState> = {
      usage: readString(briefRecord, 'usage'),
      platform: readString(briefRecord, 'platform'),
      audience: readString(briefRecord, 'audience'),
      style: readString(briefRecord, 'style'),
      headline: readString(briefRecord, 'headline'),
      sellingPoints: briefSellingPoints,
      cta: readString(briefRecord, 'cta'),
      mustInclude: readString(briefRecord, 'mustInclude'),
      constraints: readString(briefRecord, 'constraints'),
      normalizedBrief: briefNormalizedBrief,
      optimizedUserIdeaInfo: readString(briefRecord, 'optimizedUserIdeaInfo') || userIdeaInfo,
      detailPages: parsedDetailPages,
      updatedAt: Date.now(),
    };
    const fallbackProductForBrief: CommerceAdProductState = {
      ...(input.product ?? {
        images: [],
        brand: '',
        productName: '',
        category: '',
        detailInputMode: 'auto',
        lockedDocumentInfo: '',
        userIdeaInfo: '',
        userInfo: '',
        inference: null,
        lastAnalyzedAt: null,
        lastError: null,
      }),
      lockedDocumentInfo,
      userIdeaInfo,
      detailInputMode: productData.detailInputMode ?? input.product?.detailInputMode ?? 'auto',
      userInfo: productData.userInfo ?? '',
    };
    const fallbackBrief = buildDetailFallbackBrief(fallbackProductForBrief, message);
    const mergedBrief = {
      ...fallbackBrief,
      ...Object.fromEntries(Object.entries(briefData).filter(([, value]) => (
        Array.isArray(value) ? value.length > 0 : Boolean(value)
      ))),
    };
    const parsedVisualPreference = normalizeCommerceAdVisualPreferenceState({
      ...(input.visualPreference ?? createDefaultCommerceAdVisualPreferenceState()),
      designStyle: readString(visualPreferenceRecord, 'designStyle') || input.visualPreference?.designStyle,
      colorPalette: readString(visualPreferenceRecord, 'colorPalette') || input.visualPreference?.colorPalette,
      platformVisual: readString(visualPreferenceRecord, 'platformVisual') || input.visualPreference?.platformVisual,
      language: readString(visualPreferenceRecord, 'language') || input.visualPreference?.language,
      brandAccentColor: readString(visualPreferenceRecord, 'brandAccentColor') || input.visualPreference?.brandAccentColor,
      summary: readString(visualPreferenceRecord, 'summary') || input.visualPreference?.summary,
      promptFragment: readString(visualPreferenceRecord, 'promptFragment') || input.visualPreference?.promptFragment,
      updatedAt: Date.now(),
    });
    const visualPreferenceData = {
      ...parsedVisualPreference,
      promptFragment: readString(visualPreferenceRecord, 'promptFragment')
        || composeVisualPreferencePromptFragment(parsedVisualPreference),
      updatedAt: Date.now(),
    };
    const corePrompt = appendVisualPreferenceToPrompt(
      readString(batchRecord, 'corePrompt') || buildDetailFallbackCorePrompt(fallbackProductForBrief, mergedBrief),
      visualPreferenceData
    );
    const guidanceProduct: CommerceAdProductState = {
      images: input.product?.images ?? [],
      brand: productData.brand ?? input.product?.brand ?? '',
      productName: productData.productName ?? input.product?.productName ?? '',
      category: productData.category ?? input.product?.category ?? '',
      detailInputMode: productData.detailInputMode ?? input.product?.detailInputMode ?? 'auto',
      lockedDocumentInfo: productData.lockedDocumentInfo ?? input.product?.lockedDocumentInfo ?? '',
      userIdeaInfo: productData.userIdeaInfo ?? input.product?.userIdeaInfo ?? input.product?.userInfo ?? '',
      userInfo: productData.userInfo ?? input.product?.userInfo ?? '',
      inference: productData.inference ?? input.product?.inference ?? null,
      lastAnalyzedAt: productData.lastAnalyzedAt ?? input.product?.lastAnalyzedAt ?? null,
      lastError: productData.lastError ?? input.product?.lastError ?? null,
    };
    const guidance = mergeGuidance(
      readGuidance(parsed),
      buildFallbackGuidance(
        guidanceProduct,
        mergedBrief,
        guidanceProduct.inference?.summary ? 'direction' : 'brief'
      )
    );

    actions.push({ type: 'upsertProduct', data: productData });
    actions.push({ type: 'upsertBrief', data: mergedBrief });
    actions.push({ type: 'upsertVisualPreference', data: visualPreferenceData });
    actions.push({
      type: 'upsertBatchGenerate',
      data: {
        generationMode: 'detailPages',
        aspectRatios: readStringArray(batchRecord, 'aspectRatios').length > 0
          ? readStringArray(batchRecord, 'aspectRatios')
          : input.batch?.aspectRatios ?? ['4:5'],
        variantsPerRatio: 1,
        corePrompt,
        ratioPrompts: Object.fromEntries(
          Object.entries(ratioPrompts).map(([ratio, prompt]) => [
            ratio,
            appendVisualPreferenceToPrompt(prompt, visualPreferenceData),
          ])
        ),
        detailPages: mergedBrief.detailPages ?? [],
        detailPageIds: (mergedBrief.detailPages ?? []).map((page) => page.id),
        detailPageCount: mergedBrief.detailPages?.length ?? 0,
        stylePromptFragment: visualPreferenceData.promptFragment,
        status: corePrompt ? 'ready' : 'idle',
      },
    });

    return {
      assistantMessage: createMessage(
        'assistant',
        readString(parsed, 'assistant') || '我已经把商品理解和出图 Brief 同步到左侧画布。你可以先选择一个设计方向，我再继续细化画面。',
        guidance
      ),
      actions,
    };
  } catch (error) {
    const fallbackBrief = buildDetailFallbackBrief(input.product, message);
    const fallbackVisualPreference = buildFallbackVisualPreference(
      input.product,
      fallbackBrief,
      input.visualPreference
    );
    const guidance = buildFallbackGuidance(input.product, fallbackBrief, 'brief');
    actions.push({ type: 'upsertBrief', data: fallbackBrief });
    actions.push({ type: 'upsertVisualPreference', data: fallbackVisualPreference });
    actions.push({
      type: 'upsertBatchGenerate',
      data: {
        generationMode: 'detailPages',
        corePrompt: appendVisualPreferenceToPrompt(
          buildDetailFallbackCorePrompt(input.product, fallbackBrief),
          fallbackVisualPreference
        ),
        variantsPerRatio: 1,
        detailPages: fallbackBrief.detailPages ?? [],
        detailPageIds: fallbackBrief.detailPages?.map((page) => page.id) ?? [],
        detailPageCount: fallbackBrief.detailPages?.length ?? 0,
        stylePromptFragment: fallbackVisualPreference.promptFragment,
        status: 'ready',
      },
    });
    return {
      assistantMessage: createMessage(
        'assistant',
        `我先用当前信息整理了一版基础出图链路，但 AI 结构化整理时遇到问题：${error instanceof Error ? error.message : String(error)}`,
        guidance
      ),
      actions,
    };
  }
}
