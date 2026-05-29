import { generateText } from '@/commands/textGen';
import {
  type CommerceAdAgentAction,
  type CommerceAdAgentGuidance,
  type CommerceAdAgentImageAnalysis,
  type CommerceAdAgentMessage,
  type CommerceAdBatchGenerateState,
  type CommerceAdBriefState,
  type CommerceAdDetailPage,
  type CommerceAdDesignDirection,
  type CommerceAdGuidanceQuestion,
  type CommerceAdAgentThreadState,
  type CommerceAdAgentTurnIntent,
  type CommerceAdProductState,
  type CommerceAdVisualPreferenceState,
  type CommerceAgentSkill,
  createDefaultCommerceAdVisualPreferenceState,
  normalizeCommerceAdVisualPreferenceState,
} from '@/features/commerce-ad/types';

export interface CommerceAdAgentTurnInput {
  userMessage: string;
  conversationSummary?: string;
  product: CommerceAdProductState | null;
  brief: CommerceAdBriefState | null;
  visualPreference: CommerceAdVisualPreferenceState | null;
  batch: CommerceAdBatchGenerateState | null;
  referenceImages: string[];
  canUseVisionModel: boolean;
  selectedSkill?: CommerceAgentSkill | null;
  threadState?: CommerceAdAgentThreadState | null;
  turnIntent?: CommerceAdAgentTurnIntent;
}

export interface CommerceAdAgentTurnResult {
  assistantMessage: CommerceAdAgentMessage;
  actions: CommerceAdAgentAction[];
  threadStatePatch?: Partial<CommerceAdAgentThreadState>;
  nextAction?: 'ask' | 'plan' | 'ready' | 'generate';
}

