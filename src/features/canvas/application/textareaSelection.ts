export interface TextSelectionRange {
  start: number;
  end: number;
}

export interface PickerAnchor {
  left: number;
  top: number;
}

export interface ResolveTextSelectionOptions {
  textarea?: HTMLTextAreaElement | null;
  lastSelection?: TextSelectionRange | null;
  fallbackLength: number;
  requireFocus?: boolean;
}

export interface RestoreTextareaSelectionOptions {
  syncScroll?: () => void;
  onAfterRestore?: (
    textarea: HTMLTextAreaElement,
    selection: TextSelectionRange
  ) => void;
}

export interface ResolveTextareaPickerAnchorOptions {
  container: HTMLElement | null;
  textarea: HTMLTextAreaElement;
  caretIndex: number;
  zoom?: number;
  yOffset?: number;
  fallbackAnchor?: PickerAnchor;
}

export const DEFAULT_PICKER_ANCHOR: PickerAnchor = { left: 8, top: 8 };

function clampIndex(value: number, maxLength: number): number {
  if (!Number.isFinite(value)) {
    return maxLength;
  }

  return Math.max(0, Math.min(Math.floor(value), maxLength));
}

export function createCollapsedTextSelection(
  cursor: number,
  fallbackLength: number
): TextSelectionRange {
  const maxLength = Math.max(0, Math.floor(fallbackLength));
  const safeCursor = clampIndex(cursor, maxLength);
  return {
    start: safeCursor,
    end: safeCursor,
  };
}

export function normalizeTextSelectionRange(
  selection: TextSelectionRange | null | undefined,
  fallbackLength: number
): TextSelectionRange | null {
  if (!selection) {
    return null;
  }

  const maxLength = Math.max(0, Math.floor(fallbackLength));
  return {
    start: clampIndex(selection.start, maxLength),
    end: clampIndex(selection.end, maxLength),
  };
}

export function readTextareaSelection(
  textarea: HTMLTextAreaElement | null | undefined,
  fallbackLength: number
): TextSelectionRange | null {
  if (!textarea) {
    return null;
  }

  const maxLength = Math.max(textarea.value.length, Math.floor(fallbackLength));
  return {
    start: clampIndex(textarea.selectionStart ?? fallbackLength, maxLength),
    end: clampIndex(textarea.selectionEnd ?? fallbackLength, maxLength),
  };
}

export function resolveTextSelection(
  options: ResolveTextSelectionOptions
): TextSelectionRange {
  const textarea = options.textarea ?? null;
  const canUseLiveSelection =
    Boolean(textarea)
    && (!options.requireFocus || document.activeElement === textarea);
  const liveSelection = canUseLiveSelection
    ? readTextareaSelection(textarea, options.fallbackLength)
    : null;

  return (
    liveSelection
    ?? normalizeTextSelectionRange(options.lastSelection, options.fallbackLength)
    ?? createCollapsedTextSelection(options.fallbackLength, options.fallbackLength)
  );
}

export function restoreTextareaSelection(
  textarea: HTMLTextAreaElement | null | undefined,
  selection: TextSelectionRange | number,
  fallbackLength: number,
  options: RestoreTextareaSelectionOptions = {}
): TextSelectionRange | null {
  if (!textarea) {
    return null;
  }

  const normalizedSelection =
    typeof selection === 'number'
      ? createCollapsedTextSelection(selection, fallbackLength)
      : normalizeTextSelectionRange(selection, fallbackLength)
        ?? createCollapsedTextSelection(fallbackLength, fallbackLength);

  textarea.focus();
  textarea.setSelectionRange(normalizedSelection.start, normalizedSelection.end);
  options.syncScroll?.();
  options.onAfterRestore?.(textarea, normalizedSelection);

  return normalizedSelection;
}

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;
  const safeCaretIndex = clampIndex(caretIndex, textarea.value.length);

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

  mirror.textContent = textarea.value.slice(0, safeCaretIndex);

  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(safeCaretIndex, safeCaretIndex + 1) || ' ';
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

export function resolveTextareaPickerAnchor(
  options: ResolveTextareaPickerAnchorOptions
): PickerAnchor {
  const {
    container,
    textarea,
    caretIndex,
    zoom = 1,
    yOffset = 20,
    fallbackAnchor = DEFAULT_PICKER_ANCHOR,
  } = options;

  if (!container) {
    return fallbackAnchor;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  return {
    left: Math.max(0, (textareaRect.left - containerRect.left) / safeZoom + caretOffset.left),
    top: Math.max(
      0,
      (textareaRect.top - containerRect.top) / safeZoom + caretOffset.top + yOffset
    ),
  };
}
