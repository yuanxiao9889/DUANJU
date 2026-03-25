import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeResultKind,
} from './canvasNodes';

export const DEFAULT_NODE_DISPLAY_NAME: Record<CanvasNodeType, string> = {
  [CANVAS_NODE_TYPES.upload]: '\u4e0a\u4f20\u56fe\u7247',
  [CANVAS_NODE_TYPES.imageEdit]: 'AI \u56fe\u7247',
  [CANVAS_NODE_TYPES.jimeng]: '\u5373\u68a6\u8282\u70b9',
  [CANVAS_NODE_TYPES.exportImage]: '\u7ed3\u679c\u56fe\u7247',
  [CANVAS_NODE_TYPES.textAnnotation]: '\u6587\u672c\u6ce8\u91ca',
  [CANVAS_NODE_TYPES.group]: '\u5206\u7ec4',
  [CANVAS_NODE_TYPES.storyboardSplit]: '\u5206\u955c\u7ec4\u5408',
  [CANVAS_NODE_TYPES.storyboardSplitResult]: '\u5207\u5272\u7ed3\u679c',
  [CANVAS_NODE_TYPES.storyboardGen]: '\u5206\u955c\u751f\u6210',
  [CANVAS_NODE_TYPES.video]: '\u89c6\u9891',
  [CANVAS_NODE_TYPES.scriptRoot]: '\u5267\u672c',
  [CANVAS_NODE_TYPES.scriptChapter]: '\u7ae0\u8282',
  [CANVAS_NODE_TYPES.scriptCharacter]: '\u89d2\u8272',
  [CANVAS_NODE_TYPES.scriptLocation]: '\u573a\u666f',
  [CANVAS_NODE_TYPES.scriptItem]: '\u9053\u5177',
  [CANVAS_NODE_TYPES.scriptPlotPoint]: '\u60c5\u8282\u70b9',
  [CANVAS_NODE_TYPES.scriptWorldview]: '\u4e16\u754c\u89c2',
};

export const EXPORT_RESULT_DISPLAY_NAME: Record<ExportImageNodeResultKind, string> = {
  generic: '\u7ed3\u679c\u56fe\u7247',
  storyboardGenOutput: '\u5206\u955c\u8f93\u51fa',
  storyboardSplitExport: '\u5207\u5272\u5bfc\u51fa',
  storyboardFrameEdit: '\u5206\u955c\u5e27',
};

function resolveExportResultDefault(data: Partial<CanvasNodeData>): string {
  const resultKind = (data as { resultKind?: ExportImageNodeResultKind }).resultKind ?? 'generic';
  return EXPORT_RESULT_DISPLAY_NAME[resultKind];
}

export function getDefaultNodeDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): string {
  if (type === CANVAS_NODE_TYPES.exportImage) {
    return resolveExportResultDefault(data);
  }

  return DEFAULT_NODE_DISPLAY_NAME[type];
}

export function resolveNodeDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): string {
  const customTitle = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  if (customTitle) {
    return customTitle;
  }

  if (type === CANVAS_NODE_TYPES.group) {
    const legacyLabel = typeof (data as { label?: string }).label === 'string'
      ? (data as { label?: string }).label?.trim()
      : '';
    if (legacyLabel) {
      return legacyLabel;
    }
  }

  return getDefaultNodeDisplayName(type, data);
}

export function isNodeUsingDefaultDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): boolean {
  const customTitle = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  if (!customTitle) {
    return true;
  }

  return customTitle === getDefaultNodeDisplayName(type, data);
}
