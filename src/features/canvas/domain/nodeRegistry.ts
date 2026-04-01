import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  JIMENG_ASPECT_RATIOS,
  JIMENG_DURATION_SECONDS,
  JIMENG_IMAGE_MODEL_VERSIONS,
  JIMENG_IMAGE_RESOLUTION_TYPES,
  type ImageSize,
  JIMENG_REFERENCE_MODES,
  JIMENG_VIDEO_MODEL_IDS,
  JIMENG_VIDEO_RESOLUTIONS,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeData,
  type GroupNodeData,
  type ImageEditNodeData,
  type JimengImageNodeData,
  type JimengImageResultNodeData,
  type JimengNodeData,
  type JimengVideoResultNodeData,
  type StoryboardSplitNodeData,
  type StoryboardSplitResultNodeData,
  type StoryboardGenNodeData,
  type TextAnnotationNodeData,
  type UploadImageNodeData,
  type AudioNodeData,
  type VideoNodeData,
  type ScriptRootNodeData,
  type ScriptChapterNodeData,
  type ScriptCharacterNodeData,
  type ScriptLocationNodeData,
  type ScriptItemNodeData,
  type ScriptPlotPointNodeData,
  type ScriptWorldviewNodeData,
  createDefaultSceneCard,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { DEFAULT_IMAGE_MODEL_ID } from '../models';

export type MenuIconKey = 'upload' | 'sparkles' | 'layout' | 'text' | 'video' | 'audio';
export type NodeMenuProjectType = 'storyboard' | 'script';

export interface CanvasNodeCapabilities {
  toolbar: boolean;
  promptInput: boolean;
}

export interface CanvasNodeConnectivity {
  sourceHandle: boolean;
  targetHandle: boolean;
  branchHandle?: boolean;
  supplementHandle?: boolean;
  connectMenu: {
    fromSource: boolean;
    fromTarget: boolean;
    fromBranch?: boolean;
    fromSupplement?: boolean;
  };
}

export interface CanvasNodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: CanvasNodeType;
  menuLabelKey: string;
  menuIcon: MenuIconKey;
  visibleInMenu: boolean;
  menuProjectTypes: NodeMenuProjectType[];
  capabilities: CanvasNodeCapabilities;
  connectivity: CanvasNodeConnectivity;
  createDefaultData: () => TData;
}

const uploadNodeDefinition: CanvasNodeDefinition<UploadImageNodeData> = {
  type: CANVAS_NODE_TYPES.upload,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upload],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '1:1',
    isSizeManuallyAdjusted: false,
    sourceFileName: null,
  }),
};

const imageEditNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.imageEdit,
  menuLabelKey: 'node.menu.aiImageGeneration',
  menuIcon: 'sparkles',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageEdit],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    prompt: '',
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    extraParams: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
  }),
};

const jimengNodeDefinition: CanvasNodeDefinition<JimengNodeData> = {
  type: CANVAS_NODE_TYPES.jimeng,
  menuLabelKey: 'node.menu.jimengVideo',
  menuIcon: 'sparkles',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimeng],
    prompt: '',
    referenceImageOrder: [],
    model: JIMENG_VIDEO_MODEL_IDS[1],
    referenceMode: JIMENG_REFERENCE_MODES[0],
    aspectRatio: JIMENG_ASPECT_RATIOS[1],
    durationSeconds: JIMENG_DURATION_SECONDS[1],
    videoResolution: JIMENG_VIDEO_RESOLUTIONS[0],
    suggestedDurationSeconds: null,
    suggestedDurationEstimatedSeconds: null,
    suggestedDurationExceedsLimit: false,
    suggestedDurationReason: null,
    isSubmitting: false,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const exportImageNodeDefinition: CanvasNodeDefinition<ExportImageNodeData> = {
  type: CANVAS_NODE_TYPES.exportImage,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportImage],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    resultKind: 'generic',
  }),
};

const groupNodeDefinition: CanvasNodeDefinition<GroupNodeData> = {
  type: CANVAS_NODE_TYPES.group,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.group],
    label: '组',
  }),
};

const textAnnotationNodeDefinition: CanvasNodeDefinition<TextAnnotationNodeData> = {
  type: CANVAS_NODE_TYPES.textAnnotation,
  menuLabelKey: 'node.menu.textAnnotation',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation],
    content: '',
  }),
};

const storyboardSplitDefinition: CanvasNodeDefinition<StoryboardSplitNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplit,
  menuLabelKey: 'node.menu.storyboardCompose',
  menuIcon: 'layout',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplit],
    sourceNodeId: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
    exportOptions: {
      showFrameIndex: false,
      showFrameNote: false,
      notePlacement: 'overlay',
      imageFit: 'cover',
      frameIndexPrefix: 'S',
      cellGap: 8,
      outerPadding: 0,
      fontSize: 4,
      backgroundColor: '#0f1115',
      textColor: '#f8fafc',
    },
  }),
};

