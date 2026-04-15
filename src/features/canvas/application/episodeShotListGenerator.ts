import {
  generateEpisodeShotList,
  type EpisodeShotListGenerationRequest,
  type EpisodeShotListSeedRow,
  type GeneratedEpisodeShotRow,
} from '@/commands/textGen';
import {
  createDefaultShotRow,
  type EpisodeCard,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
  type ShotRow,
} from '@/features/canvas/domain/canvasNodes';
import { htmlToPlainText } from './sceneEpisodeGenerator';

interface EpisodeShotListContext {
  storyRoot: ScriptRootNodeData | null;
  chapter: ScriptChapterNodeData;
  sceneNode: ScriptSceneNodeData;
  episode: EpisodeCard;
  shotCount?: number;
}

interface RegenerateEpisodeShotRowContext extends EpisodeShotListContext {
  rowId: string;
}

function toShotRowSeed(row: ShotRow): EpisodeShotListSeedRow {
  return {
    shotNumber: row.shotNumber,
    beat: row.beat,
    action: row.action,
    dialogueCue: row.dialogueCue,
    shotSize: row.shotSize,
    framingAngle: row.framingAngle,
    cameraMove: row.cameraMove,
    blocking: row.blocking,
    rhythmDuration: row.rhythmDuration,
    audioCue: row.audioCue,
    artLighting: row.artLighting,
    continuityNote: row.continuityNote,
    genTarget: row.genTarget,
    genPrompt: row.genPrompt,
    status: row.status,
  };
}

function buildGenerationRequest(
  context: EpisodeShotListContext,
  extra: Partial<EpisodeShotListGenerationRequest> = {}
): EpisodeShotListGenerationRequest {
  const { storyRoot, chapter, sceneNode, episode, shotCount } = context;

  return {
    directorVision: storyRoot?.directorVision,
    chapterNumber: chapter.chapterNumber || sceneNode.chapterNumber,
    chapterTitle: chapter.title || chapter.displayName || '',
    chapterSummary: chapter.summary,
    sceneTitle: sceneNode.title,
    sceneSummary: sceneNode.summary,
    scenePurpose: sceneNode.purpose,
    scenePovCharacter: sceneNode.povCharacter,
    sceneGoal: sceneNode.goal,
    sceneConflict: sceneNode.conflict,
    sceneTurn: sceneNode.turn,
    sceneVisualHook: sceneNode.visualHook,
    sceneSubtext: sceneNode.subtext,
    sceneDraft: htmlToPlainText(sceneNode.draftHtml || sceneNode.sourceDraftHtml || ''),
    episodeNumber: episode.episodeNumber,
    episodeTitle: episode.title || `Episode ${episode.episodeNumber}`,
    episodeSummary: episode.summary,
    episodePurpose: episode.purpose,
    episodeDraft: htmlToPlainText(episode.draftHtml || episode.sourceDraftHtml || ''),
    episodeDirectorNotes: episode.directorNotes,
    continuitySummary: episode.continuitySummary,
    continuityFacts: episode.continuityFacts,
    continuityOpenLoops: episode.continuityOpenLoops,
    shotCount,
    ...extra,
  };
}

function mapGeneratedRowToShotRow(
  generatedRow: GeneratedEpisodeShotRow,
  order: number,
  existingRow?: ShotRow
): ShotRow {
  const fallback = existingRow ?? createDefaultShotRow(order);

  return {
    ...fallback,
    shotNumber: generatedRow.shotNumber || fallback.shotNumber,
    beat: generatedRow.beat,
    action: generatedRow.action,
    dialogueCue: generatedRow.dialogueCue,
    shotSize: generatedRow.shotSize,
    framingAngle: generatedRow.framingAngle,
    cameraMove: generatedRow.cameraMove,
    blocking: generatedRow.blocking,
    rhythmDuration: generatedRow.rhythmDuration,
    audioCue: generatedRow.audioCue,
    artLighting: generatedRow.artLighting,
    continuityNote: generatedRow.continuityNote,
    genTarget: generatedRow.genTarget,
    genPrompt: generatedRow.genPrompt,
    status: generatedRow.status,
  };
}

export function reindexShotRows(rows: ShotRow[]): ShotRow[] {
  return rows.map((row, index) => ({
    ...row,
    shotNumber: String(index + 1),
  }));
}

export function createManualShotRow(order: number): ShotRow {
  return createDefaultShotRow(order);
}

export async function generateEpisodeShotRows(
  context: EpisodeShotListContext
): Promise<ShotRow[]> {
  const generatedRows = await generateEpisodeShotList(buildGenerationRequest(context));

  return reindexShotRows(
    generatedRows.map((row, index) => mapGeneratedRowToShotRow(row, index))
  );
}

export async function regenerateEpisodeShotRow(
  context: RegenerateEpisodeShotRowContext
): Promise<ShotRow> {
  const targetIndex = context.episode.shotRows.findIndex((row) => row.id === context.rowId);
  if (targetIndex < 0) {
    throw new Error('Target shot row was not found.');
  }

  const existingRows = context.episode.shotRows.map((row) => toShotRowSeed(row));
  const generatedRows = await generateEpisodeShotList(buildGenerationRequest(context, {
    existingRows,
    regenerateRowIndex: targetIndex,
  }));
  const generatedRow = generatedRows[0];
  if (!generatedRow) {
    throw new Error('Failed to regenerate the target shot row.');
  }

  const currentRow = context.episode.shotRows[targetIndex];
  return {
    ...mapGeneratedRowToShotRow(generatedRow, targetIndex, currentRow),
    id: currentRow.id,
    shotNumber: currentRow.shotNumber,
  };
}
