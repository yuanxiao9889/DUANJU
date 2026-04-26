import { invoke } from "@tauri-apps/api/core";

export interface JimengVideoQueueJobRecord {
  jobId: string;
  projectId: string;
  sourceNodeId: string;
  resultNodeId: string;
  title: string;
  status: string;
  scheduledAt: number | null;
  submitId: string | null;
  payloadJson: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  warningsJson: string;
  startedAt: number | null;
  nextRetryAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export async function listJimengVideoQueueJobs(
  projectId: string,
): Promise<JimengVideoQueueJobRecord[]> {
  return await invoke<JimengVideoQueueJobRecord[]>(
    "list_jimeng_video_queue_jobs",
    { projectId },
  );
}

export async function upsertJimengVideoQueueJob(
  record: JimengVideoQueueJobRecord,
): Promise<void> {
  await invoke("upsert_jimeng_video_queue_job", { record });
}

export async function deleteJimengVideoQueueJob(jobId: string): Promise<void> {
  await invoke("delete_jimeng_video_queue_job", { jobId });
}
