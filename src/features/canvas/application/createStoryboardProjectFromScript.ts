import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  createEmptyDirectorStoryboardOverrides,
  createEmptyProductionQueueState,
  type DirectorStoryboardPackage,
  type DirectorStoryboardReferenceNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

export interface CreateStoryboardProjectFromScriptInput {
  packageSnapshot: DirectorStoryboardPackage;
  linkedScriptProjectId: string;
  projectName: string;
}

export async function createStoryboardProjectFromScriptProject(
  input: CreateStoryboardProjectFromScriptInput
): Promise<string> {
  const { createProject, setProjectLinkedScriptProject, saveCurrentProject } = useProjectStore.getState();
  const projectId = createProject(input.projectName, 'storyboard');
  await setProjectLinkedScriptProject(projectId, input.linkedScriptProjectId);

  const referenceNodeData: Partial<DirectorStoryboardReferenceNodeData> = {
    linkedScriptProjectId: input.linkedScriptProjectId,
    directorStoryboardSourceProjectId: input.linkedScriptProjectId,
    directorStoryboardSourceNodeId:
      input.packageSnapshot.sourceShootingScriptNodeId ?? input.packageSnapshot.sourceSceneNodeId,
    directorStoryboardSourceVersion: input.packageSnapshot.version,
    directorStoryboardSnapshot: input.packageSnapshot,
    directorStoryboardOverrides: createEmptyDirectorStoryboardOverrides(),
    referenceContext: {
      assets: input.packageSnapshot.referenceAssets,
      bindings: input.packageSnapshot.sections.flatMap((section) => [
        ...section.referenceBindings,
        ...section.shots.flatMap((shot) => shot.referenceBindings),
      ]),
      updatedAt: input.packageSnapshot.generatedAt,
    },
    productionQueue: createEmptyProductionQueueState(),
    syncStatus: input.packageSnapshot.status === 'ready' ? 'ready' : 'error',
    syncMessage: input.packageSnapshot.generation.statusText,
    lastSyncedAt: Date.now(),
  };

  const referenceNode = canvasNodeFactory.createNode(
    CANVAS_NODE_TYPES.directorStoryboardReference,
    { x: 120, y: 120 },
    referenceNodeData
  );

  useCanvasStore.getState().setCanvasData([referenceNode], [], { past: [], future: [] });
  saveCurrentProject([referenceNode], [], undefined, { past: [], future: [] });

  return projectId;
}
