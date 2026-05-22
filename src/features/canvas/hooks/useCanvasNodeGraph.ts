import { useMemo } from 'react';

import {
  isCanvasTextSourceNode,
  resolveCanvasTextSourceNodeText,
} from '@/features/canvas/application/connectedText';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import type { ConnectedReferenceImage } from '@/features/canvas/application/connectedReferenceImages';
import type { ConnectedReferenceVisual } from '@/features/canvas/application/connectedReferenceVisuals';
import {
  extractAudioReference,
  extractReferenceImageUrls,
  extractReferenceVisuals,
} from '@/features/canvas/application/nodeReferenceExtraction';
import { useCanvasStore, type CanvasEdge, type CanvasNode } from '@/stores/canvasStore';

interface CanvasGraphSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasNodeGraphSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface ConnectedAudioReference {
  sourceEdgeId: string;
  sourceNodeId: string;
  audioUrl: string;
  displayName: string | null;
  audioFileName: string | null;
  mimeType: string | null;
  durationSeconds: number | null;
}

export interface CanvasIncomingSourceNode {
  edge: CanvasEdge;
  node: CanvasNode;
}

export interface CanvasConnectedTextInput {
  connectedText: string;
  hasConnectedTextSource: boolean;
  hasNonEmptyConnectedText: boolean;
}

const EMPTY_EDGES: CanvasEdge[] = [];
const EMPTY_NODES: CanvasNode[] = [];
const EMPTY_NODE_REFERENCES: Array<CanvasNode | undefined> = [];
const EMPTY_INPUT_IMAGES: string[] = [];
const EMPTY_CONNECTED_REFERENCE_IMAGES: ConnectedReferenceImage[] = [];
const EMPTY_CONNECTED_REFERENCE_VISUALS: ConnectedReferenceVisual[] = [];
const EMPTY_CONNECTED_AUDIO_REFERENCES: ConnectedAudioReference[] = [];
const EMPTY_INCOMING_SOURCE_NODES: CanvasIncomingSourceNode[] = [];
const EMPTY_CONNECTED_TEXT_INPUT: CanvasConnectedTextInput = {
  connectedText: '',
  hasConnectedTextSource: false,
  hasNonEmptyConnectedText: false,
};

const nodeByIdCache = new WeakMap<CanvasNode[], Map<string, CanvasNode>>();
const incomingEdgesByTargetCache = new WeakMap<CanvasEdge[], Map<string, CanvasEdge[]>>();
const childNodesByParentIdCache = new WeakMap<CanvasNode[], Map<string, CanvasNode[]>>();

function getNodeByIdMap(nodes: CanvasNode[]): Map<string, CanvasNode> {
  const cached = nodeByIdCache.get(nodes);
  if (cached) {
    return cached;
  }

  const map = new Map(nodes.map((node) => [node.id, node] as const));
  nodeByIdCache.set(nodes, map);
  return map;
}

function getIncomingEdgesByTarget(edges: CanvasEdge[]): Map<string, CanvasEdge[]> {
  const cached = incomingEdgesByTargetCache.get(edges);
  if (cached) {
    return cached;
  }

  const map = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    const existing = map.get(edge.target);
    if (existing) {
      existing.push(edge);
      continue;
    }
    map.set(edge.target, [edge]);
  }

  incomingEdgesByTargetCache.set(edges, map);
  return map;
}

function getChildNodesByParentIdMap(nodes: CanvasNode[]): Map<string, CanvasNode[]> {
  const cached = childNodesByParentIdCache.get(nodes);
  if (cached) {
    return cached;
  }

  const map = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }

    const existing = map.get(node.parentId);
    if (existing) {
      existing.push(node);
      continue;
    }
    map.set(node.parentId, [node]);
  }

  childNodesByParentIdCache.set(nodes, map);
  return map;
}

function resolveIncomingEdges(state: CanvasGraphSnapshot, nodeId: string): CanvasEdge[] {
  return getIncomingEdgesByTarget(state.edges).get(nodeId) ?? EMPTY_EDGES;
}

function resolveSourceNodes(
  state: CanvasGraphSnapshot,
  incomingEdges: CanvasEdge[]
): Array<CanvasNode | undefined> {
  const nodeById = getNodeByIdMap(state.nodes);
  return incomingEdges.map((edge) => nodeById.get(edge.source));
}

