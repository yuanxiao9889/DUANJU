import {
  NODE_TOOL_TYPES,
  isAudioNode,
  isExportImageNode,
  isImageEditNode,
  isPanorama360Node,
  isUploadNode,
  resolveSingleVideoConnectionSource,
  type CanvasNode,
} from '../domain/canvasNodes';
import { stringifyAnnotationItems } from './annotation';
import type { CanvasToolPlugin, ToolOptions } from './types';

function supportsImageSourceNode(node: CanvasNode): boolean {
  return isUploadNode(node)
    || isImageEditNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node);
}

export const cropToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.crop,
  label: 'Crop',
  icon: 'crop',
  editor: 'crop',
  executionMode: 'dialog',
  supportsNode: (node) => {
    if (supportsImageSourceNode(node)) {
      return Boolean(node.data.imageUrl);
    }

    if (resolveSingleVideoConnectionSource(node)) {
      return true;
    }

    if (isAudioNode(node)) {
      return Boolean(node.data.audioUrl);
    }

    return false;
  },
  createInitialOptions: (node) => {
    const videoSource = resolveSingleVideoConnectionSource(node);
    if (videoSource) {
      return {
        mediaType: 'video',
        startTime: 0,
        endTime: typeof videoSource.duration === 'number' ? videoSource.duration : 0,
        duration: typeof videoSource.duration === 'number' ? videoSource.duration : 0,
        fileName: typeof videoSource.videoFileName === 'string' ? videoSource.videoFileName : '',
        aspectRatio: videoSource.aspectRatio,
        previewImageUrl: videoSource.previewImageUrl ?? '',
      } as ToolOptions;
    }

    if (isAudioNode(node)) {
      return {
        mediaType: 'audio',
        startTime: 0,
        endTime: typeof node.data.duration === 'number' ? node.data.duration : 0,
        duration: typeof node.data.duration === 'number' ? node.data.duration : 0,
        fileName: typeof node.data.audioFileName === 'string' ? node.data.audioFileName : '',
      } as ToolOptions;
    }

    return {
      mediaType: 'image',
      aspectRatio: 'free',
      customAspectRatio: '',
    } as ToolOptions;
  },
  fields: [
    {
      key: 'aspectRatio',
      label: 'Aspect Ratio',
      type: 'select',
      options: [
        { label: 'Free', value: 'free' },
        { label: '1:1', value: '1:1' },
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
      ],
    },
  ],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.crop, sourceImageUrl, options),
};

export const annotateToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.annotate,
  label: 'Annotate',
  icon: 'annotate',
  editor: 'annotate',
  executionMode: 'dialog',
  supportsNode: (node) => supportsImageSourceNode(node) && Boolean(node.data.imageUrl),
  createInitialOptions: () => ({
    color: '#ff4d4f',
    lineWidthPercent: 0.4,
    fontSizePercent: 10,
    annotations: stringifyAnnotationItems([]),
  }),
  fields: [],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.annotate, sourceImageUrl, options),
};

export const splitStoryboardToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.splitStoryboard,
  label: 'Split',
  icon: 'split',
  editor: 'split',
  executionMode: 'dialog',
  supportsNode: (node) => supportsImageSourceNode(node) && Boolean(node.data.imageUrl),
  createInitialOptions: () => ({
    rows: 3,
    cols: 3,
    lineThicknessPercent: 0.5,
  }),
  fields: [],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.splitStoryboard, sourceImageUrl, options),
};

export const extractAudioToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.extractAudio,
  label: 'Extract Audio',
  icon: 'audio',
  editor: 'form',
  executionMode: 'instant',
  supportsNode: (node) => Boolean(resolveSingleVideoConnectionSource(node)),
  createInitialOptions: (node) => {
    const videoSource = resolveSingleVideoConnectionSource(node);
    return {
      mediaType: 'video',
      duration: typeof videoSource?.duration === 'number' ? videoSource.duration : 0,
      fileName: typeof videoSource?.videoFileName === 'string' ? videoSource.videoFileName : '',
    } as ToolOptions;
  },
  fields: [],
  execute: async (sourceImageUrl, options, context) =>
    await context.processTool(NODE_TOOL_TYPES.extractAudio, sourceImageUrl, options),
};

export const builtInToolPlugins: CanvasToolPlugin[] = [
  cropToolPlugin,
  annotateToolPlugin,
  splitStoryboardToolPlugin,
  // Temporarily disabled: video audio extraction is not exposed in the canvas UI.
];
