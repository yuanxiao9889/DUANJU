import type {
  CommerceAdBriefState,
  CommerceAdProductState,
  CommerceAdVisualPreferenceState,
  CommercePromptSpec,
} from '@/features/commerce-ad/types';

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function joinUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export function userRequestedNoText(value: string): boolean {
  return /不要(?:加|出现|生成)?(?:文字|文案|标题|字幕|字)|无字(?:版)?|不带(?:文字|文案|标题|字幕)|去掉(?:文字|文案|标题|字幕)|no\s*(?:text|copy|words|typography)|without\s*(?:text|copy|words|typography)/i.test(value);
}

function ratioCompositionHint(aspectRatio: string): string {
  if (aspectRatio === '9:16') {
    return '竖版 9:16：主体放在中部偏下，顶部保留标题呼吸区，底部 CTA 避开平台 UI 安全区，边缘不要贴太满。';
  }
  if (aspectRatio === '16:9') {
    return '横版 16:9：采用左右分区或中央大片构图，主体与文案形成清晰视觉路径，右下或左下预留 CTA 区域。';
  }
  if (aspectRatio === '1:1') {
    return '方形 1:1：主体居中但保留四周留白，标题和卖点形成上下层级，适合信息流缩略图浏览。';
  }
  if (aspectRatio === '3:4' || aspectRatio === '4:5') {
    return `${aspectRatio} 信息流：主体居中偏下，顶部标题、中部卖点、底部 CTA 层级清楚，适合社媒 Feed 浏览。`;
  }
  return `输出比例 ${aspectRatio}：根据该比例重新安排主体、文案和留白，不要简单裁切同一构图。`;
}

function fallbackCopyStrategy(brief?: Partial<CommerceAdBriefState> | null, sourcePrompt = ''): string {
  if (userRequestedNoText(sourcePrompt)) {
    return '无文字版：画面中不要生成任何标题、字幕、按钮文案、品牌字样或装饰文字，只保留干净留白供后期排版。';
  }

  const headline = normalizeText(brief?.headline);
  const sellingPoint = brief?.sellingPoints?.find((item) => item.trim())?.trim() ?? '';
  const cta = normalizeText(brief?.cta);
  const copy = [
    headline ? `主标题：${headline}` : '主标题：使用一句简短、有广告感、不过度承诺的标题。',
    sellingPoint ? `卖点短句：${sellingPoint}` : '卖点短句：提炼一个可从商品或用户需求中支持的核心利益点。',
    cta ? `CTA：${cta}` : 'CTA：使用自然的短行动号召，例如“立即了解”或“探索更多”。',
    '文字必须短、清晰、可读，排版像真实广告素材，不要生成大段说明文字。',
  ];
  return copy.join('\n');
}