function haveRelevantSourcesChanged(
  previousIncomingEdges: CanvasEdge[] | null,
  previousSourceNodes: Array<CanvasNode | undefined> | null,
  nextIncomingEdges: CanvasEdge[],
  nextSourceNodes: Array<CanvasNode | undefined>
): boolean {
  if (!previousIncomingEdges || !previousSourceNodes) {
    return true;
  }

  if (
    previousIncomingEdges.length !== nextIncomingEdges.length
    || previousSourceNodes.length !== nextSourceNodes.length
  ) {
    return true;
  }

  for (let index = 0; index < nextIncomingEdges.length; index += 1) {
    const previousEdge = previousIncomingEdges[index];
    const nextEdge = nextIncomingEdges[index];
    if (
      previousEdge.id !== nextEdge.id
      || previousEdge.source !== nextEdge.source
      || previousEdge.target !== nextEdge.target
    ) {
      return true;
    }

    if (previousSourceNodes[index] !== nextSourceNodes[index]) {
      return true;
    }
  }

  return false;
}

function haveRelevantNodeReferencesChanged(
  previousNodes: Array<CanvasNode | undefined> | null,
  nextNodes: Array<CanvasNode | undefined>
): boolean {
  if (!previousNodes || previousNodes.length !== nextNodes.length) {
    return true;
  }

  for (let index = 0; index < nextNodes.length; index += 1) {
    if (previousNodes[index] !== nextNodes[index]) {
      return true;
    }
  }

  return false;
}

function haveRelevantResolvedNodesChanged(
  previousNodes: CanvasNode[] | null,
  nextNodes: CanvasNode[]
): boolean {
  if (!previousNodes || previousNodes.length !== nextNodes.length) {
    return true;
  }

  for (let index = 0; index < nextNodes.length; index += 1) {
    if (previousNodes[index] !== nextNodes[index]) {
      return true;
    }
  }

  return false;
}

function createNodeByIdSelector(nodeId: string) {
  let previousNode: CanvasNode | null = null;

  return (state: CanvasGraphSnapshot): CanvasNode | null => {
    const nextNode = getNodeByIdMap(state.nodes).get(nodeId) ?? null;
    if (previousNode === nextNode) {
      return previousNode;
    }

    previousNode = nextNode;
    return previousNode;
  };
}

function createNodesByIdsSelector(nodeIds: readonly string[]) {
  let previousResult: Array<CanvasNode | undefined> | null = null;

  return (state: CanvasGraphSnapshot): Array<CanvasNode | undefined> => {
    if (nodeIds.length === 0) {
      return EMPTY_NODE_REFERENCES;
    }

    const nodeById = getNodeByIdMap(state.nodes);
    const nextNodes = nodeIds.map((nodeId) => nodeById.get(nodeId));
    if (!haveRelevantNodeReferencesChanged(previousResult, nextNodes)) {
      return previousResult ?? EMPTY_NODE_REFERENCES;
    }

    previousResult = nextNodes;
    return previousResult;
  };
}

function createNodesByTypesSelector(nodeTypes: readonly CanvasNode['type'][]) {
  let previousResult: CanvasNode[] | null = null;
  const nodeTypeSet = new Set(nodeTypes);

  return (state: CanvasGraphSnapshot): CanvasNode[] => {
    if (nodeTypes.length === 0) {
      return EMPTY_NODES;
    }

    const nextNodes = state.nodes.filter((node) => nodeTypeSet.has(node.type));
    if (!haveRelevantResolvedNodesChanged(previousResult, nextNodes)) {
      return previousResult ?? EMPTY_NODES;
    }

    previousResult = nextNodes;
    return previousResult;
  };
}

function createFirstNodeByTypeSelector(nodeType: CanvasNode['type']) {
  let previousNode: CanvasNode | null = null;

  return (state: CanvasGraphSnapshot): CanvasNode | null => {
    const nextNode = state.nodes.find((node) => node.type === nodeType) ?? null;
    if (previousNode === nextNode) {
      return previousNode;
    }

    previousNode = nextNode;
    return previousNode;
  };
}

