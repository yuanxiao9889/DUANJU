import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type MutableRefObject } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  Images,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageSquarePlus,
  PanelTop,
  PackageCheck,
  Plus,
  Search,
  Send,
  Settings,
  Shirt,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal, UiSelect, UiTextAreaField } from '@/components/ui';
import { Canvas } from '@/features/canvas/Canvas';
import { canvasAiGateway } from '@/features/canvas/application/canvasServices';
import {
  prepareNodeImageFromFile,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CommerceAgentPlanNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CommerceVisualPreferenceNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  applyCommerceAdAgentActions,
  type CommerceAdCanvasActionsContext,
  type CommerceAdAgentActionOptions,
} from '@/features/commerce-ad/application/commerceAdCanvasActions';
import {
  isLikelyVisionTextModel,
  buildCommerceAdAgentVisiblePrompt,
  runCommerceAdAgentTurn,
} from '@/features/commerce-ad/application/commerceAdAgent';
import { getCommerceAgentSkills } from '@/features/commerce-ad/application/commerceAgentSkills';
import {
  BRAND_ACCENT_PRESETS,
  VISUAL_PREFERENCE_OPTION_KEYS,
  buildVisualPreferencePatch,
  composeVisualPreferenceSummary,
} from '@/features/commerce-ad/application/commerceAdVisualPreference';
import {
  createDefaultCommerceAdBriefState,
  createDefaultCommerceAgentPlanState,
  createDefaultCommerceAdProductState,
  createDefaultCommerceAdResultGroupState,
  createDefaultCommerceAdVisualPreferenceState,
  normalizeCommerceAdVisualPreferenceState,
  type CommerceAdAgentMessage,
  type CommerceAdAgentAction,
  type CommerceAdAgentGuidance,
  type CommerceAdAgentImageAnalysis,
  type CommerceAdAgentThreadState,
  type CommerceAdAgentTurnIntent,
  type CommerceAgentSkill,
  type CommerceAdBatchGenerateState,
  type CommerceAdBriefState,
  type CommerceAdDetailPage,
  type CommerceAdGeneratedImageRecord,
  type CommerceAdGenerationBatch,
  type CommerceAdProductImage,
  type CommerceAdProductState,
  type CommerceAdVisualPreferenceState,
  type CommerceAgentPlanState,
} from '@/features/commerce-ad/types';
import {
  getImageModel,
  getModelProvider,
  listImageModels,
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
  resolveImageModelResolution,
  resolveImageModelResolutions,
  STORYBOARD_OOPII_MODEL_ID,
} from '@/features/canvas/models';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import {
  listCommerceAgentThreads,
  getCommerceAgentThread,
  upsertCommerceAgentThread,
  deleteCommerceAgentThread,
  type CommerceAgentThreadRecord,
} from '@/commands/projectState';
import {
  cancelCommerceAdAgentStream,
  listenCommerceAdAgentStream,
  startCommerceAdAgentStream,
  type CommerceAdAgentStreamEvent,
} from '@/commands/textGen';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';

const COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY = 'commerce-agent-product-info-collapsed';
const COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY = 'commerce-agent-visual-preference-collapsed';
const COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY = 'commerce-agent-batch-settings-collapsed';
const COMMERCE_AGENT_ACTIVE_MODULE_STORAGE_KEY = 'commerce-agent-active-module';
const COMMERCE_AGENT_PANEL_WIDTH_STORAGE_KEY = 'commerce-agent-panel-width';
const COMMERCE_AGENT_THREAD_SAVE_DEBOUNCE_MS = 600;
const COMMERCE_AGENT_THREAD_LIMIT = 15;
const COMMERCE_AGENT_DEFAULT_THREAD_ID = 'default';
const COMMERCE_AGENT_PANEL_MIN_WIDTH = 340;
const COMMERCE_AGENT_PANEL_MAX_WIDTH = 620;
const COMMERCE_AGENT_THINKING_PREVIEW_MAX_CHARS = 86;
const COMMERCE_AGENT_TYPEWRITER_INTERVAL_MS = 18;
const COMMERCE_START_IMAGE_GENERATION_EVENT = 'commerce-ad:start-image-generation';
const COMMERCE_START_AGENT_PLAN_GENERATION_EVENT = 'commerce-ad:start-agent-plan-generation';
const COMMERCE_RETRY_IMAGE_GENERATION_EVENT = 'commerce-ad:retry-image-generation';
const COMMERCE_SYNC_DOWNSTREAM_EVENT = 'commerce-ad:sync-downstream';
const COMMERCE_INFER_PRODUCT_EVENT = 'commerce-ad:infer-product';
const COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT = 'commerce-ad:upload-product-image';
const COMMERCE_RESULT_IMAGE_COLUMNS = 4;
const COMMERCE_RESULT_IMAGE_GAP_X = 28;
const COMMERCE_RESULT_IMAGE_GAP_Y = 36;
const COMMERCE_RESULT_IMAGE_NODE_WIDTH = 168;
const COMMERCE_RESULT_IMAGE_NODE_HEIGHT = 220;
const COMMERCE_RESULT_GROUP_TO_IMAGE_GAP = 48;
const DEFAULT_AGENT_MESSAGES: CommerceAdAgentMessage[] = [];
const COMMERCE_DEFAULT_IMAGE_MODEL_ID = STORYBOARD_OOPII_MODEL_ID;
const COMMERCE_DEFAULT_RESOLUTION = '2K';
const COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT = 5;
const DEFAULT_SKILL_REQUIRED_SLOT_KEYS = ['platforms', 'objective', 'visualDirection'];
const COMMERCE_PLATFORM_RATIO_LIMIT = 4;
const COMMERCE_AGENT_MIN_CREATIVE_GUIDANCE_ROUNDS = 2;
const COMMERCE_AGENT_MAX_DEFAULT_CREATIVE_GUIDANCE_ROUNDS = 3;
const COMMERCE_AGENT_MODULES = [
  { id: 'detailPage', icon: PackageCheck },
  { id: 'productImageOptimize', icon: Sparkles },
  { id: 'modelTryOn', icon: Shirt },
  { id: 'campaignPoster', icon: Megaphone },
  { id: 'sceneImage', icon: Images },
] as const;
type CommerceAgentModuleId = (typeof COMMERCE_AGENT_MODULES)[number]['id'];
type CommerceAgentTask =
  | 'chat'
  | 'syncProductInfo'
  | 'inferProduct'
  | 'paginateDetailPages';

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === 'true';
}

function isCommerceAgentModuleId(value: string | null): value is CommerceAgentModuleId {
  return COMMERCE_AGENT_MODULES.some((module) => module.id === value);
}

function readActiveCommerceAgentModule(): CommerceAgentModuleId {
  if (typeof window === 'undefined') {
    return 'detailPage';
  }

  const raw = window.localStorage.getItem(COMMERCE_AGENT_ACTIVE_MODULE_STORAGE_KEY);
  return isCommerceAgentModuleId(raw) ? raw : 'detailPage';
}

function createLocalMessage(
  role: CommerceAdAgentMessage['role'],
  content: string,
  options: {
    images?: CommerceAdProductImage[];
    guidance?: CommerceAdAgentGuidance;
    imageAnalysis?: CommerceAdAgentImageAnalysis;
    status?: CommerceAdAgentMessage['status'];
    phase?: CommerceAdAgentMessage['phase'];
  } | CommerceAdAgentGuidance = {}
): CommerceAdAgentMessage {
  const guidance = 'stage' in options ? options : options.guidance;
  const images = 'stage' in options ? [] : options.images ?? [];
  const imageAnalysis = 'stage' in options ? undefined : options.imageAnalysis;
  const status = 'stage' in options ? undefined : options.status;
  const phase = 'stage' in options ? undefined : options.phase;
  return {
    id: `commerce-agent-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(images.length > 0 ? { images } : {}),
    ...(guidance ? { guidance } : {}),
    ...(imageAnalysis ? { imageAnalysis } : {}),
    ...(status ? { status } : {}),
    ...(phase ? { phase } : {}),
  };
}

function buildGuidanceChoiceKey(messageId: string, kind: string, id: string): string {
  return `${messageId}:${kind}:${id}`;
}

function hasGuidanceContent(guidance: CommerceAdAgentGuidance): boolean {
  return Boolean(
    guidance.summary
    || guidance.confirmedFacts.length
    || guidance.missingFields.length
    || guidance.questions.length
    || guidance.designDirections.length
    || guidance.quickReplies.length
    || guidance.readinessHint
  );
}

type CommerceAgentNextAction = 'ask' | 'plan' | 'ready' | 'generate';

function GuidancePillList({
  items,
  tone = 'neutral',
}: {
  items: string[];
  tone?: 'neutral' | 'warning';
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full px-2 py-1 text-[13px] transition-colors ${
            tone === 'warning'
              ? 'bg-amber-400/10 text-amber-100'
              : 'bg-text-dark/[0.05] text-text-dark/80'
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function getSkillRequiredSlots(skill: CommerceAgentSkill | null): string[] {
  return skill?.requiredSlots?.length ? skill.requiredSlots : [];
}

function createDefaultAgentThreadState(skill: CommerceAgentSkill | null = null): CommerceAdAgentThreadState {
  return {
    phase: 'collecting',
    skillId: skill?.id ?? '',
    confirmedSlots: {},
    missingSlots: skill?.requiredSlots?.length ? skill.requiredSlots : DEFAULT_SKILL_REQUIRED_SLOT_KEYS,
    lastAskedFields: [],
    planVersion: 0,
    guidanceRound: 0,
    shownGuidanceKinds: [],
    lastGuidanceAtPlanVersion: null,
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => (
    typeof item === 'string' ? item.trim() : ''
  )).filter(Boolean)));
}

function normalizeSlotValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return normalizeStringList(value);
  }
  return typeof value === 'string' ? value.trim() : '';
}

function parseAgentThreadState(
  stateJson?: string | null,
  skill: CommerceAgentSkill | null = null
): CommerceAdAgentThreadState {
  if (!stateJson?.trim()) {
    return createDefaultAgentThreadState(skill);
  }
  try {
    const parsed = JSON.parse(stateJson) as Partial<CommerceAdAgentThreadState> | null;
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultAgentThreadState(skill);
    }
    const defaults = createDefaultAgentThreadState(skill);
    const confirmed = parsed.confirmedSlots && typeof parsed.confirmedSlots === 'object'
      ? parsed.confirmedSlots as Record<string, unknown>
      : {};
    const imageAnalysis = parsed.imageAnalysis
      && typeof parsed.imageAnalysis === 'object'
      && (
        typeof parsed.imageAnalysis.summary === 'string'
        || Array.isArray(parsed.imageAnalysis.observations)
        || Array.isArray(parsed.imageAnalysis.uncertainties)
      )
      ? {
          summary: typeof parsed.imageAnalysis.summary === 'string' ? parsed.imageAnalysis.summary : '',
          observations: normalizeStringList(parsed.imageAnalysis.observations),
          uncertainties: normalizeStringList(parsed.imageAnalysis.uncertainties),
          collapsedByDefault: parsed.imageAnalysis.collapsedByDefault !== false,
        }
      : undefined;
    return {
      phase: ['collecting', 'planning', 'ready', 'refining', 'generating'].includes(parsed.phase ?? '')
        ? parsed.phase as CommerceAdAgentThreadState['phase']
        : defaults.phase,
      skillId: typeof parsed.skillId === 'string' ? parsed.skillId : defaults.skillId,
      confirmedSlots: Object.fromEntries(
        Object.entries(confirmed)
          .map(([key, value]) => [key, normalizeSlotValue(value)])
          .filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value))
      ),
      missingSlots: normalizeStringList(parsed.missingSlots).length > 0
        ? normalizeStringList(parsed.missingSlots)
        : defaults.missingSlots,
      imageAnalysis,
      lastAskedFields: normalizeStringList(parsed.lastAskedFields),
      planVersion: Number.isFinite(parsed.planVersion) ? Math.max(0, Number(parsed.planVersion)) : 0,
      guidanceRound: Number.isFinite(parsed.guidanceRound) ? Math.max(0, Number(parsed.guidanceRound)) : 0,
      shownGuidanceKinds: normalizeStringList(parsed.shownGuidanceKinds),
      lastGuidanceAtPlanVersion: Number.isFinite(parsed.lastGuidanceAtPlanVersion)
        ? Math.max(0, Number(parsed.lastGuidanceAtPlanVersion))
        : null,
    };
  } catch {
    return createDefaultAgentThreadState(skill);
  }
}

function hasSlotValue(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

function hasMinimumExecutableAdState(
  state: CommerceAdAgentThreadState,
  skill: CommerceAgentSkill | null
): boolean {
  return Boolean(state.imageAnalysis) && getSkillRequiredSlots(skill)
    .every((slotKey) => hasSlotValue(state.confirmedSlots[slotKey]));
}

function isDefaultAgentThreadState(state: CommerceAdAgentThreadState): boolean {
  return (
    state.phase === 'collecting'
    && Object.keys(state.confirmedSlots).length === 0
    && !state.imageAnalysis
    && state.planVersion === 0
    && state.guidanceRound === 0
  );
}

function isEmptyCommerceAgentDraftThread(input: {
  messages: CommerceAdAgentMessage[];
  draft: string;
  chatImages: CommerceAdProductImage[];
  state: CommerceAdAgentThreadState;
}): boolean {
  return input.messages.length === 0
    && input.draft.trim().length === 0
    && input.chatImages.length === 0
    && isDefaultAgentThreadState(input.state);
}

function computeMissingAgentSlots(
  state: CommerceAdAgentThreadState,
  skill: CommerceAgentSkill | null
): string[] {
  return getSkillRequiredSlots(skill).filter((key) => !hasSlotValue(state.confirmedSlots[key]));
}

function isAgentReadyForSkillWork(
  state: CommerceAdAgentThreadState,
  skill: CommerceAgentSkill | null
): boolean {
  if (!skill) {
    return Boolean(state.imageAnalysis) || Object.keys(state.confirmedSlots).length > 0 || state.planVersion > 0;
  }
  return computeMissingAgentSlots(state, skill).length === 0
    && (Boolean(state.imageAnalysis) || Object.keys(state.confirmedSlots).length > 0);
}

function getSkillSlotLabel(skill: CommerceAgentSkill | null, slotKey: string): string {
  return skill?.slotLabels?.[slotKey] ?? slotKey;
}

function normalizeGuidanceToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:，,；;。.!！?？、\-_/|()[\]{}"'`]/g, '')
    .trim();
}

function isUserRequestingMoreCreativeGuidance(text: string): boolean {
  return /再|继续|优化|建议|方向|换|改|更高级|更时尚|more|another|again|refine|optimi[sz]e|direction/i.test(text);
}

function isUserClearlyAskingForMoreOptions(text: string): boolean {
  return /更多|多[一几]个|再来|继续|推荐|色系|配色|颜色|方向|方案|灵感|优化|建议|换|改|高级|时尚|more|another|again|refine|optimi[sz]e|direction|palette|color/i.test(text);
}

function isOneShotCreativeExplorationRequest(text: string): boolean {
  return isUserClearlyAskingForMoreOptions(text) && !/生成|制作|出图|开始|确认|采用|选择|就这个|go|start|generate/i.test(text);
}

function buildMoreCreativeGuidanceFallback(userMessage: string): Pick<CommerceAdAgentGuidance, 'designDirections' | 'quickReplies' | 'panelTitle' | 'guidanceKind' | 'readinessHint'> {
  const wantsColor = /色系|配色|颜色|palette|color/i.test(userMessage);
  if (wantsColor) {
    return {
      panelTitle: '推荐方向',
      guidanceKind: 'recommendation',
      designDirections: [
        {
          id: 'palette-warm-premium',
          title: '暖白金高级感',
          description: '使用暖白、香槟金、浅灰金做主色，适合强调柔和、精致、厨房高级质感。',
          tags: ['暖色', '高级', '柔和'],
        },
        {
          id: 'palette-cool-metallic',
          title: '冷灰银现代感',
          description: '使用浅灰、银色、深石墨色做层次，适合更科技、更克制、更现代的产品表达。',
          tags: ['冷色', '现代', '金属'],
        },
        {
          id: 'palette-soft-lifestyle',
          title: '燕麦奶油生活感',
          description: '使用奶油白、燕麦色、鼠尾草绿做背景和道具，适合偏生活方式和温柔种草。',
          tags: ['生活感', '清爽', '自然'],
        },
      ],
      quickReplies: ['选择暖白金高级感', '选择冷灰银现代感', '选择燕麦奶油生活感'],
      readinessHint: '可以点选一个色系，我会把它放入输入框继续细化。',
    };
  }
  return {
    panelTitle: '推荐方向',
    guidanceKind: 'recommendation',
    designDirections: [
      {
        id: 'direction-premium-hero',
        title: '高级单品主视觉',
        description: '突出产品轮廓、材质和留白，适合首屏、广告主图和品牌感表达。',
        tags: ['主视觉', '高级', '留白'],
      },
      {
        id: 'direction-lifestyle-scene',
        title: '生活方式场景',
        description: '把产品放进真实使用场景，用道具和环境强化使用价值和情绪记忆点。',
        tags: ['场景', '生活感', '种草'],
      },
      {
        id: 'direction-benefit-layout',
        title: '卖点层级海报',
        description: '用短标题、卖点分层和 CTA 强化转化，适合详情首屏或投放素材。',
        tags: ['卖点', '转化', '文案'],
      },
    ],
    quickReplies: ['选择高级单品主视觉', '选择生活方式场景', '选择卖点层级海报'],
    readinessHint: '可以点选一个方向，我会继续把它细化成可出图的方案。',
  };
}

function resolveCreativeGuidanceKind(input: {
  guidance: CommerceAdAgentGuidance;
  state: CommerceAdAgentThreadState;
  skill: CommerceAgentSkill | null;
  nextAction?: CommerceAgentNextAction;
  userMessage: string;
}): NonNullable<CommerceAdAgentGuidance['guidanceKind']> {
  const explicitKind = input.guidance.guidanceKind;
  const isOneShotExploration = isOneShotCreativeExplorationRequest(input.userMessage);
  const wantsMore = isOneShotExploration || isUserRequestingMoreCreativeGuidance(input.userMessage);
  const lastKind = input.state.shownGuidanceKinds.slice(-1)[0];
  const hasMissingGuidance = input.guidance.missingFields.length > 0 || input.guidance.questions.length > 0;
  if (isOneShotExploration) {
    return 'recommendation';
  }
  if (explicitKind && (explicitKind !== lastKind || wantsMore)) {
    return explicitKind;
  }
  if (hasMissingGuidance && input.guidance.designDirections.length === 0) {
    return 'missing_info';
  }
  if (input.nextAction === 'plan' || input.nextAction === 'ready' || input.nextAction === 'generate') {
    if (input.state.guidanceRound <= 0) {
      return 'recommendation';
    }
    if (input.state.guidanceRound === 1) {
      return 'optimization';
    }
    if (
      input.state.guidanceRound === 2
      && (
        computeMissingAgentSlots(input.state, input.skill).length > 0
        || isUserClearlyAskingForMoreOptions(input.userMessage)
        || isUserRequestingMoreCreativeGuidance(input.userMessage)
      )
    ) {
      return 'final_suggestion';
    }
    return 'ready';
  }
  if (input.state.guidanceRound <= 0) {
    return 'recommendation';
  }
  if (input.state.guidanceRound === 1) {
    return 'optimization';
  }
  return 'final_suggestion';
}

function resolveCreativeGuidancePanelTitle(kind: CommerceAdAgentGuidance['guidanceKind']): string {
  if (kind === 'optimization') {
    return '优化建议';
  }
  if (kind === 'final_suggestion') {
    return '成稿建议';
  }
  if (kind === 'missing_info') {
    return '需要补充';
  }
  if (kind === 'ready') {
    return '方案已就绪';
  }
  return '推荐方向';
}

function shouldShowCreativeDirections(input: {
  guidance: CommerceAdAgentGuidance;
  guidanceKind: NonNullable<CommerceAdAgentGuidance['guidanceKind']>;
  state: CommerceAdAgentThreadState;
  skill: CommerceAgentSkill | null;
  nextAction?: CommerceAgentNextAction;
  userMessage: string;
}): boolean {
  if (input.guidance.designDirections.length === 0) {
    return false;
  }
  if (input.guidanceKind === 'ready') {
    return false;
  }
  const isOneShotExploration = isOneShotCreativeExplorationRequest(input.userMessage);
  const wantsMore = isOneShotExploration || isUserRequestingMoreCreativeGuidance(input.userMessage);
  const repeatedKind = input.state.shownGuidanceKinds.slice(-1)[0] === input.guidanceKind;
  if (repeatedKind && !wantsMore) {
    return false;
  }
  if (input.state.guidanceRound < COMMERCE_AGENT_MIN_CREATIVE_GUIDANCE_ROUNDS) {
    return true;
  }
  if (input.state.guidanceRound < COMMERCE_AGENT_MAX_DEFAULT_CREATIVE_GUIDANCE_ROUNDS) {
    return isOneShotExploration
      || input.guidanceKind === 'final_suggestion'
      || !isAgentReadyForSkillWork(input.state, input.skill)
      || wantsMore;
  }
  return wantsMore;
}

function findSlotKeyInGuidanceText(
  text: string,
  skill: CommerceAgentSkill | null
): string | null {
  const normalizedText = normalizeGuidanceToken(text);
  if (!normalizedText) {
    return null;
  }
  const slotEntries = [
    ...getSkillRequiredSlots(skill),
    ...(skill?.optionalSlots ?? []),
  ].map((slotKey) => ({
    slotKey,
    names: [
      slotKey,
      getSkillSlotLabel(skill, slotKey),
      ...(skill?.slotAliases?.[slotKey] ?? []),
    ],
  }));
  const matched = slotEntries.find(({ names }) => names.some((name) => {
    const normalizedName = normalizeGuidanceToken(name);
    return normalizedName && normalizedText.includes(normalizedName);
  }));
  return matched?.slotKey ?? null;
}

function isGuidanceQuestionAnswered(
  question: CommerceAdAgentGuidance['questions'][number],
  state: CommerceAdAgentThreadState,
  skill: CommerceAgentSkill | null
): boolean {
  const slotKey = findSlotKeyInGuidanceText(`${question.id} ${question.label}`, skill);
  return Boolean(slotKey && hasSlotValue(state.confirmedSlots[slotKey]));
}

function normalizeAgentGuidanceForState(
  guidance: CommerceAdAgentGuidance | undefined,
  state: CommerceAdAgentThreadState,
  skill: CommerceAgentSkill | null,
  nextAction?: CommerceAgentNextAction,
  userMessage = ''
): CommerceAdAgentGuidance | undefined {
  if (!guidance) {
    return undefined;
  }
  const missingSlots = computeMissingAgentSlots(state, skill);
  const isReady = nextAction === 'plan'
    || nextAction === 'ready'
    || nextAction === 'generate'
    || isAgentReadyForSkillWork(state, skill);
  const confirmedSlotLabels = Object.keys(state.confirmedSlots)
    .filter((slotKey) => hasSlotValue(state.confirmedSlots[slotKey]))
    .map((slotKey) => normalizeGuidanceToken(getSkillSlotLabel(skill, slotKey)))
    .filter(Boolean);
  const missingSlotLabels = missingSlots.map((slotKey) => getSkillSlotLabel(skill, slotKey));
  const normalizedMissingSlotLabels = missingSlotLabels.map(normalizeGuidanceToken);
  const filteredMissingFields = isReady
    ? []
    : guidance.missingFields.filter((field) => {
        const normalizedField = normalizeGuidanceToken(field);
        if (!normalizedField) {
          return false;
        }
        if (confirmedSlotLabels.some((label) => label && normalizedField.includes(label))) {
          return false;
        }
        return normalizedMissingSlotLabels.length === 0
          || normalizedMissingSlotLabels.some((label) => label && normalizedField.includes(label));
      });
  const filteredQuestions = isReady
    ? []
    : guidance.questions
        .filter((question) => !isGuidanceQuestionAnswered(question, state, skill))
        .filter((question) => {
          const slotKey = findSlotKeyInGuidanceText(`${question.id} ${question.label}`, skill);
          return !slotKey || missingSlots.includes(slotKey);
        })
        .slice(0, 2);
  const usesCreativeGuidanceLoop = skill?.id === 'ad-creative' || !skill;
  const hasConfirmedDirection = hasSlotValue(state.confirmedSlots.visualDirection)
    || hasSlotValue(state.confirmedSlots.outputFormat);
  const creativeGuidanceKind = resolveCreativeGuidanceKind({
    guidance,
    state,
    skill,
    nextAction,
    userMessage,
  });
  const shouldShowDesignDirections = usesCreativeGuidanceLoop
    ? shouldShowCreativeDirections({
        guidance,
        guidanceKind: creativeGuidanceKind,
        state,
        skill,
        nextAction,
        userMessage,
      })
    : !isReady
      && !hasConfirmedDirection
      && state.planVersion === 0
      && guidance.designDirections.length > 0;
  const moreOptionsFallback = (
    usesCreativeGuidanceLoop
    && isUserClearlyAskingForMoreOptions(userMessage)
    && guidance.designDirections.length === 0
    && guidance.questions.length === 0
    && guidance.quickReplies.length === 0
  )
    ? buildMoreCreativeGuidanceFallback(userMessage)
    : null;
  const nextGuidance: CommerceAdAgentGuidance = {
    ...guidance,
    panelTitle: moreOptionsFallback?.panelTitle || guidance.panelTitle || (usesCreativeGuidanceLoop ? resolveCreativeGuidancePanelTitle(creativeGuidanceKind) : undefined),
    guidanceKind: moreOptionsFallback?.guidanceKind || (usesCreativeGuidanceLoop ? creativeGuidanceKind : guidance.guidanceKind),
    missingFields: filteredMissingFields.length > 0 ? filteredMissingFields : (skill && !isReady ? missingSlotLabels : guidance.missingFields),
    questions: filteredQuestions,
    designDirections: moreOptionsFallback?.designDirections ?? (shouldShowDesignDirections ? guidance.designDirections.slice(0, 3) : []),
    quickReplies: moreOptionsFallback?.quickReplies ?? (isReady && !shouldShowDesignDirections ? [] : guidance.quickReplies.slice(0, 3)),
    readinessHint: moreOptionsFallback?.readinessHint || guidance.readinessHint,
  };
  return hasGuidanceContent(nextGuidance) ? nextGuidance : undefined;
}

