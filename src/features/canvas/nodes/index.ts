import { Suspense, createElement, lazy, type ComponentType } from 'react';
import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import {
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import { CanvasOverviewNode } from './CanvasOverviewNode';
import { GroupNode } from './GroupNode';
import { LegacyNode } from './LegacyNode';

type CanvasNodeComponent = ComponentType<any>;

function createLazyNode(
  loader: () => Promise<{ default: CanvasNodeComponent }>
): CanvasNodeComponent {
  const LazyNode = lazy(loader);
  return function LazyCanvasNode(props: NodeProps) {
    return createElement(
      Suspense,
      {
        fallback: createElement(CanvasNodeLoadingFallback, {
          selected: props.selected,
          type: props.type,
        }),
      },
      createElement(LazyNode, props)
    );
  };
}

function isCanvasNodeType(value: string | undefined): value is CanvasNodeType {
  return Boolean(value && (Object.values(CANVAS_NODE_TYPES) as string[]).includes(value));
}

function CanvasNodeLoadingFallback({
  selected,
  type,
}: {
  selected?: boolean;
  type?: string;
}) {
  const nodeType = isCanvasNodeType(type) ? type : null;
  const hasSourceHandle = nodeType ? nodeHasSourceHandle(nodeType) : true;
  const hasTargetHandle = nodeType ? nodeHasTargetHandle(nodeType) : true;

  return createElement(
    'div',
    {
      className: 'relative',
    },
    hasTargetHandle
      ? createElement(Handle, {
          id: 'target',
          type: 'target',
          position: Position.Left,
          className: '!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-slate-400',
        })
      : null,
    hasSourceHandle
      ? createElement(Handle, {
          id: 'source',
          type: 'source',
          position: Position.Right,
          className: '!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-slate-400',
        })
      : null,
    createElement(
      'div',
      {
        className: `min-h-[180px] min-w-[260px] rounded-[18px] border bg-surface-dark/88 shadow-[0_12px_36px_rgba(0,0,0,0.2)] ${
          selected ? 'border-accent/55' : 'border-border-dark/70'
        }`,
      },
      createElement(
        'div',
        {
          className: 'flex h-11 items-center gap-2 border-b border-border-dark/55 px-4',
        },
        createElement('div', {
          className: 'h-3 w-24 animate-pulse rounded-full bg-white/12',
        })
      ),
      createElement(
        'div',
        {
          className: 'space-y-3 p-4',
        },
        createElement('div', {
          className: 'h-24 animate-pulse rounded-xl bg-white/8',
        }),
        createElement('div', {
          className: 'h-3 w-2/3 animate-pulse rounded-full bg-white/10',
        })
      )
    )
  );
}

const AudioNode = createLazyNode(() => import('./AudioNode').then((module) => ({ default: module.AudioNode as CanvasNodeComponent })));
const ImageCompareNode = createLazyNode(() => import('./ImageCompareNode').then((module) => ({ default: module.ImageCompareNode as CanvasNodeComponent })));
const ImageEditNode = createLazyNode(() => import('./ImageEditNode').then((module) => ({ default: module.ImageEditNode as CanvasNodeComponent })));
const MultiAngleImageNode = createLazyNode(() => import('./MultiAngleImageNode').then((module) => ({ default: module.MultiAngleImageNode as CanvasNodeComponent })));
const Panorama360Node = createLazyNode(() => import('./Panorama360Node').then((module) => ({ default: module.Panorama360Node as CanvasNodeComponent })));
const DirectorStageNode = createLazyNode(() => import('./DirectorStageNode').then((module) => ({ default: module.DirectorStageNode as CanvasNodeComponent })));
const BackgroundRemoveNode = createLazyNode(() => import('./BackgroundRemoveNode').then((module) => ({ default: module.BackgroundRemoveNode as CanvasNodeComponent })));
const SeedVR2ImageUpscaleNode = createLazyNode(() => import('./SeedVR2ImageUpscaleNode').then((module) => ({ default: module.SeedVR2ImageUpscaleNode as CanvasNodeComponent })));
const SeedVR2VideoUpscaleNode = createLazyNode(() => import('./SeedVR2VideoUpscaleNode').then((module) => ({ default: module.SeedVR2VideoUpscaleNode as CanvasNodeComponent })));
const JimengImageNode = createLazyNode(() => import('./JimengImageNode').then((module) => ({ default: module.JimengImageNode as CanvasNodeComponent })));
const JimengImageResultNode = createLazyNode(() => import('./JimengImageResultNode').then((module) => ({ default: module.JimengImageResultNode as CanvasNodeComponent })));
const JimengVideoResultNode = createLazyNode(() => import('./JimengVideoResultNode').then((module) => ({ default: module.JimengVideoResultNode as CanvasNodeComponent })));
const ImageNode = createLazyNode(() => import('./ImageNode').then((module) => ({ default: module.ImageNode as CanvasNodeComponent })));
const JimengNode = createLazyNode(() => import('./JimengNode').then((module) => ({ default: module.JimengNode as CanvasNodeComponent })));
const MjNode = createLazyNode(() => import('./MjNode').then((module) => ({ default: module.MjNode as CanvasNodeComponent })));
const MjResultNode = createLazyNode(() => import('./MjResultNode').then((module) => ({ default: module.MjResultNode as CanvasNodeComponent })));
const SeedanceNode = createLazyNode(() => import('./SeedanceNode').then((module) => ({ default: module.SeedanceNode as CanvasNodeComponent })));
const SeedanceVideoResultNode = createLazyNode(() => import('./SeedanceVideoResultNode').then((module) => ({ default: module.SeedanceVideoResultNode as CanvasNodeComponent })));
const GptBestSeedanceNode = createLazyNode(() => import('./GptBestVideoNode').then((module) => ({ default: module.GptBestSeedanceNode as CanvasNodeComponent })));
const GptBestGrokVideoNode = createLazyNode(() => import('./GptBestVideoNode').then((module) => ({ default: module.GptBestGrokVideoNode as CanvasNodeComponent })));
const GptBestVideoResultNode = createLazyNode(() => import('./GptBestVideoResultNode').then((module) => ({ default: module.GptBestVideoResultNode as CanvasNodeComponent })));
const ViduNode = createLazyNode(() => import('./ViduNode').then((module) => ({ default: module.ViduNode as CanvasNodeComponent })));
const ViduVideoResultNode = createLazyNode(() => import('./ViduVideoResultNode').then((module) => ({ default: module.ViduVideoResultNode as CanvasNodeComponent })));
const StoryboardGenNode = createLazyNode(() => import('./StoryboardGenNode').then((module) => ({ default: module.StoryboardGenNode as CanvasNodeComponent })));
const AssetMaterialNode = createLazyNode(() => import('./AssetMaterialNode').then((module) => ({ default: module.AssetMaterialNode as CanvasNodeComponent })));
const ImageCollageNode = createLazyNode(() => import('./ImageCollageNode').then((module) => ({ default: module.ImageCollageNode as CanvasNodeComponent })));
const StoryboardNode = createLazyNode(() => import('./StoryboardNode').then((module) => ({ default: module.StoryboardNode as CanvasNodeComponent })));
const StoryboardSplitResultNode = createLazyNode(() => import('./StoryboardSplitResultNode').then((module) => ({ default: module.StoryboardSplitResultNode as CanvasNodeComponent })));
const LlmLogicNode = createLazyNode(() => import('./LlmLogicNode').then((module) => ({ default: module.LlmLogicNode as CanvasNodeComponent })));
const TextAnnotationNode = createLazyNode(() => import('./TextAnnotationNode').then((module) => ({ default: module.TextAnnotationNode as CanvasNodeComponent })));
const TtsTextNode = createLazyNode(() => import('./TtsTextNode').then((module) => ({ default: module.TtsTextNode as CanvasNodeComponent })));
const ScriptSceneNode = createLazyNode(() => import('./ScriptSceneNode').then((module) => ({ default: module.ScriptSceneNode as CanvasNodeComponent })));
const ShootingScriptNode = createLazyNode(() => import('./ShootingScriptNode').then((module) => ({ default: module.ShootingScriptNode as CanvasNodeComponent })));
const DirectorWorkPackageNode = createLazyNode(() => import('./DirectorWorkPackageNode').then((module) => ({ default: module.DirectorWorkPackageNode as CanvasNodeComponent })));
const SmartDirectorStoryboardNode = createLazyNode(() => import('./SmartDirectorStoryboardNode').then((module) => ({ default: module.SmartDirectorStoryboardNode as CanvasNodeComponent })));
const ScriptStoryboardTableNode = createLazyNode(() => import('./ScriptStoryboardTableNode').then((module) => ({ default: module.ScriptStoryboardTableNode as CanvasNodeComponent })));
const DirectorStoryboardReferenceNode = createLazyNode(() => import('./DirectorStoryboardReferenceNode').then((module) => ({ default: module.DirectorStoryboardReferenceNode as CanvasNodeComponent })));
const ScriptReferenceNode = createLazyNode(() => import('./ScriptReferenceNode').then((module) => ({ default: module.ScriptReferenceNode as CanvasNodeComponent })));
const AdScriptReferenceNode = createLazyNode(() => import('./AdScriptReferenceNode').then((module) => ({ default: module.AdScriptReferenceNode as CanvasNodeComponent })));
const ScriptCharacterReferenceNode = createLazyNode(() => import('./ScriptAssetReferenceNode').then((module) => ({ default: module.ScriptCharacterReferenceNode as CanvasNodeComponent })));
const ScriptLocationReferenceNode = createLazyNode(() => import('./ScriptAssetReferenceNode').then((module) => ({ default: module.ScriptLocationReferenceNode as CanvasNodeComponent })));
const ScriptItemReferenceNode = createLazyNode(() => import('./ScriptAssetReferenceNode').then((module) => ({ default: module.ScriptItemReferenceNode as CanvasNodeComponent })));
const QwenTtsVoiceDesignNode = createLazyNode(() => import('./QwenTtsVoiceDesignNode').then((module) => ({ default: module.QwenTtsVoiceDesignNode as CanvasNodeComponent })));
const QwenTtsSavedVoiceNode = createLazyNode(() => import('./QwenTtsSavedVoiceNode').then((module) => ({ default: module.QwenTtsSavedVoiceNode as CanvasNodeComponent })));
const VoxCpmVoiceDesignNode = createLazyNode(() => import('./VoxCpmVoiceDesignNode').then((module) => ({ default: module.VoxCpmVoiceDesignNode as CanvasNodeComponent })));
const VoxCpmVoiceCloneNode = createLazyNode(() => import('./VoxCpmVoiceCloneNode').then((module) => ({ default: module.VoxCpmVoiceCloneNode as CanvasNodeComponent })));
const VoxCpmUltimateCloneNode = createLazyNode(() => import('./VoxCpmUltimateCloneNode').then((module) => ({ default: module.VoxCpmUltimateCloneNode as CanvasNodeComponent })));
const UploadNode = createLazyNode(() => import('./UploadNode').then((module) => ({ default: module.UploadNode as CanvasNodeComponent })));
const VideoNode = createLazyNode(() => import('./VideoNode').then((module) => ({ default: module.VideoNode as CanvasNodeComponent })));
const ScriptRootNode = createLazyNode(() => import('./ScriptRootNode').then((module) => ({ default: module.ScriptRootNode as CanvasNodeComponent })));
const ScriptChapterNode = createLazyNode(() => import('./ScriptChapterNode').then((module) => ({ default: module.ScriptChapterNode as CanvasNodeComponent })));
const ScriptWorldviewNode = createLazyNode(() => import('./ScriptWorldviewNode').then((module) => ({ default: module.ScriptWorldviewNode as CanvasNodeComponent })));
const ScriptCharacterNode = createLazyNode(() => import('./ScriptCharacterNode').then((module) => ({ default: module.ScriptCharacterNode as CanvasNodeComponent })));
const ScriptLocationNode = createLazyNode(() => import('./ScriptLocationNode').then((module) => ({ default: module.ScriptLocationNode as CanvasNodeComponent })));
const ScriptItemNode = createLazyNode(() => import('./ScriptItemNode').then((module) => ({ default: module.ScriptItemNode as CanvasNodeComponent })));
const ScriptStoryNoteNode = createLazyNode(() => import('./ScriptStoryNoteNode').then((module) => ({ default: module.ScriptStoryNoteNode as CanvasNodeComponent })));
const ScriptPlotPointNode = createLazyNode(() => import('./ScriptPlotPointNode').then((module) => ({ default: module.ScriptPlotPointNode as CanvasNodeComponent })));
const ScriptPlotLineNode = createLazyNode(() => import('./ScriptPlotLineNode').then((module) => ({ default: module.ScriptPlotLineNode as CanvasNodeComponent })));
const CommerceStageNode = createLazyNode(() => import('./CommerceStageNode').then((module) => ({ default: module.CommerceStageNode as CanvasNodeComponent })));

export const nodeTypes: NodeTypes = {
  exportImageNode: ImageNode,
  imageCompareNode: ImageCompareNode,
  groupNode: GroupNode as CanvasNodeComponent,
  audioNode: AudioNode,
  imageNode: ImageEditNode,
  multiAngleImageNode: MultiAngleImageNode,
  panorama360Node: Panorama360Node,
  directorStageNode: DirectorStageNode,
  backgroundRemoveNode: BackgroundRemoveNode,
  seedvr2ImageUpscaleNode: SeedVR2ImageUpscaleNode,
  seedvr2VideoUpscaleNode: SeedVR2VideoUpscaleNode,
  jimengImageNode: JimengImageNode,
  mjNode: MjNode,
  mjResultNode: MjResultNode,
  jimengImageResultNode: JimengImageResultNode,
  jimengVideoResultNode: JimengVideoResultNode,
  jimengNode: JimengNode,
  seedanceNode: SeedanceNode,
  seedanceVideoResultNode: SeedanceVideoResultNode,
  gptBestSeedanceNode: GptBestSeedanceNode,
  gptBestGrokVideoNode: GptBestGrokVideoNode,
  gptBestVideoResultNode: GptBestVideoResultNode,
  viduNode: ViduNode,
  viduVideoResultNode: ViduVideoResultNode,
  storyboardGenNode: StoryboardGenNode,
  assetMaterialNode: AssetMaterialNode,
  imageCollageNode: ImageCollageNode,
  storyboardNode: StoryboardNode,
  storyboardSplitResultNode: StoryboardSplitResultNode,
  llmLogicNode: LlmLogicNode,
  textAnnotationNode: TextAnnotationNode,
  ttsTextNode: TtsTextNode,
  ttsVoiceDesignNode: QwenTtsVoiceDesignNode,
  ttsSavedVoiceNode: QwenTtsSavedVoiceNode,
  voxCpmVoiceDesignNode: VoxCpmVoiceDesignNode,
  voxCpmVoiceCloneNode: VoxCpmVoiceCloneNode,
  voxCpmUltimateCloneNode: VoxCpmUltimateCloneNode,
  uploadNode: UploadNode,
  videoNode: VideoNode,
  legacyNode: LegacyNode as CanvasNodeComponent,
  scriptRootNode: ScriptRootNode,
  scriptChapterNode: ScriptChapterNode,
  scriptSceneNode: ScriptSceneNode,
  shootingScriptNode: ShootingScriptNode,
  scriptAssetExtractNode: DirectorWorkPackageNode,
  smartDirectorStoryboardNode: SmartDirectorStoryboardNode,
  scriptStoryboardTableNode: ScriptStoryboardTableNode,
  directorWorkPackageNode: DirectorWorkPackageNode,
  directorStoryboardReferenceNode: DirectorStoryboardReferenceNode,
  scriptReferenceNode: ScriptReferenceNode,
  adScriptReferenceNode: AdScriptReferenceNode,
  commerceProductNode: CommerceStageNode,
  commerceBriefNode: CommerceStageNode,
  commerceBatchGenerateNode: CommerceStageNode,
  commerceResultGroupNode: CommerceStageNode,
  scriptCharacterReferenceNode: ScriptCharacterReferenceNode,
  scriptLocationReferenceNode: ScriptLocationReferenceNode,
  scriptItemReferenceNode: ScriptItemReferenceNode,
  scriptWorldviewNode: ScriptWorldviewNode,
  scriptCharacterNode: ScriptCharacterNode,
  scriptLocationNode: ScriptLocationNode,
  scriptItemNode: ScriptItemNode,
  scriptPlotLineNode: ScriptPlotLineNode,
  scriptStoryNoteNode: ScriptStoryNoteNode,
  scriptPlotPointNode: ScriptPlotPointNode,
};

export const overviewNodeTypes: NodeTypes = Object.fromEntries(
  Object.values(CANVAS_NODE_TYPES).map((type) => [type, CanvasOverviewNode])
);

export { CanvasOverviewNode, GroupNode, LegacyNode };