function createIncomingSourceNodesSelector(nodeId: string) {
  let previousIncomingEdges: CanvasEdge[] | null = null;
  let previousSourceNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult = EMPTY_INCOMING_SOURCE_NODES;

  return (state: CanvasGraphSnapshot): CanvasIncomingSourceNode[] => {
    const incomingEdges = resolveIncomingEdges(state, nodeId);
    const sourceNodes = resolveSourceNodes(state, incomingEdges);
    const shouldRecompute = haveRelevantSourcesChanged(
      previousIncomingEdges,
      previousSourceNodes,
      incomingEdges,
      sourceNodes
    );

    if (!shouldRecompute) {
      return previousResult;
    }

    const nextItems: CanvasIncomingSourceNode[] = [];
    incomingEdges.forEach((edge, index) => {
      const sourceNode = sourceNodes[index];
      if (!sourceNode) {
        return;
      }

      nextItems.push({ edge, node: sourceNode });
    });

    previousIncomingEdges = incomingEdges;
    previousSourceNodes = sourceNodes;
    previousResult = nextItems.length > 0 ? nextItems : EMPTY_INCOMING_SOURCE_NODES;
    return previousResult;
  };
}

function createInputImagesSelector(nodeId: string) {
  let previousIncomingEdges: CanvasEdge[] | null = null;
  let previousSourceNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult = EMPTY_INPUT_IMAGES;

  return (state: CanvasGraphSnapshot): string[] => {
    const incomingEdges = resolveIncomingEdges(state, nodeId);
    const sourceNodes = resolveSourceNodes(state, incomingEdges);
    const shouldRecompute = haveRelevantSourcesChanged(
      previousIncomingEdges,
      previousSourceNodes,
      incomingEdges,
      sourceNodes
    );

    if (!shouldRecompute) {
      return previousResult;
    }

    const nextImages: string[] = [];
    const seenImages = new Set<string>();

    for (const sourceNode of sourceNodes) {
      if (!sourceNode) {
        continue;
      }

      for (const imageUrl of extractReferenceImageUrls(sourceNode)) {
        const normalizedImageUrl = imageUrl.trim();
        if (!normalizedImageUrl || seenImages.has(normalizedImageUrl)) {
          continue;
        }

        seenImages.add(normalizedImageUrl);
        nextImages.push(normalizedImageUrl);
      }
    }

    previousIncomingEdges = incomingEdges;
    previousSourceNodes = sourceNodes;
    previousResult = nextImages;
    return previousResult;
  };
}

function createConnectedReferenceImagesSelector(nodeId: string) {
  let previousIncomingEdges: CanvasEdge[] | null = null;
  let previousSourceNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult = EMPTY_CONNECTED_REFERENCE_IMAGES;

  return (state: CanvasGraphSnapshot): ConnectedReferenceImage[] => {
    const incomingEdges = resolveIncomingEdges(state, nodeId);
    const sourceNodes = resolveSourceNodes(state, incomingEdges);
    const shouldRecompute = haveRelevantSourcesChanged(
      previousIncomingEdges,
      previousSourceNodes,
      incomingEdges,
      sourceNodes
    );

    if (!shouldRecompute) {
      return previousResult;
    }

    const nextItems: ConnectedReferenceImage[] = [];
    const seenReferenceUrls = new Set<string>();

    incomingEdges.forEach((edge, index) => {
      const sourceNode = sourceNodes[index];
      if (!sourceNode) {
        return;
      }

      for (const item of extractReferenceVisuals(sourceNode)) {
        if (item.kind !== 'image') {
          continue;
        }

        const normalizedImageUrl = item.referenceUrl.trim();
        const normalizedPreviewImageUrl = item.previewImageUrl?.trim() ?? '';
        if (!normalizedImageUrl || seenReferenceUrls.has(normalizedImageUrl)) {
          continue;
        }

        seenReferenceUrls.add(normalizedImageUrl);
        nextItems.push({
          sourceEdgeId: edge.id,
          sourceNodeId: sourceNode.id,
          imageUrl: normalizedImageUrl,
          previewImageUrl: normalizedPreviewImageUrl || null,
        });
      }
    });

    previousIncomingEdges = incomingEdges;
    previousSourceNodes = sourceNodes;
    previousResult = nextItems;
    return previousResult;
  };
}

