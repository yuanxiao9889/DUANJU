import {
  CANVAS_NODE_TYPES,
  normalizeScriptCharacterNodeData,
  type CanvasEdge,
  type CanvasNode,
  type ScriptCharacterNodeData,
  type ScriptCharacterPromptEntry,
} from '@/features/canvas/domain/canvasNodes';

export const SCRIPT_CHARACTER_NOTE_TOTAL_PROMPT_LIMIT = 6000;

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

function hasCharacterReferenceContent(entry: ScriptCharacterPromptEntry): boolean {
  return Boolean(
    entry.name
    || entry.description
    || entry.personality
    || entry.appearance
  );
}

function toPromptEntry(data: ScriptCharacterNodeData): ScriptCharacterPromptEntry | null {
  const normalized = normalizeScriptCharacterNodeData(data);
  const entry = {
    name: normalizeMultilineText(normalized.name),
    description: normalizeMultilineText(normalized.description),
    personality: normalizeMultilineText(normalized.personality),
    appearance: normalizeMultilineText(normalized.appearance),
  };

  return hasCharacterReferenceContent(entry) ? entry : null;
}

function clampEntryToBudget(
  entry: ScriptCharacterPromptEntry,
  remainingBudget: number
): { entry: ScriptCharacterPromptEntry; used: number } | null {
  if (remainingBudget <= 0) {
    return null;
  }

  const fields: Array<keyof ScriptCharacterPromptEntry> = [
    'name',
    'description',
    'personality',
    'appearance',
  ];
  const nextEntry: ScriptCharacterPromptEntry = {
    name: '',
    description: '',
    personality: '',
    appearance: '',
  };
  let remaining = remainingBudget;

  for (const field of fields) {
    const value = entry[field];
    if (!value || remaining <= 0) {
      continue;
    }

    const clamped = clampCharacters(value, remaining);
    nextEntry[field] = clamped;
    remaining -= Array.from(clamped).length;
  }

  if (!hasCharacterReferenceContent(nextEntry)) {
    return null;
  }

  return {
    entry: nextEntry,
    used: remainingBudget - remaining,
  };
}

export function collectConnectedScriptCharacterNotes(
  targetNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  totalLimit = SCRIPT_CHARACTER_NOTE_TOTAL_PROMPT_LIMIT
): ScriptCharacterPromptEntry[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const seenNodeIds = new Set<string>();
  const entries: ScriptCharacterPromptEntry[] = [];
  let remainingBudget = totalLimit;

  for (const edge of edges) {
    if (edge.target !== targetNodeId || seenNodeIds.has(edge.source)) {
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode || sourceNode.type !== CANVAS_NODE_TYPES.scriptCharacter) {
      continue;
    }

    seenNodeIds.add(sourceNode.id);
    const entry = toPromptEntry(sourceNode.data as ScriptCharacterNodeData);
    if (!entry) {
      continue;
    }

    const clamped = clampEntryToBudget(entry, remainingBudget);
    if (!clamped) {
      break;
    }

    entries.push(clamped.entry);
    remainingBudget -= clamped.used;
  }

  return entries;
}
