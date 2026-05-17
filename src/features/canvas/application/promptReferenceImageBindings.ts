import {
  buildShortReferenceToken,
  findNamedReferenceTokens,
  findReferenceTokens,
} from "./referenceTokenEditing";

export interface PromptReferenceImageCandidate {
  referenceNumber: number;
  imageUrl: string;
  tokenLabel?: string | null;
  previewImageUrl?: string | null;
  assetId?: string | null;
}

export interface PromptReferenceImageBinding {
  token: string;
  imageUrl: string;
  referenceNumber?: number;
  candidateIndex?: number;
  tokenKind?: "indexed" | "named";
  tokenLabel?: string | null;
  start?: number;
  end?: number;
}

export interface PromptBoundReferenceImage {
  binding: PromptReferenceImageBinding;
  candidate: PromptReferenceImageCandidate;
  requestReferenceNumber: number;
}

interface NormalizedPromptReferenceImageCandidate
  extends PromptReferenceImageCandidate {
  candidateIndex: number;
  referenceNumber: number;
  imageUrl: string;
  tokenLabel: string | null;
}

interface PromptReferenceTokenMatch {
  token: string;
  value: number;
  start: number;
  end: number;
  tokenKind: "indexed" | "named";
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

function normalizeCandidates(
  candidates: PromptReferenceImageCandidate[],
): NormalizedPromptReferenceImageCandidate[] {
  return candidates
    .map((candidate, candidateIndex) => {
      const referenceNumber = normalizeReferenceNumber(candidate.referenceNumber);
      const imageUrl = candidate.imageUrl.trim();
      if (referenceNumber == null || !imageUrl) {
        return null;
      }

      return {
        ...candidate,
        candidateIndex,
        referenceNumber,
        imageUrl,
        tokenLabel: candidate.tokenLabel?.trim() || null,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is NormalizedPromptReferenceImageCandidate => candidate !== null,
    );
}

function collectPromptReferenceTokenMatches(
  prompt: string,
  candidates: NormalizedPromptReferenceImageCandidate[],
): PromptReferenceTokenMatch[] {
  const namedCandidates = candidates
    .filter((candidate) => Boolean(candidate.tokenLabel))
    .map((candidate) => ({
      tokenLabel: candidate.tokenLabel as string,
      value: candidate.referenceNumber,
    }));

  return [
    ...findReferenceTokens(prompt).map((token) => ({
      ...token,
      tokenKind: "indexed" as const,
    })),
    ...findNamedReferenceTokens(prompt, namedCandidates).map((token) => ({
      ...token,
      tokenKind: "named" as const,
    })),
  ].sort((left, right) => left.start - right.start || right.end - left.end);
}

export function resolvePromptReferenceImageBindings(
  prompt: string,
  candidates: PromptReferenceImageCandidate[],
): PromptReferenceImageBinding[] {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || candidates.length === 0) {
    return [];
  }

  const normalizedCandidates = normalizeCandidates(candidates);
  if (normalizedCandidates.length === 0) {
    return [];
  }

  const candidateByReferenceNumber = new Map<number, NormalizedPromptReferenceImageCandidate>();
  normalizedCandidates.forEach((candidate) => {
    if (!candidateByReferenceNumber.has(candidate.referenceNumber)) {
      candidateByReferenceNumber.set(candidate.referenceNumber, candidate);
    }
  });

  const bindings: PromptReferenceImageBinding[] = [];
  const seenCandidateIndexes = new Set<number>();
  const tokens = collectPromptReferenceTokenMatches(
    normalizedPrompt,
    normalizedCandidates,
  );

  for (const token of tokens) {
    const candidate = candidateByReferenceNumber.get(token.value);
    if (!candidate || seenCandidateIndexes.has(candidate.candidateIndex)) {
      continue;
    }

    bindings.push({
      token: token.token,
      imageUrl: candidate.imageUrl,
      referenceNumber: candidate.referenceNumber,
      candidateIndex: candidate.candidateIndex,
      tokenKind: token.tokenKind,
      tokenLabel: candidate.tokenLabel,
      start: token.start,
      end: token.end,
    });
    seenCandidateIndexes.add(candidate.candidateIndex);
  }

  return bindings;
}

export function resolvePromptBoundReferenceImages(
  prompt: string,
  candidates: PromptReferenceImageCandidate[],
): PromptBoundReferenceImage[] {
  const bindings = resolvePromptReferenceImageBindings(prompt, candidates);
  if (bindings.length === 0) {
    return [];
  }

  return bindings
    .map((binding, index) => {
      if (typeof binding.candidateIndex !== "number") {
        return null;
      }
      const candidate = candidates[binding.candidateIndex];
      if (!candidate) {
        return null;
      }

      return {
        binding,
        candidate,
        requestReferenceNumber: index + 1,
      } satisfies PromptBoundReferenceImage;
    })
    .filter(
      (binding): binding is PromptBoundReferenceImage => binding !== null,
    );
}

export function rewritePromptReferenceTokensForRequest(
  prompt: string,
  boundImages: PromptBoundReferenceImage[],
): string {
  if (!prompt || boundImages.length === 0) {
    return prompt;
  }

  let nextPrompt = prompt;
  for (let index = boundImages.length - 1; index >= 0; index -= 1) {
    const entry = boundImages[index];
    const replacementToken = buildShortReferenceToken(
      entry.requestReferenceNumber - 1,
    );
    nextPrompt = `${nextPrompt.slice(0, entry.binding.start)}${replacementToken}${nextPrompt.slice(entry.binding.end)}`;
  }

  return nextPrompt;
}

export function resolvePromptReferenceImageCandidateByToken(
  token: string,
  value: number,
  candidates: PromptReferenceImageCandidate[],
): PromptReferenceImageCandidate | null {
  const normalizedToken = token.trim();
  if (!normalizedToken || candidates.length === 0) {
    return null;
  }

  const normalizedCandidates = normalizeCandidates(candidates);
  const namedMatch = normalizedCandidates.find(
    (candidate) => candidate.tokenLabel === normalizedToken,
  );
  if (namedMatch) {
    return namedMatch;
  }

  return (
    normalizedCandidates.find(
      (candidate) => candidate.referenceNumber === value,
    ) ?? null
  );
}
