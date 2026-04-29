import {
  CANVAS_NODE_TYPES,
  normalizeScriptStoryNoteNodeData,
  type CanvasNode,
  type ScriptStoryNoteNodeData,
  type ScriptStoryNotePromptEntry,
} from '@/features/canvas/domain/canvasNodes';

export const SCRIPT_STORY_NOTE_MAX_LENGTH = 2000;
export const SCRIPT_STORY_NOTE_TOTAL_PROMPT_LIMIT = 6000;
const SCRIPT_STORY_NOTE_GUARDRAIL_LENGTH = 260;

function normalizeMultilineText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    : '';
}

function clampCharacters(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) {
    return text;
  }

  return characters.slice(0, limit).join('').trimEnd();
}

function truncateInlineText(text: string, limit: number): string {
  const normalized = normalizeMultilineText(text).replace(/\n+/g, ' ');
  if (!normalized) {
    return '';
  }

  const truncated = clampCharacters(normalized, limit);
  return truncated.length < normalized.length
    ? `${truncated}...`
    : truncated;
}

function resolveStoryNoteTitle(title: string, index: number): string {
  const normalizedTitle = normalizeMultilineText(title);
  return normalizedTitle || `Story Note ${index + 1}`;
}

function toNormalizedStoryNoteData(node: CanvasNode): ScriptStoryNoteNodeData | null {
  if (node.type !== CANVAS_NODE_TYPES.scriptStoryNote) {
    return null;
  }

  return normalizeScriptStoryNoteNodeData(node.data as ScriptStoryNoteNodeData);
}

export function clampScriptStoryNoteContent(
  content: string,
  limit = SCRIPT_STORY_NOTE_MAX_LENGTH
): string {
  return clampCharacters(normalizeMultilineText(content), limit);
}

export function collectEnabledScriptStoryNotes(nodes: CanvasNode[]): ScriptStoryNotePromptEntry[] {
  const storyNotes: ScriptStoryNotePromptEntry[] = [];
  let remainingContentBudget = SCRIPT_STORY_NOTE_TOTAL_PROMPT_LIMIT;

  for (const node of nodes) {
    const data = toNormalizedStoryNoteData(node);
    if (!data?.isEnabled) {
      continue;
    }

    const normalizedContent = clampScriptStoryNoteContent(data.content);
    if (!normalizedContent || remainingContentBudget <= 0) {
      continue;
    }

    const content = clampCharacters(normalizedContent, remainingContentBudget).trim();
    if (!content) {
      continue;
    }

    storyNotes.push({
      title: resolveStoryNoteTitle(data.title, storyNotes.length),
      content,
    });
    remainingContentBudget -= Array.from(content).length;
  }

  return storyNotes;
}

export function formatScriptStoryNotesPromptBlock(
  storyNotes: ScriptStoryNotePromptEntry[] | undefined,
  emptyText = 'None'
): string {
  if (!storyNotes || storyNotes.length === 0) {
    return emptyText;
  }

  return storyNotes
    .map((note, index) => [
      `[${index + 1}] ${resolveStoryNoteTitle(note.title, index)}`,
      note.content,
    ].join('\n'))
    .join('\n\n');
}

export function formatScriptStoryNoteGuardrails(
  storyNotes: ScriptStoryNotePromptEntry[],
  maxLength = SCRIPT_STORY_NOTE_GUARDRAIL_LENGTH
): string[] {
  return storyNotes.map((note, index) => {
    const title = resolveStoryNoteTitle(note.title, index);
    const summary = truncateInlineText(note.content, maxLength);
    return summary ? `${title}: ${summary}` : title;
  });
}
