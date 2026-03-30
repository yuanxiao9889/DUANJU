import { generateText } from '@/commands/textGen';
import {
  CANVAS_NODE_TYPES,
  normalizeSceneCards,
  type CanvasNode,
  type SceneCard,
  type ScriptCharacterNodeData,
  type ScriptChapterNodeData,
  type ScriptItemNodeData,
  type ScriptLocationNodeData,
  type ScriptRootNodeData,
  type ScriptWorldviewNodeData,
} from '../domain/canvasNodes';

export interface SceneContinuityMemory {
  summary: string;
  facts: string[];
  openLoops: string[];
  updatedAt: number;
}

export interface SceneContinuityReference {
  label: string;
  summary: string;
  facts: string[];
  openLoops: string[];
}

export interface SceneContinuityContext {
  guardrails: string[];
  relevantMemories: SceneContinuityReference[];
}

interface BuildSceneContinuityContextOptions {
  nodes: CanvasNode[];
  currentChapterId: string;
  currentSceneId: string;
  currentScene: SceneCard;
  storyRoot?: ScriptRootNodeData | null;
}

interface GenerateSceneContinuityMemoryOptions {
  scene: SceneCard;
  chapter: ScriptChapterNodeData;
  storyRoot?: ScriptRootNodeData | null;
  continuityContext?: SceneContinuityContext | null;
}

