import type { CanvasToolPlugin, ToolFieldSchema, ToolOptions } from '@/features/canvas/tools';

export interface ToolEditorBaseProps {
  plugin: CanvasToolPlugin;
  options: ToolOptions;
  onOptionsChange: (next: ToolOptions) => void;
}

export interface VisualToolEditorProps extends ToolEditorBaseProps {
  sourceImageUrl: string;
}

export interface MediaTrimToolEditorProps extends ToolEditorBaseProps {
  sourceMediaUrl: string;
  mediaType: 'video' | 'audio';
}

export interface FormToolEditorProps extends ToolEditorBaseProps {
  fields: ToolFieldSchema[];
}