function resolveAgentNextAction(
  requestedAction: CommerceAgentNextAction | undefined,
  state: CommerceAdAgentThreadState,
  skill: CommerceAgentSkill | null
): CommerceAgentNextAction | undefined {
  if (isAgentReadyForSkillWork(state, skill)) {
    return requestedAction === 'generate' ? 'generate' : requestedAction === 'plan' ? 'plan' : 'ready';
  }
  return requestedAction;
}

function inferAdAgentTurnIntent(input: {
  text: string;
  hasNewImages: boolean;
  state: CommerceAdAgentThreadState;
}): CommerceAdAgentTurnIntent {
  const text = input.text.trim().toLowerCase();
  if (input.hasNewImages && input.state.imageAnalysis) {
    return 'new_image';
  }
  if (/换成|改成|改为|替换|不要|重新|换/.test(text)) {
    return 'revise';
  }
  if (/继续|生成|开始|可以|出方案|直接做|下一步|go\b|start\b/.test(text)) {
    return 'continue';
  }
  if (input.state.planVersion > 0 || input.state.imageAnalysis) {
    return 'supplement';
  }
  return 'initial';
}

function extractConfirmedSlotsFromText(
  text: string,
  skill: CommerceAgentSkill | null
): Partial<CommerceAdAgentThreadState['confirmedSlots']> {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  const patch: Partial<CommerceAdAgentThreadState['confirmedSlots']> = {};
  const platforms = [
    ['instagram', 'Instagram Feed'],
    ['facebook', 'Facebook Feed'],
    ['tiktok', 'TikTok'],
    ['linkedin', 'LinkedIn'],
    ['youtube', 'YouTube'],
    ['google', 'Google Ads'],
    ['x平台', 'X'],
    ['twitter', 'X'],
  ]
    .filter(([needle]) => lower.includes(needle.toLowerCase()))
    .map(([, label]) => label);
  if (platforms.length > 0) {
    patch.platforms = platforms;
  }
  const objective = (() => {
    if (/品牌曝光|曝光|认知|awareness/i.test(normalized)) return '品牌曝光';
    if (/转化|下单|购买|conversion/i.test(normalized)) return '转化下单';
    if (/引流|点击|访问|traffic/i.test(normalized)) return '点击引流';
    if (/获客|留资|线索|lead/i.test(normalized)) return '获客留资';
    return '';
  })();
  const visualDirection = (() => {
    if (/高端|质感|高级|精品|奢华/.test(normalized)) return '高端单品主视觉';
    if (/生活方式|场景|居家|户外/.test(normalized)) return '生活方式场景';
    if (/ugc|达人|原生|真实/.test(lower)) return 'UGC 原生广告';
    if (/促销|优惠|折扣|限时/.test(normalized)) return '促销利益点海报';
    return '';
  })();
  const cta = (() => {
    const match = normalized.match(/(?:CTA|行动号召|按钮)[：: ]?([^；;\n]+)/i);
    return match?.[1]?.trim() ?? '';
  })();
  const brandInfo = (() => {
    const match = normalized.match(/(?:品牌|品牌名)[：: ]?([^；;\n]+)/);
    return match?.[1]?.trim() ?? '';
  })();
  const audience = (() => {
    const match = normalized.match(/(?:人群|受众|目标用户)[：: ]?([^；;\n]+)/);
    return match?.[1]?.trim() ?? '';
  })();
  const sellingPoint = (() => {
    const match = normalized.match(/(?:卖点|核心卖点|突出)[：: ]?([^；;\n]+)/);
    return match?.[1]?.trim() ?? '';
  })();
  const outputFormat = (() => {
    if (/主视觉|单图|静态图/.test(normalized)) return '静态广告主视觉';
    if (/短视频|reels|story|竖版/.test(lower)) return '短视频/竖版版位';
    return '';
  })();
  if (objective) patch.objective = objective;
  if (visualDirection) patch.visualDirection = visualDirection;
  if (cta) patch.cta = cta;
  if (brandInfo) patch.brandInfo = brandInfo;
  if (audience) patch.audience = audience;
  if (sellingPoint) patch.sellingPoint = sellingPoint;
  if (outputFormat) patch.outputFormat = outputFormat;

  Object.entries(skill?.slotAliases ?? {}).forEach(([slotKey, aliases]) => {
    if (patch[slotKey]) {
      return;
    }
    for (const alias of aliases) {
      const match = normalized.match(new RegExp(`${alias}[：: ]?([^；;\\n]+)`));
      if (match?.[1]?.trim()) {
        patch[slotKey] = match[1].trim();
        break;
      }
    }
  });

  return patch;
}

function mergeAgentThreadState(
  current: CommerceAdAgentThreadState,
  patch: Omit<Partial<CommerceAdAgentThreadState>, 'confirmedSlots'> & {
    confirmedSlots?: Partial<CommerceAdAgentThreadState['confirmedSlots']>;
  },
  skill: CommerceAgentSkill | null = null
): CommerceAdAgentThreadState {
  const confirmedPatch = patch.confirmedSlots ?? {};
  const imageAnalysis = patch.imageAnalysis ?? current.imageAnalysis;
  const mergedConfirmedSlots = Object.fromEntries(
    Object.entries({
      ...current.confirmedSlots,
      ...confirmedPatch,
    }).filter(([, value]) => value !== undefined)
  ) as CommerceAdAgentThreadState['confirmedSlots'];
  const next: CommerceAdAgentThreadState = {
    ...current,
    ...patch,
    ...(imageAnalysis ? { imageAnalysis } : {}),
    skillId: patch.skillId ?? current.skillId ?? skill?.id ?? '',
    confirmedSlots: mergedConfirmedSlots,
    lastAskedFields: patch.lastAskedFields ?? current.lastAskedFields,
    missingSlots: patch.missingSlots ?? current.missingSlots,
    guidanceRound: Math.max(0, Math.round(Number(patch.guidanceRound ?? current.guidanceRound) || 0)),
    shownGuidanceKinds: Array.from(new Set([
      ...current.shownGuidanceKinds,
      ...(patch.shownGuidanceKinds ?? []),
    ].filter(Boolean))),
    lastGuidanceAtPlanVersion: patch.lastGuidanceAtPlanVersion ?? current.lastGuidanceAtPlanVersion ?? null,
  };
  next.confirmedSlots = Object.fromEntries(
    Object.entries(next.confirmedSlots)
      .map(([key, value]) => [key, Array.isArray(value) ? Array.from(new Set(value)) : value])
      .filter(([, value]) => hasSlotValue(value))
  );
  next.missingSlots = computeMissingAgentSlots(next, skill);
  next.phase = hasMinimumExecutableAdState(next, skill)
    ? (patch.phase === 'refining' ? 'refining' : 'ready')
    : (patch.phase ?? next.phase);
  return next;
}

function buildThinkingPreviewText(text: string): string {
  const compact = text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) {
    return '';
  }

  const sentenceMatches = compact.match(/[^。！？!?]+[。！？!?]?/g) ?? [compact];
  const recentSentences = sentenceMatches
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' ');
  if (recentSentences.length <= COMMERCE_AGENT_THINKING_PREVIEW_MAX_CHARS) {
    return recentSentences;
  }

  return `${recentSentences.slice(-COMMERCE_AGENT_THINKING_PREVIEW_MAX_CHARS).trimStart()}...`;
}

function appendNextTypewriterChar(queueRef: MutableRefObject<string>, update: (value: string) => void): boolean {
  const nextChar = queueRef.current.slice(0, 1);
  if (!nextChar) {
    return false;
  }
  queueRef.current = queueRef.current.slice(1);
  update(nextChar);
  return true;
}

