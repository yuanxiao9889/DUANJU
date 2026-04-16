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

type StoryPlannerLocale = 'zh' | 'en';

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

const CHINESE_TEXT_PATTERN = /[\u3400-\u9fff]/;
const ENGLISH_CHAPTER_TITLE_PATTERN = /^chapter\s+\d+/i;
const ENGLISH_SCENE_TITLE_PATTERN = /^scene\s+\d+(?:\.\d+)?/i;

const STORY_PLANNER_COPY: Record<StoryPlannerLocale, {
  untitledStory: string;
  genreFallback: string;
  worldviewName: string;
  notSpecified: string;
  languageInstruction: string;
  chapterTitle: (index: number) => string;
  sceneTitle: (chapterIndex: number, sceneIndex: number) => string;
  beatCopy: Record<StoryBeatKey, { title: string; dramaticQuestion: string }>;
  fallbackChapterSummary: {
    first: string;
    middle: string;
    last: string;
  };
  chapterPurpose: {
    first: string;
    other: string;
  };
  chapterQuestion: {
    middle: string;
    last: string;
  };
  fallbackSceneDrafts: Array<{
    summary: string;
    purpose: string;
    conflict: string;
    turn: string;
    emotionalShift: string;
    visualHook: string;
    subtext: string;
  }>;
}> = {
  en: {
    untitledStory: 'Untitled Story',
    genreFallback: 'Drama',
    worldviewName: 'Worldview',
    notSpecified: 'Not specified',
    languageInstruction: 'All human-readable JSON fields must be written in English.',
    chapterTitle: (index) => `Chapter ${index + 1}`,
    sceneTitle: (chapterIndex, sceneIndex) => `Scene ${chapterIndex + 1}.${sceneIndex + 1}`,
    beatCopy: {
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
    },
    fallbackChapterSummary: {
      first: 'Establish the story world, emotional pressure, and the first sign of trouble.',
      middle: 'Escalate the conflict, complicate choices, and push the protagonist into a harder decision.',
      last: 'Drive the protagonist into the final confrontation and show the cost of the ending.',
    },
    chapterPurpose: {
      first: 'Set the dramatic engine in motion.',
      other: 'Escalate the main dramatic line.',
    },
    chapterQuestion: {
      middle: 'What pressure will force the next move?',
      last: 'What must the protagonist risk to finish the story?',
    },
    fallbackSceneDrafts: [
      {
        summary: 'Show the current situation through action instead of exposition.',
        purpose: 'Establish character pressure and point of view.',
        conflict: 'Pressure from the current situation creates immediate resistance.',
        turn: 'The situation becomes harder than expected.',
        emotionalShift: 'From control to unease.',
        visualHook: 'A concrete visual moment that captures the chapter mood.',
        subtext: 'What the character avoids saying matters as much as the dialogue.',
      },
      {
        summary: 'Create a decision, collision, or reveal that changes the chapter direction.',
        purpose: 'Increase dramatic pressure.',
        conflict: 'A stronger opposing force pushes back.',
        turn: 'The protagonist must adapt their approach.',
        emotionalShift: 'From uncertainty to commitment.',
        visualHook: 'A staging beat that a director could clearly frame.',
        subtext: 'The scene should imply a deeper fear or desire beneath the surface.',
      },
    ],
  },
  zh: {
    untitledStory: '未命名故事',
    genreFallback: '剧情',
    worldviewName: '世界观',
    notSpecified: '未提供',
    languageInstruction: '所有面向读者的 JSON 字段必须使用简体中文，包括节拍标题、章节标题、场景标题、摘要和世界观字段。不要输出英文标题，例如 Opening Image、Lock In、Climax、Chapter 1、Scene 1.1。',
    chapterTitle: (index) => `第${index + 1}章`,
    sceneTitle: (chapterIndex, sceneIndex) => `场景 ${chapterIndex + 1}.${sceneIndex + 1}`,
    beatCopy: {
      opening: {
        title: '开场意象',
        dramaticQuestion: '故事一开始要给观众什么情绪基调或核心承诺？',
      },
      inciting: {
        title: '诱发事件',
        dramaticQuestion: '是什么事件迫使故事真正启动？',
      },
      lock_in: {
        title: '进入主线',
        dramaticQuestion: '主角为什么已经不能再维持原样？',
      },
      first_setback: {
        title: '首次受挫',
        dramaticQuestion: '什么阻力证明这段旅程注定要付出代价？',
      },
      midpoint: {
        title: '中点转折',
        dramaticQuestion: '什么发现或反转改变了故事方向？',
      },
      all_is_lost: {
        title: '至暗时刻',
        dramaticQuestion: '主角最害怕失去的东西是否真的已经无可挽回？',
      },
      climax: {
        title: '高潮对决',
        dramaticQuestion: '最后的选择或对抗将如何解决核心冲突？',
      },
      resolution: {
        title: '结局余波',
        dramaticQuestion: '什么结尾画面能证明主角或世界已经改变？',
      },
    },
    fallbackChapterSummary: {
      first: '建立故事世界、人物压力，以及第一道危险信号。',
      middle: '升级冲突、加重代价，并逼迫主角做出更艰难的决定。',
      last: '把主角推入最终对抗，并显出结局真正的代价。',
    },
    chapterPurpose: {
      first: '启动故事引擎，让主线真正运转起来。',
      other: '升级主线矛盾，逼迫角色继续推进。',
    },
    chapterQuestion: {
      middle: '下一步会有什么压力迫使主角继续向前？',
      last: '主角究竟要付出什么，才能真正完成这段故事？',
    },
    fallbackSceneDrafts: [
      {
        summary: '用行动而不是解释，展示角色当下的处境。',
        purpose: '建立角色压力、关系和当前视角。',
        conflict: '现实处境立刻制造阻力和不安。',
        turn: '局势比角色预期中更难控制。',
        emotionalShift: '从自信转向不安。',
        visualHook: '一个能直接被镜头捕捉的强烈画面或动作。',
        subtext: '角色没有说出口的真实顾虑，和台词本身一样重要。',
      },
      {
        summary: '制造一个决定、碰撞或揭示，改变章节走向。',
        purpose: '进一步提高戏剧压力。',
        conflict: '更强的对立力量开始反击。',
        turn: '主角不得不调整原来的应对方式。',
        emotionalShift: '从犹疑转向被迫投入。',
        visualHook: '一个导演可以明确调度和构图的场面点。',
        subtext: '表面行动下，角色更深层的恐惧或欲望被隐约暴露。',
      },
    ],
  },
};

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function detectPlannerLocale(input: StoryPlannerInput): StoryPlannerLocale {
  const values = [
    input.premise,
    input.protagonist,
    input.want,
    input.stakes,
    input.genre,
    input.theme,
    input.tone,
    input.directorVision,
    input.worldviewDescription,
  ];

  return values.some((value) => CHINESE_TEXT_PATTERN.test(value))
    ? 'zh'
    : 'en';
}

