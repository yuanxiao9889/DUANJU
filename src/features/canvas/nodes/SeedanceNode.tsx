import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import {
  Image as ImageIcon,
  Loader2,
  Music4,
  Sparkles,
  TriangleAlert,
  Undo2,
  Video,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  UiButton,
  UiChipButton,
  UiLoadingOverlay,
  UiSelect,
} from "@/components/ui";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import { optimizeCanvasPrompt } from "@/features/canvas/application/promptOptimization";
import {
  buildShortReferenceToken,
  insertReferenceToken,
  removeTextRange,
} from "@/features/canvas/application/referenceTokenEditing";
import { formatVideoTime } from "@/features/canvas/application/videoData";
import {
  CANVAS_NODE_TYPES,
  SEEDANCE_NODE_DEFAULT_HEIGHT,
  SEEDANCE_NODE_DEFAULT_WIDTH,
  SEEDANCE_NODE_MIN_HEIGHT,
  SEEDANCE_NODE_MIN_WIDTH,
  SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  type SeedanceAspectRatio,
  type SeedanceDurationSeconds,
  type SeedanceInputMode,
  type SeedanceModelId,
  type SeedanceNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  useCanvasConnectedAudioReferences,
  useCanvasConnectedReferenceVisuals,
  useCanvasNodeById,
} from "@/features/canvas/hooks/useCanvasNodeGraph";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import { CameraTriggerIcon } from "@/features/canvas/ui/CameraTriggerIcon";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { ReferenceVisualChip } from "@/features/canvas/ui/ReferenceVisualChip";
import { ShotParamsPanel } from "@/features/canvas/ui/ShotParamsPanel";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from "@/features/canvas/ui/nodeControlStyles";
import {
  type PromptSelectionRange,
  insertShotParamToken,
} from "@/features/canvas/shot-params/shotParamsPrompt";
import { submitSeedanceVideoTask } from "@/features/seedance/application/seedanceVideoSubmission";
import {
  SEEDANCE_ASPECT_RATIO_OPTIONS,
  SEEDANCE_DURATION_OPTIONS,
  SEEDANCE_INPUT_MODE_OPTIONS,
  SEEDANCE_MODEL_OPTIONS,
  normalizeSeedanceAspectRatio,
  normalizeSeedanceDurationSeconds,
  normalizeSeedanceInputMode,
  normalizeSeedanceModelId,
} from "@/features/seedance/domain/seedanceOptions";
import { StyleTemplatePicker } from "@/features/project/StyleTemplatePicker";
import { appendStyleTemplatePrompt } from "@/features/project/styleTemplatePrompt";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";

type SeedanceNodeProps = NodeProps & {
  id: string;
  data: SeedanceNodeData;
  selected?: boolean;
};

interface ReferenceVisualItem {
  sourceEdgeId: string;
  sourceNodeId: string;
  kind: "image" | "video";
  referenceUrl: string;
  previewImageUrl: string | null;
  displayUrl: string | null;
  tokenLabel: string;
  label: string;
  durationSeconds: number | null;
}

interface ReferenceAudioItem {
  sourceEdgeId: string;
  sourceNodeId: string;
  audioUrl: string;
  mimeType: string | null;
  label: string;
  tokenLabel: string;
  durationSeconds: number | null;
}

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

interface FixedControlOption<T extends string | number> {
  value: T;
  label: string;
}

interface ReferencePickerItem {
  key: string;
  kind: "visual" | "audio";
  tokenLabel: string;
  label: string;
  insertToken: string;
  displayUrl?: string | null;
  previewKind?: "image" | "video";
  durationSeconds?: number | null;
}

interface PickerAnchor {
  left: number;
  top: number;
}

interface PromptReferencePreviewState {
  imageUrl: string | null;
  displayUrl: string | null;
  alt: string;
  kind: "image" | "video";
  durationSeconds: number | null;
  left: number;
  top: number;
}

interface SeedancePromptReferenceToken {
  start: number;
  end: number;
  token: string;
  value: number;
  kind: "visual" | "audio";
}

interface SeedancePromptTokenRange {
  start: number;
  end: number;
  blockStart: number;
  blockEnd: number;
}

const MAX_REFERENCE_IMAGE_COUNT = 9;
const MAX_REFERENCE_VIDEO_COUNT = 3;
const MAX_REFERENCE_AUDIO_COUNT = 3;
const MAX_REFERENCE_TOTAL_DURATION_SECONDS = 15;
const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;
const VIDEO_REFERENCE_TOKEN_PREFIX = "@视频";
const AUDIO_SHORT_REFERENCE_TOKEN_PREFIX = "@音";
const AUDIO_LONG_REFERENCE_TOKEN_PREFIX = "@音频";
const VISUAL_REFERENCE_TOKEN_PREFIXES = [
  "@图片",
  "@图",
  VIDEO_REFERENCE_TOKEN_PREFIX,
] as const;
const AUDIO_REFERENCE_TOKEN_PREFIXES = [
  AUDIO_LONG_REFERENCE_TOKEN_PREFIX,
  AUDIO_SHORT_REFERENCE_TOKEN_PREFIX,
] as const;

