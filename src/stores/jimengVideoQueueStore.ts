import { isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

import {
  deleteJimengVideoQueueJob,
  listAllJimengVideoQueueJobs,
  type JimengVideoQueueJobRecord,
  upsertJimengVideoQueueJob,
} from "@/commands/jimengVideoQueue";
import {
  checkDreaminaCliStatus,
  resolveJimengDreaminaVideoSubmitIdCache,
  type DreaminaCliStatusCode,
} from "@/commands/dreaminaCli";
import { getProjectRecord, upsertProjectRecord } from "@/commands/projectState";
import { resolveErrorContent } from "@/features/canvas/application/errorDialog";
import { subscribeCanvasNodesDeleted } from "@/features/canvas/application/nodeDeletionEvents";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import {
  CANVAS_NODE_TYPES,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  type CanvasNode,
  type JimengNodeData,
  type JimengVideoResultNodeData,
} from "@/features/canvas/domain/canvasNodes";
import {
  JIMENG_VIDEO_QUEUE_CONCURRENCY_BACKOFF_MAX_MS,
  JIMENG_VIDEO_QUEUE_MAX_ACTIVE_JOBS,
  JIMENG_VIDEO_QUEUE_MAX_ATTEMPTS,
  JIMENG_VIDEO_QUEUE_POLL_INTERVAL_MS,
  JIMENG_VIDEO_QUEUE_RETRY_DELAY_MS,
  canJimengVideoQueueJobBeRescheduled,
  isJimengVideoQueueActiveStatus,
  isJimengVideoQueueServerConcurrencyMessage,
  isJimengVideoQueueTerminalStatus,
  type JimengVideoQueueJob,
  type JimengVideoQueueJobStatus,
  type JimengVideoQueuePayload,
} from "@/features/jimeng/domain/jimengVideoQueue";
import { resolveDreaminaSetupBlockedMessage } from "@/features/jimeng/application/dreaminaSetup";
import {
  queryJimengVideoResult,
  submitJimengVideoJob,
  type QueryJimengVideoResultResponse,
} from "@/features/jimeng/application/jimengVideoSubmission";
import i18n from "@/i18n";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  fromProjectRecord,
  projectToSummary,
  toProjectRecord,
  useProjectStore,
  type Project,
} from "@/stores/projectStore";

interface EnqueueJimengVideoQueueJobInput {
  projectId: string;
  sourceNodeId: string;
  resultNodeId: string;
  title: string;
  scheduledAt: number | null;
  payload: JimengVideoQueuePayload;
}

interface JimengVideoQueueState {
  currentProjectId: string | null;
  jobs: JimengVideoQueueJob[];
  allJobs: JimengVideoQueueJob[];
  isHydrating: boolean;
  isInitialized: boolean;
  initialize: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  closeProject: () => void;
  syncCurrentProjectNodes: () => void;
  enqueueJob: (
    input: EnqueueJimengVideoQueueJobInput,
  ) => Promise<JimengVideoQueueJob>;
  updateJobSchedule: (jobId: string, scheduledAt: number | null) => Promise<void>;
  sendJobNow: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  removeJob: (jobId: string) => Promise<void>;
}

const SCHEDULER_TICK_MS = 1_000;
const SOURCE_NODE_MISSING_GRACE_MS = 5_000;

const STATUS_SORT_ORDER: Record<JimengVideoQueueJobStatus, number> = {
  waiting: 0,
  waitingConcurrency: 1,
  retrying: 2,
  submitting: 3,
  submitted: 4,
  generating: 5,
  failed: 6,
  cancelled: 7,
  completed: 8,
};

let schedulerTimerId: number | null = null;
let isSchedulerTickRunning = false;
let projectViewRequestSeq = 0;
let queueHydrationPromise: Promise<void> | null = null;
const projectLoadedAtById = new Map<string, number>();

const inflightJobIds = new Set<string>();
const nextPollAtByJobId = new Map<string, number>();
const discardedJobIds = new Set<string>();
const concurrencyBackoffAttemptByJobId = new Map<string, number>();

function sortJobs(jobs: readonly JimengVideoQueueJob[]): JimengVideoQueueJob[] {
  return [...jobs].sort((left, right) => {
    const statusDelta =
      STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const leftScheduledAt = left.scheduledAt ?? Number.MAX_SAFE_INTEGER;
    const rightScheduledAt = right.scheduledAt ?? Number.MAX_SAFE_INTEGER;
    if (leftScheduledAt !== rightScheduledAt) {
      return leftScheduledAt - rightScheduledAt;
    }

    return left.createdAt - right.createdAt;
  });
}

function filterJobsForProject(
  allJobs: readonly JimengVideoQueueJob[],
  projectId: string | null,
): JimengVideoQueueJob[] {
  if (!projectId) {
    return [];
  }

  return sortJobs(allJobs.filter((job) => job.projectId === projectId));
}

function syncProjectViewState(
  state: JimengVideoQueueState,
  overrides: Partial<JimengVideoQueueState>,
): JimengVideoQueueState {
  const currentProjectId =
    overrides.currentProjectId !== undefined
      ? overrides.currentProjectId
      : state.currentProjectId;
  const allJobs = overrides.allJobs ?? state.allJobs;

  return {
    ...state,
    ...overrides,
    currentProjectId,
    allJobs,
    jobs:
      overrides.jobs ??
      filterJobsForProject(allJobs, currentProjectId),
  };
}