export function buildCommerceAdAgentVisiblePrompt(input: CommerceAdAgentTurnInput): string {
  const skill = input.selectedSkill ?? null;
  return [
    'You are the visible chat voice of a Chinese design agent in a node-canvas app.',
    'Write natural Simplified Chinese for the user. Do not output JSON.',
    'The user should see this only as a temporary thinking preview while the real structured analysis runs.',
    '',
    'Required flow:',
    '1. Output short thinking-style progress phrases only, not a final answer.',
    '2. Keep each phrase under 28 Chinese characters and write at most 3 short phrases total.',
    '3. Do not use numbered lists, Markdown headings, bold text, or long paragraphs.',
    '4. Do not enumerate image details, missing fields, platform options, or recommendations.',
    '5. Good style examples: 正在看图里的主体和卖点。 / 正在判断适合的广告版位。 / 正在整理需要补充的信息。',
    '',
    skill ? 'Selected skill instructions:' : 'Selected skill instructions: none.',
    skill ? skill.promptInstructions : '',
    '',
    'Conversation summary:',
    input.conversationSummary?.trim() || '(no prior conversation summary)',
    '',
    'Current product state:',
    JSON.stringify(input.product, null, 2),
    '',
    `Reference image count: ${input.referenceImages.length}`,
    '',
    'Current thread state:',
    JSON.stringify(input.threadState ?? null, null, 2),
    '',
    `Turn intent: ${input.turnIntent ?? 'initial'}`,
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
    input.userMessage.trim() || '(no new message; analyze current uploaded product image and state)',
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

function createMessage(
  role: CommerceAdAgentMessage['role'],
  content: string,
  guidance?: CommerceAdAgentGuidance,
  imageAnalysis?: CommerceAdAgentImageAnalysis
): CommerceAdAgentMessage {
  return {
    id: `commerce-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(guidance ? { guidance } : {}),
    ...(imageAnalysis ? { imageAnalysis } : {}),
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

function readDetailPages(record: Record<string, unknown>): CommerceAdDetailPage[] {
  return readRecordArray(record, 'detailPages')
    .map((item, index): CommerceAdDetailPage | null => {
      const title = readString(item, 'title');
      const pageGoal = readString(item, 'pageGoal');
      const lockedCopy = readString(item, 'lockedCopy');
      const optimizedCopy = readString(item, 'optimizedCopy');
      const layoutNotes = readString(item, 'layoutNotes');
      const blueprint = readString(item, 'blueprint');
      const prompt = readString(item, 'prompt');
      if (!title && !pageGoal && !lockedCopy && !optimizedCopy && !layoutNotes && !blueprint && !prompt) {
        return null;
      }

      return {
        id: normalizeId(readString(item, 'id') || title || `detail-page-${index + 1}`, `detail-page-${index + 1}`),
        pageNo: Math.max(1, Math.round(Number(item.pageNo) || index + 1)),
        title,
        pageGoal,
        lockedCopy,
        optimizedCopy,
        layoutNotes,
        blueprint,
        referenceImageIds: readStringArray(item, 'referenceImageIds'),
        qualityNotes: readStringArray(item, 'qualityNotes'),
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

function normalizeCopyForComparison(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function buildSingleLockedCopyPage(
  lockedDocumentInfo: string,
  sourcePage: Partial<CommerceAdDetailPage> | undefined,
  userIdeaInfo: string
): CommerceAdDetailPage[] {
  const lockedCopy = lockedDocumentInfo.trim();
  if (!lockedCopy) {
    return [];
  }

  return [
    {
      id: sourcePage?.id || 'detail-page-1',
      pageNo: 1,
      title: sourcePage?.title || '产品信息总览',
      pageGoal: sourcePage?.pageGoal || '首屏信任与信息总览',
      lockedCopy,
      optimizedCopy: sourcePage?.optimizedCopy || (userIdeaInfo ? `围绕详情页目标优化表达：${userIdeaInfo}` : ''),
      layoutNotes: sourcePage?.layoutNotes || '根据文档信息组织一页清晰的详情页信息结构。',
      blueprint: sourcePage?.blueprint || '主视觉展示商品主体，按可信信息、核心卖点、补充说明建立清晰层级。',
      referenceImageIds: sourcePage?.referenceImageIds || [],
      qualityNotes: sourcePage?.qualityNotes || [],
      prompt: sourcePage?.prompt || [
        '制作电商详情页第 1 页：产品信息总览',
        `必须原样展示以下文档信息：${lockedCopy}`,
        userIdeaInfo,
      ].filter(Boolean).join('\n'),
    },
  ];
}

function sanitizeAutoDetailPages(
  parsedPages: CommerceAdDetailPage[],
  lockedDocumentInfo: string,
  userIdeaInfo: string
): CommerceAdDetailPage[] {
  const sourceCopy = lockedDocumentInfo.trim();
  if (!sourceCopy) {
    return parsedPages
      .filter((page) => page.lockedCopy.trim().length > 0)
      .map((page, index) => ({ ...page, pageNo: index + 1 }));
  }

  const normalizedSourceCopy = normalizeCopyForComparison(sourceCopy);
  const validPages = parsedPages.filter((page) => {
    const lockedCopy = page.lockedCopy.trim();
    if (!lockedCopy) {
      return false;
    }

    return sourceCopy.includes(lockedCopy);
  });
  const shouldDropWholeSourcePage = validPages.length > 1;
  const seenLockedCopies: string[] = [];
  const sanitizedPages = validPages
    .filter((page) => {
      const normalizedLockedCopy = normalizeCopyForComparison(page.lockedCopy);
      if (shouldDropWholeSourcePage && normalizedLockedCopy === normalizedSourceCopy) {
        return false;
      }
      if (seenLockedCopies.some((seenCopy) => (
        seenCopy === normalizedLockedCopy
        || seenCopy.includes(normalizedLockedCopy)
        || normalizedLockedCopy.includes(seenCopy)
      ))) {
        return false;
      }

      seenLockedCopies.push(normalizedLockedCopy);
      return true;
    })
    .map((page, index) => ({
      ...page,
      pageNo: index + 1,
    }));

  if (sanitizedPages.length > 0) {
    return sanitizedPages;
  }

  return buildSingleLockedCopyPage(sourceCopy, parsedPages[0], userIdeaInfo);
}

function preserveManualDetailPages(
  parsedPages: CommerceAdDetailPage[],
  existingPages: CommerceAdDetailPage[] | undefined
): CommerceAdDetailPage[] {
  if (!existingPages || existingPages.length === 0) {
    return parsedPages;
  }

  return existingPages.map((existingPage, index) => {
    const parsedPage = parsedPages.find((page) => page.id === existingPage.id)
      ?? parsedPages.find((page) => page.pageNo === existingPage.pageNo)
      ?? parsedPages[index];
    return {
      ...(parsedPage ?? existingPage),
      id: existingPage.id,
      pageNo: index + 1,
      title: parsedPage?.title || existingPage.title,
      pageGoal: parsedPage?.pageGoal || existingPage.pageGoal,
      lockedCopy: existingPage.lockedCopy,
    };
  });
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

function readImageAnalysis(record: Record<string, unknown>): CommerceAdAgentImageAnalysis | undefined {
  const analysisRecord = readRecord(record, 'imageAnalysis');
  if (Object.keys(analysisRecord).length === 0) {
    return undefined;
  }

  const summary = readString(analysisRecord, 'summary');
  const observations = readStringArray(analysisRecord, 'observations');
  const uncertainties = readStringArray(analysisRecord, 'uncertainties');
  if (!summary && observations.length === 0 && uncertainties.length === 0) {
    return undefined;
  }

  return {
    summary,
    observations,
    uncertainties,
    collapsedByDefault: true,
  };
}

function readThreadStatePatch(record: Record<string, unknown>): Partial<CommerceAdAgentThreadState> | undefined {
  const patchRecord = readRecord(record, 'threadStatePatch');
  if (Object.keys(patchRecord).length === 0) {
    return undefined;
  }
  const confirmedRecord = readRecord(patchRecord, 'confirmedSlots');
  const confirmedSlots = Object.keys(confirmedRecord).length > 0
    ? {
        platforms: readStringArray(confirmedRecord, 'platforms'),
        objective: readString(confirmedRecord, 'objective'),
        audience: readString(confirmedRecord, 'audience'),
        sellingPoint: readString(confirmedRecord, 'sellingPoint'),
        visualDirection: readString(confirmedRecord, 'visualDirection'),
        cta: readString(confirmedRecord, 'cta'),
        brandInfo: readString(confirmedRecord, 'brandInfo'),
        outputFormat: readString(confirmedRecord, 'outputFormat'),
      }
    : undefined;
  const phase = readString(patchRecord, 'phase');
  return {
    ...(phase ? { phase: phase as CommerceAdAgentThreadState['phase'] } : {}),
    ...(confirmedSlots ? { confirmedSlots } : {}),
    missingSlots: readStringArray(patchRecord, 'missingSlots'),
    lastAskedFields: readStringArray(patchRecord, 'lastAskedFields'),
    planVersion: Number(readString(patchRecord, 'planVersion')) || undefined,
  };
}

function readNextAction(record: Record<string, unknown>): CommerceAdAgentTurnResult['nextAction'] {
  const value = readString(record, 'nextAction');
  return ['ask', 'plan', 'ready', 'generate'].includes(value)
    ? value as CommerceAdAgentTurnResult['nextAction']
    : undefined;
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

function normalizeGuidance(guidance: CommerceAdAgentGuidance | undefined): CommerceAdAgentGuidance | undefined {
  if (!guidance) {
    return undefined;
  }

  if (
    !guidance.summary
    && guidance.confirmedFacts.length === 0
    && guidance.missingFields.length === 0
    && guidance.questions.length === 0
    && guidance.designDirections.length === 0
    && guidance.quickReplies.length === 0
    && !guidance.readinessHint
  ) {
    return undefined;
  }

  return guidance;
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
        pageGoal: '首屏信任与核心卖点',
        lockedCopy: lockedDocumentInfo,
        optimizedCopy: optimizedUserIdeaInfo,
        layoutNotes: '详情页首屏，突出商品主体、核心卖点和信任信息。',
        blueprint: '主视觉展示商品主体，首屏建立信任；核心卖点与必须原样展示的信息分区呈现。',
        referenceImageIds: product?.images?.[0]?.id ? [product.images[0].id] : [],
        qualityNotes: [],
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
  const selectedSkill = input.selectedSkill ?? null;

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
      selectedSkill ? undefined : buildFallbackGuidance(input.product, input.brief, 'infer')
    );
    actions.push({
      type: 'upsertProduct',
      data: {
        lastError: '当前文本模型可能无法识别图片，请切换多模态 LLM 或手动补充商品信息。',
      },
    });
    return { assistantMessage, actions, nextAction: 'ask' };
  }

  const prompt = [
    'You are the ecommerce ad image design strategist inside a node-canvas app for Chinese users.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    JSON.stringify({
      assistant: '',
      nextAction: 'ask|plan|ready|generate',
      threadStatePatch: {
        phase: 'collecting|planning|ready|refining|generating',
        confirmedSlots: {
          platforms: [''],
          objective: '',
          audience: '',
          sellingPoint: '',
          visualDirection: '',
          cta: '',
          brandInfo: '',
          outputFormat: '',
        },
        missingSlots: [''],
        lastAskedFields: [''],
        planVersion: 0,
      },
      imageAnalysis: {
        summary: '',
        observations: [''],
        uncertainties: [''],
      },
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
            pageGoal: '',
            lockedCopy: '',
            optimizedCopy: '',
            layoutNotes: '',
            blueprint: '',
            referenceImageIds: [''],
            qualityNotes: [''],
            prompt: '',
          },
        ],
        qualityCheckSummary: '',
        qualityIssues: [''],
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
    '- In auto mode, product.lockedDocumentInfo is a full source document. Decide page count from semantic relevance, continuity, and content volume; do NOT force 2 pages, 3 pages, or any fixed count.',
    '- In auto mode, group related facts into coherent pages such as product identity, core selling points, functional specs, use scenarios, craft/materials, size/model/restrictions, but only when those groups exist in the source.',
    '- In auto mode, each detailPages[].lockedCopy MUST be a non-empty contiguous verbatim excerpt from product.lockedDocumentInfo. Do not create a page without lockedCopy.',
    '- In auto mode, each source fact should appear in only one page. Do not duplicate the same lockedCopy or copy the whole source document into multiple pages.',
    '- In auto mode, if the source information is short, output only 1 page. Never create extra pages just to fill a page count.',
    '- In manualPages mode, existing detailPages are user-authored fixed page information. Preserve page count, page order, pageNo, id, title when present, and especially lockedCopy exactly byte-for-byte.',
    '- product.lockedDocumentInfo and detailPages[].lockedCopy are source copy that MUST NOT be rewritten, summarized, corrected, translated, reordered inside a page, or paraphrased.',
    '- Never paraphrase lockedDocumentInfo or lockedCopy inside optimizedCopy. If a page needs locked copy, place the exact original text only in lockedCopy and make the page prompt explicitly require it verbatim.',
    '- product.userIdeaInfo can be optimized for clarity and conversion, but do not change facts. Put the polished version in brief.optimizedUserIdeaInfo and related detailPages[].optimizedCopy.',
    '- brief.detailPages must contain id, pageNo, title, lockedCopy, optimizedCopy, layoutNotes, prompt. Each prompt should be production-ready for one detail-page image.',
    '- Also populate detailPages[].pageGoal, detailPages[].blueprint, detailPages[].referenceImageIds, and detailPages[].qualityNotes when possible. pageGoal should be a concrete ecommerce section intent such as 首屏信任、核心卖点、参数规格、材质工艺、使用场景、售后保障、禁忌提醒.',
    '- If images are provided, populate imageAnalysis separately from assistant. imageAnalysis.summary should be concise; observations should list visible subject, scene/style cues, readable text, and possible selling points; uncertainties should list only things you cannot verify from the image.',
    '- Do not duplicate the full image analysis inside assistant. The UI renders imageAnalysis in a collapsed section.',
    '- Treat product image descriptions as an evidence board. Assign evidence tags mentally such as 主图、材质细节、规格参数、包装、使用场景、风险限制, then reference the most relevant image ids in each detail page instead of defaulting every page to the main image.',
    '- Populate brief.qualityCheckSummary and brief.qualityIssues with a concise pre-generation QA pass: source-copy coverage, duplicate allocation, possible invented claims, thin pages, excessive page count, and platform/compliance risks.',
    '- Internally act as five cooperating agents in one JSON response: 商品资料 Agent extracts evidence, 详情页策划 Agent plans page goals, 文案 Agent only optimizes userIdeaInfo, Prompt Agent writes image prompts, and 质检 Agent checks risk before generation.',
    '- If product.detailInputMode is manualPages and existing detailPages are provided, only optimize/fill optimizedCopy, layoutNotes, and prompt.',
    '- batch.generationMode must be detailPages and detailPageCount must match brief.detailPages.length. Preserve requested aspectRatios, variantsPerRatio, and batchCount from current batch settings when present.',
    '- Product inference may use up to 5 product reference images when provided. Treat the first image as the main product identity and use later images for angle, material, detail, packaging, and usage-scene evidence.',
    '- product.images[].description explains what each uploaded image represents, such as material detail, side view, packaging, scale, usage scene, texture, craft, or flaw/restriction evidence. Use these descriptions to decide detail-page pagination, selling-point emphasis, layout notes, and per-page prompts.',
    '- Do not default every page to the main product image. When a reference image is described as a detail/side/material/packaging/scene image, assign that visual evidence to the most relevant detail page and mention it explicitly in layoutNotes and prompt.',
    '- Synthesize visual understanding across all reference images, but do not invent locked on-image text from images alone. Text that must appear verbatim still comes only from product.lockedDocumentInfo or detailPages[].lockedCopy.',
    '- Act like a Chinese visual design consultant, not a command executor.',
    '- Treat User message as a continuation of the existing conversation and Current states. Do not overwrite previous product facts, uploaded image evidence, or plan direction unless the user explicitly changes them.',
    '- assistant must be a brief conclusion, 1-2 Chinese sentences max. Say only the current conclusion and what to do next.',
    '- Do not duplicate imageAnalysis, confirmedFacts, missingFields, guidance questions, option lists, the full brief, prompt, or page plan inside assistant; those belong in the collapsed analysis, guidance card, or canvas plan node.',
    '- Populate guidance only with information you actually inferred or questions/options you actually need from the user. Do not copy default skill option lists wholesale.',
    '- If key information is missing, ask at most 1-2 high-impact Chinese follow-up questions in assistant and product.inference.followUpQuestions.',
    '- Use Current thread state as memory. Preserve confirmedSlots unless the user clearly changes them.',
    '- If Current thread state already has imageAnalysis and this turn has no new reference image, do not redo or restate full image analysis; reuse it silently.',
    '- Never list confirmedSlots as missingFields. Only ask for slots that are still missing after applying the current user message.',
    '- If platform, objective, and visualDirection are known and imageAnalysis or product information exists, set nextAction to ready or plan and produce a concrete ad creative plan instead of asking more setup questions.',
    '- threadStatePatch should include only the updated phase, confirmedSlots, missingSlots, lastAskedFields, and planVersion needed after this turn.',
    '- Include 2-3 concrete Chinese designDirections when the product is understood or partially understood.',
    '- Before platform, audience, selling points, and style are clear, prioritize Chinese brief refinement instead of pushing generation settings.',
    '- guidance.quickReplies should be short Chinese phrases users can click and edit before sending.',
    '- The image text strategy is baked into the generated image, not editable overlay layers.',
    '- Keep corePrompt production-ready for ecommerce image generation with faithful product preservation, but write it in Chinese by default.',
    '- visualPreference must be Chinese by default and include designStyle, colorPalette, platformVisual, language, brandAccentColor, summary, and a production-ready promptFragment.',
    '- batch.corePrompt and every batch.ratioPrompts value must explicitly include visualPreference.promptFragment constraints.',
    selectedSkill
      ? '- A user-selected skill is active. Treat the skill instructions below as first-class task requirements. The selected skill should change product inference, guidance questions, brief.platform, visualPreference.platformVisual, batch aspect ratios, and production prompt.'
      : '',
    selectedSkill
      ? '- For 广告创意, do image analysis first, then create platform-native paid ad creative guidance. Do not default to ecommerce detail-page images unless the user explicitly asks for detail pages.'
      : '',
    selectedSkill
      ? '- If platform, ad objective, audience, offer/selling point, CTA, or required output format is missing, ask concise questions and provide clickable options in guidance.questions and guidance.quickReplies, but only for missing/high-impact fields. If the image makes something clear, confirm it instead of asking.'
      : '',
    selectedSkill
      ? '- When 广告创意 is active, brief.usage should describe paid ad creative, brief.platform should contain selected/recommended ad platforms, batch.aspectRatios should match chosen platforms, and prompts should be ad creative prompts rather than detail-page-only prompts.'
      : '',
    '',
    selectedSkill ? 'Selected skill:' : '',
    selectedSkill ? JSON.stringify({
      id: selectedSkill.id,
      title: selectedSkill.title,
      description: selectedSkill.description,
      promptInstructions: selectedSkill.promptInstructions,
      defaultQuestions: selectedSkill.defaultQuestions,
      quickOptions: selectedSkill.quickOptions,
    }, null, 2) : '',
    '',
    'Conversation summary and prior user context:',
    input.conversationSummary?.trim() || '(no prior conversation summary)',
    '',
    'Current thread state memory:',
    JSON.stringify(input.threadState ?? null, null, 2),
    '',
    `Turn intent: ${input.turnIntent ?? 'initial'}`,
    '',
    'Current product state:',
    JSON.stringify(input.product, null, 2),
    '',
    `Reference image count: ${input.referenceImages.length}`,
    input.product?.images?.length
      ? JSON.stringify(input.product.images.map((image, index) => ({
          index: index + 1,
          role: index === 0 ? 'main' : 'reference',
          label: image.label,
          description: image.description,
          kind: image.kind,
        })), null, 2)
      : '',
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
    const rawParsedDetailPages = readDetailPages(briefRecord);
    const parsedDetailPages = input.product?.detailInputMode === 'manualPages'
      ? preserveManualDetailPages(rawParsedDetailPages, input.brief?.detailPages)
      : sanitizeAutoDetailPages(rawParsedDetailPages, lockedDocumentInfo, userIdeaInfo);

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
      qualityCheckSummary: readString(briefRecord, 'qualityCheckSummary'),
      qualityIssues: readStringArray(briefRecord, 'qualityIssues'),
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
    const guidance = selectedSkill
      ? normalizeGuidance(readGuidance(parsed))
      : mergeGuidance(
          readGuidance(parsed),
          buildFallbackGuidance(
            guidanceProduct,
            mergedBrief,
            guidanceProduct.inference?.summary ? 'direction' : 'brief'
          )
        );
    const imageAnalysis = readImageAnalysis(parsed);
    const threadStatePatch = readThreadStatePatch(parsed);
    const nextAction = readNextAction(parsed);

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
        variantsPerRatio: input.batch?.variantsPerRatio ?? 1,
        batchCount: input.batch?.batchCount ?? 1,
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
        guidance,
        imageAnalysis
      ),
      actions,
      threadStatePatch,
      nextAction,
    };
  } catch (error) {
    const fallbackBrief = buildDetailFallbackBrief(input.product, message);
    const fallbackVisualPreference = buildFallbackVisualPreference(
      input.product,
      fallbackBrief,
      input.visualPreference
    );
    const guidance = selectedSkill
      ? undefined
      : buildFallbackGuidance(input.product, fallbackBrief, 'brief');
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
        variantsPerRatio: input.batch?.variantsPerRatio ?? 1,
        batchCount: input.batch?.batchCount ?? 1,
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
      nextAction: 'ask',
    };
  }
}