function formatTimestamp(
  timestamp: number | null | undefined,
  locale: string,
): string | null {
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function sumKnownDuration(
  items: Array<{ durationSeconds: number | null }>,
): number {
  return items.reduce((total, item) => {
    const duration = item.durationSeconds;
    if (
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return total;
    }

    return total + duration;
  }, 0);
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isAsciiDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function resolveMaxReferenceNumber(maxCount?: number): number {
  if (typeof maxCount !== "number" || !Number.isFinite(maxCount)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(maxCount));
}

function buildReferenceTokenWithPrefix(
  prefix: string,
  referenceNumber: number,
): string {
  return `${prefix}${referenceNumber}`;
}

function buildVideoReferenceToken(referenceIndex: number): string {
  return buildReferenceTokenWithPrefix(
    VIDEO_REFERENCE_TOKEN_PREFIX,
    referenceIndex + 1,
  );
}

function buildShortAudioReferenceToken(referenceIndex: number): string {
  return buildReferenceTokenWithPrefix(
    AUDIO_SHORT_REFERENCE_TOKEN_PREFIX,
    referenceIndex + 1,
  );
}

function resolveReferenceTokenPrefix(
  text: string,
  index: number,
  prefixes: readonly string[],
): string | null {
  for (const prefix of prefixes) {
    if (text.startsWith(prefix, index)) {
      return prefix;
    }
  }

  return null;
}

function findPromptReferenceTokensByPrefixes(
  text: string,
  maxReferenceCount: number | undefined,
  prefixes: readonly string[],
  kind: SeedancePromptReferenceToken["kind"],
): SeedancePromptReferenceToken[] {
  const tokens: SeedancePromptReferenceToken[] = [];
  const maxReferenceNumber = resolveMaxReferenceNumber(maxReferenceCount);

  for (let index = 0; index < text.length; index += 1) {
    const matchedPrefix = resolveReferenceTokenPrefix(text, index, prefixes);
    if (!matchedPrefix) {
      continue;
    }

    const digitsStart = index + matchedPrefix.length;
    if (!isAsciiDigit(text[digitsStart] ?? "")) {
      continue;
    }

    let digitsEnd = digitsStart;
    while (isAsciiDigit(text[digitsEnd] ?? "")) {
      digitsEnd += 1;
    }

    if (maxReferenceNumber === Number.POSITIVE_INFINITY) {
      const fullValue = Number(text.slice(digitsStart, digitsEnd));
      if (Number.isFinite(fullValue) && fullValue >= 1) {
        tokens.push({
          start: index,
          end: digitsEnd,
          token: text.slice(index, digitsEnd),
          value: fullValue,
          kind,
        });
        index = digitsEnd - 1;
      }
      continue;
    }

    let bestEnd = -1;
    let bestValue = 0;
    let rollingValue = 0;
    for (let cursor = digitsStart; cursor < digitsEnd; cursor += 1) {
      rollingValue = rollingValue * 10 + Number(text[cursor]);

      if (rollingValue >= 1 && rollingValue <= maxReferenceNumber) {
        bestEnd = cursor + 1;
        bestValue = rollingValue;
      }

      if (rollingValue > maxReferenceNumber) {
        break;
      }
    }

    if (bestEnd > 0) {
      tokens.push({
        start: index,
        end: bestEnd,
        token: text.slice(index, bestEnd),
        value: bestValue,
        kind,
      });
      index = bestEnd - 1;
    }
  }

  return tokens;
}

function findSeedancePromptReferenceTokens(
  prompt: string,
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
): SeedancePromptReferenceToken[] {
  return [
    ...findPromptReferenceTokensByPrefixes(
      prompt,
      maxVisualReferenceCount,
      VISUAL_REFERENCE_TOKEN_PREFIXES,
      "visual",
    ),
    ...findPromptReferenceTokensByPrefixes(
      prompt,
      maxAudioReferenceCount,
      AUDIO_REFERENCE_TOKEN_PREFIXES,
      "audio",
    ),
  ].sort((left, right) => left.start - right.start);
}

function findSeedancePromptTokenRanges(
  prompt: string,
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
): SeedancePromptTokenRange[] {
  return findSeedancePromptReferenceTokens(
    prompt,
    maxVisualReferenceCount,
    maxAudioReferenceCount,
  ).map((token) => ({
    start: token.start,
    end: token.end,
    blockStart:
      token.start > 0 && prompt[token.start - 1] === " "
        ? token.start - 1
        : token.start,
    blockEnd:
      token.end < prompt.length && prompt[token.end] === " "
        ? token.end + 1
        : token.end,
  }));
}

function resolveSeedanceReferenceAwareDeleteRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "backward" | "forward",
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
): { start: number; end: number } | null {
  const safeStart = clampIndex(
    Math.min(selectionStart, selectionEnd),
    0,
    text.length,
  );
  const safeEnd = clampIndex(
    Math.max(selectionStart, selectionEnd),
    0,
    text.length,
  );
  const tokenRanges = findSeedancePromptTokenRanges(
    text,
    maxVisualReferenceCount,
    maxAudioReferenceCount,
  );

  if (safeStart !== safeEnd) {
    let expandedStart = safeStart;
    let expandedEnd = safeEnd;
    let touchedToken = false;

    for (const tokenRange of tokenRanges) {
      if (
        tokenRange.blockEnd <= expandedStart ||
        tokenRange.blockStart >= expandedEnd
      ) {
        continue;
      }

      touchedToken = true;
      expandedStart = Math.min(expandedStart, tokenRange.blockStart);
      expandedEnd = Math.max(expandedEnd, tokenRange.blockEnd);
    }

    if (!touchedToken) {
      return null;
    }

    return {
      start: expandedStart,
      end: expandedEnd,
    };
  }

  const point = direction === "backward" ? Math.max(0, safeStart - 1) : safeStart;

  for (const tokenRange of tokenRanges) {
    if (point >= tokenRange.blockStart && point < tokenRange.blockEnd) {
      return {
        start: tokenRange.blockStart,
        end: tokenRange.blockEnd,
      };
    }
  }

  return null;
}

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number,
): PickerAnchor {
  const mirror = document.createElement("div");
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = "absolute";
  mirrorStyle.visibility = "hidden";
  mirrorStyle.pointerEvents = "none";
  mirrorStyle.whiteSpace = "pre-wrap";
  mirrorStyle.overflowWrap = "break-word";
  mirrorStyle.wordBreak = "break-word";
  mirrorStyle.boxSizing = computed.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.lineHeight = computed.lineHeight;
  mirrorStyle.letterSpacing = computed.letterSpacing;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.border = computed.border;

  mirror.textContent = textarea.value.slice(0, caretIndex);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || " ";
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
  caretIndex: number,
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(
      0,
      textareaRect.left - containerRect.left + caretOffset.left,
    ),
    top: Math.max(
      0,
      textareaRect.top - containerRect.top + caretOffset.top + PICKER_Y_OFFSET_PX,
    ),
  };
}

function renderPromptWithHighlights(
  prompt: string,
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
): ReactNode {
  if (!prompt) {
    return " ";
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findSeedancePromptReferenceTokens(
    prompt,
    maxVisualReferenceCount,
    maxAudioReferenceCount,
  );
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>
          {prompt.slice(lastIndex, token.start)}
        </span>,
      );
    }

    segments.push(
      <span
        key={`ref-${token.start}`}
        className="relative z-0 text-white [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor] before:absolute before:-inset-x-[4px] before:-inset-y-[1px] before:-z-10 before:rounded-[7px] before:bg-accent/55 before:content-['']"
      >
        {token.token}
      </span>,
    );
    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>,
    );
  }

  return segments;
}

function renderPromptReferenceHoverTargets(
  prompt: string,
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
  onTokenHover: (
    token: SeedancePromptReferenceToken,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void,
  onTokenLeave: () => void,
  onTokenMouseDown: (
    tokenEnd: number,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void,
): ReactNode {
  if (!prompt) {
    return " ";
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findSeedancePromptReferenceTokens(
    prompt,
    maxVisualReferenceCount,
    maxAudioReferenceCount,
  );
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`hover-plain-${lastIndex}`} className="text-transparent">
          {prompt.slice(lastIndex, token.start)}
        </span>,
      );
    }

    segments.push(
      <span
        key={`hover-${token.kind}-${token.start}`}
        className={`pointer-events-auto select-none text-transparent ${
          token.kind === "visual" ? "cursor-help" : "cursor-text"
        }`}
        onMouseEnter={(event) => onTokenHover(token, event)}
        onMouseMove={(event) => onTokenHover(token, event)}
        onMouseLeave={onTokenLeave}
        onMouseDown={(event) => onTokenMouseDown(token.end, event)}
      >
        {token.token}
      </span>,
    );

    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`hover-plain-${lastIndex}`} className="text-transparent">
        {prompt.slice(lastIndex)}
      </span>,
    );
  }

  return segments;
}

function buildSeedanceVideoResultNodeTitle(fallbackTitle: string): string {
  return fallbackTitle;
}

