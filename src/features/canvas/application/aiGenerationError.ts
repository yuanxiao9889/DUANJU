import i18n from '@/i18n';

export type AiGenerationErrorCategory =
  | 'policyViolation'
  | 'timeout'
  | 'payloadTooLarge'
  | 'endpointMismatch'
  | 'modelUnavailable'
  | 'insufficientBalance'
  | 'rateLimitOrQuota'
  | 'upstreamUnavailable'
  | 'badRequest'
  | 'auth'
  | 'network'
  | 'taskInterrupted'
  | 'unknown';

export interface AiGenerationErrorDiagnostics {
  category: AiGenerationErrorCategory;
  statusCode?: number;
  traceId?: string;
  requestId?: string;
}

export interface PresentedAiGenerationError extends AiGenerationErrorDiagnostics {
  message: string;
  details?: string;
  rawMessage?: string;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractStringFields(error: unknown): { message?: string; details?: string; raw?: string } {
  if (error instanceof Error) {
    const details = stringifyUnknown((error as Error & { details?: unknown }).details);
    return {
      message: error.message,
      details,
      raw: [error.message, details].filter(Boolean).join('\n\n') || undefined,
    };
  }

  if (typeof error === 'string') {
    return { message: error, details: error, raw: error };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const candidate =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      (typeof record.details === 'string' && record.details) ||
      (typeof record.msg === 'string' && record.msg) ||
      undefined;
    const raw = stringifyUnknown(record);
    return {
      message: candidate,
      details: raw,
      raw: [candidate, raw].filter(Boolean).join('\n\n') || undefined,
    };
  }

  return {};
}

function normalizeForMatching(value: string): string {
  return value.trim().toLowerCase();
}

function extractStatusCode(raw: string): number | undefined {
  const candidates = [
    /status_code\s*=\s*(\d{3})/i,
    /status\s*code\s*[:：]?\s*(\d{3})/i,
    /request failed\s+(\d{3})/i,
    /bad response status code\s+(\d{3})/i,
    /HTTP\s+(\d{3})/i,
    /\|\s*(\d{3})\s*\|/,
  ];

  for (const pattern of candidates) {
    const match = raw.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return undefined;
}

function extractTraceId(raw: string): string | undefined {
  const match = raw.match(/traceid\s*[:：]\s*([A-Za-z0-9-]+)/i);
  return match?.[1];
}

function extractRequestId(raw: string): string | undefined {
  const structuredMatch = raw.match(
    /(?:request[_-]?id|x-request-id|req[_-]?id|remote[_-]?logid|logid)["']?\s*[:=：]\s*["']?([A-Za-z0-9_-]+)/i
  );
  if (structuredMatch) {
    return structuredMatch[1];
  }

  const patterns = [
    /request\s+id\s*[:：]\s*([A-Za-z0-9-]+)/i,
    /request[_-]?id\s*[:=：]\s*([A-Za-z0-9-]+)/i,
    /request\s+ID\s+([A-Za-z0-9-]+)/,
    /\(request\s+id\s*[:：]\s*([A-Za-z0-9-]+)\)/i,
    /x-request-id\s*[:=：]\s*([A-Za-z0-9-]+)/i,
    /req[_-]?id\s*[:=：]\s*([A-Za-z0-9-]+)/i,
    /remote[_-]?logid\s*[:=：]\s*([A-Za-z0-9-]+)/i,
    /logid\s*[:=：]\s*([A-Za-z0-9-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function hasAny(normalized: string, needles: string[]): boolean {
  return needles.some((needle) => normalized.includes(needle));
}

function resolveCategory(normalized: string, statusCode?: number): AiGenerationErrorCategory {
  if (
    hasAny(normalized, [
      '违反平台政策',
      'safety system',
      'safety_violations',
      'content policy',
      'policy violation',
      'violated our relevant policies',
      'relevant policies',
      'images we created may have violated',
      'moderation_blocked',
      'image_unsafe',
      'unsafe content',
      'prohibited or unsafe',
      'content generation was blocked',
    ])
  ) {
    return 'policyViolation';
  }

  if (
    statusCode === 504 ||
    hasAny(normalized, [
      'gateway timeout',
      'gateway time-out',
      'timed out',
      'operation timed out',
      'curl: (28)',
      'context deadline exceeded',
      'timeout',
    ])
  ) {
    return 'timeout';
  }

  if (statusCode === 413 || hasAny(normalized, ['请求体过大', 'payload too large', 'request entity too large'])) {
    return 'payloadTooLarge';
  }

  if (
    hasAny(normalized, [
      'only supported on /v1/images/generations and /v1/images/edits',
      'endpoint not supported',
      '/v1/chat/completions endpoint not supported',
    ])
  ) {
    return 'endpointMismatch';
  }

  if (
    hasAny(normalized, [
      'no available channel',
      'model_not_found',
      'model not found',
      'no available account',
      '当前无可用账号',
    ])
  ) {
    return 'modelUnavailable';
  }

  if (hasAny(normalized, ['预扣费额度失败', '用户剩余额度', 'insufficient', '余额不足'])) {
    return 'insufficientBalance';
  }

  if (
    statusCode === 429 ||
    hasAny(normalized, ['usage_limit_reached', 'rate limit', 'too many requests', 'quota exceeded'])
  ) {
    return 'rateLimitOrQuota';
  }

  if (statusCode === 401 || statusCode === 403 || hasAny(normalized, ['invalid token', 'unauthorized', 'forbidden'])) {
    return 'auth';
  }

  if (
    statusCode === 502 ||
    statusCode === 503 ||
    hasAny(normalized, [
      'upstream error',
      'do request failed',
      'bad gateway',
      'service unavailable',
      'broken pipe',
      'no such host',
      'system memory overloaded',
      '消息流出现异常',
    ])
  ) {
    return 'upstreamUnavailable';
  }

  if (statusCode === 400 || hasAny(normalized, ['bad request', 'invalid request', 'json decode error', 'system error'])) {
    return 'badRequest';
  }

  if (hasAny(normalized, ['network error', 'error sending request', 'failed to fetch'])) {
    return 'network';
  }

  if (hasAny(normalized, ['job interrupted by app restart', 'generation job not found', 'job not found'])) {
    return 'taskInterrupted';
  }

  return 'unknown';
}

export function extractAiGenerationErrorDiagnostics(error: unknown): AiGenerationErrorDiagnostics {
  const { raw, message, details } = extractStringFields(error);
  const source = raw || message || details || '';
  const statusCode = extractStatusCode(source);
  const category = resolveCategory(normalizeForMatching(source), statusCode);

  return {
    category,
    statusCode,
    traceId: extractTraceId(source),
    requestId: extractRequestId(source),
  };
}

function formatMessage(category: AiGenerationErrorCategory, statusCode?: number): string {
  const base = i18n.t(`aiError.categories.${category}`, {
    defaultValue: category === 'unknown' ? i18n.t('ai.error') : '',
  });
  if (statusCode) {
    return `${base}\n\n${i18n.t('aiError.statusLine', { code: statusCode })}`;
  }
  return base;
}

export function presentAiGenerationError(error: unknown, fallbackMessage: string): PresentedAiGenerationError {
  const { raw, message, details } = extractStringFields(error);
  const diagnostics = extractAiGenerationErrorDiagnostics(error);
  const rawMessage = raw?.trim() || message?.trim() || details?.trim() || undefined;
  const recognized = diagnostics.category !== 'unknown';

  if (!recognized) {
    const fallback = message?.trim() || fallbackMessage;
    return {
      ...diagnostics,
      message: fallback,
      details: details?.trim() || rawMessage,
      rawMessage,
    };
  }

  return {
    ...diagnostics,
    message: formatMessage(diagnostics.category, diagnostics.statusCode),
    details: rawMessage,
    rawMessage,
  };
}