const storyboardSplitResultDefinition: CanvasNodeDefinition<StoryboardSplitResultNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplitResult,
  menuLabelKey: 'node.menu.storyboardSplitResult',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplitResult],
    sourceNodeId: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
  }),
};

const storyboardGenNodeDefinition: CanvasNodeDefinition<StoryboardGenNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardGen,
  menuLabelKey: 'node.menu.storyboardGen',
  menuIcon: 'sparkles',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardGen],
    gridRows: 2,
    gridCols: 2,
    frames: [],
    ratioControlMode: 'cell',
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    extraParams: {},
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
  }),
};

const videoNodeDefinition: CanvasNodeDefinition<VideoNodeData> = {
  type: CANVAS_NODE_TYPES.video,
  menuLabelKey: 'node.menu.videoNode',
  menuIcon: 'video',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.video],
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: '16:9',
    isSizeManuallyAdjusted: false,
  }),
};

const jimengImageNodeDefinition: CanvasNodeDefinition<JimengImageNodeData> = {
  type: CANVAS_NODE_TYPES.jimengImage,
  menuLabelKey: 'node.menu.jimengImage',
  menuIcon: 'sparkles',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimengImage],
    prompt: '',
    modelVersion: JIMENG_IMAGE_MODEL_VERSIONS[6],
    aspectRatio: JIMENG_ASPECT_RATIOS[3],
    resolutionType: JIMENG_IMAGE_RESOLUTION_TYPES[1],
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 90000,
    lastGeneratedAt: null,
    lastError: null,
    resultImages: [],
  }),
};

const jimengImageResultNodeDefinition: CanvasNodeDefinition<JimengImageResultNodeData> = {
  type: CANVAS_NODE_TYPES.jimengImageResult,
  menuLabelKey: 'node.menu.jimengImageResult',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimengImageResult],
    sourceNodeId: null,
    submitIds: [],
    aspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    resultImages: [],
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 90000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const jimengVideoResultNodeDefinition: CanvasNodeDefinition<JimengVideoResultNodeData> = {
  type: CANVAS_NODE_TYPES.jimengVideoResult,
  menuLabelKey: 'node.menu.jimengVideoResult',
  menuIcon: 'video',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimengVideoResult],
    sourceNodeId: null,
    submitId: null,
    sourceUrl: null,
    posterSourceUrl: null,
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: '16:9',
    duration: undefined,
    width: undefined,
    height: undefined,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 90000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const audioNodeDefinition: CanvasNodeDefinition<AudioNodeData> = {
  type: CANVAS_NODE_TYPES.audio,
  menuLabelKey: 'node.menu.audioNode',
  menuIcon: 'audio',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.audio],
    audioUrl: null,
    previewImageUrl: null,
    audioFileName: null,
    duration: undefined,
    mimeType: null,
  }),
};

const scriptRootNodeDefinition: CanvasNodeDefinition<ScriptRootNodeData> = {
  type: CANVAS_NODE_TYPES.scriptRoot,
  menuLabelKey: 'node.menu.scriptRoot',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptRoot] || '剧本',
    title: '',
    genre: '',
    totalChapters: 0,
    premise: '',
    theme: '',
    protagonist: '',
    want: '',
    need: '',
    stakes: '',
    tone: '',
    directorVision: '',
    beats: [],
  }),
};

const scriptChapterNodeDefinition: CanvasNodeDefinition<ScriptChapterNodeData> = {
  type: CANVAS_NODE_TYPES.scriptChapter,
  menuLabelKey: 'node.menu.scriptChapter',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    supplementHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: true,
      fromSupplement: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptChapter] || '章节',
    chapterNumber: 1,
    title: '',
    content: '',
    summary: '',
    chapterPurpose: '',
    chapterQuestion: '',
    sceneHeadings: [],
    scenes: [createDefaultSceneCard(0)],
    characters: [],
    locations: [],
    items: [],
    emotionalShift: '',
    isBranchPoint: false,
    branchType: 'main',
    tables: [],
    plotPoints: [],
  }),
};

const scriptCharacterNodeDefinition: CanvasNodeDefinition<ScriptCharacterNodeData> = {
  type: CANVAS_NODE_TYPES.scriptCharacter,
  menuLabelKey: 'node.menu.scriptCharacter',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptCharacter] || '角色',
    name: '',
    description: '',
    personality: '',
    appearance: '',
    statusUpdates: [],
    relationships: [],
  }),
};

const scriptLocationNodeDefinition: CanvasNodeDefinition<ScriptLocationNodeData> = {
  type: CANVAS_NODE_TYPES.scriptLocation,
  menuLabelKey: 'node.menu.scriptLocation',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptLocation] || '场景',
    name: '',
    description: '',
    appearances: [],
  }),
};

