import { invoke } from '@tauri-apps/api/core';

export type ProjectType = 'storyboard' | 'script';

export interface ProjectSummaryRecord {
  id: string;
  name: string;
  projectType: ProjectType;
  assetLibraryId: string | null;
  clipLibraryId: string | null;
  clipLastFolderId: string | null;
  linkedScriptProjectId: string | null;
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
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  nodesJson: string;
  edgesJson: string;
  viewportJson: string;
  historyJson: string;
  colorLabelsJson: string;
}

export async function listProjectSummaries(): Promise<ProjectSummaryRecord[]> {
  return await invoke<ProjectSummaryRecord[]>('list_project_summaries');
}

export async function getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
  return await invoke<ProjectRecord | null>('get_project_record', { projectId });
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

export async function syncStyleTemplateImageRefs(paths: string[]): Promise<void> {
  await invoke('sync_style_template_image_refs', { paths });
}
