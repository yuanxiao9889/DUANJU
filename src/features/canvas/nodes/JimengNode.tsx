import {
  type KeyboardEvent,
  type WheelEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AtSign,
  Clapperboard,
  Crop,
  Film,
  Images,
  Loader2,
  SendHorizontal,
  Sparkles,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  type JimengNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { graphImageResolver } from '@/features/canvas/application/canvasServices';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  findReferenceTokens,
  insertReferenceToken,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  buildJimengSubmissionPrompt,
  submitJimengTask,
} from '@/features/jimeng/application/jimengSubmission';
import {
  JIMENG_ASPECT_RATIO_OPTIONS,
  JIMENG_DURATION_OPTIONS,
} from '@/features/jimeng/domain/jimengOptions';
import { UiButton, UiChipButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { JimengToolbarSelect } from './jimeng/JimengToolbarSelect';

type JimengNodeProps = NodeProps & {
  id: string;
  data: JimengNodeData;
  selected?: boolean;
};

interface PickerAnchor {
  left: number;
  top: number;
}

const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;
const JIMENG_NODE_DEFAULT_WIDTH = 760;
const JIMENG_NODE_DEFAULT_HEIGHT = 460;
const JIMENG_NODE_MIN_WIDTH = 560;
const JIMENG_NODE_MIN_HEIGHT = 360;
const JIMENG_NODE_MAX_WIDTH = 1320;
const JIMENG_NODE_MAX_HEIGHT = 1040;
const FIXED_JIMENG_CREATION_TYPE = 'video';
const FIXED_JIMENG_MODEL = 'seedance-2.0';
const FIXED_JIMENG_REFERENCE_MODE = 'allAround';
const FIXED_JIMENG_DEFAULT_DURATION = 5;

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  mirrorStyle.wordBreak = 'break-word';
  mirrorStyle.boxSizing = computed.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.lineHeight = computed.lineHeight;
  mirrorStyle.letterSpacing = computed.letterSpacing;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.border = computed.border;
  mirrorStyle.textTransform = computed.textTransform;
  mirrorStyle.textIndent = computed.textIndent;

  mirror.textContent = textarea.value.slice(0, caretIndex);

  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || ' ';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const left = marker.offsetLeft - textarea.scrollLeft;
  const top = marker.offsetTop - textarea.scrollTop;

  document.body.removeChild(mirror);

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
  };
}

function resolvePickerAnchor(
  container: HTMLDivElement | null,
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(0, textareaRect.left - containerRect.left + caretOffset.left),
    top: Math.max(0, textareaRect.top - containerRect.top + caretOffset.top + PICKER_Y_OFFSET_PX),
  };
}

function renderPromptWithHighlights(prompt: string, maxImageCount: number): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex, token.start)}</span>
      );
    }

    segments.push(
      <span
        key={`ref-${token.start}`}
        className="relative z-0 text-white [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor] before:absolute before:-inset-x-[4px] before:-inset-y-[1px] before:-z-10 before:rounded-[7px] before:bg-accent/55 before:content-['']"
      >
        {token.token}
      </span>
    );

    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }

  return segments;
}

function resolveAspectRatioGlyphStyle(ratio: string): { width: string; height: string } {
  const [rawWidth, rawHeight] = ratio.split(':').map((value) => Number(value));
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return { width: '20px', height: '16px' };
  }

  const maxWidth = 24;
  const maxHeight = 24;
  const scale = Math.min(maxWidth / rawWidth, maxHeight / rawHeight);

  return {
    width: `${Math.max(8, Math.round(rawWidth * scale))}px`,
    height: `${Math.max(8, Math.round(rawHeight * scale))}px`,
  };
}

function renderAspectRatioGlyph(ratio: string, active: boolean): ReactNode {
  const glyphStyle = resolveAspectRatioGlyphStyle(ratio);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex h-8 w-8 items-center justify-center">
        <div
          style={glyphStyle}
          className={`rounded-[5px] border-2 transition-colors ${
            active
              ? 'border-[rgba(15,23,42,0.72)] dark:border-white/90'
              : 'border-[rgba(15,23,42,0.42)] dark:border-white/55'
          }`}
        />
      </div>
      <span className="text-[13px] font-medium leading-none">{ratio}</span>
    </div>
  );
}