function createConnectedReferenceVisualsSelector(nodeId: string) {
  let previousIncomingEdges: CanvasEdge[] | null = null;
  let previousSourceNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult = EMPTY_CONNECTED_REFERENCE_VISUALS;

  return (state: CanvasGraphSnapshot): ConnectedReferenceVisual[] => {
    const incomingEdges = resolveIncomingEdges(state, nodeId);
    const sourceNodes = resolveSourceNodes(state, incomingEdges);
    const shouldRecompute = haveRelevantSourcesChanged(
      previousIncomingEdges,
      previousSourceNodes,
      incomingEdges,
      sourceNodes
    );

    if (!shouldRecompute) {
      return previousResult;
    }

    const nextItems: ConnectedReferenceVisual[] = [];
    const seenReferenceUrls = new Set<string>();

    incomingEdges.forEach((edge, index) => {
      const sourceNode = sourceNodes[index];
      if (!sourceNode) {
        return;
      }

      for (const item of extractReferenceVisuals(sourceNode)) {
        const normalizedReferenceUrl = item.referenceUrl.trim();
        const normalizedPreviewImageUrl = item.previewImageUrl?.trim() ?? '';
        if (!normalizedReferenceUrl || seenReferenceUrls.has(normalizedReferenceUrl)) {
          continue;
        }

        seenReferenceUrls.add(normalizedReferenceUrl);
        nextItems.push({
          sourceEdgeId: edge.id,
          sourceNodeId: sourceNode.id,
          kind: item.kind,
          referenceUrl: normalizedReferenceUrl,
          previewImageUrl: normalizedPreviewImageUrl || null,
          durationSeconds: item.durationSeconds ?? null,
          assetId: item.assetId ?? null,
          displayName: item.displayName ?? null,
          tokenAlias: item.tokenAlias ?? null,
        });
      }
    });

    previousIncomingEdges = incomingEdges;
    previousSourceNodes = sourceNodes;
    previousResult = nextItems;
    return previousResult;
  };
}

function createConnectedAudioReferencesSelector(nodeId: string) {
  let previousIncomingEdges: CanvasEdge[] | null = null;
  let previousSourceNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult = EMPTY_CONNECTED_AUDIO_REFERENCES;

  return (state: CanvasGraphSnapshot): ConnectedAudioReference[] => {
    const incomingEdges = resolveIncomingEdges(state, nodeId);
    const sourceNodes = resolveSourceNodes(state, incomingEdges);
    const shouldRecompute = haveRelevantSourcesChanged(
      previousIncomingEdges,
      previousSourceNodes,
      incomingEdges,
      sourceNodes
    );

    if (!shouldRecompute) {
      return previousResult;
    }

    const nextItems: ConnectedAudioReference[] = [];
    const seenAudioUrls = new Set<string>();

    incomingEdges.forEach((edge, index) => {
      const sourceNode = sourceNodes[index];
      if (!sourceNode) {
        return;
      }

      const audioReference = extractAudioReference(sourceNode);
      if (!audioReference || seenAudioUrls.has(audioReference.audioUrl)) {
        return;
      }

      seenAudioUrls.add(audioReference.audioUrl);
      nextItems.push({
        sourceEdgeId: edge.id,
        sourceNodeId: sourceNode.id,
        audioUrl: audioReference.audioUrl,
        displayName: audioReference.displayName,
        audioFileName: audioReference.audioFileName,
        mimeType: audioReference.mimeType,
        durationSeconds: audioReference.durationSeconds ?? null,
      });
    });

    previousIncomingEdges = incomingEdges;
    previousSourceNodes = sourceNodes;
    previousResult = nextItems;
    return previousResult;
  };
}

function createConnectedTextInputSelector(nodeId: string) {
  let previousIncomingEdges: CanvasEdge[] | null = null;
  let previousSourceNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult = EMPTY_CONNECTED_TEXT_INPUT;

  return (state: CanvasGraphSnapshot): CanvasConnectedTextInput => {
    const incomingEdges = resolveIncomingEdges(state, nodeId);
    const sourceNodes = resolveSourceNodes(state, incomingEdges);
    const shouldRecompute = haveRelevantSourcesChanged(
      previousIncomingEdges,
      previousSourceNodes,
      incomingEdges,
      sourceNodes
    );

    if (!shouldRecompute) {
      return previousResult;
    }

    const sourceTexts: string[] = [];
    let hasConnectedTextSource = false;

    for (const sourceNode of sourceNodes) {
      if (!isCanvasTextSourceNode(sourceNode)) {
        continue;
      }

      hasConnectedTextSource = true;
      const sourceText = resolveCanvasTextSourceNodeText(sourceNode);
      if (sourceText.length > 0) {
        sourceTexts.push(sourceText);
      }
    }

    const connectedText = sourceTexts.join('\n\n');
    previousIncomingEdges = incomingEdges;
    previousSourceNodes = sourceNodes;
    previousResult = hasConnectedTextSource || connectedText.length > 0
      ? {
          connectedText,
          hasConnectedTextSource,
          hasNonEmptyConnectedText: connectedText.trim().length > 0,
        }
      : EMPTY_CONNECTED_TEXT_INPUT;
    return previousResult;
  };
}

