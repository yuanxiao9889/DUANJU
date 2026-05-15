import { v4 as uuidv4 } from 'uuid';

import { getProjectRecord } from '@/commands/projectState';
import { resolveDirectorWorkPackagePackageFromProjectRecord } from '@/features/canvas/application/directorWorkPackage';
import { generateDirectorStoryboardPackageFromProjectRecord } from '@/features/canvas/application/directorStoryboardPlanner';
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type DirectorStoryboardPackage,
  type DirectorStoryboardReferenceNodeData,
  type DirectorStoryboardSection,
  type DirectorStoryboardShotDraft,
  type ProductionJobRecord,
  type ProductionQueueState,
  type ReferenceAssetBinding,
  type ReferenceAssetSnapshot,
  type StoryboardGenNodeData,
  type VideoNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { DEFAULT_IMAGE_MODEL_ID } from '@/features/canvas/models';
import { useCanvasStore } from '@/stores/canvasStore';

function resolveReferenceNode(
  referenceNodeId: string
): (CanvasNode & {
  type: typeof CANVAS_NODE_TYPES.directorStoryboardReference;
  data: DirectorStoryboardReferenceNodeData;
}) | null {
  const node = useCanvasStore.getState().nodes.find(
    (entry): entry is CanvasNode & {
      type: typeof CANVAS_NODE_TYPES.directorStoryboardReference;
      data: DirectorStoryboardReferenceNodeData;
    } => entry.id === referenceNodeId && entry.type === CANVAS_NODE_TYPES.directorStoryboardReference
  );

  return node ?? null;
}

function resolveBoundReferenceAssets(
  snapshot: DirectorStoryboardPackage,
  bindings: ReferenceAssetBinding[],
  overrides: DirectorStoryboardReferenceNodeData['directorStoryboardOverrides'],
  shotId: string
): ReferenceAssetSnapshot[] {
  const assetIds = new Set([
    ...bindings.map((binding) => binding.referenceId),
    ...(overrides.shotReferenceAssetIds[shotId] ?? []),
  ]);

  return snapshot.referenceAssets.filter((asset) => assetIds.has(asset.id));
}

function buildStoryboardShotPrompt(
  section: DirectorStoryboardSection,
  shot: DirectorStoryboardShotDraft,
  referenceAssets: ReferenceAssetSnapshot[],
  overrides: DirectorStoryboardReferenceNodeData['directorStoryboardOverrides']
): string {
  const promptOverride = overrides.shotPromptOverrides[shot.id]?.trim();
  if (promptOverride) {
    return promptOverride;
  }

  const referenceLines = referenceAssets
    .map((asset, index) => {
      const summary = [asset.name, asset.description].filter(Boolean).join(' - ');
      return asset.imageUrl ? `@图片${index + 1} ${summary}` : summary;
    })
    .filter(Boolean);

  return [
    shot.promptDraft,
    section.visualIntent ? `段落视觉意图：${section.visualIntent}` : '',
    section.continuityNotes ? `连续性备注：${section.continuityNotes}` : '',
    ...referenceLines,
  ].filter(Boolean).join('\n');
}

