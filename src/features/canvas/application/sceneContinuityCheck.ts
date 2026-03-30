import { generateText } from '@/commands/textGen';
import type {
  SceneCard,
  SceneContinuityCheck,
  SceneContinuityIssue,
  ScriptChapterNodeData,
  ScriptRootNodeData,
} from '../domain/canvasNodes';
import type { SceneContinuityContext } from './sceneContinuity';

export interface RunSceneContinuityCheckOptions {
  candidateText: string;
  candidateLabel: string;
  scene: SceneCard;
  chapter: ScriptChapterNodeData;
  storyRoot?: ScriptRootNodeData | null;
  continuityContext?: SceneContinuityContext | null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'');
}

function htmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  return decodeHtmlEntities(
    trimmed
      .replace(/<hr\s*\/?>/gi, '\n---\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function trimOrFallback(value: string | undefined | null, fallback = 'Not specified'): string {
  const trimmed = normalizeWhitespace(value ?? '');
  return trimmed || fallback;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const jsonFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = jsonFenceMatch?.[1] ?? text;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeSeverity(value: unknown): SceneContinuityIssue['severity'] {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function normalizeIssues(value: unknown): SceneContinuityIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((issue, index): SceneContinuityIssue | null => {
      const record = issue && typeof issue === 'object'
        ? issue as Record<string, unknown>
        : {};
      const title = normalizeWhitespace(typeof record.title === 'string' ? record.title : '');
      const detail = normalizeWhitespace(typeof record.detail === 'string' ? record.detail : '');
      if (!title || !detail) {
        return null;
      }

      const normalizedIssue: SceneContinuityIssue = {
        id: `continuity-check-${index + 1}`,
        severity: normalizeSeverity(record.severity),
        title,
        detail,
        evidence: normalizeWhitespace(typeof record.evidence === 'string' ? record.evidence : '') || undefined,
      };

      return normalizedIssue;
    })
    .filter((issue): issue is SceneContinuityIssue => issue !== null);
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
    'Relevant previous memories:',
    memories,
  ].join('\n');
}

export async function runSceneContinuityCheck(
  options: RunSceneContinuityCheckOptions
): Promise<SceneContinuityCheck> {
  const candidateText = options.candidateText.trim();
  if (!candidateText) {
    return {
      status: 'clear',
      summary: 'No candidate text to check.',
      issues: [],
      checkedAt: Date.now(),
    };
  }

  const prompt = [
    'You are a screenplay continuity checker.',
    'Check whether the candidate text contradicts established story continuity.',
    'Only flag direct contradictions or strong continuity risks based on the provided facts and memories.',
    'Do not flag style changes, stronger wording, or harmless ambiguity.',
    'If the candidate is safe, return status "clear".',
    'If there are contradictions or strong risks, return status "warning".',
    'Return valid JSON only with this exact shape:',
    '{"status":"clear|warning","summary":"...","issues":[{"severity":"low|medium|high","title":"...","detail":"...","evidence":"..."}]}',
    '',
    'Story root:',
    `- Title: ${trimOrFallback(options.storyRoot?.title || options.storyRoot?.displayName, 'Untitled Story')}`,
    `- Premise: ${trimOrFallback(options.storyRoot?.premise)}`,
    `- Theme: ${trimOrFallback(options.storyRoot?.theme)}`,
    `- Protagonist: ${trimOrFallback(options.storyRoot?.protagonist)}`,
    '',
    'Current chapter:',
    `- Chapter title: ${trimOrFallback(options.chapter.title, 'Untitled Chapter')}`,
    `- Chapter summary: ${trimOrFallback(options.chapter.summary)}`,
    `- Chapter purpose: ${trimOrFallback(options.chapter.chapterPurpose)}`,
    '',
    'Current scene established facts:',
    `- Scene title: ${trimOrFallback(options.scene.title, 'Untitled Scene')}`,
    `- Scene summary: ${trimOrFallback(options.scene.summary)}`,
    `- Goal: ${trimOrFallback(options.scene.goal)}`,
    `- Conflict: ${trimOrFallback(options.scene.conflict)}`,
    `- Turn: ${trimOrFallback(options.scene.turn)}`,
    `- Continuity summary: ${trimOrFallback(options.scene.continuitySummary)}`,
    `- Continuity facts: ${options.scene.continuityFacts.length > 0 ? options.scene.continuityFacts.join(' | ') : 'None'}`,
    `- Open loops: ${options.scene.continuityOpenLoops.length > 0 ? options.scene.continuityOpenLoops.join(' | ') : 'None'}`,
    '',
    formatContinuityContext(options.continuityContext),
    '',
    `Current full draft before applying ${options.candidateLabel}:`,
    htmlToPlainText(options.scene.draftHtml) || 'No draft yet.',
    '',
    `Candidate ${options.candidateLabel}:`,
    options.candidateText,
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.15,
    maxTokens: 1200,
  });

  const parsed = parseJsonObject(result.text);
  const issues = normalizeIssues(parsed?.issues);
  const status = parsed?.status === 'warning' || issues.length > 0 ? 'warning' : 'clear';
  const summary = normalizeWhitespace(typeof parsed?.summary === 'string' ? parsed.summary : '')
    || (status === 'warning'
      ? 'Potential continuity issues detected.'
      : 'No clear continuity conflict detected.');

  return {
    status,
    summary,
    issues,
    checkedAt: Date.now(),
  };
}