function createRelatedGraphSelector(nodeId: string) {
  let previousNodes: CanvasNode[] | null = null;
  let previousEdges: CanvasEdge[] | null = null;
  let previousResult: CanvasNodeGraphSnapshot = {
    nodes: EMPTY_NODES,
    edges: EMPTY_EDGES,
  };

  return (state: CanvasGraphSnapshot): CanvasNodeGraphSnapshot => {
    const relatedNodeIds = new Set<string>([nodeId]);
    const nextEdges = state.edges.filter((edge) => {
      const isRelated = edge.source === nodeId || edge.target === nodeId;
      if (isRelated) {
        relatedNodeIds.add(edge.source);
        relatedNodeIds.add(edge.target);
      }
      return isRelated;
    });

    const nextNodes = state.nodes.filter((node) => relatedNodeIds.has(node.id));
    if (
      previousNodes
      && previousEdges
      && haveRelevantResolvedNodesChanged(previousNodes, nextNodes) === false
      && previousEdges.length === nextEdges.length
      && previousEdges.every((edge, index) => edge === nextEdges[index])
    ) {
      return previousResult;
    }

    previousNodes = nextNodes;
    previousEdges = nextEdges;
    previousResult = {
      nodes: nextNodes.length > 0 ? nextNodes : EMPTY_NODES,
      edges: nextEdges.length > 0 ? nextEdges : EMPTY_EDGES,
    };
    return previousResult;
  };
}

function createSourceGraphSelector(nodeId: string) {
  let previousNodes: CanvasNode[] | null = null;
  let previousEdges: CanvasEdge[] | null = null;
  let previousResult: CanvasNodeGraphSnapshot = {
    nodes: EMPTY_NODES,
    edges: EMPTY_EDGES,
  };

  return (state: CanvasGraphSnapshot): CanvasNodeGraphSnapshot => {
    const relatedNodeIds = new Set<string>([nodeId]);
    const incomingEdges = state.edges.filter((edge) => {
      if (edge.target !== nodeId) {
        return false;
      }
      relatedNodeIds.add(edge.source);
      return true;
    });

    const connectedSourceNodes = state.nodes.filter((node) => relatedNodeIds.has(node.id));
    const selectedChapterIds = new Set<string>();
    for (const node of connectedSourceNodes) {
      if (node.id !== nodeId) {
        continue;
      }
      const value = (node.data as { selectedChapterIds?: unknown }).selectedChapterIds;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === 'string') {
            selectedChapterIds.add(item);
          }
        });
      }
    }

    const nextNodes = selectedChapterIds.size === 0
      ? connectedSourceNodes
      : state.nodes.filter((node) => relatedNodeIds.has(node.id) || selectedChapterIds.has(node.id));

    if (
      previousNodes
      && previousEdges
      && haveRelevantResolvedNodesChanged(previousNodes, nextNodes) === false
      && previousEdges.length === incomingEdges.length
      && previousEdges.every((edge, index) => edge === incomingEdges[index])
    ) {
      return previousResult;
    }

    previousNodes = nextNodes;
    previousEdges = incomingEdges;
    previousResult = {
      nodes: nextNodes.length > 0 ? nextNodes : EMPTY_NODES,
      edges: incomingEdges.length > 0 ? incomingEdges : EMPTY_EDGES,
    };
    return previousResult;
  };
}

function createChildNodesSelector(parentId: string) {
  let previousResult: CanvasNode[] | null = null;

  return (state: CanvasGraphSnapshot): CanvasNode[] => {
    const nextNodes = getChildNodesByParentIdMap(state.nodes).get(parentId) ?? EMPTY_NODES;
    if (!haveRelevantResolvedNodesChanged(previousResult, nextNodes)) {
      return previousResult ?? EMPTY_NODES;
    }

    previousResult = nextNodes.length > 0 ? nextNodes : EMPTY_NODES;
    return previousResult;
  };
}

