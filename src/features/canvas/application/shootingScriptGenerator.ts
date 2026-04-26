import {
  generateEpisodeShotList,
  generateText,
  type EpisodeShotListGenerationRequest,
  type EpisodeShotListSeedRow,
  type GeneratedEpisodeShotRow,
} from '@/commands/textGen';
import {
  buildUserFacingLanguageInstruction,
  detectUserContentLanguage,
} from '@/features/app/contentLanguage';
import {
  createDefaultShootingScriptRow,
  formatShootingScriptShotNumber,
  normalizeShootingScriptNumberingContext,
  type EpisodeCard,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
  type ShootingScriptColumnKey,
  type ShootingScriptNumberingContext,
  type ShootingScriptRow,
  type ShootingScriptSourceSnapshot,
} from '@/features/canvas/domain/canvasNodes';
import { htmlToPlainText } from './sceneEpisodeGenerator';

interface ShootingScriptGenerationContext {
  storyRoot: ScriptRootNodeData | null;
  chapter: ScriptChapterNodeData;
  sceneNode: ScriptSceneNodeData;
  episode: EpisodeCard;
  shotCount?: number;
}

interface RegenerateShootingScriptRowContext extends ShootingScriptGenerationContext {
  rowId: string;
  rows: ShootingScriptRow[];
}

interface RewriteShootingScriptCellContext extends ShootingScriptGenerationContext {
  row: ShootingScriptRow;
  columnKey: ShootingScriptColumnKey;
  currentValue: string;
  instruction: string;
}

function toLegacySeedRow(row: ShootingScriptRow): EpisodeShotListSeedRow {
  return {
    shotNumber: row.shotNumber,
    beat: row.beat,
    action: row.action,
    dialogueCue: row.audio,
    shotSize: row.composition,
    framingAngle: '',
    cameraMove: row.camera,
    blocking: row.blocking,
    rhythmDuration: row.duration,
    audioCue: '',
    artLighting: row.artLighting,
    continuityNote: row.continuityNote,
    genTarget: row.genTarget,
    genPrompt: row.genPrompt,
    status: row.status,
  };
}

function buildGenerationRequest(
  context: ShootingScriptGenerationContext,
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
    episodeTitle: episode.title || `分集 ${episode.episodeNumber}`,
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

function mapGeneratedRow(
  row: GeneratedEpisodeShotRow,
  order: number,
  existingRow?: ShootingScriptRow
): ShootingScriptRow {
  const fallback = existingRow ?? createDefaultShootingScriptRow(order);

  return {
    ...fallback,
    shotNumber: row.shotNumber || fallback.shotNumber,
    beat: row.beat,
    action: row.action,
    composition: [row.shotSize, row.framingAngle].filter(Boolean).join(' / '),
    camera: row.cameraMove,
    duration: row.rhythmDuration,
    audio: [row.dialogueCue, row.audioCue].filter(Boolean).join(' / '),
    blocking: row.blocking,
    artLighting: row.artLighting,
    continuityNote: row.continuityNote,
    directorIntent: existingRow?.directorIntent ?? '',
    genTarget: row.genTarget,
    genPrompt: row.genPrompt,
    status: row.status,
  };
}

function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== null) {
    return direct;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    const fenced = tryParseJson(fenceMatch[1].trim());
    if (fenced !== null) {
      return fenced;
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeRewriteVariants(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { variants?: unknown[] }).variants)
      ? (value as { variants: unknown[] }).variants
      : [];

  return Array.from(
    new Set(
      rawValues
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    )
  ).slice(0, 3);
}

function resolveShootingScriptNumberingContext(
  context: Pick<ShootingScriptGenerationContext, 'chapter' | 'sceneNode' | 'episode'>
): ShootingScriptNumberingContext {
  return normalizeShootingScriptNumberingContext({
    chapterNumber: context.chapter.chapterNumber || context.sceneNode.chapterNumber,
    sceneNumber: context.sceneNode.sourceSceneOrder + 1,
    episodeNumber: context.episode.episodeNumber,
  });
}

export function reindexShootingScriptRows(
  rows: ShootingScriptRow[],
  context: Partial<ShootingScriptNumberingContext> | null | undefined
): ShootingScriptRow[] {
  return rows.map((row, index) => ({
    ...row,
    shotNumber: formatShootingScriptShotNumber(context, index),
  }));
}

export function createManualShootingScriptRow(
  order: number,
  context: Partial<ShootingScriptNumberingContext> | null | undefined
): ShootingScriptRow {
  return createDefaultShootingScriptRow(order, context);
}

