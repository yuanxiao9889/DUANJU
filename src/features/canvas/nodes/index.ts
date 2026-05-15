import type { NodeTypes } from '@xyflow/react';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { GroupNode } from './GroupNode';
import { AudioNode } from './AudioNode';
import { ImageCompareNode } from './ImageCompareNode';
import { ImageEditNode } from './ImageEditNode';
import { MultiAngleImageNode } from './MultiAngleImageNode';
import { Panorama360Node } from './Panorama360Node';
import { DirectorStageNode } from './DirectorStageNode';
import { BackgroundRemoveNode } from './BackgroundRemoveNode';
import { SeedVR2ImageUpscaleNode } from './SeedVR2ImageUpscaleNode';
import { SeedVR2VideoUpscaleNode } from './SeedVR2VideoUpscaleNode';
import { JimengImageNode } from './JimengImageNode';
import { JimengImageResultNode } from './JimengImageResultNode';
import { JimengVideoResultNode } from './JimengVideoResultNode';
import { ImageNode } from './ImageNode';
import { JimengNode } from './JimengNode';
import { MjNode } from './MjNode';
import { MjResultNode } from './MjResultNode';
import { SeedanceNode } from './SeedanceNode';
import { SeedanceVideoResultNode } from './SeedanceVideoResultNode';
import {
  GptBestGrokVideoNode,
  GptBestSeedanceNode,
} from './GptBestVideoNode';
import { GptBestVideoResultNode } from './GptBestVideoResultNode';
import { ViduNode } from './ViduNode';
import { ViduVideoResultNode } from './ViduVideoResultNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { ImageCollageNode } from './ImageCollageNode';
import { StoryboardNode } from './StoryboardNode';
import { StoryboardSplitResultNode } from './StoryboardSplitResultNode';
import { LlmLogicNode } from './LlmLogicNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { TtsTextNode } from './TtsTextNode';
import { ScriptSceneNode } from './ScriptSceneNode';
import { ShootingScriptNode } from './ShootingScriptNode';
import { DirectorWorkPackageNode } from './DirectorWorkPackageNode';
import { DirectorStoryboardReferenceNode } from './DirectorStoryboardReferenceNode';
import { ScriptReferenceNode } from './ScriptReferenceNode';
import { AdScriptReferenceNode } from './AdScriptReferenceNode';
import {
  ScriptCharacterReferenceNode,
  ScriptItemReferenceNode,
  ScriptLocationReferenceNode,
} from './ScriptAssetReferenceNode';
import { QwenTtsVoiceDesignNode } from './QwenTtsVoiceDesignNode';
import { QwenTtsSavedVoiceNode } from './QwenTtsSavedVoiceNode';
import { VoxCpmVoiceDesignNode } from './VoxCpmVoiceDesignNode';
import { VoxCpmVoiceCloneNode } from './VoxCpmVoiceCloneNode';
import { VoxCpmUltimateCloneNode } from './VoxCpmUltimateCloneNode';
import { UploadNode } from './UploadNode';
import { VideoNode } from './VideoNode';
import { ScriptRootNode } from './ScriptRootNode';
import { ScriptChapterNode } from './ScriptChapterNode';
import { ScriptWorldviewNode } from './ScriptWorldviewNode';
import { ScriptCharacterNode } from './ScriptCharacterNode';
import { ScriptLocationNode } from './ScriptLocationNode';
import { ScriptItemNode } from './ScriptItemNode';
import { ScriptStoryNoteNode } from './ScriptStoryNoteNode';
import { ScriptPlotPointNode } from './ScriptPlotPointNode';
import { ScriptPlotLineNode } from './ScriptPlotLineNode';
import { LegacyNode } from './LegacyNode';
import { CommerceStageNode } from './CommerceStageNode';
import { CanvasOverviewNode } from './CanvasOverviewNode';

export const nodeTypes: NodeTypes = {
  exportImageNode: ImageNode,
  imageCompareNode: ImageCompareNode,
  groupNode: GroupNode,
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
  imageCollageNode: ImageCollageNode,
  storyboardNode: StoryboardNode,
  storyboardSplitResultNode: StoryboardSplitResultNode,
  llmLogicNode: LlmLogicNode,
  textAnnotationNode: TextAnnotationNode,
  ttsTextNode: TextAnnotationNode,
  ttsVoiceDesignNode: QwenTtsVoiceDesignNode,
  ttsSavedVoiceNode: QwenTtsSavedVoiceNode,
  voxCpmVoiceDesignNode: VoxCpmVoiceDesignNode,
  voxCpmVoiceCloneNode: VoxCpmVoiceCloneNode,
  voxCpmUltimateCloneNode: VoxCpmUltimateCloneNode,
  uploadNode: UploadNode,
  videoNode: VideoNode,
  legacyNode: LegacyNode,
  scriptRootNode: ScriptRootNode,
  scriptChapterNode: ScriptChapterNode,
  scriptSceneNode: ScriptSceneNode,
  shootingScriptNode: ShootingScriptNode,
  scriptAssetExtractNode: DirectorWorkPackageNode,
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

export { 
  GroupNode, 
  AudioNode,
  ImageCompareNode,
  ImageEditNode,
  MultiAngleImageNode,
  Panorama360Node,
  DirectorStageNode,
  BackgroundRemoveNode,
  SeedVR2ImageUpscaleNode,
  SeedVR2VideoUpscaleNode,
  JimengImageNode,
  MjNode,
  MjResultNode,
  JimengImageResultNode,
  JimengVideoResultNode,
  ImageNode, 
  JimengNode,
  SeedanceNode,
  SeedanceVideoResultNode,
  GptBestSeedanceNode,
  GptBestGrokVideoNode,
  GptBestVideoResultNode,
  ViduNode,
  ViduVideoResultNode,
  StoryboardGenNode, 
  ImageCollageNode,
  StoryboardNode, 
  StoryboardSplitResultNode,
  LlmLogicNode,
  TextAnnotationNode, 
  TtsTextNode,
  QwenTtsVoiceDesignNode,
  QwenTtsSavedVoiceNode,
  VoxCpmVoiceDesignNode,
  VoxCpmVoiceCloneNode,
  VoxCpmUltimateCloneNode,
  UploadNode, 
  VideoNode,
  LegacyNode,
  ScriptRootNode, 
  ScriptChapterNode, 
  ScriptSceneNode,
  ShootingScriptNode,
  DirectorWorkPackageNode,
  DirectorStoryboardReferenceNode,
  ScriptReferenceNode,
  AdScriptReferenceNode,
  CommerceStageNode,
  ScriptCharacterReferenceNode,
  ScriptLocationReferenceNode,
  ScriptItemReferenceNode,
  ScriptWorldviewNode,
  ScriptCharacterNode,
  ScriptLocationNode,
  ScriptItemNode,
  ScriptPlotLineNode,
  ScriptStoryNoteNode,
  ScriptPlotPointNode,
  CanvasOverviewNode,
};
