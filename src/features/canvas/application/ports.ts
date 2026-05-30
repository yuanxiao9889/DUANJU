import type { XYPosition } from '@xyflow/react';

import type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  NodeToolType,
  StoryboardFrameItem,
} from '../domain/canvasNodes';
import type {
  CanvasNodeDefinition,
  NodeMenuAvailabilityOptions,
  NodeMenuProjectType,
} from '../domain/nodeRegistry';

export interface IdGenerator {
  next: () => string;
}

export interface NodeCatalog {
  getDefinition: (type: CanvasNodeType) => CanvasNodeDefinition;
  getMenuDefinitions: (
    projectType?: NodeMenuProjectType,
    options?: NodeMenuAvailabilityOptions
  ) => CanvasNodeDefinition[];
}

export interface NodeFactory {
  createNode: (
    type: CanvasNodeType,
    position: XYPosition,
    data?: Partial<CanvasNodeData>
  ) => CanvasNode;
}

export interface GraphImageResolver {
  collectInputImages: (nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]) => string[];
}

export interface GenerateImagePayload {
  prompt: string;
  model: string;
  size: string;
  aspectRatio: string;
  referenceImages?: string[];
  extraParams?: Record<string, unknown>;
  submissionSource?: 'commerceBatchGenerate';
}

export interface ReferenceImageOptimizationItem {
  source: string;
  optimizedSource: string;
  originalFormat: string;
  outputFormat: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  originalBytes: number;
  outputBytes: number;
  resized: boolean;
  transparent: boolean;
}

export interface ReferenceImageOptimizationSummary {
  applied: boolean;
  inputCount: number;
  totalBeforeBytes?: number;
  totalAfterBytes?: number;
  items: ReferenceImageOptimizationItem[];
}

export interface ResolutionDowngradeSummary {
  from: string;
  to: string;
  reason: 'manyReferenceImages';
}

export interface ResolvedGenerateImagePayload extends GenerateImagePayload {
  originalSize?: string;
  effectiveSize: string;
  referenceImages?: string[];
  referenceImageOptimization?: ReferenceImageOptimizationSummary;
  resolutionDowngrade?: ResolutionDowngradeSummary;
}

export interface AiGateway {
  setApiKey: (provider: string, apiKey: string) => Promise<void>;
  resolveGenerateImagePayload: (payload: GenerateImagePayload) => Promise<ResolvedGenerateImagePayload>;
  generateImage: (payload: GenerateImagePayload) => Promise<string>;
  submitGenerateImageJob: (payload: GenerateImagePayload) => Promise<string>;
  getGenerateImageJob: (jobId: string, options?: { forceRefresh?: boolean }) => Promise<{
    job_id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'not_found';
    provider_id?: string | null;
    external_task_id?: string | null;
    result?: string | null;
    error?: string | null;
  }>;
}

export interface ImageSplitGateway {
  split: (
    imageSource: string,
    rows: number,
    cols: number,
    lineThickness: number,
    colRatios?: number[],
    rowRatios?: number[]
  ) => Promise<string[]>;
}

export interface ToolProcessorResult {
  outputImageUrl?: string;
  outputVideoUrl?: string;
  outputAudioUrl?: string;
  previewImageUrl?: string | null;
  aspectRatio?: string;
  duration?: number;
  mimeType?: string | null;
  outputFileName?: string | null;
  storyboardFrames?: StoryboardFrameItem[];
  rows?: number;
  cols?: number;
  frameAspectRatio?: string;
}

export interface ToolProcessor {
  process: (
    toolType: NodeToolType,
    sourceImageUrl: string,
    options: Record<string, unknown>
  ) => Promise<ToolProcessorResult>;
}

export interface CanvasEventMap {
  'tool-dialog/open': {
    nodeId: string;
    toolType: NodeToolType;
  };
  'tool-dialog/close': undefined;
  'storyboard-asset-expand/open': {
    nodeId: string;
  };
  'smart-director-storyboard-transfer/open': {
    nodeId: string;
  };
  'smart-director-storyboard-result-choice/open': {
    nodeId: string;
    onResolve: (choice: 'reuse' | 'new' | null) => void;
  };
  'canvas-selection-transfer/open': {
    nodeIds: string[];
  };
  'audio-node/open-save-preset': {
    nodeId: string;
  };
  'upload-node/reupload': {
    nodeId: string;
  };
  'upload-node/paste-image': {
    nodeId: string;
    file: File;
  };
  'image-edit/submit-generate': {
    nodeId: string;
    onSettled?: (result: { ok: boolean; error?: string | null }) => void;
  };
  'image-edit/optimize-prompt': {
    nodeId: string;
    onSettled?: (result: { ok: boolean; error?: string | null }) => void;
  };
}

export interface CanvasEventBus {
  publish: <TType extends keyof CanvasEventMap>(
    type: TType,
    payload: CanvasEventMap[TType]
  ) => void;
  subscribe: <TType extends keyof CanvasEventMap>(
    type: TType,
    handler: (payload: CanvasEventMap[TType]) => void
  ) => () => void;
}
