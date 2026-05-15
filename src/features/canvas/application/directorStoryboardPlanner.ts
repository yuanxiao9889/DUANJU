import { v4 as uuidv4 } from 'uuid';

import type { ProjectRecord } from '@/commands/projectState';
import {
  CANVAS_NODE_TYPES,
  normalizeScriptRootNodeData,
  normalizeScriptSceneNodeData,
  normalizeShootingScriptNodeData,
  type CanvasNode,
  type DirectorStoryboardGenerationState,
  type DirectorStoryboardPackage,
  type DirectorStoryboardSection,
  type DirectorStoryboardShotDraft,
  type ReferenceAssetBinding,
  type ReferenceAssetSnapshot,
  type ScriptCharacterAsset,
  type ScriptCharacterNodeData,
  type ScriptItemAsset,
  type ScriptItemNodeData,
  type ScriptLocationAsset,
  type ScriptLocationNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
  type ShootingScriptNodeData,
  type ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';

const SECTION_SIZE = 4;

interface PersistedNodesPayload {
  nodes?: CanvasNode[];
}

export interface GenerateDirectorStoryboardPackageInput {
  sourceScriptProjectId: string;
  nodes: CanvasNode[];
  sourceShootingScriptNodeId?: string | null;
  sourceSceneNodeId?: string | null;
  previousPackage?: DirectorStoryboardPackage | null;
}

export interface GenerateDirectorStoryboardPackageFromRecordInput {
  record: ProjectRecord;
  sourceShootingScriptNodeId?: string | null;
  sourceSceneNodeId?: string | null;
  previousPackage?: DirectorStoryboardPackage | null;
}

type NamedReferenceAsset = ReferenceAssetSnapshot & {
  compareName: string;
};

function normalizeCompareText(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[\s,.;:!?"'`~\-_/\\|()[\]{}<>，。；：！？、]/g, '')
    : '';
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

function buildGenerationState(
  phase: DirectorStoryboardGenerationState['phase'],
  statusText: string,
  lastError: string | null = null
): DirectorStoryboardGenerationState {
  return {
    requestId: null,
    phase,
    statusText,
    lastError,
    lastGeneratedAt: Date.now(),
  };
}

function extractScriptAssetContext(nodes: CanvasNode[], sourceProjectId: string): {
  rootNodeId: string | null;
  rootData: ScriptRootNodeData | null;
  referenceAssets: NamedReferenceAsset[];
} {
  const rootNode = nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot) ?? null;
  const rootData = rootNode
    ? normalizeScriptRootNodeData(rootNode.data as ScriptRootNodeData)
    : null;

  const referenceAssets: NamedReferenceAsset[] = [];

  const pushAsset = (
    kind: ReferenceAssetSnapshot['kind'],
    sourceType: ReferenceAssetSnapshot['sourceType'],
    asset: ScriptCharacterAsset | ScriptLocationAsset | ScriptItemAsset,
    sourceNodeId: string | null
  ) => {
    const name = asset.name?.trim();
    if (!name) {
      return;
    }

    const baseDescription = asset.description ?? '';
    const description = 'personality' in asset
      ? [baseDescription, asset.personality, asset.appearance].filter(Boolean).join(' ')
      : [baseDescription, ...(('appearances' in asset ? asset.appearances : []) ?? [])]
          .filter(Boolean)
          .join(' ');

    referenceAssets.push({
      id: uuidv4(),
      kind,
      sourceType,
      sourceProjectId,
      sourceNodeId,
      assetId: null,
      assetLibraryId: null,
      name,
      imageUrl: null,
      previewImageUrl: null,
      description: description || null,
      locked: false,
      compareName: normalizeCompareText(name),
    });
  };

  rootData?.assetLibraryCharacters.forEach((asset) => pushAsset('character', 'libraryAsset', asset, rootNode?.id ?? null));
  rootData?.assetLibraryLocations.forEach((asset) => pushAsset('location', 'libraryAsset', asset, rootNode?.id ?? null));
  rootData?.assetLibraryItems.forEach((asset) => pushAsset('item', 'libraryAsset', asset, rootNode?.id ?? null));

  nodes.forEach((node) => {
    if (node.type === CANVAS_NODE_TYPES.scriptCharacter) {
      const data = node.data as ScriptCharacterNodeData;
      pushAsset('character', 'scriptAsset', {
        name: data.name,
        description: data.description,
        personality: data.personality,
        appearance: data.appearance,
      }, node.id);
      return;
    }

    if (node.type === CANVAS_NODE_TYPES.scriptLocation) {
      const data = node.data as ScriptLocationNodeData;
      pushAsset('location', 'scriptAsset', {
        name: data.name,
        description: data.description,
        appearances: data.appearances ?? [],
      }, node.id);
      return;
    }

    if (node.type === CANVAS_NODE_TYPES.scriptItem) {
      const data = node.data as ScriptItemNodeData;
      pushAsset('item', 'scriptAsset', {
        name: data.name,
        description: data.description,
        appearances: data.appearances ?? [],
      }, node.id);
    }
  });

  const deduped = Array.from(
    referenceAssets.reduce((map, asset) => {
      if (!asset.compareName) {
        return map;
      }

      if (!map.has(asset.compareName)) {
        map.set(asset.compareName, asset);
      }
      return map;
    }, new Map<string, NamedReferenceAsset>()).values()
  );

  return {
    rootNodeId: rootNode?.id ?? null,
    rootData,
    referenceAssets: deduped,
  };
}

function resolveReferenceBindings(
  referenceAssets: NamedReferenceAsset[],
  targetType: ReferenceAssetBinding['targetType'],
  targetId: string,
  textParts: Array<string | null | undefined>
): ReferenceAssetBinding[] {
  const text = normalizeCompareText(textParts.filter(Boolean).join(' '));
  if (!text) {
    return [];
  }

  return referenceAssets
    .filter((asset) => asset.compareName && text.includes(asset.compareName))
    .map((asset) => ({
      referenceId: asset.id,
      targetType,
      targetId,
      role:
        asset.kind === 'character'
          ? 'subject'
          : asset.kind === 'location'
            ? 'environment'
            : 'prop',
      weight: 1,
      notes: null,
    }));
}

function buildShotPrompt(row: ShootingScriptRow, sectionTitle: string): string {
  const parts = [
    row.genPrompt,
    row.beat ? `剧情重点：${row.beat}` : '',
    row.action ? `动作表演：${row.action}` : '',
    row.composition ? `构图景别：${row.composition}` : '',
    row.camera ? `机位运镜：${row.camera}` : '',
    row.blocking ? `调度走位：${row.blocking}` : '',
    row.artLighting ? `美术灯光：${row.artLighting}` : '',
    row.directorIntent ? `导演意图：${row.directorIntent}` : '',
    sectionTitle ? `场景段落：${sectionTitle}` : '',
  ]
    .map((item) => item?.trim())
    .filter(Boolean);

  return parts.join('\n');
}

function buildVideoPrompt(row: ShootingScriptRow, sectionTitle: string): string {
  const parts = [
    row.genPrompt,
    row.action ? `镜头动作：${row.action}` : '',
    row.camera ? `镜头运动：${row.camera}` : '',
    row.duration ? `节奏时长：${row.duration}` : '',
    row.audio ? `对白/声音：${row.audio}` : '',
    row.blocking ? `调度：${row.blocking}` : '',
    sectionTitle ? `段落：${sectionTitle}` : '',
  ]
    .map((item) => item?.trim())
    .filter(Boolean);

  return parts.join('\n');
}

function buildSectionsFromShootingScript(
  scriptNodeId: string,
  scriptData: ShootingScriptNodeData,
  rootData: ScriptRootNodeData | null,
  referenceAssets: NamedReferenceAsset[]
): DirectorStoryboardSection[] {
  const sections: DirectorStoryboardSection[] = [];
  const sectionCount = Math.max(1, Math.ceil(scriptData.rows.length / SECTION_SIZE));

  for (let index = 0; index < sectionCount; index += 1) {
    const rows = scriptData.rows.slice(index * SECTION_SIZE, (index + 1) * SECTION_SIZE);
    const sectionId = `${scriptNodeId}-section-${index + 1}`;
    const sectionTitle = rows[0]?.beat?.trim() || `${scriptData.sceneTitle || scriptData.episodeTitle || 'Scene'} ${index + 1}`;
    const shots: DirectorStoryboardShotDraft[] = rows.map((row, rowIndex) => {
      const shotId = `${scriptNodeId}-shot-${row.id || index * SECTION_SIZE + rowIndex + 1}`;
      return {
        id: shotId,
        sectionId,
        order: rowIndex,
        shotLabel: row.shotNumber?.trim() || `Shot ${index * SECTION_SIZE + rowIndex + 1}`,
        shotPurpose: row.beat?.trim() || row.directorIntent?.trim() || '',
        compositionHint: row.composition?.trim() || '',
        cameraHint: row.camera?.trim() || '',
        motionHint: row.blocking?.trim() || row.action?.trim() || '',
        promptDraft: buildShotPrompt(row, sectionTitle),
        videoPromptDraft: buildVideoPrompt(row, sectionTitle),
        referenceBindings: resolveReferenceBindings(referenceAssets, 'shot', shotId, [
          row.beat,
          row.action,
          row.composition,
          row.camera,
          row.blocking,
          row.artLighting,
          row.audio,
          row.continuityNote,
        ]),
      };
    });

    sections.push({
      id: sectionId,
      order: index,
      title: sectionTitle,
      summary: rows.map((row) => row.beat?.trim()).filter(Boolean).join(' / '),
      dramaticGoal: rows.map((row) => row.directorIntent?.trim()).filter(Boolean)[0] || scriptData.episodeTitle || '',
      visualIntent: rows.map((row) => row.composition?.trim()).filter(Boolean).join(' / '),
      continuityNotes: rows.map((row) => row.continuityNote?.trim()).filter(Boolean).join(' / '),
      styleHints: [
        rootData?.tone?.trim(),
        rootData?.directorVision?.trim(),
        scriptData.sceneTitle?.trim(),
      ].filter((item): item is string => Boolean(item)),
      referenceBindings: resolveReferenceBindings(referenceAssets, 'section', sectionId, [
        sectionTitle,
        rows.map((row) => row.beat?.trim()).filter(Boolean).join(' / '),
        rows.map((row) => row.directorIntent?.trim()).filter(Boolean)[0] || scriptData.episodeTitle || '',
        rows.map((row) => row.composition?.trim()).filter(Boolean).join(' / '),
      ]),
      shots,
    });
  }

  return sections;
}

function buildSectionsFromScene(
  sceneNodeId: string,
  sceneData: ScriptSceneNodeData,
  rootData: ScriptRootNodeData | null,
  referenceAssets: NamedReferenceAsset[]
): DirectorStoryboardSection[] {
  const sectionId = `${sceneNodeId}-section-1`;
  const shots: DirectorStoryboardShotDraft[] = (sceneData.episodes.length > 0
    ? sceneData.episodes
    : [{
        id: `${sceneNodeId}-fallback-episode`,
        title: sceneData.title,
        summary: sceneData.summary,
        purpose: sceneData.purpose,
        visualHook: sceneData.visualHook,
      }]
  ).map((episode, index) => {
    const shotId = `${sceneNodeId}-shot-${'id' in episode ? episode.id : index + 1}`;
    const summary = 'summary' in episode ? episode.summary : sceneData.summary;
    const title = 'title' in episode ? episode.title : sceneData.title;
    return {
      id: shotId,
      sectionId,
      order: index,
      shotLabel: title?.trim() || `Shot ${index + 1}`,
      shotPurpose: ('purpose' in episode ? episode.purpose : sceneData.purpose)?.trim() || '',
      compositionHint: ('visualHook' in episode ? episode.visualHook : sceneData.visualHook)?.trim() || '',
      cameraHint: '',
      motionHint: sceneData.turn?.trim() || sceneData.goal?.trim() || '',
      promptDraft: [
        title ? `镜头标题：${title}` : '',
        summary ? `剧情内容：${summary}` : '',
        sceneData.visualHook ? `视觉钩子：${sceneData.visualHook}` : '',
        sceneData.povCharacter ? `主视角角色：${sceneData.povCharacter}` : '',
      ].filter(Boolean).join('\n'),
      videoPromptDraft: [
        summary ? `镜头内容：${summary}` : '',
        sceneData.goal ? `目标：${sceneData.goal}` : '',
        sceneData.turn ? `转折：${sceneData.turn}` : '',
      ].filter(Boolean).join('\n'),
      referenceBindings: resolveReferenceBindings(referenceAssets, 'shot', shotId, [
        title,
        summary,
        sceneData.povCharacter,
        sceneData.visualHook,
        sceneData.goal,
        sceneData.conflict,
      ]),
    };
  });

  return [{
    id: sectionId,
    order: 0,
    title: sceneData.title?.trim() || 'Scene Section',
    summary: sceneData.summary?.trim() || '',
    dramaticGoal: sceneData.goal?.trim() || sceneData.purpose?.trim() || '',
    visualIntent: sceneData.visualHook?.trim() || '',
    continuityNotes: sceneData.subtext?.trim() || '',
    styleHints: [
      rootData?.tone?.trim(),
      rootData?.directorVision?.trim(),
      sceneData.emotionalShift?.trim(),
    ].filter((item): item is string => Boolean(item)),
    referenceBindings: resolveReferenceBindings(referenceAssets, 'section', sectionId, [
      sceneData.title,
      sceneData.summary,
      sceneData.purpose,
      sceneData.goal,
      sceneData.visualHook,
    ]),
    shots,
  }];
}

export function generateDirectorStoryboardPackage(
  input: GenerateDirectorStoryboardPackageInput
): DirectorStoryboardPackage {
  const { sourceScriptProjectId, nodes, sourceShootingScriptNodeId, sourceSceneNodeId, previousPackage } = input;
  const { rootNodeId, rootData, referenceAssets } = extractScriptAssetContext(nodes, sourceScriptProjectId);

  const shootingScriptNode = sourceShootingScriptNodeId
    ? nodes.find((node) => node.id === sourceShootingScriptNodeId && node.type === CANVAS_NODE_TYPES.shootingScript) ?? null
    : null;
  const scriptSceneNode = sourceSceneNodeId
    ? nodes.find((node) => node.id === sourceSceneNodeId && node.type === CANVAS_NODE_TYPES.scriptScene) ?? null
    : null;

  const normalizedScriptData = shootingScriptNode
    ? normalizeShootingScriptNodeData(shootingScriptNode.data as ShootingScriptNodeData)
    : null;
  const normalizedSceneData = scriptSceneNode
    ? normalizeScriptSceneNodeData(scriptSceneNode.data as ScriptSceneNodeData)
    : null;

  const sections = normalizedScriptData
    ? buildSectionsFromShootingScript(shootingScriptNode!.id, normalizedScriptData, rootData, referenceAssets)
    : normalizedSceneData
      ? buildSectionsFromScene(scriptSceneNode!.id, normalizedSceneData, rootData, referenceAssets)
      : [];

  const generation = sections.length > 0
    ? buildGenerationState('ready', 'Director storyboard package ready')
    : buildGenerationState('error', 'No shooting script or scene available', 'No valid source node');

  return {
    id: previousPackage?.id ?? uuidv4(),
    sourceScriptProjectId,
    sourceScriptRootNodeId: rootNodeId,
    sourceDirectorWorkPackageNodeId: previousPackage?.sourceDirectorWorkPackageNodeId ?? null,
    sourceSceneNodeId: normalizedScriptData?.sourceSceneNodeId ?? scriptSceneNode?.id ?? null,
    sourceShootingScriptNodeId: shootingScriptNode?.id ?? null,
    sourceMode: previousPackage?.sourceMode ?? null,
    sourceChapterNodeIds: previousPackage?.sourceChapterNodeIds ?? [],
    version: Math.max(1, (previousPackage?.version ?? 0) + 1),
    generatedAt: Date.now(),
    status: sections.length > 0 ? 'ready' : 'error',
    sections,
    referenceAssets: referenceAssets.map(({ compareName: _compareName, ...asset }) => asset),
    generation,
  };
}

export function generateDirectorStoryboardPackageFromProjectRecord(
  input: GenerateDirectorStoryboardPackageFromRecordInput
): DirectorStoryboardPackage {
  return generateDirectorStoryboardPackage({
    sourceScriptProjectId: input.record.id,
    nodes: parsePersistedNodesPayload(input.record.nodesJson),
    sourceShootingScriptNodeId: input.sourceShootingScriptNodeId,
    sourceSceneNodeId: input.sourceSceneNodeId,
    previousPackage: input.previousPackage,
  });
}
