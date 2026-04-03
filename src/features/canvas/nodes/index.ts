import type { NodeTypes } from '@xyflow/react';

import { GroupNode } from './GroupNode';
import { AudioNode } from './AudioNode';
import { ImageEditNode } from './ImageEditNode';
import { JimengImageNode } from './JimengImageNode';
import { JimengImageResultNode } from './JimengImageResultNode';
import { JimengVideoResultNode } from './JimengVideoResultNode';
import { ImageNode } from './ImageNode';
import { JimengNode } from './JimengNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { StoryboardNode } from './StoryboardNode';
import { StoryboardSplitResultNode } from './StoryboardSplitResultNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { TtsTextNode } from './TtsTextNode';
import { QwenTtsVoiceDesignNode } from './QwenTtsVoiceDesignNode';
import { QwenTtsSavedVoiceNode } from './QwenTtsSavedVoiceNode';
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
  jimengImageNode: JimengImageNode,
  jimengImageResultNode: JimengImageResultNode,
  jimengVideoResultNode: JimengVideoResultNode,
  jimengNode: JimengNode,
  storyboardGenNode: StoryboardGenNode,
  storyboardNode: StoryboardNode,
  storyboardSplitResultNode: StoryboardSplitResultNode,
  textAnnotationNode: TextAnnotationNode,
  ttsTextNode: TextAnnotationNode,
  ttsVoiceDesignNode: QwenTtsVoiceDesignNode,
  ttsSavedVoiceNode: QwenTtsSavedVoiceNode,
  uploadNode: UploadNode,
  videoNode: VideoNode,
  scriptRootNode: ScriptRootNode,
  scriptChapterNode: ScriptChapterNode,
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
  JimengImageNode,
  JimengImageResultNode,
  JimengVideoResultNode,
  ImageNode, 
  JimengNode,
  StoryboardGenNode, 
  StoryboardNode, 
  StoryboardSplitResultNode,
  TextAnnotationNode, 
  TtsTextNode,
  QwenTtsVoiceDesignNode,
  QwenTtsSavedVoiceNode,
  UploadNode, 
  VideoNode,
  ScriptRootNode, 
  ScriptChapterNode, 
  ScriptWorldviewNode,
  ScriptCharacterNode,
  ScriptLocationNode,
  ScriptItemNode,
  ScriptPlotPointNode,
};
