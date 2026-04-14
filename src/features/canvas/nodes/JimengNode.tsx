import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
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
  AudioLines,
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Video,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiLoadingOverlay } from "@/components/ui";
import {
  CANVAS_NODE_TYPES,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  type JimengAspectRatio,
  type JimengDurationSeconds,
  type JimengNodeData,
  type JimengReferenceMode,
  type JimengVideoModelId,
  type JimengVideoResolution,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import {
  useCanvasConnectedAudioReferences,
  useCanvasConnectedReferenceVisuals,
} from "@/features/canvas/hooks/useCanvasNodeGraph";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import {
  optimizeCanvasPrompt,
  type PromptDurationRecommendation,
} from "@/features/canvas/application/promptOptimization";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import { ReferenceVisualChip } from "@/features/canvas/ui/ReferenceVisualChip";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from "@/features/canvas/ui/nodeControlStyles";
import { UiButton, UiChipButton, UiSelect } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateJimengVideos } from "@/features/jimeng/application/jimengVideoSubmission";
import {
  ensureDreaminaCliReady,
  resolveDreaminaSetupBlockedMessage,
} from "@/features/jimeng/application/dreaminaSetup";
import {
  areReferenceImageOrdersEqual,
  buildShortReferenceToken,
  LONG_REFERENCE_TOKEN_PREFIX,
  SHORT_REFERENCE_TOKEN_PREFIX,
  insertReferenceToken,
  removeTextRange,
} from "@/features/canvas/application/referenceTokenEditing";
import {
  JIMENG_ASPECT_RATIO_OPTIONS,
  JIMENG_DURATION_OPTIONS,
  JIMENG_REFERENCE_MODE_OPTIONS,
  JIMENG_VIDEO_MODEL_OPTIONS,
  normalizeJimengReferenceMode,
  normalizeJimengVideoModel,
  resolveJimengVideoRequiredReferenceImageCount,
} from "@/features/jimeng/domain/jimengOptions";
import { StyleTemplatePicker } from "@/features/project/StyleTemplatePicker";
import { applyStyleTemplatePrompt } from "@/features/project/styleTemplatePrompt";
import { JimengVideoQueueScheduleModal } from "@/features/jimeng/ui/JimengVideoQueueScheduleModal";
import { useProjectStore } from "@/stores/projectStore";
import { useJimengVideoQueueStore } from "@/stores/jimengVideoQueueStore";

type JimengNodeProps = NodeProps & {
  id: string;
  data: JimengNodeData;
  selected?: boolean;
};

interface PromptDurationSuggestionSnapshot {
  suggestedDurationSeconds: number | null;
  suggestedDurationEstimatedSeconds: number | null;
  suggestedDurationExceedsLimit: boolean;
  suggestedDurationReason: string | null;
}

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
  previousDurationSuggestion: PromptDurationSuggestionSnapshot;
  appliedDurationSuggestion: PromptDurationSuggestionSnapshot;
}

interface FixedControlOption<T extends string | number> {
  value: T;
  label: string;
}

interface IncomingReferenceVisualItem {
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

interface IncomingAudioItem {
  audioUrl: string;
  label: string;
  tokenLabel: string;
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

function ReferenceVisualThumbnail({
  kind,
  displayUrl,
  label,
  durationSeconds,
  imageClassName,
  placeholderClassName,
  viewerImageList,
  disableViewer = false,
  showVideoBadge = true,
}: {
  kind: "image" | "video";
  displayUrl: string | null;
  label: string;
  durationSeconds: number | null;
  imageClassName: string;
  placeholderClassName: string;
  viewerImageList?: string[];
  disableViewer?: boolean;
  showVideoBadge?: boolean;
}) {
  if (displayUrl) {
    return (
      <>
        <CanvasNodeImage
          src={displayUrl}
          alt={label}
          viewerSourceUrl={displayUrl}
          viewerImageList={viewerImageList}
          className={imageClassName}
          draggable={false}
          disableViewer={disableViewer}
        />
        {kind === "video" && showVideoBadge ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center rounded-b-md bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
            <span className="inline-flex items-center gap-1 truncate">
              <Video className="h-2.5 w-2.5 shrink-0" />
              {formatReferenceDuration(durationSeconds) ?? "VIDEO"}
            </span>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={placeholderClassName}>
      {kind === "video" ? (
        <>
          <Video className="h-4 w-4" />
          <span className="text-[9px] font-medium uppercase tracking-[0.12em]">
            {formatReferenceDuration(durationSeconds) ?? "VIDEO"}
          </span>
        </>
      ) : (
        <span className="text-[10px] font-medium uppercase tracking-[0.12em]">
          IMG
        </span>
      )}
    </div>
  );
}

interface DragReferencePreviewState {
  left: number;
  top: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  containerLeft: number;
  containerTop: number;
}

interface JimengPromptReferenceToken {
  start: number;
  end: number;
  token: string;
  value: number;
  kind: "visual" | "audio";
}

interface JimengPromptTokenRange {
  start: number;
  end: number;
  blockStart: number;
  blockEnd: number;
}

const JIMENG_NODE_DEFAULT_WIDTH = 920;
const JIMENG_NODE_DEFAULT_HEIGHT = 500;
const JIMENG_NODE_MIN_WIDTH = 820;
const JIMENG_NODE_MIN_HEIGHT = 420;
const JIMENG_NODE_MAX_WIDTH = 1320;
const JIMENG_NODE_MAX_HEIGHT = 1040;
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_DURATION: JimengDurationSeconds = 5;
const DEFAULT_VIDEO_RESOLUTION = "1080p";
const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;
const MAX_REFERENCE_VIDEO_DURATION_SECONDS = 15;
const MAX_REFERENCE_VIDEO_COUNT = 3;
const VIDEO_REFERENCE_TOKEN_PREFIX = "@视频";
const VISUAL_REFERENCE_TOKEN_PREFIXES = [
  LONG_REFERENCE_TOKEN_PREFIX,
  SHORT_REFERENCE_TOKEN_PREFIX,
  VIDEO_REFERENCE_TOKEN_PREFIX,
] as const;
const AUDIO_SHORT_REFERENCE_TOKEN_PREFIX = "@音";
const AUDIO_LONG_REFERENCE_TOKEN_PREFIX = "@音频";
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

function buildJimengVideoResultNodeTitle(fallbackTitle: string): string {
  return fallbackTitle;
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

function buildClearedDurationSuggestionSnapshot(): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds: null,
    suggestedDurationEstimatedSeconds: null,
    suggestedDurationExceedsLimit: false,
    suggestedDurationReason: null,
  };
}

function readDurationSuggestionSnapshot(
  data: JimengNodeData,
): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds:
      typeof data.suggestedDurationSeconds === "number"
        ? data.suggestedDurationSeconds
        : null,
    suggestedDurationEstimatedSeconds:
      typeof data.suggestedDurationEstimatedSeconds === "number"
        ? data.suggestedDurationEstimatedSeconds
        : null,
    suggestedDurationExceedsLimit: data.suggestedDurationExceedsLimit === true,
    suggestedDurationReason:
      typeof data.suggestedDurationReason === "string" &&
      data.suggestedDurationReason.trim().length > 0
        ? data.suggestedDurationReason.trim()
        : null,
  };
}

function buildDurationSuggestionSnapshot(
  recommendation: PromptDurationRecommendation | null | undefined,
): PromptDurationSuggestionSnapshot {
  if (!recommendation) {
    return buildClearedDurationSuggestionSnapshot();
  }

  return {
    suggestedDurationSeconds: recommendation.recommendedDurationSeconds,
    suggestedDurationEstimatedSeconds: recommendation.estimatedDurationSeconds,
    suggestedDurationExceedsLimit: recommendation.exceedsMaxDuration,
    suggestedDurationReason:
      typeof recommendation.reason === "string" &&
      recommendation.reason.trim().length > 0
        ? recommendation.reason.trim()
        : null,
  };
}

function toDurationSuggestionNodeData(
  snapshot: PromptDurationSuggestionSnapshot,
): Partial<JimengNodeData> {
  return {
    suggestedDurationSeconds: snapshot.suggestedDurationSeconds,
    suggestedDurationEstimatedSeconds:
      snapshot.suggestedDurationEstimatedSeconds,
    suggestedDurationExceedsLimit: snapshot.suggestedDurationExceedsLimit,
    suggestedDurationReason: snapshot.suggestedDurationReason,
  };
}

function areDurationSuggestionSnapshotsEqual(
  left: PromptDurationSuggestionSnapshot,
  right: PromptDurationSuggestionSnapshot,
): boolean {
  return (
    left.suggestedDurationSeconds === right.suggestedDurationSeconds &&
    left.suggestedDurationEstimatedSeconds ===
      right.suggestedDurationEstimatedSeconds &&
    left.suggestedDurationExceedsLimit ===
      right.suggestedDurationExceedsLimit &&
    left.suggestedDurationReason === right.suggestedDurationReason
  );
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
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
  mirrorStyle.textTransform = computed.textTransform;
  mirrorStyle.textIndent = computed.textIndent;

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
      textareaRect.top -
        containerRect.top +
        caretOffset.top +
        PICKER_Y_OFFSET_PX,
    ),
  };
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveMaxReferenceNumber(maxCount?: number): number {
  if (typeof maxCount !== "number" || !Number.isFinite(maxCount)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(maxCount));
}

