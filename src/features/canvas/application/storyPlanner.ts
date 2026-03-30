import { generateText } from '@/commands/textGen';
import type { StoryBeatKey } from '../domain/canvasNodes';

export interface StoryPlannerInput {
  premise: string;
  protagonist: string;
  want: string;
  stakes: string;
  genre: string;
  theme: string;
  tone: string;
  directorVision: string;
  worldviewDescription: string;
  chapterCount: number;
}

export interface PlannedBeat {
  key: StoryBeatKey;
  title: string;
  summary: string;
  dramaticQuestion: string;
}

export interface PlannedScene {
  title: string;
  summary: string;
  purpose: string;
  povCharacter: string;
  goal: string;
  conflict: string;
  turn: string;
  emotionalShift: string;
  visualHook: string;
  subtext: string;
}

export interface PlannedChapter {
  number: number;
  title: string;
  summary: string;
  chapterPurpose: string;
  chapterQuestion: string;
  scenes: PlannedScene[];
}

export interface PlannedWorldview {
  name: string;
  description: string;
  era: string;
  technology: string;
  magic: string;
  society: string;
  geography: string;
}

export interface StoryPlan {
  title: string;
  genre: string;
  premise: string;
  theme: string;
  protagonist: string;
  want: string;
  need: string;
  stakes: string;
  tone: string;
  directorVision: string;
  beats: PlannedBeat[];
  chapters: PlannedChapter[];
  worldview?: PlannedWorldview;
}

const STORY_BEAT_KEYS: StoryBeatKey[] = [
  'opening',
  'inciting',
  'lock_in',
  'first_setback',
  'midpoint',
  'all_is_lost',
  'climax',
  'resolution',
];

const FALLBACK_BEAT_COPY: Record<StoryBeatKey, { title: string; dramaticQuestion: string }> = {
  opening: {
    title: 'Opening Image',
    dramaticQuestion: 'What emotional baseline or dramatic promise are we making?',
  },
  inciting: {
    title: 'Inciting Incident',
    dramaticQuestion: 'What event forces the story into motion?',
  },
  lock_in: {
    title: 'Lock In',
    dramaticQuestion: 'Why can the protagonist no longer stay unchanged?',
  },
  first_setback: {
    title: 'First Setback',
    dramaticQuestion: 'What early resistance proves the journey will be costly?',
  },
  midpoint: {
    title: 'Midpoint Shift',
    dramaticQuestion: 'What revelation or reversal changes the story direction?',
  },
  all_is_lost: {
    title: 'All Is Lost',
    dramaticQuestion: 'What does the protagonist fear has been lost for good?',
  },
  climax: {
    title: 'Climax',
    dramaticQuestion: 'What final choice or confrontation resolves the core conflict?',
  },
  resolution: {
    title: 'Resolution',
    dramaticQuestion: 'What image proves the story has changed the world or the hero?',
  },
};

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function deriveFallbackTitle(input: StoryPlannerInput): string {
  const trimmedPremise = input.premise.trim();
  if (!trimmedPremise) {
    return 'Untitled Story';
  }

  return trimmedPremise.slice(0, 36);
}

function deriveChapterTitle(index: number): string {
  return `Chapter ${index + 1}`;
}

function deriveSceneTitle(chapterIndex: number, sceneIndex: number): string {
  return `Scene ${chapterIndex + 1}.${sceneIndex + 1}`;
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
  } catch (error) {
    console.error('[StoryPlanner] Failed to parse JSON payload', error);
    return null;
  }
}

function normalizeScene(scene: unknown, chapterIndex: number, sceneIndex: number): PlannedScene {
  const record = scene && typeof scene === 'object'
    ? scene as Record<string, unknown>
    : {};

  return {
    title: normalizeString(record.title, deriveSceneTitle(chapterIndex, sceneIndex)),
    summary: normalizeString(record.summary),
    purpose: normalizeString(record.purpose),
    povCharacter: normalizeString(record.povCharacter),
    goal: normalizeString(record.goal),
    conflict: normalizeString(record.conflict),
    turn: normalizeString(record.turn),
    emotionalShift: normalizeString(record.emotionalShift),
    visualHook: normalizeString(record.visualHook),
    subtext: normalizeString(record.subtext),
  };
}

function normalizeChapter(chapter: unknown, index: number): PlannedChapter {
  const record = chapter && typeof chapter === 'object'
    ? chapter as Record<string, unknown>
    : {};
  const scenes = Array.isArray(record.scenes) ? record.scenes : [];

  return {
    number: toFiniteNumber(record.number, index + 1),
    title: normalizeString(record.title, deriveChapterTitle(index)),
    summary: normalizeString(record.summary),
    chapterPurpose: normalizeString(record.chapterPurpose),
    chapterQuestion: normalizeString(record.chapterQuestion),
    scenes: scenes.length > 0
      ? scenes
        .slice(0, 4)
        .map((scene, sceneIndex) => normalizeScene(scene, index, sceneIndex))
      : [normalizeScene({}, index, 0)],
  };
}

