import {
  resolveErrorContent,
  type ResolvedErrorContent,
} from '@/features/canvas/application/errorDialog';

function isViduAuthError(content: ResolvedErrorContent): boolean {
  const raw = [
    content.message,
    content.details,
    content.rawMessage,
    content.statusCode ? String(content.statusCode) : '',
  ]
    .join('\n')
    .toLowerCase();

  return (
    content.category === 'auth'
    || content.statusCode === 401
    || content.statusCode === 403
    || raw.includes('unauthorized')
    || raw.includes('invalid token')
    || raw.includes('forbidden')
  );
}

export function resolveViduErrorContent(
  error: unknown,
  fallbackMessage: string,
  authMessage: string
): ResolvedErrorContent {
  const content = resolveErrorContent(error, fallbackMessage);
  if (!isViduAuthError(content)) {
    return content;
  }

  return {
    ...content,
    message: authMessage,
  };
}
