import type { NodeTypes } from '@xyflow/react';

import { GroupNode } from './GroupNode';
import { AudioNode } from './AudioNode';
import { ImageCompareNode } from './ImageCompareNode';
import { ImageEditNode } from './ImageEditNode';
import { Panorama360Node } from './Panorama360Node';
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
import { StoryboardGenNode } from './StoryboardGenNode';
import { ImageCollageNode } from './ImageCollageNode';
import { StoryboardNode } from './StoryboardNode';
import { StoryboardSplitResultNode } from './StoryboardSplitResultNode';
import { LlmLogicNode } from './LlmLogicNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { TtsTextNode } from './TtsTextNode';
import { ScriptSceneNode } from './ScriptSceneNode';
import { ShootingScriptNode } from './ShootingScriptNode';
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
import { ScriptPlotPointNode } from './ScriptPlotPointNode';

export const nodeTypes: NodeTypes = {
  exportImageNode: ImageNode,
  imageCompareNode: ImageCompareNode,
  groupNode: GroupNode,
  audioNode: AudioNode,
  imageNode: ImageEditNode,
  panorama360Node: Panorama360Node,
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
  scriptRootNode: ScriptRootNode,
  scriptChapterNode: ScriptChapterNode,
  scriptSceneNode: ScriptSceneNode,
  shootingScriptNode: ShootingScriptNode,
  scriptReferenceNode: ScriptReferenceNode,
  adScriptReferenceNode: AdScriptReferenceNode,
  scriptCharacterReferenceNode: ScriptCharacterReferenceNode,
  scriptLocationReferenceNode: ScriptLocationReferenceNode,
  scriptItemReferenceNode: ScriptItemReferenceNode,
  scriptWorldviewNode: ScriptWorldviewNode,
  scriptCharacterNode: ScriptCharacterNode,
  scriptLocationNode: ScriptLocationNode,
  scriptItemNode: ScriptItemNode,
  scriptPlotPointNode: ScriptPlotPointNode,
};

export { 
  GroupNode, 
  AudioNode,
  ImageCompareNode,
  ImageEditNode, 
  Panorama360Node,
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
  ScriptRootNode, 
  ScriptChapterNode, 
  ScriptSceneNode,
  ShootingScriptNode,
  ScriptReferenceNode,
  AdScriptReferenceNode,
  ScriptCharacterReferenceNode,
  ScriptLocationReferenceNode,
  ScriptItemReferenceNode,
  ScriptWorldviewNode,
  ScriptCharacterNode,
  ScriptLocationNode,
  ScriptItemNode,
  ScriptPlotPointNode,
};
