import {
  findNamedReferenceTokens,
  findReferenceTokens,
} from "./referenceTokenEditing";

export interface PromptReferenceImageCandidate {
  referenceNumber: number;
  imageUrl: string;
  tokenLabel?: string | null;
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
  const namedCandidates: Array<{ tokenLabel: string; value: number }> = [];
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
    const tokenLabel = candidate.tokenLabel?.trim();
    if (tokenLabel) {
      namedCandidates.push({
        tokenLabel,
        value: referenceNumber,
      });
    }
  }

  if (candidateByReferenceNumber.size === 0) {
    return [];
  }

  const bindings: PromptReferenceImageBinding[] = [];
  const seenReferenceNumbers = new Set<number>();

  const tokens = [
    ...findReferenceTokens(normalizedPrompt),
    ...findNamedReferenceTokens(normalizedPrompt, namedCandidates),
  ].sort((left, right) => left.start - right.start || right.end - left.end);

  for (const token of tokens) {
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
