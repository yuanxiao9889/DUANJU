import type { ProjectRecord } from '@/commands/projectState';
import {
  CANVAS_NODE_TYPES,
  normalizeScriptChapterNodeData,
  normalizeScriptSceneNodeData,
  normalizeShootingScriptNodeData,
  normalizeShootingScriptRows,
  type CanvasNode,
  type EpisodeCard,
  type ScriptChapterNodeData,
  type ScriptReferenceScriptSnapshot,
  type ScriptReferenceShotRowSnapshot,
  type ScriptSceneNodeData,
  type ShootingScriptNodeData,
  type ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';

interface PersistedNodesPayload {
  nodes?: CanvasNode[];
}

export interface LinkedScriptEpisodeReference {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  sourceSceneId: string;
  sceneNodeId: string;
  sceneTitle: string;
  sceneOrder: number;
  episode: EpisodeCard;
  scriptNodeId: string | null;
  rows: ShootingScriptRow[];
}

export interface LinkedScriptSceneReference {
  sourceSceneId: string;
  sceneNodeId: string;
  sceneTitle: string;
  sceneOrder: number;
  episodes: LinkedScriptEpisodeReference[];
}

export interface LinkedScriptChapterReference {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  scenes: LinkedScriptSceneReference[];
}

function parsePersistedNodesPayload(value: string): CanvasNode[] {
  try {
    const parsed = JSON.parse(value) as CanvasNode[] | PersistedNodesPayload;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  } catch {
    return [];
  }
}

function buildSourceKey(sceneNodeId: string, episodeId: string): string {
  return `${sceneNodeId}::${episodeId}`;
}

function buildScriptSceneSourceKey(sourceChapterId: string, sourceSceneId: string): string {
  return `${sourceChapterId}::${sourceSceneId}`;
}

function mapLegacyShotRows(rows: EpisodeCard['shotRows'] = []): ShootingScriptRow[] {
  return rows.map((row, index) => ({
    id: row.id,
    shotNumber: row.shotNumber || String(index + 1),
    beat: row.beat,
    action: row.action,
    composition: [row.shotSize, row.framingAngle].filter(Boolean).join(' / '),
    camera: row.cameraMove,
    duration: row.rhythmDuration,
    audio: [row.dialogueCue, row.audioCue].filter(Boolean).join(' / '),
    blocking: row.blocking,
    artLighting: row.artLighting,
    continuityNote: row.continuityNote,
    directorIntent: '',
    genTarget: row.genTarget,
    genPrompt: row.genPrompt,
    status: row.status,
  }));
}

function toShotRowSnapshot(row: ShootingScriptRow): ScriptReferenceShotRowSnapshot {
  return {
    id: row.id,
    shotNumber: row.shotNumber,
    beat: row.beat,
    genTarget: row.genTarget,
    genPrompt: row.genPrompt,
    status: row.status,
  };
}

export function extractLinkedScriptReferenceTree(
  record: ProjectRecord
): LinkedScriptChapterReference[] {
  const nodes = parsePersistedNodesPayload(record.nodesJson);
  const chapterById = new Map<string, ScriptChapterNodeData>();
  const sceneNodeBySource = new Map<
    string,
    { nodeId: string; data: ScriptSceneNodeData }
  >();
  const shootingScriptBySource = new Map<
    string,
    { nodeId: string; data: ShootingScriptNodeData }
  >();

  nodes.forEach((node) => {
    if (node.type === CANVAS_NODE_TYPES.scriptChapter) {
      chapterById.set(node.id, normalizeScriptChapterNodeData(node.data as ScriptChapterNodeData));
      return;
    }

    if (node.type === CANVAS_NODE_TYPES.shootingScript) {
      const data = normalizeShootingScriptNodeData(node.data as ShootingScriptNodeData);
      shootingScriptBySource.set(buildSourceKey(data.sourceSceneNodeId, data.sourceEpisodeId), {
        nodeId: node.id,
        data,
      });
      return;
    }

    if (node.type === CANVAS_NODE_TYPES.scriptScene) {
      const data = normalizeScriptSceneNodeData(node.data as ScriptSceneNodeData);
      sceneNodeBySource.set(
        buildScriptSceneSourceKey(data.sourceChapterId, data.sourceSceneId),
        { nodeId: node.id, data }
      );
    }
  });

  const chapterMap = new Map<string, LinkedScriptChapterReference>();
  const consumedSceneSourceKeys = new Set<string>();

  chapterById.forEach((chapter, chapterId) => {
    const chapterKey = chapterId || `chapter-${chapter.chapterNumber}`;
    const nextChapter: LinkedScriptChapterReference = {
      chapterId,
      chapterNumber: chapter.chapterNumber || 1,
      chapterTitle: chapter.title || chapter.displayName || '',
      scenes: [],
    };

    (chapter.scenes ?? []).forEach((sceneCard) => {
      const sourceKey = buildScriptSceneSourceKey(chapterId, sceneCard.id);
      const linkedScene = sceneNodeBySource.get(sourceKey) ?? null;
      if (linkedScene) {
        consumedSceneSourceKeys.add(sourceKey);
      }

      const chapterNumber = chapter.chapterNumber || linkedScene?.data.chapterNumber || 1;
      const sceneOrder = linkedScene?.data.sourceSceneOrder ?? sceneCard.order;
      const sceneTitle = linkedScene?.data.title || sceneCard.title;
      const episodes = linkedScene
        ? [...linkedScene.data.episodes]
            .sort((left, right) => left.order - right.order)
            .map((episode) => {
              const linkedScript = shootingScriptBySource.get(
                buildSourceKey(linkedScene.nodeId, episode.id)
              ) ?? null;
              const rows = normalizeShootingScriptRows(
                linkedScript?.data.rows ?? mapLegacyShotRows(episode.shotRows),
                {
                  chapterNumber,
                  sceneNumber: sceneOrder + 1,
                  episodeNumber: episode.episodeNumber,
                }
              );

              return {
                chapterId,
                chapterNumber,
                chapterTitle: chapter.title || chapter.displayName || '',
                sourceSceneId: sceneCard.id,
                sceneNodeId: linkedScene.nodeId,
                sceneTitle,
                sceneOrder,
                episode,
                scriptNodeId: linkedScript?.nodeId ?? null,
                rows,
              };
            })
        : [];

      nextChapter.scenes.push({
        sourceSceneId: sceneCard.id,
        sceneNodeId: linkedScene?.nodeId ?? '',
        sceneTitle,
        sceneOrder,
        episodes,
      });
    });

    nextChapter.scenes.sort((left, right) => {
      if (left.sceneOrder !== right.sceneOrder) {
        return left.sceneOrder - right.sceneOrder;
      }
      return left.sourceSceneId.localeCompare(right.sourceSceneId);
    });

    chapterMap.set(chapterKey, nextChapter);
  });

  sceneNodeBySource.forEach((linkedScene, sourceKey) => {
    if (consumedSceneSourceKeys.has(sourceKey)) {
      return;
    }

    const chapter = chapterById.get(linkedScene.data.sourceChapterId);
    const chapterNumber = chapter?.chapterNumber || linkedScene.data.chapterNumber || 1;
    const chapterTitle = chapter?.title || chapter?.displayName || '';
    const chapterKey = linkedScene.data.sourceChapterId || `chapter-${chapterNumber}`;
    const existingChapter = chapterMap.get(chapterKey) ?? {
      chapterId: linkedScene.data.sourceChapterId,
      chapterNumber,
      chapterTitle,
      scenes: [],
    };

    const episodes = [...linkedScene.data.episodes]
      .sort((left, right) => left.order - right.order)
      .map((episode) => {
        const linkedScript = shootingScriptBySource.get(
          buildSourceKey(linkedScene.nodeId, episode.id)
        ) ?? null;
        const rows = normalizeShootingScriptRows(
          linkedScript?.data.rows ?? mapLegacyShotRows(episode.shotRows),
          {
            chapterNumber,
            sceneNumber: linkedScene.data.sourceSceneOrder + 1,
            episodeNumber: episode.episodeNumber,
          }
        );

        return {
          chapterId: linkedScene.data.sourceChapterId,
          chapterNumber,
          chapterTitle,
          sourceSceneId: linkedScene.data.sourceSceneId,
          sceneNodeId: linkedScene.nodeId,
          sceneTitle: linkedScene.data.title,
          sceneOrder: linkedScene.data.sourceSceneOrder,
          episode,
          scriptNodeId: linkedScript?.nodeId ?? null,
          rows,
        };
      });

    existingChapter.scenes.push({
      sourceSceneId: linkedScene.data.sourceSceneId,
      sceneNodeId: linkedScene.nodeId,
      sceneTitle: linkedScene.data.title,
      sceneOrder: linkedScene.data.sourceSceneOrder,
      episodes,
    });

    existingChapter.scenes.sort((left, right) => {
      if (left.sceneOrder !== right.sceneOrder) {
        return left.sceneOrder - right.sceneOrder;
      }
      return left.sourceSceneId.localeCompare(right.sourceSceneId);
    });

    chapterMap.set(chapterKey, existingChapter);
  });

  return Array.from(chapterMap.values()).sort((left, right) => {
    if (left.chapterNumber !== right.chapterNumber) {
      return left.chapterNumber - right.chapterNumber;
    }
    return left.chapterId.localeCompare(right.chapterId);
  });
}

export function findLinkedEpisodeReference(
  chapters: LinkedScriptChapterReference[],
  episodeId: string | null | undefined
): LinkedScriptEpisodeReference | null {
  const normalizedEpisodeId = episodeId?.trim();
  if (!normalizedEpisodeId) {
    return null;
  }

  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      const match = scene.episodes.find((episodeRef) => episodeRef.episode.id === normalizedEpisodeId);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

export function buildScriptReferenceEpisodeSnapshot(
  episodeRef: LinkedScriptEpisodeReference
): ScriptReferenceScriptSnapshot {
  return {
    scriptNodeId: episodeRef.scriptNodeId,
    chapterId: episodeRef.chapterId,
    chapterTitle: episodeRef.chapterTitle,
    sceneNodeId: episodeRef.sceneNodeId,
    sceneTitle: episodeRef.sceneTitle,
    episodeId: episodeRef.episode.id,
    episodeTitle: episodeRef.episode.title,
    episodeLabel: `${episodeRef.chapterNumber}-${episodeRef.episode.episodeNumber}`,
    rows: episodeRef.rows.map((row) => toShotRowSnapshot(row)),
  };
}
