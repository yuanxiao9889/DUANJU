import { canvasNodeDefinitions, getMenuNodeDefinitions } from '../domain/nodeRegistry';
import type { CanvasNodeType } from '../domain/canvasNodes';
import type { NodeCatalog } from './ports';
import { isExtensionRequirementSatisfied } from '@/stores/extensionsStore';

export function isCanvasNodeTypeEnabled(type: CanvasNodeType): boolean {
  return isExtensionRequirementSatisfied(
    canvasNodeDefinitions[type].requiredExtensionId,
    canvasNodeDefinitions[type].requiredExtensionIds
  );
}

export const nodeCatalog: NodeCatalog = {
  getDefinition: (type: CanvasNodeType) => canvasNodeDefinitions[type],
  getMenuDefinitions: (projectType, options) =>
    getMenuNodeDefinitions(projectType, options).filter((definition) =>
      isExtensionRequirementSatisfied(
        definition.requiredExtensionId,
        definition.requiredExtensionIds
      )
    ),
};