function FixedControlChip<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: FixedControlOption<T>[];
  onChange: (nextValue: T) => void;
}) {
  const chipRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={chipRef}
      className="flex h-7 min-w-[96px] shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="shrink-0 text-[10px] text-text-muted/90" title={label}>
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <UiSelect
          value={value}
          aria-label={label}
          menuAnchorRef={chipRef}
          className="nodrag !h-6 !w-full !rounded-md !border-0 !bg-transparent !px-0.5 !text-[10.5px] !font-medium hover:!border-0 focus-visible:!border-0 focus-visible:!shadow-none"
          onChange={(event) =>
            onChange(
              typeof value === "number"
                ? (Number(event.target.value) as T)
                : (event.target.value as T),
            )
          }
        >
          {options.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.label}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
}

function ReferenceVisualCard({ item }: { item: ReferenceVisualItem }) {
  return (
    <div className="flex w-[136px] shrink-0 self-start flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-2">
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <div className="aspect-[4/3] w-full">
          {item.displayUrl ? (
            <CanvasNodeImage
              src={item.displayUrl}
              alt={item.label}
              viewerSourceUrl={item.displayUrl}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              {item.kind === "video" ? (
                <Video className="h-5 w-5" />
              ) : (
                <ImageIcon className="h-5 w-5" />
              )}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
          {item.kind === "video" ? (
            <Video className="h-3.5 w-3.5" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5" />
          )}
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="truncate text-[11px] font-medium leading-4 text-text-dark">
          {item.label}
        </div>
        {item.kind === "video" && item.durationSeconds ? (
          <div className="text-[10px] leading-4 text-text-muted">
            {formatVideoTime(item.durationSeconds)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReferenceAudioChip({ item }: { item: ReferenceAudioItem }) {
  return (
    <div
      className="flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-text-dark"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Music4 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="rounded bg-white/[0.08] px-1 py-0.5 text-[10px] font-medium text-text-muted">
        {item.tokenLabel}
      </span>
      <span className="max-w-[104px] truncate">{item.label}</span>
      {item.durationSeconds ? (
        <span className="shrink-0 text-[10px] text-text-muted">
          {formatVideoTime(item.durationSeconds)}
        </span>
      ) : null}
    </div>
  );
}

export const SeedanceNode = memo(
  ({ id, data, selected, width }: SeedanceNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const connectedVisuals = useCanvasConnectedReferenceVisuals(id);
    const connectedAudios = useCanvasConnectedAudioReferences(id);
    const storyboardApiKeys = useSettingsStore((state) => state.storyboardApiKeys);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const highlightedReferenceSourceNodeId = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId,
    );
    const setHighlightedReferenceSourceNode = useCanvasStore(
      (state) => state.setHighlightedReferenceSourceNode,
    );
    const addEdge = useCanvasStore((state) => state.addEdge);
    const addNode = useCanvasStore((state) => state.addNode);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const isShotParamsPanelOpen = useCanvasStore(
      (state) => state.activeShotParamsPanelNodeId === id,
    );
    const toggleShotParamsPanel = useCanvasStore(
      (state) => state.toggleShotParamsPanel,
    );
    const closeShotParamsPanel = useCanvasStore(
      (state) => state.closeShotParamsPanel,
    );

    const apiKey = storyboardApiKeys.volcengine?.trim() ?? "";
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.seedance, data),
      [data],
    );
    const selectedInputMode = useMemo(
      () => normalizeSeedanceInputMode(data.inputMode),
      [data.inputMode],
    );
    const selectedModelId = useMemo(
      () => normalizeSeedanceModelId(data.modelId),
      [data.modelId],
    );
    const selectedAspectRatio = useMemo(
      () => normalizeSeedanceAspectRatio(data.aspectRatio),
      [data.aspectRatio],
    );
    const selectedDuration = useMemo(
      () => normalizeSeedanceDurationSeconds(data.durationSeconds),
      [data.durationSeconds],
    );
    const selectedResolution = "720p";
    const resolvedGenerateAudio = data.generateAudio ?? true;
    const resolvedReturnLastFrame = data.returnLastFrame ?? false;
    const resolvedWidth = Math.max(
      SEEDANCE_NODE_MIN_WIDTH,
      Math.round(width ?? SEEDANCE_NODE_DEFAULT_WIDTH),
    );
    const explicitHeight =
      typeof currentNode?.height === "number" &&
      Number.isFinite(currentNode.height)
        ? currentNode.height
        : typeof currentNode?.style?.height === "number" &&
            Number.isFinite(currentNode.style.height)
          ? currentNode.style.height
          : null;
    const hasExplicitHeight = typeof explicitHeight === "number";
    const resolvedHeight = hasExplicitHeight
      ? Math.max(SEEDANCE_NODE_MIN_HEIGHT, Math.round(explicitHeight))
      : SEEDANCE_NODE_DEFAULT_HEIGHT;
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const promptPreviewHostRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const promptHighlightRef = useRef<HTMLDivElement>(null);
    const promptHoverLayerRef = useRef<HTMLDivElement>(null);
    const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? "");
    const promptValueRef = useRef(promptDraft);
    const lastPromptSelectionRef = useRef<PromptSelectionRange | null>(null);
    const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [promptOptimizationError, setPromptOptimizationError] = useState<
      string | null
    >(null);
    const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] =
      useState<PromptOptimizationMeta | null>(null);
    const [
      lastPromptOptimizationUndoState,
      setLastPromptOptimizationUndoState,
    ] = useState<PromptOptimizationUndoState | null>(null);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [pickerCursor, setPickerCursor] = useState<number | null>(null);
    const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
    const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(
      PICKER_FALLBACK_ANCHOR,
    );
    const [promptReferencePreview, setPromptReferencePreview] =
      useState<PromptReferencePreviewState | null>(null);
    const [, setIsPromptTextSelectionActive] = useState(false);

    const referenceVisualItems = useMemo<ReferenceVisualItem[]>(
      () =>
        connectedVisuals.map((item, index) => {
          const previewSource =
            item.previewImageUrl?.trim() || item.referenceUrl.trim();
          return {
            sourceEdgeId: item.sourceEdgeId,
            sourceNodeId: item.sourceNodeId,
            kind: item.kind,
            referenceUrl: item.referenceUrl,
            previewImageUrl: item.previewImageUrl ?? null,
            displayUrl: previewSource
              ? resolveImageDisplayUrl(previewSource)
              : null,
            tokenLabel:
              item.kind === "video"
                ? buildVideoReferenceToken(index)
                : buildShortReferenceToken(index),
            label:
              item.kind === "video"
                ? t("node.seedance.referenceVideoLabel", {
                    index: index + 1,
                  })
                : t("node.seedance.referenceImageLabel", {
                    index: index + 1,
                  }),
            durationSeconds: item.durationSeconds ?? null,
          };
        }),
      [connectedVisuals, t],
    );

    const referenceAudioItems = useMemo<ReferenceAudioItem[]>(
      () =>
        connectedAudios.map((item, index) => ({
          sourceEdgeId: item.sourceEdgeId,
          sourceNodeId: item.sourceNodeId,
          audioUrl: item.audioUrl,
          mimeType: item.mimeType,
          label:
            item.displayName?.trim() ||
            item.audioFileName?.trim() ||
            t("node.seedance.audioReferenceLabel", {
              index: index + 1,
            }),
          tokenLabel: buildShortAudioReferenceToken(index),
          durationSeconds: item.durationSeconds ?? null,
        })),
      [connectedAudios, t],
    );
    const referencePickerItems = useMemo<ReferencePickerItem[]>(
      () => [
        ...referenceVisualItems.map((item) => ({
          key: `${item.referenceUrl}-${item.tokenLabel}`,
          kind: "visual" as const,
          tokenLabel: item.tokenLabel,
          label: item.label,
          insertToken: item.tokenLabel,
          displayUrl: item.displayUrl,
          previewKind: item.kind,
          durationSeconds: item.durationSeconds,
        })),
        ...referenceAudioItems.map((item) => ({
          key: `${item.audioUrl}-${item.tokenLabel}`,
          kind: "audio" as const,
          tokenLabel: item.tokenLabel,
          label: item.label,
          insertToken: item.tokenLabel,
        })),
      ],
      [referenceAudioItems, referenceVisualItems],
    );

    const imageReferences = useMemo(
      () => referenceVisualItems.filter((item) => item.kind === "image"),
      [referenceVisualItems],
    );
    const videoReferences = useMemo(
      () => referenceVisualItems.filter((item) => item.kind === "video"),
      [referenceVisualItems],
    );
    const referenceVideoDuration = useMemo(
      () => sumKnownDuration(videoReferences),
      [videoReferences],
    );
    const referenceAudioDuration = useMemo(
      () => sumKnownDuration(referenceAudioItems),
      [referenceAudioItems],
    );
    const lastSubmittedTime = useMemo(
      () => formatTimestamp(data.lastSubmittedAt, i18n.language),
      [data.lastSubmittedAt, i18n.language],
    );

    const headerStatus = useMemo(() => {
      if (data.isSubmitting) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.seedance.submitting")}
            tone="processing"
            animate
          />
        );
      }

      if (promptOptimizationError ?? data.lastError) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t("nodeStatus.error")}
            tone="danger"
            title={promptOptimizationError ?? data.lastError ?? undefined}
          />
        );
      }

      return null;
    }, [data.isSubmitting, data.lastError, promptOptimizationError, t]);

    const modeHintKey = `node.seedance.modeHints.${selectedInputMode}`;
    const shotParamsTriggerTitle = t("shotParams.trigger");

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      hasExplicitHeight,
      id,
      referenceAudioItems.length,
      referenceVisualItems.length,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
    ]);

    const updateSeedanceNodeData = useCallback(
      (patch: Partial<SeedanceNodeData>) => {
        updateNodeData(id, patch);
      },
      [id, updateNodeData],
    );

    const handlePromptChange = useCallback(
      (nextPrompt: string) => {
        setPromptDraft(nextPrompt);
        promptValueRef.current = nextPrompt;
        updateSeedanceNodeData({
          prompt: nextPrompt,
          lastError: null,
        });
      },
      [updateSeedanceNodeData],
    );

    const syncPromptTextSelectionState = useCallback(
      (textarea: HTMLTextAreaElement | null) => {
        if (!textarea) {
          setIsPromptTextSelectionActive(false);
          return;
        }

        setIsPromptTextSelectionActive(
          textarea.selectionStart !== textarea.selectionEnd,
        );
      },
      [],
    );

    const rememberPromptSelection = useCallback(
      (textarea: HTMLTextAreaElement | null) => {
        if (!textarea) {
          return;
        }

        const start = textarea.selectionStart ?? promptValueRef.current.length;
        const end = textarea.selectionEnd ?? start;
        lastPromptSelectionRef.current = { start, end };
        syncPromptTextSelectionState(textarea);
      },
      [syncPromptTextSelectionState],
    );

    const syncPromptHighlightScroll = useCallback(() => {
      if (!promptRef.current || !promptHighlightRef.current) {
        return;
      }

      promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
      promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
      if (promptHoverLayerRef.current) {
        promptHoverLayerRef.current.scrollTop = promptRef.current.scrollTop;
        promptHoverLayerRef.current.scrollLeft = promptRef.current.scrollLeft;
      }
    }, []);

    useEffect(() => {
      const externalPrompt = data.prompt ?? "";
      if (externalPrompt !== promptValueRef.current) {
        promptValueRef.current = externalPrompt;
        setPromptDraft(externalPrompt);
      }
    }, [data.prompt]);

    useEffect(() => {
      if (referencePickerItems.length === 0) {
        setShowImagePicker(false);
        setPickerCursor(null);
      }
    }, [referencePickerItems.length]);

    useEffect(() => {
      if (!showImagePicker) {
        return;
      }

      const activeItem = pickerItemRefs.current[pickerActiveIndex];
      activeItem?.scrollIntoView({ block: "nearest" });
    }, [pickerActiveIndex, showImagePicker]);

    useEffect(() => {
      if (!showImagePicker) {
        return;
      }

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (
          target &&
          (promptPanelRef.current?.contains(target) ||
            pickerItemRefs.current.some((item) => item?.contains(target)))
        ) {
          return;
        }

        setShowImagePicker(false);
        setPickerCursor(null);
      };

      window.addEventListener("mousedown", handlePointerDown);
      return () => {
        window.removeEventListener("mousedown", handlePointerDown);
      };
    }, [showImagePicker]);

    const insertReferenceItem = useCallback(
      (pickerIndex: number) => {
        const pickerItem = referencePickerItems[pickerIndex];
        if (!pickerItem) {
          return;
        }

        const cursor = pickerCursor ?? promptValueRef.current.length;
        const { nextText, nextCursor } = insertReferenceToken(
          promptValueRef.current,
          cursor,
          pickerItem.insertToken,
        );
        handlePromptChange(nextText);
        setShowImagePicker(false);
        setPickerCursor(null);
        setPickerActiveIndex(0);

        requestAnimationFrame(() => {
          const promptElement = promptRef.current;
          if (!promptElement) {
            return;
          }

          promptElement.focus();
          promptElement.setSelectionRange(nextCursor, nextCursor);
          lastPromptSelectionRef.current = { start: nextCursor, end: nextCursor };
          syncPromptHighlightScroll();
          syncPromptTextSelectionState(promptElement);
        });
      },
      [
        handlePromptChange,
        pickerCursor,
        referencePickerItems,
        syncPromptHighlightScroll,
        syncPromptTextSelectionState,
      ],
    );

    const handleShotParamInsert = useCallback(
      (value: string) => {
        const promptElement = promptRef.current;
        const fallbackCursor = promptValueRef.current.length;
        const selection =
          promptElement && document.activeElement === promptElement
            ? {
                start: promptElement.selectionStart ?? fallbackCursor,
                end: promptElement.selectionEnd ?? fallbackCursor,
              }
            : lastPromptSelectionRef.current ?? {
                start: fallbackCursor,
                end: fallbackCursor,
              };
        const { nextText, nextCursor } = insertShotParamToken(
          promptValueRef.current,
          selection,
          value,
        );
        handlePromptChange(nextText);

        requestAnimationFrame(() => {
          const nextPromptElement = promptRef.current;
          if (!nextPromptElement) {
            return;
          }

          nextPromptElement.focus();
          nextPromptElement.setSelectionRange(nextCursor, nextCursor);
          lastPromptSelectionRef.current = { start: nextCursor, end: nextCursor };
          syncPromptHighlightScroll();
          syncPromptTextSelectionState(nextPromptElement);
        });
      },
      [handlePromptChange, syncPromptHighlightScroll, syncPromptTextSelectionState],
    );

    const handleOptimizePrompt = useCallback(async () => {
      const sourcePrompt = promptValueRef.current;
      const currentPrompt = sourcePrompt.trim();
      if (!currentPrompt) {
        const message = t("node.seedance.promptRequired");
        updateSeedanceNodeData({ lastError: null });
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setIsOptimizingPrompt(true);
      setPromptOptimizationError(null);
      updateSeedanceNodeData({ lastError: null });

      try {
        const result = await optimizeCanvasPrompt({
          mode: "video",
          prompt: currentPrompt,
          referenceImages: referenceVisualItems
            .map((item) => item.previewImageUrl ?? item.referenceUrl)
            .filter((item): item is string => Boolean(item)),
        });
        if (promptValueRef.current !== sourcePrompt) {
          return;
        }

        const nextPrompt = result.prompt;
        setLastPromptOptimizationMeta({
          modelLabel: [result.context.provider, result.context.model]
            .filter(Boolean)
            .join(" / "),
          referenceImageCount: result.usedReferenceImages
            ? referenceVisualItems.length
            : 0,
        });
        if (nextPrompt !== sourcePrompt) {
          setLastPromptOptimizationUndoState({
            previousPrompt: sourcePrompt,
            appliedPrompt: nextPrompt,
          });
        } else {
          setLastPromptOptimizationUndoState(null);
        }

        handlePromptChange(nextPrompt);
        requestAnimationFrame(() => {
          const promptElement = promptRef.current;
          if (!promptElement) {
            return;
          }
          promptElement.focus();
          const cursor = nextPrompt.length;
          promptElement.setSelectionRange(cursor, cursor);
          syncPromptHighlightScroll();
          syncPromptTextSelectionState(promptElement);
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t("node.seedance.optimizePromptFailed");
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
      } finally {
        setIsOptimizingPrompt(false);
      }
    }, [
      handlePromptChange,
      referenceVisualItems,
      syncPromptHighlightScroll,
      syncPromptTextSelectionState,
      t,
      updateSeedanceNodeData,
    ]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (!lastPromptOptimizationUndoState) {
        return;
      }

      if (promptValueRef.current !== lastPromptOptimizationUndoState.appliedPrompt) {
        return;
      }

      const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
      setPromptOptimizationError(null);
      setLastPromptOptimizationMeta(null);
      setLastPromptOptimizationUndoState(null);
      handlePromptChange(restoredPrompt);
      requestAnimationFrame(() => {
        const promptElement = promptRef.current;
        if (!promptElement) {
          return;
        }
        promptElement.focus();
        const cursor = restoredPrompt.length;
        promptElement.setSelectionRange(cursor, cursor);
        syncPromptHighlightScroll();
        syncPromptTextSelectionState(promptElement);
      });
    }, [
      handlePromptChange,
      lastPromptOptimizationUndoState,
      syncPromptHighlightScroll,
      syncPromptTextSelectionState,
    ]);

    const hidePromptReferencePreview = useCallback(() => {
      setPromptReferencePreview(null);
    }, []);

    const handlePromptReferenceTokenHover = useCallback(
      (
        token: SeedancePromptReferenceToken,
        event: ReactMouseEvent<HTMLSpanElement>,
      ) => {
        if (token.kind !== "visual") {
          setPromptReferencePreview(null);
          return;
        }

        const item = referenceVisualItems[token.value - 1];
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
          previewHostRect.width - previewMaxWidth - horizontalPadding,
        );
        const maxTop = Math.max(
          horizontalPadding,
          previewHostRect.height - previewMaxHeight - horizontalPadding,
        );

        setPromptReferencePreview({
          imageUrl: item.previewImageUrl,
          displayUrl: item.displayUrl,
          alt: item.label,
          kind: item.kind,
          durationSeconds: item.durationSeconds,
          left: Math.max(
            horizontalPadding,
            Math.min(
              event.clientX - previewHostRect.left + horizontalGap,
              maxLeft,
            ),
          ),
          top: Math.max(
            horizontalPadding,
            Math.min(
              event.clientY - previewHostRect.top + verticalGap,
              maxTop,
            ),
          ),
        });
      },
      [referenceVisualItems],
    );

    const handlePromptReferenceTokenMouseDown = useCallback(
      (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        requestAnimationFrame(() => {
          const promptElement = promptRef.current;
          if (!promptElement) {
            return;
          }
          promptElement.focus();
          promptElement.setSelectionRange(tokenEnd, tokenEnd);
          syncPromptHighlightScroll();
          syncPromptTextSelectionState(promptElement);
        });
      },
      [syncPromptHighlightScroll, syncPromptTextSelectionState],
    );

    const handlePromptKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          const currentPrompt = promptValueRef.current;
          const selectionStart =
            event.currentTarget.selectionStart ?? currentPrompt.length;
          const selectionEnd =
            event.currentTarget.selectionEnd ?? selectionStart;
          const deletionDirection =
            event.key === "Backspace" ? "backward" : "forward";
          const deleteRange = resolveSeedanceReferenceAwareDeleteRange(
            currentPrompt,
            selectionStart,
            selectionEnd,
            deletionDirection,
            referenceVisualItems.length,
            referenceAudioItems.length,
          );
          if (deleteRange) {
            event.preventDefault();
            const { nextText, nextCursor } = removeTextRange(
              currentPrompt,
              deleteRange,
            );
            handlePromptChange(nextText);
            requestAnimationFrame(() => {
              const promptElement = promptRef.current;
              if (!promptElement) {
                return;
              }
              promptElement.focus();
              promptElement.setSelectionRange(nextCursor, nextCursor);
              syncPromptHighlightScroll();
              syncPromptTextSelectionState(promptElement);
            });
            return;
          }
        }

        if (showImagePicker && referencePickerItems.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex(
              (previous) => (previous + 1) % referencePickerItems.length,
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex((previous) =>
              previous === 0 ? referencePickerItems.length - 1 : previous - 1,
            );
            return;
          }

          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            insertReferenceItem(pickerActiveIndex);
            return;
          }
        }

        if (event.key === "@" && referencePickerItems.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const cursor =
            event.currentTarget.selectionStart ?? promptValueRef.current.length;
          setPickerAnchor(
            resolvePickerAnchor(
              promptPanelRef.current,
              event.currentTarget,
              cursor,
            ),
          );
          setPickerCursor(cursor);
          setShowImagePicker(true);
          setPickerActiveIndex(0);
          return;
        }

        if (event.key === "Escape" && showImagePicker) {
          event.preventDefault();
          event.stopPropagation();
          setShowImagePicker(false);
          setPickerCursor(null);
          setPickerActiveIndex(0);
          return;
        }

      },
      [
        handlePromptChange,
        insertReferenceItem,
        pickerActiveIndex,
        referenceAudioItems.length,
        referencePickerItems.length,
        referenceVisualItems.length,
        showImagePicker,
        syncPromptHighlightScroll,
        syncPromptTextSelectionState,
      ],
    );

    const validateGenerationRequest = useCallback((): string | null => {
      if (!apiKey) {
        return t("node.seedance.apiKeyRequired");
      }

      const prompt = promptDraft.trim();
      if (!prompt) {
        return t("node.seedance.promptRequired");
      }

      if (selectedInputMode === "textToVideo") {
        if (referenceVisualItems.length > 0 || referenceAudioItems.length > 0) {
          return t("node.seedance.textToVideoNoReferences");
        }
        return null;
      }

      if (selectedInputMode === "firstFrame") {
        if (videoReferences.length > 0 || referenceAudioItems.length > 0) {
          return t("node.seedance.firstFrameOnlySupportsImages");
        }
        if (imageReferences.length !== 1) {
          return t("node.seedance.firstFrameRequiresOneImage");
        }
        return null;
      }

      if (selectedInputMode === "firstLastFrame") {
        if (videoReferences.length > 0 || referenceAudioItems.length > 0) {
          return t("node.seedance.firstLastFrameOnlySupportsImages");
        }
        if (imageReferences.length !== 2) {
          return t("node.seedance.firstLastFrameRequiresTwoImages");
        }
        return null;
      }

      if (imageReferences.length + videoReferences.length === 0) {
        return referenceAudioItems.length > 0
          ? t("node.seedance.referenceAudioNeedsVisual")
          : t("node.seedance.referenceRequiresVisual");
      }

      if (imageReferences.length > MAX_REFERENCE_IMAGE_COUNT) {
        return t("node.seedance.referenceImageLimit", {
          count: MAX_REFERENCE_IMAGE_COUNT,
        });
      }

      if (videoReferences.length > MAX_REFERENCE_VIDEO_COUNT) {
        return t("node.seedance.referenceVideoLimit", {
          count: MAX_REFERENCE_VIDEO_COUNT,
        });
      }

      if (referenceAudioItems.length > MAX_REFERENCE_AUDIO_COUNT) {
        return t("node.seedance.referenceAudioLimit", {
          count: MAX_REFERENCE_AUDIO_COUNT,
        });
      }

      if (referenceVideoDuration > MAX_REFERENCE_TOTAL_DURATION_SECONDS) {
        return t("node.seedance.referenceVideoDurationLimit", {
          seconds: MAX_REFERENCE_TOTAL_DURATION_SECONDS,
        });
      }

      if (referenceAudioDuration > MAX_REFERENCE_TOTAL_DURATION_SECONDS) {
        return t("node.seedance.referenceAudioDurationLimit", {
          seconds: MAX_REFERENCE_TOTAL_DURATION_SECONDS,
        });
      }

      return null;
    }, [
      apiKey,
      imageReferences.length,
      promptDraft,
      referenceAudioDuration,
      referenceAudioItems.length,
      referenceVideoDuration,
      referenceVisualItems.length,
      selectedInputMode,
      t,
      videoReferences.length,
    ]);

    const handleGenerate = useCallback(async () => {
      closeShotParamsPanel();
      const validationError = validateGenerationRequest();
      if (validationError) {
        updateSeedanceNodeData({
          isSubmitting: false,
          lastError: validationError,
        });
        await showErrorDialog(validationError, t("common.error"));
        return;
      }

      const prompt = promptDraft.trim();
      const startedAt = Date.now();
      let createdResultNodeId: string | null = null;

      updateSeedanceNodeData({
        isSubmitting: true,
        lastError: null,
      });

      try {
        const resultNodePosition = findNodePosition(
          id,
          SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
          SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
        );
        createdResultNodeId = addNode(
          CANVAS_NODE_TYPES.seedanceVideoResult,
          resultNodePosition,
          {
            sourceNodeId: id,
            displayName: buildSeedanceVideoResultNodeTitle(
              t("node.seedance.resultNodeTitle"),
            ),
            taskId: null,
            taskStatus: null,
            taskUpdatedAt: null,
            modelId: selectedModelId,
            inputMode: selectedInputMode,
            videoUrl: null,
            previewImageUrl: null,
            videoFileName: null,
            aspectRatio: selectedAspectRatio,
            resolution: selectedResolution,
            duration: selectedDuration > 0 ? selectedDuration : undefined,
            generateAudio: resolvedGenerateAudio,
            returnLastFrame: resolvedReturnLastFrame,
            isGenerating: true,
            generationStartedAt: startedAt,
            generationDurationMs: 180000,
            lastGeneratedAt: null,
            lastError: null,
          },
          { inheritParentFromNodeId: id },
        );
        addEdge(id, createdResultNodeId);
        await flushCurrentProjectToDiskSafely(
          "creating Seedance video result node",
        );

        const submitResponse = await submitSeedanceVideoTask({
          apiKey,
          prompt,
          inputMode: selectedInputMode,
          modelId: selectedModelId,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedDuration,
          resolution: selectedResolution,
          generateAudio: resolvedGenerateAudio,
          returnLastFrame: resolvedReturnLastFrame,
          referenceImageSources: imageReferences.map((item) => item.referenceUrl),
          referenceVideoSources: videoReferences.map((item) => item.referenceUrl),
          referenceAudioSources: referenceAudioItems.map((item) => ({
            source: item.audioUrl,
            mimeType: item.mimeType,
          })),
          onSubmitted: async ({ taskId }) => {
            if (!createdResultNodeId) {
              return;
            }

            const submittedAt = Date.now();
            updateSeedanceNodeData({
              isSubmitting: false,
              lastSubmittedAt: submittedAt,
              lastError: null,
            });
            updateNodeData(createdResultNodeId, {
              taskId,
              taskStatus: "queued",
              taskUpdatedAt: submittedAt,
              isGenerating: true,
              generationStartedAt: startedAt,
              lastError: null,
            });
            void flushCurrentProjectToDiskSafely(
              "saving Seedance video task id",
            );
          },
        });

        const completedAt = Date.now();

        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            taskId: submitResponse.taskId,
            taskStatus: submitResponse.status,
            taskUpdatedAt: completedAt,
            modelId: selectedModelId,
            inputMode: selectedInputMode,
            generateAudio: resolvedGenerateAudio,
            returnLastFrame: resolvedReturnLastFrame,
            isGenerating: true,
            generationStartedAt: startedAt,
            lastError: null,
          });
        }

        await flushCurrentProjectToDiskSafely(
          "saving Seedance video task submission",
        );
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.seedance.submitFailed"),
        );
        updateSeedanceNodeData({
          isSubmitting: false,
          lastError: content.message,
        });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            lastError: content.message,
          });
        }
        await flushCurrentProjectToDiskSafely(
          "saving Seedance video generation error",
        );
        await showErrorDialog(
          content.message,
          t("common.error"),
          content.details,
        );
      }
    }, [
      addEdge,
      addNode,
      apiKey,
      closeShotParamsPanel,
      findNodePosition,
      id,
      imageReferences,
      promptDraft,
      referenceAudioItems,
      resolvedGenerateAudio,
      resolvedReturnLastFrame,
      selectedAspectRatio,
      selectedDuration,
      selectedInputMode,
      selectedModelId,
      selectedResolution,
      t,
      updateNodeData,
      updateSeedanceNodeData,
      validateGenerationRequest,
      videoReferences,
    ]);

    const translatedInputModeOptions = useMemo(
      () =>
        SEEDANCE_INPUT_MODE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const translatedModelOptions = useMemo(
      () =>
        SEEDANCE_MODEL_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const translatedAspectRatioOptions = useMemo(
      () =>
        SEEDANCE_ASPECT_RATIO_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const translatedDurationOptions = useMemo(
      () =>
        SEEDANCE_DURATION_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const combinedError = promptOptimizationError ?? data.lastError ?? null;
    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
        promptDraft === lastPromptOptimizationUndoState.appliedPrompt,
    );
    const promptOptimizationNotice = lastPromptOptimizationMeta
      ? `${t("node.seedance.optimizeModelLabel", {
          model: lastPromptOptimizationMeta.modelLabel,
        })} | ${t("node.seedance.optimizeReferenceImagesLabel", {
          status:
            lastPromptOptimizationMeta.referenceImageCount > 0
              ? t("node.seedance.optimizeReferenceImagesUsed", {
                  count: lastPromptOptimizationMeta.referenceImageCount,
                })
              : t("node.seedance.optimizeReferenceImagesUnused"),
        })}`
      : null;
    const statusInfoText =
      combinedError ??
      (data.isSubmitting
        ? t("node.seedance.submitting")
        : promptOptimizationNotice ??
          (lastSubmittedTime
            ? t("node.seedance.lastSubmitted", { time: lastSubmittedTime })
            : t(modeHintKey)));
    const showBlockingOverlay = Boolean(
      data.isSubmitting || data.isGenerating || isOptimizingPrompt,
    );
    const handleReferenceSourceHighlight = useCallback(
      (sourceNodeId: string) => {
        setHighlightedReferenceSourceNode(
          highlightedReferenceSourceNodeId === sourceNodeId ? null : sourceNodeId,
        );
      },
      [highlightedReferenceSourceNodeId, setHighlightedReferenceSourceNode],
    );
    const shotParamsButtonClassName = isShotParamsPanelOpen
      ? `${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !border-accent/55 !bg-accent/15 !px-0 justify-center text-accent shadow-[0_0_0_1px_rgba(59,130,246,0.18)]`
      : `${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`;

    return (
      <div
        className={`
          group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
          ${hasExplicitHeight ? "h-full" : ""}
          ${
            selected
              ? "border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]"
              : "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]"
          }
        `}
        style={{
          width: `${resolvedWidth}px`,
          height: `${resolvedHeight}px`,
        }}
        onClick={() => setSelectedNode(id)}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<Video className="h-3.5 w-3.5" />}
          titleText={resolvedTitle}
          rightSlot={headerStatus ?? undefined}
          editable
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
          <div className="min-h-0 flex-1">
            <div
              ref={promptPanelRef}
              className="relative min-h-0 flex-1 rounded-xl border border-white/10 bg-black/12 p-2"
            >
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div
                  ref={promptPreviewHostRef}
                  className="relative min-h-[148px] flex-1 overflow-hidden rounded-xl"
                >
                  <div
                    ref={promptHighlightRef}
                    aria-hidden="true"
                    className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
                    style={{ scrollbarGutter: "stable" }}
                  >
                    <div className="min-h-full whitespace-pre-wrap break-words px-3 py-2">
                      {renderPromptWithHighlights(
                        promptDraft,
                        referenceVisualItems.length,
                        referenceAudioItems.length,
                      )}
                    </div>
                  </div>

                  <div
                    ref={promptHoverLayerRef}
                    aria-hidden="true"
                    className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-sm leading-6 text-transparent"
                    style={{ scrollbarGutter: "stable" }}
                  >
                    <div className="min-h-full whitespace-pre-wrap break-words px-3 py-2">
                      {renderPromptReferenceHoverTargets(
                        promptDraft,
                        referenceVisualItems.length,
                        referenceAudioItems.length,
                        handlePromptReferenceTokenHover,
                        hidePromptReferencePreview,
                        handlePromptReferenceTokenMouseDown,
                      )}
                    </div>
                  </div>

                  <textarea
                    ref={promptRef}
                    value={promptDraft}
                    onChange={(event) => {
                      handlePromptChange(event.target.value);
                      rememberPromptSelection(event.currentTarget);
                    }}
                    placeholder={t("node.seedance.promptPlaceholder")}
                    className="ui-scrollbar nodrag nowheel relative z-10 h-full min-h-[148px] w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/70 focus:border-accent/50 whitespace-pre-wrap break-words selection:bg-accent/30 selection:text-transparent"
                    style={{ scrollbarGutter: "stable" }}
                    onScroll={syncPromptHighlightScroll}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      hidePromptReferencePreview();
                    }}
                    onSelect={(event) =>
                      rememberPromptSelection(event.currentTarget)
                    }
                    onMouseUp={(event) =>
                      rememberPromptSelection(event.currentTarget)
                    }
                    onKeyUp={(event) =>
                      rememberPromptSelection(event.currentTarget)
                    }
                    onBlur={() => setIsPromptTextSelectionActive(false)}
                    onKeyDownCapture={handlePromptKeyDown}
                  />

                  {promptReferencePreview ? (
                    <div
                      className="pointer-events-none absolute z-30 w-fit overflow-hidden rounded-xl shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
                      style={{
                        left: `${promptReferencePreview.left}px`,
                        top: `${promptReferencePreview.top}px`,
                      }}
                    >
                      <ReferenceVisualCard
                        item={{
                          sourceEdgeId: "",
                          sourceNodeId: "",
                          kind: promptReferencePreview.kind,
                          referenceUrl: promptReferencePreview.imageUrl ?? "",
                          previewImageUrl: promptReferencePreview.imageUrl,
                          displayUrl: promptReferencePreview.displayUrl,
                          label: promptReferencePreview.alt,
                          durationSeconds: promptReferencePreview.durationSeconds,
                          tokenLabel: "",
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2 py-2">
                  {referenceVisualItems.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {referenceVisualItems.map((item) => (
                        <ReferenceVisualChip
                          key={`${item.sourceEdgeId}-${item.referenceUrl}`}
                          kind={item.kind}
                          displayUrl={item.displayUrl}
                          label={item.label}
                          tokenLabel={item.tokenLabel}
                          metaLabel={
                            item.kind === "video"
                              ? (item.durationSeconds
                                  ? formatVideoTime(item.durationSeconds)
                                  : "VIDEO")
                              : null
                          }
                          isActive={
                            highlightedReferenceSourceNodeId === item.sourceNodeId
                          }
                          onMouseDown={(event) => {
                            event.stopPropagation();
                            if (event.button !== 0) {
                              return;
                            }
                            handleReferenceSourceHighlight(item.sourceNodeId);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}

                  {referenceAudioItems.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {referenceAudioItems.map((item) => (
                        <ReferenceAudioChip
                          key={`${item.sourceEdgeId}-${item.audioUrl}`}
                          item={item}
                        />
                      ))}
                    </div>
                  ) : null}

                  {referenceVisualItems.length === 0 &&
                  referenceAudioItems.length === 0 ? (
                    <div className="text-[11px] text-text-muted">
                      {t("node.seedance.noReferences")}
                    </div>
                  ) : null}
                </div>
              </div>

              {showImagePicker && referencePickerItems.length > 0 ? (
                <div
                  className="nowheel absolute z-30 w-[168px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
                  style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onWheelCapture={(event) => event.stopPropagation()}
                >
                  <div
                    className="ui-scrollbar nowheel max-h-[220px] overflow-y-auto"
                    onWheelCapture={(event) => event.stopPropagation()}
                    role="listbox"
                  >
                    {referencePickerItems.map((item, index) => (
                      <button
                        key={item.key}
                        ref={(node) => {
                          pickerItemRefs.current[index] = node;
                        }}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          insertReferenceItem(index);
                        }}
                        onMouseEnter={() => setPickerActiveIndex(index)}
                        role="option"
                        aria-selected={pickerActiveIndex === index}
                        className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
                          pickerActiveIndex === index
                            ? "border-accent/55 bg-white/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.22)]"
                            : ""
                        }`}
                      >
                        {item.kind === "visual" ? (
                          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
                            {item.displayUrl ? (
                              <CanvasNodeImage
                                src={item.displayUrl}
                                alt={item.label}
                                className="h-8 w-8 object-cover"
                                viewerSourceUrl={item.displayUrl}
                                disableViewer
                                draggable={false}
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded bg-white/[0.06] text-text-muted">
                                {item.previewKind === "video" ? (
                                  <Video className="h-4 w-4" />
                                ) : (
                                  <ImageIcon className="h-4 w-4" />
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/[0.06] text-text-muted">
                            <Music4 className="h-4 w-4" />
                          </div>
                        )}
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
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
                <FixedControlChip
                  label={t("node.seedance.modelLabel")}
                  value={selectedModelId}
                  options={translatedModelOptions}
                  onChange={(nextValue) =>
                    updateSeedanceNodeData({
                      modelId: nextValue as SeedanceModelId,
                      lastError: null,
                    })
                  }
                />
                <FixedControlChip
                  label={t("node.seedance.inputModeLabel")}
                  value={selectedInputMode}
                  options={translatedInputModeOptions}
                  onChange={(nextValue) =>
                    updateSeedanceNodeData({
                      inputMode: nextValue as SeedanceInputMode,
                      lastError: null,
                    })
                  }
                />
                <FixedControlChip
                  label={t("node.seedance.aspectRatioLabel")}
                  value={selectedAspectRatio}
                  options={translatedAspectRatioOptions}
                  onChange={(nextValue) =>
                    updateSeedanceNodeData({
                      aspectRatio: nextValue as SeedanceAspectRatio,
                    })
                  }
                />
                <FixedControlChip
                  label={t("node.seedance.durationLabel")}
                  value={selectedDuration}
                  options={translatedDurationOptions}
                  onChange={(nextValue) =>
                    updateSeedanceNodeData({
                      durationSeconds: nextValue as SeedanceDurationSeconds,
                    })
                  }
                />
                <StyleTemplatePicker
                  className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                  onTemplateApply={(template) => {
                    const nextPrompt = appendStyleTemplatePrompt(
                      promptValueRef.current,
                      template.prompt,
                    );
                    handlePromptChange(nextPrompt);
                    setLastPromptOptimizationMeta(null);
                    setLastPromptOptimizationUndoState(null);
                  }}
                />
                <UiChipButton
                  type="button"
                  active={isShotParamsPanelOpen}
                  className={shotParamsButtonClassName}
                  aria-label={shotParamsTriggerTitle}
                  title={shotParamsTriggerTitle}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleShotParamsPanel(id);
                  }}
                >
                  <CameraTriggerIcon
                    active={isShotParamsPanelOpen}
                    variant="video"
                    className="h-4 w-4 origin-center scale-[1.18]"
                  />
                </UiChipButton>
                <UiChipButton
                  type="button"
                  active={isOptimizingPrompt}
                  disabled={
                    isOptimizingPrompt || promptDraft.trim().length === 0
                  }
                  className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                  aria-label={
                    isOptimizingPrompt
                      ? t("node.seedance.optimizingPrompt")
                      : t("node.seedance.optimizePrompt")
                  }
                  title={
                    isOptimizingPrompt
                      ? t("node.seedance.optimizingPrompt")
                      : t("node.seedance.optimizePrompt")
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleOptimizePrompt();
                  }}
                >
                  <Wand2
                    className="h-4 w-4 origin-center scale-[1.18]"
                    strokeWidth={2.45}
                  />
                </UiChipButton>
                <UiChipButton
                  type="button"
                  disabled={isOptimizingPrompt || !canUndoPromptOptimization}
                  className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                  aria-label={t("node.seedance.undoOptimizedPrompt")}
                  title={t("node.seedance.undoOptimizedPrompt")}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleUndoOptimizedPrompt();
                  }}
                >
                  <Undo2
                    className="h-4 w-4 origin-center scale-[1.08]"
                    strokeWidth={2.3}
                  />
                </UiChipButton>
              </div>
            </div>

            <UiButton
              type="button"
              size="sm"
              variant="primary"
              disabled={Boolean(data.isSubmitting)}
              className={`${NODE_CONTROL_PRIMARY_BUTTON_CLASS} shrink-0`}
              onClick={(event) => {
                event.stopPropagation();
                void handleGenerate();
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2.3} />
              {data.isSubmitting
                ? t("node.seedance.submitting")
                : t("node.seedance.submit")}
            </UiButton>
          </div>

          <div
            className={`min-h-[16px] truncate text-[10px] leading-4 ${
              combinedError ? "text-rose-300" : "text-text-muted"
            }`}
            title={statusInfoText}
          >
            {statusInfoText}
          </div>
        </div>

        {isShotParamsPanelOpen ? (
          <ShotParamsPanel
            onClose={closeShotParamsPanel}
            onInsert={(option) => handleShotParamInsert(option.value)}
          />
        ) : null}

        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
        />
        <Handle
          type="source"
          id="source"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
        />
        <NodeResizeHandle
          minWidth={SEEDANCE_NODE_MIN_WIDTH}
          minHeight={SEEDANCE_NODE_MIN_HEIGHT}
        />
        <UiLoadingOverlay
          visible={showBlockingOverlay}
          insetClassName="inset-3"
          backdropClassName="bg-transparent"
          variant="bare"
        />
      </div>
    );
  },
);

SeedanceNode.displayName = "SeedanceNode";