function isAsciiDigit(char: string): boolean {
  return char >= "0" && char <= "9";
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

function buildShortAudioReferenceToken(referenceIndex: number): string {
  return `${AUDIO_SHORT_REFERENCE_TOKEN_PREFIX}${referenceIndex + 1}`;
}

function findPromptReferenceTokensByPrefixes(
  text: string,
  maxReferenceCount: number | undefined,
  prefixes: readonly string[],
  kind: JimengPromptReferenceToken["kind"],
): JimengPromptReferenceToken[] {
  const tokens: JimengPromptReferenceToken[] = [];
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

function findJimengPromptReferenceTokens(
  prompt: string,
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
): JimengPromptReferenceToken[] {
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

function findJimengPromptTokenRanges(
  prompt: string,
  maxVisualReferenceCount: number,
  maxAudioReferenceCount: number,
): JimengPromptTokenRange[] {
  return findJimengPromptReferenceTokens(
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

function remapJimengVisualReferenceTokensByOrder(
  text: string,
  previousReferenceUrls: string[],
  nextReferenceUrls: string[],
): string {
  if (
    !text ||
    previousReferenceUrls.length === 0 ||
    nextReferenceUrls.length === 0 ||
    areReferenceImageOrdersEqual(previousReferenceUrls, nextReferenceUrls)
  ) {
    return text;
  }

  const nextReferencePositionQueues = new Map<string, number[]>();
  nextReferenceUrls.forEach((referenceUrl, index) => {
    const existingQueue = nextReferencePositionQueues.get(referenceUrl);
    if (existingQueue) {
      existingQueue.push(index);
      return;
    }

    nextReferencePositionQueues.set(referenceUrl, [index]);
  });

  const previousToNextReferenceIndexes = previousReferenceUrls.map(
    (referenceUrl) => {
      const positionQueue = nextReferencePositionQueues.get(referenceUrl);
      if (!positionQueue || positionQueue.length === 0) {
        return -1;
      }

      return positionQueue.shift() ?? -1;
    },
  );

  const referenceTokens = findPromptReferenceTokensByPrefixes(
    text,
    undefined,
    VISUAL_REFERENCE_TOKEN_PREFIXES,
    "visual",
  );
  if (referenceTokens.length === 0) {
    return text;
  }

  let nextText = text;
  for (let index = referenceTokens.length - 1; index >= 0; index -= 1) {
    const token = referenceTokens[index];
    const previousReferenceIndex = token.value - 1;
    if (
      previousReferenceIndex < 0 ||
      previousReferenceIndex >= previousToNextReferenceIndexes.length
    ) {
      continue;
    }

    const nextReferenceIndex =
      previousToNextReferenceIndexes[previousReferenceIndex];
    if (nextReferenceIndex < 0) {
      continue;
    }

    const tokenPrefix =
      resolveReferenceTokenPrefix(
        token.token,
        0,
        VISUAL_REFERENCE_TOKEN_PREFIXES,
      ) ?? SHORT_REFERENCE_TOKEN_PREFIX;
    const nextToken = buildReferenceTokenWithPrefix(
      tokenPrefix,
      nextReferenceIndex + 1,
    );
    if (nextToken === token.token) {
      continue;
    }

    nextText = `${nextText.slice(0, token.start)}${nextToken}${nextText.slice(token.end)}`;
  }

  return nextText;
}

function resolveJimengReferenceAwareDeleteRange(
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
  const tokenRanges = findJimengPromptTokenRanges(
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

  const point =
    direction === "backward" ? Math.max(0, safeStart - 1) : safeStart;

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

function formatReferenceDuration(
  durationSeconds: number | null | undefined,
): string | null {
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return null;
  }

  return Number.isInteger(durationSeconds)
    ? `${durationSeconds}s`
    : `${durationSeconds.toFixed(1)}s`;
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
  const referenceTokens = findJimengPromptReferenceTokens(
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
    token: JimengPromptReferenceToken,
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
  const referenceTokens = findJimengPromptReferenceTokens(
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

function resolveOrderedReferenceImages(
  imageUrls: string[],
  preferredOrder: string[] | undefined,
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
      className="flex h-7 min-w-[100px] shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
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

function buildDurationSuggestionText(
  snapshot: PromptDurationSuggestionSnapshot,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (typeof snapshot.suggestedDurationSeconds !== "number") {
    return null;
  }

  if (
    snapshot.suggestedDurationExceedsLimit &&
    typeof snapshot.suggestedDurationEstimatedSeconds === "number"
  ) {
    return t("node.jimeng.durationSuggestionOverflow", {
      seconds: snapshot.suggestedDurationSeconds,
      estimated: snapshot.suggestedDurationEstimatedSeconds,
    });
  }

  return t("node.jimeng.durationSuggestionLabel", {
    seconds: snapshot.suggestedDurationSeconds,
  });
}

function resolveJimengVideoModelOptionKey(model: JimengVideoModelId): string {
  switch (model) {
    case "seedance2.0fast":
      return "seedance20fast";
    case "seedance2.0":
      return "seedance20";
    case "seedance2.0fast_vip":
      return "seedance20fastVip";
    case "seedance2.0_vip":
      return "seedance20Vip";
    case "3.5pro":
      return "v3_5pro";
    case "3.0pro":
      return "v3_0pro";
    case "3.0fast":
      return "v3_0fast";
    case "3.0":
    default:
      return "v3_0";
  }
}

function resolveJimengVideoModelDurationRange(
  model: JimengVideoModelId,
): string {
  if (model === "3.0" || model === "3.0fast" || model === "3.0pro") {
    return "3-10s";
  }
  if (model === "3.5pro") {
    return "4-12s";
  }
  return "4-15s";
}

function isJimengSeedanceTwoFamilyModel(model: JimengVideoModelId): boolean {
  return (
    model === "seedance2.0" ||
    model === "seedance2.0fast" ||
    model === "seedance2.0_vip" ||
    model === "seedance2.0fast_vip"
  );
}

function resolveJimengCliEffectiveVideoModel(
  command:
    | "text2video"
    | "image2video"
    | "frames2video"
    | "multiframe2video"
    | "multimodal2video",
  selectedModel: JimengVideoModelId,
): JimengVideoModelId | null {
  if (command === "text2video" || command === "multimodal2video") {
    return isJimengSeedanceTwoFamilyModel(selectedModel)
      ? selectedModel
      : "seedance2.0fast";
  }

  if (command === "frames2video") {
    return selectedModel === "3.0" ||
      selectedModel === "3.5pro" ||
      isJimengSeedanceTwoFamilyModel(selectedModel)
      ? selectedModel
      : "seedance2.0fast";
  }

  if (command === "image2video") {
    return selectedModel;
  }

  return null;
}

export const JimengNode = memo(
  ({ id, data, selected, width, height }: JimengNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const rootRef = useRef<HTMLDivElement>(null);
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const promptPreviewHostRef = useRef<HTMLDivElement>(null);
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
    const [selectedStyleTemplateId, setSelectedStyleTemplateId] = useState<
      string | null
    >(null);
    const [styleTemplatePrompt, setStyleTemplatePrompt] = useState("");
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const promptHighlightRef = useRef<HTMLDivElement>(null);
    const promptHoverLayerRef = useRef<HTMLDivElement>(null);
    const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? "");
    const promptValueRef = useRef(promptDraft);
    const previousOrderedReferenceImagesRef = useRef<string[] | null>(null);
    const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [pickerCursor, setPickerCursor] = useState<number | null>(null);
    const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
    const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(
      PICKER_FALLBACK_ANCHOR,
    );
    const [promptReferencePreview, setPromptReferencePreview] =
      useState<PromptReferencePreviewState | null>(null);
    const [, setIsPromptTextSelectionActive] = useState(false);
    const [draggingReferenceIndex, setDraggingReferenceIndex] = useState<
      number | null
    >(null);
    const [dragOverReferenceIndex, setDragOverReferenceIndex] = useState<
      number | null
    >(null);
    const [dragReferencePreview, setDragReferencePreview] =
      useState<DragReferencePreviewState | null>(null);
    const [showQueueScheduleModal, setShowQueueScheduleModal] = useState(false);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const highlightedReferenceSourceNodeId = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId,
    );
    const setHighlightedReferenceSourceNode = useCanvasStore(
      (state) => state.setHighlightedReferenceSourceNode,
    );
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const deleteEdge = useCanvasStore((state) => state.deleteEdge);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const setLastJimengVideoDefaults = useSettingsStore(
      (state) => state.setLastJimengVideoDefaults,
    );
    const currentProjectId = useProjectStore((state) => state.currentProjectId);
    const enqueueJimengQueueJob = useJimengVideoQueueStore(
      (state) => state.enqueueJob,
    );

    const connectedReferenceVisuals = useCanvasConnectedReferenceVisuals(id);
    const incomingReferenceVisualUrls = useMemo(
      () => connectedReferenceVisuals.map((item) => item.referenceUrl),
      [connectedReferenceVisuals],
    );
    const orderedReferenceVisualUrls = useMemo(
      () =>
        resolveOrderedReferenceImages(
          incomingReferenceVisualUrls,
          data.referenceImageOrder,
        ),
      [data.referenceImageOrder, incomingReferenceVisualUrls],
    );
    const connectedReferenceVisualByUrl = useMemo(
      () =>
        new Map(
          connectedReferenceVisuals.map(
            (item) => [item.referenceUrl, item] as const,
          ),
        ),
      [connectedReferenceVisuals],
    );
    const incomingVisualItems = useMemo<IncomingReferenceVisualItem[]>(
      () =>
        orderedReferenceVisualUrls
          .map((referenceUrl, index) => {
            const connectedItem =
              connectedReferenceVisualByUrl.get(referenceUrl);
            if (!connectedItem) {
              return null;
            }

            return {
              sourceEdgeId: connectedItem.sourceEdgeId,
              sourceNodeId: connectedItem.sourceNodeId,
              kind: connectedItem.kind,
              referenceUrl,
              previewImageUrl: connectedItem.previewImageUrl,
              displayUrl: connectedItem.previewImageUrl
                ? resolveImageDisplayUrl(connectedItem.previewImageUrl)
                : null,
              tokenLabel:
                connectedItem.kind === "video"
                  ? buildVideoReferenceToken(index)
                  : buildShortReferenceToken(index),
              label: t(
                connectedItem.kind === "video"
                  ? "node.jimeng.referenceVideoLabel"
                  : "node.jimeng.referenceImageLabel",
                { index: index + 1 },
              ),
              durationSeconds: connectedItem.durationSeconds ?? null,
            };
          })
          .filter((item): item is IncomingReferenceVisualItem => Boolean(item)),
      [connectedReferenceVisualByUrl, orderedReferenceVisualUrls, t],
    );
    const incomingVisualDisplayList = useMemo(
      () =>
        incomingVisualItems
          .map((item) => item.displayUrl)
          .filter((item): item is string => Boolean(item)),
      [incomingVisualItems],
    );
    const connectedAudioReferences = useCanvasConnectedAudioReferences(id);
    const incomingAudios = useMemo<IncomingAudioItem[]>(
      () =>
        connectedAudioReferences.map((item, index) => ({
          audioUrl: item.audioUrl,
          label:
            item.displayName ||
            item.audioFileName ||
            t("node.jimeng.audioReferenceLabel", { index: index + 1 }),
          tokenLabel: buildShortAudioReferenceToken(index),
        })),
      [connectedAudioReferences, t],
    );
    const referencePickerItems = useMemo<ReferencePickerItem[]>(
      () => [
        ...incomingVisualItems.map((item) => ({
          key: `${item.referenceUrl}-${item.tokenLabel}`,
          kind: "visual" as const,
          tokenLabel: item.tokenLabel,
          label: item.label,
          insertToken: item.tokenLabel,
          displayUrl: item.displayUrl,
          previewKind: item.kind,
          durationSeconds: item.durationSeconds,
        })),
        ...incomingAudios.map((item) => ({
          key: `${item.audioUrl}-${item.tokenLabel}`,
          kind: "audio" as const,
          tokenLabel: item.tokenLabel,
          label: item.label,
          insertToken: item.tokenLabel,
        })),
      ],
      [incomingAudios, incomingVisualItems],
    );
    const referenceImageSources = useMemo(
      () =>
        incomingVisualItems
          .filter((item) => item.kind === "image")
          .map((item) => item.referenceUrl),
      [incomingVisualItems],
    );
    const referenceVideoSources = useMemo(
      () =>
        incomingVisualItems
          .filter((item) => item.kind === "video")
          .map((item) => item.referenceUrl),
      [incomingVisualItems],
    );
    const draggedReferenceItem = useMemo(
      () =>
        draggingReferenceIndex !== null
          ? (incomingVisualItems[draggingReferenceIndex] ?? null)
          : null,
      [draggingReferenceIndex, incomingVisualItems],
    );
    const hasReferenceVideos = referenceVideoSources.length > 0;
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimeng, data),
      [data],
    );
    const resolvedWidth = Math.max(
      JIMENG_NODE_MIN_WIDTH,
      Math.min(
        JIMENG_NODE_MAX_WIDTH,
        Math.round(width ?? JIMENG_NODE_DEFAULT_WIDTH),
      ),
    );
    const resolvedHeight = Math.max(
      JIMENG_NODE_MIN_HEIGHT,
      Math.min(
        JIMENG_NODE_MAX_HEIGHT,
        Math.round(height ?? JIMENG_NODE_DEFAULT_HEIGHT),
      ),
    );
    const lastSubmittedTime = useMemo(
      () => formatTimestamp(data.lastSubmittedAt ?? null, i18n.language),
      [data.lastSubmittedAt, i18n.language],
    );
    const selectedModel = normalizeJimengVideoModel(data.model);
    const selectedReferenceMode = normalizeJimengReferenceMode(
      data.referenceMode,
    );
    const selectedAspectRatio = data.aspectRatio ?? DEFAULT_ASPECT_RATIO;
    const selectedDuration = data.durationSeconds ?? DEFAULT_DURATION;
    const selectedVideoResolution =
      data.videoResolution === "720p" || data.videoResolution === "1080p"
        ? (data.videoResolution as JimengVideoResolution)
        : DEFAULT_VIDEO_RESOLUTION;
    const durationSuggestionSnapshot = useMemo(
      () => readDurationSuggestionSnapshot(data),
      [data],
    );
    const requiredReferenceImageCount = hasReferenceVideos
      ? null
      : resolveJimengVideoRequiredReferenceImageCount(selectedReferenceMode);
    const isFirstLastFrameCountInvalid =
      typeof requiredReferenceImageCount === "number" &&
      referenceImageSources.length !== requiredReferenceImageCount;
    const hasReferenceVideoTooLong = incomingVisualItems.some(
      (item) =>
        item.kind === "video" &&
        typeof item.durationSeconds === "number" &&
        Number.isFinite(item.durationSeconds) &&
        item.durationSeconds >= MAX_REFERENCE_VIDEO_DURATION_SECONDS,
    );
    const hasTooManyReferenceVideos =
      referenceVideoSources.length > MAX_REFERENCE_VIDEO_COUNT;
    const isGenerateBlocked =
      (incomingVisualItems.length === 0 && incomingAudios.length > 0) ||
      isFirstLastFrameCountInvalid ||
      hasReferenceVideoTooLong ||
      hasTooManyReferenceVideos;
    const modelOptions = useMemo(
      () =>
        JIMENG_VIDEO_MODEL_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const referenceModeOptions = useMemo(
      () =>
        JIMENG_REFERENCE_MODE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const aspectRatioOptions = useMemo(
      () =>
        JIMENG_ASPECT_RATIO_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const durationOptions = useMemo(
      () =>
        JIMENG_DURATION_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    useEffect(() => {
      const externalPrompt = data.prompt ?? "";
      if (externalPrompt !== promptValueRef.current) {
        promptValueRef.current = externalPrompt;
        setPromptDraft(externalPrompt);
        setPromptOptimizationError(null);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
      }
    }, [data.prompt]);

    useEffect(() => {
      if (data.videoResolution !== selectedVideoResolution) {
        updateNodeData(
          id,
          { videoResolution: selectedVideoResolution },
          { historyMode: "skip" },
        );
      }
    }, [data.videoResolution, id, selectedVideoResolution, updateNodeData]);

    useEffect(() => {
      const nextPatch: Partial<JimengNodeData> = {};

      if (typeof data.model === "string" && data.model !== selectedModel) {
        nextPatch.model = selectedModel;
      }

      if (
        typeof data.referenceMode === "string" &&
        data.referenceMode !== selectedReferenceMode
      ) {
        nextPatch.referenceMode = selectedReferenceMode;
      }

      if (Object.keys(nextPatch).length === 0) {
        return;
      }

      updateNodeData(id, nextPatch, { historyMode: "skip" });
    }, [
      data.model,
      data.referenceMode,
      id,
      selectedModel,
      selectedReferenceMode,
      updateNodeData,
    ]);

    useEffect(() => {
      if (referencePickerItems.length === 0) {
        setShowImagePicker(false);
        setPickerCursor(null);
        setPickerActiveIndex(0);
        setPromptReferencePreview(null);
        setDraggingReferenceIndex(null);
        setDragOverReferenceIndex(null);
        setDragReferencePreview(null);
        return;
      }

      setPickerActiveIndex((previous) =>
        Math.min(previous, referencePickerItems.length - 1),
      );
    }, [referencePickerItems.length]);

    useEffect(() => {
      setPromptReferencePreview(null);
    }, [incomingAudios, incomingVisualItems, promptDraft]);

    useEffect(() => {
      if (!showImagePicker) {
        return;
      }

      pickerItemRefs.current[pickerActiveIndex]?.scrollIntoView({
        block: "nearest",
      });
    }, [pickerActiveIndex, showImagePicker]);

    useEffect(() => {
      const handleOutside = (event: MouseEvent) => {
        if (rootRef.current?.contains(event.target as globalThis.Node)) {
          return;
        }

        setShowImagePicker(false);
        setPickerCursor(null);
        setPromptReferencePreview(null);
        setDragReferencePreview(null);
      };

      document.addEventListener("mousedown", handleOutside, true);
      return () => {
        document.removeEventListener("mousedown", handleOutside, true);
      };
    }, []);

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      id,
      incomingAudios.length,
      incomingVisualItems.length,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
    ]);

    const updatePrompt = useCallback(
      (nextPrompt: string) => {
        setPromptDraft(nextPrompt);
        promptValueRef.current = nextPrompt;
        updateNodeData(id, { prompt: nextPrompt });
      },
      [id, updateNodeData],
    );

    const handlePromptChange = useCallback(
      (nextPrompt: string) => {
        setPromptOptimizationError(null);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
        updatePrompt(nextPrompt);
      },
      [updatePrompt],
    );

    const syncPromptTextSelectionState = useCallback(
      (_target?: HTMLTextAreaElement | null) => {
        setIsPromptTextSelectionActive(false);
        setPromptReferencePreview(null);
      },
      [],
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

    const handleMoveReferenceVisual = useCallback(
      (fromIndex: number, toIndex: number) => {
        const nextOrder = moveItem(
          orderedReferenceVisualUrls,
          fromIndex,
          toIndex,
        );
        updateNodeData(id, { referenceImageOrder: nextOrder });
        void flushCurrentProjectToDiskSafely(
          "saving Jimeng video reference order",
        );
      },
      [id, orderedReferenceVisualUrls, updateNodeData],
    );

    const handleRemoveReferenceVisual = useCallback(
      (sourceEdgeId: string) => {
        setShowImagePicker(false);
        setPickerCursor(null);
        setPromptReferencePreview(null);
        setDraggingReferenceIndex(null);
        setDragOverReferenceIndex(null);
        setDragReferencePreview(null);
        deleteEdge(sourceEdgeId);
      },
      [deleteEdge],
    );

    useEffect(() => {
      const previousOrderedReferenceImages =
        previousOrderedReferenceImagesRef.current;
      if (!previousOrderedReferenceImages) {
        previousOrderedReferenceImagesRef.current = orderedReferenceVisualUrls;
        return;
      }

      if (
        areReferenceImageOrdersEqual(
          previousOrderedReferenceImages,
          orderedReferenceVisualUrls,
        )
      ) {
        return;
      }

      previousOrderedReferenceImagesRef.current = orderedReferenceVisualUrls;
      const nextPrompt = remapJimengVisualReferenceTokensByOrder(
        promptValueRef.current,
        previousOrderedReferenceImages,
        orderedReferenceVisualUrls,
      );
      if (nextPrompt === promptValueRef.current) {
        return;
      }

      updatePrompt(nextPrompt);
    }, [orderedReferenceVisualUrls, updatePrompt]);

    const insertReferenceItem = useCallback(
      (pickerIndex: number) => {
        const pickerItem = referencePickerItems[pickerIndex];
        if (!pickerItem) {
          return;
        }

        const currentPrompt = promptValueRef.current;
        const cursor = pickerCursor ?? currentPrompt.length;
        const { nextText, nextCursor } = insertReferenceToken(
          currentPrompt,
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

    const handleReferenceSortStart = useCallback(
      (index: number, event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const sourceNodeId = incomingVisualItems[index]?.sourceNodeId;
        if (sourceNodeId) {
          setHighlightedReferenceSourceNode(
            highlightedReferenceSourceNodeId === sourceNodeId
              ? null
              : sourceNodeId,
          );
        }
        const cardRect = event.currentTarget.getBoundingClientRect();
        const containerRect = rootRef.current?.getBoundingClientRect();
        setDraggingReferenceIndex(index);
        setDragOverReferenceIndex(index);
        setDragReferencePreview({
          left: containerRect ? cardRect.left - containerRect.left : 0,
          top: containerRect ? cardRect.top - containerRect.top : 0,
          width: cardRect.width,
          height: cardRect.height,
          offsetX: event.clientX - cardRect.left,
          offsetY: event.clientY - cardRect.top,
          containerLeft: containerRect?.left ?? 0,
          containerTop: containerRect?.top ?? 0,
        });
      },
      [
        highlightedReferenceSourceNodeId,
        incomingVisualItems,
        setHighlightedReferenceSourceNode,
      ],
    );

    const handleReferenceSortHover = useCallback(
      (index: number) => {
        if (draggingReferenceIndex === null) {
          return;
        }

        setDragOverReferenceIndex(index);
      },
      [draggingReferenceIndex],
    );

    const finalizeReferenceSort = useCallback(() => {
      const fromIndex = draggingReferenceIndex;
      const toIndex = dragOverReferenceIndex;

      if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
        handleMoveReferenceVisual(fromIndex, toIndex);
      }

      setDraggingReferenceIndex(null);
      setDragOverReferenceIndex(null);
      setDragReferencePreview(null);
    }, [
      dragOverReferenceIndex,
      draggingReferenceIndex,
      handleMoveReferenceVisual,
    ]);

    useEffect(() => {
      if (draggingReferenceIndex === null) {
        return;
      }

      const handlePointerMove = (event: PointerEvent) => {
        setDragReferencePreview((previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,
            left: event.clientX - previous.containerLeft - previous.offsetX,
            top: event.clientY - previous.containerTop - previous.offsetY,
          };
        });
      };

      const handlePointerUp = () => {
        finalizeReferenceSort();
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);

      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }, [draggingReferenceIndex, finalizeReferenceSort]);

    const handleReferenceSortCancel = useCallback(() => {
      if (draggingReferenceIndex === null) {
        return;
      }

      setDraggingReferenceIndex(null);
      setDragOverReferenceIndex(null);
      setDragReferencePreview(null);
    }, [draggingReferenceIndex]);

    const handleOptimizePrompt = useCallback(async () => {
      const sourcePrompt = promptValueRef.current;
      const currentPrompt = sourcePrompt.trim();
      if (!currentPrompt) {
        const message = t("node.jimeng.promptRequired");
        updateNodeData(id, { lastError: null });
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setIsOptimizingPrompt(true);
      setPromptOptimizationError(null);
      updateNodeData(id, { lastError: null });

      try {
        const previousDurationSuggestion = readDurationSuggestionSnapshot(data);
        const result = await optimizeCanvasPrompt({
          mode: "jimeng",
          prompt: currentPrompt,
          referenceImages: incomingVisualItems.map(
            (item) => item.previewImageUrl,
          ).filter((item): item is string => Boolean(item)),
        });
        if (promptValueRef.current !== sourcePrompt) {
          return;
        }

        const nextPrompt = result.prompt;
        const nextDurationSuggestion = buildDurationSuggestionSnapshot(
          result.durationRecommendation,
        );
        setLastPromptOptimizationMeta({
          modelLabel: [result.context.provider, result.context.model]
            .filter(Boolean)
            .join(" / "),
          referenceImageCount: result.usedReferenceImages
            ? incomingVisualItems.length
            : 0,
        });

        const promptChanged = nextPrompt !== sourcePrompt;
        const durationChanged = !areDurationSuggestionSnapshotsEqual(
          previousDurationSuggestion,
          nextDurationSuggestion,
        );

        if (promptChanged || durationChanged) {
          setLastPromptOptimizationUndoState({
            previousPrompt: sourcePrompt,
            appliedPrompt: nextPrompt,
            previousDurationSuggestion,
            appliedDurationSuggestion: nextDurationSuggestion,
          });
        } else {
          setLastPromptOptimizationUndoState(null);
        }

        updatePrompt(nextPrompt);
        updateNodeData(
          id,
          toDurationSuggestionNodeData(nextDurationSuggestion),
        );

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
            : t("node.jimeng.optimizePromptFailed");
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
      } finally {
        setIsOptimizingPrompt(false);
      }
    }, [
      data,
      id,
      incomingVisualItems,
      syncPromptHighlightScroll,
      t,
      updateNodeData,
      updatePrompt,
    ]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (!lastPromptOptimizationUndoState) {
        return;
      }

      if (
        promptValueRef.current !== lastPromptOptimizationUndoState.appliedPrompt
      ) {
        return;
      }

      const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
      setPromptOptimizationError(null);
      setLastPromptOptimizationMeta(null);
      setLastPromptOptimizationUndoState(null);
      updatePrompt(restoredPrompt);
      updateNodeData(
        id,
        toDurationSuggestionNodeData(
          lastPromptOptimizationUndoState.previousDurationSuggestion,
        ),
      );
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
      id,
      lastPromptOptimizationUndoState,
      syncPromptHighlightScroll,
      syncPromptTextSelectionState,
      updateNodeData,
      updatePrompt,
    ]);

    const enqueueJimengVideoJob = useCallback(async (scheduledAt: number | null) => {
      const prompt = promptDraft.trim();
      let createdResultNodeId: string | null = null;
      const resultNodeTitle = buildJimengVideoResultNodeTitle(
        t("node.jimeng.resultNodeTitle"),
      );
      try {
        if (!prompt) {
          const message = t("node.jimeng.promptRequired");
          updateNodeData(id, { lastError: message });
          await showErrorDialog(message, t("common.error"));
          return;
        }

        if (isGenerateBlocked) {
          const message = hasTooManyReferenceVideos
            ? t("node.jimeng.referenceVideoTooMany", {
                count: MAX_REFERENCE_VIDEO_COUNT,
              })
            : hasReferenceVideoTooLong
              ? t("node.jimeng.referenceVideoTooLong", {
                  seconds: MAX_REFERENCE_VIDEO_DURATION_SECONDS,
                })
              : isFirstLastFrameCountInvalid
                ? t("node.jimeng.firstLastFrameRequiresTwoImages")
                : t("node.jimeng.cliBlockedAudioNeedsImage");
          updateNodeData(id, { lastError: message });
          await showErrorDialog(message, t("common.error"));
          return;
        }

        if (!currentProjectId) {
          const message = t("node.jimeng.queueProjectUnavailable");
          updateNodeData(id, { lastError: message });
          await showErrorDialog(message, t("common.error"));
          return;
        }

        setPromptOptimizationError(null);
        updateNodeData(id, { lastError: null });

        const resultNodePosition = findNodePosition(
          id,
          JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
          JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
        );
        createdResultNodeId = addNode(
          CANVAS_NODE_TYPES.jimengVideoResult,
          resultNodePosition,
          {
            sourceNodeId: id,
            displayName: resultNodeTitle,
            queueJobId: null,
            queueStatus: "waiting",
            queueScheduledAt: scheduledAt,
            queueAttemptCount: 0,
            queueMaxAttempts: 3,
            submitId: null,
            sourceUrl: null,
            posterSourceUrl: null,
            videoUrl: null,
            previewImageUrl: null,
            videoFileName: null,
            aspectRatio: selectedAspectRatio,
            duration: selectedDuration,
            isGenerating: false,
            generationStartedAt: null,
            generationDurationMs: 180000,
            lastGeneratedAt: null,
            lastError: null,
          },
          { inheritParentFromNodeId: id },
        );
        addEdge(id, createdResultNodeId);
        await flushCurrentProjectToDiskSafely(
          "creating Jimeng video result node",
        );

        if (!createdResultNodeId) {
          throw new Error(t("node.jimeng.queueResultNodeMissing"));
        }

        await enqueueJimengQueueJob({
          projectId: currentProjectId,
          sourceNodeId: id,
          resultNodeId: createdResultNodeId,
          title: resultNodeTitle,
          scheduledAt,
          payload: {
            prompt,
            modelVersion: selectedModel,
            referenceMode: selectedReferenceMode,
            aspectRatio: selectedAspectRatio,
            durationSeconds: selectedDuration,
            videoResolution: selectedVideoResolution,
            referenceImageSources,
            referenceVideoSources,
            referenceAudioSources: incomingAudios.map((item) => item.audioUrl),
          },
        });

        updateNodeData(id, {
          lastError: null,
        });
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.jimeng.queueEnqueueFailed"),
        );
        updateNodeData(id, { lastError: content.message });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            queueStatus: "failed",
            lastError: content.message,
          });
        }
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng video queue error",
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
      currentProjectId,
      enqueueJimengQueueJob,
      findNodePosition,
      flushCurrentProjectToDiskSafely,
      hasTooManyReferenceVideos,
      hasReferenceVideoTooLong,
      id,
      incomingAudios,
      isGenerateBlocked,
      isFirstLastFrameCountInvalid,
      promptDraft,
      referenceImageSources,
      referenceVideoSources,
      selectedAspectRatio,
      selectedDuration,
      selectedModel,
      selectedReferenceMode,
      selectedVideoResolution,
      t,
      updateNodeData,
    ]);

    const handleGenerate = useCallback(async () => {
      const prompt = promptDraft.trim();
      const startedAt = Date.now();
      let createdResultNodeId: string | null = null;
      const resultNodeTitle = buildJimengVideoResultNodeTitle(
        t("node.jimeng.resultNodeTitle"),
      );
      try {
        if (!prompt) {
          const message = t("node.jimeng.promptRequired");
          updateNodeData(id, { lastError: message });
          await showErrorDialog(message, t("common.error"));
          return;
        }

        if (isGenerateBlocked) {
          const message = hasTooManyReferenceVideos
            ? t("node.jimeng.referenceVideoTooMany", {
                count: MAX_REFERENCE_VIDEO_COUNT,
              })
            : hasReferenceVideoTooLong
              ? t("node.jimeng.referenceVideoTooLong", {
                  seconds: MAX_REFERENCE_VIDEO_DURATION_SECONDS,
                })
              : isFirstLastFrameCountInvalid
                ? t("node.jimeng.firstLastFrameRequiresTwoImages")
                : t("node.jimeng.cliBlockedAudioNeedsImage");
          updateNodeData(id, { lastError: message });
          await showErrorDialog(message, t("common.error"));
          return;
        }

        setPromptOptimizationError(null);
        updateNodeData(id, { lastError: null });

        const resultNodePosition = findNodePosition(
          id,
          JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
          JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
        );
        createdResultNodeId = addNode(
          CANVAS_NODE_TYPES.jimengVideoResult,
          resultNodePosition,
          {
            sourceNodeId: id,
            displayName: resultNodeTitle,
            queueJobId: null,
            queueStatus: null,
            queueScheduledAt: null,
            queueAttemptCount: 0,
            queueMaxAttempts: 3,
            submitId: null,
            sourceUrl: null,
            posterSourceUrl: null,
            videoUrl: null,
            previewImageUrl: null,
            videoFileName: null,
            aspectRatio: selectedAspectRatio,
            duration: selectedDuration,
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
          "creating Jimeng video result node",
        );

        const dreaminaStatus = await ensureDreaminaCliReady({
          feature: "video",
          action: "generate",
        });
        if (!dreaminaStatus.ready) {
          const message = resolveDreaminaSetupBlockedMessage(
            t,
            dreaminaStatus.code,
          );
          updateNodeData(id, { lastError: message });
          if (createdResultNodeId) {
            updateNodeData(createdResultNodeId, {
              isGenerating: false,
              generationStartedAt: null,
              lastError: message,
            });
          }
          await flushCurrentProjectToDiskSafely(
            "saving Jimeng video generation blocked state",
          );
          return;
        }

        const generationResponse = await generateJimengVideos({
          prompt,
          modelVersion: selectedModel,
          referenceMode: selectedReferenceMode,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedDuration,
          videoResolution: selectedVideoResolution,
          referenceImageSources,
          referenceVideoSources,
          referenceAudioSources: incomingAudios.map((item) => item.audioUrl),
          onSubmitted: async ({ submitId }) => {
            if (!createdResultNodeId) {
              return;
            }

            updateNodeData(createdResultNodeId, {
              submitId,
              isGenerating: true,
              generationStartedAt: startedAt,
              lastError: null,
            });
            await flushCurrentProjectToDiskSafely(
              "saving Jimeng video submit id",
            );
          },
        });
        const completedAt = Date.now();
        const primaryResult = generationResponse.videos[0] ?? null;

        updateNodeData(id, {
          lastSubmittedAt: completedAt,
          lastError: null,
        });

        if (createdResultNodeId && primaryResult) {
          updateNodeData(createdResultNodeId, {
            submitId: generationResponse.submitId,
            sourceUrl: primaryResult.sourceUrl ?? null,
            posterSourceUrl: primaryResult.posterSourceUrl ?? null,
            videoUrl: primaryResult.videoUrl ?? null,
            previewImageUrl: primaryResult.previewImageUrl ?? null,
            videoFileName: primaryResult.fileName ?? null,
            aspectRatio: primaryResult.aspectRatio ?? selectedAspectRatio,
            duration: primaryResult.duration ?? selectedDuration,
            width: primaryResult.width ?? undefined,
            height: primaryResult.height ?? undefined,
            isGenerating: false,
            generationStartedAt: null,
            lastGeneratedAt: completedAt,
            lastError: null,
          });
        }
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng video generation result",
        );
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.jimeng.submitFailed"),
        );
        updateNodeData(id, { lastError: content.message });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            lastError: content.message,
          });
        }
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng video generation error",
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
      findNodePosition,
      flushCurrentProjectToDiskSafely,
      hasReferenceVideoTooLong,
      hasTooManyReferenceVideos,
      id,
      incomingAudios,
      isFirstLastFrameCountInvalid,
      isGenerateBlocked,
      promptDraft,
      referenceImageSources,
      referenceVideoSources,
      selectedAspectRatio,
      selectedDuration,
      selectedModel,
      selectedReferenceMode,
      selectedVideoResolution,
      t,
      updateNodeData,
    ]);

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
          const deleteRange = resolveJimengReferenceAwareDeleteRange(
            currentPrompt,
            selectionStart,
            selectionEnd,
            deletionDirection,
            incomingVisualItems.length,
            incomingAudios.length,
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

        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          void handleGenerate();
        }
      },
      [
        handleGenerate,
        handlePromptChange,
        incomingAudios.length,
        incomingVisualItems.length,
        insertReferenceItem,
        pickerActiveIndex,
        referencePickerItems.length,
        showImagePicker,
        syncPromptHighlightScroll,
        syncPromptTextSelectionState,
      ],
    );

    const hidePromptReferencePreview = useCallback(() => {
      setPromptReferencePreview(null);
    }, []);

    const handlePromptReferenceTokenHover = useCallback(
      (
        token: JimengPromptReferenceToken,
        event: ReactMouseEvent<HTMLSpanElement>,
      ) => {
        if (token.kind !== "visual") {
          setPromptReferencePreview(null);
          return;
        }

        const item = incomingVisualItems[token.value - 1];
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
        const preferredLeft =
          event.clientX - previewHostRect.left + horizontalGap;
        const preferredTop = event.clientY - previewHostRect.top + verticalGap;
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
          left: Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft)),
          top: Math.max(horizontalPadding, Math.min(preferredTop, maxTop)),
        });
      },
      [incomingVisualItems],
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

    const combinedError = promptOptimizationError ?? data.lastError;
    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
      promptDraft === lastPromptOptimizationUndoState.appliedPrompt,
    );
    const promptOptimizationNotice = lastPromptOptimizationMeta
      ? `${t("node.jimeng.optimizeModelLabel", {
          model: lastPromptOptimizationMeta.modelLabel,
        })} | ${t("node.jimeng.optimizeReferenceImagesLabel", {
          status:
            lastPromptOptimizationMeta.referenceImageCount > 0
              ? t("node.jimeng.optimizeReferenceImagesUsed", {
                  count: lastPromptOptimizationMeta.referenceImageCount,
                })
              : t("node.jimeng.optimizeReferenceImagesUnused"),
        })}`
      : null;
    const durationSuggestionText = buildDurationSuggestionText(
      durationSuggestionSnapshot,
      t,
    );
    const cliModeHint = useMemo(() => {
      if (isFirstLastFrameCountInvalid) {
        return t("node.jimeng.firstLastFrameRequiresTwoImages");
      }

      if (hasReferenceVideoTooLong) {
        return t("node.jimeng.referenceVideoTooLong", {
          seconds: MAX_REFERENCE_VIDEO_DURATION_SECONDS,
        });
      }

      if (hasTooManyReferenceVideos) {
        return t("node.jimeng.referenceVideoTooMany", {
          count: MAX_REFERENCE_VIDEO_COUNT,
        });
      }

      if (isGenerateBlocked) {
        return t("node.jimeng.cliBlockedAudioNeedsImage");
      }

      if (hasReferenceVideos || incomingAudios.length > 0) {
        const effectiveModel = resolveJimengCliEffectiveVideoModel(
          "multimodal2video",
          selectedModel,
        );
        return t("node.jimeng.cliHint.multimodal2video", {
          command: t("node.jimeng.cliMode.multimodal2video"),
          model: effectiveModel
            ? t(
                `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
              )
            : "-",
        });
      }

      if (referenceImageSources.length === 0) {
        const effectiveModel = resolveJimengCliEffectiveVideoModel(
          "text2video",
          selectedModel,
        );
        return t("node.jimeng.cliHint.text2video", {
          command: t("node.jimeng.cliMode.text2video"),
          model: effectiveModel
            ? t(
                `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
              )
            : "-",
        });
      }

      if (referenceImageSources.length === 1) {
        return t("node.jimeng.cliHint.image2video", {
          command: t("node.jimeng.cliMode.image2video"),
          duration: resolveJimengVideoModelDurationRange(selectedModel),
          resolution: isJimengSeedanceTwoFamilyModel(selectedModel)
            ? "720p"
            : "720p / 1080p",
        });
      }

      if (selectedReferenceMode === "firstLastFrame") {
        const effectiveModel =
          resolveJimengCliEffectiveVideoModel("frames2video", selectedModel) ??
          "seedance2.0fast";
        return t("node.jimeng.cliHint.frames2video", {
          command: t("node.jimeng.cliMode.frames2video"),
          model: t(
            `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
          ),
          duration: resolveJimengVideoModelDurationRange(effectiveModel),
          resolution:
            effectiveModel === "3.0" || effectiveModel === "3.5pro"
              ? "720p / 1080p"
              : "720p",
        });
      }

      if (selectedReferenceMode === "smartFrames") {
        return referenceImageSources.length <= 2
          ? t("node.jimeng.cliHint.multiframeTwo", {
              command: t("node.jimeng.cliMode.multiframe2video"),
            })
          : t("node.jimeng.cliHint.multiframeMany", {
              command: t("node.jimeng.cliMode.multiframe2video"),
              count: referenceImageSources.length,
            });
      }

      const effectiveModel = resolveJimengCliEffectiveVideoModel(
        "multimodal2video",
        selectedModel,
      );
      return t("node.jimeng.cliHint.multimodal2video", {
        command: t("node.jimeng.cliMode.multimodal2video"),
        model: effectiveModel
          ? t(
              `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
            )
          : "-",
      });
    }, [
      hasReferenceVideos,
      hasReferenceVideoTooLong,
      hasTooManyReferenceVideos,
      incomingAudios.length,
      isFirstLastFrameCountInvalid,
      isGenerateBlocked,
      referenceImageSources.length,
      selectedModel,
      selectedReferenceMode,
      t,
    ]);

    const headerStatus = useMemo(() => {
      if (isOptimizingPrompt) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.jimeng.optimizingPrompt")}
            tone="processing"
            animate
          />
        );
      }

      if (combinedError) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t("nodeStatus.error")}
            tone="danger"
            title={combinedError}
          />
        );
      }

      return null;
    }, [combinedError, isOptimizingPrompt, t]);

    const statusInfoText =
      combinedError ??
      (lastSubmittedTime
        ? t("node.jimeng.resultReturnedAt", { time: lastSubmittedTime })
        : [cliModeHint, durationSuggestionText, promptOptimizationNotice]
            .filter(Boolean)
            .join(" | "));
    const showBlockingOverlay = Boolean(data.isGenerating || isOptimizingPrompt);

    const handleModelChange = useCallback(
      (nextValue: JimengVideoModelId) => {
        updateNodeData(id, { model: nextValue });
        setLastJimengVideoDefaults({
          model: nextValue,
          referenceMode: selectedReferenceMode,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedDuration,
          videoResolution: selectedVideoResolution,
        });
      },
      [
        id,
        selectedAspectRatio,
        selectedDuration,
        selectedReferenceMode,
        selectedVideoResolution,
        setLastJimengVideoDefaults,
        updateNodeData,
      ],
    );

    const handleReferenceModeChange = useCallback(
      (nextValue: JimengReferenceMode) => {
        updateNodeData(id, { referenceMode: nextValue });
        setLastJimengVideoDefaults({
          model: selectedModel,
          referenceMode: nextValue,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedDuration,
          videoResolution: selectedVideoResolution,
        });
      },
      [
        id,
        selectedAspectRatio,
        selectedDuration,
        selectedModel,
        selectedVideoResolution,
        setLastJimengVideoDefaults,
        updateNodeData,
      ],
    );

    const handleAspectRatioChange = useCallback(
      (nextValue: JimengAspectRatio) => {
        updateNodeData(id, { aspectRatio: nextValue });
        setLastJimengVideoDefaults({
          model: selectedModel,
          referenceMode: selectedReferenceMode,
          aspectRatio: nextValue,
          durationSeconds: selectedDuration,
          videoResolution: selectedVideoResolution,
        });
      },
      [
        id,
        selectedDuration,
        selectedModel,
        selectedReferenceMode,
        selectedVideoResolution,
        setLastJimengVideoDefaults,
        updateNodeData,
      ],
    );

    const handleDurationChange = useCallback(
      (nextValue: JimengDurationSeconds) => {
        updateNodeData(id, {
          durationSeconds: nextValue,
        });
        setLastJimengVideoDefaults({
          model: selectedModel,
          referenceMode: selectedReferenceMode,
          aspectRatio: selectedAspectRatio,
          durationSeconds: nextValue,
          videoResolution: selectedVideoResolution,
        });
      },
      [
        id,
        selectedAspectRatio,
        selectedModel,
        selectedReferenceMode,
        selectedVideoResolution,
        setLastJimengVideoDefaults,
        updateNodeData,
      ],
    );

    return (
      <div
        ref={rootRef}
        className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-all duration-150
        ${
          selected
            ? "border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]"
            : "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
        }
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
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div
          ref={promptPanelRef}
          className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2"
        >
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div
              ref={promptPreviewHostRef}
              className="relative min-h-[148px] flex-1"
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
                    incomingVisualItems.length,
                    incomingAudios.length,
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
                      incomingVisualItems.length,
                      incomingAudios.length,
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
                  syncPromptTextSelectionState(event.currentTarget);
                }}
                placeholder={t("node.jimeng.promptPlaceholder")}
                className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/70 focus:border-accent/50 whitespace-pre-wrap break-words selection:bg-accent/30 selection:text-transparent"
                style={{ scrollbarGutter: "stable" }}
                onScroll={syncPromptHighlightScroll}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  hidePromptReferencePreview();
                }}
                onSelect={(event) =>
                  syncPromptTextSelectionState(event.currentTarget)
                }
                onMouseUp={(event) =>
                  syncPromptTextSelectionState(event.currentTarget)
                }
                onKeyUp={(event) =>
                  syncPromptTextSelectionState(event.currentTarget)
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
                  <ReferenceVisualThumbnail
                    kind={promptReferencePreview.kind}
                    displayUrl={promptReferencePreview.displayUrl}
                    label={promptReferencePreview.alt}
                    durationSeconds={promptReferencePreview.durationSeconds}
                    imageClassName="block max-h-[132px] max-w-[144px] rounded-xl object-contain"
                    placeholderClassName="flex h-[132px] w-[144px] items-center justify-center rounded-xl border border-white/10 bg-black/70 text-text-dark"
                    viewerImageList={incomingVisualDisplayList}
                    showVideoBadge={false}
                  />
                  {promptReferencePreview.kind === "video" ? (
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 px-2 py-1 text-[10px] text-white">
                      <span className="inline-flex items-center gap-1">
                        <Video className="h-3 w-3" strokeWidth={2.2} />
                        {t("node.jimeng.referenceVideoBadge")}
                      </span>
                      {promptReferencePreview.durationSeconds ? (
                        <span>
                          {formatReferenceDuration(
                            promptReferencePreview.durationSeconds,
                          )}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2 py-2">
              {incomingVisualItems.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {incomingVisualItems.map((item, index) => (
                    <ReferenceVisualChip
                      key={`${item.referenceUrl}-${index}`}
                      kind={item.kind}
                      displayUrl={item.displayUrl}
                      label={item.label}
                      tokenLabel={item.tokenLabel}
                      metaLabel={
                        item.kind === "video"
                          ? (formatReferenceDuration(item.durationSeconds) ?? "VIDEO")
                          : null
                      }
                      viewerImageList={incomingVisualDisplayList}
                      isActive={highlightedReferenceSourceNodeId === item.sourceNodeId}
                      isDragging={draggingReferenceIndex === index}
                      isDragTarget={dragOverReferenceIndex === index}
                      cursorClassName="cursor-grab"
                      reorderHint={t("node.jimeng.referenceReorderHint")}
                      removeLabel={t("common.delete")}
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerDown={(event) =>
                        handleReferenceSortStart(index, event)
                      }
                      onPointerEnter={(event) => {
                        event.stopPropagation();
                        handleReferenceSortHover(index);
                      }}
                      onPointerMove={(event) => {
                        event.stopPropagation();
                        handleReferenceSortHover(index);
                      }}
                      onPointerCancel={handleReferenceSortCancel}
                      onRemove={() => handleRemoveReferenceVisual(item.sourceEdgeId)}
                    />
                  ))}
                </div>
              ) : null}

              {incomingVisualItems.length > 1 ? (
                <div className="pointer-events-none ml-auto hidden items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-text-muted md:flex">
                  {t("node.jimeng.referenceReorderHint")}
                </div>
              ) : null}

              {incomingAudios.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {incomingAudios.map((audio, index) => (
                    <div
                      key={`${audio.audioUrl}-${index}`}
                      className="flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-text-dark"
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <AudioLines className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <span className="rounded bg-white/[0.08] px-1 py-0.5 text-[10px] font-medium text-text-muted">
                        {audio.tokenLabel}
                      </span>
                      <span className="max-w-[92px] truncate">
                        {audio.label}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {incomingVisualItems.length === 0 &&
              incomingAudios.length === 0 ? (
                <div className="text-[11px] text-text-muted">
                  {t("node.jimeng.referenceEmpty")}
                </div>
              ) : null}
            </div>
          </div>

          {showImagePicker && referencePickerItems.length > 0 && (
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
                      <div className="relative h-8 w-8 shrink-0">
                        <ReferenceVisualThumbnail
                          kind={item.previewKind ?? "image"}
                          displayUrl={item.displayUrl ?? null}
                          label={item.label}
                          durationSeconds={item.durationSeconds ?? null}
                          imageClassName="h-8 w-8 rounded object-cover"
                          placeholderClassName="flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/[0.06] text-text-muted"
                          viewerImageList={incomingVisualDisplayList}
                        />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/[0.06] text-text-muted">
                        <AudioLines className="h-4 w-4" />
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
          )}
        </div>

        {draggedReferenceItem && dragReferencePreview ? (
          <div
            className="pointer-events-none absolute z-40"
            style={{
              left: `${dragReferencePreview.left}px`,
              top: `${dragReferencePreview.top}px`,
              width: `${dragReferencePreview.width}px`,
              minHeight: `${dragReferencePreview.height}px`,
            }}
          >
            <div className="relative flex select-none items-center gap-1.5 rounded-lg border border-accent/55 bg-black/72 px-1.5 py-1.5 opacity-85 shadow-[0_18px_40px_rgba(0,0,0,0.34),0_10px_26px_rgba(59,130,246,0.18)] backdrop-blur-sm">
              <div className="relative h-9 w-9 shrink-0">
                <ReferenceVisualThumbnail
                  kind={draggedReferenceItem.kind}
                  displayUrl={draggedReferenceItem.displayUrl}
                  label={draggedReferenceItem.label}
                  durationSeconds={draggedReferenceItem.durationSeconds}
                  imageClassName="h-9 w-9 rounded-md object-cover"
                  placeholderClassName="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-white/72"
                  viewerImageList={incomingVisualDisplayList}
                />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-white">
                  {draggedReferenceItem.tokenLabel}
                </div>
                <div className="truncate text-[10px] text-white/72">
                  {draggedReferenceItem.label}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
              <FixedControlChip
                label={t("node.jimeng.parameters.model")}
                value={selectedModel}
                options={modelOptions}
                onChange={handleModelChange}
              />
              <FixedControlChip
                label={t("node.jimeng.parameters.referenceMode")}
                value={selectedReferenceMode}
                options={referenceModeOptions}
                onChange={handleReferenceModeChange}
              />
              <FixedControlChip
                label={t("node.jimeng.parameters.aspectRatio")}
                value={selectedAspectRatio}
                options={aspectRatioOptions}
                onChange={handleAspectRatioChange}
              />
              <FixedControlChip
                label={t("node.jimeng.parameters.duration")}
                value={selectedDuration}
                options={durationOptions}
                onChange={handleDurationChange}
              />
              <StyleTemplatePicker
                selectedTemplateId={selectedStyleTemplateId}
                className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                onTemplateChange={(templateId, prompt) => {
                  setSelectedStyleTemplateId(templateId);
                  setStyleTemplatePrompt(prompt);
                  const nextPrompt = applyStyleTemplatePrompt(
                    promptValueRef.current,
                    styleTemplatePrompt,
                    prompt,
                  );
                  updatePrompt(nextPrompt);
                  setLastPromptOptimizationMeta(null);
                  setLastPromptOptimizationUndoState(null);
                }}
              />
              <UiChipButton
                type="button"
                className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                disabled={isOptimizingPrompt}
                aria-label={t("node.jimeng.optimizePrompt")}
                title={t("node.jimeng.optimizePrompt")}
                onClick={() => void handleOptimizePrompt()}
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
                aria-label={t("node.jimeng.undoOptimizedPrompt")}
                title={t("node.jimeng.undoOptimizedPrompt")}
                onClick={handleUndoOptimizedPrompt}
              >
                <Undo2
                  className="h-4 w-4 origin-center scale-[1.08]"
                  strokeWidth={2.3}
                />
              </UiChipButton>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <UiButton
              type="button"
              variant="muted"
              className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
              disabled={isOptimizingPrompt || isGenerateBlocked}
              onClick={() => setShowQueueScheduleModal(true)}
            >
              {t("node.jimeng.addToQueue")}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
              disabled={isOptimizingPrompt || isGenerateBlocked}
              onClick={() => void handleGenerate()}
            >
              <Sparkles
                className={NODE_CONTROL_GENERATE_ICON_CLASS}
                strokeWidth={2.5}
              />
              {t("node.jimeng.submit")}
            </UiButton>
          </div>
        </div>

        {statusInfoText ? (
          <div
            className={`mt-1 min-h-[16px] truncate text-[10px] leading-4 ${
              combinedError ? "text-rose-300" : "text-text-muted"
            }`}
            title={statusInfoText}
          >
            {statusInfoText}
          </div>
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
          minWidth={JIMENG_NODE_MIN_WIDTH}
          minHeight={JIMENG_NODE_MIN_HEIGHT}
        />
        <UiLoadingOverlay visible={showBlockingOverlay} insetClassName="inset-3" />
        <JimengVideoQueueScheduleModal
          isOpen={showQueueScheduleModal}
          title={t("jimengQueue.schedule.createTitle")}
          initialScheduledAt={null}
          confirmLabel={t("node.jimeng.addToQueue")}
          onClose={() => setShowQueueScheduleModal(false)}
          onConfirm={(scheduledAt) => {
            setShowQueueScheduleModal(false);
            void enqueueJimengVideoJob(scheduledAt);
          }}
        />
      </div>
    );
  },
);

JimengNode.displayName = "JimengNode";
