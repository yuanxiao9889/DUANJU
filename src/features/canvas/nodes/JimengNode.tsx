import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  Loader2,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  Undo2,
  Wand2,
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
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  areReferenceImageOrdersEqual,
  buildShortReferenceToken,
  findReferenceTokens,
  insertReferenceToken,
  remapReferenceTokensByImageOrder,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  buildJimengSubmissionPrompt,
  submitJimengTask,
} from '@/features/jimeng/application/jimengSubmission';
import { focusJimengChromeWorkspace } from '@/features/jimeng/application/jimengChromeWorkspace';
import {
  optimizeCanvasPrompt,
  type PromptDurationRecommendation,
} from '@/features/canvas/application/promptOptimization';
import { UiButton, UiModal } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';

type JimengNodeProps = NodeProps & {
  id: string;
  data: JimengNodeData;
  selected?: boolean;
};

interface PickerAnchor {
  left: number;
  top: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
  previousDurationSuggestion: PromptDurationSuggestionSnapshot;
  appliedDurationSuggestion: PromptDurationSuggestionSnapshot;
}

interface PromptReferencePreviewState {
  imageUrl: string;
  displayUrl: string;
  alt: string;
  left: number;
  top: number;
}

interface PromptDurationSuggestionSnapshot {
  suggestedDurationSeconds: number | null;
  suggestedDurationEstimatedSeconds: number | null;
  suggestedDurationExceedsLimit: boolean;
  suggestedDurationReason: string | null;
}

const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;
const JIMENG_NODE_DEFAULT_WIDTH = 760;
const JIMENG_NODE_DEFAULT_HEIGHT = 460;
const JIMENG_NODE_MIN_WIDTH = 560;
const JIMENG_NODE_MIN_HEIGHT = 360;
const JIMENG_NODE_MAX_WIDTH = 1320;
const JIMENG_NODE_MAX_HEIGHT = 1040;
let hasShownJimengManualSetupReminderThisSession = false;

function buildClearedDurationSuggestionSnapshot(): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds: null,
    suggestedDurationEstimatedSeconds: null,
    suggestedDurationExceedsLimit: false,
    suggestedDurationReason: null,
  };
}

function readDurationSuggestionSnapshot(data: JimengNodeData): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds:
      typeof data.suggestedDurationSeconds === 'number'
        ? data.suggestedDurationSeconds
        : null,
    suggestedDurationEstimatedSeconds:
      typeof data.suggestedDurationEstimatedSeconds === 'number'
        ? data.suggestedDurationEstimatedSeconds
        : null,
    suggestedDurationExceedsLimit: data.suggestedDurationExceedsLimit === true,
    suggestedDurationReason:
      typeof data.suggestedDurationReason === 'string' && data.suggestedDurationReason.trim().length > 0
        ? data.suggestedDurationReason.trim()
        : null,
  };
}

function buildDurationSuggestionSnapshot(
  recommendation: PromptDurationRecommendation | null | undefined
): PromptDurationSuggestionSnapshot {
  if (!recommendation) {
    return buildClearedDurationSuggestionSnapshot();
  }

  return {
    suggestedDurationSeconds: recommendation.recommendedDurationSeconds,
    suggestedDurationEstimatedSeconds: recommendation.estimatedDurationSeconds,
    suggestedDurationExceedsLimit: recommendation.exceedsMaxDuration,
    suggestedDurationReason:
      typeof recommendation.reason === 'string' && recommendation.reason.trim().length > 0
        ? recommendation.reason.trim()
        : null,
  };
}

function toDurationSuggestionNodeData(
  snapshot: PromptDurationSuggestionSnapshot
): Partial<JimengNodeData> {
  return {
    suggestedDurationSeconds: snapshot.suggestedDurationSeconds,
    suggestedDurationEstimatedSeconds: snapshot.suggestedDurationEstimatedSeconds,
    suggestedDurationExceedsLimit: snapshot.suggestedDurationExceedsLimit,
    suggestedDurationReason: snapshot.suggestedDurationReason,
  };
}