function createParentNodeSelector(nodeId: string) {
  let previousNode: CanvasNode | null = null;
  let previousParent: CanvasNode | null = null;

  return (state: CanvasGraphSnapshot): CanvasNode | null => {
    const node = getNodeByIdMap(state.nodes).get(nodeId) ?? null;
    if (previousNode === node) {
      return previousParent;
    }

    previousNode = node;
    const parentId = typeof node?.parentId === 'string' ? node.parentId : '';
    previousParent = parentId ? getNodeByIdMap(state.nodes).get(parentId) ?? null : null;
    return previousParent;
  };
}

function createStoryboardProductionPlaceholderSelector(sourceNodeId: string) {
  let previousSourceEdges: CanvasEdge[] | null = null;
  let previousTargetNodes: Array<CanvasNode | undefined> | null = null;
  let previousResult: CanvasNode | null = null;

  return (state: CanvasGraphSnapshot): CanvasNode | null => {
    const sourceEdges = state.edges.filter((edge) => edge.source === sourceNodeId);
    const nodeById = getNodeByIdMap(state.nodes);
    const targetNodes = sourceEdges.map((edge) => nodeById.get(edge.target));

    if (!haveRelevantSourcesChanged(previousSourceEdges, previousTargetNodes, sourceEdges, targetNodes)) {
      return previousResult;
    }

    previousSourceEdges = sourceEdges;
    previousTargetNodes = targetNodes;
    previousResult = targetNodes.find((node) => (
      node?.type === CANVAS_NODE_TYPES.exportImage
      && (node.data as { isStoryboardProductionPlaceholder?: unknown }).isStoryboardProductionPlaceholder === true
    )) ?? null;
    return previousResult;
  };
}

export function useCanvasNodeInputImages(nodeId: string): string[] {
  const selector = useMemo(() => createInputImagesSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasNodeById(nodeId: string): CanvasNode | null {
  const selector = useMemo(() => createNodeByIdSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasNodesByIds(nodeIds: readonly string[]): Array<CanvasNode | undefined> {
  const selector = useMemo(() => createNodesByIdsSelector(nodeIds), [nodeIds]);
  return useCanvasStore(selector);
}

export function useCanvasNodesByTypes(nodeTypes: readonly CanvasNode['type'][]): CanvasNode[] {
  const selector = useMemo(() => createNodesByTypesSelector(nodeTypes), [nodeTypes]);
  return useCanvasStore(selector);
}

export function useCanvasFirstNodeByType(nodeType: CanvasNode['type']): CanvasNode | null {
  const selector = useMemo(() => createFirstNodeByTypeSelector(nodeType), [nodeType]);
  return useCanvasStore(selector);
}

export function useCanvasIncomingSourceNodes(nodeId: string): CanvasIncomingSourceNode[] {
  const selector = useMemo(() => createIncomingSourceNodesSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasConnectedReferenceImages(nodeId: string): ConnectedReferenceImage[] {
  const selector = useMemo(() => createConnectedReferenceImagesSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasConnectedReferenceVisuals(nodeId: string): ConnectedReferenceVisual[] {
  const selector = useMemo(() => createConnectedReferenceVisualsSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasConnectedAudioReferences(nodeId: string): ConnectedAudioReference[] {
  const selector = useMemo(() => createConnectedAudioReferencesSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasConnectedTextInput(nodeId: string): CanvasConnectedTextInput {
  const selector = useMemo(() => createConnectedTextInputSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasRelatedGraph(nodeId: string): CanvasNodeGraphSnapshot {
  const selector = useMemo(() => createRelatedGraphSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasSourceGraph(nodeId: string): CanvasNodeGraphSnapshot {
  const selector = useMemo(() => createSourceGraphSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasChildNodes(parentId: string): CanvasNode[] {
  const selector = useMemo(() => createChildNodesSelector(parentId), [parentId]);
  return useCanvasStore(selector);
}

export function useCanvasParentNode(nodeId: string): CanvasNode | null {
  const selector = useMemo(() => createParentNodeSelector(nodeId), [nodeId]);
  return useCanvasStore(selector);
}

export function useCanvasStoryboardProductionPlaceholder(sourceNodeId: string): CanvasNode | null {
  const selector = useMemo(
    () => createStoryboardProductionPlaceholderSelector(sourceNodeId),
    [sourceNodeId]
  );
  return useCanvasStore(selector);
}
