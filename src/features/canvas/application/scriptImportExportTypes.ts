import type {
  CanvasEdge,
  CanvasNode,
  ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';
import type {
  ImportedScriptDocument,
  ScriptImportFormat,
} from '@/features/canvas/application/scriptImporter';

export const NATIVE_SCRIPT_PACKAGE_SCHEMA = 'storyboard-copilot/native-script-package';
export const NATIVE_SCRIPT_PACKAGE_VERSION = 1;

export type ScriptImportKind = 'external' | 'nativePackage';
export type ExportFormat = 'txt' | 'docx' | 'markdown';

export interface NativeScriptPackageV1 {
  schema: typeof NATIVE_SCRIPT_PACKAGE_SCHEMA;
  version: typeof NATIVE_SCRIPT_PACKAGE_VERSION;
  exportedAt: string;
  appVersion?: string;
  projectType: 'script';
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface ExternalScriptSceneSegment {
  title: string;
  summary: string;
  startLine: number;
  endLine: number;
}

export interface ExternalScriptChapterSegment {
  title: string;
  summary: string;
  startLine: number;
  endLine: number;
  scenes: ExternalScriptSceneSegment[];
}

export interface ExternalScriptStructureAnalysis {
  chapters: ExternalScriptChapterSegment[];
}

export interface ScriptImportPreviewNotice {
  kind: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface ScriptImportPreviewStats {
  chapterCount: number;
  sceneCount: number;
  wordCount: number;
  scriptSceneNodeCount: number;
  shootingScriptNodeCount: number;
  assetNodeCount: number;
  edgeCount: number;
}

export interface ScriptImportPreviewDetail {
  label: string;
  value: string;
}

export interface ScriptImportApplyPayload {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
}

export interface ScriptImportPreviewModel {
  kind: ScriptImportKind;
  title: string;
  sourceName: string;
  description: string;
  format: ScriptImportFormat | 'nativePackage';
  document: Omit<ImportedScriptDocument, 'format'> & {
    format: ScriptImportFormat | 'nativePackage';
  };
  notices: ScriptImportPreviewNotice[];
  stats: ScriptImportPreviewStats;
  details: ScriptImportPreviewDetail[];
  nativePackage?: Pick<
    NativeScriptPackageV1,
    'schema' | 'version' | 'exportedAt' | 'appVersion' | 'projectType'
  >;
  usedFallback: boolean;
  applyPayload: ScriptImportApplyPayload;
}

export interface BranchInfo {
  id: string;
  name: string;
  startChapter: number;
  endChapter: number;
  path: string[];
  nodeIds: string[];
  isMainBranch: boolean;
}

export interface ScriptExportTextUnit {
  id: string;
  label: string;
  title: string;
  summary: string;
  html: string;
  plainText: string;
}

export interface ScriptExportChapterPreview {
  id: string;
  chapterNumber: number;
  title: string;
  summary: string;
  units: ScriptExportTextUnit[];
}

export interface ShootingScriptSheetPreview {
  id: string;
  name: string;
  chapterNumber: number;
  sceneNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  rows: ShootingScriptRow[];
}

export interface ScriptExportPreviewModel {
  title: string;
  chapters: ScriptExportChapterPreview[];
  branchLabels: string[];
  branchIds: string[];
  scriptHtml: string;
  scriptPlainText: string;
  scriptMarkdown: string;
  shootingScriptSheets: ShootingScriptSheetPreview[];
}
