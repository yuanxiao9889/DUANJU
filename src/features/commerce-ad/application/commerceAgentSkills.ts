import type {
  CommerceAdAgentGuidance,
  CommerceAgentSkill,
} from '@/features/commerce-ad/types';

const AD_CREATIVE_PROMPT_INSTRUCTIONS = [
  'Skill name: 广告创意.',
  'Primary goal: design platform-native paid ad creatives for Instagram, Facebook, TikTok, LinkedIn, YouTube, Google Ads, and X.',
  'Workflow:',
  '1. First analyze all provided images: product/service identity, visible subject, scene, material/style cues, readable text, possible selling points, and uncertainty.',
  '2. Then combine image evidence with the user brief and this skill. Do not jump directly into ecommerce detail-page planning unless the user explicitly asks for detail pages.',
  '3. If platform, campaign goal, audience, offer/selling point, CTA, language, or required output format is missing, ask only the missing questions that would materially change the creative.',
  '4. Provide concrete clickable options through guidance.questions and guidance.quickReplies when information is missing.',
  '5. When enough information exists, produce ad creative strategy, platform fit, visual concept, copy options, production prompt, and a short quality check.',
  '',
  'Platform defaults:',
  '- Instagram/Facebook: feed square 1080x1080, feed portrait 1080x1350, Stories/Reels 1080x1920, landscape/link 1200x628. One message should win; keep product and hook center-safe.',
  '- TikTok: 1080x1920 vertical first. Favor creator-style hooks, motion-first story, quick product reveal, native captions.',
  '- LinkedIn: 1200x627 or 1080x1080. Lead with business pain, outcome, evidence, and restrained credible design.',
  '- YouTube: 1920x1080 for in-stream/in-feed, 1080x1920 for Shorts, 1280x720 thumbnail. Hook before skip moment; one focal point.',
  '- Google Ads: responsive display landscape 1200x628, square 1200x1200, optional vertical 900x1600. Keep imagery clean; separate headlines/descriptions from image when possible.',
  '- X: 1.91:1, 1:1, 9:16, or 16:9 variants. Make the first line/frame direct, punchy, and conversation-native.',
  '',
  'Creative patterns to consider: product hero + benefit, problem/solution split, supportable before/after, social proof from user facts, UGC/native hook, feature demo in 3 steps, offer/launch, myth/fact checklist.',
  'AI prompt rule: separate subject, brand/product constraints, scene/props, composition/crop, lighting/style, overlay text to add separately, negative constraints, and output ratio/platform.',
  'Do not rely on image generation models to render long exact text; recommend adding final copy in layout software when precision matters.',
].join('\n');

export const AD_CREATIVE_SKILL_ID = 'ad-creative';

export function getCommerceAgentSkills(): CommerceAgentSkill[] {
  return [
    {
      id: AD_CREATIVE_SKILL_ID,
      title: '广告创意',
      description: '为 Instagram、Facebook、TikTok、LinkedIn、YouTube、Google Ads 及 X 设计平台适配广告创意。',
      iconKey: 'megaphone',
      promptInstructions: AD_CREATIVE_PROMPT_INSTRUCTIONS,
      requiredSlots: ['platforms', 'objective', 'visualDirection'],
      optionalSlots: ['audience', 'sellingPoint', 'cta', 'brandInfo', 'outputFormat'],
      slotLabels: {
        platforms: '投放平台',
        objective: '广告目标',
        visualDirection: '创意方向',
        audience: '目标受众',
        sellingPoint: '核心卖点',
        cta: 'CTA',
        brandInfo: '品牌信息',
        outputFormat: '输出格式',
      },
      slotAliases: {
        platforms: ['平台', '版位', '投放平台'],
        objective: ['目标', '广告目标', '投放目标'],
        visualDirection: ['风格', '创意方向', '视觉方向'],
        audience: ['人群', '受众', '目标用户'],
        sellingPoint: ['卖点', '核心卖点', '突出'],
        cta: ['CTA', '行动号召', '按钮'],
        brandInfo: ['品牌', '品牌名'],
        outputFormat: ['输出格式', '产物'],
      },
      workflowStages: ['collecting', 'planning', 'ready', 'refining', 'generating'],
      outputArtifacts: ['方案节点', '生成结果节点'],
      qualityChecklist: [
        '平台尺寸和安全区是否匹配',
        '主体和核心卖点是否清晰',
        '文案是否适合后期排版而非强依赖 AI 精确渲染',
      ],
      defaultQuestions: [
        {
          id: 'ad-platform',
          label: '你优先投放哪个平台或版位？',
          allowMultiple: true,
          options: [
            { id: 'instagram-feed', label: 'Instagram Feed', value: '平台：Instagram Feed' },
            { id: 'instagram-reels', label: 'Instagram Story/Reels', value: '平台：Instagram Story/Reels' },
            { id: 'facebook-feed', label: 'Facebook Feed', value: '平台：Facebook Feed' },
            { id: 'tiktok', label: 'TikTok', value: '平台：TikTok' },
            { id: 'linkedin', label: 'LinkedIn', value: '平台：LinkedIn' },
            { id: 'youtube', label: 'YouTube', value: '平台：YouTube' },
            { id: 'google-ads', label: 'Google Ads', value: '平台：Google Ads' },
            { id: 'x', label: 'X', value: '平台：X' },
            { id: 'multi-platform', label: '多平台组合', value: '平台：多平台组合' },
          ],
        },
        {
          id: 'ad-goal',
          label: '这次广告更看重什么目标？',
          allowMultiple: false,
          options: [
            { id: 'awareness', label: '品牌曝光', value: '目标：品牌曝光' },
            { id: 'traffic', label: '点击访问', value: '目标：点击访问' },
            { id: 'conversion', label: '转化下单', value: '目标：转化下单' },
            { id: 'lead', label: '留资咨询', value: '目标：留资咨询' },
          ],
        },
      ],
      quickOptions: [
        '先分析图片并推荐投放平台',
        '做一版多平台广告创意方案',
        '突出产品卖点和点击理由',
        '生成广告文案和画面提示词',
      ],
    },
  ];
}

export function getCommerceAgentSkill(skillId: string): CommerceAgentSkill | null {
  return getCommerceAgentSkills().find((skill) => skill.id === skillId) ?? null;
}

export function buildSkillGuidanceFallback(skill: CommerceAgentSkill): CommerceAdAgentGuidance {
  return {
    stage: 'brief',
    summary: `已启用「${skill.title}」，我会先看图，再按投放平台和广告目标补齐创意 Brief。`,
    confirmedFacts: [`技能：${skill.title}`],
    missingFields: ['投放平台', '广告目标', '目标受众', '核心卖点/优惠', 'CTA'],
    questions: skill.defaultQuestions,
    designDirections: [],
    quickReplies: skill.quickOptions,
    readinessHint: '选择一个平台或目标后，我会把它放进输入框，你可以再补充品牌和受众后发送。',
  };
}
