import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '@/lib/tauriRuntime';

function getCurrentWindowLabel(): string | null {
  if (!isTauriRuntime()) {
    return null;
  }
  return getCurrentWindow().label;
}

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

export interface CommerceAgentThreadRecord {
  projectId: string;
  threadId: string;
  title: string;
  messagesJson: string;
  stateJson: string;
  createdAt: number;
  updatedAt: number;
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
  return await invoke<ProjectGraphPatchResult>('apply_project_graph_patch', {
    patch,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function upsertProjectGraphSnapshot(
  record: ProjectRecord
): Promise<ProjectGraphPatchResult> {
  return await invoke<ProjectGraphPatchResult>('upsert_project_graph_snapshot', {
    record,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function compactProjectGraphBackup(projectId: string): Promise<boolean> {
  return await invoke<boolean>('compact_project_graph_backup', {
    projectId,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function validateProjectGraphStorage(
  projectId?: string
): Promise<ProjectGraphValidationResult> {
  return await invoke<ProjectGraphValidationResult>('validate_project_graph_storage', {
    projectId: projectId ?? null,
  });
}

export async function upsertProjectRecord(record: ProjectRecord): Promise<void> {
  await invoke('upsert_project_record', {
    record,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function updateProjectViewportRecord(
  projectId: string,
  viewportJson: string
): Promise<void> {
  await invoke('update_project_viewport_record', {
    projectId,
    viewportJson,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function listCommerceAgentThreads(
  projectId: string
): Promise<CommerceAgentThreadRecord[]> {
  return await invoke<CommerceAgentThreadRecord[]>('list_commerce_agent_threads', {
    projectId,
  });
}

export async function getCommerceAgentThread(
  projectId: string,
  threadId: string
): Promise<CommerceAgentThreadRecord | null> {
  return await invoke<CommerceAgentThreadRecord | null>('get_commerce_agent_thread', {
    projectId,
    threadId,
  });
}

export async function upsertCommerceAgentThread(
  record: CommerceAgentThreadRecord
): Promise<void> {
  await invoke('upsert_commerce_agent_thread', {
    record,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function deleteCommerceAgentThread(
  projectId: string,
  threadId: string
): Promise<void> {
  await invoke('delete_commerce_agent_thread', {
    projectId,
    threadId,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function renameProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number
): Promise<void> {
  await invoke('rename_project_record', {
    projectId,
    name,
    updatedAt,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  await invoke('delete_project_record', {
    projectId,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function organizeProjectMedia(
  projectId: string
): Promise<OrganizeProjectMediaResult> {
  return await invoke<OrganizeProjectMediaResult>('organize_project_media', {
    projectId,
    windowLabel: getCurrentWindowLabel(),
  });
}

export async function syncStyleTemplateImageRefs(paths: string[]): Promise<void> {
  await invoke('sync_style_template_image_refs', { paths });
}