interface TimelineSceneEntry {
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  branchType: string;
  depth: number;
  scene: SceneCard;
  sequence: number;
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

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function dedupeLines(lines: string[], limit: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const line of lines) {
    const trimmed = normalizeWhitespace(line);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function summarizeDraftText(draftHtml: string): string {
  const draftText = htmlToPlainText(draftHtml);
  if (!draftText) {
    return '';
  }

  return truncateText(draftText, 180);
}

function resolveSceneContinuityMemory(scene: SceneCard): SceneContinuityReference {
  const facts = dedupeLines(scene.continuityFacts ?? [], 8);
  const openLoops = dedupeLines(scene.continuityOpenLoops ?? [], 6);
  const summary = normalizeWhitespace(
    scene.continuitySummary
    || scene.summary
    || summarizeDraftText(scene.draftHtml)
    || scene.title
  );
  const fallbackFacts = dedupeLines(
    [
      scene.povCharacter ? `POV：${scene.povCharacter}` : '',
      scene.goal ? `目标：${scene.goal}` : '',
      scene.conflict ? `阻碍：${scene.conflict}` : '',
      scene.turn ? `变化：${scene.turn}` : '',
      scene.emotionalShift ? `情绪位移：${scene.emotionalShift}` : '',
    ],
    5
  );

  return {
    label: scene.title || `Scene ${scene.order + 1}`,
    summary,
    facts: facts.length > 0 ? facts : fallbackFacts,
    openLoops,
  };
}

function buildSceneSearchText(scene: SceneCard): string {
  return [
    scene.title,
    scene.summary,
    scene.purpose,
    scene.povCharacter,
    scene.goal,
    scene.conflict,
    scene.turn,
    scene.emotionalShift,
    scene.visualHook,
    scene.subtext,
    scene.directorNotes,
    scene.continuitySummary,
    ...(scene.continuityFacts ?? []),
    ...(scene.continuityOpenLoops ?? []),
    summarizeDraftText(scene.draftHtml),
  ]
    .filter(Boolean)
    .join('\n');
}

function extractNeedlePhrases(scene: SceneCard, storyRoot?: ScriptRootNodeData | null): string[] {
  const rawPhrases = [
    scene.povCharacter,
    storyRoot?.protagonist ?? '',
    scene.title,
    scene.summary,
    scene.goal,
    scene.conflict,
    scene.turn,
    ...(scene.continuityFacts ?? []),
    ...(scene.continuityOpenLoops ?? []),
  ]
    .join('\n')
    .split(/[\n,，。！？!?:：;；、()（）]+/g)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length >= 2 && part.length <= 40);

  return dedupeLines(rawPhrases, 12);
}

function scoreSceneRelevance(
  currentScene: SceneCard,
  candidateScene: SceneCard,
  storyRoot?: ScriptRootNodeData | null
): number {
  const candidateText = buildSceneSearchText(candidateScene);
  const needles = extractNeedlePhrases(currentScene, storyRoot);
  let score = 0;

  if (
    currentScene.povCharacter.trim()
    && candidateText.includes(currentScene.povCharacter.trim())
  ) {
    score += 6;
  }

  for (const needle of needles) {
    if (candidateText.includes(needle)) {
      score += 2;
    }
  }

  score += Math.min(candidateScene.continuityOpenLoops?.length ?? 0, 2);
  return score;
}

function sortTimelineChapters(a: CanvasNode, b: CanvasNode): number {
  const chapterA = a.data as ScriptChapterNodeData;
  const chapterB = b.data as ScriptChapterNodeData;
  const numberDelta = (chapterA.chapterNumber || 0) - (chapterB.chapterNumber || 0);
  if (numberDelta !== 0) {
    return numberDelta;
  }

  const branchRankA = chapterA.branchType === 'main' ? 0 : 1;
  const branchRankB = chapterB.branchType === 'main' ? 0 : 1;
  if (branchRankA !== branchRankB) {
    return branchRankA - branchRankB;
  }

  const depthDelta = (chapterA.depth || 0) - (chapterB.depth || 0);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  const branchIndexDelta = (chapterA.branchIndex || 0) - (chapterB.branchIndex || 0);
  if (branchIndexDelta !== 0) {
    return branchIndexDelta;
  }

  const positionYDelta = (a.position?.y || 0) - (b.position?.y || 0);
  if (positionYDelta !== 0) {
    return positionYDelta;
  }

  return (a.position?.x || 0) - (b.position?.x || 0);
}

function formatSceneReference(entry: TimelineSceneEntry): SceneContinuityReference {
  const memory = resolveSceneContinuityMemory(entry.scene);

  return {
    ...memory,
    label: `第 ${entry.chapterNumber} 章 / 场景 ${entry.scene.order + 1} · ${entry.scene.title || memory.label}`,
  };
}

function buildTimelineEntries(nodes: CanvasNode[]): TimelineSceneEntry[] {
  const chapters = nodes
    .filter((node) => node.type === CANVAS_NODE_TYPES.scriptChapter)
    .sort(sortTimelineChapters);

  const timeline: TimelineSceneEntry[] = [];

  chapters.forEach((chapterNode) => {
    const chapterData = chapterNode.data as ScriptChapterNodeData;
    const scenes = normalizeSceneCards(chapterData.scenes, chapterData.content)
      .slice()
      .sort((left, right) => left.order - right.order);

    scenes.forEach((scene) => {
      timeline.push({
        chapterId: chapterNode.id,
        chapterTitle: chapterData.title || chapterData.displayName || 'Untitled Chapter',
        chapterNumber: chapterData.chapterNumber || 1,
        branchType: chapterData.branchType || 'main',
        depth: chapterData.depth || 1,
        scene,
        sequence: timeline.length,
      });
    });
  });

  return timeline;
}

function resolveCharacterGuardrails(
  nodes: CanvasNode[],
  currentSceneText: string,
  storyRoot?: ScriptRootNodeData | null
): string[] {
  const protagonist = normalizeWhitespace(storyRoot?.protagonist ?? '');
  const characterNodes = nodes.filter(
    (node) => node.type === CANVAS_NODE_TYPES.scriptCharacter
  ) as Array<{ data: ScriptCharacterNodeData }>;

  const selected = characterNodes
    .filter((node) => {
      const name = normalizeWhitespace(node.data.name || node.data.displayName || '');
      if (!name) {
        return false;
      }

      return currentSceneText.includes(name) || protagonist.includes(name);
    })
    .slice(0, 6);

  return dedupeLines(
    selected.map((node) => {
      const name = normalizeWhitespace(node.data.name || node.data.displayName || '');
      const details = [
        node.data.description,
        node.data.personality,
        node.data.appearance,
      ]
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
        .join('；');

      return details ? `角色：${name} - ${details}` : `角色：${name}`;
    }),
    6
  );
}

function resolveLocationGuardrails(nodes: CanvasNode[], currentSceneText: string): string[] {
  const locationNodes = nodes.filter(
    (node) => node.type === CANVAS_NODE_TYPES.scriptLocation
  ) as Array<{ data: ScriptLocationNodeData }>;

  return dedupeLines(
    locationNodes
      .filter((node) => {
        const name = normalizeWhitespace(node.data.name || node.data.displayName || '');
        return Boolean(name) && currentSceneText.includes(name);
      })
      .slice(0, 4)
      .map((node) => {
        const name = normalizeWhitespace(node.data.name || node.data.displayName || '');
        const description = normalizeWhitespace(node.data.description || '');
        return description ? `地点：${name} - ${description}` : `地点：${name}`;
      }),
    4
  );
}

function resolveItemGuardrails(nodes: CanvasNode[], currentSceneText: string): string[] {
  const itemNodes = nodes.filter(
    (node) => node.type === CANVAS_NODE_TYPES.scriptItem
  ) as Array<{ data: ScriptItemNodeData }>;

  return dedupeLines(
    itemNodes
      .filter((node) => {
        const name = normalizeWhitespace(node.data.name || node.data.displayName || '');
        return Boolean(name) && currentSceneText.includes(name);
      })
      .slice(0, 4)
      .map((node) => {
        const name = normalizeWhitespace(node.data.name || node.data.displayName || '');
        const description = normalizeWhitespace(node.data.description || '');
        return description ? `道具：${name} - ${description}` : `道具：${name}`;
      }),
    4
  );
}

function resolveWorldviewGuardrails(nodes: CanvasNode[]): string[] {
  const worldviewNodes = nodes.filter(
    (node) => node.type === CANVAS_NODE_TYPES.scriptWorldview
  ) as Array<{ data: ScriptWorldviewNodeData }>;

  return dedupeLines(
    worldviewNodes.slice(0, 2).map((node) => {
      const title = normalizeWhitespace(node.data.worldviewName || node.data.displayName || '世界观');
      const details = [
        node.data.description,
        node.data.era,
        node.data.technology,
        node.data.magic,
        node.data.society,
        node.data.geography,
      ]
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
        .join('；');

      return details ? `世界观：${title} - ${details}` : `世界观：${title}`;
    }),
    2
  );
}

export function buildSceneContinuityContext({
  nodes,
  currentChapterId,
  currentSceneId,
  currentScene,
  storyRoot,
}: BuildSceneContinuityContextOptions): SceneContinuityContext {
  const timeline = buildTimelineEntries(nodes);
  const currentIndex = timeline.findIndex(
    (entry) => entry.chapterId === currentChapterId && entry.scene.id === currentSceneId
  );
  const previousEntries = currentIndex >= 0 ? timeline.slice(0, currentIndex) : [];
  const recentEntries = previousEntries.slice(-3);
  const currentSceneText = buildSceneSearchText(currentScene);

  const scoredOlderEntries = previousEntries
    .slice(0, Math.max(0, previousEntries.length - recentEntries.length))
    .map((entry) => ({
      entry,
      score: scoreSceneRelevance(currentScene, entry.scene, storyRoot),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.sequence - left.entry.sequence)
    .slice(0, 3)
    .map((item) => item.entry);

  const relevantMemories = dedupeLines(
    [...recentEntries, ...scoredOlderEntries].map((entry) => `${entry.chapterId}:${entry.scene.id}`),
    6
  )
    .map((key) => {
      const [chapterId, sceneId] = key.split(':');
      return [...recentEntries, ...scoredOlderEntries].find(
        (entry) => entry.chapterId === chapterId && entry.scene.id === sceneId
      );
    })
    .filter((entry): entry is TimelineSceneEntry => Boolean(entry))
    .map(formatSceneReference);

  const storyGuardrails = dedupeLines(
    [
      storyRoot?.premise ? `故事前提：${storyRoot.premise}` : '',
      storyRoot?.theme ? `主题：${storyRoot.theme}` : '',
      storyRoot?.protagonist ? `主角：${storyRoot.protagonist}` : '',
      storyRoot?.want ? `主角外在目标：${storyRoot.want}` : '',
      storyRoot?.stakes ? `失败代价：${storyRoot.stakes}` : '',
      storyRoot?.tone ? `基调：${storyRoot.tone}` : '',
      storyRoot?.directorVision ? `导演视角：${storyRoot.directorVision}` : '',
      ...(storyRoot?.beats ?? [])
        .filter((beat) => normalizeWhitespace(beat.summary).length > 0)
        .slice(0, 6)
        .map((beat) => `核心节拍：${beat.title || beat.key} - ${beat.summary}`),
    ],
    10
  );

  const guardrails = dedupeLines(
    [
      ...storyGuardrails,
      ...resolveCharacterGuardrails(nodes, currentSceneText, storyRoot),
      ...resolveLocationGuardrails(nodes, currentSceneText),
      ...resolveItemGuardrails(nodes, currentSceneText),
      ...resolveWorldviewGuardrails(nodes),
    ],
    18
  );

  return {
    guardrails,
    relevantMemories,
  };
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? normalizeWhitespace(value) : '';
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeLines(
    value.map((item) => (typeof item === 'string' ? item : '')),
    limit
  );
}

export async function generateSceneContinuityMemory({
  scene,
  chapter,
  storyRoot,
  continuityContext,
}: GenerateSceneContinuityMemoryOptions): Promise<SceneContinuityMemory> {
  const draftText = htmlToPlainText(scene.draftHtml);
  const existingSummary = normalizeWhitespace(scene.continuitySummary);
  const existingFacts = dedupeLines(scene.continuityFacts ?? [], 8);
  const existingOpenLoops = dedupeLines(scene.continuityOpenLoops ?? [], 6);

  const prompt = [
    'You are a screenplay continuity editor.',
    'Extract a durable memory card for the current scene so later drafting stays consistent.',
    'Respond in the dominant language of the scene and notes.',
    'Only include facts established by the structured fields or scene draft.',
    'Do not invent new plot points, motives, or relationships.',
    'Facts should be concrete continuity anchors, not writing advice.',
    'Open loops should only contain unresolved dramatic threads, promises, obligations, secrets, or questions that matter later.',
    'Return valid JSON only using exactly this shape:',
    '{"summary":"...","facts":["..."],"openLoops":["..."]}',
    '',
    'Current story root:',
    `- Title: ${normalizeWhitespace(storyRoot?.title || storyRoot?.displayName || 'Untitled Story') || 'Untitled Story'}`,
    `- Premise: ${normalizeWhitespace(storyRoot?.premise ?? '') || 'Not specified'}`,
    `- Theme: ${normalizeWhitespace(storyRoot?.theme ?? '') || 'Not specified'}`,
    `- Protagonist: ${normalizeWhitespace(storyRoot?.protagonist ?? '') || 'Not specified'}`,
    '',
    'Current chapter:',
    `- Chapter title: ${normalizeWhitespace(chapter.title) || 'Untitled Chapter'}`,
    `- Chapter summary: ${normalizeWhitespace(chapter.summary) || 'Not specified'}`,
    `- Chapter purpose: ${normalizeWhitespace(chapter.chapterPurpose ?? '') || 'Not specified'}`,
    '',
    'Current scene structured fields:',
    `- Scene title: ${normalizeWhitespace(scene.title) || 'Untitled Scene'}`,
    `- Scene summary: ${normalizeWhitespace(scene.summary) || 'Not specified'}`,
    `- POV character: ${normalizeWhitespace(scene.povCharacter) || 'Not specified'}`,
    `- Scene purpose: ${normalizeWhitespace(scene.purpose) || 'Not specified'}`,
    `- Goal: ${normalizeWhitespace(scene.goal) || 'Not specified'}`,
    `- Conflict: ${normalizeWhitespace(scene.conflict) || 'Not specified'}`,
    `- Turn: ${normalizeWhitespace(scene.turn) || 'Not specified'}`,
    `- Emotional shift: ${normalizeWhitespace(scene.emotionalShift) || 'Not specified'}`,
    `- Visual hook: ${normalizeWhitespace(scene.visualHook) || 'Not specified'}`,
    `- Subtext: ${normalizeWhitespace(scene.subtext) || 'Not specified'}`,
    `- Director notes: ${normalizeWhitespace(scene.directorNotes) || 'Not specified'}`,
    '',
    'Current draft:',
    draftText || 'No scene draft yet.',
    '',
    'Existing memory card to refine:',
    `- Summary: ${existingSummary || 'None'}`,
    `- Facts: ${existingFacts.length > 0 ? existingFacts.join(' | ') : 'None'}`,
    `- Open loops: ${existingOpenLoops.length > 0 ? existingOpenLoops.join(' | ') : 'None'}`,
    '',
    formatContinuityContext(continuityContext),
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.25,
    maxTokens: 1200,
  });

  const parsed = parseJsonObject(result.text);
  const summary = normalizeString(parsed?.summary) || normalizeWhitespace(scene.summary) || truncateText(draftText, 160);
  const facts = normalizeStringList(parsed?.facts, 8);
  const openLoops = normalizeStringList(parsed?.openLoops, 6);

  return {
    summary,
    facts: facts.length > 0 ? facts : resolveSceneContinuityMemory(scene).facts,
    openLoops,
    updatedAt: Date.now(),
  };
}
