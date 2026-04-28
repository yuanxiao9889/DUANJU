import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { Loader2, Settings2, Sparkles, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiSelect, UiTextArea } from '@/components/ui';
import { generateText } from '@/commands/textGen';
import { resolveConnectedCanvasText } from '@/features/canvas/application/connectedText';
import {
  CANVAS_NODE_TYPES,
  LLM_LOGIC_NODE_DEFAULT_HEIGHT,
  LLM_LOGIC_NODE_DEFAULT_WIDTH,
  TTS_TEXT_NODE_DEFAULT_HEIGHT,
  TTS_TEXT_NODE_DEFAULT_WIDTH,
  type LlmLogicPresetCategoryKey,
  type LlmLogicPresetKey,
  type LlmLogicNodeData,
  type TextAnnotationGenerationSource,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
  resolveScriptModelOptions,
} from '@/features/canvas/models';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type LlmLogicNodeProps = NodeProps & {
  id: string;
  data: LlmLogicNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const MIN_WIDTH = 360;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 760;
const MAX_HEIGHT = 960;

const PRESET_CATEGORY_BY_KEY: Record<LlmLogicPresetKey, LlmLogicPresetCategoryKey> = {
  generalPolish: 'writing',
  spokenNatural: 'voice',
  clarity: 'writing',
  voiceSeparation: 'voice',
  cinematicImagery: 'screen',
  rhythmPause: 'voice',
  emotionProgression: 'screen',
  subtext: 'screen',
  dialogueTension: 'screen',
  dubbingReadability: 'voice',
};

const LLM_PRESET_CATEGORIES: ReadonlyArray<{
  key: LlmLogicPresetCategoryKey;
  instruction: string;
}> = [
  {
    key: 'voice',
    instruction:
      '本次优化重点放在语音表达上，让文本更适合开口说、更顺口、更有语气和朗读节奏。',
  },
  {
    key: 'screen',
    instruction:
      '本次优化重点放在影视画面感上，增强镜头感、氛围感和视觉化表达，但不要凭空新增剧情事实。',
  },
  {
    key: 'writing',
    instruction:
      '本次优化重点放在文本表达上，提升整体润色感、清晰度和完成度，让文本更成熟。',
  },
];

const LLM_PRESET_OPTIONS: ReadonlyArray<{
  categoryKey: LlmLogicPresetCategoryKey;
  key: LlmLogicPresetKey;
  instruction: string;
}> = [
  {
    categoryKey: 'writing',
    key: 'generalPolish',
    instruction:
      '在不改变原意、人物关系、关键信息和结构主干的前提下，整体润色这段文本，让表达更自然、顺口、清晰，更适合直接用于对白、旁白或配音录制。',
  },
  {
    categoryKey: 'writing',
    key: 'clarity',
    instruction:
      '本次重点优化表达清晰度，整理语序和信息重心，让句子更易懂、更顺畅，但不要删掉关键信息。',
  },
  {
    categoryKey: 'voice',
    key: 'spokenNatural',
    instruction:
      '本次重点优化口语自然度，让句子更像真实的人在说话，减少生硬、书面化和模板化表达。',
  },
  {
    categoryKey: 'voice',
    key: 'voiceSeparation',
    instruction:
      '本次重点优化人物语气区分，让不同角色或不同段落的说话方式更有辨识度，但不要新增人物设定。',
  },
  {
    categoryKey: 'voice',
    key: 'rhythmPause',
    instruction:
      '本次重点优化节奏停顿，调整断句、换气和轻重缓急，让文本读起来更有停顿感和层次感。',
  },
  {
    categoryKey: 'voice',
    key: 'dubbingReadability',
    instruction:
      '本次重点优化可配音朗读性，让文本更适合直接朗读和录制，避免拗口、堆叠和难以出声的表达。',
  },
  {
    categoryKey: 'screen',
    key: 'cinematicImagery',
    instruction:
      '本次重点优化影视画面感，增强镜头感、环境反馈、氛围层次和视觉化细节，让文本更有可拍性和可想象的画面。',
  },
  {
    categoryKey: 'screen',
    key: 'emotionProgression',
    instruction:
      '本次重点优化情绪递进，让情绪起伏、推动关系和语气变化更连贯，也让画面情绪推进更自然。',
  },
  {
    categoryKey: 'screen',
    key: 'subtext',
    instruction:
      '本次重点优化潜台词，让话外之意、关系张力和隐含情绪更自然，让场面更有戏感，但不要写成解释说明。',
  },
  {
    categoryKey: 'screen',
    key: 'dialogueTension',
    instruction:
      '本次重点优化台词张力，让措辞更有拉扯感、冲突感和戏剧性，但不要改写成全新的剧情。',
  },
];

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRequestIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
}