function serializeJobRecord(job: JimengVideoQueueJob): JimengVideoQueueJobRecord {
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    sourceNodeId: job.sourceNodeId,
    resultNodeId: job.resultNodeId,
    title: job.title,
    status: job.status,
    scheduledAt: job.scheduledAt,
    submitId: job.submitId,
    payloadJson: JSON.stringify(job.payload),
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    warningsJson: JSON.stringify(job.warnings),
    startedAt: job.startedAt,
    nextRetryAt: job.nextRetryAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function parseJobRecord(record: JimengVideoQueueJobRecord): JimengVideoQueueJob {
  return {
    jobId: record.jobId,
    projectId: record.projectId,
    sourceNodeId: record.sourceNodeId,
    resultNodeId: record.resultNodeId,
    title: record.title,
    status: record.status as JimengVideoQueueJobStatus,
    scheduledAt: record.scheduledAt,
    submitId: record.submitId,
    payload: JSON.parse(record.payloadJson) as JimengVideoQueuePayload,
    attemptCount: record.attemptCount,
    maxAttempts: record.maxAttempts,
    lastError: record.lastError,
    warnings: JSON.parse(record.warningsJson || "[]") as string[],
    startedAt: record.startedAt,
    nextRetryAt: record.nextRetryAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeSubmitId(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function resolveResultNodeSubmitId(job: JimengVideoQueueJob): string | null {
  const canvasNode = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === job.resultNodeId);
  const projectNode = useProjectStore
    .getState()
    .currentProject?.nodes.find((node) => node.id === job.resultNodeId);
  const nodeData = (canvasNode?.data ?? projectNode?.data ?? null) as
    | Record<string, unknown>
    | null;

  return nodeData ? normalizeSubmitId(nodeData.submitId) : null;
}

async function resolveCachedSubmitId(job: JimengVideoQueueJob): Promise<string | null> {
  try {
    const response = await resolveJimengDreaminaVideoSubmitIdCache({
      trackingId: job.jobId,
    });
    return normalizeSubmitId(response.submitId);
  } catch (error) {
    console.warn("[jimengQueue] failed to resolve submit id cache", {
      jobId: job.jobId,
      error,
    });
    return null;
  }
}

async function recoverHydratedJobs(
  jobs: JimengVideoQueueJob[],
): Promise<JimengVideoQueueJob[]> {
  const now = Date.now();
  const recoveredJobs: JimengVideoQueueJob[] = [];
  const changedJobs: JimengVideoQueueJob[] = [];

  for (const job of jobs) {
    if (isJimengVideoQueueTerminalStatus(job.status) || inflightJobIds.has(job.jobId)) {
      recoveredJobs.push(job);
      continue;
    }

    const recoveredSubmitId =
      normalizeSubmitId(job.submitId) ??
      resolveResultNodeSubmitId(job) ??
      (await resolveCachedSubmitId(job));

    if (recoveredSubmitId) {
      const recoveredJob: JimengVideoQueueJob = {
        ...job,
        status: "submitted",
        submitId: recoveredSubmitId,
        updatedAt: now,
        lastError: null,
      };
      nextPollAtByJobId.set(recoveredJob.jobId, now);
      recoveredJobs.push(recoveredJob);
      if (job.status !== recoveredJob.status || job.submitId !== recoveredSubmitId) {
        changedJobs.push(recoveredJob);
      }
      continue;
    }

    if (job.status !== "submitting") {
      recoveredJobs.push(job);
      continue;
    }

    const failedJob = buildFailedJob(
      {
        ...job,
        submitId: null,
      },
      i18n.t("jimengQueue.errors.submitInterrupted"),
    );
    recoveredJobs.push(failedJob);
    changedJobs.push(failedJob);
  }

  await Promise.all(changedJobs.map((job) => persistJob(job)));
  return sortJobs(recoveredJobs);
}

function isCurrentProjectOpen(projectId: string): boolean {
  return useProjectStore.getState().currentProjectId === projectId;
}

function hasNode(nodeId: string): boolean {
  return useCanvasStore.getState().nodes.some((node) => node.id === nodeId);
}

function updateProjectSummaryInStore(project: Project): void {
  const summary = projectToSummary(project);
  useProjectStore.setState((state) => ({
    ...state,
    projects: state.projects.map((item) => (item.id === project.id ? summary : item)),
  }));
}

function upsertRuntimeJob(job: JimengVideoQueueJob): void {
  useJimengVideoQueueStore.setState((state) => {
    const nextAllJobs = sortJobs(
      state.allJobs.some((item) => item.jobId === job.jobId)
        ? state.allJobs.map((item) => (item.jobId === job.jobId ? job : item))
        : [...state.allJobs, job],
    );

    return syncProjectViewState(state, {
      allJobs: nextAllJobs,
    });
  });
}

function removeRuntimeJob(jobId: string): void {
  useJimengVideoQueueStore.setState((state) =>
    syncProjectViewState(state, {
      allJobs: state.allJobs.filter((item) => item.jobId !== jobId),
    }),
  );
}

function resolveQueueStatusIsGenerating(status: JimengVideoQueueJobStatus): boolean {
  return (
    status === "submitting" || status === "submitted" || status === "generating"
  );
}

function isJobDiscarded(jobId: string): boolean {
  return discardedJobIds.has(jobId);
}

function buildResultNodePatch(
  job: JimengVideoQueueJob,
): Partial<JimengVideoResultNodeData> {
  return {
    queueJobId: job.jobId,
    queueStatus: job.status,
    queueScheduledAt: job.scheduledAt,
    queueAttemptCount: job.attemptCount,
    queueMaxAttempts: job.maxAttempts,
    submitId: job.submitId,
    isGenerating: resolveQueueStatusIsGenerating(job.status),
    generationStartedAt: resolveQueueStatusIsGenerating(job.status)
      ? (job.startedAt ?? Date.now())
      : null,
    lastError: job.lastError,
  };
}

function buildCompletedJob(
  job: JimengVideoQueueJob,
  warnings: string[],
  now: number,
): JimengVideoQueueJob {
  return {
    ...job,
    status: "completed",
    updatedAt: now,
    warnings,
    completedAt: now,
    lastError: null,
  };
}

function buildCompletedResultNodePatch(
  job: JimengVideoQueueJob,
  primaryResult: QueryJimengVideoResultResponse["videos"][number],
  warnings: string[],
  now: number,
): Partial<JimengVideoResultNodeData> {
  return {
    ...buildResultNodePatch(buildCompletedJob(job, warnings, now)),
    sourceUrl: primaryResult?.sourceUrl ?? null,
    posterSourceUrl: primaryResult?.posterSourceUrl ?? null,
    videoUrl: primaryResult?.videoUrl ?? null,
    previewImageUrl: primaryResult?.previewImageUrl ?? null,
    videoFileName: primaryResult?.fileName ?? null,
    aspectRatio: primaryResult?.aspectRatio ?? "16:9",
    duration: primaryResult?.duration ?? undefined,
    width: primaryResult?.width ?? undefined,
    height: primaryResult?.height ?? undefined,
    lastGeneratedAt: now,
    generationStartedAt: null,
    isGenerating: false,
    lastError: null,
  };
}

function applyCompletedResultNodeToCanvas(
  job: JimengVideoQueueJob,
  primaryResult: QueryJimengVideoResultResponse["videos"][number],
  warnings: string[],
  now: number,
): void {
  if (!hasNode(job.resultNodeId)) {
    return;
  }

  useCanvasStore.getState().updateNodeData(
    job.resultNodeId,
    buildCompletedResultNodePatch(job, primaryResult, warnings, now),
    { historyMode: "skip" },
  );
}

async function ensureResultNodeExists(
  job: JimengVideoQueueJob,
): Promise<JimengVideoQueueJob> {
  if (isJobDiscarded(job.jobId)) {
    return job;
  }

  if (!isCurrentProjectOpen(job.projectId)) {
    return job;
  }

  if (!hasNode(job.sourceNodeId) || hasNode(job.resultNodeId)) {
    return job;
  }

  const { addNode, addEdge, findNodePosition } = useCanvasStore.getState();
  const position = findNodePosition(
    job.sourceNodeId,
    JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
    JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  );
  const nextResultNodeId = addNode(
    CANVAS_NODE_TYPES.jimengVideoResult,
    position,
    {
      sourceNodeId: job.sourceNodeId,
      displayName: job.title,
      queueJobId: job.jobId,
      queueStatus: job.status,
      queueScheduledAt: job.scheduledAt,
      queueAttemptCount: job.attemptCount,
      queueMaxAttempts: job.maxAttempts,
      submitId: job.submitId,
      sourceUrl: null,
      posterSourceUrl: null,
      videoUrl: null,
      previewImageUrl: null,
      videoFileName: null,
      aspectRatio: job.payload.aspectRatio ?? "16:9",
      duration:
        typeof job.payload.durationSeconds === "number"
          ? job.payload.durationSeconds
          : undefined,
      isGenerating: resolveQueueStatusIsGenerating(job.status),
      generationStartedAt: resolveQueueStatusIsGenerating(job.status)
        ? (job.startedAt ?? Date.now())
        : null,
      generationDurationMs: 180000,
      lastGeneratedAt: null,
      lastError: job.lastError,
    } satisfies Partial<JimengVideoResultNodeData>,
    { inheritParentFromNodeId: job.sourceNodeId },
  );
  addEdge(job.sourceNodeId, nextResultNodeId);

  const nextJob: JimengVideoQueueJob = {
    ...job,
    resultNodeId: nextResultNodeId,
    updatedAt: Date.now(),
  };
  await commitJob(nextJob, { flushProject: true });
  return nextJob;
}

function syncCurrentProjectNodesInternal(projectId: string): void {
  if (!isCurrentProjectOpen(projectId)) {
    return;
  }

  const queueState = useJimengVideoQueueStore.getState();
  if (queueState.currentProjectId !== projectId) {
    return;
  }

  const projectJobs = queueState.allJobs.filter((job) => job.projectId === projectId);
  const { updateNodeData } = useCanvasStore.getState();
  const currentNodes = useCanvasStore.getState().nodes;
  const liveJobIds = new Set(projectJobs.map((job) => job.jobId));

  currentNodes.forEach((node: CanvasNode) => {
    const nodeData = node.data as Record<string, unknown>;
    const queueJobId =
      typeof nodeData.queueJobId === "string" ? nodeData.queueJobId : null;
    if (!queueJobId || liveJobIds.has(queueJobId)) {
      return;
    }

    updateNodeData(
      node.id,
      {
        queueJobId: null,
        queueStatus: null,
        queueScheduledAt: null,
        queueAttemptCount: 0,
        queueMaxAttempts: JIMENG_VIDEO_QUEUE_MAX_ATTEMPTS,
      } satisfies Partial<JimengVideoResultNodeData>,
      { historyMode: "skip" },
    );
  });

  projectJobs.forEach((job) => {
    if (hasNode(job.resultNodeId)) {
      updateNodeData(job.resultNodeId, buildResultNodePatch(job), {
        historyMode: "skip",
      });
    }

    if (hasNode(job.sourceNodeId)) {
      const sourcePatch: Partial<JimengNodeData> = {};
      if (
        job.status === "submitted" ||
        job.status === "generating" ||
        job.status === "completed"
      ) {
        sourcePatch.lastSubmittedAt = job.updatedAt;
        sourcePatch.lastError = null;
      } else if (job.status === "failed") {
        sourcePatch.lastError = job.lastError;
      }

      if (Object.keys(sourcePatch).length > 0) {
        updateNodeData(job.sourceNodeId, sourcePatch, { historyMode: "skip" });
      }
    }
  });
}

async function persistJob(job: JimengVideoQueueJob): Promise<void> {
  try {
    await upsertJimengVideoQueueJob(serializeJobRecord(job));
  } catch (error) {
    console.error("[jimengQueue] failed to persist job", error);
  }
}

async function commitJob(
  job: JimengVideoQueueJob,
  options: { flushProject?: boolean; syncNodes?: boolean } = {},
): Promise<void> {
  if (isJobDiscarded(job.jobId)) {
    return;
  }

  upsertRuntimeJob(job);
  await persistJob(job);

  if (options.syncNodes !== false) {
    syncCurrentProjectNodesInternal(job.projectId);
  }

  if (options.flushProject && isCurrentProjectOpen(job.projectId)) {
    await flushCurrentProjectToDiskSafely("updating Jimeng video queue state");
  }
}

function translateDreaminaBlockedMessage(
  code: DreaminaCliStatusCode | null | undefined,
): string {
  return resolveDreaminaSetupBlockedMessage(i18n.t.bind(i18n), code);
}

function resolveJobErrorMessage(error: unknown): string {
  return resolveErrorContent(
    error,
    i18n.t("jimengQueue.errors.submitFailed"),
  ).message;
}

function clearConcurrencyBackoff(jobId: string): void {
  concurrencyBackoffAttemptByJobId.delete(jobId);
}

function resolveNextConcurrencyBackoffDelay(jobId: string): number {
  const currentAttempt = concurrencyBackoffAttemptByJobId.get(jobId) ?? 0;
  const delay = Math.min(
    JIMENG_VIDEO_QUEUE_RETRY_DELAY_MS * 2 ** currentAttempt,
    JIMENG_VIDEO_QUEUE_CONCURRENCY_BACKOFF_MAX_MS,
  );
  concurrencyBackoffAttemptByJobId.set(jobId, currentAttempt + 1);
  return delay;
}

function buildRetryingJob(
  job: JimengVideoQueueJob,
  errorMessage: string,
): JimengVideoQueueJob {
  const now = Date.now();
  const shouldRetry = job.attemptCount < job.maxAttempts;

  return {
    ...job,
    submitId: null,
    status: shouldRetry ? "retrying" : "failed",
    lastError: errorMessage,
    updatedAt: now,
    startedAt: null,
    nextRetryAt: shouldRetry ? now + JIMENG_VIDEO_QUEUE_RETRY_DELAY_MS : null,
    completedAt: shouldRetry ? null : now,
  };
}

function buildAttemptFailureJob(
  job: JimengVideoQueueJob,
  errorMessage: string,
): JimengVideoQueueJob {
  return buildRetryingJob(job, errorMessage);
}

function buildConcurrencyBlockedJob(
  job: JimengVideoQueueJob,
  errorMessage: string,
): JimengVideoQueueJob {
  const now = Date.now();
  const delay = resolveNextConcurrencyBackoffDelay(job.jobId);

  return {
    ...job,
    submitId: null,
    status: "retrying",
    attemptCount: Math.max(0, job.attemptCount - 1),
    lastError: errorMessage,
    updatedAt: now,
    startedAt: null,
    nextRetryAt: now + delay,
    completedAt: null,
  };
}

function buildFailedJob(
  job: JimengVideoQueueJob,
  errorMessage: string,
): JimengVideoQueueJob {
  const now = Date.now();

  return {
    ...job,
    status: "failed",
    lastError: errorMessage,
    updatedAt: now,
    startedAt: null,
    nextRetryAt: null,
    completedAt: now,
  };
}

function canJobStartNow(job: JimengVideoQueueJob, now: number): boolean {
  if (job.status === "retrying") {
    return Boolean(job.nextRetryAt && job.nextRetryAt <= now);
  }

  if (job.status !== "waiting" && job.status !== "waitingConcurrency") {
    return false;
  }

  return !job.scheduledAt || job.scheduledAt <= now;
}

async function loadDetachedProject(projectId: string): Promise<Project | "project-open" | null> {
  if (isCurrentProjectOpen(projectId)) {
    return "project-open";
  }

  const record = await getProjectRecord(projectId);
  if (!record) {
    return null;
  }

  if (isCurrentProjectOpen(projectId)) {
    return "project-open";
  }

  return fromProjectRecord(record);
}

async function persistDetachedProject(project: Project): Promise<boolean> {
  if (isCurrentProjectOpen(project.id)) {
    return false;
  }

  await upsertProjectRecord(toProjectRecord(project));
  updateProjectSummaryInStore(project);
  return true;
}

async function verifyDetachedJobSourceNode(job: JimengVideoQueueJob): Promise<boolean> {
  const detachedProject = await loadDetachedProject(job.projectId);
  if (detachedProject === "project-open") {
    return true;
  }

  if (!detachedProject) {
    return false;
  }

  return detachedProject.nodes.some((node) => node.id === job.sourceNodeId);
}

async function persistCompletedDetachedResult(
  job: JimengVideoQueueJob,
  primaryResult: QueryJimengVideoResultResponse["videos"][number],
  warnings: string[],
  now: number,
): Promise<"persisted" | "project-open" | "missing"> {
  const detachedProject = await loadDetachedProject(job.projectId);
  if (detachedProject === "project-open") {
    return "project-open";
  }

  if (!detachedProject) {
    return "missing";
  }

  let hasResultNode = false;
  const nextNodes = detachedProject.nodes.map((node) => {
    if (node.id === job.resultNodeId) {
      hasResultNode = true;
      return {
        ...node,
        data: {
          ...(node.data as Record<string, unknown>),
          ...buildCompletedResultNodePatch(job, primaryResult, warnings, now),
        },
      };
    }

    if (node.id === job.sourceNodeId) {
      return {
        ...node,
        data: {
          ...(node.data as Record<string, unknown>),
          lastSubmittedAt: now,
          lastError: null,
        },
      };
    }

    return node;
  });

  if (!hasResultNode) {
    return "missing";
  }

  const nextProject: Project = {
    ...detachedProject,
    nodes: nextNodes,
    nodeCount: nextNodes.length,
    updatedAt: now,
  };
  const persisted = await persistDetachedProject(nextProject);
  return persisted ? "persisted" : "project-open";
}

async function discardJobsForDeletedResultNodes(
  nodeIds: readonly string[],
): Promise<void> {
  const currentProjectId = useJimengVideoQueueStore.getState().currentProjectId;
  if (!currentProjectId || nodeIds.length === 0) {
    return;
  }

  const deletedNodeIdSet = new Set(
    nodeIds.map((nodeId) => nodeId.trim()).filter((nodeId) => nodeId.length > 0),
  );
  if (deletedNodeIdSet.size === 0) {
    return;
  }

  const jobsToDiscard = useJimengVideoQueueStore
    .getState()
    .allJobs.filter(
      (job) =>
        job.projectId === currentProjectId &&
        deletedNodeIdSet.has(job.resultNodeId),
    );
  if (jobsToDiscard.length === 0) {
    return;
  }

  jobsToDiscard.forEach((job) => {
    discardedJobIds.add(job.jobId);
    inflightJobIds.delete(job.jobId);
    nextPollAtByJobId.delete(job.jobId);
    clearConcurrencyBackoff(job.jobId);
    removeRuntimeJob(job.jobId);
  });

  await Promise.all(
    jobsToDiscard.map(async (job) => {
      try {
        await deleteJimengVideoQueueJob(job.jobId);
      } catch (error) {
        console.error("[jimengQueue] failed to delete discarded job", error);
      }
    }),
  );

  if (isCurrentProjectOpen(currentProjectId)) {
    await flushCurrentProjectToDiskSafely(
      "removing Jimeng queue jobs for deleted result nodes",
    );
  }
}

function resolveWaitingJobStatus(
  job: JimengVideoQueueJob,
  activeCount: number,
  now: number,
): JimengVideoQueueJobStatus {
  if (job.status === "retrying" && job.nextRetryAt && job.nextRetryAt > now) {
    return "retrying";
  }

  if (job.scheduledAt && job.scheduledAt > now) {
    return "waiting";
  }

  return activeCount >= JIMENG_VIDEO_QUEUE_MAX_ACTIVE_JOBS
    ? "waitingConcurrency"
    : "waiting";
}

async function markJobStatusForCapacity(
  job: JimengVideoQueueJob,
  activeCount: number,
  now: number,
): Promise<void> {
  const nextStatus = resolveWaitingJobStatus(job, activeCount, now);
  if (nextStatus === job.status) {
    return;
  }

  await commitJob(
    {
      ...job,
      status: nextStatus,
      updatedAt: now,
    },
    { syncNodes: true },
  );
}

async function recoverSubmittedInactiveJob(
  job: JimengVideoQueueJob,
  now: number,
): Promise<boolean> {
  if (
    isJimengVideoQueueTerminalStatus(job.status) ||
    isJimengVideoQueueActiveStatus(job.status)
  ) {
    return false;
  }

  const recoveredSubmitId =
    normalizeSubmitId(job.submitId) ?? resolveResultNodeSubmitId(job);
  if (!recoveredSubmitId) {
    return false;
  }

  const recoveredJob: JimengVideoQueueJob = {
    ...job,
    status: "submitted",
    submitId: recoveredSubmitId,
    nextRetryAt: null,
    updatedAt: now,
    lastError: null,
  };
  nextPollAtByJobId.set(recoveredJob.jobId, now);
  clearConcurrencyBackoff(recoveredJob.jobId);
  await commitJob(recoveredJob, { syncNodes: true });
  return true;
}

function findRetryBarrierJob(
  jobs: readonly JimengVideoQueueJob[],
): JimengVideoQueueJob | null {
  const retryingJobs = jobs
    .filter((job) => job.status === "retrying")
    .sort((left, right) => {
      const leftRetryAt = left.nextRetryAt ?? Number.MAX_SAFE_INTEGER;
      const rightRetryAt = right.nextRetryAt ?? Number.MAX_SAFE_INTEGER;
      if (leftRetryAt !== rightRetryAt) {
        return leftRetryAt - rightRetryAt;
      }

      return left.createdAt - right.createdAt;
    });

  return retryingJobs[0] ?? null;
}

async function startJobAttempt(job: JimengVideoQueueJob): Promise<void> {
  if (isJobDiscarded(job.jobId)) {
    return;
  }

  if (inflightJobIds.has(job.jobId)) {
    return;
  }

  if (!isCurrentProjectOpen(job.projectId)) {
    const sourceNodeExists = await verifyDetachedJobSourceNode(job);
    if (!sourceNodeExists) {
      const cancelledJob: JimengVideoQueueJob = {
        ...job,
        status: "cancelled",
        completedAt: Date.now(),
        updatedAt: Date.now(),
        lastError: i18n.t("jimengQueue.errors.sourceNodeMissing"),
      };
      await commitJob(cancelledJob, { flushProject: false });
      return;
    }
  }

  inflightJobIds.add(job.jobId);
  const attemptStartedAt = Date.now();
  let currentJob: JimengVideoQueueJob = {
    ...job,
    status: "submitting",
    attemptCount: job.attemptCount + 1,
    updatedAt: attemptStartedAt,
    startedAt: attemptStartedAt,
    nextRetryAt: null,
    completedAt: null,
    lastError: null,
    warnings: [],
  };

  await commitJob(currentJob, { flushProject: true });

  try {
    const dreaminaStatus = await checkDreaminaCliStatus();
    if (!dreaminaStatus.ready) {
      throw new Error(translateDreaminaBlockedMessage(dreaminaStatus.code));
    }

    const submitResponse = await submitJimengVideoJob({
      prompt: currentJob.payload.prompt,
      trackingId: currentJob.jobId,
      modelVersion: currentJob.payload.modelVersion ?? undefined,
      referenceMode: currentJob.payload.referenceMode ?? undefined,
      aspectRatio: currentJob.payload.aspectRatio ?? undefined,
      durationSeconds: currentJob.payload.durationSeconds ?? undefined,
      videoResolution: currentJob.payload.videoResolution ?? undefined,
      referenceImageSources: currentJob.payload.referenceImageSources,
      referenceVideoSources: currentJob.payload.referenceVideoSources,
      referenceAudioSources: currentJob.payload.referenceAudioSources,
    });

    currentJob = {
      ...currentJob,
      status: "submitted",
      submitId: submitResponse.submitId,
      updatedAt: Date.now(),
      lastError: null,
    };
    if (isJobDiscarded(currentJob.jobId)) {
      return;
    }
    clearConcurrencyBackoff(currentJob.jobId);
    nextPollAtByJobId.set(currentJob.jobId, Date.now());
    await commitJob(currentJob, { flushProject: true });
  } catch (error) {
    if (isJobDiscarded(currentJob.jobId)) {
      return;
    }
    const errorMessage = resolveJobErrorMessage(error);
    currentJob = isJimengVideoQueueServerConcurrencyMessage(errorMessage)
      ? buildConcurrencyBlockedJob(currentJob, errorMessage)
      : (clearConcurrencyBackoff(currentJob.jobId),
        buildFailedJob(currentJob, errorMessage));
    await commitJob(currentJob, { flushProject: true });
  } finally {
    inflightJobIds.delete(job.jobId);
  }
}

async function pollJob(job: JimengVideoQueueJob): Promise<void> {
  if (isJobDiscarded(job.jobId)) {
    nextPollAtByJobId.delete(job.jobId);
    return;
  }

  if (inflightJobIds.has(job.jobId) || !job.submitId) {
    return;
  }

  inflightJobIds.add(job.jobId);
  let workingJob = job;
  const submitId = job.submitId;

  try {
    const response = await queryJimengVideoResult({ submitId });
    const now = Date.now();
    if (isJobDiscarded(workingJob.jobId)) {
      nextPollAtByJobId.delete(workingJob.jobId);
      return;
    }
    const primaryResult = response.videos[0] ?? null;

    if (primaryResult) {
      if (isCurrentProjectOpen(workingJob.projectId)) {
        workingJob = await ensureResultNodeExists(workingJob);
        applyCompletedResultNodeToCanvas(
          workingJob,
          primaryResult,
          response.warnings,
          now,
        );
      } else {
        const detachedPersistResult = await persistCompletedDetachedResult(
          workingJob,
          primaryResult,
          response.warnings,
          now,
        );
        if (detachedPersistResult === "project-open") {
          workingJob = await ensureResultNodeExists(workingJob);
          applyCompletedResultNodeToCanvas(
            workingJob,
            primaryResult,
            response.warnings,
            now,
          );
        } else if (detachedPersistResult === "missing") {
          const failedJob = buildAttemptFailureJob(
            workingJob,
            i18n.t("node.jimeng.queueResultNodeMissing"),
          );
          clearConcurrencyBackoff(workingJob.jobId);
          nextPollAtByJobId.delete(workingJob.jobId);
          await commitJob(failedJob, { flushProject: false });
          return;
        }
      }

      const completedJob = buildCompletedJob(
        workingJob,
        response.warnings,
        now,
      );
      clearConcurrencyBackoff(workingJob.jobId);
      nextPollAtByJobId.delete(workingJob.jobId);
      await commitJob(completedJob, { flushProject: true, syncNodes: false });
      return;
    }

    if (response.pending) {
      const nextStatus =
        workingJob.status === "generating" ? workingJob.status : "generating";
      const generatingJob: JimengVideoQueueJob = {
        ...workingJob,
        status: nextStatus,
        updatedAt: now,
        warnings: response.warnings,
        lastError: null,
      };
      nextPollAtByJobId.set(workingJob.jobId, now + JIMENG_VIDEO_QUEUE_POLL_INTERVAL_MS);
      await commitJob(generatingJob, {
        flushProject: nextStatus !== workingJob.status,
      });
      return;
    }

    if (response.status === "failed") {
      const failureMessage =
        response.failureMessage?.trim() ||
        response.warnings.find((warning) => warning.trim().length > 0) ||
        i18n.t("jimengQueue.errors.submitFailed");
      const failedJob = buildAttemptFailureJob(
        workingJob,
        failureMessage,
      );
      clearConcurrencyBackoff(workingJob.jobId);
      nextPollAtByJobId.delete(workingJob.jobId);
      await commitJob(failedJob, { flushProject: true });
      return;
    }

    const failedJob = buildAttemptFailureJob(
      workingJob,
      response.failureMessage?.trim() || i18n.t("jimengQueue.errors.resultEmpty"),
    );
    clearConcurrencyBackoff(workingJob.jobId);
    nextPollAtByJobId.delete(workingJob.jobId);
    await commitJob(failedJob, { flushProject: true });
  } catch (error) {
    if (isJobDiscarded(workingJob.jobId)) {
      nextPollAtByJobId.delete(workingJob.jobId);
      return;
    }
    nextPollAtByJobId.set(workingJob.jobId, Date.now() + JIMENG_VIDEO_QUEUE_POLL_INTERVAL_MS);

    const warningJob: JimengVideoQueueJob = {
      ...workingJob,
      status: "generating",
      updatedAt: Date.now(),
      lastError: resolveJobErrorMessage(error),
    };
    await commitJob(warningJob, { flushProject: false });
  } finally {
    inflightJobIds.delete(job.jobId);
  }
}

subscribeCanvasNodesDeleted((nodeIds) => {
  void discardJobsForDeletedResultNodes(nodeIds);
});

async function schedulerTick(): Promise<void> {
  if (isSchedulerTickRunning) {
    return;
  }

  const queueState = useJimengVideoQueueStore.getState();
  if (queueState.allJobs.length === 0) {
    return;
  }

  isSchedulerTickRunning = true;
  try {
    const now = Date.now();
    const jobs = sortJobs(queueState.allJobs);
    const currentProjectId = queueState.currentProjectId;
    const currentProjectLoadedAt = currentProjectId
      ? (projectLoadedAtById.get(currentProjectId) ?? 0)
      : 0;

    for (const job of jobs) {
      if (isJimengVideoQueueTerminalStatus(job.status)) {
        continue;
      }

      if (job.projectId !== currentProjectId) {
        continue;
      }

      const shouldDeferMissingNodeChecks =
        now - currentProjectLoadedAt < SOURCE_NODE_MISSING_GRACE_MS;
      if (shouldDeferMissingNodeChecks) {
        continue;
      }

      if (!hasNode(job.sourceNodeId)) {
        const cancelledJob: JimengVideoQueueJob = {
          ...job,
          status: "cancelled",
          completedAt: now,
          updatedAt: now,
          lastError: i18n.t("jimengQueue.errors.sourceNodeMissing"),
        };
        await commitJob(cancelledJob, { flushProject: true });
        continue;
      }

      if (!hasNode(job.resultNodeId)) {
        await ensureResultNodeExists(job);
      }
    }

    let freshJobs = sortJobs(useJimengVideoQueueStore.getState().allJobs);
    for (const job of freshJobs) {
      await recoverSubmittedInactiveJob(job, now);
    }

    freshJobs = sortJobs(useJimengVideoQueueStore.getState().allJobs);
    const activeJobs = freshJobs.filter((job) =>
      isJimengVideoQueueActiveStatus(job.status),
    );
    const retryBarrierJob = findRetryBarrierJob(freshJobs);
    const capacityBlockCount =
      activeJobs.length > 0 ? activeJobs.length : retryBarrierJob ? 1 : 0;

    for (const job of freshJobs) {
      if (job.status === "waiting" || job.status === "waitingConcurrency") {
        await markJobStatusForCapacity(job, capacityBlockCount, now);
      }
    }

    freshJobs = sortJobs(useJimengVideoQueueStore.getState().allJobs);
    const refreshedActiveJobs = freshJobs.filter((job) =>
      isJimengVideoQueueActiveStatus(job.status),
    );
    const refreshedRetryBarrierJob = findRetryBarrierJob(freshJobs);

    if (refreshedActiveJobs.length < JIMENG_VIDEO_QUEUE_MAX_ACTIVE_JOBS) {
      if (refreshedRetryBarrierJob) {
        if (canJobStartNow(refreshedRetryBarrierJob, now)) {
          void startJobAttempt(refreshedRetryBarrierJob);
        }
      } else {
        const nextRunnableJob = freshJobs.find(
          (candidate) =>
            (candidate.status === "waiting" ||
              candidate.status === "waitingConcurrency") &&
            canJobStartNow(candidate, now),
        );
        if (nextRunnableJob) {
          void startJobAttempt(nextRunnableJob);
        }
      }
    }

    const jobsToPoll = useJimengVideoQueueStore
      .getState()
      .allJobs.filter(
        (candidate) =>
          (candidate.status === "submitted" || candidate.status === "generating") &&
          candidate.submitId &&
          (nextPollAtByJobId.get(candidate.jobId) ?? 0) <= now,
      );
    for (const jobToPoll of jobsToPoll) {
      void pollJob(jobToPoll);
    }
  } finally {
    isSchedulerTickRunning = false;
  }
}

function ensureSchedulerRunning(): void {
  if (schedulerTimerId !== null) {
    return;
  }

  schedulerTimerId = window.setInterval(() => {
    void schedulerTick();
  }, SCHEDULER_TICK_MS);
  void schedulerTick();
}

export const useJimengVideoQueueStore = create<JimengVideoQueueState>(
  (set, get) => ({
    currentProjectId: null,
    jobs: [],
    allJobs: [],
    isHydrating: false,
    isInitialized: false,

    initialize: async () => {
      if (get().isInitialized) {
        ensureSchedulerRunning();
        return;
      }

      if (!isTauri()) {
        set((state) =>
          syncProjectViewState(state, {
            allJobs: [],
            isHydrating: false,
            isInitialized: true,
          }),
        );
        return;
      }

      if (queueHydrationPromise) {
        return queueHydrationPromise;
      }

      set((state) => syncProjectViewState(state, { isHydrating: true }));

      queueHydrationPromise = (async () => {
        try {
          const records = await listAllJimengVideoQueueJobs();
          const recoveredJobs = await recoverHydratedJobs(records.map(parseJobRecord));
          set((state) =>
            syncProjectViewState(state, {
              allJobs: recoveredJobs,
              isHydrating: false,
              isInitialized: true,
            }),
          );

          const currentProjectId = get().currentProjectId;
          if (currentProjectId) {
            syncCurrentProjectNodesInternal(currentProjectId);
          }
          ensureSchedulerRunning();
        } catch (error) {
          console.error("[jimengQueue] failed to hydrate jobs", error);
          set((state) =>
            syncProjectViewState(state, {
              isHydrating: false,
            }),
          );
        } finally {
          queueHydrationPromise = null;
        }
      })();

      return queueHydrationPromise;
    },

    openProject: async (projectId) => {
      const requestSeq = ++projectViewRequestSeq;
      set((state) =>
        syncProjectViewState(state, {
          currentProjectId: projectId,
          isHydrating: !state.isInitialized,
        }),
      );
      projectLoadedAtById.set(projectId, Date.now());

      await get().initialize();
      if (requestSeq !== projectViewRequestSeq) {
        return;
      }

      set((state) =>
        syncProjectViewState(state, {
          currentProjectId: projectId,
          isHydrating: false,
        }),
      );
      syncCurrentProjectNodesInternal(projectId);
      ensureSchedulerRunning();
    },

    closeProject: () => {
      projectViewRequestSeq += 1;
      const currentProjectId = get().currentProjectId;
      if (currentProjectId) {
        projectLoadedAtById.delete(currentProjectId);
        get()
          .allJobs.filter((job) => job.projectId === currentProjectId)
          .forEach((job) => clearConcurrencyBackoff(job.jobId));
      }

      set((state) =>
        syncProjectViewState(state, {
          currentProjectId: null,
          jobs: [],
          isHydrating: false,
        }),
      );
    },

    syncCurrentProjectNodes: () => {
      const projectId = get().currentProjectId;
      if (!projectId) {
        return;
      }

      syncCurrentProjectNodesInternal(projectId);
    },

    enqueueJob: async (input) => {
      const now = Date.now();
      const job: JimengVideoQueueJob = {
        jobId: uuidv4(),
        projectId: input.projectId,
        sourceNodeId: input.sourceNodeId,
        resultNodeId: input.resultNodeId,
        title: input.title,
        status: "waiting",
        scheduledAt: input.scheduledAt,
        submitId: null,
        payload: input.payload,
        attemptCount: 0,
        maxAttempts: JIMENG_VIDEO_QUEUE_MAX_ATTEMPTS,
        lastError: null,
        warnings: [],
        startedAt: null,
        nextRetryAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      await commitJob(job, { syncNodes: true });
      ensureSchedulerRunning();
      return job;
    },

    updateJobSchedule: async (jobId, scheduledAt) => {
      const currentProjectId = get().currentProjectId;
      const job = get().allJobs.find((item) => item.jobId === jobId);
      if (!job || !currentProjectId || job.projectId !== currentProjectId) {
        return;
      }
      if (!canJimengVideoQueueJobBeRescheduled(job.status)) {
        return;
      }

      const now = Date.now();
      await commitJob(
        {
          ...job,
          status: "waiting",
          scheduledAt,
          submitId: job.status === "failed" ? null : job.submitId,
          attemptCount: job.status === "failed" ? 0 : job.attemptCount,
          nextRetryAt: null,
          updatedAt: now,
          lastError: job.status === "failed" ? null : job.lastError,
          warnings: job.status === "failed" ? [] : job.warnings,
          completedAt: job.status === "failed" ? null : job.completedAt,
        },
        { syncNodes: true, flushProject: true },
      );
      clearConcurrencyBackoff(job.jobId);
      ensureSchedulerRunning();
    },

    sendJobNow: async (jobId) => {
      const job = get().allJobs.find((item) => item.jobId === jobId);
      if (!job || !canJimengVideoQueueJobBeRescheduled(job.status)) {
        return;
      }

      await commitJob(
        {
          ...job,
          status: "waiting",
          scheduledAt: null,
          nextRetryAt: null,
          completedAt: null,
          lastError: null,
          updatedAt: Date.now(),
        },
        { syncNodes: true, flushProject: true },
      );
      clearConcurrencyBackoff(job.jobId);
      ensureSchedulerRunning();
    },

    cancelJob: async (jobId) => {
      const job = get().allJobs.find((item) => item.jobId === jobId);
      if (!job) {
        return;
      }

      if (
        job.status !== "waiting" &&
        job.status !== "waitingConcurrency" &&
        job.status !== "retrying"
      ) {
        return;
      }

      await commitJob(
        {
          ...job,
          status: "cancelled",
          updatedAt: Date.now(),
          completedAt: Date.now(),
          nextRetryAt: null,
          lastError: null,
        },
        { syncNodes: true, flushProject: true },
      );
      clearConcurrencyBackoff(job.jobId);
    },

    retryJob: async (jobId) => {
      const job = get().allJobs.find((item) => item.jobId === jobId);
      if (!job || job.status !== "failed") {
        return;
      }

      await commitJob(
        {
          ...job,
          status: "waiting",
          submitId: null,
          attemptCount: 0,
          lastError: null,
          warnings: [],
          startedAt: null,
          nextRetryAt: null,
          completedAt: null,
          updatedAt: Date.now(),
        },
        { syncNodes: true, flushProject: true },
      );
      clearConcurrencyBackoff(job.jobId);
      ensureSchedulerRunning();
    },

    removeJob: async (jobId) => {
      const currentProjectId = get().currentProjectId;
      const job = get().allJobs.find((item) => item.jobId === jobId);
      if (!job || !currentProjectId || job.projectId !== currentProjectId) {
        return;
      }

      if (isCurrentProjectOpen(job.projectId) && hasNode(job.resultNodeId)) {
        useCanvasStore.getState().updateNodeData(
          job.resultNodeId,
          {
            queueJobId: null,
            queueStatus: null,
            queueScheduledAt: null,
            queueAttemptCount: 0,
            queueMaxAttempts: JIMENG_VIDEO_QUEUE_MAX_ATTEMPTS,
          } satisfies Partial<JimengVideoResultNodeData>,
          { historyMode: "skip" },
        );
      }

      removeRuntimeJob(jobId);
      nextPollAtByJobId.delete(jobId);
      clearConcurrencyBackoff(jobId);
      try {
        await deleteJimengVideoQueueJob(jobId);
      } catch (error) {
        console.error("[jimengQueue] failed to delete job", error);
      }
      if (isCurrentProjectOpen(job.projectId)) {
        await flushCurrentProjectToDiskSafely("removing Jimeng queue job");
      }
    },
  }),
);
