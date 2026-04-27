import {
  insertReferenceToken,
  removeTextRange,
} from "@/features/canvas/application/referenceTokenEditing";
import type { TextSelectionRange } from "@/features/canvas/application/textareaSelection";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatShotParamToken(value: string): string {
  return `【${value}】`;
}

export function insertShotParamToken(
  text: string,
  selection: TextSelectionRange,
  value: string,
): { nextText: string; nextCursor: number } {
  const safeStart = clamp(Math.min(selection.start, selection.end), 0, text.length);
  const safeEnd = clamp(Math.max(selection.start, selection.end), 0, text.length);
  const token = formatShotParamToken(value);

  if (safeStart === safeEnd) {
    return insertReferenceToken(text, safeStart, token);
  }

  const { nextText: textWithoutSelection, nextCursor } = removeTextRange(text, {
    start: safeStart,
    end: safeEnd,
  });
  return insertReferenceToken(textWithoutSelection, nextCursor, token);
}