function isLlmPresetCategoryKey(value: string): value is LlmLogicPresetCategoryKey {
  return LLM_PRESET_CATEGORIES.some((option) => option.key === value);
}

function isLlmPresetKey(value: string): value is LlmLogicPresetKey {
  return LLM_PRESET_OPTIONS.some((option) => option.key === value);
}

function resolveLlmPresetKey(value: unknown): LlmLogicPresetKey | null {
  const presetKey = normalizeString(value);
  return isLlmPresetKey(presetKey) ? presetKey : null;
}

function resolveLlmPresetCategoryKey(
  value: unknown,
  presetKey: LlmLogicPresetKey | null
): LlmLogicPresetCategoryKey | null {
  if (presetKey) {
    return PRESET_CATEGORY_BY_KEY[presetKey];
  }

  const presetCategoryKey = normalizeString(value);
  return isLlmPresetCategoryKey(presetCategoryKey) ? presetCategoryKey : null;
}

function resolveLlmPresetInstruction(presetKey: LlmLogicPresetKey): string {
  return LLM_PRESET_OPTIONS.find((option) => option.key === presetKey)?.instruction ?? '';
}

function resolveLlmPresetCategoryInstruction(
  presetCategoryKey: LlmLogicPresetCategoryKey
): string {
  return LLM_PRESET_CATEGORIES.find((option) => option.key === presetCategoryKey)?.instruction ?? '';
}

