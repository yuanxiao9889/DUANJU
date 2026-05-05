import type { ErrorLogItemRecord } from '@/commands/errorLog';
import { upsertErrorLogItem } from '@/commands/errorLog';
import { useProjectStore } from '@/stores/projectStore';

import type { AiGenerationErrorCategory } from './aiGenerationError';
import { extractAiGenerationErrorDiagnostics } from './aiGenerationError';
import type { GenerationDebugContext } from './generationErrorReport';

const MAX_MESSAGE_LENGTH = 800;
const MAX_DETAILS_LENGTH = 4000;
const MAX_CONTEXT_JSON_LENGTH = 6000;
const MAX_OTHER_JSON_LENGTH = 8000;
const NEW_API_ERROR_LOG_TYPE = 5;

export interface ImageGenerationErrorLogInput {
  nodeId?: string | null;
  sourceType?: GenerationDebugContext['sourceType'];
  failureStage: 'submit' | 'run';
  errorMessage: string;
  errorDetails?: string | null;
  context?: unknown;
  errorCategory?: AiGenerationErrorCategory;
  statusCode?: number;
  traceId?: string;
  requestId?: string;
  jobId?: string | null;
  externalTaskId?: string | null;
  providerId?: string | null;
  startedAt?: number | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function truncateText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...(${normalized.length} chars)`;
}

function redactSensitiveText(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-data-url]')
    .replace(/\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '[redacted-local-path]')
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{16,}\b/g, '[redacted-api-key]')
    .replace(/(["']?(?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[redacted]');
}

function stringifySafe(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveUseTimeSeconds(startedAt: number | null | undefined, endedAt: number): number {
  if (!startedAt || !Number.isFinite(startedAt) || startedAt <= 0 || endedAt < startedAt) {
    return 0;
  }
  return Math.max(0, Math.round((endedAt - startedAt) / 1000));
}

function parseJsonSafe(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sanitizeContext(context: unknown): Partial<GenerationDebugContext> {
  const raw = (context ?? {}) as Partial<GenerationDebugContext>;
  return {
    sourceType: raw.sourceType ?? 'unknown',
    providerId: normalizeNullableText(raw.providerId) ?? undefined,
    requestModel: normalizeNullableText(raw.requestModel) ?? undefined,
    requestSize: normalizeNullableText(raw.requestSize) ?? undefined,
    effectiveRequestSize: normalizeNullableText(raw.effectiveRequestSize) ?? undefined,
    requestAspectRatio: normalizeNullableText(raw.requestAspectRatio) ?? undefined,
    referenceImageCount: typeof raw.referenceImageCount === 'number'
      ? raw.referenceImageCount
      : undefined,
    referenceImagePlaceholders: Array.isArray(raw.referenceImagePlaceholders)
      ? raw.referenceImagePlaceholders
      : undefined,
    referenceImageOptimization: raw.referenceImageOptimization
      ? {
        applied: raw.referenceImageOptimization.applied,
        inputCount: raw.referenceImageOptimization.inputCount,
        totalBeforeBytes: raw.referenceImageOptimization.totalBeforeBytes,
        totalAfterBytes: raw.referenceImageOptimization.totalAfterBytes,
        items: raw.referenceImageOptimization.items.map((item) => ({
          source: '[redacted]',
          optimizedSource: '[redacted]',
          originalFormat: item.originalFormat,
          outputFormat: item.outputFormat,
          originalWidth: item.originalWidth,
          originalHeight: item.originalHeight,
          outputWidth: item.outputWidth,
          outputHeight: item.outputHeight,
          originalBytes: item.originalBytes,
          outputBytes: item.outputBytes,
          resized: item.resized,
          transparent: item.transparent,
        })),
      }
      : undefined,
    resolutionDowngrade: raw.resolutionDowngrade,
    appVersion: normalizeNullableText(raw.appVersion) ?? undefined,
    osName: normalizeNullableText(raw.osName) ?? undefined,
    osVersion: normalizeNullableText(raw.osVersion) ?? undefined,
    osBuild: normalizeNullableText(raw.osBuild) ?? undefined,
    networkProxySummary: normalizeNullableText(raw.networkProxySummary) ?? undefined,
    userAgent: normalizeNullableText(raw.userAgent) ?? undefined,
  };
}

function buildErrorLogId(input: {
  projectId: string | null;
  nodeId: string | null;
  jobId: string | null;
  requestId: string | null;
  failureStage: string;
  createdAt: number;
}): string {
  const stableTaskId = input.jobId || input.requestId || input.nodeId || String(input.createdAt);
  return [
    'image-generation-error',
    input.projectId || 'global',
    input.nodeId || 'unknown-node',
    stableTaskId,
    input.failureStage,
  ].join(':');
}

function buildNewApiOtherJson(input: {
  projectId: string | null;
  nodeId: string | null;
  sourceType: string;
  failureStage: 'submit' | 'run';
  providerId: string | null;
  modelName: string | null;
  requestSize: string | null;
  aspectRatio: string | null;
  jobId: string | null;
  externalTaskId: string | null;
  traceId: string | null;
  category: string | null;
  statusCode: number | null;
  details: string | null;
  contextJson: string | null;
}): string {
  const other = {
    app: 'storyboard-copilot',
    log_schema: 'new-api.error-log-compatible',
    project_id: input.projectId,
    node_id: input.nodeId,
    source_type: input.sourceType,
    failure_stage: input.failureStage,
    provider_id: input.providerId,
    model_name: input.modelName,
    request_size: input.requestSize,
    aspect_ratio: input.aspectRatio,
    internal_job_id: input.jobId,
    external_task_id: input.externalTaskId,
    trace_id: input.traceId,
    error_category: input.category,
    status_code: input.statusCode,
    redacted_details: input.details,
    redacted_context: parseJsonSafe(input.contextJson),
  };
  return truncateText(stringifySafe(other), MAX_OTHER_JSON_LENGTH) ?? '{}';
}

export function buildErrorLogReport(record: ErrorLogItemRecord): string {
  const lines = [
    '# Image Generation Error Log',
    '',
    `- Time: ${new Date(record.createdAt).toLocaleString()}`,
    `- Source: ${record.sourceType || 'unknown'}`,
    `- Failure Stage: ${record.failureStage || 'unknown'}`,
    `- Channel: ${record.channelName || record.providerId || 'unknown'}`,
    `- Model: ${record.modelName || record.model || 'unknown'}`,
    `- Request ID: ${record.requestId || 'not extracted'}`,
    `- Trace ID: ${record.traceId || 'not extracted'}`,
    `- Internal Job ID: ${record.jobId || 'none'}`,
    `- External Task ID: ${record.externalTaskId || 'none'}`,
    `- Category: ${record.category || 'unknown'}`,
    `- Status Code: ${record.statusCode ?? 'unknown'}`,
    `- Use Time: ${record.useTime || 0}s`,
    '',
    '## Error',
    record.content || record.message || 'unknown error',
  ];

  if (record.details) {
    lines.push('', '## Details', record.details);
  }
  if (record.contextJson) {
    lines.push('', '## Redacted Context', record.contextJson);
  }

  return lines.join('\n');
}

export async function recordImageGenerationErrorLog(
  input: ImageGenerationErrorLogInput
): Promise<void> {
  const currentProject = useProjectStore.getState().getCurrentProject();
  const projectId = currentProject?.id ?? null;
  const context = sanitizeContext(input.context);
  const diagnostics = extractAiGenerationErrorDiagnostics(
    [input.errorMessage, input.errorDetails].filter(Boolean).join('\n\n')
  );
  const createdAt = Date.now();
  const providerId =
    normalizeNullableText(input.providerId)
    ?? normalizeNullableText(context.providerId);
  const requestId = normalizeNullableText(input.requestId) ?? diagnostics.requestId ?? null;
  const traceId = normalizeNullableText(input.traceId) ?? diagnostics.traceId ?? null;
  const statusCode = input.statusCode ?? diagnostics.statusCode ?? null;
  const category = input.errorCategory ?? diagnostics.category;
  const nodeId = normalizeNullableText(input.nodeId);
  const jobId = normalizeNullableText(input.jobId);
  const modelName = normalizeNullableText(context.requestModel);
  const requestSize = normalizeNullableText(context.effectiveRequestSize) ?? normalizeNullableText(context.requestSize);
  const aspectRatio = normalizeNullableText(context.requestAspectRatio);
  const message = truncateText(redactSensitiveText(input.errorMessage), MAX_MESSAGE_LENGTH) ?? 'Generation failed';
  const details = truncateText(
    redactSensitiveText(input.errorDetails ?? stringifySafe(input.errorMessage)),
    MAX_DETAILS_LENGTH
  );
  const contextJson = truncateText(stringifySafe(context), MAX_CONTEXT_JSON_LENGTH);
  const normalizedCategory = category && category !== 'unknown' ? category : null;
  const other = buildNewApiOtherJson({
    projectId,
    nodeId,
    sourceType: input.sourceType ?? context.sourceType ?? 'unknown',
    failureStage: input.failureStage,
    providerId,
    modelName,
    requestSize,
    aspectRatio,
    jobId,
    externalTaskId: normalizeNullableText(input.externalTaskId),
    traceId,
    category: normalizedCategory,
    statusCode,
    details,
    contextJson,
  });

  const record: ErrorLogItemRecord = {
    id: buildErrorLogId({
      projectId,
      nodeId,
      jobId,
      requestId,
      failureStage: input.failureStage,
      createdAt,
    }),
    userId: 0,
    type: NEW_API_ERROR_LOG_TYPE,
    content: message,
    username: '',
    tokenName: '',
    modelName: modelName ?? '',
    quota: 0,
    promptTokens: 0,
    completionTokens: 0,
    useTime: resolveUseTimeSeconds(input.startedAt, createdAt),
    isStream: false,
    channel: 0,
    channelName: providerId ?? '',
    tokenId: 0,
    group: '',
    ip: '',
    requestId,
    other,
    projectId,
    nodeId,
    sourceType: input.sourceType ?? context.sourceType ?? 'unknown',
    failureStage: input.failureStage,
    providerId,
    model: modelName,
    requestSize,
    aspectRatio,
    jobId,
    externalTaskId: normalizeNullableText(input.externalTaskId),
    traceId,
    category: normalizedCategory,
    statusCode,
    message,
    details,
    contextJson,
    createdAt,
    updatedAt: createdAt,
  };

  await upsertErrorLogItem(record);
}