function ThinkingPreviewBubble({
  text,
  fallback,
}: {
  text?: string;
  fallback: string;
}) {
  return (
    <div className="rounded-lg bg-text-dark/[0.04] px-3 py-2">
      <div className="flex items-start gap-2 text-sm leading-6 text-text-muted">
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
        <div className="min-w-0">
          <div className="line-clamp-2 text-text-dark/85">
            {text || fallback}
          </div>
          <div className="mt-1 h-0.5 w-20 overflow-hidden rounded-full bg-text-dark/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-text-dark/35" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StructuredAnalysisProgress({
  steps,
}: {
  steps: string[];
}) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2 text-sm leading-6 text-text-muted">
      {steps.map((step, index) => (
        <div key={`${step}-${index}`} className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

function PendingImageAnalysisDisclosure() {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-text-dark/[0.06] px-3 py-3 text-sm leading-6 text-text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>{t('commerceAd.agent.imageAnalysis.pending')}</span>
    </div>
  );
}

function ImageAnalysisDisclosure({
  analysis,
}: {
  analysis: CommerceAdAgentImageAnalysis;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(!analysis.collapsedByDefault);
  const hasContent = Boolean(
    analysis.summary
    || analysis.observations.length > 0
    || analysis.uncertainties.length > 0
  );

  if (!hasContent) {
    return null;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl bg-text-dark/[0.06]">
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium text-text-dark transition hover:bg-text-dark/[0.06]"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate">{t('commerceAd.agent.imageAnalysis.title')}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen ? (
        <div className="space-y-2 px-3 pb-3 pt-1 text-sm leading-6 text-text-dark/85">
          {analysis.summary ? (
            <p className="whitespace-pre-wrap">{analysis.summary}</p>
          ) : null}
          {analysis.observations.length > 0 ? (
            <div>
              <div className="font-medium text-text-dark">
                {t('commerceAd.agent.imageAnalysis.observations')}
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {analysis.observations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.uncertainties.length > 0 ? (
            <div>
              <div className="font-medium text-text-dark">
                {t('commerceAd.agent.imageAnalysis.uncertainties')}
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {analysis.uncertainties.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GuidanceChoiceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-6 transition-colors ${
        active
          ? 'bg-text-dark/[0.12] text-text-dark'
          : 'bg-transparent text-text-muted hover:bg-text-dark/[0.07] hover:text-text-dark'
      }`}
    >
      <span className="text-text-muted">↳</span>
      <span>{children}</span>
    </button>
  );
}

function resolveActiveStageNode<T extends CanvasNode['data']>(
  nodes: CanvasNode[],
  type: CanvasNode['type'],
  selectedNodeId: string | null
): (CanvasNode & { data: T }) | null {
  const matchingNodes = nodes.filter((node) => node.type === type);
  if (matchingNodes.length === 0) {
    return null;
  }

  const selectedMatch = selectedNodeId
    ? matchingNodes.find((node) => node.id === selectedNodeId)
    : null;
  if (selectedMatch) {
    return selectedMatch as CanvasNode & { data: T };
  }

  const markedSelectedMatch = matchingNodes.find((node) => node.selected);
  if (markedSelectedMatch) {
    return markedSelectedMatch as CanvasNode & { data: T };
  }

  return matchingNodes[matchingNodes.length - 1] as CanvasNode & { data: T };
}

function resolveCommerceResultImagePosition(
  resultGroupNode: Pick<CanvasNode, 'position' | 'width' | 'measured' | 'style'> | null | undefined,
  index: number
): { x: number; y: number } {
  const groupX = resultGroupNode?.position.x ?? 1260;
  const groupY = resultGroupNode?.position.y ?? 420;
  const rawStyleWidth = resultGroupNode?.style?.width;
  const styleWidth =
    typeof rawStyleWidth === 'number'
      ? rawStyleWidth
      : typeof rawStyleWidth === 'string'
        ? Number.parseFloat(rawStyleWidth)
        : null;
  const groupWidth =
    resultGroupNode?.measured?.width ??
    resultGroupNode?.width ??
    (Number.isFinite(styleWidth) ? styleWidth : null) ??
    380;
  const column = index % COMMERCE_RESULT_IMAGE_COLUMNS;
  const row = Math.floor(index / COMMERCE_RESULT_IMAGE_COLUMNS);

  return {
    x: Math.round(groupX + groupWidth + COMMERCE_RESULT_GROUP_TO_IMAGE_GAP + column * (COMMERCE_RESULT_IMAGE_NODE_WIDTH + COMMERCE_RESULT_IMAGE_GAP_X)),
    y: Math.round(groupY + row * (COMMERCE_RESULT_IMAGE_NODE_HEIGHT + COMMERCE_RESULT_IMAGE_GAP_Y)),
  };
}

function countCommerceResultImages(batches: CommerceAdGenerationBatch[] | undefined): number {
  return (batches ?? []).reduce((total, batch) => total + (batch.images?.length ?? 0), 0);
}

function mergeProductImages(
  product: CommerceProductNodeData | null,
  images: CommerceAdProductImage[]
): CommerceAdProductState {
  const existingImages = product?.images ?? [];
  return {
    images: [...existingImages, ...images],
    brand: product?.brand ?? '',
    productName: product?.productName ?? '',
    category: product?.category ?? '',
    detailInputMode: product?.detailInputMode ?? 'auto',
    lockedDocumentInfo: product?.lockedDocumentInfo ?? '',
    userIdeaInfo: product?.userIdeaInfo ?? product?.userInfo ?? '',
    userInfo: product?.userInfo ?? '',
    inference: product?.inference ?? null,
    lastAnalyzedAt: product?.lastAnalyzedAt ?? null,
    lastError: null,
  };
}

function normalizeProductImageRoles(images: CommerceAdProductImage[]): CommerceAdProductImage[] {
  return images.map((image, index) => ({
    ...image,
    kind: index === 0 ? 'main' : 'reference',
    evidenceTags: image.evidenceTags ?? [],
  }));
}

function composeProductUserInfo(lockedDocumentInfo: string, userIdeaInfo: string): string {
  return [
    lockedDocumentInfo.trim()
      ? `文档信息（不可改）：\n${lockedDocumentInfo.trim()}`
      : '',
    userIdeaInfo.trim()
      ? `想法补充（AI 可优化）：\n${userIdeaInfo.trim()}`
      : '',
  ].filter(Boolean).join('\n\n');
}

function composeProductImageReferenceNotes(images: CommerceAdProductImage[]): string {
  return images
    .slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT)
    .map((image, index) => {
      const role = index === 0 ? '主图' : `参考图 ${index}`;
      const description = image.description?.trim();
      return description ? `${role}：${description}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function collectConversationContext(messages: CommerceAdAgentMessage[]): {
  text: string;
  images: CommerceAdProductImage[];
} {
  const visibleMessages = messages.filter((message) => !isInternalProductInfoMessage(message));
  const text = visibleMessages
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : 'Agent'}：${message.content.trim()}`)
    .filter((line) => line.trim().length > 0)
    .join('\n');
  const images = normalizeProductImageRoles(
    visibleMessages.flatMap((message) => message.images ?? [])
  ).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
  return { text, images };
}

function parsePersistedCommerceAgentMessages(messagesJson: string): CommerceAdAgentMessage[] {
  try {
    const parsed = JSON.parse(messagesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_AGENT_MESSAGES;
    }
    return parsed
      .filter((item): item is CommerceAdAgentMessage => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as CommerceAdAgentMessage).id === 'string'
        && typeof (item as CommerceAdAgentMessage).role === 'string'
        && typeof (item as CommerceAdAgentMessage).content === 'string'
      ))
      .map((message) => ({
        ...message,
        createdAt: Number(message.createdAt) || Date.now(),
        images: Array.isArray(message.images) ? message.images : undefined,
        imageAnalysis: message.imageAnalysis
          && typeof message.imageAnalysis === 'object'
          ? {
              summary: typeof message.imageAnalysis.summary === 'string' ? message.imageAnalysis.summary : '',
              observations: Array.isArray(message.imageAnalysis.observations)
                ? message.imageAnalysis.observations.filter((item): item is string => typeof item === 'string')
                : [],
              uncertainties: Array.isArray(message.imageAnalysis.uncertainties)
                ? message.imageAnalysis.uncertainties.filter((item): item is string => typeof item === 'string')
                : [],
              collapsedByDefault: message.imageAnalysis.collapsedByDefault !== false,
            }
          : undefined,
      }));
  } catch {
    return DEFAULT_AGENT_MESSAGES;
  }
}

function createCommerceAgentThreadId(): string {
  return `commerce-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateCommerceAgentThreadTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function deriveCommerceAgentThreadTitle(
  messages: CommerceAdAgentMessage[],
  selectedSkill: CommerceAgentSkill | null,
  untitledChatLabel: string
): string {
  const firstUserMessage = messages.find((message) => (
    message.role === 'user' && message.content.trim().length > 0
  ));
  if (firstUserMessage) {
    return truncateCommerceAgentThreadTitle(firstUserMessage.content);
  }
  if (selectedSkill) {
    return selectedSkill.title;
  }
  return untitledChatLabel;
}

function readCommerceAgentPanelWidth(): number {
  if (typeof window === 'undefined') {
    return 400;
  }
  const value = Number(window.localStorage.getItem(COMMERCE_AGENT_PANEL_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(value)) {
    return 400;
  }
  return Math.min(COMMERCE_AGENT_PANEL_MAX_WIDTH, Math.max(COMMERCE_AGENT_PANEL_MIN_WIDTH, value));
}

function isInternalProductInfoMessage(message: CommerceAdAgentMessage): boolean {
  if (message.role !== 'user') {
    return false;
  }

  const content = message.content.trim();
  return content.startsWith('文档信息（不可改）：')
    || content.startsWith('Document copy (locked):');
}

function createImageChangedProductState(
  images: CommerceAdProductImage[],
  lockedDocumentInfo: string,
  userIdeaInfo: string,
  detailInputMode: CommerceAdProductState['detailInputMode'] = 'auto'
): CommerceAdProductState {
  return {
    images: normalizeProductImageRoles(images),
    brand: '',
    productName: '',
    category: '',
    detailInputMode,
    lockedDocumentInfo,
    userIdeaInfo,
    userInfo: composeProductUserInfo(lockedDocumentInfo, userIdeaInfo),
    inference: null,
    lastAnalyzedAt: null,
    lastError: null,
  };
}

function resolveCommerceDefaultResolution(
  model: Parameters<typeof resolveImageModelResolutions>[0]
): string {
  const resolutions = resolveImageModelResolutions(model, { extraParams: {} });
  return (
    resolutions.find((item) => item.value === COMMERCE_DEFAULT_RESOLUTION)?.value
    ?? resolutions.find((item) => item.value === model.defaultResolution)?.value
    ?? resolutions[0]?.value
    ?? model.defaultResolution
  );
}

function resolveCommerceAspectRatiosForModel(
  model: Parameters<typeof resolveImageModelResolutions>[0],
  preferredRatios: string[]
): string[] {
  const ratioOptions = model.aspectRatios;
  const supportedRatios = new Set(ratioOptions.map((item) => item.value));
  const selectedRatios = preferredRatios.filter((ratio) => supportedRatios.has(ratio));

  if (selectedRatios.length > 0) {
    return selectedRatios;
  }

  const defaultRatio = supportedRatios.has(model.defaultAspectRatio)
    ? model.defaultAspectRatio
    : ratioOptions[0]?.value;
  return defaultRatio ? [defaultRatio] : ['1:1'];
}

function normalizeCommerceTextForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-./|,，、;；:：()\[\]{}]+/g, '');
}

function normalizeCommerceAspectRatioToken(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed
    .replace(/[：]/g, ':')
    .replace(/[xX×]/g, ':')
    .replace(/\s+/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return match ? `${match[1]}:${match[2]}` : trimmed;
}

function collectCommerceSlotStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => collectCommerceSlotStrings(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  return [];
}

function collectPlatformHintsFromAgentContext(input: {
  selectedSkillId: string;
  text: string;
  confirmedSlots?: CommerceAdAgentThreadState['confirmedSlots'];
  briefPlatform?: string;
}): string[] {
  const platformSlotValues = collectCommerceSlotStrings(input.confirmedSlots?.platforms);
  return dedupeStrings([
    ...platformSlotValues,
    input.briefPlatform ?? '',
    input.selectedSkillId ? input.text : '',
  ]);
}

function resolveCommercePlatformAspectRatioCandidates(platformHints: string[]): string[] {
  if (platformHints.length === 0) {
    return [];
  }

  const normalizedHints = platformHints.map(normalizeCommerceTextForMatching).filter(Boolean);
  const hasAny = (needles: string[]) => normalizedHints.some((hint) => (
    needles.some((needle) => hint.includes(normalizeCommerceTextForMatching(needle)))
  ));
  const includesFeed = hasAny(['feed', '信息流', '帖子', '动态']);
  const includesStoryLike = hasAny(['story', 'stories', 'reels', 'shorts', '竖版', '短视频', '故事']);
  const includesLandscapeLike = hasAny(['landscape', '横版', 'in-stream', 'instream', 'thumbnail', '视频封面']);
  const ratios: string[] = [];
  const add = (...items: string[]) => {
    items.forEach((item) => {
      if (!ratios.includes(item)) {
        ratios.push(item);
      }
    });
  };

  if (hasAny(['instagram', 'ig', 'ins'])) {
    if (includesStoryLike) {
      add('9:16');
    }
    if (includesFeed || !includesStoryLike) {
      add('4:5', '1:1');
    }
  }
  if (hasAny(['facebook', 'fb'])) {
    if (includesStoryLike) {
      add('9:16');
    }
    add('4:5', '1:1');
  }
  if (hasAny(['tiktok', '抖音'])) {
    add('9:16');
  }
  if (hasAny(['linkedin', '领英'])) {
    add('16:9', '1:1');
  }
  if (hasAny(['youtube', 'yt'])) {
    if (includesStoryLike) {
      add('9:16');
    } else {
      add('16:9');
    }
  }
  if (hasAny(['googleads', 'google广告', '谷歌广告', 'displayads', 'responsiveads', 'gdn'])) {
    add('16:9', '1:1');
  }
  if (hasAny(['x平台', 'twitter', '推特']) || normalizedHints.includes('x')) {
    add('16:9', '1:1');
  }
  if (hasAny(['多平台', 'multi-platform', 'multiplatform', '全平台', '跨平台'])) {
    add('9:16', '4:5', '1:1', '16:9');
  }
  if (includesStoryLike && ratios.length === 0) {
    add('9:16');
  }
  if (includesLandscapeLike && ratios.length === 0) {
    add('16:9');
  }

  return ratios;
}

function resolveCommerceAgentPlanAspectRatios(input: {
  model: Parameters<typeof resolveImageModelResolutions>[0];
  selectedSkillId: string;
  text: string;
  confirmedSlots?: CommerceAdAgentThreadState['confirmedSlots'];
  briefPlatform?: string;
  llmRatios: string[];
  previousRatios: string[];
  fallbackRatios: string[];
}): string[] {
  const platformHints = collectPlatformHintsFromAgentContext({
    selectedSkillId: input.selectedSkillId,
    text: input.text,
    confirmedSlots: input.confirmedSlots,
    briefPlatform: input.briefPlatform,
  });
  const platformRatios = resolveCommercePlatformAspectRatioCandidates(platformHints);
  const normalizedLlmRatios = input.llmRatios.map(normalizeCommerceAspectRatioToken);
  const normalizedPreviousRatios = input.previousRatios.map(normalizeCommerceAspectRatioToken);
  const normalizedFallbackRatios = input.fallbackRatios.map(normalizeCommerceAspectRatioToken);
  const preferredRatios = dedupeStrings([
    ...platformRatios,
    ...normalizedLlmRatios,
    ...(
      platformRatios.length > 0
        ? []
        : normalizedPreviousRatios
    ),
    ...normalizedFallbackRatios,
  ]);
  const modelRatios = resolveCommerceAspectRatiosForModel(input.model, preferredRatios);
  if (platformRatios.length === 0) {
    return modelRatios;
  }
  return modelRatios.slice(0, COMMERCE_PLATFORM_RATIO_LIMIT);
}

function normalizeDetailPagesForEditing(pages: CommerceAdDetailPage[]): CommerceAdDetailPage[] {
  return pages.map((page, index) => ({
    ...page,
    id: page.id || `commerce-detail-page-${Date.now()}-${index + 1}`,
    pageNo: index + 1,
  }));
}

function createDetailPageDraft(partial: Partial<CommerceAdDetailPage> = {}): CommerceAdDetailPage {
  return {
    id: partial.id || `commerce-detail-page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pageNo: partial.pageNo ?? 1,
    title: partial.title ?? '',
    pageGoal: partial.pageGoal ?? '',
    lockedCopy: partial.lockedCopy ?? '',
    optimizedCopy: partial.optimizedCopy ?? '',
    layoutNotes: partial.layoutNotes ?? '',
    blueprint: partial.blueprint ?? '',
    referenceImageIds: partial.referenceImageIds ?? [],
    qualityNotes: partial.qualityNotes ?? [],
    prompt: partial.prompt ?? '',
  };
}

function hasLockedDetailPageInfo(pages: CommerceAdDetailPage[]): boolean {
  return pages.some((page) => page.lockedCopy.trim().length > 0);
}

function composeManualDetailPagesLockedInfo(pages: CommerceAdDetailPage[]): string {
  return normalizeDetailPagesForEditing(pages)
    .map((page) => ({
      pageNo: page.pageNo,
      lockedCopy: page.lockedCopy.trim(),
    }))
    .filter((page) => page.lockedCopy.length > 0)
    .map((page) => `第 ${page.pageNo} 页：\n${page.lockedCopy}`)
    .join('\n\n');
}

function composeDetailPagePrompt(
  page: CommerceAdDetailPage,
  corePrompt: string,
  visualPreference: CommerceAdVisualPreferenceState | null | undefined,
  imageReferenceNotes = ''
): string {
  return [
    corePrompt.trim(),
    `详情页第 ${page.pageNo} 页：${page.title || '未命名页'}`,
    page.lockedCopy.trim()
      ? `必须原样出现在画面上的文档信息，不得改写：\n${page.lockedCopy.trim()}`
      : '',
    page.optimizedCopy.trim()
      ? `可优化表达后的说明文案：\n${page.optimizedCopy.trim()}`
      : '',
    page.layoutNotes.trim()
      ? `版式备注：${page.layoutNotes.trim()}`
      : '',
    page.prompt.trim(),
    visualPreference?.promptFragment?.trim() ?? '',
    imageReferenceNotes.trim()
      ? `商品参考图说明：\n${imageReferenceNotes.trim()}`
      : '',
    '生成电商详情页分页图片，页面信息层级清晰，商品主体准确，画面文字必须清晰可读。',
  ].filter(Boolean).join('\n\n');
}

function buildDetailPageGenerationBatch(
  batch: CommerceBatchGenerateNodeData | null,
  corePrompt: string,
  detailPages: CommerceAdDetailPage[],
  visualPreference: CommerceAdVisualPreferenceState | null | undefined,
  imageReferenceNotes = ''
): CommerceAdGenerationBatch {
  const aspectRatios = batch?.aspectRatios?.length ? batch.aspectRatios : ['4:5'];
  const variantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(batch?.variantsPerRatio) || 1)));
  const batchCount = Math.max(1, Math.min(20, Math.round(Number(batch?.batchCount) || 1)));
  const batchId = `commerce-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pages = normalizeDetailPagesForEditing(detailPages);
  const images: CommerceAdGeneratedImageRecord[] = pages.flatMap((page) => (
    aspectRatios.flatMap((aspectRatio) => (
      Array.from({ length: batchCount }, (_, batchIndex) => (
        Array.from({ length: variantsPerRatio }, (_, variantIndex): CommerceAdGeneratedImageRecord => ({
          id: [
            batchId,
            `page-${page.pageNo}`,
            `ratio-${aspectRatio.replace(/[^a-z0-9]+/gi, '-')}`,
            `batch-${batchIndex + 1}`,
            `variant-${variantIndex + 1}`,
          ].join('-'),
          aspectRatio,
          detailPageId: page.id,
          detailPageNo: page.pageNo,
          detailPageTitle: [
            page.title,
            aspectRatio,
            batchCount > 1 ? `批次 ${batchIndex + 1}` : '',
            variantsPerRatio > 1 ? `第 ${variantIndex + 1} 张` : '',
          ].filter(Boolean).join(' · '),
          nodeId: null,
          prompt: composeDetailPagePrompt(
            page,
            batch?.ratioPrompts?.[aspectRatio] || corePrompt,
            visualPreference,
            imageReferenceNotes
          ),
          status: 'queued',
          imageUrl: null,
          previewImageUrl: null,
          error: null,
        }))
      )).flat()
    ))
  ));

  return {
    id: batchId,
    createdAt: Date.now(),
    corePrompt,
    aspectRatios,
    variantsPerRatio,
    batchCount,
    generationMode: 'detailPages',
    detailPageCount: pages.length,
    detailPages: pages,
    images,
  };
}

function buildAgentPlanGenerationBatch(plan: CommerceAgentPlanState): CommerceAdGenerationBatch {
  const aspectRatios = plan.aspectRatios.length > 0 ? plan.aspectRatios : ['4:5'];
  const variantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(plan.variantsPerRatio) || 1)));
  const batchCount = Math.max(1, Math.min(20, Math.round(Number(plan.batchCount) || 1)));
  const batchId = `commerce-agent-plan-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const isAdCreativePlan = plan.selectedSkillId === 'ad-creative';
  const userRequestedNoText = /不要(?:加|出现|生成)?(?:文字|文案|标题|字幕|字)|无字(?:版)?|不带(?:文字|文案|标题|字幕)|去掉(?:文字|文案|标题|字幕)|no\s*(?:text|copy|words|typography)|without\s*(?:text|copy|words|typography)/i.test(plan.prompt);
  const buildPrompt = (aspectRatio: string): string => {
    if (!isAdCreativePlan) {
      return plan.prompt;
    }
    if (userRequestedNoText) {
      return [
        plan.prompt,
        '',
        'Fashion ad art direction: premium magazine-like composition, strong but tasteful focal point, commercial photography lighting, realistic material texture, refined color grading, generous negative space for later typography, platform-safe cropping, polished contemporary fashion advertising aesthetic.',
        '广告创意出图要求：遵循用户明确要求，不在画面中生成任何文字、标题、字幕、按钮文案或品牌字样。',
        '可以通过构图、产品摆放、光影、色彩、留白和场景道具表达广告感；如需后期排版，请预留干净留白区。',
        `输出比例：${aspectRatio}。`,
      ].join('\n');
    }
    const layoutHint = aspectRatio === '9:16'
      ? '竖版广告版式：顶部或中上方放一行醒目的短标题，底部安全区放 CTA 按钮文案，主体产品保持居中偏下，文字避开边缘和平台 UI 安全区。'
      : aspectRatio === '16:9'
        ? '横版广告版式：左侧或上方放短标题与一句卖点，右侧突出产品主体，保留清晰 CTA 区域。'
        : '信息流广告版式：画面包含主标题、一句核心卖点和一个短 CTA 按钮，文字排版清晰、留白充足，产品主体与文案形成广告海报感。';
    return [
      plan.prompt,
      '',
      'Fashion ad art direction: premium magazine-like composition, commercial photography lighting, realistic material texture, refined color palette, elegant whitespace, clear product hierarchy, platform-safe crop, polished contemporary fashion advertising aesthetic.',
      '广告创意出图要求：这不是纯产品摄影图，必须生成带广告宣传文案的完整广告素材。',
      '画面文字只使用短文案，避免长段文字；文字需清晰可读、排版专业，允许使用简体中文。',
      '至少包含：1 个主标题、1 个短卖点句、1 个 CTA 按钮或行动号召。',
      '如果品牌名/价格/具体权益未确认，不要编造具体承诺，可使用通用但自然的广告表达。',
      layoutHint,
      `输出比例：${aspectRatio}。`,
    ].join('\n');
  };
  const images: CommerceAdGeneratedImageRecord[] = aspectRatios.flatMap((aspectRatio) => (
    Array.from({ length: batchCount }, (_, batchIndex) => (
      Array.from({ length: variantsPerRatio }, (_, variantIndex): CommerceAdGeneratedImageRecord => ({
        id: [
          batchId,
          `ratio-${aspectRatio.replace(/[^a-z0-9]+/gi, '-')}`,
          `batch-${batchIndex + 1}`,
          `variant-${variantIndex + 1}`,
        ].join('-'),
        aspectRatio,
        detailPageTitle: [
          aspectRatio,
          batchCount > 1 ? `Batch ${batchIndex + 1}` : '',
          variantsPerRatio > 1 ? `Variant ${variantIndex + 1}` : '',
        ].filter(Boolean).join(' / '),
        nodeId: null,
        prompt: buildPrompt(aspectRatio),
        status: 'queued',
        imageUrl: null,
        previewImageUrl: null,
        error: null,
      }))
    )).flat()
  ));

  return {
    id: batchId,
    createdAt: Date.now(),
    corePrompt: isAdCreativePlan ? buildPrompt(aspectRatios[0] ?? '4:5') : plan.prompt,
    aspectRatios,
    variantsPerRatio,
    batchCount,
    generationMode: 'legacyRatios',
    detailPageCount: 0,
    detailPages: [],
    images,
  };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function hasProductInfo(product: Partial<CommerceAdProductState> | null | undefined): boolean {
  if (!product) {
    return false;
  }

  return [
    product.productName,
    product.brand,
    product.category,
    product.lockedDocumentInfo,
    product.userIdeaInfo,
    product.userInfo,
    product.inference?.summary,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

function mergeProductState(
  base: CommerceAdProductState | null | undefined,
  patch: Partial<CommerceAdProductState> | null | undefined
): Partial<CommerceAdProductState> {
  return {
    ...(base ?? {}),
    ...(patch ?? {}),
    inference: patch?.inference ?? base?.inference ?? null,
  };
}

function composeAgentPlanState(input: {
  text: string;
  images: CommerceAdProductImage[];
  previousPlan?: CommerceAgentPlanState | null;
  selectedSkillId: string;
  agentThreadId: string;
  confirmedSlots?: CommerceAdAgentThreadState['confirmedSlots'];
  resultActions: CommerceAdAgentAction[];
  fallbackModelId: string;
  fallbackProviderId: string;
  fallbackSize: string;
  fallbackRatios: string[];
  fallbackModel: Parameters<typeof resolveImageModelResolutions>[0];
}): CommerceAgentPlanState {
  const productAction = input.resultActions.find((action) => action.type === 'upsertProduct');
  const briefAction = input.resultActions.find((action) => action.type === 'upsertBrief');
  const batchAction = input.resultActions.find((action) => action.type === 'upsertBatchGenerate');
  const product = productAction?.type === 'upsertProduct' ? productAction.data : null;
  const brief = briefAction?.type === 'upsertBrief' ? briefAction.data : null;
  const batch = batchAction?.type === 'upsertBatchGenerate' ? batchAction.data : null;
  const defaultPlan = createDefaultCommerceAgentPlanState();
  const prompt = [
    batch?.corePrompt,
    brief?.normalizedBrief,
    brief?.headline,
    input.text,
  ].find((value) => value?.trim())?.trim() ?? '';
  const riskNotes = input.previousPlan
    ? dedupeStrings([
    ...(product?.inference?.uncertaintyNotes ?? []),
    ...(product?.inference?.followUpQuestions ?? []),
    ...(brief?.qualityIssues ?? []),
      ])
    : dedupeStrings(brief?.qualityIssues ?? []).slice(0, 2);
  const resolvedAspectRatios = resolveCommerceAgentPlanAspectRatios({
    model: input.fallbackModel,
    selectedSkillId: input.selectedSkillId,
    text: input.text,
    confirmedSlots: input.confirmedSlots,
    briefPlatform: brief?.platform,
    llmRatios: batch?.aspectRatios ?? [],
    previousRatios: input.previousPlan?.aspectRatios ?? [],
    fallbackRatios: input.fallbackRatios,
  });

  return {
    ...defaultPlan,
    ...(input.previousPlan ?? {}),
    summary: brief?.normalizedBrief || brief?.headline || input.previousPlan?.summary || input.text,
    productUnderstanding: product?.inference?.summary || product?.userInfo || input.previousPlan?.productUnderstanding || input.text,
    creativeDirection: [
      brief?.platform,
      brief?.audience,
      brief?.style,
      ...(brief?.sellingPoints ?? []).slice(0, 4),
    ].filter(Boolean).join('\n') || input.previousPlan?.creativeDirection || '',
    prompt: prompt || input.previousPlan?.prompt || '',
    referenceImages: input.images.length > 0 ? input.images : input.previousPlan?.referenceImages ?? [],
    referenceImageNotes: input.images.length > 0
      ? composeProductImageReferenceNotes(input.images)
      : input.previousPlan?.referenceImageNotes ?? '',
    riskNotes: riskNotes.length > 0 ? riskNotes : input.previousPlan?.riskNotes ?? [],
    selectedSkillId: input.selectedSkillId || input.previousPlan?.selectedSkillId || '',
    agentThreadId: input.agentThreadId || input.previousPlan?.agentThreadId || '',
    providerId: batch?.modelId ? input.fallbackProviderId : input.fallbackProviderId,
    modelId: batch?.modelId || input.fallbackModelId,
    size: batch?.size || input.fallbackSize,
    aspectRatios: resolvedAspectRatios,
    variantsPerRatio: batch?.variantsPerRatio ?? 1,
    batchCount: batch?.batchCount ?? 1,
    status: (prompt || input.previousPlan?.prompt) ? 'ready' : 'idle',
    lastError: null,
  };
}

function VisionModelWarningBar({
  isOpen,
  onToggle,
  onOpenSettings,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-[96] w-[min(420px,calc(100%-2rem))]">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className="pointer-events-auto flex h-8 w-full items-center gap-2 rounded-md border border-amber-300/40 bg-surface-dark px-3 text-left text-xs font-medium text-amber-100 shadow-[0_16px_40px_rgba(0,0,0,0.26)] transition-colors hover:border-amber-300/60 hover:bg-bg-dark"
        aria-expanded={isOpen}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t('commerceAd.agent.visionWarningTitle')}
        </span>
      </button>

      {isOpen ? (
        <div
          className="pointer-events-auto mt-2 rounded-lg border border-amber-400/30 bg-surface-dark p-3 text-sm text-amber-100 shadow-[0_20px_60px_rgba(0,0,0,0.32)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">{t('commerceAd.agent.visionWarningTitle')}</div>
              <p className="mt-1 text-xs leading-5 text-amber-100/80">
                {t('commerceAd.agent.visionWarningBody')}
              </p>
              <UiButton
                type="button"
                size="sm"
                className="mt-2 gap-2"
                onClick={onOpenSettings}
              >
                <Settings className="h-3.5 w-3.5" />
                {t('commerceAd.agent.openModelSettings')}
              </UiButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommerceAgentModuleSwitcher({
  activeModule,
  onChange,
}: {
  activeModule: CommerceAgentModuleId;
  onChange: (moduleId: CommerceAgentModuleId) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[95] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-lg border border-border-dark/70 bg-surface-dark p-1 shadow-[0_16px_42px_rgba(0,0,0,0.32)]">
        {COMMERCE_AGENT_MODULES.map((module) => {
          const Icon = module.icon;
          const active = activeModule === module.id;
          return (
            <button
              key={module.id}
              type="button"
              aria-pressed={active}
              title={t(`commerceAd.agent.modules.${module.id}.title`)}
              onClick={() => onChange(module.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/45 ${
                active
                  ? 'border-accent/50 bg-accent/18 text-text-dark shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
                  : 'border-transparent text-text-muted hover:bg-text-dark/8 hover:text-text-dark'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">{t(`commerceAd.agent.modules.${module.id}.label`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CommerceDetailPageSetupModal({
  isOpen,
  onClose,
  activeModuleTitle,
  productImages,
  isProductImageLimitReached,
  uploading,
  isThinking,
  isSyncProductInfoRunning,
  isProductInfoCollapsed,
  isVisualPreferenceCollapsed,
  isBatchSettingsCollapsed,
  detailInputMode,
  lockedDocumentInfo,
  userIdeaInfo,
  detailPages,
  hasManualPageLockedInfo,
  visualPreferenceDraft,
  visualPreferenceSummary,
  imageProviderOptions,
  selectedImageModel,
  selectedProviderImageModels,
  selectedResolution,
  resolutionOptions,
  ratioOptions,
  currentRatios,
  currentVariantsPerRatio,
  currentBatchCount,
  canCreateDetailPageBatch,
  productionSummary,
  detailPageCount,
  plannedImageCount,
  fileInputRef,
  replaceFileInputRef,
  userIdeaInfoRef,
  productInfoContentRef,
  visualPreferenceContentRef,
  batchSettingsContentRef,
  onFilesSelected,
  onReplaceProductImageSelected,
  onUploadClick,
  onReplaceProductImageClick,
  onDeleteProductImage,
  onUpdateProductImageDescription,
  onToggleProductInfoCollapsed,
  onToggleVisualPreferenceCollapsed,
  onToggleBatchSettingsCollapsed,
  onDetailInputModeChange,
  onLockedDocumentInfoChange,
  onUserIdeaInfoChange,
  onAddDetailPage,
  onDeleteDetailPage,
  onMoveDetailPage,
  onUpdateDetailPage,
  onUpdateVisualPreference,
  onImageProviderChange,
  onImageModelChange,
  onTogglePageRatio,
  onUpdateBatchConfig,
  onGenerateNodeInfo,
}: {
  isOpen: boolean;
  onClose: () => void;
  activeModuleTitle: string;
  productImages: CommerceAdProductImage[];
  isProductImageLimitReached: boolean;
  uploading: boolean;
  isThinking: boolean;
  isSyncProductInfoRunning: boolean;
  isProductInfoCollapsed: boolean;
  isVisualPreferenceCollapsed: boolean;
  isBatchSettingsCollapsed: boolean;
  detailInputMode: CommerceAdProductState['detailInputMode'];
  lockedDocumentInfo: string;
  userIdeaInfo: string;
  detailPages: CommerceAdDetailPage[];
  hasManualPageLockedInfo: boolean;
  hasResolvedProductInfo: boolean;
  visualPreferenceDraft: CommerceAdVisualPreferenceState;
  visualPreferenceSummary: string;
  imageProviderOptions: Array<{ id: string; label: string }>;
  selectedImageModel: ReturnType<typeof getImageModel>;
  selectedProviderImageModels: Array<ReturnType<typeof getImageModel>>;
  selectedResolution: ReturnType<typeof resolveImageModelResolution>;
  resolutionOptions: ReturnType<typeof resolveImageModelResolutions>;
  ratioOptions: ReturnType<typeof getImageModel>['aspectRatios'];
  currentRatios: string[];
  currentVariantsPerRatio: number;
  currentBatchCount: number;
  canCreateDetailPageBatch: boolean;
  productionSummary: string;
  detailPageCount: number;
  plannedImageCount: number;
  fileInputRef: React.Ref<HTMLInputElement>;
  replaceFileInputRef: React.Ref<HTMLInputElement>;
  userIdeaInfoRef: React.Ref<HTMLTextAreaElement>;
  productInfoContentRef: React.RefObject<HTMLElement | null>;
  visualPreferenceContentRef: React.RefObject<HTMLElement | null>;
  batchSettingsContentRef: React.RefObject<HTMLElement | null>;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onReplaceProductImageSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadClick: () => void;
  onReplaceProductImageClick: (imageId: string) => void;
  onDeleteProductImage: (imageId: string) => void;
  onUpdateProductImageDescription: (imageId: string, description: string) => void;
  onToggleProductInfoCollapsed: () => void;
  onToggleVisualPreferenceCollapsed: () => void;
  onToggleBatchSettingsCollapsed: () => void;
  onDetailInputModeChange: (mode: CommerceAdProductState['detailInputMode']) => void;
  onLockedDocumentInfoChange: (value: string) => void;
  onUserIdeaInfoChange: (value: string) => void;
  onAddDetailPage: () => void;
  onDeleteDetailPage: (pageId: string) => void;
  onMoveDetailPage: (pageId: string, direction: -1 | 1) => void;
  onUpdateDetailPage: (pageId: string, data: Partial<Omit<CommerceAdDetailPage, 'id' | 'pageNo'>>) => void;
  onUpdateVisualPreference: (data: Partial<CommerceAdVisualPreferenceState>) => void;
  onImageProviderChange: (providerId: string) => void;
  onImageModelChange: (modelId: string) => void;
  onTogglePageRatio: (ratio: string) => void;
  onUpdateBatchConfig: (data: Partial<CommerceAdBatchGenerateState>) => void;
  onGenerateNodeInfo: () => void;
}) {
  const { t } = useTranslation();
  const isGeneratingNodeInfo = isSyncProductInfoRunning;

  return (
    <UiModal
      isOpen={isOpen}
      title={activeModuleTitle}
      onClose={onClose}
      widthClassName="w-[min(1080px,calc(100vw-48px))]"
      bodyClassName="ui-scrollbar flex-1 overflow-y-auto"
      footer={
        <>
          <UiButton
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isGeneratingNodeInfo}
          >
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            className="gap-2"
            onClick={onGenerateNodeInfo}
            disabled={
              (detailInputMode === 'auto'
                ? !(lockedDocumentInfo.trim() || userIdeaInfo.trim() || productImages.length > 0)
                : !(hasManualPageLockedInfo || userIdeaInfo.trim() || productImages.length > 0))
              || isThinking
            }
          >
            {isGeneratingNodeInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGeneratingNodeInfo
              ? t('commerceAd.agent.generatingNodeInfo')
              : t('commerceAd.agent.generateNodeInfo')}
          </UiButton>
        </>
      }
    >
      {isGeneratingNodeInfo ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-text-dark/15 bg-text-dark/[0.06] px-3 py-2.5 text-xs leading-5 text-text-muted">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-text-dark" />
          <div>
            <div className="font-medium text-text-dark">
              {t('commerceAd.agent.generatingNodeInfoTitle')}
            </div>
            <div className="mt-0.5">
              {t('commerceAd.agent.generatingNodeInfoHint')}
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text-dark">
                  {t('commerceAd.agent.productSection')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {t('commerceAd.agent.productSectionHint', {
                    limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
                  })}
                </p>
              </div>
              <UiButton
                type="button"
                size="sm"
                className="shrink-0 gap-2"
                onClick={onUploadClick}
                disabled={uploading || isProductImageLimitReached}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {t('commerceAd.agent.upload')}
              </UiButton>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onFilesSelected}
            />
            <input
              ref={replaceFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onReplaceProductImageSelected}
            />
            <div className="space-y-2">
              {productImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT).map((image, index) => (
                <div
                  key={image.id}
                  className="group flex gap-2 rounded-lg border border-border-dark/70 bg-bg-dark p-2"
                >
                  <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-border-dark/60 bg-black/20">
                    <img
                      src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                      alt={image.label}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                    <span className="absolute left-1 top-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {index === 0
                        ? t('commerceAd.agent.productImageRoleMain')
                        : t('commerceAd.agent.productImageRoleReference', { index })}
                    </span>
                    <div className="absolute inset-0 flex items-start justify-end gap-1 bg-black/0 p-1 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-within:bg-black/30 group-focus-within:opacity-100">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm transition hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onReplaceProductImageClick(image.id)}
                        disabled={uploading || isThinking}
                        title={t('commerceAd.agent.replaceProductImage')}
                        aria-label={t('commerceAd.agent.replaceProductImage')}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm transition hover:bg-red-500/90 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onDeleteProductImage(image.id)}
                        disabled={uploading || isThinking}
                        title={t('commerceAd.agent.deleteProductImage')}
                        aria-label={t('commerceAd.agent.deleteProductImage')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <UiTextAreaField
                    value={image.description ?? ''}
                    rows={3}
                    className="min-h-[72px] flex-1 px-2 py-1.5 text-xs leading-5"
                    onChange={(event) => onUpdateProductImageDescription(image.id, event.target.value)}
                    placeholder={t('commerceAd.agent.productImageDescriptionPlaceholder')}
                  />
                </div>
              ))}
              {!isProductImageLimitReached ? (
                <button
                  type="button"
                  className="flex min-h-[72px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-dark/80 bg-bg-dark/45 text-sm text-text-muted transition hover:border-text-dark/40 hover:bg-text-dark/[0.06] hover:text-text-dark focus:outline-none focus:ring-2 focus:ring-text-dark/20 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onUploadClick}
                  disabled={uploading || isThinking}
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  {t('commerceAd.agent.addProductReferenceImage', {
                    limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
                  })}
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left"
              onClick={onToggleProductInfoCollapsed}
              aria-expanded={!isProductInfoCollapsed}
            >
              {isProductInfoCollapsed ? (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              ) : (
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-dark">
                  {t('commerceAd.agent.productInfoTitle')}
                </span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">
                  {isProductInfoCollapsed && (lockedDocumentInfo.trim() || userIdeaInfo.trim())
                    ? t('commerceAd.agent.productInfoCollapsedFilled')
                    : t('commerceAd.agent.productInfoHint')}
                </span>
              </span>
            </button>
            {!isProductInfoCollapsed ? (
              <div ref={productInfoContentRef as React.RefObject<HTMLDivElement>} className="mt-3 space-y-3">
                <div className="inline-grid w-full grid-cols-2 gap-1.5 rounded-full bg-bg-dark/35 p-0.5">
                  {(['auto', 'manualPages'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onDetailInputModeChange(mode)}
                      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                        detailInputMode === mode
                          ? 'border-text-dark/25 bg-surface-dark text-text-dark shadow-[0_6px_18px_rgba(0,0,0,0.18)]'
                          : 'border-transparent text-text-muted hover:bg-text-dark/[0.05] hover:text-text-dark'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        detailInputMode === mode ? 'bg-text-dark' : 'bg-text-muted/45'
                      }`} />
                      {t(`commerceAd.agent.detailInputMode.${mode}`)}
                    </button>
                  ))}
                </div>
                {detailInputMode === 'auto' ? (
                  <>
                    <label className="block space-y-1.5 text-xs text-text-muted">
                      <span>{t('commerceAd.agent.lockedDocumentInfoLabel')}</span>
                      <UiTextAreaField
                        value={lockedDocumentInfo}
                        onChange={(event) => onLockedDocumentInfoChange(event.target.value)}
                        rows={5}
                        placeholder={t('commerceAd.agent.lockedDocumentInfoPlaceholder')}
                      />
                    </label>
                    <label className="block space-y-1.5 text-xs text-text-muted">
                      <span>{t('commerceAd.agent.userIdeaInfoLabel')}</span>
                      <UiTextAreaField
                        ref={userIdeaInfoRef}
                        value={userIdeaInfo}
                        onChange={(event) => onUserIdeaInfoChange(event.target.value)}
                        rows={4}
                        placeholder={t('commerceAd.agent.userIdeaInfoPlaceholder')}
                      />
                    </label>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
                      {t('commerceAd.agent.detailInputMode.manualHint')}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-text-dark">
                        {t('commerceAd.agent.detailPages.manualFixedInfoTitle')}
                      </div>
                      <UiButton type="button" size="sm" className="gap-1.5" onClick={onAddDetailPage}>
                        <Plus className="h-3.5 w-3.5" />
                        {t('commerceAd.agent.detailPages.addFixedInfo')}
                      </UiButton>
                    </div>
                    {detailPages.length > 0 ? (
                      <div className="space-y-2">
                        {detailPages.map((page, index) => (
                          <div key={page.id} className="rounded-lg border border-border-dark/70 bg-bg-dark/45 p-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs font-medium text-text-dark">
                                {t('commerceAd.agent.detailPages.pageBadge', { page: index + 1 })}
                              </div>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-dark/70 text-text-muted hover:text-text-dark disabled:opacity-40"
                                  onClick={() => onMoveDetailPage(page.id, -1)}
                                  disabled={index === 0}
                                  aria-label={t('commerceAd.agent.detailPages.moveUp')}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-dark/70 text-text-muted hover:text-text-dark disabled:opacity-40"
                                  onClick={() => onMoveDetailPage(page.id, 1)}
                                  disabled={index === detailPages.length - 1}
                                  aria-label={t('commerceAd.agent.detailPages.moveDown')}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-300/30 text-rose-100 hover:bg-rose-500/10"
                                  onClick={() => onDeleteDetailPage(page.id)}
                                  aria-label={t('commerceAd.agent.detailPages.delete')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <UiInput
                              value={page.title}
                              className="mb-2"
                              onChange={(event) => onUpdateDetailPage(page.id, { title: event.target.value })}
                              placeholder={t('commerceAd.agent.detailPages.pageTitlePlaceholder')}
                            />
                            <UiTextAreaField
                              value={page.lockedCopy}
                              rows={3}
                              onChange={(event) => onUpdateDetailPage(page.id, { lockedCopy: event.target.value })}
                              placeholder={t('commerceAd.agent.detailPages.fixedInfoPlaceholder')}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-3 text-xs leading-5 text-text-muted">
                        {t('commerceAd.agent.detailPages.manualEmpty')}
                      </div>
                    )}
                    <label className="block space-y-1.5 text-xs text-text-muted">
                      <span>{t('commerceAd.agent.userIdeaInfoLabel')}</span>
                      <UiTextAreaField
                        ref={userIdeaInfoRef}
                        value={userIdeaInfo}
                        onChange={(event) => onUserIdeaInfoChange(event.target.value)}
                        rows={4}
                        placeholder={t('commerceAd.agent.userIdeaInfoPlaceholder')}
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={onToggleVisualPreferenceCollapsed}
                  aria-expanded={!isVisualPreferenceCollapsed}
                >
                  {isVisualPreferenceCollapsed ? (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-dark">
                      {t('commerceAd.agent.visualPreference.title')}
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-muted">
                      {isVisualPreferenceCollapsed
                        ? visualPreferenceSummary
                        : t('commerceAd.agent.visualPreference.hint')}
                    </span>
                  </span>
                </button>
                {!isVisualPreferenceCollapsed ? (
                  <div ref={visualPreferenceContentRef as React.RefObject<HTMLDivElement>} className="mt-3 space-y-3">
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.designStyle')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.designStyle}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ designStyle: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.designStyle.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.designStyle.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.colorPalette')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.colorPalette}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ colorPalette: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.colorPalette.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.colorPalette.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.platformVisual')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.platformVisual}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ platformVisual: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.platformVisual.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.platformVisual.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.language')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.language}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ language: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.language.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.language.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <div className="space-y-2">
                      <div className="text-xs text-text-muted">
                        {t('commerceAd.fields.brandAccentColor')}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onUpdateVisualPreference({ brandAccentColor: 'auto' })}
                          className={`inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors ${
                            visualPreferenceDraft.brandAccentColor.toLowerCase() === 'auto'
                              ? 'border-text-dark/30 bg-text-dark/10 text-text-dark'
                              : 'border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark'
                          }`}
                        >
                          {t('commerceAd.agent.visualPreference.autoAccent')}
                        </button>
                        {BRAND_ACCENT_PRESETS.map(({ key, color }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => onUpdateVisualPreference({ brandAccentColor: color })}
                            className={`h-7 w-7 rounded-full border transition-transform hover:scale-105 ${
                              visualPreferenceDraft.brandAccentColor.toUpperCase() === color
                                ? 'border-white ring-2 ring-white/30'
                                : 'border-white/20'
                            }`}
                            style={{ backgroundColor: color }}
                            aria-label={t('commerceAd.agent.visualPreference.chooseAccent', {
                              color: t(`commerceAd.agent.visualPreference.options.accentColor.${key}`),
                            })}
                            title={t('commerceAd.agent.visualPreference.chooseAccent', {
                              color: t(`commerceAd.agent.visualPreference.options.accentColor.${key}`),
                            })}
                          />
                        ))}
                      </div>
                      <UiInput
                        value={visualPreferenceDraft.brandAccentColor}
                        onChange={(event) => onUpdateVisualPreference({ brandAccentColor: event.target.value })}
                        placeholder="#3B82F6"
                      />
                    </div>
                  </div>
                ) : null}
          </section>

          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={onToggleBatchSettingsCollapsed}
                  aria-expanded={!isBatchSettingsCollapsed}
                >
                  {isBatchSettingsCollapsed ? (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-dark">
                      {t('commerceAd.agent.batchSection')}
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-muted">
                      {isBatchSettingsCollapsed
                        ? t('commerceAd.agent.batchSettingsSummary', {
                            provider: imageProviderOptions.find((item) => item.id === selectedImageModel.providerId)?.label ?? selectedImageModel.providerId,
                            model: selectedImageModel.displayName,
                            ratios: currentRatios.join(' / '),
                            count: plannedImageCount,
                          })
                        : t('commerceAd.agent.batchSettingsHint')}
                    </span>
                  </span>
                </button>
                {!isBatchSettingsCollapsed ? (
                  <div ref={batchSettingsContentRef as React.RefObject<HTMLDivElement>} className="mt-3 space-y-3">
                    <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
                      <div className="font-medium text-text-dark">
                        {t('commerceAd.agent.detailPages.productionFlowTitle')}
                      </div>
                      <div className="mt-1">
                        {productionSummary}
                      </div>
                    </div>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.agent.imageProvider')}</span>
                      <UiSelect
                        value={selectedImageModel.providerId}
                        className="mt-1"
                        onChange={(event) => onImageProviderChange(event.target.value)}
                      >
                        {imageProviderOptions.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.agent.imageModel')}</span>
                      <UiSelect
                        value={selectedImageModel.id}
                        className="mt-1"
                        onChange={(event) => onImageModelChange(event.target.value)}
                      >
                        {selectedProviderImageModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName}
                          </option>
                        ))}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.agent.resolution')}</span>
                      <UiSelect
                        value={selectedResolution.value}
                        className="mt-1"
                        onChange={(event) => onUpdateBatchConfig({ size: event.target.value })}
                      >
                        {resolutionOptions.map((resolution) => (
                          <option key={resolution.value} value={resolution.value}>
                            {resolution.label}
                          </option>
                        ))}
                      </UiSelect>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {ratioOptions.map((ratio) => {
                        const active = currentRatios.includes(ratio.value);
                        return (
                          <button
                            key={ratio.value}
                            type="button"
                            onClick={() => onTogglePageRatio(ratio.value)}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
                              active
                                ? 'border-text-dark/30 bg-text-dark/10 text-text-dark'
                                : 'border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark'
                            }`}
                          >
                            {active ? <Check className="h-3 w-3" /> : null}
                            {ratio.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-text-muted">
                        <span>{t('commerceAd.agent.imagesPerGroup')}</span>
                        <UiInput
                          type="number"
                          min={1}
                          max={8}
                          step={1}
                          value={currentVariantsPerRatio}
                          className="mt-1"
                          onChange={(event) => onUpdateBatchConfig({ variantsPerRatio: event.target.valueAsNumber || 1 })}
                        />
                      </label>
                      <label className="block text-xs text-text-muted">
                        <span>{t('commerceAd.agent.batchCount')}</span>
                        <UiInput
                          type="number"
                          min={1}
                          max={20}
                          step={1}
                          value={currentBatchCount}
                          className="mt-1"
                          onChange={(event) => onUpdateBatchConfig({ batchCount: event.target.valueAsNumber || 1 })}
                        />
                      </label>
                    </div>
                    <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
                      {canCreateDetailPageBatch
                        ? t('commerceAd.agent.detailPages.batchHint', {
                            pageCount: detailPageCount,
                            ratioCount: currentRatios.length,
                            imageCount: currentVariantsPerRatio,
                            batchCount: currentBatchCount,
                            total: plannedImageCount,
                            ratios: currentRatios.join(' / '),
                          })
                        : t('commerceAd.agent.detailPages.batchNeedsPagesHint')}
                    </div>
                  </div>
                ) : null}
          </section>
        </div>
      </div>
    </UiModal>
  );
}

function DecisionPanel({
  messageId,
  guidance,
  selectedChoiceKeys,
  onToggleChoice,
}: {
  messageId: string;
  guidance: CommerceAdAgentGuidance;
  selectedChoiceKeys: string[];
  onToggleChoice: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  if (!hasGuidanceContent(guidance)) {
    return null;
  }

  return (
    <div className="mt-4 space-y-4 text-sm leading-6 text-text-dark/85">
      {guidance.summary ? (
        <div>
          <div className="text-[13px] font-semibold text-text-muted">
            {t('commerceAd.agent.guidance.understood')}
          </div>
          <p className="mt-1 whitespace-pre-wrap">
            {guidance.summary}
          </p>
        </div>
      ) : null}

      {guidance.confirmedFacts.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[13px] font-semibold text-text-muted">
            {t('commerceAd.agent.guidance.confirmed')}
          </div>
          <GuidancePillList items={guidance.confirmedFacts} />
        </div>
      ) : null}

      {guidance.missingFields.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[13px] font-semibold text-text-muted">
            {t('commerceAd.agent.guidance.missing')}
          </div>
          <GuidancePillList items={guidance.missingFields} tone="warning" />
        </div>
      ) : null}

      {guidance.designDirections.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[13px] font-semibold text-text-muted">
            {guidance.panelTitle || t('commerceAd.agent.guidance.directions')}
          </div>
          <div className="space-y-1">
            {guidance.designDirections.map((direction) => {
              const key = buildGuidanceChoiceKey(messageId, 'direction', direction.id);
              const value = direction.description
                ? [direction.title, direction.description].join('：')
                : direction.title;
              return (
                <button
                  key={direction.id}
                  type="button"
                  aria-pressed={selectedChoiceKeys.includes(key)}
                  onClick={() => onToggleChoice(key, value)}
                  className={`group w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    selectedChoiceKeys.includes(key)
                      ? 'bg-text-dark/[0.1]'
                      : 'hover:bg-text-dark/[0.06]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-text-muted">↳</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-dark">{direction.title}</div>
                  {direction.description ? (
                    <div className="mt-1 text-[13px] leading-6 text-text-muted">
                      {direction.description}
                    </div>
                  ) : null}
                  {direction.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {direction.tags.map((tag) => (
                        <span
                          key={tag}
                              className="rounded-full bg-transparent px-1.5 py-0.5 text-xs text-text-muted transition-colors group-hover:bg-bg-dark/80"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {guidance.questions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[13px] font-semibold text-text-muted">
            {t('commerceAd.agent.guidance.questions')}
          </div>
          {guidance.questions.map((question) => (
            <div key={question.id} className="space-y-1.5">
              <div className="text-sm leading-6 text-text-dark/85">{question.label}</div>
              {question.options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {question.options.map((option) => {
                    const key = buildGuidanceChoiceKey(messageId, question.id, option.id);
                    return (
                      <GuidanceChoiceButton
                        key={option.id}
                        active={selectedChoiceKeys.includes(key)}
                        onClick={() => onToggleChoice(key, option.value || option.label)}
                      >
                        {option.label}
                      </GuidanceChoiceButton>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {guidance.quickReplies.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[13px] font-semibold text-text-muted">
            {t('commerceAd.agent.guidance.quickReplies')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {guidance.quickReplies.map((reply) => {
              const key = buildGuidanceChoiceKey(messageId, 'quick', reply);
              return (
                <GuidanceChoiceButton
                  key={reply}
                  active={selectedChoiceKeys.includes(key)}
                  onClick={() => onToggleChoice(key, reply)}
                >
                  {reply}
                </GuidanceChoiceButton>
              );
            })}
          </div>
        </div>
      ) : null}

      {guidance.readinessHint ? (
        <div className="rounded-lg bg-text-dark/[0.04] px-3 py-2 text-sm leading-6 text-text-dark/80">
          {guidance.readinessHint}
        </div>
      ) : null}
    </div>
  );
}

function CommerceAdWorkspaceInner() {
  const { t } = useTranslation();
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageFileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const userIdeaInfoRef = useRef<HTMLTextAreaElement | null>(null);
  const productInfoContentRef = useRef<HTMLElement | null>(null);
  const visualPreferenceContentRef = useRef<HTMLElement | null>(null);
  const batchSettingsContentRef = useRef<HTMLElement | null>(null);
  const replaceImageIdRef = useRef<string | null>(null);
  const activeCommerceStreamRequestIdRef = useRef<string | null>(null);
  const thinkingTypewriterQueueRef = useRef<Record<string, string>>({});
  const thinkingTypewriterTimerRef = useRef<number | null>(null);
  const messageTypewriterQueueRef = useRef<Record<string, string>>({});
  const messageTypewriterTimerRef = useRef<number | null>(null);
  const hasLoadedAgentThreadRef = useRef(false);
  const activeThreadCreatedAtRef = useRef(Date.now());
  const activeThreadIdRef = useRef(COMMERCE_AGENT_DEFAULT_THREAD_ID);
  const [messages, setMessages] = useState<CommerceAdAgentMessage[]>(DEFAULT_AGENT_MESSAGES);
  const [draft, setDraft] = useState('');
  const [chatImages, setChatImages] = useState<CommerceAdProductImage[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [selectedGuidanceChoiceKeys, setSelectedGuidanceChoiceKeys] = useState<string[]>([]);
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(COMMERCE_AGENT_DEFAULT_THREAD_ID);
  const [threadSummaries, setThreadSummaries] = useState<CommerceAgentThreadRecord[]>([]);
  const [isThreadHistoryOpen, setIsThreadHistoryOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [agentThreadState, setAgentThreadState] = useState<CommerceAdAgentThreadState>(createDefaultAgentThreadState);
  const [thinkingPreviewByMessageId, setThinkingPreviewByMessageId] = useState<Record<string, string>>({});
  const [structuredProgressByMessageId, setStructuredProgressByMessageId] = useState<Record<string, string[]>>({});
  const [newThreadAnimationKey, setNewThreadAnimationKey] = useState(0);
  const [agentPanelWidth, setAgentPanelWidth] = useState(readCommerceAgentPanelWidth);
  const [isChatDragActive, setIsChatDragActive] = useState(false);
  const [detailInputMode, setDetailInputMode] = useState<CommerceAdProductState['detailInputMode']>('auto');
  const [lockedDocumentInfo, setLockedDocumentInfo] = useState('');
  const [userIdeaInfo, setUserIdeaInfo] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [activeAgentTask, setActiveAgentTask] = useState<CommerceAgentTask | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [isVisionWarningOpen, setIsVisionWarningOpen] = useState(false);
  const [isDetailSetupOpen, setIsDetailSetupOpen] = useState(false);
  const [isProductInfoCollapsed, setIsProductInfoCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY, false)
  ));
  const [isVisualPreferenceCollapsed, setIsVisualPreferenceCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY, false)
  ));
  const [isBatchSettingsCollapsed, setIsBatchSettingsCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY, false)
  ));
  const [activeModule, setActiveModule] = useState<CommerceAgentModuleId>(() => readActiveCommerceAgentModule());
  const [visualPreferenceDraft, setVisualPreferenceDraft] = useState<CommerceAdVisualPreferenceState>(() => (
    createDefaultCommerceAdVisualPreferenceState()
  ));
  const availableSkills = useMemo<CommerceAgentSkill[]>(() => getCommerceAgentSkills().map((skill) => (
    skill.id === 'ad-creative'
      ? {
          ...skill,
          title: t('commerceAd.agent.skillOptions.adCreative.title'),
          description: t('commerceAd.agent.skillOptions.adCreative.description'),
        }
      : skill
  )), [t]);

  const stopThinkingTypewriter = useCallback(() => {
    if (thinkingTypewriterTimerRef.current !== null) {
      window.clearInterval(thinkingTypewriterTimerRef.current);
      thinkingTypewriterTimerRef.current = null;
    }
  }, []);

  const clearThinkingTypewriter = useCallback((messageId?: string) => {
    if (messageId) {
      delete thinkingTypewriterQueueRef.current[messageId];
    } else {
      thinkingTypewriterQueueRef.current = {};
    }
    if (Object.keys(thinkingTypewriterQueueRef.current).length === 0) {
      stopThinkingTypewriter();
    }
  }, [stopThinkingTypewriter]);

  const ensureThinkingTypewriter = useCallback(() => {
    if (thinkingTypewriterTimerRef.current !== null) {
      return;
    }
    thinkingTypewriterTimerRef.current = window.setInterval(() => {
      const messageId = Object.keys(thinkingTypewriterQueueRef.current)
        .find((id) => thinkingTypewriterQueueRef.current[id]);
      if (!messageId) {
        stopThinkingTypewriter();
        return;
      }
      const queueRef = {
        get current() {
          return thinkingTypewriterQueueRef.current[messageId] ?? '';
        },
        set current(value: string) {
          thinkingTypewriterQueueRef.current[messageId] = value;
        },
      } as MutableRefObject<string>;
      appendNextTypewriterChar(queueRef, (nextChar) => {
        setThinkingPreviewByMessageId((items) => {
          const existing = items[messageId] ?? '';
          return {
            ...items,
            [messageId]: buildThinkingPreviewText(`${existing}${nextChar}`),
          };
        });
      });
    }, COMMERCE_AGENT_TYPEWRITER_INTERVAL_MS);
  }, [stopThinkingTypewriter]);

  const enqueueThinkingPreviewText = useCallback((messageId: string, nextText: string, replace = false) => {
    const normalized = nextText.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return;
    }
    const textForQueue = replace ? normalized : ` ${normalized}`;
    if (replace) {
      thinkingTypewriterQueueRef.current[messageId] = textForQueue;
      setThinkingPreviewByMessageId((items) => ({ ...items, [messageId]: '' }));
    } else {
      thinkingTypewriterQueueRef.current[messageId] = `${thinkingTypewriterQueueRef.current[messageId] ?? ''}${textForQueue}`;
    }
    ensureThinkingTypewriter();
  }, [ensureThinkingTypewriter]);

  const stopMessageTypewriter = useCallback(() => {
    if (messageTypewriterTimerRef.current !== null) {
      window.clearInterval(messageTypewriterTimerRef.current);
      messageTypewriterTimerRef.current = null;
    }
  }, []);

  const clearMessageTypewriter = useCallback((messageId?: string) => {
    if (messageId) {
      delete messageTypewriterQueueRef.current[messageId];
    } else {
      messageTypewriterQueueRef.current = {};
    }
    if (Object.keys(messageTypewriterQueueRef.current).length === 0) {
      stopMessageTypewriter();
    }
  }, [stopMessageTypewriter]);

  const ensureMessageTypewriter = useCallback(() => {
    if (messageTypewriterTimerRef.current !== null) {
      return;
    }
    messageTypewriterTimerRef.current = window.setInterval(() => {
      const messageId = Object.keys(messageTypewriterQueueRef.current)
        .find((id) => messageTypewriterQueueRef.current[id]);
      if (!messageId) {
        stopMessageTypewriter();
        return;
      }
      const queueRef = {
        get current() {
          return messageTypewriterQueueRef.current[messageId] ?? '';
        },
        set current(value: string) {
          messageTypewriterQueueRef.current[messageId] = value;
        },
      } as MutableRefObject<string>;
      appendNextTypewriterChar(queueRef, (nextChar) => {
        setMessages((items) => items.map((message) => (
          message.id === messageId
            ? { ...message, content: `${message.content}${nextChar}` }
            : message
        )));
      });
    }, COMMERCE_AGENT_TYPEWRITER_INTERVAL_MS);
  }, [stopMessageTypewriter]);

  const enqueueAssistantMessageText = useCallback((messageId: string, textToAppend: string, replace = false) => {
    if (!textToAppend) {
      return;
    }
    if (replace) {
      messageTypewriterQueueRef.current[messageId] = textToAppend;
      setMessages((items) => items.map((message) => (
        message.id === messageId ? { ...message, content: '' } : message
      )));
    } else {
      messageTypewriterQueueRef.current[messageId] = `${messageTypewriterQueueRef.current[messageId] ?? ''}${textToAppend}`;
    }
    ensureMessageTypewriter();
  }, [ensureMessageTypewriter]);

  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const addNode = useCanvasStore((state) => state.addNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateNodePosition = useCanvasStore((state) => state.updateNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const settings = useSettingsStore((state) => state);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  const productNode = useMemo(
    () => resolveActiveStageNode<CommerceProductNodeData>(nodes, CANVAS_NODE_TYPES.commerceProduct, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const briefNode = useMemo(
    () => resolveActiveStageNode<CommerceBriefNodeData>(nodes, CANVAS_NODE_TYPES.commerceBrief, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const batchNode = useMemo(
    () => resolveActiveStageNode<CommerceBatchGenerateNodeData>(nodes, CANVAS_NODE_TYPES.commerceBatchGenerate, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const agentPlanNode = useMemo(
    () => {
      const threadMatch = nodes.find((node) => (
        node.type === CANVAS_NODE_TYPES.commerceAgentPlan
        && (node.data as Partial<CommerceAgentPlanNodeData>).agentThreadId === activeThreadId
      ));
      if (threadMatch) {
        return threadMatch as CanvasNode & { data: CommerceAgentPlanNodeData };
      }
      if (activeThreadId !== COMMERCE_AGENT_DEFAULT_THREAD_ID) {
        return null;
      }
      return resolveActiveStageNode<CommerceAgentPlanNodeData>(nodes, CANVAS_NODE_TYPES.commerceAgentPlan, selectedNodeId);
    },
    [activeThreadId, nodes, selectedNodeId]
  );
  const visualPreferenceNode = useMemo(
    () => resolveActiveStageNode<CommerceVisualPreferenceNodeData>(nodes, CANVAS_NODE_TYPES.commerceVisualPreference, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const resultNode = useMemo(
    () => resolveActiveStageNode<CommerceResultGroupNodeData>(nodes, CANVAS_NODE_TYPES.commerceResultGroup, selectedNodeId),
    [nodes, selectedNodeId]
  );

  const activeTextProvider = useMemo(
    () => resolveActivatedScriptProvider(settings),
    [settings]
  );
  const activeTextModel = useMemo(
    () => activeTextProvider ? resolveConfiguredScriptModel(activeTextProvider, settings) : '',
    [activeTextProvider, settings]
  );
  const selectedSkill = useMemo(
    () => availableSkills.find((skill) => skill.id === selectedSkillId) ?? null,
    [availableSkills, selectedSkillId]
  );
  const activeThreadSummary = useMemo(
    () => threadSummaries.find((thread) => thread.threadId === activeThreadId) ?? null,
    [activeThreadId, threadSummaries]
  );
  const activeThreadTitle = useMemo(
    () => deriveCommerceAgentThreadTitle(
      messages,
      selectedSkill,
      activeThreadSummary?.title || t('commerceAd.agent.untitledChat')
    ),
    [activeThreadSummary?.title, messages, selectedSkill, t]
  );

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    hasLoadedAgentThreadRef.current = false;
    setMessages(DEFAULT_AGENT_MESSAGES);
    setAgentThreadState(createDefaultAgentThreadState(selectedSkill));
    setThreadSummaries([]);
    setActiveThreadId(COMMERCE_AGENT_DEFAULT_THREAD_ID);
    activeThreadCreatedAtRef.current = Date.now();
    setDraft('');
    setChatImages([]);
    setStatusText(null);
    clearThinkingTypewriter();
    clearMessageTypewriter();
    setThinkingPreviewByMessageId({});
    setStructuredProgressByMessageId({});
    setIsThreadHistoryOpen(false);
    if (!currentProjectId) {
      return;
    }

    let cancelled = false;
    void listCommerceAgentThreads(currentProjectId)
      .then(async (records) => {
        if (cancelled) {
          return;
        }
        const sortedRecords = records
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, COMMERCE_AGENT_THREAD_LIMIT);
        setThreadSummaries(sortedRecords);
        const record = sortedRecords[0] ?? null;
        if (!record) {
          setActiveThreadId(COMMERCE_AGENT_DEFAULT_THREAD_ID);
          activeThreadCreatedAtRef.current = Date.now();
          setMessages(DEFAULT_AGENT_MESSAGES);
          setAgentThreadState(createDefaultAgentThreadState(selectedSkill));
          return;
        }
        setActiveThreadId(record.threadId);
        activeThreadCreatedAtRef.current = record.createdAt || record.updatedAt || Date.now();
        setMessages(parsePersistedCommerceAgentMessages(record.messagesJson));
        setAgentThreadState(parseAgentThreadState(record.stateJson, selectedSkill));
      })
      .catch(() => {
        if (!cancelled) {
          setMessages(DEFAULT_AGENT_MESSAGES);
          setAgentThreadState(createDefaultAgentThreadState(selectedSkill));
          setThreadSummaries([]);
          setActiveThreadId(COMMERCE_AGENT_DEFAULT_THREAD_ID);
          activeThreadCreatedAtRef.current = Date.now();
        }
      })
      .finally(() => {
        if (!cancelled) {
          hasLoadedAgentThreadRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  useEffect(() => {
    setAgentThreadState((current) => {
      if (current.skillId === (selectedSkill?.id ?? '')) {
        return current;
      }
      return mergeAgentThreadState(
        createDefaultAgentThreadState(selectedSkill),
        {
          imageAnalysis: current.imageAnalysis,
          planVersion: current.planVersion,
        },
        selectedSkill
      );
    });
  }, [selectedSkill]);

  useEffect(() => {
    if (!currentProjectId || !hasLoadedAgentThreadRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (
        messages.length === 0
        && isDefaultAgentThreadState(agentThreadState)
        && !activeThreadSummary
        && activeThreadId === COMMERCE_AGENT_DEFAULT_THREAD_ID
      ) {
        return;
      }
      const now = Date.now();
      const title = deriveCommerceAgentThreadTitle(
        messages,
        selectedSkill,
        t('commerceAd.agent.untitledChat')
      );
      const createdAt = activeThreadSummary?.createdAt || activeThreadCreatedAtRef.current || now;
      void upsertCommerceAgentThread({
        projectId: currentProjectId,
        threadId: activeThreadId,
        title,
        messagesJson: JSON.stringify(messages),
        stateJson: JSON.stringify(agentThreadState),
        createdAt,
        updatedAt: now,
      }).then(() => {
        setThreadSummaries((items) => {
          if (activeThreadId !== activeThreadIdRef.current) {
            return items;
          }
          const nextRecord: CommerceAgentThreadRecord = {
            projectId: currentProjectId,
            threadId: activeThreadId,
            title,
            messagesJson: JSON.stringify(messages),
            stateJson: JSON.stringify(agentThreadState),
            createdAt,
            updatedAt: now,
          };
          return [
            nextRecord,
            ...items.filter((item) => item.threadId !== activeThreadId),
          ]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, COMMERCE_AGENT_THREAD_LIMIT);
        });
      });
    }, COMMERCE_AGENT_THREAD_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, activeThreadSummary?.createdAt, agentThreadState, currentProjectId, messages, selectedSkill, t]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_PANEL_WIDTH_STORAGE_KEY,
      String(agentPanelWidth)
    );
  }, [agentPanelWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_ACTIVE_MODULE_STORAGE_KEY,
      activeModule
    );
  }, [activeModule]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY,
      String(isProductInfoCollapsed)
    );
  }, [isProductInfoCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY,
      String(isVisualPreferenceCollapsed)
    );
  }, [isVisualPreferenceCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY,
      String(isBatchSettingsCollapsed)
    );
  }, [isBatchSettingsCollapsed]);

  useEffect(() => {
    setVisualPreferenceDraft(normalizeCommerceAdVisualPreferenceState(visualPreferenceNode?.data ?? null));
  }, [visualPreferenceNode?.data]);

  useEffect(() => {
    const productData = productNode?.data;
    setDetailInputMode(productData?.detailInputMode ?? 'auto');
    setLockedDocumentInfo(productData?.lockedDocumentInfo ?? '');
    setUserIdeaInfo(productData?.userIdeaInfo ?? productData?.userInfo ?? '');
  }, [
    productNode?.data?.detailInputMode,
    productNode?.data?.lockedDocumentInfo,
    productNode?.data?.userIdeaInfo,
    productNode?.data?.userInfo,
  ]);

  const scrollSectionContentIntoView = useCallback((target: HTMLElement | null) => {
    requestAnimationFrame(() => {
      target?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });
  }, []);

  const toggleProductInfoCollapsed = useCallback(() => {
    setIsProductInfoCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      if (!nextCollapsed) {
        scrollSectionContentIntoView(productInfoContentRef.current);
        requestAnimationFrame(() => {
          userIdeaInfoRef.current?.focus();
        });
      }
      return nextCollapsed;
    });
  }, [scrollSectionContentIntoView]);

  const toggleVisualPreferenceCollapsed = useCallback(() => {
    setIsVisualPreferenceCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      if (!nextCollapsed) {
        scrollSectionContentIntoView(visualPreferenceContentRef.current);
      }
      return nextCollapsed;
    });
  }, [scrollSectionContentIntoView]);

  const toggleBatchSettingsCollapsed = useCallback(() => {
    setIsBatchSettingsCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      if (!nextCollapsed) {
        scrollSectionContentIntoView(batchSettingsContentRef.current);
      }
      return nextCollapsed;
    });
  }, [scrollSectionContentIntoView]);

  const canUseVisionModel = useMemo(
    () => isLikelyVisionTextModel(activeTextProvider, activeTextModel),
    [activeTextProvider, activeTextModel]
  );
  const productImages = productNode?.data.images ?? [];
  const productReferenceImages = useMemo(
    () => dedupeStrings(productImages.map((image) => image.imageUrl)).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
    [productImages]
  );
  const productImageCount = Math.min(productImages.length, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
  const remainingProductImageSlots = Math.max(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT - productImageCount);
  const isProductImageLimitReached = remainingProductImageSlots <= 0;
  const shouldShowVisionWarning = productImages.length > 0 && !canUseVisionModel;
  const hasResolvedProductInfo = hasProductInfo(productNode?.data);
  const visualPreferenceSummary = composeVisualPreferenceSummary(visualPreferenceDraft);
  const createUploadGuidance = useCallback((count: number): CommerceAdAgentGuidance => ({
    stage: 'upload',
    summary: t('commerceAd.agent.guidance.uploadSummary', {
      count,
      limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
    }),
    confirmedFacts: [t('commerceAd.agent.guidance.uploadConfirmed', {
      count,
      limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
    })],
    missingFields: [
      t('commerceAd.agent.guidance.missingProductUnderstanding'),
      t('commerceAd.agent.guidance.missingPlatform'),
      t('commerceAd.agent.guidance.missingDirection'),
    ],
    questions: [
      {
        id: 'after-upload',
        label: t('commerceAd.agent.guidance.uploadQuestion'),
        allowMultiple: true,
        options: [
          {
            id: 'infer-now',
            label: t('commerceAd.agent.guidance.optionInferNow'),
            value: t('commerceAd.agent.guidance.optionInferNow'),
          },
          {
            id: 'add-selling-points',
            label: t('commerceAd.agent.guidance.optionAddSellingPoints'),
            value: t('commerceAd.agent.guidance.optionAddSellingPoints'),
          },
          {
            id: 'choose-platform',
            label: t('commerceAd.agent.guidance.optionChoosePlatform'),
            value: t('commerceAd.agent.guidance.optionChoosePlatform'),
          },
        ],
      },
    ],
    designDirections: [],
    quickReplies: [
      t('commerceAd.agent.guidance.quickInferThenXiaohongshu'),
      t('commerceAd.agent.guidance.quickAddBrandTone'),
    ],
    readinessHint: t('commerceAd.agent.guidance.uploadReadiness'),
  }), [t]);
  const handleToggleGuidanceChoice = useCallback((key: string, value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return;
    }
    const slotPatch = extractConfirmedSlotsFromText(normalizedValue, selectedSkill);
    if (Object.keys(slotPatch).length > 0) {
      setAgentThreadState((current) => mergeAgentThreadState(current, {
        confirmedSlots: slotPatch,
        skillId: selectedSkill?.id ?? current.skillId,
      }, selectedSkill));
    }
    setSelectedGuidanceChoiceKeys((keys) => (
      keys.includes(key)
        ? keys.filter((item) => item !== key)
        : [...keys, key]
    ));
    setDraft((current) => {
      const parts = current
        .split('；')
        .map((item) => item.trim())
        .filter(Boolean);
      if (parts.includes(normalizedValue)) {
        return current;
      }
      return parts.length > 0 ? `${current.trim()}；${normalizedValue}` : normalizedValue;
    });
  }, [selectedSkill]);
  const persistActiveThreadSnapshot = useCallback(() => {
    if (
      !currentProjectId
      || (
        messages.length === 0
        && !activeThreadSummary
        && activeThreadId === COMMERCE_AGENT_DEFAULT_THREAD_ID
      )
    ) {
      return;
    }
    const now = Date.now();
    const createdAt = activeThreadSummary?.createdAt || activeThreadCreatedAtRef.current || now;
    const title = deriveCommerceAgentThreadTitle(
      messages,
      selectedSkill,
      t('commerceAd.agent.untitledChat')
    );
    void upsertCommerceAgentThread({
        projectId: currentProjectId,
        threadId: activeThreadId,
        title,
        messagesJson: JSON.stringify(messages),
        stateJson: JSON.stringify(agentThreadState),
      createdAt,
      updatedAt: now,
    });
  }, [activeThreadId, activeThreadSummary, agentThreadState, currentProjectId, messages, selectedSkill, t]);

  const handleCreateNewThread = useCallback(() => {
    if (isThinking || !currentProjectId) {
      return;
    }
    if (isEmptyCommerceAgentDraftThread({
      messages,
      draft,
      chatImages,
      state: agentThreadState,
    })) {
      setIsThreadHistoryOpen(false);
      setThreadSearchQuery('');
      setNewThreadAnimationKey((key) => key + 1);
      return;
    }
    persistActiveThreadSnapshot();
    const now = Date.now();
    const threadId = createCommerceAgentThreadId();
    activeThreadCreatedAtRef.current = now;
    setActiveThreadId(threadId);
    setMessages(DEFAULT_AGENT_MESSAGES);
    setAgentThreadState(createDefaultAgentThreadState(selectedSkill));
    setDraft('');
    setChatImages([]);
    setSelectedGuidanceChoiceKeys([]);
    setStatusText(null);
    clearThinkingTypewriter();
    clearMessageTypewriter();
    setThinkingPreviewByMessageId({});
    setStructuredProgressByMessageId({});
    setNewThreadAnimationKey((key) => key + 1);
    setIsThreadHistoryOpen(false);
    setThreadSearchQuery('');
    setThreadSummaries((items) => {
      const nextRecord: CommerceAgentThreadRecord = {
        projectId: currentProjectId ?? '',
        threadId,
        title: selectedSkill?.title || t('commerceAd.agent.untitledChat'),
        messagesJson: '[]',
        stateJson: JSON.stringify(createDefaultAgentThreadState(selectedSkill)),
        createdAt: now,
        updatedAt: now,
      };
      return [
        nextRecord,
        ...items,
      ]
        .filter((item) => item.projectId === (currentProjectId ?? '') || item.threadId === threadId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, COMMERCE_AGENT_THREAD_LIMIT);
    });
  }, [
    agentThreadState,
    chatImages,
    currentProjectId,
    draft,
    isThinking,
    messages,
    persistActiveThreadSnapshot,
    selectedSkill,
    t,
  ]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (isThinking || !currentProjectId || threadId === activeThreadId) {
      setIsThreadHistoryOpen(false);
      return;
    }
    persistActiveThreadSnapshot();
    const summary = threadSummaries.find((thread) => thread.threadId === threadId) ?? null;
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
    activeThreadCreatedAtRef.current = summary?.createdAt || summary?.updatedAt || Date.now();
    setMessages(summary ? parsePersistedCommerceAgentMessages(summary.messagesJson) : DEFAULT_AGENT_MESSAGES);
    setAgentThreadState(summary ? parseAgentThreadState(summary.stateJson, selectedSkill) : createDefaultAgentThreadState(selectedSkill));
    setDraft('');
    setChatImages([]);
    setSelectedGuidanceChoiceKeys([]);
    setStatusText(null);
    clearThinkingTypewriter();
    clearMessageTypewriter();
    setThinkingPreviewByMessageId({});
    setStructuredProgressByMessageId({});
    setIsThreadHistoryOpen(false);
    void getCommerceAgentThread(currentProjectId, threadId)
      .then((record) => {
        if (threadId !== activeThreadIdRef.current) {
          return;
        }
        const nextRecord = record ?? summary;
        if (!nextRecord) {
          return;
        }
        activeThreadCreatedAtRef.current = nextRecord.createdAt || nextRecord.updatedAt || Date.now();
        setMessages(parsePersistedCommerceAgentMessages(nextRecord.messagesJson));
        setAgentThreadState(parseAgentThreadState(nextRecord.stateJson, selectedSkill));
      })
      .catch(() => {
        if (threadId !== activeThreadIdRef.current) {
          return;
        }
        if (summary) {
          activeThreadCreatedAtRef.current = summary.createdAt || summary.updatedAt || Date.now();
          setMessages(parsePersistedCommerceAgentMessages(summary.messagesJson));
          setAgentThreadState(parseAgentThreadState(summary.stateJson, selectedSkill));
        }
      });
  }, [activeThreadId, currentProjectId, isThinking, persistActiveThreadSnapshot, threadSummaries]);

  const handleDeleteThread = useCallback((
    threadId: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (isThinking || !currentProjectId) {
      return;
    }

    void deleteCommerceAgentThread(currentProjectId, threadId)
      .then(() => {
        setThreadSummaries((items) => items.filter((item) => item.threadId !== threadId));
        if (threadId !== activeThreadIdRef.current) {
          return;
        }
        const now = Date.now();
        activeThreadIdRef.current = COMMERCE_AGENT_DEFAULT_THREAD_ID;
        activeThreadCreatedAtRef.current = now;
        setActiveThreadId(COMMERCE_AGENT_DEFAULT_THREAD_ID);
        setMessages(DEFAULT_AGENT_MESSAGES);
        setAgentThreadState(createDefaultAgentThreadState(selectedSkill));
        setDraft('');
        setChatImages([]);
        setSelectedGuidanceChoiceKeys([]);
        setStatusText(null);
      });
  }, [currentProjectId, isThinking]);

  const handleAgentPanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentPanelWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        COMMERCE_AGENT_PANEL_MAX_WIDTH,
        Math.max(COMMERCE_AGENT_PANEL_MIN_WIDTH, startWidth - (moveEvent.clientX - startX))
      );
      setAgentPanelWidth(nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [agentPanelWidth]);

  const filteredThreadSummaries = useMemo(() => {
    const query = threadSearchQuery.trim().toLowerCase();
    const sortedThreads = threadSummaries
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, COMMERCE_AGENT_THREAD_LIMIT);
    if (!query) {
      return sortedThreads;
    }
    return sortedThreads.filter((thread) => (
      thread.title.toLowerCase().includes(query)
      || thread.messagesJson.toLowerCase().includes(query)
      || thread.stateJson.toLowerCase().includes(query)
    ));
  }, [threadSearchQuery, threadSummaries]);
  const visibleMessages = useMemo(
    () => messages.filter((message) => !isInternalProductInfoMessage(message)),
    [messages]
  );
  const imageModels = useMemo(
    () => listImageModels(
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    ),
    [
      settings.storyboardApi2OkModelConfig,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardProviderCustomModels,
    ]
  );
  const selectedImageModel = useMemo(
    () => getImageModel(
      batchNode?.data.modelId || COMMERCE_DEFAULT_IMAGE_MODEL_ID,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    ),
    [
      batchNode?.data.modelId,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardProviderCustomModels,
    ]
  );
  const ratioOptions = selectedImageModel.aspectRatios;
  const currentRatios = useMemo(() => {
    return resolveCommerceAspectRatiosForModel(selectedImageModel, batchNode?.data.aspectRatios ?? []);
  }, [batchNode?.data.aspectRatios, selectedImageModel]);
  const currentVariantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(batchNode?.data.variantsPerRatio) || 1)));
  const currentBatchCount = Math.max(1, Math.min(20, Math.round(Number(batchNode?.data.batchCount) || 1)));
  const detailPages = useMemo(
    () => normalizeDetailPagesForEditing(
      batchNode?.data.detailPages?.length
        ? batchNode.data.detailPages
        : briefNode?.data.detailPages ?? []
    ),
    [batchNode?.data.detailPages, briefNode?.data.detailPages]
  );
  const validDetailPages = useMemo(
    () => detailPages.filter((page) => (
      page.lockedCopy.trim()
      || page.optimizedCopy.trim()
      || page.prompt.trim()
    )),
    [detailPages]
  );
  const hasManualPageLockedInfo = useMemo(
    () => hasLockedDetailPageInfo(detailPages),
    [detailPages]
  );
  const detailPageCount = validDetailPages.length;
  const plannedImageCount = detailPageCount * currentRatios.length * currentVariantsPerRatio * currentBatchCount;
  const canCreateDetailPageBatch = hasResolvedProductInfo && detailPageCount > 0;
  const productionSummary = canCreateDetailPageBatch
    ? t('commerceAd.agent.detailPages.productionReady', {
        pageCount: detailPageCount,
        ratioCount: currentRatios.length,
        imageCount: currentVariantsPerRatio,
        batchCount: currentBatchCount,
        total: plannedImageCount,
      })
    : t('commerceAd.agent.detailPages.productionNeedsPages');
  const imageProviderOptions = useMemo(() => {
    const providerIds = Array.from(new Set(imageModels.map((model) => model.providerId)));
    return providerIds
      .sort((left, right) => {
        if (left === 'oopii') return -1;
        if (right === 'oopii') return 1;
        return left.localeCompare(right);
      })
      .map((providerId) => {
        const provider = getModelProvider(providerId);
        return {
          id: providerId,
          label: providerId === 'oopii'
            ? `oopii-${t('commerceAd.agent.recommended')}`
            : provider.label || provider.name || providerId,
        };
      });
  }, [imageModels, t]);
  const selectedProviderImageModels = useMemo(
    () => imageModels.filter((model) => model.providerId === selectedImageModel.providerId),
    [imageModels, selectedImageModel.providerId]
  );
  const resolutionOptions = useMemo(
    () => resolveImageModelResolutions(selectedImageModel, { extraParams: {} }),
    [selectedImageModel]
  );
  const selectedResolution = useMemo(
    () => resolveImageModelResolution(
      selectedImageModel,
      batchNode?.data.size || resolveCommerceDefaultResolution(selectedImageModel),
      { extraParams: {} }
    ),
    [batchNode?.data.size, selectedImageModel]
  );
  const upsertAgentPlanNode = useCallback((plan: CommerceAgentPlanState) => {
    const existing = useCanvasStore.getState().nodes.find((node) => (
      node.type === CANVAS_NODE_TYPES.commerceAgentPlan
      && (node.data as Partial<CommerceAgentPlanNodeData>).agentThreadId === activeThreadId
    ));
    if (existing) {
      updateNodeData(existing.id, {
        ...plan,
        agentThreadId: activeThreadId,
      } as Partial<CanvasNodeData>);
      setSelectedNode(existing.id);
      flow.setCenter(existing.position.x + 180, existing.position.y + 180, {
        zoom: 0.9,
        duration: 260,
      });
      return existing.id;
    }

    const planNodes = useCanvasStore.getState().nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.commerceAgentPlan);
    const lastPlanNode = planNodes[planNodes.length - 1];
    const position = lastPlanNode?.position
      ? { x: lastPlanNode.position.x, y: lastPlanNode.position.y + 560 }
      : resultNode?.position
        ? { x: resultNode.position.x, y: resultNode.position.y - 520 }
        : { x: 120, y: 120 };
    const nodeId = addNode(CANVAS_NODE_TYPES.commerceAgentPlan, position, {
      ...plan,
      agentThreadId: activeThreadId,
    } as Partial<CanvasNodeData>);
    setSelectedNode(nodeId);
    flow.setCenter(position.x + 180, position.y + 180, {
      zoom: 0.9,
      duration: 260,
    });
    return nodeId;
  }, [activeThreadId, addNode, flow, resultNode?.position, setSelectedNode, updateNodeData]);

  const canvasActionContext = useMemo<CommerceAdCanvasActionsContext>(() => ({
    getNodes: () => useCanvasStore.getState().nodes,
    addNode,
    updateNodeData,
    updateNodePosition,
    addEdge,
    setSelectedNode,
    setCenter: flow.setCenter,
  }), [addEdge, addNode, flow.setCenter, setSelectedNode, updateNodeData, updateNodePosition]);

  const applyActions = useCallback((
    actions: CommerceAdAgentAction[],
    options?: CommerceAdAgentActionOptions
  ) => {
    return applyCommerceAdAgentActions(actions, canvasActionContext, options);
  }, [canvasActionContext]);

  const runAgent = useCallback(async (
    userMessage: string,
    productOverride?: CommerceAdProductState,
    visualPreferenceOverride?: CommerceAdVisualPreferenceState,
    task: CommerceAgentTask = 'chat',
    options: { hideUserMessage?: boolean } = {}
  ) => {
    const trimmedMessage = userMessage.trim();
    if (!trimmedMessage && !productOverride && productImages.length === 0) {
      return;
    }

    const nextUserMessage = trimmedMessage && !options.hideUserMessage
      ? createLocalMessage('user', trimmedMessage)
      : null;
    if (nextUserMessage) {
      setMessages((items) => [...items, nextUserMessage]);
    }

    setIsThinking(true);
    setActiveAgentTask(task);
    setStatusText(t('commerceAd.agent.statusThinking'));
    try {
      const product = productOverride ?? productNode?.data ?? null;
      const result = await runCommerceAdAgentTurn({
        userMessage: trimmedMessage || composeProductUserInfo(lockedDocumentInfo, userIdeaInfo),
        product,
        brief: briefNode?.data ?? null,
        visualPreference: visualPreferenceOverride ?? visualPreferenceNode?.data ?? visualPreferenceDraft,
        batch: batchNode?.data ?? null,
        referenceImages: dedupeStrings([
          ...(product?.images ?? productImages).map((image) => image.imageUrl),
          ...productReferenceImages,
        ]).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
        canUseVisionModel,
      });
      const productAction = result.actions.find((action) => action.type === 'upsertProduct');
      const nextProduct = mergeProductState(product, productAction?.type === 'upsertProduct' ? productAction.data : null);
      const shouldAllowBatchActions = hasProductInfo(nextProduct);
      const nextActions = shouldAllowBatchActions
        ? result.actions
        : result.actions.filter((action) => action.type !== 'upsertBatchGenerate');
      applyActions(nextActions, {
        alignStageNodes: true,
        targetNodeIds: {
          product: productNode?.id ?? null,
          brief: briefNode?.id ?? null,
          visualPreference: visualPreferenceNode?.id ?? null,
          batch: batchNode?.id ?? null,
          result: resultNode?.id ?? null,
        },
      });
      setMessages((items) => [...items, result.assistantMessage]);
      setStatusText(t('commerceAd.agent.statusSynced'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((items) => [
        ...items,
        createLocalMessage('assistant', t('commerceAd.agent.errorMessage', { message })),
      ]);
      setStatusText(t('commerceAd.agent.statusFailed'));
    } finally {
      setIsThinking(false);
      setActiveAgentTask(null);
    }
  }, [
    applyActions,
    batchNode?.data,
    batchNode?.id,
    briefNode?.data,
    briefNode?.id,
    canUseVisionModel,
    lockedDocumentInfo,
    productImages,
    productReferenceImages,
    productNode?.data,
    productNode?.id,
    resultNode?.id,
    t,
    userIdeaInfo,
    visualPreferenceDraft,
    visualPreferenceNode?.data,
    visualPreferenceNode?.id,
  ]);

  const handleUploadClick = useCallback(() => {
    if (isProductImageLimitReached) {
      setStatusText(t('commerceAd.agent.productImageLimitReached', {
        limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
      }));
      return;
    }
    fileInputRef.current?.click();
  }, [isProductImageLimitReached, t]);

  useEffect(() => {
    window.addEventListener(COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT, handleUploadClick);
    return () => {
      window.removeEventListener(COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT, handleUploadClick);
    };
  }, [handleUploadClick]);

  const resetCommerceDataAfterProductImageChange = useCallback((nextImages: CommerceAdProductImage[]) => {
    const nextLockedDocumentInfo = lockedDocumentInfo.trim() || productNode?.data.lockedDocumentInfo || '';
    const nextUserIdeaInfo = userIdeaInfo.trim()
      || productNode?.data.userIdeaInfo
      || productNode?.data.userInfo
      || '';
    if (productNode) {
      updateNodeData(
        productNode.id,
        createImageChangedProductState(
          nextImages,
          nextLockedDocumentInfo,
          nextUserIdeaInfo,
          detailInputMode
        ) as Partial<CanvasNodeData>
      );
    }
    if (briefNode) {
      updateNodeData(
        briefNode.id,
        createDefaultCommerceAdBriefState() as Partial<CanvasNodeData>
      );
    }
    if (visualPreferenceNode) {
      const defaultVisualPreference = createDefaultCommerceAdVisualPreferenceState();
      updateNodeData(
        visualPreferenceNode.id,
        defaultVisualPreference as Partial<CanvasNodeData>
      );
      setVisualPreferenceDraft(defaultVisualPreference);
    }
    if (batchNode) {
      updateNodeData(batchNode.id, {
        generationMode: 'detailPages',
        aspectRatios: currentRatios,
        variantsPerRatio: currentVariantsPerRatio,
        modelId: selectedImageModel.id,
        size: selectedResolution.value,
        corePrompt: '',
        ratioPrompts: {},
        detailPageIds: [],
        detailPageCount: 0,
        detailPages: [],
        batchCount: currentBatchCount,
        stylePromptFragment: '',
        status: 'idle',
        lastGeneratedAt: null,
        lastError: null,
      } as Partial<CanvasNodeData>);
    }
    if (resultNode) {
      updateNodeData(
        resultNode.id,
        createDefaultCommerceAdResultGroupState() as Partial<CanvasNodeData>
      );
    }
  }, [
    batchNode,
    briefNode,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    detailInputMode,
    lockedDocumentInfo,
    productNode,
    resultNode,
    selectedImageModel.id,
    selectedResolution.value,
    updateNodeData,
    userIdeaInfo,
    visualPreferenceNode,
  ]);

  const handleDeleteProductImage = useCallback((imageId: string) => {
    const nextImages = productImages.filter((image) => image.id !== imageId);
    resetCommerceDataAfterProductImageChange(nextImages);
    setStatusText(t('commerceAd.agent.productImageDeleted'));
  }, [productImages, resetCommerceDataAfterProductImageChange, t]);

  const handleReplaceProductImageClick = useCallback((imageId: string) => {
    replaceImageIdRef.current = imageId;
    replaceFileInputRef.current?.click();
  }, []);

  const handleUpdateProductImageDescription = useCallback((imageId: string, description: string) => {
    const nextImages = productImages.map((image) => (
      image.id === imageId ? { ...image, description } : image
    ));
    if (productNode) {
      updateNodeData(productNode.id, {
        images: normalizeProductImageRoles(nextImages),
        lastError: null,
      } as Partial<CanvasNodeData>);
      return;
    }

    applyActions([{
      type: 'upsertProduct',
      data: createImageChangedProductState(
        nextImages,
        lockedDocumentInfo,
        userIdeaInfo,
        detailInputMode
      ),
    }], { focusLastTouched: false });
  }, [
    applyActions,
    detailInputMode,
    lockedDocumentInfo,
    productImages,
    productNode,
    updateNodeData,
    userIdeaInfo,
  ]);

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    event.target.value = '';
    if (files.length === 0) {
      return;
    }
    if (remainingProductImageSlots <= 0) {
      setStatusText(t('commerceAd.agent.productImageLimitReached', {
        limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
      }));
      return;
    }

    const acceptedFiles = files.slice(0, remainingProductImageSlots);
    const skippedCount = files.length - acceptedFiles.length;

    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const preparedImages = await Promise.all(
        acceptedFiles.map(async (file, index): Promise<CommerceAdProductImage> => {
          const prepared = await prepareNodeImageFromFile(
            file,
            undefined,
            undefined,
            settings.canvasOverviewThumbnailMaxDimension
          );
          return {
            id: `commerce-product-image-${Date.now()}-${index + 1}`,
            imageUrl: prepared.imageUrl,
            previewImageUrl: prepared.previewImageUrl,
            aspectRatio: prepared.aspectRatio,
            label: file.name || t('commerceAd.agent.productImageLabel', { index: index + 1 }),
            description: '',
            kind: productImages.length === 0 && index === 0 ? 'main' : 'reference',
            evidenceTags: [],
          };
        })
      );
      const mergedProduct = mergeProductImages(productNode?.data ?? null, preparedImages);
      applyActions([{ type: 'upsertProduct', data: mergedProduct }]);

      setMessages((items) => [
        ...items,
        createLocalMessage('user', t('commerceAd.agent.uploadedImages', {
          count: preparedImages.length,
          total: Math.min(productImageCount + preparedImages.length, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
          limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
        })),
        createLocalMessage(
          'assistant',
          t('commerceAd.agent.guidance.uploadAssistant', {
            count: preparedImages.length,
            total: Math.min(productImageCount + preparedImages.length, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
            limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
          }),
          createUploadGuidance(preparedImages.length)
        ),
      ]);
      setStatusText(skippedCount > 0
        ? t('commerceAd.agent.productImageLimitAccepted', {
            accepted: preparedImages.length,
            skipped: skippedCount,
            limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
          })
        : t('commerceAd.agent.statusUploaded'));
    } finally {
      setUploading(false);
    }
  }, [
    applyActions,
    createUploadGuidance,
    productImageCount,
    productImages.length,
    productNode?.data,
    remainingProductImageSlots,
    settings.canvasOverviewThumbnailMaxDimension,
    t,
  ]);

  const addChatImagesFromFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      setStatusText(t('commerceAd.agent.chatImagesOnly'));
      return;
    }
    const remainingSlots = Math.max(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT - chatImages.length);
    if (remainingSlots <= 0) {
      setStatusText(t('commerceAd.agent.productImageLimitReached', {
        limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
      }));
      return;
    }

    const acceptedFiles = files.slice(0, remainingSlots);
    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const preparedImages = await Promise.all(
        acceptedFiles.map(async (file, index): Promise<CommerceAdProductImage> => {
          const prepared = await prepareNodeImageFromFile(
            file,
            undefined,
            undefined,
            settings.canvasOverviewThumbnailMaxDimension
          );
          return {
            id: `commerce-agent-chat-image-${Date.now()}-${index + 1}`,
            imageUrl: prepared.imageUrl,
            previewImageUrl: prepared.previewImageUrl,
            aspectRatio: prepared.aspectRatio,
            label: file.name || t('commerceAd.agent.productImageLabel', { index: index + 1 }),
            description: '',
            kind: chatImages.length === 0 && index === 0 ? 'main' : 'reference',
            evidenceTags: [],
          };
        })
      );
      setChatImages((items) => normalizeProductImageRoles([...items, ...preparedImages]));
      setStatusText(t('commerceAd.agent.chatImagesUploaded', { count: preparedImages.length }));
    } catch {
      setStatusText(t('commerceAd.agent.chatImagesUploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [chatImages.length, settings.canvasOverviewThumbnailMaxDimension, t]);

  const handleChatImageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0) {
      void addChatImagesFromFiles(files);
    }
  }, [addChatImagesFromFiles]);

  const handleRemoveChatImage = useCallback((imageId: string) => {
    setChatImages((items) => normalizeProductImageRoles(items.filter((image) => image.id !== imageId)));
  }, []);

  const handleChatPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      event.preventDefault();
      void addChatImagesFromFiles(files);
    }
  }, [addChatImagesFromFiles]);

  const handleReplaceProductImageSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const imageId = replaceImageIdRef.current;
    const file = Array.from(event.target.files ?? []).find((item) => item.type.startsWith('image/'));
    event.target.value = '';
    replaceImageIdRef.current = null;
    if (!imageId || !file) {
      return;
    }

    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const prepared = await prepareNodeImageFromFile(
        file,
        undefined,
        undefined,
        settings.canvasOverviewThumbnailMaxDimension
      );
      const nextImages = productImages.map((image) => (
        image.id === imageId
          ? {
              ...image,
              imageUrl: prepared.imageUrl,
              previewImageUrl: prepared.previewImageUrl,
              aspectRatio: prepared.aspectRatio,
              label: file.name || image.label,
              description: image.description ?? '',
              evidenceTags: image.evidenceTags ?? [],
            }
          : image
      ));
      resetCommerceDataAfterProductImageChange(nextImages);
      setStatusText(t('commerceAd.agent.productImageReplaced'));
    } finally {
      setUploading(false);
    }
  }, [
    productImages,
    resetCommerceDataAfterProductImageChange,
    settings.canvasOverviewThumbnailMaxDimension,
    t,
  ]);

  const handleGenerateNodeInfo = useCallback(() => {
    const normalizedDetailPages = normalizeDetailPagesForEditing(detailPages);
    const manualLockedInfo = composeManualDetailPagesLockedInfo(normalizedDetailPages);
    const nextLockedDocumentInfo = detailInputMode === 'manualPages'
      ? manualLockedInfo
      : lockedDocumentInfo.trim();
    const nextUserIdeaInfo = userIdeaInfo.trim();
    const userInfo = composeProductUserInfo(nextLockedDocumentInfo, nextUserIdeaInfo);
    if (!nextLockedDocumentInfo && !nextUserIdeaInfo && productReferenceImages.length === 0) {
      setStatusText(t('commerceAd.agent.needProductReferenceBeforeGenerate'));
      return;
    }
    const nextProduct: CommerceAdProductState = {
      ...mergeProductImages(productNode?.data ?? null, []),
      detailInputMode,
      lockedDocumentInfo: nextLockedDocumentInfo,
      userIdeaInfo: nextUserIdeaInfo,
      userInfo,
      lastError: null,
    };
    const actions: CommerceAdAgentAction[] = [{ type: 'upsertProduct', data: nextProduct }];
    if (detailInputMode === 'manualPages') {
      actions.push(
        {
          type: 'upsertBrief',
          data: {
            detailPages: normalizedDetailPages,
            updatedAt: Date.now(),
          },
        },
        {
          type: 'upsertBatchGenerate',
          data: {
            generationMode: 'detailPages',
            aspectRatios: currentRatios,
            variantsPerRatio: currentVariantsPerRatio,
            batchCount: currentBatchCount,
            detailPages: normalizedDetailPages,
            detailPageIds: normalizedDetailPages.map((page) => page.id),
            detailPageCount: normalizedDetailPages.length,
            stylePromptFragment: visualPreferenceDraft.promptFragment,
            modelId: selectedImageModel.id,
            size: selectedResolution.value,
            status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
          },
        }
      );
    }
    applyActions(actions, { alignStageNodes: true });
    setStatusText(t('commerceAd.agent.statusThinking'));
    void runAgent(userInfo, nextProduct, undefined, 'syncProductInfo', { hideUserMessage: true })
      .finally(() => {
        setIsDetailSetupOpen(false);
      });
  }, [
    applyActions,
    batchNode?.data.corePrompt,
    batchNode?.data.status,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    detailInputMode,
    detailPages,
    lockedDocumentInfo,
    productNode?.data,
    productReferenceImages.length,
    runAgent,
    selectedImageModel.id,
    selectedResolution.value,
    t,
    userIdeaInfo,
    visualPreferenceDraft.promptFragment,
  ]);

  const updateVisualPreferenceDraft = useCallback((data: Partial<CommerceAdVisualPreferenceState>) => {
    setVisualPreferenceDraft((current) => {
      const nextPreference = buildVisualPreferencePatch(normalizeCommerceAdVisualPreferenceState({
        ...current,
        ...data,
        updatedAt: Date.now(),
      }));
      applyActions(
        [
          { type: 'upsertVisualPreference', data: nextPreference },
          {
            type: 'upsertBatchGenerate',
            data: {
              generationMode: 'detailPages',
              stylePromptFragment: nextPreference.promptFragment,
            },
          },
        ],
        {
          focusLastTouched: false,
          targetNodeIds: {
            visualPreference: visualPreferenceNode?.id ?? null,
            batch: batchNode?.id ?? null,
          },
        }
      );
      return nextPreference;
    });
  }, [applyActions, batchNode?.id, visualPreferenceNode?.id]);

  const handleInferProduct = useCallback(() => {
    const product = productNode?.data ?? null;
    if (!product || productReferenceImages.length === 0) {
      setStatusText(t('commerceAd.agent.needProductImageBeforeInfer'));
      return;
    }
    void runAgent(composeProductUserInfo(lockedDocumentInfo, userIdeaInfo), product, undefined, 'inferProduct', { hideUserMessage: true });
  }, [lockedDocumentInfo, productNode?.data, productReferenceImages.length, runAgent, t, userIdeaInfo]);

  useEffect(() => {
    window.addEventListener(COMMERCE_INFER_PRODUCT_EVENT, handleInferProduct);
    return () => {
      window.removeEventListener(COMMERCE_INFER_PRODUCT_EVENT, handleInferProduct);
    };
  }, [handleInferProduct]);

  const updateBatchConfig = useCallback((data: Partial<CommerceAdBatchGenerateState>) => {
    applyActions([{
      type: 'upsertBatchGenerate',
      data: {
        generationMode: 'detailPages',
        aspectRatios: currentRatios,
        variantsPerRatio: currentVariantsPerRatio,
        batchCount: currentBatchCount,
        modelId: selectedImageModel.id,
        size: selectedResolution.value,
        detailPageIds: detailPages.map((page) => page.id),
        detailPageCount: detailPages.length,
        detailPages,
        stylePromptFragment: visualPreferenceDraft.promptFragment,
        ...data,
        status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
      },
    }]);
  }, [
    applyActions,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    batchNode?.data.status,
    detailPages,
    selectedImageModel.id,
    selectedResolution.value,
    visualPreferenceDraft.promptFragment,
  ]);

  const togglePageRatio = useCallback((ratio: string) => {
    const nextRatios = currentRatios.includes(ratio)
      ? currentRatios.filter((item) => item !== ratio)
      : [...currentRatios, ratio];
    updateBatchConfig({ aspectRatios: nextRatios.length > 0 ? nextRatios : [ratio] });
  }, [currentRatios, updateBatchConfig]);

  const handleImageModelChange = useCallback((modelId: string) => {
    const nextModel = getImageModel(
      modelId,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    );
    const nextResolution = resolveImageModelResolution(
      nextModel,
      resolveCommerceDefaultResolution(nextModel),
      { extraParams: {} }
    );
    updateBatchConfig({
      aspectRatios: resolveCommerceAspectRatiosForModel(nextModel, currentRatios),
      modelId: nextModel.id,
      size: nextResolution.value,
    });
  }, [
    currentRatios,
    settings.storyboardApi2OkModelConfig,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardProviderCustomModels,
    updateBatchConfig,
  ]);

  const handleImageProviderChange = useCallback((providerId: string) => {
    const nextModelId =
      imageModels.find((model) => model.providerId === providerId)?.id
      ?? COMMERCE_DEFAULT_IMAGE_MODEL_ID;
    handleImageModelChange(nextModelId);
  }, [handleImageModelChange, imageModels]);

  const updateDetailPages = useCallback((pages: CommerceAdDetailPage[]) => {
    const normalizedPages = normalizeDetailPagesForEditing(pages);
    applyActions(
      [
        {
          type: 'upsertBrief',
          data: {
            detailPages: normalizedPages,
            updatedAt: Date.now(),
          },
        },
        {
          type: 'upsertBatchGenerate',
          data: {
            generationMode: 'detailPages',
            aspectRatios: currentRatios,
            variantsPerRatio: currentVariantsPerRatio,
            batchCount: currentBatchCount,
            detailPages: normalizedPages,
            detailPageIds: normalizedPages.map((page) => page.id),
            detailPageCount: normalizedPages.length,
            stylePromptFragment: visualPreferenceDraft.promptFragment,
            modelId: selectedImageModel.id,
            size: selectedResolution.value,
            status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
          },
        },
      ],
      {
        focusLastTouched: false,
        targetNodeIds: {
          brief: briefNode?.id ?? null,
          batch: batchNode?.id ?? null,
        },
      }
    );
  }, [
    applyActions,
    batchNode?.data.corePrompt,
    batchNode?.data.status,
    batchNode?.id,
    briefNode?.id,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    selectedImageModel.id,
    selectedResolution.value,
    visualPreferenceDraft.promptFragment,
  ]);

  const handleAddDetailPage = useCallback(() => {
    const nextPage = createDetailPageDraft({
      pageNo: detailPages.length + 1,
      title: t('commerceAd.agent.detailPages.defaultTitle', { page: detailPages.length + 1 }),
    });
    updateDetailPages([...detailPages, nextPage]);
  }, [detailPages, t, updateDetailPages]);

  const handleDeleteDetailPage = useCallback((pageId: string) => {
    updateDetailPages(detailPages.filter((page) => page.id !== pageId));
  }, [detailPages, updateDetailPages]);

  const handleMoveDetailPage = useCallback((pageId: string, direction: -1 | 1) => {
    const currentIndex = detailPages.findIndex((page) => page.id === pageId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= detailPages.length) {
      return;
    }
    const nextPages = [...detailPages];
    const [page] = nextPages.splice(currentIndex, 1);
    nextPages.splice(nextIndex, 0, page);
    updateDetailPages(nextPages);
  }, [detailPages, updateDetailPages]);

  const handleUpdateDetailPage = useCallback((
    pageId: string,
    data: Partial<Omit<CommerceAdDetailPage, 'id' | 'pageNo'>>
  ) => {
    updateDetailPages(detailPages.map((page) => (
      page.id === pageId ? { ...page, ...data } : page
    )));
  }, [detailPages, updateDetailPages]);

  const handleGenerate = useCallback(async () => {
    const corePrompt =
      batchNode?.data.corePrompt
      || briefNode?.data.normalizedBrief
      || productNode?.data.lockedDocumentInfo
      || productNode?.data.userIdeaInfo
      || productNode?.data.userInfo
      || productNode?.data.inference?.summary
      || '';
    const pagesForGeneration = validDetailPages;
    if (!hasResolvedProductInfo) {
      setStatusText(t('commerceAd.agent.needProductInfoBeforeBatch'));
      return;
    }
    if (pagesForGeneration.length === 0) {
      setStatusText(t('commerceAd.agent.detailPages.needPagesBeforeGenerate'));
      return;
    }
    if (!corePrompt.trim()) {
      setStatusText(t('commerceAd.agent.needBriefBeforeGenerate'));
      return;
    }
    if (
      productReferenceImages.length === 0
      && ![
        productNode?.data.lockedDocumentInfo,
        productNode?.data.userIdeaInfo,
        productNode?.data.userInfo,
      ].some((value) => value?.trim())
    ) {
      setStatusText(t('commerceAd.agent.needProductReferenceBeforeGenerate'));
      return;
    }

    const providerApiKey = settings.storyboardApiKeys[selectedImageModel.providerId] ?? '';
    if (!providerApiKey.trim()) {
      openSettingsDialog({
        category: 'providers',
        providerTab: 'storyboard',
        providerId: selectedImageModel.providerId,
      });
      setStatusText(t('commerceAd.agent.noImageApiKey'));
      return;
    }

    const generationBatch = buildDetailPageGenerationBatch(
      batchNode?.data ?? null,
      corePrompt,
      pagesForGeneration,
      visualPreferenceNode?.data ?? visualPreferenceDraft,
      composeProductImageReferenceNotes(productNode?.data.images ?? productImages)
    );
    const referenceImages = productReferenceImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const startedAt = Date.now();
    const generationDurationMs = selectedImageModel.expectedDurationMs ?? 60000;
    const requestResolution = selectedImageModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const emptyBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: [],
    };
    const resultGroupId = applyActions([
      {
        type: 'upsertResultGroup',
        data: {
          batches: [...(resultNode?.data.batches ?? []), emptyBatch],
          activeBatchId: emptyBatch.id,
        },
      },
    ], {
      focusLastTouched: false,
      targetNodeIds: {
        result: resultNode?.id ?? null,
      },
    }) ?? resultNode?.id ?? null;
    const resultGroupNode =
      resultGroupId
        ? useCanvasStore.getState().nodes.find((node) => node.id === resultGroupId)
        : resultNode ?? null;
    const resultImageStartIndex = countCommerceResultImages(resultNode?.data.batches);
    const submittedImages: CommerceAdGeneratedImageRecord[] = [];
    setStatusText(t('commerceAd.agent.statusSubmitting'));

    await canvasAiGateway.setApiKey(selectedImageModel.providerId, providerApiKey);

    for (const [index, imageRecord] of generationBatch.images.entries()) {
      const prompt = imageRecord.prompt || corePrompt;
      const resultNodeId = addNode(
        CANVAS_NODE_TYPES.exportImage,
        resolveCommerceResultImagePosition(resultGroupNode, resultImageStartIndex + index),
        {
          isGenerating: true,
          generationPhase: 'submitting',
          generationStartedAt: startedAt,
          generationDurationMs,
          resultKind: 'generic',
          displayName: imageRecord.detailPageNo
            ? t('commerceAd.agent.detailPages.resultTitle', {
                page: imageRecord.detailPageNo,
                title: imageRecord.detailPageTitle || t('commerceAd.agent.detailPages.untitled'),
              })
            : `${t('commerceAd.nodes.results')} ${imageRecord.aspectRatio}`,
          aspectRatio: imageRecord.aspectRatio,
          generationSummary: {
            sourceType: 'imageEdit',
            providerId: selectedImageModel.providerId,
            requestModel: requestResolution.requestModel,
            prompt,
            generatedAt: null,
          },
        }
      );
      if (resultGroupId) {
        addEdge(resultGroupId, resultNodeId);
      }

      try {
        const resolvedPayload = await canvasAiGateway.resolveGenerateImagePayload({
          prompt,
          model: requestResolution.requestModel,
          size: selectedResolution.value,
          aspectRatio: imageRecord.aspectRatio,
          referenceImages,
          submissionSource: 'commerceBatchGenerate',
        });
        const jobId = await canvasAiGateway.submitGenerateImageJob(resolvedPayload);
        updateNodeData(resultNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: 'queued',
          generationStartedAt: startedAt,
          generationSourceType: 'imageEdit',
          generationProviderId: selectedImageModel.providerId,
          generationError: null,
        });
        submittedImages.push({
          ...imageRecord,
          nodeId: resultNodeId,
          status: 'running',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateNodeData(resultNodeId, {
          isGenerating: false,
          generationPhase: 'failed',
          generationError: message,
        });
        submittedImages.push({
          ...imageRecord,
          nodeId: resultNodeId,
          status: 'failed',
          error: message,
        });
      }
    }

    const submittedBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: submittedImages,
    };
    applyActions([
      {
        type: 'upsertBatchGenerate',
        data: {
          corePrompt,
          aspectRatios: submittedBatch.aspectRatios,
          variantsPerRatio: submittedBatch.variantsPerRatio,
          batchCount: submittedBatch.batchCount ?? currentBatchCount,
          generationMode: 'detailPages',
          detailPageIds: pagesForGeneration.map((page) => page.id),
          detailPageCount: pagesForGeneration.length,
          detailPages: pagesForGeneration,
          stylePromptFragment: (visualPreferenceNode?.data ?? visualPreferenceDraft).promptFragment,
          modelId: selectedImageModel.id,
          size: selectedResolution.value,
          status: 'ready',
          lastGeneratedAt: submittedBatch.createdAt,
          lastError: null,
        },
      },
      {
        type: 'upsertResultGroup',
        data: {
          batches: [
            ...(resultNode?.data.batches ?? []).filter((batch) => batch.id !== submittedBatch.id),
            submittedBatch,
          ],
          activeBatchId: submittedBatch.id,
        },
      },
    ], {
      focusLastTouched: false,
      targetNodeIds: {
        result: resultGroupId,
      },
    });
    setMessages((items) => [
      ...items,
      createLocalMessage('assistant', t('commerceAd.agent.batchCreated', {
        count: submittedBatch.images.length,
      })),
    ]);
    setStatusText(t('commerceAd.agent.statusBatchCreated'));
  }, [
    addEdge,
    addNode,
    applyActions,
    batchNode?.data,
    batchNode?.id,
    briefNode?.data,
    briefNode?.data.normalizedBrief,
    hasResolvedProductInfo,
    productNode?.data,
    productReferenceImages,
    resultNode?.data.batches,
    resultNode?.position,
    selectedImageModel,
    selectedResolution.value,
    settings.storyboardApiKeys,
    t,
    updateNodeData,
    validDetailPages,
    visualPreferenceDraft,
    visualPreferenceNode?.data,
  ]);

  const handleGenerateFromAgentPlan = useCallback(async (planNodeId: string) => {
    const planNode = useCanvasStore.getState().nodes.find((node) => (
      node.id === planNodeId && node.type === CANVAS_NODE_TYPES.commerceAgentPlan
    )) as (CanvasNode & { data: CommerceAgentPlanNodeData }) | undefined;
    if (!planNode) {
      return;
    }

    const plan = planNode.data;
    const selectedPlanModel = getImageModel(
      plan.modelId || COMMERCE_DEFAULT_IMAGE_MODEL_ID,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    );
    const selectedPlanResolution = resolveImageModelResolution(
      selectedPlanModel,
      plan.size || resolveCommerceDefaultResolution(selectedPlanModel),
      { extraParams: {} }
    );
    if (!plan.prompt.trim()) {
      updateNodeData(planNode.id, {
        status: 'failed',
        lastError: t('commerceAd.agentPlan.needPrompt'),
      } as Partial<CanvasNodeData>);
      setStatusText(t('commerceAd.agentPlan.needPrompt'));
      return;
    }

    const providerApiKey = settings.storyboardApiKeys[selectedPlanModel.providerId] ?? '';
    if (!providerApiKey.trim()) {
      openSettingsDialog({
        category: 'providers',
        providerTab: 'storyboard',
        providerId: selectedPlanModel.providerId,
      });
      updateNodeData(planNode.id, {
        status: 'failed',
        lastError: t('commerceAd.agent.noImageApiKey'),
      } as Partial<CanvasNodeData>);
      setStatusText(t('commerceAd.agent.noImageApiKey'));
      return;
    }

    updateNodeData(planNode.id, {
      status: 'generating',
      lastError: null,
      providerId: selectedPlanModel.providerId,
      modelId: selectedPlanModel.id,
      size: selectedPlanResolution.value,
    } as Partial<CanvasNodeData>);

    const generationBatch = buildAgentPlanGenerationBatch({
      ...plan,
      providerId: selectedPlanModel.providerId,
      modelId: selectedPlanModel.id,
      size: selectedPlanResolution.value,
    });
    const referenceImages = dedupeStrings(
      plan.referenceImages.map((image) => image.imageUrl)
    ).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const startedAt = Date.now();
    const generationDurationMs = selectedPlanModel.expectedDurationMs ?? 60000;
    const requestResolution = selectedPlanModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const emptyBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: [],
    };
    const existingResultGroup = useCanvasStore.getState().nodes.find((node) => (
      node.type === CANVAS_NODE_TYPES.commerceResultGroup
      && useCanvasStore.getState().edges.some((edge) => edge.source === planNode.id && edge.target === node.id)
    ));
    const resultGroupId = existingResultGroup
      ? existingResultGroup.id
      : addNode(CANVAS_NODE_TYPES.commerceResultGroup, {
          x: planNode.position.x + 520,
          y: planNode.position.y,
        }, {
          ...createDefaultCommerceAdResultGroupState(),
          batches: [emptyBatch],
          activeBatchId: emptyBatch.id,
        } as Partial<CanvasNodeData>);
    if (existingResultGroup) {
      updateNodePosition(resultGroupId, {
        x: planNode.position.x + 520,
        y: planNode.position.y,
      });
      updateNodeData(resultGroupId, {
        batches: [...(((existingResultGroup.data as CommerceResultGroupNodeData).batches) ?? []), emptyBatch],
        activeBatchId: emptyBatch.id,
      } as Partial<CanvasNodeData>);
    }
    addEdge(planNode.id, resultGroupId);

    const resultGroupNode = useCanvasStore.getState().nodes.find((node) => node.id === resultGroupId);
    const existingResultBatches = existingResultGroup
      ? ((existingResultGroup.data as CommerceResultGroupNodeData).batches ?? [])
      : [];
    const resultImageStartIndex = countCommerceResultImages(existingResultBatches);
    const submittedImages: CommerceAdGeneratedImageRecord[] = [];
    setStatusText(t('commerceAd.agent.statusSubmitting'));
    await canvasAiGateway.setApiKey(selectedPlanModel.providerId, providerApiKey);

    for (const [index, imageRecord] of generationBatch.images.entries()) {
      const prompt = imageRecord.prompt || plan.prompt;
      const resultImageNodeId = addNode(
        CANVAS_NODE_TYPES.exportImage,
        resolveCommerceResultImagePosition(resultGroupNode, resultImageStartIndex + index),
        {
          isGenerating: true,
          generationPhase: 'submitting',
          generationStartedAt: startedAt,
          generationDurationMs,
          resultKind: 'generic',
          displayName: `${t('commerceAd.nodes.results')} ${imageRecord.aspectRatio}`,
          aspectRatio: imageRecord.aspectRatio,
          generationSummary: {
            sourceType: 'imageEdit',
            providerId: selectedPlanModel.providerId,
            requestModel: requestResolution.requestModel,
            prompt,
            generatedAt: null,
          },
        } as Partial<CanvasNodeData>
      );
      addEdge(resultGroupId, resultImageNodeId);
      try {
        const resolvedPayload = await canvasAiGateway.resolveGenerateImagePayload({
          prompt,
          model: requestResolution.requestModel,
          size: selectedPlanResolution.value,
          aspectRatio: imageRecord.aspectRatio,
          referenceImages,
          submissionSource: 'commerceBatchGenerate',
        });
        const jobId = await canvasAiGateway.submitGenerateImageJob(resolvedPayload);
        updateNodeData(resultImageNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: 'queued',
          generationStartedAt: startedAt,
          generationSourceType: 'imageEdit',
          generationProviderId: selectedPlanModel.providerId,
          generationError: null,
        } as Partial<CanvasNodeData>);
        submittedImages.push({
          ...imageRecord,
          nodeId: resultImageNodeId,
          status: 'running',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateNodeData(resultImageNodeId, {
          isGenerating: false,
          generationPhase: 'failed',
          generationError: message,
        } as Partial<CanvasNodeData>);
        submittedImages.push({
          ...imageRecord,
          nodeId: resultImageNodeId,
          status: 'failed',
          error: message,
        });
      }
    }

    const submittedBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: submittedImages,
    };
    const latestResultGroup = useCanvasStore.getState().nodes.find((node) => node.id === resultGroupId) as
      | (CanvasNode & { data: CommerceResultGroupNodeData })
      | undefined;
    updateNodeData(resultGroupId, {
      batches: [
        ...((latestResultGroup?.data.batches ?? []).filter((batch) => batch.id !== submittedBatch.id)),
        submittedBatch,
      ],
      activeBatchId: submittedBatch.id,
    } as Partial<CanvasNodeData>);
    updateNodeData(planNode.id, {
      status: 'ready',
      lastError: null,
    } as Partial<CanvasNodeData>);
    setMessages((items) => [
      ...items,
      createLocalMessage('assistant', t('commerceAd.agent.batchCreated', {
        count: submittedBatch.images.length,
      })),
    ]);
    setStatusText(t('commerceAd.agent.statusBatchCreated'));
  }, [
    addEdge,
    addNode,
    settings.storyboardApi2OkModelConfig,
    settings.storyboardApiKeys,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardProviderCustomModels,
    t,
    updateNodeData,
  ]);

  const handleRetryGeneratedImage = useCallback(async (batchId: string, imageId: string) => {
    const batch = resultNode?.data.batches.find((item) => item.id === batchId);
    const imageRecord = batch?.images.find((item) => item.id === imageId);
    if (!batch || !imageRecord) {
      return;
    }

    const providerApiKey = settings.storyboardApiKeys[selectedImageModel.providerId] ?? '';
    if (!providerApiKey.trim()) {
      openSettingsDialog({
        category: 'providers',
        providerTab: 'storyboard',
        providerId: selectedImageModel.providerId,
      });
      setStatusText(t('commerceAd.agent.noImageApiKey'));
      return;
    }

    const referenceImages = productReferenceImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const requestResolution = selectedImageModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const startedAt = Date.now();
    const generationDurationMs = selectedImageModel.expectedDurationMs ?? 60000;
    const prompt = imageRecord.prompt || batch.corePrompt;
    const resultNodeId = imageRecord.nodeId;

    const updateResultImage = (patch: Partial<CommerceAdGeneratedImageRecord>) => {
      applyActions([{
        type: 'upsertResultGroup',
        data: {
          activeBatchId: batch.id,
          batches: (resultNode?.data.batches ?? []).map((item) => (
            item.id === batch.id
              ? {
                  ...item,
                  images: item.images.map((image) => (
                    image.id === imageRecord.id ? { ...image, ...patch } : image
                  )),
                }
              : item
          )),
        },
      }], { focusLastTouched: false });
    };

    updateResultImage({
      status: 'running',
      error: null,
      imageUrl: null,
      previewImageUrl: null,
    });
    if (resultNodeId) {
      updateNodeData(resultNodeId, {
        imageUrl: null,
        previewImageUrl: null,
        isGenerating: true,
        generationPhase: 'submitting',
        generationStartedAt: startedAt,
        generationDurationMs,
        generationSummary: {
          sourceType: 'imageEdit',
          providerId: selectedImageModel.providerId,
          requestModel: requestResolution.requestModel,
          prompt,
          generatedAt: null,
        },
        generationError: null,
      } as Partial<CanvasNodeData>);
    }

    setStatusText(t('commerceAd.agent.statusSubmitting'));
    await canvasAiGateway.setApiKey(selectedImageModel.providerId, providerApiKey);
    try {
      const resolvedPayload = await canvasAiGateway.resolveGenerateImagePayload({
        prompt,
        model: requestResolution.requestModel,
        size: selectedResolution.value,
        aspectRatio: imageRecord.aspectRatio,
        referenceImages,
      });
      const jobId = await canvasAiGateway.submitGenerateImageJob(resolvedPayload);
      if (resultNodeId) {
        updateNodeData(resultNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: 'queued',
          generationStartedAt: startedAt,
          generationSourceType: 'imageEdit',
          generationProviderId: selectedImageModel.providerId,
          generationError: null,
        } as Partial<CanvasNodeData>);
      }
      updateResultImage({
        status: 'running',
        error: null,
        nodeId: resultNodeId ?? null,
      });
      setStatusText(t('commerceAd.agent.retrySubmitted'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (resultNodeId) {
        updateNodeData(resultNodeId, {
          isGenerating: false,
          generationPhase: 'failed',
          generationError: message,
        } as Partial<CanvasNodeData>);
      }
      updateResultImage({
        status: 'failed',
        error: message,
        nodeId: resultNodeId ?? null,
      });
      setStatusText(t('commerceAd.agent.statusFailed'));
    }
  }, [
    applyActions,
    productReferenceImages,
    resultNode?.data.batches,
    selectedImageModel,
    selectedResolution.value,
    settings.storyboardApiKeys,
    t,
    updateNodeData,
  ]);

  useEffect(() => {
    const handleStartImageGeneration = () => {
      void handleGenerate();
    };
    window.addEventListener(COMMERCE_START_IMAGE_GENERATION_EVENT, handleStartImageGeneration);
    return () => {
      window.removeEventListener(COMMERCE_START_IMAGE_GENERATION_EVENT, handleStartImageGeneration);
    };
  }, [handleGenerate]);

  useEffect(() => {
    const handleStartAgentPlanGeneration = (event: Event) => {
      const detail = (event as CustomEvent<{ planNodeId?: string }>).detail;
      if (!detail?.planNodeId) {
        return;
      }
      void handleGenerateFromAgentPlan(detail.planNodeId);
    };
    window.addEventListener(COMMERCE_START_AGENT_PLAN_GENERATION_EVENT, handleStartAgentPlanGeneration);
    return () => {
      window.removeEventListener(COMMERCE_START_AGENT_PLAN_GENERATION_EVENT, handleStartAgentPlanGeneration);
    };
  }, [handleGenerateFromAgentPlan]);

  useEffect(() => {
    const handleRetryImageGeneration = (event: Event) => {
      const detail = (event as CustomEvent<{ batchId?: string; imageId?: string }>).detail;
      if (!detail?.batchId || !detail.imageId) {
        return;
      }
      void handleRetryGeneratedImage(detail.batchId, detail.imageId);
    };
    window.addEventListener(COMMERCE_RETRY_IMAGE_GENERATION_EVENT, handleRetryImageGeneration);
    return () => {
      window.removeEventListener(COMMERCE_RETRY_IMAGE_GENERATION_EVENT, handleRetryImageGeneration);
    };
  }, [handleRetryGeneratedImage]);

  useEffect(() => {
    const handleSyncDownstream = () => {
      const product = productNode?.data ?? null;
      if (!product && productImages.length === 0) {
        setStatusText(t('commerceAd.agent.needProductReferenceBeforeGenerate'));
        return;
      }
      void runAgent(
        composeProductUserInfo(
          product?.lockedDocumentInfo ?? lockedDocumentInfo,
          product?.userIdeaInfo ?? product?.userInfo ?? userIdeaInfo
        ),
        product ?? undefined,
        visualPreferenceNode?.data ?? visualPreferenceDraft,
        'syncProductInfo',
        { hideUserMessage: true }
      );
    };
    window.addEventListener(COMMERCE_SYNC_DOWNSTREAM_EVENT, handleSyncDownstream);
    return () => {
      window.removeEventListener(COMMERCE_SYNC_DOWNSTREAM_EVENT, handleSyncDownstream);
    };
  }, [
    lockedDocumentInfo,
    productImages.length,
    productNode?.data,
    runAgent,
    t,
    userIdeaInfo,
    visualPreferenceDraft,
    visualPreferenceNode?.data,
  ]);

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    const selectedSkill = availableSkills.find((skill) => skill.id === selectedSkillId) ?? null;
    if (isThinking || (!text && chatImages.length === 0 && !selectedSkill)) {
      return;
    }
    const submittedImages = chatImages;
    const priorContext = collectConversationContext(messages);
    const contextImages = normalizeProductImageRoles([
      ...priorContext.images,
      ...submittedImages,
    ]).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const skillContext = selectedSkill
      ? `已选择技能：${selectedSkill.title}\n技能目标：${selectedSkill.description}`
      : '';
    const submittedText = text || selectedSkill?.title || '';
    const combinedText = [priorContext.text, skillContext, submittedText].filter(Boolean).join('\n');
    const deterministicSlotPatch = extractConfirmedSlotsFromText(text, selectedSkill);
    const turnIntent = inferAdAgentTurnIntent({
      text,
      hasNewImages: submittedImages.length > 0,
      state: agentThreadState,
    });
    const threadStateForTurn = mergeAgentThreadState(agentThreadState, {
      phase: turnIntent === 'revise' ? 'refining' : agentThreadState.phase,
      confirmedSlots: deterministicSlotPatch,
      skillId: selectedSkill?.id ?? agentThreadState.skillId,
    }, selectedSkill);
    const assistantMessageId = `commerce-agent-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const streamRequestId = `commerce-agent-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft('');
    setChatImages([]);
    setSelectedGuidanceChoiceKeys([]);
    enqueueThinkingPreviewText(
      assistantMessageId,
      t('commerceAd.agentPlan.thinkingPreviewImage'),
      true
    );
    void (async () => {
      const nextUserMessage = text || selectedSkill?.title || t('commerceAd.agentPlan.imageOnlyPrompt');
      setMessages((items) => [
        ...items,
        createLocalMessage('user', nextUserMessage, {
          images: submittedImages,
        }),
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'streaming',
          phase: 'image_analysis',
        },
      ]);
      setIsThinking(true);
      setActiveAgentTask('chat');
      setStatusText(t('commerceAd.agentPlan.statusThinking'));
      activeCommerceStreamRequestIdRef.current = streamRequestId;
      try {
        const product = createDefaultCommerceAdProductState();
        product.images = contextImages;
        product.userInfo = combinedText;
        product.userIdeaInfo = combinedText;
        const currentBriefForTurn = briefNode?.data ?? (
          agentPlanNode?.data
            ? {
                usage: '',
                platform: agentPlanNode.data.creativeDirection,
                audience: '',
                style: agentPlanNode.data.creativeDirection,
                headline: agentPlanNode.data.summary,
                sellingPoints: [],
                cta: '',
                mustInclude: '',
                constraints: agentPlanNode.data.riskNotes.join('\n'),
                normalizedBrief: agentPlanNode.data.summary,
                optimizedUserIdeaInfo: agentPlanNode.data.productUnderstanding,
                detailPages: [],
                qualityCheckSummary: '',
                qualityIssues: agentPlanNode.data.riskNotes,
                updatedAt: null,
              } satisfies CommerceAdBriefState
            : null
        );
        const currentVisualPreferenceForTurn = visualPreferenceNode?.data ?? createDefaultCommerceAdVisualPreferenceState();
        const currentBatchForTurn = batchNode?.data ?? (
          agentPlanNode?.data
            ? {
                generationMode: 'legacyRatios' as const,
                aspectRatios: agentPlanNode.data.aspectRatios,
                variantsPerRatio: agentPlanNode.data.variantsPerRatio,
                batchCount: agentPlanNode.data.batchCount,
                modelId: agentPlanNode.data.modelId,
                size: agentPlanNode.data.size,
                corePrompt: agentPlanNode.data.prompt,
                ratioPrompts: {},
                detailPages: [],
                detailPageIds: [],
                detailPageCount: 0,
                stylePromptFragment: '',
                status: agentPlanNode.data.status === 'failed' ? 'failed' : agentPlanNode.data.prompt ? 'ready' : 'idle',
                lastGeneratedAt: null,
                lastError: agentPlanNode.data.lastError,
              } satisfies CommerceAdBatchGenerateState
            : null
        );
        const referenceImagesForTurn = submittedImages.length > 0 || !threadStateForTurn.imageAnalysis
          ? dedupeStrings(contextImages.map((image) => image.imageUrl))
          : [];
        const turnInput = {
          userMessage: [skillContext, text || nextUserMessage].filter(Boolean).join('\n\n'),
          conversationSummary: priorContext.text,
          product,
          brief: currentBriefForTurn,
          visualPreference: currentVisualPreferenceForTurn,
          batch: currentBatchForTurn,
          referenceImages: referenceImagesForTurn,
          canUseVisionModel: true,
          selectedSkill,
          threadState: threadStateForTurn,
          turnIntent,
        };
        let hasVisibleAnswerText = false;
        const thinkingStageTimers = [
          window.setTimeout(() => {
            enqueueThinkingPreviewText(
              assistantMessageId,
              t('commerceAd.agentPlan.thinkingPreviewSkill'),
              true
            );
          }, 1600),
          window.setTimeout(() => {
            enqueueThinkingPreviewText(
              assistantMessageId,
              t('commerceAd.agentPlan.thinkingPreviewStructure'),
              true
            );
          }, 3600),
        ];
        const waitForStream = new Promise<void>((resolve, reject) => {
          void listenCommerceAdAgentStream((event: CommerceAdAgentStreamEvent) => {
            if (event.requestId !== streamRequestId) {
              return;
            }
            if (event.type === 'phase_changed') {
              const statusMessage = /token|流式|分段输出/i.test(event.message)
                ? t('commerceAd.agentPlan.statusThinking')
                : event.message;
              setStatusText(statusMessage);
              setMessages((items) => items.map((message) => (
                message.id === assistantMessageId
                  ? { ...message, phase: event.phase }
                  : message
              )));
            }
            if (event.type === 'text_delta') {
              if (event.delta.trim()) {
                hasVisibleAnswerText = true;
                clearThinkingTypewriter(assistantMessageId);
                setThinkingPreviewByMessageId((items) => {
                  const next = { ...items };
                  delete next[assistantMessageId];
                  return next;
                });
                enqueueAssistantMessageText(assistantMessageId, event.delta);
              }
            }
            if (event.type === 'message_completed') {
              if (!hasVisibleAnswerText) {
                enqueueThinkingPreviewText(
                  assistantMessageId,
                  t('commerceAd.agentPlan.thinkingPreviewStructure'),
                  true
                );
              }
              setMessages((items) => items.map((message) => (
                message.id === assistantMessageId
                  ? { ...message, status: 'streaming', phase: 'finalizing' }
                  : message
              )));
              resolve();
            }
            if (event.type === 'stream_cancelled') {
              resolve();
            }
            if (event.type === 'stream_failed') {
              setStatusText(t('commerceAd.agentPlan.statusThinking'));
              reject(new Error(event.message));
            }
          }).then((unlisten) => {
            const cleanup = () => window.setTimeout(() => unlisten(), 1000);
            waitForStream.then(cleanup, cleanup);
          }).catch(reject);
        });
        try {
          await startCommerceAdAgentStream({
            requestId: streamRequestId,
            prompt: buildCommerceAdAgentVisiblePrompt(turnInput),
            temperature: 0.35,
            maxTokens: 1200,
            referenceImages: turnInput.canUseVisionModel ? turnInput.referenceImages : [],
          });
          await waitForStream;
        } catch (streamError) {
          console.warn('[CommerceAdAgent] visible stream failed', streamError);
        } finally {
          thinkingStageTimers.forEach((timer) => window.clearTimeout(timer));
        }
        const isExplorationTurn =
          turnIntent === 'initial'
          && threadStateForTurn.planVersion === 0
          && !hasSlotValue(threadStateForTurn.confirmedSlots.visualDirection);
        const structuredProgressSteps = isExplorationTurn
          ? [
              t('commerceAd.agentPlan.structuredProgressImage'),
              t('commerceAd.agentPlan.structuredProgressConfirmed'),
              t('commerceAd.agentPlan.structuredProgressDirections'),
              t('commerceAd.agentPlan.structuredProgressOptions'),
            ]
          : [
              t('commerceAd.agentPlan.structuredProgressConfirmed'),
              t('commerceAd.agentPlan.structuredProgressPlan'),
              t('commerceAd.agentPlan.structuredProgressOptions'),
            ];
        const structuredProgressTimers = structuredProgressSteps.map((step, index) => (
          window.setTimeout(() => {
            setStructuredProgressByMessageId((items) => {
              const existing = items[assistantMessageId] ?? [];
              if (existing.includes(step)) {
                return items;
              }
              return {
                ...items,
                [assistantMessageId]: [...existing, step],
              };
            });
          }, index * 650)
        ));
        const agentResult = await runCommerceAdAgentTurn({
          ...turnInput,
        });
        structuredProgressTimers.forEach((timer) => window.clearTimeout(timer));
        const isOneShotExplorationTurn = isOneShotCreativeExplorationRequest(text);
        const agentThreadPatchForTurn = isOneShotExplorationTurn
          ? {
              ...(agentResult.threadStatePatch ?? {}),
              confirmedSlots: {},
              missingSlots: threadStateForTurn.missingSlots,
              phase: threadStateForTurn.phase,
            }
          : agentResult.threadStatePatch;
        const nextAction = resolveAgentNextAction(agentResult.nextAction, {
          ...threadStateForTurn,
          ...(agentThreadPatchForTurn ?? {}),
          confirmedSlots: {
            ...threadStateForTurn.confirmedSlots,
            ...(agentThreadPatchForTurn?.confirmedSlots ?? {}),
          },
        }, selectedSkill);
        const nextAgentThreadState = mergeAgentThreadState(threadStateForTurn, {
          ...(agentThreadPatchForTurn ?? {}),
          imageAnalysis: agentResult.assistantMessage.imageAnalysis
            ?? threadStateForTurn.imageAnalysis,
          lastAskedFields: agentThreadPatchForTurn?.lastAskedFields
            ?? threadStateForTurn.lastAskedFields,
          planVersion: (
            isOneShotExplorationTurn
          )
            ? threadStateForTurn.planVersion
            : (
            nextAction === 'plan'
            || nextAction === 'ready'
            || nextAction === 'generate'
          )
            ? threadStateForTurn.planVersion + 1
            : agentThreadPatchForTurn?.planVersion ?? threadStateForTurn.planVersion,
        }, selectedSkill);
        const normalizedGuidance = normalizeAgentGuidanceForState(
          agentResult.assistantMessage.guidance,
          nextAgentThreadState,
          selectedSkill,
          nextAction,
          text
        );
        const askedFieldIds = normalizedGuidance?.questions.map((question) => question.id);
        const visibleGuidanceKind = normalizedGuidance?.designDirections.length
          ? normalizedGuidance.guidanceKind
          : undefined;
        const trackedGuidanceKind = visibleGuidanceKind
          ?? (normalizedGuidance?.questions.length || normalizedGuidance?.missingFields.length
            ? normalizedGuidance.guidanceKind
            : undefined);
        const finalAgentThreadState = {
          ...nextAgentThreadState,
          ...(askedFieldIds && askedFieldIds.length > 0 ? { lastAskedFields: askedFieldIds } : {}),
          ...(trackedGuidanceKind
            ? {
                guidanceRound: visibleGuidanceKind && !isOneShotExplorationTurn
                  ? nextAgentThreadState.guidanceRound + 1
                  : nextAgentThreadState.guidanceRound,
                shownGuidanceKinds: isOneShotExplorationTurn
                  ? nextAgentThreadState.shownGuidanceKinds
                  : Array.from(new Set([
                      ...nextAgentThreadState.shownGuidanceKinds,
                      trackedGuidanceKind,
                    ])),
                lastGuidanceAtPlanVersion: isOneShotExplorationTurn
                  ? nextAgentThreadState.lastGuidanceAtPlanVersion
                  : nextAgentThreadState.planVersion,
              }
            : {}),
        };
        setMessages((items) => items.map((message) => (
          message.id === assistantMessageId
            ? {
                ...message,
                guidance: normalizedGuidance,
                imageAnalysis: turnIntent === 'initial' || turnIntent === 'new_image'
                  ? agentResult.assistantMessage.imageAnalysis
                  : undefined,
                status: 'done',
                phase: 'finalizing',
              }
            : message
        )));
        setStructuredProgressByMessageId((items) => {
          const next = { ...items };
          delete next[assistantMessageId];
          return next;
        });
        if (!hasVisibleAnswerText) {
          enqueueAssistantMessageText(assistantMessageId, agentResult.assistantMessage.content, true);
        }
        setAgentThreadState(finalAgentThreadState);
        clearThinkingTypewriter(assistantMessageId);
        setThinkingPreviewByMessageId((items) => {
          const next = { ...items };
          delete next[assistantMessageId];
          return next;
        });
        const shouldCreateOrUpdatePlan =
          !isOneShotExplorationTurn
          && (
            nextAction === 'ready'
            || nextAction === 'plan'
            || nextAction === 'generate'
            || Boolean(agentPlanNode?.data?.agentThreadId === activeThreadId)
          );
        if (shouldCreateOrUpdatePlan) {
          setStatusText(t('commerceAd.agentPlan.thinkingStepPlan'));
          const fallbackImageModel = getImageModel(
            COMMERCE_DEFAULT_IMAGE_MODEL_ID,
            settings.storyboardCompatibleModelConfig,
            settings.storyboardNewApiModelConfig,
            settings.storyboardApi2OkModelConfig,
            settings.storyboardProviderCustomModels
          );
          const planState = composeAgentPlanState({
            text: combinedText,
            images: contextImages,
            previousPlan: agentPlanNode?.data ?? null,
            selectedSkillId,
            agentThreadId: activeThreadId,
            confirmedSlots: finalAgentThreadState.confirmedSlots,
            resultActions: agentResult.actions,
            fallbackModelId: COMMERCE_DEFAULT_IMAGE_MODEL_ID,
            fallbackProviderId: fallbackImageModel.providerId,
            fallbackSize: COMMERCE_DEFAULT_RESOLUTION,
            fallbackRatios: ['4:5'],
            fallbackModel: fallbackImageModel,
          });
          upsertAgentPlanNode(planState);
          setStatusText(t('commerceAd.agentPlan.statusPlanCreated'));
        } else {
          setStatusText(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clearThinkingTypewriter(assistantMessageId);
        clearMessageTypewriter(assistantMessageId);
        setStructuredProgressByMessageId((items) => {
          const next = { ...items };
          delete next[assistantMessageId];
          return next;
        });
        setThinkingPreviewByMessageId((items) => {
          const next = { ...items };
          delete next[assistantMessageId];
          return next;
        });
        setMessages((items) => items.map((item) => (
          item.id === assistantMessageId
            ? {
                ...item,
                content: t('commerceAd.agent.errorMessage', { message }),
                status: 'failed',
              }
            : item
        )));
        setStatusText(t('commerceAd.agentPlan.statusFailed'));
      } finally {
        activeCommerceStreamRequestIdRef.current = null;
        setIsThinking(false);
        setActiveAgentTask(null);
        setChatImages([]);
      }
    })();
  }, [
    chatImages,
    draft,
    availableSkills,
    agentPlanNode?.data,
    agentThreadState,
    clearMessageTypewriter,
    clearThinkingTypewriter,
    enqueueAssistantMessageText,
    enqueueThinkingPreviewText,
    isThinking,
    messages,
    selectedSkillId,
    settings.storyboardApi2OkModelConfig,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardProviderCustomModels,
    t,
    upsertAgentPlanNode,
  ]);

  const handleChatDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsChatDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      void addChatImagesFromFiles(files);
    }
  }, [addChatImagesFromFiles]);

  const handleChatDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsChatDragActive(true);
  }, []);

  const handleChatDragLeave = useCallback(() => {
    setIsChatDragActive(false);
  }, []);

  useEffect(() => {
    return () => {
      const requestId = activeCommerceStreamRequestIdRef.current;
      if (requestId) {
        void cancelCommerceAdAgentStream(requestId);
        activeCommerceStreamRequestIdRef.current = null;
      }
      clearThinkingTypewriter();
      clearMessageTypewriter();
    };
  }, [clearMessageTypewriter, clearThinkingTypewriter]);

  const isSyncProductInfoRunning = activeAgentTask === 'syncProductInfo';
  const isChatRunning = activeAgentTask === 'chat';

  return (
    <div className="flex h-full min-h-0 w-full bg-bg-base">
      <div className="relative min-w-0 flex-1">
        <Canvas />
        <CommerceAgentModuleSwitcher
          activeModule={activeModule}
          onChange={(moduleId) => {
            setActiveModule(moduleId);
            if (moduleId === 'detailPage') {
              setIsDetailSetupOpen(true);
            }
          }}
        />
        {shouldShowVisionWarning ? (
          <VisionModelWarningBar
            isOpen={isVisionWarningOpen}
            onToggle={() => setIsVisionWarningOpen((open) => !open)}
            onOpenSettings={() => openSettingsDialog({ category: 'providers' })}
          />
        ) : null}
      </div>
      <aside
        className="relative flex h-full shrink-0 flex-col border-l border-border-dark/70 bg-surface-dark/95 shadow-2xl"
        style={{ width: agentPanelWidth }}
      >
        <div
          className="absolute bottom-0 left-0 top-0 z-20 w-1 cursor-col-resize transition hover:bg-accent/35"
          onPointerDown={handleAgentPanelResizeStart}
          aria-hidden="true"
        />
        <div className="relative z-10 flex items-center gap-2 border-b border-border-dark/70 px-3 py-2.5">
          <div
            className="min-w-0 flex-1 truncate text-sm font-semibold text-text-dark"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition hover:bg-text-dark/[0.08] hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-45"
            onClick={handleCreateNewThread}
            disabled={isThinking}
            aria-label={t('commerceAd.agent.newChat')}
            title={t('commerceAd.agent.newChat')}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${
                isThreadHistoryOpen
                  ? 'bg-text-dark/[0.10] text-text-dark'
                  : 'text-text-muted hover:bg-text-dark/[0.08] hover:text-text-dark'
              }`}
              onClick={() => setIsThreadHistoryOpen((open) => !open)}
              disabled={isThinking}
              aria-label={t('commerceAd.agent.chatHistory')}
              title={t('commerceAd.agent.chatHistory')}
            >
              <History className="h-4 w-4" />
            </button>
            {isThreadHistoryOpen ? (
              <div className="absolute right-0 top-10 z-40 w-[min(340px,calc(100vw-36px))] overflow-hidden rounded-2xl border border-border-dark/70 bg-surface-dark shadow-[0_18px_48px_rgba(0,0,0,0.40)]">
                <div className="border-b border-border-dark/60 px-4 pb-3 pt-3">
                  <div className="text-sm font-semibold text-text-dark">
                    {t('commerceAd.agent.chatHistory')}
                  </div>
                  <div className="relative mt-3">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <input
                      value={threadSearchQuery}
                      onChange={(event) => setThreadSearchQuery(event.target.value)}
                      className="h-9 w-full rounded-lg border border-border-dark/70 bg-bg-dark/75 pl-9 pr-3 text-sm text-text-dark outline-none transition placeholder:text-text-muted focus:border-accent/50"
                      placeholder={t('commerceAd.agent.historySearchPlaceholder')}
                    />
                  </div>
                </div>
                <div className="ui-scrollbar max-h-[420px] overflow-y-auto p-2">
                  {filteredThreadSummaries.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-text-muted">
                      {t('commerceAd.agent.emptyHistory')}
                    </div>
                  ) : filteredThreadSummaries.map((thread) => {
                    const isActive = thread.threadId === activeThreadId;
                    return (
                      <div
                        key={thread.threadId}
                        className={`group flex w-full items-center gap-2 rounded-xl border px-2 py-2 transition ${
                          isActive
                            ? 'border-accent bg-bg-dark text-text-dark'
                            : 'border-transparent text-text-muted hover:border-border-dark/70 hover:bg-bg-dark hover:text-text-dark'
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => handleSelectThread(thread.threadId)}
                        >
                          <span className="flex w-full items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {thread.title || t('commerceAd.agent.untitledChat')}
                            </span>
                          </span>
                          <span className="mt-1 block w-full truncate text-xs text-text-muted">
                            {new Date(thread.updatedAt || thread.createdAt || Date.now()).toLocaleString()}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted opacity-80 transition hover:bg-text-dark/10 hover:text-text-dark disabled:pointer-events-none disabled:opacity-35"
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                          disabled={isThinking}
                          onClick={(event) => handleDeleteThread(thread.threadId, event)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="ui-scrollbar flex-1 overflow-y-auto px-4 pb-4">
          <section
            key={newThreadAnimationKey}
            className="animate-in fade-in slide-in-from-bottom-1 duration-200 space-y-2 pt-4"
          >
            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className={message.role === 'user'
                  ? 'rounded-lg border border-text-dark/10 bg-text-dark/[0.08] px-3 py-2 text-sm leading-6 text-text-dark'
                  : 'px-1 py-2 text-sm leading-6 text-text-dark/90'}
              >
                {message.content ? (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                ) : message.status === 'streaming' ? (
                  <ThinkingPreviewBubble
                    text={thinkingPreviewByMessageId[message.id]}
                    fallback={t('commerceAd.agentPlan.thinkingPreviewImage')}
                  />
                ) : thinkingPreviewByMessageId[message.id] ? (
                  <ThinkingPreviewBubble
                    text={thinkingPreviewByMessageId[message.id]}
                    fallback={t('commerceAd.agentPlan.thinkingPreviewImage')}
                  />
                ) : null}
                {message.images?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.images.map((image) => (
                      <div
                        key={image.id}
                        className="h-14 w-14 overflow-hidden rounded-lg bg-bg-dark"
                        title={image.label}
                      >
                        <img
                          src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                          alt={image.label}
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.imageAnalysis ? (
                  <ImageAnalysisDisclosure analysis={message.imageAnalysis} />
                ) : structuredProgressByMessageId[message.id]?.length ? (
                  <PendingImageAnalysisDisclosure />
                ) : null}
                {structuredProgressByMessageId[message.id]?.length ? (
                  <StructuredAnalysisProgress steps={structuredProgressByMessageId[message.id]} />
                ) : null}
                {message.guidance ? (
                  <DecisionPanel
                    messageId={message.id}
                    guidance={message.guidance}
                    selectedChoiceKeys={selectedGuidanceChoiceKeys}
                    onToggleChoice={handleToggleGuidanceChoice}
                  />
                ) : null}
              </div>
            ))}
          </section>
        </div>

        <div
          className="border-t border-border-dark/70 p-3"
          onDragOver={handleChatDragOver}
          onDragLeave={handleChatDragLeave}
          onDrop={handleChatDrop}
        >
          {statusText && !isChatRunning ? (
            <div className="mb-2 text-xs text-text-muted">{statusText}</div>
          ) : null}
          <div
            className={`relative rounded-[22px] border bg-bg-dark/85 p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.22)] transition-colors ${
              isChatDragActive
                ? 'border-text-dark/35 bg-text-dark/[0.05]'
                : 'border-border-dark/70'
            }`}
          >
            {isChatDragActive ? (
              <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[18px] border border-dashed border-text-dark/30 bg-bg-dark/85 text-xs font-medium text-text-dark">
                {t('commerceAd.agent.chatDropHint')}
              </div>
            ) : null}
            {chatImages.length > 0 ? (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {chatImages.map((image) => (
                  <div key={image.id} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border-dark/70 bg-surface-dark">
                    <img
                      src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                      alt={image.label}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    <button
                      type="button"
                      className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black"
                      onClick={() => handleRemoveChatImage(image.id)}
                      aria-label={t('commerceAd.agent.removeChatImage')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <UiTextAreaField
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              className="min-h-[78px] !border-transparent !bg-transparent px-1 py-1 text-sm leading-6 shadow-none focus:!border-transparent"
              placeholder={t('commerceAd.agent.chatPlaceholder')}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                  return;
                }
                if (event.ctrlKey) {
                  return;
                }
                if (!event.shiftKey && !event.altKey && !event.metaKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              onPaste={handleChatPaste}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <label
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition hover:bg-text-dark/[0.08] hover:text-text-dark ${
                    uploading || isThinking ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                  }`}
                  aria-label={t('commerceAd.agent.upload')}
                  title={t('commerceAd.agent.upload')}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  <input
                    ref={chatImageFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={handleChatImageInputChange}
                    disabled={uploading || isThinking}
                  />
                </label>
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                    isSkillPickerOpen
                      ? 'bg-text-dark/[0.10] text-text-dark'
                      : 'text-text-muted hover:bg-text-dark/[0.08] hover:text-text-dark'
                  }`}
                  onClick={() => setIsSkillPickerOpen((open) => !open)}
                  aria-label={t('commerceAd.agent.skills')}
                  title={t('commerceAd.agent.skills')}
                >
                  <BookOpen className="h-4 w-4" />
                </button>
                {selectedSkill ? (
                  <span className="inline-flex max-w-[150px] items-center rounded-full border border-text-dark/15 bg-text-dark/[0.08] pl-2.5 pr-1 text-xs font-medium text-text-dark">
                    <button
                      type="button"
                      className="min-w-0 truncate py-1"
                      onClick={() => setIsSkillPickerOpen((open) => !open)}
                      title={selectedSkill.title}
                    >
                      {selectedSkill.title}
                    </button>
                    <button
                      type="button"
                      className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-text-dark/[0.10] hover:text-text-dark"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedSkillId('');
                      }}
                      aria-label={t('commerceAd.agent.clearSkill')}
                      title={t('commerceAd.agent.clearSkill')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#222222] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-45 dark:bg-text-dark dark:text-bg-dark dark:hover:bg-white"
                onClick={handleSubmit}
                disabled={isThinking || (!draft.trim() && chatImages.length === 0 && !selectedSkill)}
                aria-label={t('commerceAd.agent.send')}
                title={t('commerceAd.agent.send')}
              >
                {isChatRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {isSkillPickerOpen ? (
              <div className="absolute bottom-[52px] left-0 right-4 z-20 overflow-hidden rounded-2xl border border-border-dark/70 bg-surface-dark shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
                <div className="px-4 pb-2 pt-3 text-sm font-semibold text-text-dark">
                  {t('commerceAd.agent.skills')}
                </div>
                <div className="ui-scrollbar flex gap-2 overflow-x-auto border-b border-border-dark/60 px-3 pb-3">
                  <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-text-dark/20 bg-text-dark/[0.08] px-3 text-xs font-medium text-text-dark"
                  >
                    <PanelTop className="h-3.5 w-3.5" />
                    {t('commerceAd.agent.skillCategories.ad')}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border-dark/70 bg-bg-dark/70 px-3 text-xs text-text-muted"
                    disabled
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    {t('commerceAd.agent.skillCategories.social')}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border-dark/70 bg-bg-dark/70 px-3 text-xs text-text-muted"
                    disabled
                  >
                    <PackageCheck className="h-3.5 w-3.5" />
                    {t('commerceAd.agent.skillCategories.ecommerce')}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border-dark/70 bg-bg-dark/70 px-3 text-xs text-text-muted"
                    disabled
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('commerceAd.agent.skillCategories.branding')}
                  </button>
                </div>
                <div className="ui-scrollbar max-h-[360px] space-y-1 overflow-y-auto p-3">
                  {availableSkills.map((skill) => {
                    const isSelected = skill.id === selectedSkillId;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                          isSelected
                            ? 'border-text-dark/25 bg-bg-dark text-text-dark'
                            : 'border-transparent bg-surface-dark text-text-muted hover:border-border-dark/70 hover:bg-bg-dark hover:text-text-dark'
                        }`}
                        onClick={() => {
                          setSelectedSkillId(skill.id);
                          setIsSkillPickerOpen(false);
                        }}
                      >
                        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                          isSelected
                            ? 'bg-text-dark text-bg-dark'
                            : 'bg-bg-dark text-accent'
                        }`}>
                          <Megaphone className="h-4.5 w-4.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {skill.title}
                            {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                          </span>
                          <span className="mt-1 block truncate text-xs leading-5 text-text-muted">
                            {skill.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
      <CommerceDetailPageSetupModal
        isOpen={isDetailSetupOpen}
        onClose={() => setIsDetailSetupOpen(false)}
        activeModuleTitle={t('commerceAd.agent.modules.detailPage.title')}
        productImages={productImages}
        isProductImageLimitReached={isProductImageLimitReached}
        uploading={uploading}
        isThinking={isThinking}
        isSyncProductInfoRunning={isSyncProductInfoRunning}
        isProductInfoCollapsed={isProductInfoCollapsed}
        isVisualPreferenceCollapsed={isVisualPreferenceCollapsed}
        isBatchSettingsCollapsed={isBatchSettingsCollapsed}
        detailInputMode={detailInputMode}
        lockedDocumentInfo={lockedDocumentInfo}
        userIdeaInfo={userIdeaInfo}
        detailPages={detailPages}
        hasManualPageLockedInfo={hasManualPageLockedInfo}
        hasResolvedProductInfo={hasResolvedProductInfo}
        visualPreferenceDraft={visualPreferenceDraft}
        visualPreferenceSummary={visualPreferenceSummary}
        imageProviderOptions={imageProviderOptions}
        selectedImageModel={selectedImageModel}
        selectedProviderImageModels={selectedProviderImageModels}
        selectedResolution={selectedResolution}
        resolutionOptions={resolutionOptions}
        ratioOptions={ratioOptions}
        currentRatios={currentRatios}
        currentVariantsPerRatio={currentVariantsPerRatio}
        currentBatchCount={currentBatchCount}
        canCreateDetailPageBatch={canCreateDetailPageBatch}
        productionSummary={productionSummary}
        detailPageCount={detailPageCount}
        plannedImageCount={plannedImageCount}
        fileInputRef={fileInputRef}
        replaceFileInputRef={replaceFileInputRef}
        userIdeaInfoRef={userIdeaInfoRef}
        productInfoContentRef={productInfoContentRef}
        visualPreferenceContentRef={visualPreferenceContentRef}
        batchSettingsContentRef={batchSettingsContentRef}
        onFilesSelected={handleFilesSelected}
        onReplaceProductImageSelected={handleReplaceProductImageSelected}
        onUploadClick={handleUploadClick}
        onReplaceProductImageClick={handleReplaceProductImageClick}
        onDeleteProductImage={handleDeleteProductImage}
        onUpdateProductImageDescription={handleUpdateProductImageDescription}
        onToggleProductInfoCollapsed={toggleProductInfoCollapsed}
        onToggleVisualPreferenceCollapsed={toggleVisualPreferenceCollapsed}
        onToggleBatchSettingsCollapsed={toggleBatchSettingsCollapsed}
        onDetailInputModeChange={(mode) => {
          setDetailInputMode(mode);
          if (productNode) {
            updateNodeData(productNode.id, { detailInputMode: mode } as Partial<CanvasNodeData>);
          }
        }}
        onLockedDocumentInfoChange={setLockedDocumentInfo}
        onUserIdeaInfoChange={setUserIdeaInfo}
        onAddDetailPage={handleAddDetailPage}
        onDeleteDetailPage={handleDeleteDetailPage}
        onMoveDetailPage={handleMoveDetailPage}
        onUpdateDetailPage={handleUpdateDetailPage}
        onUpdateVisualPreference={updateVisualPreferenceDraft}
        onImageProviderChange={handleImageProviderChange}
        onImageModelChange={handleImageModelChange}
        onTogglePageRatio={togglePageRatio}
        onUpdateBatchConfig={updateBatchConfig}
        onGenerateNodeInfo={handleGenerateNodeInfo}
      />
    </div>
  );
}

export function CommerceAdProjectWorkspace() {
  return (
    <ReactFlowProvider>
      <CommerceAdWorkspaceInner />
    </ReactFlowProvider>
  );
}
