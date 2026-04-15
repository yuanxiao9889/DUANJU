import type { Viewport } from '@xyflow/react';

import {
  exportScriptProjectPackage as exportScriptProjectPackageCommand,
  importScriptProjectPackage as importScriptProjectPackageCommand,
  previewScriptProjectPackage as previewScriptProjectPackageCommand,
  type ExportScriptProjectPackageAssetInput,
} from '@/commands/scriptProjectPackage';
import { createDefaultCanvasColorLabelMap } from '@/features/canvas/domain/semanticColors';
import { resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';
import { buildScriptProjectPackageImportPreview } from '@/features/canvas/application/scriptImportWorkflow';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import type {
  ScriptImportPreviewModel,
  ScriptProjectPackagePreviewRecord,
  ScriptProjectPackageSnapshot,
} from '@/features/canvas/application/scriptImportExportTypes';
import type { CanvasHistoryState } from '@/stores/canvasStore';
import type { Project } from '@/stores/projectStore';

const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

const ASSET_FIELD_KEY_PATTERN = /(image|video|audio|source|reference).*(url|urls|path|paths)$/i;

interface ScriptProjectPackageAssetDraft {
  id: string;
  sourcePath: string;
  archiveFileName: string;
  matchValues: Set<string>;
}

interface CreateScriptProjectPackageSnapshotOptions {
  currentProject: Project | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport?: Viewport;
  history?: CanvasHistoryState;
  selectedNodeId?: string | null;
}

function buildAssetCompareKey(sourcePath: string): string {
  return sourcePath.replace(/\\/g, '/').toLowerCase();
}

function getFileNameFromPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  return normalized.split('/').pop() || 'asset.bin';
}

function collectScriptProjectPackageAssets(
  value: unknown,
  currentKey?: string,
  drafts: Map<string, ScriptProjectPackageAssetDraft> = new Map(),
): Map<string, ScriptProjectPackageAssetDraft> {
  if (typeof value === 'string') {
    if (!currentKey || !ASSET_FIELD_KEY_PATTERN.test(currentKey)) {
      return drafts;
    }

    const sourcePath = resolveLocalFileSourcePath(value);
    if (!sourcePath) {
      return drafts;
    }

    const compareKey = buildAssetCompareKey(sourcePath);
    const existing = drafts.get(compareKey);
    if (existing) {
      existing.matchValues.add(value);
      return drafts;
    }

    drafts.set(compareKey, {
      id: `asset-${drafts.size + 1}`,
      sourcePath,
      archiveFileName: getFileNameFromPath(sourcePath),
      matchValues: new Set([value]),
    });
    return drafts;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectScriptProjectPackageAssets(item, currentKey, drafts);
    });
    return drafts;
  }

  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
      collectScriptProjectPackageAssets(childValue, childKey, drafts);
    });
  }

  return drafts;
}

function resolveRootTitle(nodes: CanvasNode[], fallbackName: string): string {
  const rootNode = nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot);
  const rootTitle = typeof rootNode?.data?.title === 'string' ? rootNode.data.title.trim() : '';
  return rootTitle || fallbackName || 'Untitled Script';
}

export function createScriptProjectPackageSnapshot(
  options: CreateScriptProjectPackageSnapshotOptions
): ScriptProjectPackageSnapshot {
  const currentProject = options.currentProject;
  const currentProjectName = currentProject?.name?.trim() || '';
  const title = resolveRootTitle(options.nodes, currentProjectName || 'Untitled Script');
  const projectName = currentProjectName || title;

  return {
    projectId: currentProject?.id ?? null,
    projectName,
    projectType: 'script',
    title,
    assetLibraryId: currentProject?.assetLibraryId ?? null,
    linkedScriptProjectId: currentProject?.linkedScriptProjectId ?? null,
    nodes: options.nodes,
    edges: options.edges,
    viewport: options.viewport ?? currentProject?.viewport ?? DEFAULT_VIEWPORT,
    history: options.history ?? currentProject?.history ?? { past: [], future: [] },
    colorLabels: currentProject?.colorLabels ?? createDefaultCanvasColorLabelMap(),
    selectedNodeId: options.selectedNodeId ?? null,
  };
}

export function buildDefaultScriptProjectPackageFileName(title: string): string {
  return `${title || 'Untitled Script'}.scpkg`;
}

export async function exportScriptProjectPackageBundle(
  targetPath: string,
  options: CreateScriptProjectPackageSnapshotOptions
): Promise<void> {
  const project = createScriptProjectPackageSnapshot(options);
  const assetDrafts = collectScriptProjectPackageAssets(project);
  const assets: ExportScriptProjectPackageAssetInput[] = Array.from(assetDrafts.values()).map((draft) => ({
    id: draft.id,
    sourcePath: draft.sourcePath,
    archiveFileName: draft.archiveFileName,
    matchValues: Array.from(draft.matchValues),
  }));

  await exportScriptProjectPackageCommand({
    targetPath,
    info: {
      projectId: project.projectId ?? null,
      projectName: project.projectName,
      title: project.title,
      projectType: 'script',
      exportedAt: new Date().toISOString(),
    },
    project,
    assets,
  });
}

export function normalizeScriptProjectPackageSnapshot(
  snapshot: ScriptProjectPackageSnapshot
): ScriptProjectPackageSnapshot {
  return {
    ...snapshot,
    projectName: snapshot.projectName?.trim() || snapshot.title?.trim() || 'Untitled Script',
    title: snapshot.title?.trim() || snapshot.projectName?.trim() || 'Untitled Script',
    projectType: 'script',
    nodes: Array.isArray(snapshot.nodes) ? snapshot.nodes : [],
    edges: Array.isArray(snapshot.edges) ? snapshot.edges : [],
    viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
    history: snapshot.history ?? { past: [], future: [] },
    colorLabels: snapshot.colorLabels ?? createDefaultCanvasColorLabelMap(),
    selectedNodeId: snapshot.selectedNodeId ?? null,
    assetLibraryId: snapshot.assetLibraryId ?? null,
    linkedScriptProjectId: snapshot.linkedScriptProjectId ?? null,
  };
}

export async function prepareScriptProjectPackagePreview(
  packagePath: string
): Promise<ScriptImportPreviewModel> {
  const previewRecord = await previewScriptProjectPackageCommand(packagePath);
  const normalizedRecord: ScriptProjectPackagePreviewRecord = {
    ...previewRecord,
    project: normalizeScriptProjectPackageSnapshot(previewRecord.project),
  };
  return buildScriptProjectPackageImportPreview(normalizedRecord);
}

export async function materializeScriptProjectPackageImport(
  packagePath: string
): Promise<ScriptProjectPackageSnapshot> {
  const importedRecord = await importScriptProjectPackageCommand(packagePath);
  return normalizeScriptProjectPackageSnapshot(importedRecord.project);
}
