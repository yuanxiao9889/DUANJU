import {
  generateSceneEpisodes,
  type GeneratedSceneEpisode,
} from '@/commands/textGen';
import {
  createDefaultEpisodeCard,
  type EpisodeCard,
  type ScriptChapterNodeData,
  type ScriptSceneNodeData,
  type ScriptStoryNotePromptEntry,
} from '@/features/canvas/domain/canvasNodes';

interface GenerateEpisodesFromSceneOptions {
  episodeCount?: number;
  sourceDraftLabel?: string;
  storyNotes?: ScriptStoryNotePromptEntry[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export function htmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return (document.body.innerText || document.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildEpisodeSectionHtml(title: string, content: string): string {
  const body = plainTextToHtml(content) || '<p></p>';
  return `<h3>${escapeHtml(title)}</h3>${body}`;
}

export function buildEpisodeTemplateHtml(sections?: {
  plot?: string;
  coreConflict?: string;
  emotionProgression?: string;
  endingHook?: string;
}): string {
  return [
    buildEpisodeSectionHtml('本集剧情', sections?.plot ?? ''),
    buildEpisodeSectionHtml('核心冲突', sections?.coreConflict ?? ''),
    buildEpisodeSectionHtml('情绪推进', sections?.emotionProgression ?? ''),
    buildEpisodeSectionHtml('结尾钩子', sections?.endingHook ?? ''),
  ].join('');
}

export function createManualEpisodeCard(order: number): EpisodeCard {
  const baseEpisode = createDefaultEpisodeCard(order);
  return {
    ...baseEpisode,
    draftHtml: buildEpisodeTemplateHtml(),
    status: 'idea',
  };
}

function mapGeneratedEpisodeToCard(
  episode: GeneratedSceneEpisode,
  order: number,
  fallbackScene: ScriptSceneNodeData,
  sourceDraftLabel: string
): EpisodeCard {
  const baseEpisode = createDefaultEpisodeCard(order);
  const draftHtml = buildEpisodeTemplateHtml({
    plot: episode.plot || episode.summary,
    coreConflict: episode.coreConflict || episode.conflict,
    emotionProgression: episode.emotionProgression || episode.emotionalShift,
    endingHook: episode.endingHook,
  });

  return {
    ...baseEpisode,
    title: episode.title || baseEpisode.title,
    summary: episode.summary || '',
    purpose: episode.purpose || fallbackScene.purpose,
    povCharacter: episode.povCharacter || fallbackScene.povCharacter,
    goal: episode.goal || fallbackScene.goal,
    conflict: episode.conflict || fallbackScene.conflict,
    turn: episode.turn || fallbackScene.turn,
    emotionalShift: episode.emotionalShift || fallbackScene.emotionalShift,
    visualHook: episode.visualHook || fallbackScene.visualHook,
    subtext: episode.subtext || fallbackScene.subtext,
    draftHtml,
    sourceDraftHtml: draftHtml,
    sourceDraftLabel,
    status: draftHtml.trim() ? 'drafting' : 'idea',
  };
}

export async function generateEpisodesFromSceneNode(
  sceneNode: ScriptSceneNodeData,
  chapterData: ScriptChapterNodeData,
  options: GenerateEpisodesFromSceneOptions = {}
): Promise<EpisodeCard[]> {
  const sourceDraft = htmlToPlainText(sceneNode.draftHtml || sceneNode.sourceDraftHtml || '');
  const generatedEpisodes = await generateSceneEpisodes({
    chapterNumber: chapterData.chapterNumber || sceneNode.chapterNumber,
    chapterTitle: chapterData.title || chapterData.displayName || '',
    chapterSummary: chapterData.summary,
    storyNotes: options.storyNotes,
    sceneTitle: sceneNode.title,
    sceneSummary: sceneNode.summary,
    purpose: sceneNode.purpose,
    povCharacter: sceneNode.povCharacter,
    goal: sceneNode.goal,
    conflict: sceneNode.conflict,
    turn: sceneNode.turn,
    emotionalShift: sceneNode.emotionalShift,
    visualHook: sceneNode.visualHook,
    subtext: sceneNode.subtext,
    sceneDraft: sourceDraft,
    episodeCount: options.episodeCount,
  });

  const sourceDraftLabel = options.sourceDraftLabel ?? 'LLM 分集初稿';
  return generatedEpisodes.map((episode, index) => (
    mapGeneratedEpisodeToCard(episode, index, sceneNode, sourceDraftLabel)
  ));
}
