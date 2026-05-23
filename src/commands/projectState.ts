import { invoke } from '@tauri-apps/api/core';

export type ProjectType = 'storyboard' | 'script' | 'ad' | 'commerceAd';

export interface ProjectSummaryRecord {
  id: string;
  name: string;
  projectType: ProjectType;
  assetLibraryId: string | null;
  clipLibraryId: string | null;
  clipLastFolderId: string | null;
  linkedScriptProjectId: string | null;
  linkedAdProjectId: string | null;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  projectType: ProjectType;
  assetLibraryId: string | null;
  clipLibraryId: string | null;
  clipLastFolderId: string | null;
  linkedScriptProjectId: string | null;
  linkedAdProjectId: string | null;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  nodesJson: string;
  edgesJson: string;
  viewportJson: string;
  historyJson: string;
  colorLabelsJson: string;
  scriptWelcomeSkipped: boolean;
}

export interface ProjectHistoryRecord {
  projectId: string;
  historyJson: string;
}

export interface ProjectGraphRecord {
  record: ProjectRecord;
  graphRevision: number;
  persistenceVersion: number;
}

export interface ProjectGraphHistoryRecord {
  projectId: string;
  historyJson: string;
  graphRevision: number;
}

export interface ProjectGraphNodePatch {
  nodeId: string;
  nodeType?: string | null;
  nodeJson: string;
}

export interface ProjectGraphEdgePatch {
  edgeId: string;
  source?: string | null;
  target?: string | null;
  edgeJson: string;
}

export interface ProjectGraphHistoryPatch {
  historyJson: string;
}

export interface ProjectGraphMetaPatch {
  name?: string;
  projectType?: ProjectType;
  assetLibraryId?: string | null;
  clipLibraryId?: string | null;
  clipLastFolderId?: string | null;
  linkedScriptProjectId?: string | null;
  linkedAdProjectId?: string | null;
  colorLabelsJson?: string;
  scriptWelcomeSkipped?: boolean;
}

export interface ProjectGraphPatch {
  projectId: string;
  upsertNodes?: ProjectGraphNodePatch[];
  deleteNodeIds?: string[];
  upsertEdges?: ProjectGraphEdgePatch[];
  deleteEdgeIds?: string[];
  viewportJson?: string;
  history?: ProjectGraphHistoryPatch;
  meta?: ProjectGraphMetaPatch;
  updatedAt: number;
}

export interface ProjectGraphPatchResult {
  projectId: string;
  graphRevision: number;
  nodeCount: number;
}

export interface ProjectGraphValidationResult {
  checkedProjectCount: number;
  issueCount: number;
  issues: string[];
}

export interface OrganizeProjectMediaResult {
  projectId: string;
  rewritten: boolean;
  copiedCount: number;
}

export async function listProjectSummaries(): Promise<ProjectSummaryRecord[]> {
  return await invoke<ProjectSummaryRecord[]>('list_project_summaries');
}

export async function getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
  return await invoke<ProjectRecord | null>('get_project_record', { projectId });
}

export async function getProjectRecordWithoutHistory(projectId: string): Promise<ProjectRecord | null> {
  return await invoke<ProjectRecord | null>('get_project_record_without_history', { projectId });
}

export async function getProjectHistoryRecord(projectId: string): Promise<ProjectHistoryRecord | null> {
  return await invoke<ProjectHistoryRecord | null>('get_project_history_record', { projectId });
}

export async function getProjectGraphRecord(projectId: string): Promise<ProjectGraphRecord | null> {
  return await invoke<ProjectGraphRecord | null>('get_project_graph_record', { projectId });
}

export async function getProjectGraphRecordIfReady(projectId: string): Promise<ProjectGraphRecord | null> {
  return await invoke<ProjectGraphRecord | null>('get_project_graph_record_if_ready', { projectId });
}

export async function getProjectGraphHistory(projectId: string): Promise<ProjectGraphHistoryRecord | null> {
  return await invoke<ProjectGraphHistoryRecord | null>('get_project_graph_history', { projectId });
}

export async function applyProjectGraphPatch(
  patch: ProjectGraphPatch
): Promise<ProjectGraphPatchResult> {
  return await invoke<ProjectGraphPatchResult>('apply_project_graph_patch', { patch });
}

export async function upsertProjectGraphSnapshot(
  record: ProjectRecord
): Promise<ProjectGraphPatchResult> {
  return await invoke<ProjectGraphPatchResult>('upsert_project_graph_snapshot', { record });
}

export async function compactProjectGraphBackup(projectId: string): Promise<boolean> {
  return await invoke<boolean>('compact_project_graph_backup', { projectId });
}

export async function validateProjectGraphStorage(
  projectId?: string
): Promise<ProjectGraphValidationResult> {
  return await invoke<ProjectGraphValidationResult>('validate_project_graph_storage', {
    projectId: projectId ?? null,
  });
}

export async function upsertProjectRecord(record: ProjectRecord): Promise<void> {
  await invoke('upsert_project_record', { record });
}

export async function updateProjectViewportRecord(
  projectId: string,
  viewportJson: string
): Promise<void> {
  await invoke('update_project_viewport_record', { projectId, viewportJson });
}

export async function renameProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number
): Promise<void> {
  await invoke('rename_project_record', { projectId, name, updatedAt });
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  await invoke('delete_project_record', { projectId });
}

export async function organizeProjectMedia(
  projectId: string
): Promise<OrganizeProjectMediaResult> {
  return await invoke<OrganizeProjectMediaResult>('organize_project_media', { projectId });
}

export async function syncStyleTemplateImageRefs(paths: string[]): Promise<void> {
  await invoke('sync_style_template_image_refs', { paths });
}