export function buildShootingScriptSourceSnapshot(
  chapter: ScriptChapterNodeData | null,
  sceneNode: ScriptSceneNodeData,
  episode: EpisodeCard
): ShootingScriptSourceSnapshot {
  return {
    chapterTitle: chapter?.title || chapter?.displayName || '',
    sceneTitle: sceneNode.title,
    sceneSummary: sceneNode.summary,
    episodeTitle: episode.title,
    episodeSummary: episode.summary,
    episodeDraft: episode.draftHtml,
    episodeDirectorNotes: episode.directorNotes,
    continuitySummary: episode.continuitySummary,
    continuityFacts: episode.continuityFacts,
    continuityOpenLoops: episode.continuityOpenLoops,
  };
}

export async function generateShootingScriptRows(
  context: ShootingScriptGenerationContext
): Promise<ShootingScriptRow[]> {
  const generatedRows = await generateEpisodeShotList(buildGenerationRequest(context));
  const numberingContext = resolveShootingScriptNumberingContext(context);

  return reindexShootingScriptRows(
    generatedRows.map((row, index) => mapGeneratedRow(row, index)),
    numberingContext
  );
}

export async function regenerateShootingScriptRow(
  context: RegenerateShootingScriptRowContext
): Promise<ShootingScriptRow> {
  const targetIndex = context.rows.findIndex((row) => row.id === context.rowId);
  if (targetIndex < 0) {
    throw new Error('Target shooting script row was not found.');
  }

  const generatedRows = await generateEpisodeShotList(buildGenerationRequest(context, {
    existingRows: context.rows.map((row) => toLegacySeedRow(row)),
    regenerateRowIndex: targetIndex,
  }));
  const generatedRow = generatedRows[0];
  if (!generatedRow) {
    throw new Error('Failed to regenerate the target shooting script row.');
  }

  const currentRow = context.rows[targetIndex];
  const numberingContext = resolveShootingScriptNumberingContext(context);
  return {
    ...mapGeneratedRow(generatedRow, targetIndex, currentRow),
    id: currentRow.id,
    shotNumber: formatShootingScriptShotNumber(numberingContext, targetIndex),
  };
}

export async function rewriteShootingScriptCell(
  context: RewriteShootingScriptCellContext
): Promise<string[]> {
  const instruction = context.instruction.trim();
  if (!instruction) {
    return [];
  }

  const outputLanguage = detectUserContentLanguage([
    context.row,
    context.storyRoot?.directorVision,
    context.chapter.title,
    context.chapter.summary,
    context.sceneNode.title,
    context.sceneNode.summary,
    context.sceneNode.purpose,
    context.sceneNode.goal,
    context.sceneNode.conflict,
    context.sceneNode.turn,
    context.episode.title,
    context.episode.summary,
    context.episode.directorNotes,
    context.episode.continuitySummary,
    context.episode.continuityFacts,
    context.episode.continuityOpenLoops,
    instruction,
  ]);

  const prompt = [
    'You are a director-focused shooting script polish assistant.',
    'Only rewrite the target cell. Do not change the shot intent, blocking logic, continuity facts, or surrounding narrative function.',
    'Return strict JSON only. Do not use Markdown fences. Do not add commentary.',
    'JSON schema: {"variants":["version 1","version 2","version 3"]}',
    'Return 1-3 variants that can directly replace the current cell.',
    buildUserFacingLanguageInstruction(outputLanguage, 'json-values'),
    '',
    `Target column: ${context.columnKey}`,
    `User instruction: ${instruction}`,
    `Current value: ${context.currentValue.trim() || '(empty)'}`,
    '',
    'Current shot row context:',
    JSON.stringify({
      shotNumber: context.row.shotNumber,
      beat: context.row.beat,
      action: context.row.action,
      composition: context.row.composition,
      camera: context.row.camera,
      duration: context.row.duration,
      audio: context.row.audio,
      blocking: context.row.blocking,
      artLighting: context.row.artLighting,
      continuityNote: context.row.continuityNote,
      directorIntent: context.row.directorIntent,
      genTarget: context.row.genTarget,
      genPrompt: context.row.genPrompt,
    }, null, 2),
    '',
    'Upstream script context:',
    JSON.stringify({
      directorVision: context.storyRoot?.directorVision || '',
      chapterTitle: context.chapter.title || context.chapter.displayName || '',
      sceneTitle: context.sceneNode.title,
      sceneSummary: context.sceneNode.summary,
      episodeTitle: context.episode.title,
      episodeSummary: context.episode.summary,
      episodeDirectorNotes: context.episode.directorNotes,
      continuitySummary: context.episode.continuitySummary,
      continuityFacts: context.episode.continuityFacts,
      continuityOpenLoops: context.episode.continuityOpenLoops,
    }, null, 2),
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.55,
    maxTokens: 1200,
  });

  const parsed = parseJsonValue(result.text);
  const variants = normalizeRewriteVariants(parsed);
  if (variants.length === 0) {
    throw new Error('LLM did not return valid rewrite variants.');
  }

  return variants;
}