export const JimengNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: JimengNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();

  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const resolvedCreationType = FIXED_JIMENG_CREATION_TYPE;
  const resolvedModel = FIXED_JIMENG_MODEL;
  const resolvedReferenceMode = FIXED_JIMENG_REFERENCE_MODE;
  const resolvedAspectRatio = data.aspectRatio ?? '16:9';
  const resolvedDurationSeconds = data.durationSeconds ?? FIXED_JIMENG_DEFAULT_DURATION;

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [edges, id, nodes]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        tokenLabel: `@\u56fe\u7247${index + 1}`,
        label: t('node.jimeng.referenceImageLabel', { index: index + 1 }),
      })),
    [incomingImages, t]
  );

  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );

  const aspectRatioOptions = useMemo(
    () => JIMENG_ASPECT_RATIO_OPTIONS.map((option) => ({
      value: option.value,
      label: option.value,
      description: option.descriptionKey ? t(option.descriptionKey) : undefined,
    })),
    [t]
  );

  const durationOptions = useMemo(
    () => JIMENG_DURATION_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      description: option.descriptionKey ? t(option.descriptionKey) : undefined,
    })),
    [t]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimeng, data),
    [data]
  );

  const headerStatus = useMemo(() => {
    if (data.isSubmitting) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimeng.submitting')}
          tone="processing"
          animate
        />
      );
    }

    if (data.lastError) {
      return (
        <NodeStatusBadge
          icon={<TriangleAlert className="h-3 w-3" />}
          label={t('nodeStatus.error')}
          tone="danger"
          title={data.lastError}
        />
      );
    }

    return null;
  }, [data.isSubmitting, data.lastError, t]);

  const resolvedWidth = Math.max(JIMENG_NODE_MIN_WIDTH, Math.round(width ?? JIMENG_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(JIMENG_NODE_MIN_HEIGHT, Math.round(height ?? JIMENG_NODE_DEFAULT_HEIGHT));

  const lastSubmittedLabel = useMemo(() => {
    if (!data.lastSubmittedAt) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat(
      i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US',
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );

    return t('node.jimeng.lastSubmitted', {
      time: formatter.format(data.lastSubmittedAt),
    });
  }, [data.lastSubmittedAt, i18n.language, t]);

  const fixedModeBadgeLabel = t('node.jimeng.fixedModeBadge');
  const currentDurationLabel =
    durationOptions.find((option) => option.value === resolvedDurationSeconds)?.label
    ?? `${resolvedDurationSeconds}s`;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
    }
  }, [data.prompt]);

  useEffect(() => {
    const nextData: Partial<JimengNodeData> = {};

    if (data.creationType !== FIXED_JIMENG_CREATION_TYPE) {
      nextData.creationType = FIXED_JIMENG_CREATION_TYPE;
    }
    if (data.model !== FIXED_JIMENG_MODEL) {
      nextData.model = FIXED_JIMENG_MODEL;
    }
    if (data.referenceMode !== FIXED_JIMENG_REFERENCE_MODE) {
      nextData.referenceMode = FIXED_JIMENG_REFERENCE_MODE;
    }
    if ((data.extraControls?.length ?? 0) > 0) {
      nextData.extraControls = [];
    }
    if (!durationOptions.some((option) => option.value === resolvedDurationSeconds) && durationOptions[0]) {
      nextData.durationSeconds = durationOptions[0].value;
    }
    if (!aspectRatioOptions.some((option) => option.value === resolvedAspectRatio) && aspectRatioOptions[0]) {
      nextData.aspectRatio = aspectRatioOptions[0].value;
    }

    if (Object.keys(nextData).length > 0) {
      updateNodeData(id, nextData);
    }
  }, [
    aspectRatioOptions,
    data.creationType,
    data.extraControls,
    data.model,
    data.referenceMode,
    durationOptions,
    id,
    resolvedAspectRatio,
    resolvedDurationSeconds,
    updateNodeData,
  ]);

  useEffect(() => {
    if (incomingImages.length === 0) {
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, incomingImages.length - 1));
  }, [incomingImages.length]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setShowImagePicker(false);
      setPickerCursor(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }

    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  const openImagePickerAtCursor = useCallback((cursor: number) => {
    if (!promptRef.current || incomingImages.length === 0) {
      return;
    }

    setPickerAnchor(resolvePickerAnchor(rootRef.current, promptRef.current, cursor));
    setPickerCursor(cursor);
    setShowImagePicker(true);
    setPickerActiveIndex(0);
  }, [incomingImages.length]);

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = `@\u56fe\u7247${imageIndex + 1}`;
    const currentPrompt = promptDraftRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;
    const { nextText, nextCursor } = insertReferenceToken(currentPrompt, cursor, marker);

    setPromptDraft(nextText);
    commitPromptDraft(nextText);
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [commitPromptDraft, pickerCursor]);

  const resolveSubmissionReferenceImageSources = useCallback((prompt: string) => {
    if (incomingImages.length === 0) {
      return [];
    }

    const referencedImageIndexes = [...new Set(
      findReferenceTokens(prompt, incomingImages.length)
        .map((token) => token.value - 1)
        .filter((index) => index >= 0 && index < incomingImages.length)
    )];

    if (referencedImageIndexes.length === 0) {
      return incomingImages;
    }

    return referencedImageIndexes
      .map((index) => incomingImages[index])
      .filter((imageUrl): imageUrl is string => typeof imageUrl === 'string' && imageUrl.trim().length > 0);
  }, [incomingImages]);

  const handleSubmit = useCallback(async () => {
    const currentPrompt = promptDraftRef.current;
    const normalizedPrompt = buildJimengSubmissionPrompt(currentPrompt);
    if (!normalizedPrompt) {
      const errorMessage = t('node.jimeng.promptRequired');
      updateNodeData(id, {
        isSubmitting: false,
        lastError: errorMessage,
      });
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    updateNodeData(id, {
      isSubmitting: true,
      lastError: null,
    });

    try {
      await submitJimengTask({
        prompt: normalizedPrompt,
        creationType: resolvedCreationType,
        model: resolvedModel,
        referenceMode: resolvedReferenceMode,
        aspectRatio: resolvedAspectRatio,
        durationSeconds: resolvedDurationSeconds,
        extraControls: [],
        referenceImageSources: resolveSubmissionReferenceImageSources(currentPrompt),
      });
      updateNodeData(id, {
        isSubmitting: false,
        lastSubmittedAt: Date.now(),
        lastError: null,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.jimeng.submitFailed');

      updateNodeData(id, {
        isSubmitting: false,
        lastError: message,
      });
      void showErrorDialog(message, t('common.error'));
    }
  }, [
    id,
    resolvedAspectRatio,
    resolvedCreationType,
    resolvedDurationSeconds,
    resolvedModel,
    resolvedReferenceMode,
    resolveSubmissionReferenceImageSources,
    t,
    updateNodeData,
  ]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptDraftRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deletionDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        deletionDirection,
        incomingImages.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        setPromptDraft(nextText);
        commitPromptDraft(nextText);
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
          syncPromptHighlightScroll();
        });
        return;
      }
    }

    if (showImagePicker && incomingImages.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImages.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        insertImageReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === '@' && incomingImages.length > 0) {
      event.preventDefault();
      const cursor = event.currentTarget.selectionStart ?? promptDraftRef.current.length;
      openImagePickerAtCursor(cursor);
      return;
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handleToolbarAtClick = () => {
    if (incomingImages.length === 0) {
      return;
    }

    const cursor = promptRef.current?.selectionStart ?? promptDraftRef.current.length;
    promptRef.current?.focus();
    openImagePickerAtCursor(cursor);
  };

  const handleAspectRatioChange = useCallback((value: typeof resolvedAspectRatio) => {
    updateNodeData(id, { aspectRatio: value });
  }, [id, updateNodeData]);

  const stepDuration = useCallback((direction: 1 | -1) => {
    const currentIndex = durationOptions.findIndex((option) => option.value === resolvedDurationSeconds);
    if (currentIndex < 0) {
      const fallbackOption = direction > 0 ? durationOptions[0] : durationOptions[durationOptions.length - 1];
      if (fallbackOption) {
        updateNodeData(id, { durationSeconds: fallbackOption.value });
      }
      return;
    }

    const nextIndex = Math.min(
      durationOptions.length - 1,
      Math.max(0, currentIndex + direction)
    );
    if (nextIndex !== currentIndex) {
      updateNodeData(id, { durationSeconds: durationOptions[nextIndex].value });
    }
  }, [durationOptions, id, resolvedDurationSeconds, updateNodeData]);

  const handleDurationWheel = useCallback((event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta === 0) {
      return;
    }

    stepDuration(delta > 0 ? 1 : -1);
  }, [stepDuration]);

  const toolbarChipClassName =
    '!h-10 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm !text-text-dark hover:!bg-white/[0.08]';
  const fixedToolbarChipClassName =
    'inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-text-dark';

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-3 transition-all duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus ?? undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="relative flex min-h-0 flex-1 flex-col rounded-[22px] border border-white/8 bg-[#17191f] px-4 py-3">
        {incomingImageItems.length > 0 ? (
          <div className="mb-3 flex shrink-0 items-start gap-3 overflow-x-auto pb-1">
            {incomingImageItems.map((item, index) => (
              <button
                key={`${item.imageUrl}-reference-${index}`}
                type="button"
                className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:border-accent/35 hover:bg-white/[0.06]"
                onClick={(event) => {
                  event.stopPropagation();
                  insertImageReference(index);
                }}
              >
                <CanvasNodeImage
                  src={item.displayUrl}
                  alt={item.label}
                  viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                  viewerImageList={incomingImageViewerList}
                  className="h-12 w-12 rounded-lg object-cover"
                  draggable={false}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text-dark">{item.tokenLabel}</div>
                  <div className="truncate text-xs text-text-muted">{item.label}</div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-[15px] leading-7 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-1">
              {renderPromptWithHighlights(promptDraft, incomingImages.length)}
            </div>
          </div>

          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setPromptDraft(nextValue);
              commitPromptDraft(nextValue);
            }}
            onKeyDown={handlePromptKeyDown}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => event.stopPropagation()}
            placeholder={t('node.jimeng.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-1 text-[15px] leading-7 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />
        </div>

        {showImagePicker && incomingImageItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[148px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div
              className="ui-scrollbar nowheel max-h-[200px] overflow-y-auto"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {incomingImageItems.map((item, index) => (
                <button
                  key={`${item.imageUrl}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertImageReference(index);
                  }}
                  onMouseEnter={() => setPickerActiveIndex(index)}
                  className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
                    pickerActiveIndex === index ? 'border-[rgba(255,255,255,0.24)] bg-bg-dark' : ''
                  }`}
                >
                  <CanvasNodeImage
                    src={item.displayUrl}
                    alt={item.label}
                    viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                    viewerImageList={incomingImageViewerList}
                    className="h-8 w-8 rounded object-cover"
                    draggable={false}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
          <div className={fixedToolbarChipClassName}>
            <Clapperboard className="h-4 w-4 text-accent" />
            <span>{t('node.jimeng.creationTypes.video')}</span>
          </div>
          <div className={fixedToolbarChipClassName}>
            <Film className="h-4 w-4 text-accent" />
            <span>{t('node.jimeng.models.seedance-2.0')}</span>
          </div>
          <div className={fixedToolbarChipClassName}>
            <Images className="h-4 w-4 text-accent" />
            <span>{t('node.jimeng.referenceModes.allAround')}</span>
          </div>
          <JimengToolbarSelect
            value={resolvedAspectRatio}
            options={aspectRatioOptions}
            onChange={handleAspectRatioChange}
            icon={<Crop className="h-4 w-4" />}
            className={toolbarChipClassName}
            panelClassName="w-[372px] rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_18px_48px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#232730]/96 dark:shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
            layout="grid"
            columnsClassName="grid-cols-6"
            showChevron={false}
            renderGridOption={(option, active) => renderAspectRatioGlyph(option.label, active)}
          />
          <JimengToolbarSelect
            value={resolvedDurationSeconds}
            options={durationOptions}
            onChange={(value) => updateNodeData(id, { durationSeconds: value })}
            icon={<Timer className="h-4 w-4" />}
            className={toolbarChipClassName}
            panelClassName="min-w-[132px] rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.98)] p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#232730]/96 dark:shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
            showChevron={false}
            triggerButtonProps={{
              title: currentDurationLabel,
              onWheel: handleDurationWheel,
              onMouseDown: (event) => event.stopPropagation(),
            }}
          />
          <UiChipButton
            type="button"
            className={`${toolbarChipClassName} !w-11 !justify-center !px-0`}
            disabled={incomingImages.length === 0}
            onClick={(event) => {
              event.stopPropagation();
              handleToolbarAtClick();
            }}
            title={t('node.jimeng.referenceHelper')}
          >
            <AtSign className="h-4 w-4" />
          </UiChipButton>

          <div className="ml-auto min-w-0 text-right text-[11px] text-text-muted">
            {t('node.jimeng.referenceCount', { count: incomingImageItems.length })}
          </div>

          <UiButton
            type="button"
            variant="primary"
            size="sm"
            disabled={Boolean(data.isSubmitting)}
            className="h-11 w-11 shrink-0 rounded-full !px-0"
            onClick={(event) => {
              event.stopPropagation();
              void handleSubmit();
            }}
            title={data.isSubmitting ? t('node.jimeng.submitting') : t('node.jimeng.submit')}
          >
            {data.isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </UiButton>
        </div>
      </div>

      <div className="mt-2 flex min-h-[24px] items-center justify-between gap-3">
        <div
          className={`min-w-0 flex-1 text-[11px] ${data.lastError ? 'text-red-200' : 'text-text-muted'}`}
        >
          {data.lastError ?? lastSubmittedLabel ?? t('node.jimeng.submitHint')}
        </div>

        <div className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[11px] text-text-muted">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>{fixedModeBadgeLabel}</span>
        </div>
      </div>

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={JIMENG_NODE_MIN_WIDTH}
        minHeight={JIMENG_NODE_MIN_HEIGHT}
        maxWidth={JIMENG_NODE_MAX_WIDTH}
        maxHeight={JIMENG_NODE_MAX_HEIGHT}
        isVisible={selected}
      />
    </div>
  );
});

JimengNode.displayName = 'JimengNode';