export function buildCommercePromptSpecFallback(input: {
  selectedSkillId?: string;
  product?: Partial<CommerceAdProductState> | null;
  brief?: Partial<CommerceAdBriefState> | null;
  visualPreference?: Partial<CommerceAdVisualPreferenceState> | null;
  prompt?: string;
  referenceImageNotes?: string;
  aspectRatios?: string[];
}): CommercePromptSpec {
  const prompt = normalizeText(input.prompt);
  const product = input.product;
  const brief = input.brief;
  const productName = normalizeText(product?.productName) || normalizeText(product?.brand) || '参考图中的商品主体';
  const visualDescription = normalizeText(product?.inference?.visualDescription);
  const sellingPoints = joinUnique([
    ...(product?.inference?.visibleSellingPoints ?? []),
    ...(brief?.sellingPoints ?? []),
  ]);
  const isAdCreative = input.selectedSkillId === 'ad-creative';

  return {
    task: isAdCreative ? '广告创意出图' : normalizeText(brief?.usage) || '电商视觉素材出图',
    subject: [
      `以${productName}为核心主体。`,
      visualDescription ? `可见特征：${visualDescription}` : '',
      sellingPoints.length ? `可见/可用卖点：${sellingPoints.slice(0, 4).join('、')}` : '',
      '必须保持参考图中商品的外观、结构、材质、颜色和识别特征，不要擅自改款。',
    ].filter(Boolean).join('\n'),
    audienceAndGoal: [
      normalizeText(brief?.audience) ? `目标人群：${brief?.audience}` : '',
      normalizeText(brief?.platform) ? `平台/版位：${brief?.platform}` : '',
      normalizeText(brief?.normalizedBrief) || normalizeText(brief?.optimizedUserIdeaInfo) || prompt,
    ].filter(Boolean).join('\n'),
    artDirection: [
      normalizeText(brief?.style) || normalizeText(input.visualPreference?.summary),
      isAdCreative
        ? '高级时尚广告审美，商业摄影光影，真实材质质感，克制而有记忆点的色彩，像品牌 campaign 或杂志广告。'
        : '干净、专业、可信的电商视觉，信息层级清楚，商品质感突出。',
    ].filter(Boolean).join('\n'),
    composition: isAdCreative
      ? '以广告主视觉方式构图，主体、标题、卖点和 CTA 形成清楚层级；保留高级留白，避免杂乱背景和拥挤排版。'
      : '主体清晰突出，页面信息层级明确，避免无意义装饰和过度堆砌。',
    copyStrategy: fallbackCopyStrategy(brief, prompt),
    platformAdaptation: normalizeText(brief?.platform) || '根据当前输出比例自动适配平台安全区和裁切。',
    referenceUsage: normalizeText(input.referenceImageNotes) || '参考图用于锁定商品主体、材质、颜色、比例、包装和可见卖点；不得虚构不可见功效。',
    negativeConstraints: joinUnique([
      normalizeText(brief?.constraints),
      normalizeText(brief?.mustInclude) ? `必须包含：${brief?.mustInclude}` : '',
      '不要改变商品结构、Logo、包装核心识别和颜色关系。',
      '不要生成低清、变形、杂乱、廉价促销感或不可读文字。',
      '不要编造价格、折扣、医疗功效、认证、承诺或用户未提供的品牌信息。',
    ]),
    qualityChecklist: joinUnique([
      '商品主体准确且质感高级。',
      '画面层级清楚，第一眼能看懂广告重点。',
      '文案短且可读，或严格遵守无文字要求。',
      '构图适配平台比例和安全区。',
      '整体像真实可投放的商业广告素材。',
    ]),
    ratioAdaptations: Object.fromEntries(
      (input.aspectRatios?.length ? input.aspectRatios : ['4:5'])
        .map((ratio) => [ratio, ratioCompositionHint(ratio)])
    ),
  };
}

export function renderPromptForImageGeneration(input: {
  spec?: CommercePromptSpec | null;
  basePrompt?: string;
  aspectRatio: string;
  selectedSkillId?: string;
  visualPreference?: Partial<CommerceAdVisualPreferenceState> | null;
}): string {
  const spec = input.spec;
  const basePrompt = normalizeText(input.basePrompt);
  if (!spec) {
    return basePrompt;
  }

  const ratioHint = normalizeText(spec.ratioAdaptations[input.aspectRatio]) || ratioCompositionHint(input.aspectRatio);
  const visualFragment = normalizeText(input.visualPreference?.promptFragment);
  const noText = userRequestedNoText([basePrompt, spec.copyStrategy].join('\n'));
  const copyStrategy = noText
    ? '无文字版：画面中不要生成任何文字、标题、字幕、按钮、品牌字样或装饰字符；通过构图、光影、产品摆放和留白表达广告感。'
    : spec.copyStrategy;

  const sections = [
    ['任务', spec.task],
    ['产品主体', spec.subject],
    ['广告目标', spec.audienceAndGoal],
    ['视觉方向', spec.artDirection],
    ['构图与平台适配', [spec.composition, spec.platformAdaptation, ratioHint, `输出比例：${input.aspectRatio}`].filter(Boolean).join('\n')],
    ['画面文案', copyStrategy],
    ['参考图使用', spec.referenceUsage],
    ['视觉偏好补充', visualFragment],
    ['限制与质检', [...spec.negativeConstraints, ...spec.qualityChecklist].join('\n')],
  ]
    .map(([title, body]) => [title, normalizeText(body)].filter(Boolean))
    .filter((section) => section.length === 2)
    .map(([title, body]) => `${title}：\n${body}`)
    .join('\n\n');

  return sections || basePrompt;
}

