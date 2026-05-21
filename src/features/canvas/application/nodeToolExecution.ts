import type { TFunction } from 'i18next';

import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  NODE_TOOL_TYPES,
  isAudioNode,
  isExportImageNode,
  isImageEditNode,
  isPanorama360Node,
  isUploadNode,
  resolveSingleVideoConnectionSource,
  type CanvasNode,
  type NodeToolType,
} from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { getToolPlugin, type CanvasToolPlugin, type ToolOptions } from '@/features/canvas/tools';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { canvasToolProcessor } from './canvasServices';
import { resolveErrorContent } from './errorDialog';
import { prepareNodeImage, resolveReadableImageSource } from './imageData';
import { resolveMinEdgeFittedSize } from './imageNodeSizing';
import type { ToolProcessorResult } from './ports';

export interface NodeToolSourceAsset {
  mediaType: 'image' | 'video' | 'audio';
  sourceUrl: string | null;
  previewUrl?: string | null;
  aspectRatio?: string | null;
  duration?: number;
  fileName?: string | null;
}

interface ExecuteNodeToolParams {
  sourceNode: CanvasNode;
  toolType: NodeToolType;
  t: TFunction;
  options?: ToolOptions;
  plugin?: CanvasToolPlugin | null;
}

interface ApplyNodeToolResultParams {
  sourceNode: CanvasNode;
  toolType: NodeToolType;
  result: ToolProcessorResult;
  t: TFunction;
}

interface LocalizedNodeToolErrorContent {
  message: string;
  details?: string;
}

function resolveLocalizedExtractAudioErrorMessage(message: string, t: TFunction): string | null {
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) {
    return null;
  }

  if (
    normalizedMessage.includes('does not contain an audio track')
    || normalizedMessage.includes('video has no audio track')
    || normalizedMessage.includes('no audio track')
  ) {
    return t('toolDialog.videoHasNoAudioTrack');
  }

  if (
    normalizedMessage.includes('failed to extract audio')
    || normalizedMessage.includes('failed to start ffmpeg')
    || normalizedMessage.includes('failed to start ffprobe')
    || normalizedMessage.includes('bundled ffmpeg')
    || normalizedMessage.includes('bundled ffprobe')
    || normalizedMessage.includes('ffmpeg failed')
    || normalizedMessage.includes('ffprobe failed')
  ) {
    return t('toolDialog.extractAudioFailed');
  }

  return null;
}

export function resolveNodeToolErrorContent(
  error: unknown,
  toolType: NodeToolType,
  t: TFunction
): LocalizedNodeToolErrorContent {
  const { message, details } = resolveErrorContent(error, t('toolDialog.processFailed'));

  if (toolType === NODE_TOOL_TYPES.extractAudio) {
    const localizedMessage = resolveLocalizedExtractAudioErrorMessage(message, t);
    if (localizedMessage) {
      return {
        message: localizedMessage,
        details,
      };
    }
  }

  return {
    message,
    details,
  };
}

export function resolveNodeToolSourceAsset(node: CanvasNode | null | undefined): NodeToolSourceAsset | null {
  if (!node) {
    return null;
  }

  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node)
  ) {
    return {
      mediaType: 'image',
      sourceUrl: node.data.imageUrl,
      previewUrl: node.data.previewImageUrl ?? null,
    };
  }

  const videoSource = resolveSingleVideoConnectionSource(node);
  if (videoSource) {
    return {
      mediaType: 'video',
      sourceUrl: videoSource.videoUrl,
      previewUrl: videoSource.previewImageUrl ?? null,
      aspectRatio: videoSource.aspectRatio,
      duration: typeof videoSource.duration === 'number' ? videoSource.duration : undefined,
      fileName: videoSource.videoFileName ?? null,
    };
  }

  if (isAudioNode(node)) {
    return {
      mediaType: 'audio',
      sourceUrl: node.data.audioUrl,
      previewUrl: node.data.previewImageUrl ?? null,
      duration: typeof node.data.duration === 'number' ? node.data.duration : undefined,
      fileName: node.data.audioFileName ?? null,
    };
  }

  return null;
}

async function resolveProcessSourceUrl(
  sourceNode: CanvasNode,
  plugin: CanvasToolPlugin
): Promise<string | null> {
  const sourceAsset = resolveNodeToolSourceAsset(sourceNode);
  if (!sourceAsset) {
    return null;
  }

  if (plugin.editor === 'split') {
    const splitPrimarySource = sourceAsset.mediaType === 'image'
      ? sourceAsset.sourceUrl?.trim() || sourceAsset.previewUrl?.trim() || ''
      : '';
    const splitFallbackSource = sourceAsset.mediaType === 'image'
      && sourceAsset.previewUrl?.trim()
      && sourceAsset.previewUrl.trim() !== splitPrimarySource
      ? sourceAsset.previewUrl.trim()
      : null;

    if (!splitPrimarySource) {
      return null;
    }

    return await resolveReadableImageSource(splitPrimarySource, splitFallbackSource);
  }

  return sourceAsset.sourceUrl?.trim() || null;
}

