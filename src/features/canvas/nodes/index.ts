import type { NodeTypes } from '@xyflow/react';

import { GroupNode } from './GroupNode';
import { AudioNode } from './AudioNode';
import { ImageEditNode } from './ImageEditNode';
import { Panorama360Node } from './Panorama360Node';
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
import { TextAnnotationNode } from './TextAnnotationNode';
import { TtsTextNode } from './TtsTextNode';
import { ScriptSceneNode } from './ScriptSceneNode';
import { ShootingScriptNode } from './ShootingScriptNode';
import { ScriptReferenceNode } from './ScriptReferenceNode';
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
  groupNode: GroupNode,
  audioNode: AudioNode,
  imageNode: ImageEditNode,
  panorama360Node: Panorama360Node,
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
  ImageEditNode, 
  Panorama360Node,
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
  ScriptCharacterReferenceNode,
  ScriptLocationReferenceNode,
  ScriptItemReferenceNode,
  ScriptWorldviewNode,
  ScriptCharacterNode,
  ScriptLocationNode,
  ScriptItemNode,
  ScriptPlotPointNode,
};