function deriveFallbackTitle(input: StoryPlannerInput, locale: StoryPlannerLocale): string {
  const trimmedPremise = input.premise.trim();
  if (!trimmedPremise) {
    return STORY_PLANNER_COPY[locale].untitledStory;
  }

  return trimmedPremise.slice(0, 36);
}

function deriveChapterTitle(index: number, locale: StoryPlannerLocale): string {
  return STORY_PLANNER_COPY[locale].chapterTitle(index);
}

function deriveSceneTitle(
  chapterIndex: number,
  sceneIndex: number,
  locale: StoryPlannerLocale
): string {
  return STORY_PLANNER_COPY[locale].sceneTitle(chapterIndex, sceneIndex);
}

function shouldReplaceLocalizedPlaceholder(
  value: string,
  locale: StoryPlannerLocale,
  englishPattern: RegExp,
  englishFallback: string
): boolean {
  if (locale !== 'zh') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return englishPattern.test(normalized) || normalized === englishFallback;
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

function normalizeScene(
  scene: unknown,
  chapterIndex: number,
  sceneIndex: number,
  locale: StoryPlannerLocale
): PlannedScene {
  const record = scene && typeof scene === 'object'
    ? scene as Record<string, unknown>
    : {};
  const sceneTitleFallback = deriveSceneTitle(chapterIndex, sceneIndex, locale);
  const rawTitle = normalizeString(record.title);

  return {
    title: shouldReplaceLocalizedPlaceholder(
      rawTitle,
      locale,
      ENGLISH_SCENE_TITLE_PATTERN,
      STORY_PLANNER_COPY.en.sceneTitle(chapterIndex, sceneIndex)
    )
      ? sceneTitleFallback
      : normalizeString(record.title, sceneTitleFallback),
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

function normalizeChapter(
  chapter: unknown,
  index: number,
  locale: StoryPlannerLocale
): PlannedChapter {
  const record = chapter && typeof chapter === 'object'
    ? chapter as Record<string, unknown>
    : {};
  const scenes = Array.isArray(record.scenes) ? record.scenes : [];
  const chapterTitleFallback = deriveChapterTitle(index, locale);
  const rawTitle = normalizeString(record.title);

  return {
    number: toFiniteNumber(record.number, index + 1),
    title: shouldReplaceLocalizedPlaceholder(
      rawTitle,
      locale,
      ENGLISH_CHAPTER_TITLE_PATTERN,
      STORY_PLANNER_COPY.en.chapterTitle(index)
    )
      ? chapterTitleFallback
      : normalizeString(record.title, chapterTitleFallback),
    summary: normalizeString(record.summary),
    chapterPurpose: normalizeString(record.chapterPurpose),
    chapterQuestion: normalizeString(record.chapterQuestion),
    scenes: scenes.length > 0
      ? scenes
        .slice(0, 4)
        .map((scene, sceneIndex) => normalizeScene(scene, index, sceneIndex, locale))
      : [normalizeScene({}, index, 0, locale)],
  };
}

function normalizeBeat(
  beat: unknown,
  index: number,
  locale: StoryPlannerLocale
): PlannedBeat {
  const record = beat && typeof beat === 'object'
    ? beat as Record<string, unknown>
    : {};
  const fallbackKey = STORY_BEAT_KEYS[index] ?? STORY_BEAT_KEYS[STORY_BEAT_KEYS.length - 1];
  const rawKey = normalizeString(record.key, fallbackKey) as StoryBeatKey;
  const key = STORY_BEAT_KEYS.includes(rawKey) ? rawKey : fallbackKey;
  const fallbackCopy = STORY_PLANNER_COPY[locale].beatCopy[key];
  const rawTitle = normalizeString(record.title);
  const englishFallbackTitle = STORY_PLANNER_COPY.en.beatCopy[key].title;

  return {
    key,
    title: rawTitle && locale === 'zh' && rawTitle === englishFallbackTitle
      ? fallbackCopy.title
      : normalizeString(record.title, fallbackCopy.title),
    summary: normalizeString(record.summary),
    dramaticQuestion: normalizeString(record.dramaticQuestion, fallbackCopy.dramaticQuestion),
  };
}

function buildFallbackChapterSummary(
  index: number,
  chapterCount: number,
  locale: StoryPlannerLocale
): string {
  const copy = STORY_PLANNER_COPY[locale].fallbackChapterSummary;
  if (index === 0) {
    return copy.first;
  }

  if (index === chapterCount - 1) {
    return copy.last;
  }

  return copy.middle;
}

function buildFallbackPlan(input: StoryPlannerInput, locale: StoryPlannerLocale): StoryPlan {
  const copy = STORY_PLANNER_COPY[locale];
  const chapters = Array.from({ length: input.chapterCount }, (_, index) => ({
    number: index + 1,
    title: deriveChapterTitle(index, locale),
    summary: buildFallbackChapterSummary(index, input.chapterCount, locale),
    chapterPurpose: index === 0
      ? copy.chapterPurpose.first
      : copy.chapterPurpose.other,
    chapterQuestion: index === input.chapterCount - 1
      ? copy.chapterQuestion.last
      : copy.chapterQuestion.middle,
    scenes: [
      normalizeScene({
        title: deriveSceneTitle(index, 0, locale),
        summary: copy.fallbackSceneDrafts[0].summary,
        purpose: copy.fallbackSceneDrafts[0].purpose,
        povCharacter: input.protagonist,
        goal: input.want,
        conflict: input.stakes,
        turn: copy.fallbackSceneDrafts[0].turn,
        emotionalShift: copy.fallbackSceneDrafts[0].emotionalShift,
        visualHook: copy.fallbackSceneDrafts[0].visualHook,
        subtext: copy.fallbackSceneDrafts[0].subtext,
      }, index, 0, locale),
      normalizeScene({
        title: deriveSceneTitle(index, 1, locale),
        summary: copy.fallbackSceneDrafts[1].summary,
        purpose: copy.fallbackSceneDrafts[1].purpose,
        povCharacter: input.protagonist,
        goal: input.want,
        conflict: copy.fallbackSceneDrafts[1].conflict,
        turn: copy.fallbackSceneDrafts[1].turn,
        emotionalShift: copy.fallbackSceneDrafts[1].emotionalShift,
        visualHook: copy.fallbackSceneDrafts[1].visualHook,
        subtext: copy.fallbackSceneDrafts[1].subtext,
      }, index, 1, locale),
    ],
  }));

  return {
    title: deriveFallbackTitle(input, locale),
    genre: input.genre || copy.genreFallback,
    premise: input.premise,
    theme: input.theme,
    protagonist: input.protagonist,
    want: input.want,
    need: '',
    stakes: input.stakes,
    tone: input.tone,
    directorVision: input.directorVision,
    beats: STORY_BEAT_KEYS.map((key) => normalizeBeat({ key }, STORY_BEAT_KEYS.indexOf(key), locale)),
    chapters,
    worldview: input.worldviewDescription
      ? {
          name: copy.worldviewName,
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

function normalizePlan(
  payload: Record<string, unknown>,
  input: StoryPlannerInput,
  locale: StoryPlannerLocale
): StoryPlan {
  const copy = STORY_PLANNER_COPY[locale];
  const beats = Array.isArray(payload.beats)
    ? payload.beats.map((beat, index) => normalizeBeat(beat, index, locale)).slice(0, STORY_BEAT_KEYS.length)
    : [];

  while (beats.length < STORY_BEAT_KEYS.length) {
    beats.push(normalizeBeat({}, beats.length, locale));
  }

  const rawChapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const chapters = rawChapters
    .slice(0, input.chapterCount)
    .map((chapter, index) => normalizeChapter(chapter, index, locale));

  while (chapters.length < input.chapterCount) {
    chapters.push(normalizeChapter({}, chapters.length, locale));
  }

  const rawWorldview = payload.worldview && typeof payload.worldview === 'object'
    ? payload.worldview as Record<string, unknown>
    : null;

  return {
    title: normalizeString(payload.title, deriveFallbackTitle(input, locale)),
    genre: normalizeString(
      payload.genre,
      input.genre || copy.genreFallback
    ),
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
          name: normalizeString(rawWorldview.name, copy.worldviewName),
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

function buildPrompt(input: StoryPlannerInput, locale: StoryPlannerLocale): string {
  const copy = STORY_PLANNER_COPY[locale];
  return [
    'You are a story planner who thinks like both a screenwriter and a director.',
    'Return a strong story skeleton that is easy to continue writing scene by scene.',
    copy.languageInstruction,
    'Return JSON only. Do not include markdown or commentary.',
    '',
    'User input:',
    `- Premise: ${input.premise}`,
    `- Protagonist: ${input.protagonist || copy.notSpecified}`,
    `- External goal: ${input.want || copy.notSpecified}`,
    `- Stakes: ${input.stakes || copy.notSpecified}`,
    `- Genre: ${input.genre || copy.notSpecified}`,
    `- Theme: ${input.theme || copy.notSpecified}`,
    `- Tone: ${input.tone || copy.notSpecified}`,
    `- Director lens: ${input.directorVision || copy.notSpecified}`,
    `- World / setting: ${input.worldviewDescription || copy.notSpecified}`,
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
    `    { "key": "opening", "title": "${copy.beatCopy.opening.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "inciting", "title": "${copy.beatCopy.inciting.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "lock_in", "title": "${copy.beatCopy.lock_in.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "first_setback", "title": "${copy.beatCopy.first_setback.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "midpoint", "title": "${copy.beatCopy.midpoint.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "all_is_lost", "title": "${copy.beatCopy.all_is_lost.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "climax", "title": "${copy.beatCopy.climax.title}", "summary": "...", "dramaticQuestion": "..." },`,
    `    { "key": "resolution", "title": "${copy.beatCopy.resolution.title}", "summary": "...", "dramaticQuestion": "..." }`,
    '  ],',
    '  "chapters": [',
    '    {',
    '      "number": 1,',
    `      "title": "${copy.chapterTitle(0)}",`,
    `      "summary": "${copy.fallbackChapterSummary.first}",`,
    `      "chapterPurpose": "${copy.chapterPurpose.first}",`,
    `      "chapterQuestion": "${copy.chapterQuestion.middle}",`,
    '      "scenes": [',
    '        {',
    `          "title": "${copy.sceneTitle(0, 0)}",`,
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
  const locale = detectPlannerLocale(input);

  try {
    const result = await generateText({
      prompt: buildPrompt(input, locale),
      temperature: 0.7,
      maxTokens: 8192,
    });

    const parsed = parseJsonObject(result.text);
    if (!parsed) {
      return buildFallbackPlan(input, locale);
    }

    return normalizePlan(parsed, input, locale);
  } catch (error) {
    console.error('[StoryPlanner] Failed to plan story', error);
    return buildFallbackPlan(input, locale);
  }
}
