import { invoke } from '@tauri-apps/api/core';

export interface ErrorLogItemRecord {
  id: string;
  userId: number;
  type: number;
  content: string;
  username: string;
  tokenName: string;
  modelName: string;
  quota: number;
  promptTokens: number;
  completionTokens: number;
  useTime: number;
  isStream: boolean;
  channel: number;
  channelName: string;
  tokenId: number;
  group: string;
  ip: string;
  requestId: string | null;
  other: string;
  projectId: string | null;
  nodeId: string | null;
  sourceType: string;
  failureStage: string;
  providerId: string | null;
  model: string | null;
  requestSize: string | null;
  aspectRatio: string | null;
  jobId: string | null;
  externalTaskId: string | null;
  traceId: string | null;
  category: string | null;
  statusCode: number | null;
  message: string;
  details: string | null;
  contextJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function listErrorLogItems(): Promise<ErrorLogItemRecord[]> {
  return await invoke<ErrorLogItemRecord[]>('list_error_log_items');
}

export async function upsertErrorLogItem(record: ErrorLogItemRecord): Promise<void> {
  await invoke('upsert_error_log_item', { record });
}

export async function deleteErrorLogItem(itemId: string): Promise<void> {
  await invoke('delete_error_log_item', { itemId });
}

export async function clearErrorLogItems(): Promise<void> {
  await invoke('clear_error_log_items');
}

export async function pruneErrorLogItems(): Promise<void> {
  await invoke('prune_error_log_items');
}