function normalizeBeat(beat: unknown, index: number): PlannedBeat {
  const record = beat && typeof beat === 'object'
    ? beat as Record<string, unknown>
    : {};
  const fallbackKey = STORY_BEAT_KEYS[index] ?? STORY_BEAT_KEYS[STORY_BEAT_KEYS.length - 1];
  const rawKey = normalizeString(record.key, fallbackKey) as StoryBeatKey;
  const key = STORY_BEAT_KEYS.includes(rawKey) ? rawKey : fallbackKey;
  const fallbackCopy = FALLBACK_BEAT_COPY[key];

  return {
    key,
    title: normalizeString(record.title, fallbackCopy.title),
    summary: normalizeString(record.summary),
    dramaticQuestion: normalizeString(record.dramaticQuestion, fallbackCopy.dramaticQuestion),
  };
}

function buildFallbackChapterSummary(index: number, chapterCount: number): string {
  if (index === 0) {
    return 'Establish the story world, emotional pressure, and the first sign of trouble.';
  }

  if (index === chapterCount - 1) {
    return 'Drive the protagonist into the final confrontation and show the cost of the ending.';
  }

  return 'Escalate the conflict, complicate choices, and push the protagonist into a harder decision.';
}

function buildFallbackPlan(input: StoryPlannerInput): StoryPlan {
  const chapters = Array.from({ length: input.chapterCount }, (_, index) => ({
    number: index + 1,
    title: deriveChapterTitle(index),
    summary: buildFallbackChapterSummary(index, input.chapterCount),
    chapterPurpose: index === 0
      ? 'Set the dramatic engine in motion.'
      : 'Escalate the main dramatic line.',
    chapterQuestion: index === input.chapterCount - 1
      ? 'What must the protagonist risk to finish the story?'
      : 'What pressure will force the next move?',
    scenes: [
      normalizeScene({
        title: deriveSceneTitle(index, 0),
        summary: 'Show the current situation through action instead of exposition.',
        purpose: 'Establish character pressure and point of view.',
        povCharacter: input.protagonist,
        goal: input.want,
        conflict: input.stakes,
        turn: 'The situation becomes harder than expected.',
        emotionalShift: 'From control to unease.',
        visualHook: 'A concrete visual moment that captures the chapter mood.',
        subtext: 'What the character avoids saying matters as much as the dialogue.',
      }, index, 0),
      normalizeScene({
        title: deriveSceneTitle(index, 1),
        summary: 'Create a decision, collision, or reveal that changes the chapter direction.',
        purpose: 'Increase dramatic pressure.',
        povCharacter: input.protagonist,
        goal: input.want,
        conflict: 'A stronger opposing force pushes back.',
        turn: 'The protagonist must adapt their approach.',
        emotionalShift: 'From uncertainty to commitment.',
        visualHook: 'A staging beat that a director could clearly frame.',
        subtext: 'The scene should imply a deeper fear or desire beneath the surface.',
      }, index, 1),
    ],
  }));

  return {
    title: deriveFallbackTitle(input),
    genre: input.genre || 'Drama',
    premise: input.premise,
    theme: input.theme,
    protagonist: input.protagonist,
    want: input.want,
    need: '',
    stakes: input.stakes,
    tone: input.tone,
    directorVision: input.directorVision,
    beats: STORY_BEAT_KEYS.map((key) => normalizeBeat({ key }, STORY_BEAT_KEYS.indexOf(key))),
    chapters,
    worldview: input.worldviewDescription
      ? {
          name: 'Worldview',
          description: input.worldviewDescription,
          era: '',
          technology: '',
          magic: '',
          society: '',
          geography: '',
        }
      : undefined,
  };
}

function normalizePlan(payload: Record<string, unknown>, input: StoryPlannerInput): StoryPlan {
  const beats = Array.isArray(payload.beats)
    ? payload.beats.map((beat, index) => normalizeBeat(beat, index)).slice(0, STORY_BEAT_KEYS.length)
    : [];

  while (beats.length < STORY_BEAT_KEYS.length) {
    beats.push(normalizeBeat({}, beats.length));
  }

  const rawChapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const chapters = rawChapters
    .slice(0, input.chapterCount)
    .map((chapter, index) => normalizeChapter(chapter, index));

  while (chapters.length < input.chapterCount) {
    chapters.push(normalizeChapter({}, chapters.length));
  }

  const rawWorldview = payload.worldview && typeof payload.worldview === 'object'
    ? payload.worldview as Record<string, unknown>
    : null;

  return {
    title: normalizeString(payload.title, deriveFallbackTitle(input)),
    genre: normalizeString(payload.genre, input.genre || 'Drama'),
    premise: normalizeString(payload.premise, input.premise),
    theme: normalizeString(payload.theme, input.theme),
    protagonist: normalizeString(payload.protagonist, input.protagonist),
    want: normalizeString(payload.want, input.want),
    need: normalizeString(payload.need),
    stakes: normalizeString(payload.stakes, input.stakes),
    tone: normalizeString(payload.tone, input.tone),
    directorVision: normalizeString(payload.directorVision, input.directorVision),
    beats,
    chapters,
    worldview: rawWorldview
      ? {
          name: normalizeString(rawWorldview.name, 'Worldview'),
          description: normalizeString(rawWorldview.description, input.worldviewDescription),
          era: normalizeString(rawWorldview.era),
          technology: normalizeString(rawWorldview.technology),
          magic: normalizeString(rawWorldview.magic),
          society: normalizeString(rawWorldview.society),
          geography: normalizeString(rawWorldview.geography),
        }
      : undefined,
  };
}

