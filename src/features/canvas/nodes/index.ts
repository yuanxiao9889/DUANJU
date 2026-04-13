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
import { SeedanceNode } from './SeedanceNode';
import { SeedanceVideoResultNode } from './SeedanceVideoResultNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { StoryboardNode } from './StoryboardNode';
import { StoryboardSplitResultNode } from './StoryboardSplitResultNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { TtsTextNode } from './TtsTextNode';
import { ScriptTextNode } from './ScriptTextNode';
import { ScriptSceneNode } from './ScriptSceneNode';
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
  jimengImageResultNode: JimengImageResultNode,
  jimengVideoResultNode: JimengVideoResultNode,
  jimengNode: JimengNode,
  seedanceNode: SeedanceNode,
  seedanceVideoResultNode: SeedanceVideoResultNode,
  storyboardGenNode: StoryboardGenNode,
  storyboardNode: StoryboardNode,
  storyboardSplitResultNode: StoryboardSplitResultNode,
  textAnnotationNode: TextAnnotationNode,
  ttsTextNode: TextAnnotationNode,
  scriptTextNode: ScriptTextNode,
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
  JimengImageResultNode,
  JimengVideoResultNode,
  ImageNode, 
  JimengNode,
  SeedanceNode,
  SeedanceVideoResultNode,
  StoryboardGenNode, 
  StoryboardNode, 
  StoryboardSplitResultNode,
  TextAnnotationNode, 
  TtsTextNode,
  ScriptTextNode,
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
  ScriptWorldviewNode,
  ScriptCharacterNode,
  ScriptLocationNode,
  ScriptItemNode,
  ScriptPlotPointNode,
};
