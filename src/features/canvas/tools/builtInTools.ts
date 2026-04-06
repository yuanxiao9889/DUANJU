import {
  NODE_TOOL_TYPES,
  isAudioNode,
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
  isVideoNode,
  type CanvasNode,
} from '../domain/canvasNodes';
import { stringifyAnnotationItems } from './annotation';
import type { CanvasToolPlugin, ToolOptions } from './types';

function supportsImageSourceNode(node: CanvasNode): boolean {
  return isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node);
}

export const cropToolPlugin: CanvasToolPlugin = {
  type: NODE_TOOL_TYPES.crop,
  label: '裁剪',
  icon: 'crop',
  editor: 'crop',
  supportsNode: (node) => {
    if (supportsImageSourceNode(node)) {
      return Boolean(node.data.imageUrl);
    }

    if (isVideoNode(node)) {
      return Boolean(node.data.videoUrl);
    }

    if (isAudioNode(node)) {
      return Boolean(node.data.audioUrl);
    }

    return false;
  },
  createInitialOptions: (node) => {
    if (isVideoNode(node)) {
      return {
        mediaType: 'video',
        startTime: 0,
        endTime: typeof node.data.duration === 'number' ? node.data.duration : 0,
        duration: typeof node.data.duration === 'number' ? node.data.duration : 0,
        fileName: typeof node.data.videoFileName === 'string' ? node.data.videoFileName : '',
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
      label: '目标比例',
      type: 'select',
      options: [
        { label: '自由', value: 'free' },
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
  label: '标注',
  icon: 'annotate',
  editor: 'annotate',
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
  label: '切割',
  icon: 'split',
  editor: 'split',
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

export const builtInToolPlugins: CanvasToolPlugin[] = [
  cropToolPlugin,
  annotateToolPlugin,
  splitStoryboardToolPlugin,
];