function buildImageJob(
  sourceSectionId: string,
  sourceShotId: string,
  sourceNodeId: string | null
): ProductionJobRecord {
  return {
    jobId: uuidv4(),
    kind: 'image',
    sourceSectionId,
    sourceShotId,
    sourceNodeId,
    status: 'idle',
    requestId: null,
    resultNodeIds: [],
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

function mergeImageJobs(
  queue: ProductionQueueState,
  jobs: ProductionJobRecord[]
): ProductionQueueState {
  const existingKeySet = new Set(queue.imageJobs.map((job) => `${job.sourceSectionId}:${job.sourceShotId}`));
  const nextJobs = jobs.filter((job) => !existingKeySet.has(`${job.sourceSectionId}:${job.sourceShotId}`));

  return {
    ...queue,
    imageJobs: [...queue.imageJobs, ...nextJobs],
  };
}

export async function syncStoryboardDirectorReference(
  referenceNodeId: string
): Promise<DirectorStoryboardPackage | null> {
  const referenceNode = resolveReferenceNode(referenceNodeId);
  if (!referenceNode) {
    return null;
  }

  const linkedScriptProjectId = referenceNode.data.linkedScriptProjectId?.trim();
  if (!linkedScriptProjectId) {
    useCanvasStore.getState().updateNodeData(referenceNodeId, {
      syncStatus: 'missingProject',
      syncMessage: 'Missing linked script project',
    });
    return null;
  }

  const record = await getProjectRecord(linkedScriptProjectId);
  if (!record) {
    useCanvasStore.getState().updateNodeData(referenceNodeId, {
      syncStatus: 'missingProject',
      syncMessage: 'Linked script project not found',
    });
    return null;
  }

  const sourceNodeId = referenceNode.data.directorStoryboardSourceNodeId
    ?? referenceNode.data.directorStoryboardSnapshot?.sourceDirectorWorkPackageNodeId
    ?? referenceNode.data.directorStoryboardSnapshot?.sourceShootingScriptNodeId
    ?? referenceNode.data.directorStoryboardSnapshot?.sourceSceneNodeId
    ?? null;
  const nextPackage = sourceNodeId
    ? (
      resolveDirectorWorkPackagePackageFromProjectRecord(record, sourceNodeId)
      ?? generateDirectorStoryboardPackageFromProjectRecord({
        record,
        sourceShootingScriptNodeId: referenceNode.data.directorStoryboardSnapshot?.sourceShootingScriptNodeId
          ?? sourceNodeId,
        sourceSceneNodeId: referenceNode.data.directorStoryboardSnapshot?.sourceSceneNodeId
          ?? sourceNodeId,
        previousPackage: referenceNode.data.directorStoryboardSnapshot,
      })
    )
    : null;
  if (!nextPackage) {
    useCanvasStore.getState().updateNodeData(referenceNodeId, {
      syncStatus: 'missingSource',
      syncMessage: 'Linked director work package was not found',
    });
    return null;
  }

  useCanvasStore.getState().updateNodeData(referenceNodeId, {
    linkedScriptProjectId,
    directorStoryboardSourceProjectId: linkedScriptProjectId,
    directorStoryboardSourceNodeId:
      nextPackage.sourceDirectorWorkPackageNodeId
      ?? nextPackage.sourceShootingScriptNodeId
      ?? nextPackage.sourceSceneNodeId,
    directorStoryboardSourceVersion: nextPackage.version,
    directorStoryboardSnapshot: nextPackage,
    referenceContext: {
      assets: nextPackage.referenceAssets,
      bindings: nextPackage.sections.flatMap((section) => [
        ...section.referenceBindings,
        ...section.shots.flatMap((shot) => shot.referenceBindings),
      ]),
      updatedAt: nextPackage.generatedAt,
    },
    syncStatus: nextPackage.status === 'ready' ? 'ready' : 'error',
    syncMessage: nextPackage.generation.statusText,
    lastSyncedAt: Date.now(),
  });

  return nextPackage;
}

export function enqueueStoryboardImageGeneration(referenceNodeId: string, shotIds: string[]): void {
  const referenceNode = resolveReferenceNode(referenceNodeId);
  if (!referenceNode || !referenceNode.data.directorStoryboardSnapshot) {
    return;
  }

  const snapshot = referenceNode.data.directorStoryboardSnapshot;
  const nextJobs = snapshot.sections.flatMap((section) =>
    section.shots
      .filter((shot) => shotIds.includes(shot.id))
      .map((shot) => buildImageJob(section.id, shot.id, referenceNode.data.directorStoryboardOverrides.shotNodeIds[shot.id] ?? null))
  );

  useCanvasStore.getState().updateNodeData(referenceNodeId, {
    productionQueue: mergeImageJobs(referenceNode.data.productionQueue, nextJobs),
  });
}

export function enqueueStoryboardVideoGeneration(referenceNodeId: string, shotIds: string[]): void {
  const referenceNode = resolveReferenceNode(referenceNodeId);
  if (!referenceNode) {
    return;
  }

  const videoJob: ProductionJobRecord = {
    jobId: uuidv4(),
    kind: 'video',
    sourceSectionId: null,
    sourceShotId: shotIds.join(','),
    sourceNodeId: null,
    status: 'idle',
    requestId: null,
    resultNodeIds: [],
    startedAt: null,
    finishedAt: null,
    error: null,
  };

  useCanvasStore.getState().updateNodeData(referenceNodeId, {
    productionQueue: {
      ...referenceNode.data.productionQueue,
      videoJobs: [...referenceNode.data.productionQueue.videoJobs, videoJob],
    },
  });
}

export function expandDirectorSectionsToCanvas(
  referenceNodeId: string,
  sectionIds?: string[]
): void {
  const referenceNode = resolveReferenceNode(referenceNodeId);
  if (!referenceNode || !referenceNode.data.directorStoryboardSnapshot) {
    return;
  }

  const snapshot = referenceNode.data.directorStoryboardSnapshot;
  const { addNode, updateNodeData } = useCanvasStore.getState();
  const currentOverrides = referenceNode.data.directorStoryboardOverrides;
  const selectedSectionIds = new Set(sectionIds ?? snapshot.sections.map((section) => section.id));
  const nextOverrides = {
    ...currentOverrides,
    expandedSectionIds: [...currentOverrides.expandedSectionIds],
    sectionGroupNodeIds: { ...currentOverrides.sectionGroupNodeIds },
    shotNodeIds: { ...currentOverrides.shotNodeIds },
  };
  const createdJobs: ProductionJobRecord[] = [];

  const baseX = referenceNode.position.x + 420;
  const baseY = referenceNode.position.y - 20;

  snapshot.sections
    .filter((section) => selectedSectionIds.has(section.id))
    .forEach((section, sectionIndex) => {
      if (nextOverrides.sectionGroupNodeIds[section.id]) {
        return;
      }

      const groupNodeId = addNode(
        CANVAS_NODE_TYPES.group,
        {
          x: baseX + sectionIndex * 420,
          y: baseY + sectionIndex * 80,
        },
        {
          label: section.title || `Section ${section.order + 1}`,
          displayName: section.title || `Section ${section.order + 1}`,
          nodeDescription: section.summary,
          layoutDirection: 'horizontal',
          maxItemsPerLine: 2,
        }
      );

      nextOverrides.sectionGroupNodeIds[section.id] = groupNodeId;
      if (!nextOverrides.expandedSectionIds.includes(section.id)) {
        nextOverrides.expandedSectionIds.push(section.id);
      }

      section.shots.forEach((shot, shotIndex) => {
        if (nextOverrides.shotNodeIds[shot.id]) {
          return;
        }

        const referenceAssets = resolveBoundReferenceAssets(
          snapshot,
          [...section.referenceBindings, ...shot.referenceBindings],
          currentOverrides,
          shot.id
        );
        const promptText = buildStoryboardShotPrompt(section, shot, referenceAssets, currentOverrides);
        const nodeId = addNode(
          CANVAS_NODE_TYPES.storyboardGen,
          {
            x: 24 + (shotIndex % 2) * 260,
            y: 84 + Math.floor(shotIndex / 2) * 240,
          },
          {
            displayName: shot.shotLabel || `Shot ${shot.order + 1}`,
            nodeDescription: shot.shotPurpose || section.summary,
            gridRows: 1,
            gridCols: 1,
            frames: [{
              id: `${shot.id}-frame-1`,
              description: promptText,
              referenceIndex: null,
              sourcePackage: null,
            }],
            model: DEFAULT_IMAGE_MODEL_ID,
            size: '1K',
            requestAspectRatio: '16:9',
            imageUrl: null,
            previewImageUrl: null,
            aspectRatio: '16:9',
            sourceDirectorPackageId: snapshot.id,
            sourceSectionId: section.id,
            sourceShotId: shot.id,
            promptText,
            videoPromptText:
              currentOverrides.shotVideoPromptOverrides[shot.id]?.trim() || shot.videoPromptDraft,
            referenceAssets,
            productionJobId: null,
          } satisfies Partial<StoryboardGenNodeData>,
          {
            parentId: groupNodeId,
            positionSpace: 'parent',
          }
        );

        nextOverrides.shotNodeIds[shot.id] = nodeId;
        createdJobs.push(buildImageJob(section.id, shot.id, nodeId));
      });
    });

  updateNodeData(referenceNodeId, {
    directorStoryboardOverrides: nextOverrides,
    productionQueue: mergeImageJobs(referenceNode.data.productionQueue, createdJobs),
    syncStatus: 'ready',
  });
}

export function createStoryboardVideoNodeFromShots(
  referenceNodeId: string,
  shotIds: string[],
  position: { x: number; y: number }
): string | null {
  const referenceNode = resolveReferenceNode(referenceNodeId);
  if (!referenceNode || !referenceNode.data.directorStoryboardSnapshot || shotIds.length === 0) {
    return null;
  }

  const snapshot = referenceNode.data.directorStoryboardSnapshot;
  const selectedShots = snapshot.sections.flatMap((section) => section.shots.filter((shot) => shotIds.includes(shot.id)));
  if (selectedShots.length === 0) {
    return null;
  }

  const referenceAssets = selectedShots.flatMap((shot) =>
    resolveBoundReferenceAssets(
      snapshot,
      [
        ...(snapshot.sections.find((section) => section.id === shot.sectionId)?.referenceBindings ?? []),
        ...shot.referenceBindings,
      ],
      referenceNode.data.directorStoryboardOverrides,
      shot.id
    )
  );
  const uniqueAssets = Array.from(new Map(referenceAssets.map((asset) => [asset.id, asset])).values());
  const nodeId = useCanvasStore.getState().addNode(
    CANVAS_NODE_TYPES.video,
    position,
    {
      displayName: 'Storyboard Video',
      aspectRatio: '16:9',
      videoUrl: null,
      previewImageUrl: uniqueAssets[0]?.previewImageUrl ?? uniqueAssets[0]?.imageUrl ?? null,
      nodeDescription: selectedShots.map((shot) => shot.shotLabel).join(' / '),
      sourceDirectorPackageId: snapshot.id,
      sourceSectionId: selectedShots[0]?.sectionId ?? null,
      sourceShotIds: selectedShots.map((shot) => shot.id),
      referenceAssets: uniqueAssets,
      productionJobId: null,
    } satisfies Partial<VideoNodeData>
  );

  return nodeId;
}
