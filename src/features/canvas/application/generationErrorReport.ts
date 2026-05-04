import {
  type AiGenerationErrorCategory,
  extractAiGenerationErrorDiagnostics,
} from '@/features/canvas/application/aiGenerationError';

export interface GenerationDebugContext {
  sourceType: 'imageEdit' | 'storyboardGen' | 'multiAngleImage' | 'unknown';
  providerId?: string;
  requestModel?: string;
  requestSize?: string;
  requestAspectRatio?: string;
  prompt?: string;
  extraParams?: Record<string, unknown>;
  referenceImageCount?: number;
  referenceImagePlaceholders?: string[];
  appVersion?: string;
  osName?: string;
  osVersion?: string;
  osBuild?: string;
  userAgent?: string;
}

export const CURRENT_RUNTIME_SESSION_ID = `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let runtimeDiagnosticsPromise: Promise<Pick<
  GenerationDebugContext,
  'appVersion' | 'osName' | 'osVersion' | 'osBuild' | 'userAgent'
>> | null = null;

interface BuildGenerationErrorReportInput {
  errorMessage: string;
  errorDetails?: string;
  context?: unknown;
  errorCategory?: AiGenerationErrorCategory;
  statusCode?: number;
  traceId?: string;
  requestId?: string;
}

function toStringSafe(value: unknown): string {
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

export function createReferenceImagePlaceholders(count: number): string[] {
  const safeCount = Math.max(0, Math.min(64, Math.floor(count)));
  return Array.from({ length: safeCount }, (_, index) => `[IMAGE_${index + 1}]`);
}

function parseOsInfo(userAgent: string): { osName: string; osVersion: string } {
  const ua = userAgent || '';

  const windowsMatch = ua.match(/Windows NT ([0-9.]+)/i);
  if (windowsMatch) {
    const ntVersion = windowsMatch[1];
    if (ntVersion.startsWith('10.0')) {
      return { osName: 'Windows', osVersion: '10/11 (NT 10.0)' };
    }
    return { osName: 'Windows', osVersion: `NT ${ntVersion}` };
  }

  const macMatch = ua.match(/Mac OS X ([0-9_]+)/i);
  if (macMatch) {
    return { osName: 'macOS', osVersion: macMatch[1].replace(/_/g, '.') };
  }

  const linuxLike = /Linux|X11/i.test(ua);
  if (linuxLike) {
    return { osName: 'Linux', osVersion: 'unknown' };
  }

  return { osName: 'Unknown', osVersion: 'unknown' };
}

export async function getRuntimeDiagnostics(): Promise<
  Pick<GenerationDebugContext, 'appVersion' | 'osName' | 'osVersion' | 'osBuild' | 'userAgent'>
> {
  if (!runtimeDiagnosticsPromise) {
    runtimeDiagnosticsPromise = (async () => {
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
      const osInfo = parseOsInfo(userAgent);

      let appVersion = 'unknown';
      let resolvedOsName = osInfo.osName;
      let resolvedOsVersion = osInfo.osVersion;
      let resolvedOsBuild = 'unknown';
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        appVersion = await getVersion();
      } catch {
        appVersion = 'unknown';
      }

      try {
        const { getRuntimeSystemInfo } = await import('@/commands/system');
        const systemInfo = await getRuntimeSystemInfo();
        if (systemInfo) {
          if (systemInfo.osName) {
            resolvedOsName = systemInfo.osName;
          }
          if (systemInfo.osVersion) {
            resolvedOsVersion = systemInfo.osVersion;
          }
          if (systemInfo.osBuild) {
            resolvedOsBuild = systemInfo.osBuild;
          }
        }
      } catch {
        // Fallback to user-agent parsed info.
      }

      return {
        appVersion,
        osName: resolvedOsName,
        osVersion: resolvedOsVersion,
        osBuild: resolvedOsBuild,
        userAgent,
      };
    })();
  }

  return runtimeDiagnosticsPromise;
}

export function buildGenerationErrorReport(
  input: BuildGenerationErrorReportInput
): string {
  const context = (input.context ?? {}) as Partial<GenerationDebugContext>;
  const diagnostics = extractAiGenerationErrorDiagnostics(
    [input.errorMessage, input.errorDetails].filter(Boolean).join('\n\n')
  );
  const errorCategory = input.errorCategory ?? diagnostics.category;
  const statusCode = input.statusCode ?? diagnostics.statusCode;
  const traceId = input.traceId ?? diagnostics.traceId;
  const requestId = input.requestId ?? diagnostics.requestId;
  const rawErrorMessage = input.errorDetails?.trim() || input.errorMessage || 'unknown error';
  const sections: string[] = [];
  sections.push('# Generation Error Report');
  sections.push('');
  sections.push(`- Error: ${rawErrorMessage}`);
  if (input.errorMessage && input.errorMessage !== rawErrorMessage) {
    sections.push(`- User Message: ${input.errorMessage}`);
  }
  if (input.errorDetails && input.errorDetails !== rawErrorMessage) {
    sections.push(`- Details: ${input.errorDetails}`);
  }
  if (errorCategory && errorCategory !== 'unknown') {
    sections.push(`- Category: ${errorCategory}`);
  }
  if (statusCode) {
    sections.push(`- Status Code: ${statusCode}`);
  }
  if (traceId) {
    sections.push(`- Trace ID: ${traceId}`);
  }
  if (requestId) {
    sections.push(`- Request ID: ${requestId}`);
  }
  sections.push(`- App Version: ${context.appVersion ?? 'unknown'}`);
  sections.push(`- OS: ${context.osName ?? 'Unknown'} ${context.osVersion ?? 'unknown'}`.trim());
  sections.push(`- OS Build: ${context.osBuild ?? 'unknown'}`);
  sections.push('');
  sections.push('## Request Context');
  sections.push(`- Source: ${context.sourceType ?? 'unknown'}`);
  if (context.providerId) {
    sections.push(`- Provider: ${context.providerId}`);
  }
  if (context.requestModel) {
    sections.push(`- Model: ${context.requestModel}`);
  }
  if (context.requestSize) {
    sections.push(`- Size: ${context.requestSize}`);
  }
  if (context.requestAspectRatio) {
    sections.push(`- Aspect Ratio: ${context.requestAspectRatio}`);
  }
  sections.push(`- Reference Images: ${context.referenceImageCount ?? 0}`);
  if (Array.isArray(context.referenceImagePlaceholders) && context.referenceImagePlaceholders.length > 0) {
    sections.push(`- Reference Image Placeholders: ${context.referenceImagePlaceholders.join(', ')}`);
  }
  sections.push('');
  sections.push('## Prompt');
  sections.push(context.prompt && context.prompt.trim() ? context.prompt : '(empty)');
  sections.push('');
  sections.push('## Extra Params');
  sections.push(
    context.extraParams && Object.keys(context.extraParams).length > 0
      ? toStringSafe(context.extraParams)
      : '{}'
  );
  if (context.userAgent) {
    sections.push('');
    sections.push('## User Agent');
    sections.push(context.userAgent);
  }

  return sections.join('\n');
}
