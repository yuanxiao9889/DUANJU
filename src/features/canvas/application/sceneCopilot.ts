import { generateText } from '@/commands/textGen';
import type {
  SceneCard,
  SceneCopilotMessageMode,
  SceneCopilotThreadMessage,
  ScriptChapterNodeData,
  ScriptRootNodeData,
  ScriptStoryNotePromptEntry,
  StoryBeat,
} from '../domain/canvasNodes';
import type { SceneContinuityContext } from './sceneContinuity';
import { formatScriptStoryNotesPromptBlock } from './scriptStoryNotes';

export type SceneCopilotMode = Exclude<SceneCopilotMessageMode, 'seed'>;

type SceneCopilotHistoryMessage = Pick<
  SceneCopilotThreadMessage,
  'role' | 'content' | 'selectionVariants'
>;

export interface SceneCopilotRequest {
  mode: SceneCopilotMode;
  userPrompt?: string;
  selectionText?: string;
  scene: SceneCard;
  chapter: ScriptChapterNodeData;
  storyRoot?: ScriptRootNodeData | null;
  storyNotes?: ScriptStoryNotePromptEntry[];
  history?: SceneCopilotHistoryMessage[];
  continuityContext?: SceneContinuityContext | null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToPlainText(html: string): string {
  if (!html.trim()) {
    return '';
  }

  return decodeHtmlEntities(
    html
      .replace(/<hr\s*\/?>/gi, '\n---\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

function trimOrFallback(value: string | undefined, fallback = 'Not specified'): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || fallback;
}

function formatBeats(beats: StoryBeat[] | undefined): string {
  if (!beats?.length) {
    return 'None';
  }

  return beats
    .map((beat) => {
      const title = trimOrFallback(beat.title, beat.key);
      const summary = trimOrFallback(beat.summary, 'No summary');
      return `- ${title}: ${summary}`;
    })
    .join('\n');
}

function formatHistory(
  history: SceneCopilotHistoryMessage[] | undefined
): string {
  if (!history?.length) {
    return 'None';
  }

  return history
    .slice(-6)
    .map((message) => {
      const parts = [message.content.trim()].filter(Boolean);
      if (message.selectionVariants?.length) {
        parts.push(
          message.selectionVariants
            .map((variant, index) => `Variant ${index + 1}:\n${variant}`)
            .join('\n\n')
        );
      }

      return `${message.role === 'user' ? 'User' : 'Assistant'}: ${parts.join('\n\n')}`.trim();
    })
    .join('\n\n');
}

function formatContinuityContext(context: SceneContinuityContext | null | undefined): string {
  if (!context) {
    return 'None';
  }

  const guardrails = context.guardrails.length > 0
    ? context.guardrails.map((line) => `- ${line}`).join('\n')
    : '- None';

  const memories = context.relevantMemories.length > 0
    ? context.relevantMemories.map((memory) => {
      const facts = memory.facts.length > 0
        ? memory.facts.map((fact) => `  - ${fact}`).join('\n')
        : '  - None';
      const openLoops = memory.openLoops.length > 0
        ? memory.openLoops.map((fact) => `  - ${fact}`).join('\n')
        : '  - None';

      return [
        `- ${memory.label}`,
        `  Summary: ${memory.summary || 'None'}`,
        '  Facts:',
        facts,
        '  Open loops:',
        openLoops,
      ].join('\n');
    }).join('\n')
    : '- None';

  return [
    'Continuity guardrails:',
    guardrails,
    '',
    'Relevant previous scene memories:',
    memories,
  ].join('\n');
}

function buildTaskInstruction(mode: SceneCopilotMode, userPrompt: string): string {
  switch (mode) {
    case 'analysis':
      return [
        'Analyze the current scene like a screenwriter-director.',
        'If you spot a continuity risk against the provided memory or guardrails, call it out explicitly.',
        'Use short markdown sections named:',
        '## What Works',
        '## Risks',
        '## Director Angle',
        '## Next Revision',
        'Stay concrete and actionable.',
      ].join('\n');
    case 'continue':
      return [
        'Continue the scene draft from the last written beat.',
        'If the draft is empty, write a strong opening for this scene.',
        'Do not contradict established continuity guardrails or previous scene memory.',
        'If continuity is unclear, preserve existing facts and avoid inventing irreversible new canon.',
        'Output only the continuation text the writer could paste into the draft.',
        'Do not explain your choices or add headings.',
      ].join('\n');
    case 'director':
      return [
        'Give the writer a director-minded pass on this scene.',
        'Preserve established continuity and point out any contradiction risk before suggesting a stronger staging idea.',
        'Use short markdown sections named:',
        '## Blocking',
        '## Camera',
        '## Rhythm',
        '## Performance',
        'Keep it cinematic and practical.',
      ].join('\n');
    case 'selection':
      return [
        'Rewrite only the selected passage.',
        'Preserve the meaning unless the user explicitly asks for a stronger change.',
        'Do not break established continuity guardrails or previous scene memory.',
        'Keep character names, screenplay intent, and formatting natural.',
        'Output only the rewritten passage with no explanation, no markdown fence, and no quotation marks.',
        userPrompt.trim() ? `Rewrite goal: ${userPrompt.trim()}` : 'Rewrite goal: make it sharper and more dramatic.',
      ].join('\n');
    case 'custom':
    default:
      return [
        'Answer the writer using the current story and scene context.',
        'If the request would create a continuity contradiction, name the contradiction and suggest a safe alternative.',
        'Be specific, practical, and supportive.',
        userPrompt.trim() ? `User request: ${userPrompt.trim()}` : 'User request: Help improve this scene.',
      ].join('\n');
  }
}

function buildSelectionVariantsTaskInstruction(userPrompt: string): string {
  return [
    'Rewrite only the selected passage.',
    'Return exactly 3 distinct rewrite variants.',
    'Preserve the meaning unless the user explicitly asks for a stronger change.',
    'Do not break established continuity guardrails or previous scene memory.',
    'Keep character names, screenplay intent, and formatting natural.',
    'Make the variants meaningfully different in rhythm, subtext, or intensity.',
    'Return valid JSON only, with this exact shape:',
    '{"variants":["variant 1","variant 2","variant 3"]}',
    'Do not wrap the JSON in markdown fences.',
    'Do not include any explanation or extra keys.',
    userPrompt.trim() ? `Rewrite goal: ${userPrompt.trim()}` : 'Rewrite goal: make it sharper and more dramatic.',
  ].join('\n');
}

function resolveTemperature(mode: SceneCopilotMode): number {
  switch (mode) {
    case 'analysis':
      return 0.45;
    case 'director':
      return 0.55;
    case 'continue':
      return 0.82;
    case 'selection':
      return 0.72;
    case 'custom':
    default:
      return 0.68;
  }
}

function buildPrompt(request: SceneCopilotRequest): string {
  return buildPromptWithTask(request, buildTaskInstruction(request.mode, request.userPrompt?.trim() ?? ''));
}

function buildPromptWithTask(request: SceneCopilotRequest, taskInstruction: string): string {
  const sceneDraftText = htmlToPlainText(request.scene.draftHtml);
  const selectionText = request.selectionText?.trim() ?? '';

  return [
    'You are a scene copilot who thinks like both a dramatic screenwriter and a visual director.',
    'Respond in the dominant language of the user request and scene context.',
    'Ground every suggestion in the current story context. Avoid generic advice.',
    '',
    'Story context:',
    `- Title: ${trimOrFallback(request.storyRoot?.title || request.storyRoot?.displayName, 'Untitled Story')}`,
    `- Premise: ${trimOrFallback(request.storyRoot?.premise)}`,
    `- Theme: ${trimOrFallback(request.storyRoot?.theme)}`,
    `- Protagonist: ${trimOrFallback(request.storyRoot?.protagonist)}`,
    `- External goal: ${trimOrFallback(request.storyRoot?.want)}`,
    `- Stakes: ${trimOrFallback(request.storyRoot?.stakes)}`,
    `- Tone: ${trimOrFallback(request.storyRoot?.tone)}`,
    `- Director lens: ${trimOrFallback(request.storyRoot?.directorVision)}`,
    `- Core beats:\n${formatBeats(request.storyRoot?.beats)}`,
    '',
    'Story reference notes:',
    formatScriptStoryNotesPromptBlock(request.storyNotes, 'None'),
    '',
    'Chapter context:',
    `- Chapter number: ${request.chapter.chapterNumber || 1}`,
    `- Chapter title: ${trimOrFallback(request.chapter.title, 'Untitled Chapter')}`,
    `- Chapter summary: ${trimOrFallback(request.chapter.summary)}`,
    `- Chapter purpose: ${trimOrFallback(request.chapter.chapterPurpose)}`,
    `- Chapter question: ${trimOrFallback(request.chapter.chapterQuestion)}`,
    '',
    'Scene context:',
    `- Scene title: ${trimOrFallback(request.scene.title, 'Untitled Scene')}`,
    `- POV character: ${trimOrFallback(request.scene.povCharacter)}`,
    `- Scene summary: ${trimOrFallback(request.scene.summary)}`,
    `- Scene purpose: ${trimOrFallback(request.scene.purpose)}`,
    `- Goal: ${trimOrFallback(request.scene.goal)}`,
    `- Conflict: ${trimOrFallback(request.scene.conflict)}`,
    `- Turn: ${trimOrFallback(request.scene.turn)}`,
    `- Emotional shift: ${trimOrFallback(request.scene.emotionalShift)}`,
    `- Visual hook: ${trimOrFallback(request.scene.visualHook)}`,
    `- Subtext: ${trimOrFallback(request.scene.subtext)}`,
    `- Director notes: ${trimOrFallback(request.scene.directorNotes)}`,
    `- Continuity summary: ${trimOrFallback(request.scene.continuitySummary)}`,
    `- Continuity facts: ${
      request.scene.continuityFacts.length > 0
        ? request.scene.continuityFacts.join(' | ')
        : 'None'
    }`,
    `- Continuity open loops: ${
      request.scene.continuityOpenLoops.length > 0
        ? request.scene.continuityOpenLoops.join(' | ')
        : 'None'
    }`,
    `- Current draft:\n${sceneDraftText || 'No draft yet.'}`,
    request.mode === 'selection'
      ? `- Selected passage to rewrite:\n${selectionText || 'No selected text provided.'}`
      : '',
    '',
    'Continuity context:',
    formatContinuityContext(request.continuityContext),
    '',
    'Recent conversation:',
    formatHistory(request.history),
    '',
    'Your task:',
    taskInstruction,
  ].join('\n');
}

function normalizeSelectionVariants(variants: unknown): string[] {
  if (!Array.isArray(variants)) {
    return [];
  }

  const uniqueVariants = new Set<string>();
  const normalizedVariants: string[] = [];

  for (const variant of variants) {
    const normalized = typeof variant === 'string' ? variant.trim() : '';
    if (!normalized || uniqueVariants.has(normalized)) {
      continue;
    }
    uniqueVariants.add(normalized);
    normalizedVariants.push(normalized);
    if (normalizedVariants.length >= 3) {
      break;
    }
  }

  return normalizedVariants;
}

function tryParseSelectionVariantsFromJson(text: string): string[] {
  const candidates = [
    text.trim(),
    text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, ''),
  ];

  const firstBraceIndex = text.indexOf('{');
  const lastBraceIndex = text.lastIndexOf('}');
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    candidates.push(text.slice(firstBraceIndex, lastBraceIndex + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as { variants?: unknown } | unknown[];
      if (Array.isArray(parsed)) {
        const normalized = normalizeSelectionVariants(parsed);
        if (normalized.length > 0) {
          return normalized;
        }
      }

      if (parsed && typeof parsed === 'object' && 'variants' in parsed) {
        const normalized = normalizeSelectionVariants(parsed.variants);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    } catch {
      continue;
    }
  }

  return [];
}

function tryParseSelectionVariantsFromSections(text: string): string[] {
  const normalizedText = text
    .replace(/\r\n/g, '\n')
    .replace(/^```[\w-]*\n?/g, '')
    .replace(/\n?```$/g, '')
    .trim();

  const labeledVariantPattern =
    /(?:^|\n)(?:#{1,6}\s*)?(?:variant|version|option|方案|版本)\s*\d+\s*[:：\-]?\s*\n?([\s\S]*?)(?=(?:\n(?:#{1,6}\s*)?(?:variant|version|option|方案|版本)\s*\d+\s*[:：\-]?\s*\n)|$)/gi;
  const labeledVariants = Array.from(normalizedText.matchAll(labeledVariantPattern))
    .map((match) => match[1]?.trim() ?? '')
    .filter((variant) => variant.length > 0);
  if (labeledVariants.length > 0) {
    return normalizeSelectionVariants(labeledVariants);
  }

  const separatorVariants = normalizedText
    .split(/\n(?:---|\*\*\*)\n/g)
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0);
  if (separatorVariants.length > 1) {
    return normalizeSelectionVariants(separatorVariants);
  }

  return [];
}

function parseSelectionVariants(text: string): string[] {
  const fromJson = tryParseSelectionVariantsFromJson(text);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const fromSections = tryParseSelectionVariantsFromSections(text);
  if (fromSections.length > 0) {
    return fromSections;
  }

  const fallback = text.trim();
  return fallback ? [fallback] : [];
}

export async function runSceneCopilot(request: SceneCopilotRequest): Promise<string> {
  const result = await generateText({
    prompt: buildPrompt(request),
    temperature: resolveTemperature(request.mode),
    maxTokens: request.mode === 'continue' ? 2200 : 1600,
  });

  return result.text.trim();
}

export async function runSceneSelectionRewriteVariants(
  request: SceneCopilotRequest
): Promise<string[]> {
  const result = await generateText({
    prompt: buildPromptWithTask(
      request,
      buildSelectionVariantsTaskInstruction(request.userPrompt?.trim() ?? '')
    ),
    temperature: 0.8,
    maxTokens: 2400,
  });

  return parseSelectionVariants(result.text);
}