function buildPrompt(input: StoryPlannerInput): string {
  return [
    'You are a story planner who thinks like both a screenwriter and a director.',
    'Return a strong story skeleton that is easy to continue writing scene by scene.',
    'If the user wrote the premise in Chinese, answer in Chinese. Otherwise answer in the dominant language of the input.',
    'Return JSON only. Do not include markdown or commentary.',
    '',
    'User input:',
    `- Premise: ${input.premise}`,
    `- Protagonist: ${input.protagonist || 'Not specified'}`,
    `- External goal: ${input.want || 'Not specified'}`,
    `- Stakes: ${input.stakes || 'Not specified'}`,
    `- Genre: ${input.genre || 'Not specified'}`,
    `- Theme: ${input.theme || 'Not specified'}`,
    `- Tone: ${input.tone || 'Not specified'}`,
    `- Director lens: ${input.directorVision || 'Not specified'}`,
    `- World / setting: ${input.worldviewDescription || 'Not specified'}`,
    `- Chapter count: ${input.chapterCount}`,
    '',
    'Output requirements:',
    `1. Return exactly ${input.chapterCount} chapters.`,
    '2. Each chapter must contain 2 to 4 scenes.',
    '3. Each scene should emphasize action, conflict, a turn, and a visual hook.',
    '4. Build in some directorial thinking so the story is easy to expand into storyboard beats later.',
    '5. Keep chapter titles and scene titles concise.',
    '',
    'JSON shape:',
    '{',
    '  "title": "Story title",',
    '  "genre": "Genre",',
    '  "premise": "One-sentence premise",',
    '  "theme": "Theme",',
    '  "protagonist": "Protagonist",',
    '  "want": "External goal",',
    '  "need": "Inner need",',
    '  "stakes": "Stakes",',
    '  "tone": "Overall tone",',
    '  "directorVision": "One-sentence director lens",',
    '  "beats": [',
    '    { "key": "opening", "title": "Opening Image", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "inciting", "title": "Inciting Incident", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "lock_in", "title": "Lock In", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "first_setback", "title": "First Setback", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "midpoint", "title": "Midpoint Shift", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "all_is_lost", "title": "All Is Lost", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "climax", "title": "Climax", "summary": "...", "dramaticQuestion": "..." },',
    '    { "key": "resolution", "title": "Resolution", "summary": "...", "dramaticQuestion": "..." }',
    '  ],',
    '  "chapters": [',
    '    {',
    '      "number": 1,',
    '      "title": "Chapter title",',
    '      "summary": "Chapter summary",',
    '      "chapterPurpose": "Narrative purpose",',
    '      "chapterQuestion": "Audience question at the end of the chapter",',
    '      "scenes": [',
    '        {',
    '          "title": "Scene title",',
    '          "summary": "Scene summary",',
    '          "purpose": "Why this scene exists",',
    '          "povCharacter": "POV character",',
    '          "goal": "What someone wants",',
    '          "conflict": "What blocks them",',
    '          "turn": "What changes by the end",',
    '          "emotionalShift": "Emotional movement",',
    '          "visualHook": "A directable image or action",',
    '          "subtext": "What is meant but not fully said"',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "worldview": {',
    '    "name": "Worldview name",',
    '    "description": "Core setting summary",',
    '    "era": "Era",',
    '    "technology": "Technology level",',
    '    "magic": "Supernatural rules",',
    '    "society": "Social structure",',
    '    "geography": "Geographic flavor"',
    '  }',
    '}',
  ].join('\n');
}

export async function planStory(input: StoryPlannerInput): Promise<StoryPlan> {
  try {
    const result = await generateText({
      prompt: buildPrompt(input),
      temperature: 0.7,
      maxTokens: 8192,
    });

    const parsed = parseJsonObject(result.text);
    if (!parsed) {
      return buildFallbackPlan(input);
    }

    return normalizePlan(parsed, input);
  } catch (error) {
    console.error('[StoryPlanner] Failed to plan story', error);
    return buildFallbackPlan(input);
  }
}
