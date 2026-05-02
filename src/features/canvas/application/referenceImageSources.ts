import { resolveReadableImageSource } from './imageData';

export interface ReferenceImageSourceCandidate {
  referenceUrl?: string | null | undefined;
  imageUrl?: string | null | undefined;
  previewImageUrl?: string | null | undefined;
}

export async function resolveReadableReferenceImageSources(
  candidates: ReferenceImageSourceCandidate[]
): Promise<string[]> {
  const resolvedSources: string[] = [];
  const seenSources = new Set<string>();

  for (const candidate of candidates) {
    const source =
      candidate.referenceUrl?.trim()
      ?? candidate.imageUrl?.trim()
      ?? '';
    const fallback = candidate.previewImageUrl?.trim() ?? '';
    if (!source && !fallback) {
      continue;
    }

    const resolvedSource = await resolveReadableImageSource(
      source || fallback,
      fallback || null
    );
    const normalizedSource = resolvedSource.trim();
    if (!normalizedSource || seenSources.has(normalizedSource)) {
      continue;
    }

    seenSources.add(normalizedSource);
    resolvedSources.push(normalizedSource);
  }

  return resolvedSources;
}