function areDurationSuggestionSnapshotsEqual(
  left: PromptDurationSuggestionSnapshot,
  right: PromptDurationSuggestionSnapshot
): boolean {
  return (
    left.suggestedDurationSeconds === right.suggestedDurationSeconds
    && left.suggestedDurationEstimatedSeconds === right.suggestedDurationEstimatedSeconds
    && left.suggestedDurationExceedsLimit === right.suggestedDurationExceedsLimit
    && left.suggestedDurationReason === right.suggestedDurationReason
  );
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= items.length
    || toIndex >= items.length
    || fromIndex === toIndex
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function resolveOrderedReferenceImages(
  imageUrls: string[],
  preferredOrder: string[] | undefined
): string[] {
  if (imageUrls.length === 0) {
    return [];
  }

  const availableImages = new Set(imageUrls);
  const resolvedImages: string[] = [];
  const seenImages = new Set<string>();

  for (const imageUrl of preferredOrder ?? []) {
    if (!availableImages.has(imageUrl) || seenImages.has(imageUrl)) {
      continue;
    }

    seenImages.add(imageUrl);
    resolvedImages.push(imageUrl);
  }

  for (const imageUrl of imageUrls) {
    if (seenImages.has(imageUrl)) {
      continue;
    }

    seenImages.add(imageUrl);
    resolvedImages.push(imageUrl);
  }

  return resolvedImages;
}

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

function renderPromptReferenceHoverTargets(
  prompt: string,
  maxImageCount: number,
  onTokenHover: (token: number, event: ReactMouseEvent<HTMLSpanElement>) => void,
  onTokenLeave: () => void,
  onTokenMouseDown: (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => void
): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`hover-plain-${lastIndex}`} className="text-transparent">
          {prompt.slice(lastIndex, token.start)}
        </span>
      );
    }

    segments.push(
      <span
        key={`hover-ref-${token.start}`}
        className="pointer-events-auto cursor-help select-none text-transparent"
        onMouseEnter={(event) => onTokenHover(token.value - 1, event)}
        onMouseMove={(event) => onTokenHover(token.value - 1, event)}
        onMouseLeave={onTokenLeave}
        onMouseDown={(event) => onTokenMouseDown(token.end, event)}
      >
        {token.token}
      </span>
    );

    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`hover-plain-${lastIndex}`} className="text-transparent">
        {prompt.slice(lastIndex)}
      </span>
    );
  }

  return segments;
}