const scriptItemNodeDefinition: CanvasNodeDefinition<ScriptItemNodeData> = {
  type: CANVAS_NODE_TYPES.scriptItem,
  menuLabelKey: 'node.menu.scriptItem',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptItem] || '道具',
    name: '',
    description: '',
    appearances: [],
  }),
};

const scriptPlotPointNodeDefinition: CanvasNodeDefinition<ScriptPlotPointNodeData> = {
  type: CANVAS_NODE_TYPES.scriptPlotPoint,
  menuLabelKey: 'node.menu.scriptPlotPoint',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptPlotPoint] || '情节点',
    pointType: 'setup',
    description: '',
  }),
};

const scriptWorldviewNodeDefinition: CanvasNodeDefinition<ScriptWorldviewNodeData> = {
  type: CANVAS_NODE_TYPES.scriptWorldview,
  menuLabelKey: 'node.menu.scriptWorldview',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptWorldview] || '世界观',
    worldviewName: '',
    description: '',
    era: '',
    technology: '',
    magic: '',
    society: '',
    geography: '',
    rules: [],
  }),
};

export const canvasNodeDefinitions: Record<CanvasNodeType, CanvasNodeDefinition> = {
  [CANVAS_NODE_TYPES.upload]: uploadNodeDefinition,
  [CANVAS_NODE_TYPES.imageEdit]: imageEditNodeDefinition,
  [CANVAS_NODE_TYPES.jimeng]: jimengNodeDefinition,
  [CANVAS_NODE_TYPES.jimengImage]: jimengImageNodeDefinition,
  [CANVAS_NODE_TYPES.jimengImageResult]: jimengImageResultNodeDefinition,
  [CANVAS_NODE_TYPES.jimengVideoResult]: jimengVideoResultNodeDefinition,
  [CANVAS_NODE_TYPES.exportImage]: exportImageNodeDefinition,
  [CANVAS_NODE_TYPES.textAnnotation]: textAnnotationNodeDefinition,
  [CANVAS_NODE_TYPES.group]: groupNodeDefinition,
  [CANVAS_NODE_TYPES.storyboardSplit]: storyboardSplitDefinition,
  [CANVAS_NODE_TYPES.storyboardSplitResult]: storyboardSplitResultDefinition,
  [CANVAS_NODE_TYPES.storyboardGen]: storyboardGenNodeDefinition,
  [CANVAS_NODE_TYPES.video]: videoNodeDefinition,
  [CANVAS_NODE_TYPES.audio]: audioNodeDefinition,
  [CANVAS_NODE_TYPES.scriptRoot]: scriptRootNodeDefinition,
  [CANVAS_NODE_TYPES.scriptChapter]: scriptChapterNodeDefinition,
  [CANVAS_NODE_TYPES.scriptCharacter]: scriptCharacterNodeDefinition,
  [CANVAS_NODE_TYPES.scriptLocation]: scriptLocationNodeDefinition,
  [CANVAS_NODE_TYPES.scriptItem]: scriptItemNodeDefinition,
  [CANVAS_NODE_TYPES.scriptPlotPoint]: scriptPlotPointNodeDefinition,
  [CANVAS_NODE_TYPES.scriptWorldview]: scriptWorldviewNodeDefinition,
};

export function getNodeDefinition(type: CanvasNodeType): CanvasNodeDefinition {
  return canvasNodeDefinitions[type];
}

export function isNodeTypeAvailableInProject(
  type: CanvasNodeType,
  projectType: NodeMenuProjectType = 'storyboard'
): boolean {
  return canvasNodeDefinitions[type].menuProjectTypes.includes(projectType);
}

export function getMenuNodeDefinitions(
  projectType: NodeMenuProjectType = 'storyboard'
): CanvasNodeDefinition[] {
  return Object.values(canvasNodeDefinitions).filter((definition) =>
    definition.visibleInMenu && definition.menuProjectTypes.includes(projectType)
  );
}

export function nodeHasSourceHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.sourceHandle;
}

export function nodeHasTargetHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.targetHandle;
}

export function getConnectMenuNodeTypes(
  handleType: 'source' | 'target',
  projectType: NodeMenuProjectType = 'storyboard'
): CanvasNodeType[] {
  const fromSource = handleType === 'source';
  return Object.values(canvasNodeDefinitions)
    .filter((definition) => definition.menuProjectTypes.includes(projectType))
    .filter((definition) => (fromSource
      ? definition.connectivity.connectMenu.fromSource
      : definition.connectivity.connectMenu.fromTarget))
    .filter((definition) => (fromSource
      ? definition.connectivity.targetHandle
      : definition.connectivity.sourceHandle))
    .map((definition) => definition.type);
}