function resolveResultNodeTitle(toolType: NodeToolType, t: TFunction): string {
  if (toolType === NODE_TOOL_TYPES.crop) {
    return t('toolDialog.cropResultTitle');
  }
  if (toolType === NODE_TOOL_TYPES.annotate) {
    return t('toolDialog.annotateResultTitle');
  }
  if (toolType === NODE_TOOL_TYPES.extractAudio) {
    return t('toolDialog.extractAudioResultTitle');
  }
  return EXPORT_RESULT_DISPLAY_NAME.generic;
}

export async function applyNodeToolResult({
  sourceNode,
  toolType,
  result,
  t,
}: ApplyNodeToolResultParams): Promise<string | null> {
  const {
    addNode,
    addDerivedExportNode,
    addStoryboardSplitResultNode,
    addEdge,
    findNodePosition,
  } = useCanvasStore.getState();

  if (result.storyboardFrames && result.rows && result.cols) {
    const createdNodeId = addStoryboardSplitResultNode(
      sourceNode.id,
      result.rows,
      result.cols,
      result.storyboardFrames,
      result.frameAspectRatio
    );
    if (createdNodeId) {
      addEdge(sourceNode.id, createdNodeId);
    }
    return createdNodeId;
  }

  if (result.outputImageUrl) {
    const prepared = await prepareNodeImage(
      result.outputImageUrl,
      undefined,
      undefined,
      useSettingsStore.getState().canvasOverviewThumbnailMaxDimension
    );
    const createdNodeId = addDerivedExportNode(
      sourceNode.id,
      prepared.imageUrl,
      prepared.aspectRatio,
      prepared.previewImageUrl,
      {
        thumbnailUrl: prepared.thumbnailImageUrl,
        thumbnailMaxDimension: prepared.thumbnailMaxDimension,
        defaultTitle: resolveResultNodeTitle(toolType, t),
        resultKind: 'generic',
        aspectRatioStrategy: 'provided',
        sizeStrategy: 'autoMinEdge',
      }
    );
    if (createdNodeId) {
      addEdge(sourceNode.id, createdNodeId);
    }
    return createdNodeId;
  }

  if (result.outputVideoUrl) {
    const aspectRatio = result.aspectRatio?.trim() || '16:9';
    const mediaSize = resolveMinEdgeFittedSize(aspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });
    const createdNodeId = addNode(
      CANVAS_NODE_TYPES.video,
      findNodePosition(sourceNode.id, mediaSize.width, mediaSize.height + 54),
      {
        videoUrl: result.outputVideoUrl,
        previewImageUrl: result.previewImageUrl ?? null,
        videoFileName: result.outputFileName ?? undefined,
        aspectRatio,
        duration: result.duration,
        displayName: t('toolDialog.trimResultTitle'),
      },
      { inheritParentFromNodeId: sourceNode.id }
    );
    if (createdNodeId) {
      addEdge(sourceNode.id, createdNodeId);
    }
    return createdNodeId;
  }

  if (result.outputAudioUrl) {
    const createdNodeId = addNode(
      CANVAS_NODE_TYPES.audio,
      findNodePosition(sourceNode.id, AUDIO_NODE_DEFAULT_WIDTH, AUDIO_NODE_DEFAULT_HEIGHT),
      {
        audioUrl: result.outputAudioUrl,
        previewImageUrl: result.previewImageUrl ?? null,
        audioFileName: result.outputFileName ?? undefined,
        duration: result.duration,
        mimeType: result.mimeType,
        displayName: resolveResultNodeTitle(toolType, t),
      },
      { inheritParentFromNodeId: sourceNode.id }
    );
    if (createdNodeId) {
      addEdge(sourceNode.id, createdNodeId);
    }
    return createdNodeId;
  }

  return null;
}

export async function executeNodeToolAndApplyResult({
  sourceNode,
  toolType,
  t,
  options,
  plugin,
}: ExecuteNodeToolParams): Promise<ToolProcessorResult> {
  const activePlugin = plugin ?? getToolPlugin(toolType);
  if (!activePlugin) {
    throw new Error(t('toolDialog.processFailed'));
  }

  const processSourceUrl = await resolveProcessSourceUrl(sourceNode, activePlugin);
  if (!processSourceUrl) {
    throw new Error(t('toolDialog.noProcessableImage'));
  }

  const result = await activePlugin.execute(
    processSourceUrl,
    options ?? activePlugin.createInitialOptions(sourceNode),
    {
      processTool: (nextToolType, sourceUrl, toolOptions) =>
        canvasToolProcessor.process(nextToolType, sourceUrl, toolOptions),
    }
  );

  await applyNodeToolResult({
    sourceNode,
    toolType,
    result,
    t,
  });

  return result;
}