export const JimengNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: JimengNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();

  const rootRef = useRef<HTMLDivElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const promptPreviewHostRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const promptHoverLayerRef = useRef<HTMLDivElement>(null);
  const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const previousIncomingImagesRef = useRef<string[] | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);
  const [isManualSetupReminderOpen, setIsManualSetupReminderOpen] = useState(false);
  const [draggingReferenceIndex, setDraggingReferenceIndex] = useState<number | null>(null);
  const [dragOverReferenceIndex, setDragOverReferenceIndex] = useState<number | null>(null);
  const [isOpeningJimengChrome, setIsOpeningJimengChrome] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null);
  const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] =
    useState<PromptOptimizationUndoState | null>(null);
  const [promptReferencePreview, setPromptReferencePreview] =
    useState<PromptReferencePreviewState | null>(null);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const graphIncomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [edges, id, nodes]
  );
  const incomingImages = useMemo(
    () => resolveOrderedReferenceImages(graphIncomingImages, data.referenceImageOrder),
    [data.referenceImageOrder, graphIncomingImages]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        tokenLabel: buildShortReferenceToken(index),
        label: t('node.jimeng.referenceImageLabel', { index: index + 1 }),
      })),
    [incomingImages, t]
  );

  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );
  const durationSuggestion = useMemo(
    () => readDurationSuggestionSnapshot(data),
    [
      data.suggestedDurationEstimatedSeconds,
      data.suggestedDurationExceedsLimit,
      data.suggestedDurationReason,
      data.suggestedDurationSeconds,
    ]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimeng, data),
    [data]
  );

  const headerStatus = useMemo(() => {
    if (isOpeningJimengChrome) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('titleBar.jimengOpeningChrome')}
          tone="processing"
          animate
        />
      );
    }

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

    if (isOptimizingPrompt) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimeng.optimizingPrompt')}
          tone="processing"
          animate
        />
      );
    }

    if (promptOptimizationError) {
      return (
        <NodeStatusBadge
          icon={<TriangleAlert className="h-3 w-3" />}
          label={t('nodeStatus.error')}
          tone="danger"
          title={promptOptimizationError}
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
  }, [data.isSubmitting, data.lastError, isOpeningJimengChrome, isOptimizingPrompt, promptOptimizationError, t]);

  const resolvedWidth = Math.max(JIMENG_NODE_MIN_WIDTH, Math.round(width ?? JIMENG_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(JIMENG_NODE_MIN_HEIGHT, Math.round(height ?? JIMENG_NODE_DEFAULT_HEIGHT));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
      setLastPromptOptimizationUndoState(null);
    }
  }, [data.prompt]);

  useEffect(() => {
    if (incomingImages.length === 0) {
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      setDraggingReferenceIndex(null);
      setDragOverReferenceIndex(null);
      setPromptReferencePreview(null);
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, incomingImages.length - 1));
  }, [incomingImages.length]);

  useEffect(() => {
    setPromptReferencePreview(null);
  }, [incomingImages, promptDraft]);

  useEffect(() => {
    if (!showImagePicker) {
      return;
    }

    pickerItemRefs.current[pickerActiveIndex]?.scrollIntoView({
      block: 'nearest',
    });
  }, [pickerActiveIndex, showImagePicker]);

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

  const commitPromptDraft = useCallback((
    nextPrompt: string,
    nextData?: Partial<JimengNodeData>
  ) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, {
      prompt: nextPrompt,
      ...(nextData ?? {}),
    });
  }, [id, updateNodeData]);

  const commitManualPromptDraft = useCallback((nextPrompt: string) => {
    setPromptDraft(nextPrompt);
    commitPromptDraft(
      nextPrompt,
      toDurationSuggestionNodeData(buildClearedDurationSuggestionSnapshot())
    );
    setLastPromptOptimizationUndoState(null);
  }, [commitPromptDraft]);

  useEffect(() => {
    const previousIncomingImages = previousIncomingImagesRef.current;
    if (!previousIncomingImages) {
      previousIncomingImagesRef.current = incomingImages;
      return;
    }

    if (areReferenceImageOrdersEqual(previousIncomingImages, incomingImages)) {
      return;
    }

    previousIncomingImagesRef.current = incomingImages;
    const nextPrompt = remapReferenceTokensByImageOrder(
      promptDraftRef.current,
      previousIncomingImages,
      incomingImages
    );
    if (nextPrompt === promptDraftRef.current) {
      return;
    }

    setPromptDraft(nextPrompt);
    commitPromptDraft(nextPrompt);
  }, [commitPromptDraft, incomingImages]);

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }

    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
    if (promptHoverLayerRef.current) {
      promptHoverLayerRef.current.scrollTop = promptRef.current.scrollTop;
      promptHoverLayerRef.current.scrollLeft = promptRef.current.scrollLeft;
    }
  };

  const openImagePickerAtCursor = useCallback((cursor: number) => {
    if (!promptRef.current || incomingImages.length === 0) {
      return;
    }

    setPickerAnchor(resolvePickerAnchor(promptPanelRef.current, promptRef.current, cursor));
    setPickerCursor(cursor);
    setShowImagePicker(true);
    setPickerActiveIndex(0);
  }, [incomingImages.length]);

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = buildShortReferenceToken(imageIndex);
    const currentPrompt = promptDraftRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;
    const { nextText, nextCursor } = insertReferenceToken(currentPrompt, cursor, marker);

    commitManualPromptDraft(nextText);
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [commitManualPromptDraft, pickerCursor]);

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

  const openJimengChromeForManualSetup = useCallback(async () => {
    if (isOpeningJimengChrome) {
      return false;
    }

    setIsOpeningJimengChrome(true);
    updateNodeData(id, { lastError: null });

    try {
      await focusJimengChromeWorkspace();
      return true;
    } catch (error) {
      const content = resolveErrorContent(error, t('titleBar.jimengOpenFailed'));
      const isChromeMissing = content.message.includes('Chrome/Chromium was not found');
      const errorMessage = isChromeMissing
        ? t('titleBar.jimengChromeMissing')
        : content.message;

      updateNodeData(id, { lastError: errorMessage });
      await showErrorDialog(
        errorMessage,
        t('common.error'),
        isChromeMissing ? content.message : content.details
      );
      return false;
    } finally {
      setIsOpeningJimengChrome(false);
    }
  }, [id, isOpeningJimengChrome, t, updateNodeData]);

  const ensureManualSetupReminderShown = useCallback(async () => {
    if (hasShownJimengManualSetupReminderThisSession) {
      return true;
    }

    const opened = await openJimengChromeForManualSetup();
    if (!opened) {
      return false;
    }

    hasShownJimengManualSetupReminderThisSession = true;
    setIsManualSetupReminderOpen(true);
    return false;
  }, [openJimengChromeForManualSetup]);

  const persistReferenceImageOrder = useCallback((nextOrder: string[]) => {
    updateNodeData(id, { referenceImageOrder: nextOrder });
  }, [id, updateNodeData]);

  const moveReferenceImage = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }

    const nextOrder = moveItem(incomingImages, fromIndex, toIndex);
    if (nextOrder === incomingImages) {
      return;
    }

    persistReferenceImageOrder(nextOrder);
  }, [incomingImages, persistReferenceImageOrder]);

  const handleSubmit = useCallback(async () => {
    if (!(await ensureManualSetupReminderShown())) {
      return;
    }

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
    setPromptOptimizationError(null);

    try {
      await submitJimengTask({
        prompt: normalizedPrompt,
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
    }
  }, [
    ensureManualSetupReminderShown,
    id,
    resolveSubmissionReferenceImageSources,
    t,
    updateNodeData,
  ]);

  const handleReferenceImageDragStart = useCallback((
    event: DragEvent<HTMLButtonElement>,
    index: number
  ) => {
    event.stopPropagation();
    setDraggingReferenceIndex(index);
    setDragOverReferenceIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', incomingImages[index] ?? '');
  }, [incomingImages]);

  const handleReferenceImageDragEnter = useCallback((
    event: DragEvent<HTMLButtonElement>,
    index: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragOverReferenceIndex !== index) {
      setDragOverReferenceIndex(index);
    }
  }, [dragOverReferenceIndex]);

  const handleReferenceImageDragOver = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleReferenceImageDrop = useCallback((
    event: DragEvent<HTMLButtonElement>,
    index: number
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (draggingReferenceIndex !== null) {
      moveReferenceImage(draggingReferenceIndex, index);
    }

    setDraggingReferenceIndex(null);
    setDragOverReferenceIndex(null);
  }, [draggingReferenceIndex, moveReferenceImage]);

  const handleReferenceImageDragEnd = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setDraggingReferenceIndex(null);
    setDragOverReferenceIndex(null);
  }, []);

  const handleOptimizePrompt = useCallback(async () => {
    const sourcePrompt = promptDraftRef.current;
    const currentPrompt = sourcePrompt.trim();
    const previousDurationSuggestion = durationSuggestion;
    if (!currentPrompt) {
      const errorMessage = t('node.jimeng.promptRequired');
      setPromptOptimizationError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    setIsOptimizingPrompt(true);
    setPromptOptimizationError(null);

    try {
      const optimizationReferenceImages = resolveSubmissionReferenceImageSources(currentPrompt);
      const result = await optimizeCanvasPrompt({
        mode: 'jimeng',
        prompt: currentPrompt,
        referenceImages: optimizationReferenceImages,
      });
      if (promptDraftRef.current !== sourcePrompt) {
        return;
      }
      const nextPrompt = result.prompt;
      const nextDurationSuggestion = buildDurationSuggestionSnapshot(result.durationRecommendation);
      if (
        nextPrompt !== sourcePrompt
        || !areDurationSuggestionSnapshotsEqual(
          previousDurationSuggestion,
          nextDurationSuggestion
        )
      ) {
        setLastPromptOptimizationUndoState({
          previousPrompt: sourcePrompt,
          appliedPrompt: nextPrompt,
          previousDurationSuggestion,
          appliedDurationSuggestion: nextDurationSuggestion,
        });
      } else {
        setLastPromptOptimizationUndoState(null);
      }
      setPromptDraft(nextPrompt);
      commitPromptDraft(nextPrompt, toDurationSuggestionNodeData(nextDurationSuggestion));
      requestAnimationFrame(() => {
        promptRef.current?.focus();
        const nextCursor = nextPrompt.length;
        promptRef.current?.setSelectionRange(nextCursor, nextCursor);
        syncPromptHighlightScroll();
      });
    } catch (optimizationError) {
      const errorMessage =
        optimizationError instanceof Error && optimizationError.message.trim().length > 0
          ? optimizationError.message
          : t('node.jimeng.optimizePromptFailed');
      setPromptOptimizationError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [commitPromptDraft, durationSuggestion, resolveSubmissionReferenceImageSources, t]);

  const handleUndoOptimizedPrompt = useCallback(() => {
    if (!lastPromptOptimizationUndoState) {
      return;
    }

    if (promptDraftRef.current !== lastPromptOptimizationUndoState.appliedPrompt) {
      return;
    }

    if (
      !areDurationSuggestionSnapshotsEqual(
        durationSuggestion,
        lastPromptOptimizationUndoState.appliedDurationSuggestion
      )
    ) {
      return;
    }

    const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
    setLastPromptOptimizationUndoState(null);
    setPromptDraft(restoredPrompt);
    commitPromptDraft(
      restoredPrompt,
      toDurationSuggestionNodeData(lastPromptOptimizationUndoState.previousDurationSuggestion)
    );
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      const nextCursor = restoredPrompt.length;
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [commitPromptDraft, durationSuggestion, lastPromptOptimizationUndoState]);

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
        commitManualPromptDraft(nextText);
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
        event.stopPropagation();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImages.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        insertImageReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === '@' && incomingImages.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const cursor = event.currentTarget.selectionStart ?? promptDraftRef.current.length;
      openImagePickerAtCursor(cursor);
      return;
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      event.stopPropagation();
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void handleSubmit();
    }
  };

  const canUndoPromptOptimization = Boolean(
    lastPromptOptimizationUndoState
    && promptDraft === lastPromptOptimizationUndoState.appliedPrompt
    && areDurationSuggestionSnapshotsEqual(
      durationSuggestion,
      lastPromptOptimizationUndoState.appliedDurationSuggestion
    )
  );

  const hasDurationSuggestion = typeof durationSuggestion.suggestedDurationSeconds === 'number';
  const durationSuggestionText = useMemo(() => {
    if (isOptimizingPrompt) {
      return t('node.jimeng.durationSuggestionLoading');
    }

    if (!hasDurationSuggestion) {
      return t('node.jimeng.durationSuggestionIdle');
    }

    const suggestedSeconds = durationSuggestion.suggestedDurationSeconds ?? 15;
    const estimatedSeconds =
      durationSuggestion.suggestedDurationEstimatedSeconds ?? suggestedSeconds;

    if (durationSuggestion.suggestedDurationExceedsLimit) {
      return t('node.jimeng.durationSuggestionOverflow', {
        seconds: suggestedSeconds,
        estimated: estimatedSeconds,
      });
    }

    return t('node.jimeng.durationSuggestionLabel', {
      seconds: suggestedSeconds,
    });
  }, [
    durationSuggestion.suggestedDurationEstimatedSeconds,
    durationSuggestion.suggestedDurationExceedsLimit,
    durationSuggestion.suggestedDurationSeconds,
    hasDurationSuggestion,
    isOptimizingPrompt,
    t,
  ]);
  const durationSuggestionTitle = useMemo(() => {
    if (!durationSuggestion.suggestedDurationReason) {
      return undefined;
    }

    return durationSuggestion.suggestedDurationReason;
  }, [durationSuggestion.suggestedDurationReason]);
  const hidePromptReferencePreview = useCallback(() => {
    setPromptReferencePreview(null);
  }, []);

  const handlePromptReferenceTokenHover = useCallback((
    tokenIndex: number,
    event: ReactMouseEvent<HTMLSpanElement>
  ) => {
    const item = incomingImageItems[tokenIndex];
    const previewHost = promptPreviewHostRef.current;
    if (!item || !previewHost) {
      setPromptReferencePreview(null);
      return;
    }

    const previewHostRect = previewHost.getBoundingClientRect();
    const previewMaxWidth = 144;
    const previewMaxHeight = 132;
    const horizontalPadding = 12;
    const horizontalGap = 8;
    const verticalGap = 8;
    const maxLeft = Math.max(
      horizontalPadding,
      previewHostRect.width - previewMaxWidth - horizontalPadding
    );
    const preferredLeft = event.clientX - previewHostRect.left + horizontalGap;
    const preferredTop = event.clientY - previewHostRect.top + verticalGap;
    const maxTop = Math.max(
      horizontalPadding,
      previewHostRect.height - previewMaxHeight - horizontalPadding
    );

    setPromptReferencePreview({
      imageUrl: item.imageUrl,
      displayUrl: item.displayUrl,
      alt: item.label,
      left: Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft)),
      top: Math.max(horizontalPadding, Math.min(preferredTop, maxTop)),
    });
  }, [incomingImageItems]);

  const handlePromptReferenceTokenMouseDown = useCallback((
    tokenEnd: number,
    event: ReactMouseEvent<HTMLSpanElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(tokenEnd, tokenEnd);
      syncPromptHighlightScroll();
    });
  }, []);

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

      <div
        ref={promptPanelRef}
        className="relative flex min-h-0 flex-1 flex-col rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 px-4 py-3"
      >
        {incomingImageItems.length > 0 ? (
          <div className="mb-3 flex shrink-0 items-start gap-3 overflow-x-auto pb-1">
            {incomingImageItems.map((item, index) => (
              <button
                key={`${item.imageUrl}-reference-${index}`}
                type="button"
                draggable
                className={`nodrag flex shrink-0 cursor-grab items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors active:cursor-grabbing ${
                  dragOverReferenceIndex === index
                    ? 'border-accent/60 bg-white/[0.08]'
                    : 'border-white/10 bg-white/[0.03] hover:border-accent/35 hover:bg-white/[0.06]'
                } ${draggingReferenceIndex === index ? 'opacity-60' : ''}`}
                onMouseDown={(event) => event.stopPropagation()}
                onDragStart={(event) => handleReferenceImageDragStart(event, index)}
                onDragEnter={(event) => handleReferenceImageDragEnter(event, index)}
                onDragOver={handleReferenceImageDragOver}
                onDrop={(event) => handleReferenceImageDrop(event, index)}
                onDragEnd={handleReferenceImageDragEnd}
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

        <div ref={promptPreviewHostRef} className="relative min-h-0 flex-1">
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

          <div
            ref={promptHoverLayerRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-[15px] leading-7 text-transparent"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-1">
              {renderPromptReferenceHoverTargets(
                promptDraft,
                incomingImages.length,
                handlePromptReferenceTokenHover,
                hidePromptReferencePreview,
                handlePromptReferenceTokenMouseDown
              )}
            </div>
          </div>

          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              commitManualPromptDraft(nextValue);
            }}
            onKeyDownCapture={handlePromptKeyDown}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => {
              event.stopPropagation();
              hidePromptReferencePreview();
            }}
            placeholder={t('node.jimeng.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-1 text-[15px] leading-7 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />

          {promptReferencePreview ? (
            <div
              className="pointer-events-none absolute z-30 w-fit overflow-hidden rounded-xl shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
              style={{
                left: `${promptReferencePreview.left}px`,
                top: `${promptReferencePreview.top}px`,
              }}
            >
              <CanvasNodeImage
                src={promptReferencePreview.displayUrl}
                alt={promptReferencePreview.alt}
                viewerSourceUrl={resolveImageDisplayUrl(promptReferencePreview.imageUrl)}
                viewerImageList={incomingImageViewerList}
                className="block max-h-[132px] max-w-[144px] rounded-xl object-contain"
                draggable={false}
              />
            </div>
          ) : null}
        </div>

        {showImagePicker && incomingImageItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[156px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div
              className="ui-scrollbar nowheel max-h-[200px] overflow-y-auto"
              onWheelCapture={(event) => event.stopPropagation()}
              role="listbox"
            >
              {incomingImageItems.map((item, index) => (
                <button
                  key={`${item.imageUrl}-${index}`}
                  ref={(node) => {
                    pickerItemRefs.current[index] = node;
                  }}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertImageReference(index);
                  }}
                  onMouseEnter={() => setPickerActiveIndex(index)}
                  role="option"
                  aria-selected={pickerActiveIndex === index}
                  className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
                    pickerActiveIndex === index
                      ? 'border-accent/55 bg-white/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.22)]'
                      : ''
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
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-text-dark">
                      {item.tokenLabel}
                    </div>
                    <div className="truncate text-[11px] text-text-muted">
                      {item.label}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
          <div
            className={`min-h-[28px] max-w-[240px] text-[11px] leading-4 ${
              isOptimizingPrompt
                ? 'text-text-muted'
                : durationSuggestion.suggestedDurationExceedsLimit
                  ? 'text-red-300'
                  : hasDurationSuggestion
                    ? 'text-text-dark'
                    : 'text-text-muted'
            }`}
            title={durationSuggestionTitle}
          >
            {durationSuggestionText}
          </div>

          <div className="ml-auto min-w-0 text-right text-[11px] text-text-muted">
            {t('node.jimeng.referenceCount', { count: incomingImageItems.length })}
          </div>

          <UiButton
            type="button"
            variant="muted"
            size="sm"
            disabled={Boolean(data.isSubmitting) || isOptimizingPrompt || promptDraft.trim().length === 0}
            className="h-11 w-11 shrink-0 rounded-full !px-0"
            onClick={(event) => {
              event.stopPropagation();
              void handleOptimizePrompt();
            }}
            title={
              isOptimizingPrompt
                ? t('node.jimeng.optimizingPrompt')
                : t('node.jimeng.optimizePrompt')
            }
          >
            {isOptimizingPrompt ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" strokeWidth={2.2} />
            )}
          </UiButton>

          <UiButton
            type="button"
            variant="muted"
            size="sm"
            disabled={isOptimizingPrompt || !canUndoPromptOptimization}
            className="h-11 w-11 shrink-0 rounded-full !px-0"
            onClick={(event) => {
              event.stopPropagation();
              handleUndoOptimizedPrompt();
            }}
            title={t('node.jimeng.undoOptimizedPrompt')}
          >
            <Undo2 className="h-4 w-4" strokeWidth={2.2} />
          </UiButton>

          <UiButton
            type="button"
            variant="primary"
            size="sm"
            disabled={Boolean(data.isSubmitting) || isOpeningJimengChrome}
            className="h-11 w-11 shrink-0 rounded-full !px-0"
            onClick={(event) => {
              event.stopPropagation();
              void handleSubmit();
            }}
            title={
              isOpeningJimengChrome
                ? t('titleBar.jimengOpeningChrome')
                : data.isSubmitting
                  ? t('node.jimeng.submitting')
                  : t('node.jimeng.submit')
            }
          >
            {data.isSubmitting || isOpeningJimengChrome ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </UiButton>
        </div>
      </div>

      <UiModal
        isOpen={isManualSetupReminderOpen}
        title={t('node.jimeng.manualSetupReminderTitle')}
        onClose={() => setIsManualSetupReminderOpen(false)}
        widthClassName="w-[480px]"
        footer={(
          <UiButton
            type="button"
            variant="primary"
            onClick={() => setIsManualSetupReminderOpen(false)}
          >
            {t('node.jimeng.manualSetupReminderConfirm')}
          </UiButton>
        )}
      >
        <div className="space-y-3 text-sm leading-6 text-text-dark">
          <p>{t('node.jimeng.manualSetupReminderBody')}</p>
          <p className="text-text-muted">{t('node.jimeng.manualSetupReminderFootnote')}</p>
        </div>
      </UiModal>

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