function buildLlmDirectionInstruction(
  presetCategoryKey: LlmLogicPresetCategoryKey | null,
  presetKey: LlmLogicPresetKey | null,
  customDirection: string
): string {
  const sections: string[] = [];

  if (presetKey) {
    sections.push(resolveLlmPresetInstruction(presetKey));
  } else if (presetCategoryKey) {
    sections.push(resolveLlmPresetCategoryInstruction(presetCategoryKey));
  }

  if (customDirection) {
    sections.push(`Additional Request:\n${customDirection}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

function buildLlmPrompt(
  systemInstruction: string,
  connectedText: string,
  directionInstruction: string
): string {
  const sections = ['You are a professional screenplay text editing assistant.'];

  if (systemInstruction) {
    sections.push(`System Instruction:\n${systemInstruction}`);
  }

  sections.push(`Input Text:\n${connectedText}`);

  if (directionInstruction) {
    sections.push(`Revision Goal:\n${directionInstruction}`);
  }

  sections.push('Return only the final processed text without extra explanation.');

  return sections.join('\n\n');
}

function formatGeneratedTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createLlmRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const LlmLogicNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: LlmLogicNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const settings = useSettingsStore((state) => state);

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.llmLogic, data);
  const resolvedWidth = Math.max(MIN_WIDTH, Math.round(width ?? LLM_LOGIC_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(MIN_HEIGHT, Math.round(height ?? LLM_LOGIC_NODE_DEFAULT_HEIGHT));
  const activeProvider = resolveActivatedScriptProvider(settings);
  const activeProviderApiKey = activeProvider
    ? normalizeString(settings.scriptApiKeys?.[activeProvider])
    : '';
  const modelOptions = activeProvider
    ? resolveScriptModelOptions(activeProvider, settings.scriptProviderCustomModels)
    : [];
  const preferredModelId = activeProvider
    ? resolveConfiguredScriptModel(activeProvider, settings).trim()
    : '';
  const selectedModel = normalizeString(data.model);
  const fallbackModelId =
    modelOptions.find((option) => option.modelId === preferredModelId)?.modelId
    ?? modelOptions[0]?.modelId
    ?? '';
  const resolvedModel = modelOptions.some((option) => option.modelId === selectedModel)
    ? selectedModel
    : fallbackModelId;
  const resolvedPresetKey = resolveLlmPresetKey(data.presetKey);
  const resolvedPresetCategoryKey = resolveLlmPresetCategoryKey(
    data.presetCategoryKey,
    resolvedPresetKey
  );
  const availablePresetOptions = useMemo(
    () => LLM_PRESET_OPTIONS.filter((option) => option.categoryKey === resolvedPresetCategoryKey),
    [resolvedPresetCategoryKey]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!resolvedModel || resolvedModel === selectedModel) {
      return;
    }

    updateNodeData(id, { model: resolvedModel }, { historyMode: 'skip' });
  }, [id, resolvedModel, selectedModel, updateNodeData]);

  useEffect(() => {
    const normalizedPresetCategoryKey = normalizeString(data.presetCategoryKey) || null;
    const normalizedPresetKey = normalizeString(data.presetKey) || null;

    if (
      normalizedPresetCategoryKey === resolvedPresetCategoryKey
      && normalizedPresetKey === resolvedPresetKey
    ) {
      return;
    }

    updateNodeData(
      id,
      {
        presetCategoryKey: resolvedPresetCategoryKey,
        presetKey: resolvedPresetKey,
      },
      { historyMode: 'skip' }
    );
  }, [
    data.presetCategoryKey,
    data.presetKey,
    id,
    resolvedPresetCategoryKey,
    resolvedPresetKey,
    updateNodeData,
  ]);

  const configurationError = useMemo(() => {
    if (!activeProvider) {
      return t('node.llmLogic.providerMissing');
    }

    if (!activeProviderApiKey) {
      return t('node.llmLogic.apiKeyMissing');
    }

    if (modelOptions.length === 0) {
      return t('node.llmLogic.modelOptionsMissing');
    }

    if (!resolvedModel) {
      return t('node.llmLogic.modelMissing');
    }

    return null;
  }, [activeProvider, activeProviderApiKey, modelOptions.length, resolvedModel, t]);

  const providerBadgeLabel = activeProvider
    ? t('node.llmLogic.providerValue', { provider: activeProvider })
    : t('node.llmLogic.providerUnset');
  const generatedTimeLabel =
    typeof data.lastGeneratedAt === 'number' && Number.isFinite(data.lastGeneratedAt)
      ? formatGeneratedTime(data.lastGeneratedAt, i18n.language)
      : null;

  const openProviderSettings = useCallback(() => {
    openSettingsDialog({
      category: 'providers',
      providerTab: 'script',
      providerId: activeProvider ?? undefined,
    });
  }, [activeProvider]);

  const createOutputNode = useCallback((): string => {
    const outputGenerationSource: TextAnnotationGenerationSource = {
      kind: 'llmLogic',
      sourceNodeId: id,
    };
    const position = findNodePosition(
      id,
      TTS_TEXT_NODE_DEFAULT_WIDTH,
      TTS_TEXT_NODE_DEFAULT_HEIGHT
    );
    const outputNodeId = addNode(
      CANVAS_NODE_TYPES.textAnnotation,
      position,
      {
        displayName: t('node.llmLogic.outputTitle'),
        content: '',
        generationSource: outputGenerationSource,
        showCopyButton: true,
        isGenerating: true,
        generationStatusText: t('node.llmLogic.running'),
      },
      { inheritParentFromNodeId: id }
    );
    addEdge(id, outputNodeId);
    updateNodeData(id, { outputNodeId }, { historyMode: 'skip' });
    return outputNodeId;
  }, [addEdge, addNode, findNodePosition, id, t, updateNodeData]);

  const resolveRemainingPendingRequestIds = useCallback((requestId: string): string[] => {
    const store = useCanvasStore.getState();
    const currentNode = store.nodes.find((node) => node.id === id);
    const pendingRequestIds = currentNode?.type === CANVAS_NODE_TYPES.llmLogic
      ? normalizeRequestIds((currentNode.data as LlmLogicNodeData).pendingRequestIds)
      : [];

    return pendingRequestIds.filter((pendingId) => pendingId !== requestId);
  }, [id]);

  const handleGenerate = useCallback(async () => {
    const initialNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    const initialPendingRequestIds = initialNode?.type === CANVAS_NODE_TYPES.llmLogic
      ? normalizeRequestIds((initialNode.data as LlmLogicNodeData).pendingRequestIds)
      : [];
    const upstreamText = resolveConnectedCanvasText(
      id,
      useCanvasStore.getState().nodes,
      useCanvasStore.getState().edges
    ).trim();
    const customDirection = normalizeString(data.userPrompt);
    const directionInstruction = buildLlmDirectionInstruction(
      resolvedPresetCategoryKey,
      resolvedPresetKey,
      customDirection
    );

    if (!upstreamText) {
      updateNodeData(
        id,
        {
          isGenerating: initialPendingRequestIds.length > 0,
          statusText: t('node.llmLogic.inputRequired'),
          lastError: t('node.llmLogic.inputRequired'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (!directionInstruction) {
      updateNodeData(
        id,
        {
          isGenerating: initialPendingRequestIds.length > 0,
          statusText: t('node.llmLogic.optimizationDirectionRequired'),
          lastError: t('node.llmLogic.optimizationDirectionRequired'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (configurationError) {
      updateNodeData(
        id,
        {
          isGenerating: initialPendingRequestIds.length > 0,
          statusText: configurationError,
          lastError: configurationError,
        },
        { historyMode: 'skip' }
      );
      return;
    }

    const prompt = buildLlmPrompt(
      normalizeString(data.systemInstruction),
      upstreamText,
      directionInstruction
    );
    const requestId = createLlmRequestId();
    const outputNodeId = createOutputNode();
    const nextPendingRequestIds = initialPendingRequestIds.includes(requestId)
      ? initialPendingRequestIds
      : [...initialPendingRequestIds, requestId];

    updateNodeData(
      id,
      {
        model: resolvedModel,
        activeRequestId: requestId,
        outputNodeId,
        pendingRequestIds: nextPendingRequestIds,
        isGenerating: true,
        statusText: t('node.llmLogic.running'),
        lastError: null,
      },
      { historyMode: 'skip' }
    );

    try {
      const result = await generateText({
        prompt,
        model: resolvedModel,
      });
      const completedAt = Date.now();
      const remainingPendingRequestIds = resolveRemainingPendingRequestIds(requestId);

      updateNodeData(outputNodeId, {
        content: result.text,
        generationSource: {
          kind: 'llmLogic',
          sourceNodeId: id,
        },
        showCopyButton: true,
        isGenerating: false,
        generationStatusText: null,
      });
      updateNodeData(
        id,
        {
          model: resolvedModel,
          activeRequestId:
            remainingPendingRequestIds[remainingPendingRequestIds.length - 1] ?? null,
          outputNodeId,
          pendingRequestIds: remainingPendingRequestIds,
          isGenerating: remainingPendingRequestIds.length > 0,
          statusText:
            remainingPendingRequestIds.length > 0
              ? t('node.llmLogic.running')
              : t('node.llmLogic.completed'),
          lastError: null,
          lastGeneratedAt: completedAt,
        },
        { historyMode: 'skip' }
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.llmLogic.runFailed');
      const remainingPendingRequestIds = resolveRemainingPendingRequestIds(requestId);

      updateNodeData(
        outputNodeId,
        {
          isGenerating: false,
          generationStatusText: null,
        },
        { historyMode: 'skip' }
      );
      updateNodeData(
        id,
        {
          model: resolvedModel,
          activeRequestId:
            remainingPendingRequestIds[remainingPendingRequestIds.length - 1] ?? null,
          outputNodeId,
          pendingRequestIds: remainingPendingRequestIds,
          isGenerating: remainingPendingRequestIds.length > 0,
          statusText:
            remainingPendingRequestIds.length > 0
              ? t('node.llmLogic.running')
              : t('node.llmLogic.runFailed'),
          lastError: message,
        },
        { historyMode: 'skip' }
      );
    }
  }, [
    configurationError,
    createOutputNode,
    data.systemInstruction,
    data.userPrompt,
    id,
    resolvedModel,
    resolvedPresetCategoryKey,
    resolvedPresetKey,
    resolveRemainingPendingRequestIds,
    t,
    updateNodeData,
  ]);

  return (
    <div
      className={`
        group relative h-full w-full overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-3 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <NodeResizeHandle
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        maxWidth={MAX_WIDTH}
        maxHeight={MAX_HEIGHT}
        isVisible={selected}
      />

      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] text-text-muted">
              {providerBadgeLabel}
            </span>
            {data.isGenerating ? (
              <NodeStatusBadge
                icon={<Loader2 className="h-3 w-3 animate-spin" />}
                label={t('node.llmLogic.running')}
                tone="processing"
                animate
              />
            ) : data.lastError ? (
              <NodeStatusBadge
                icon={<TriangleAlert className="h-3 w-3" />}
                label={t('node.llmLogic.failed')}
                tone="danger"
                title={data.lastError}
              />
            ) : generatedTimeLabel ? (
              <NodeStatusBadge
                label={t('node.llmLogic.generatedAt', { time: generatedTimeLabel })}
                tone="processing"
              />
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted/85">
              {t('node.llmLogic.model')}
            </span>
            <UiSelect
              value={resolvedModel}
              disabled={Boolean(configurationError) || modelOptions.length === 0}
              className="nodrag h-10"
              onChange={(event) => {
                updateNodeData(id, { model: event.target.value });
              }}
            >
              {modelOptions.length === 0 ? (
                <option value="">{t('node.llmLogic.modelUnavailable')}</option>
              ) : null}
              {modelOptions.map((option) => (
                <option key={option.modelId} value={option.modelId}>
                  {option.label}
                </option>
              ))}
            </UiSelect>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted/85">
              {t('node.llmLogic.preset')}
            </span>

            <div className="grid grid-cols-2 gap-2">
              <UiSelect
                value={resolvedPresetCategoryKey ?? ''}
                className="nodrag h-10"
                onChange={(event) => {
                  const nextPresetCategoryKey = normalizeString(event.target.value) || null;
                  const nextPresetKey =
                    resolvedPresetKey
                      && nextPresetCategoryKey
                      && PRESET_CATEGORY_BY_KEY[resolvedPresetKey] === nextPresetCategoryKey
                      ? resolvedPresetKey
                      : null;

                  updateNodeData(
                    id,
                    {
                      presetCategoryKey: nextPresetCategoryKey,
                      presetKey: nextPresetKey,
                    }
                  );
                }}
              >
                <option value="">{t('node.llmLogic.categoryEmpty')}</option>
                {LLM_PRESET_CATEGORIES.map((option) => (
                  <option key={option.key} value={option.key}>
                    {t(`node.llmLogic.presetCategories.${option.key}`)}
                  </option>
                ))}
              </UiSelect>

              <UiSelect
                value={resolvedPresetKey ?? ''}
                disabled={!resolvedPresetCategoryKey}
                className="nodrag h-10"
                onChange={(event) => {
                  updateNodeData(id, {
                    presetKey: normalizeString(event.target.value) || null,
                  });
                }}
              >
                <option value="">{t('node.llmLogic.detailEmpty')}</option>
                {availablePresetOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {t(`node.llmLogic.presetOptions.${option.key}`)}
                  </option>
                ))}
              </UiSelect>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted/85">
                {t('node.llmLogic.customDirection')}
              </span>
              <UiTextArea
                value={typeof data.userPrompt === 'string' ? data.userPrompt : ''}
                placeholder={t('node.llmLogic.customDirectionPlaceholder')}
                className="nodrag nowheel h-20 bg-black/10"
                onChange={(event) => updateNodeData(id, { userPrompt: event.target.value })}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted/85">
              {t('node.llmLogic.systemInstruction')}
            </span>
            <UiTextArea
              value={typeof data.systemInstruction === 'string' ? data.systemInstruction : ''}
              placeholder={t('node.llmLogic.systemInstructionPlaceholder')}
              className="nodrag nowheel h-24 bg-black/10"
              onChange={(event) => updateNodeData(id, { systemInstruction: event.target.value })}
            />
          </label>

          {configurationError ? (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-100">
              <div>{configurationError}</div>
              <UiButton
                size="sm"
                className="mt-2 inline-flex gap-1.5"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  openProviderSettings();
                }}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t('node.llmLogic.openSettings')}
              </UiButton>
            </div>
          ) : null}

          {!configurationError && data.lastError ? (
            <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-100">
              {data.lastError}
            </div>
          ) : null}
        </div>

        <div className="mt-2 flex shrink-0 items-center justify-between gap-3">
          <div className="min-h-[20px] text-xs text-text-muted">
            {data.statusText || t('node.llmLogic.statusIdle')}
          </div>
          <UiButton
            variant="primary"
            size="sm"
            className="nodrag gap-1.5"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerate();
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('node.llmLogic.run')}
          </UiButton>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
    </div>
  );
});

LlmLogicNode.displayName = 'LlmLogicNode';
