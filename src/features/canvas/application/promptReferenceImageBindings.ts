import { findReferenceTokens } from "./referenceTokenEditing";

export interface PromptReferenceImageCandidate {
  referenceNumber: number;
  imageUrl: string;
}

export interface PromptReferenceImageBinding {
  token: string;
  imageUrl: string;
}

function normalizeReferenceNumber(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalizedValue = Math.floor(value);
  return normalizedValue >= 1 ? normalizedValue : null;
}

export function buildSequentialPromptReferenceImageCandidates(
  imageUrls: string[],
): PromptReferenceImageCandidate[] {
  return imageUrls.map((imageUrl, index) => ({
    referenceNumber: index + 1,
    imageUrl,
  }));
}

export function resolvePromptReferenceImageBindings(
  prompt: string,
  candidates: PromptReferenceImageCandidate[],
): PromptReferenceImageBinding[] {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || candidates.length === 0) {
    return [];
  }

  const candidateByReferenceNumber = new Map<number, string>();
  for (const candidate of candidates) {
    const referenceNumber = normalizeReferenceNumber(candidate.referenceNumber);
    const imageUrl = candidate.imageUrl.trim();
    if (
      referenceNumber == null
      || !imageUrl
      || candidateByReferenceNumber.has(referenceNumber)
    ) {
      continue;
    }

    candidateByReferenceNumber.set(referenceNumber, imageUrl);
  }

  if (candidateByReferenceNumber.size === 0) {
    return [];
  }

  const bindings: PromptReferenceImageBinding[] = [];
  const seenReferenceNumbers = new Set<number>();

  for (const token of findReferenceTokens(normalizedPrompt)) {
    if (seenReferenceNumbers.has(token.value)) {
      continue;
    }

    const imageUrl = candidateByReferenceNumber.get(token.value);
    if (!imageUrl) {
      continue;
    }

    bindings.push({
      token: token.token,
      imageUrl,
    });
    seenReferenceNumbers.add(token.value);
  }

  return bindings;
}
