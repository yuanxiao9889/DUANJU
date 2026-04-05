const REFERENCE_TOKEN_PATTERN = /@\u56fe(?:\u7247)?(\d+)/g;

function normalizeReferenceImageCount(referenceImageCount: number): number {
  if (!Number.isFinite(referenceImageCount)) {
    return 0;
  }

  return Math.max(0, Math.floor(referenceImageCount));
}

export function normalizeReferenceImagePrompt(prompt: string): string {
  return prompt.replace(REFERENCE_TOKEN_PATTERN, (_match, referenceNumber: string) => {
    return `第${referenceNumber}张参考图`;
  });
}

export function buildReferenceAwareGenerationPrompt(
  prompt: string,
  referenceImageCount: number
): string {
  const normalizedPrompt = normalizeReferenceImagePrompt(prompt).trim();
  if (!normalizedPrompt) {
    return '';
  }

  const safeReferenceImageCount = normalizeReferenceImageCount(referenceImageCount);
  const containsReferenceToken = prompt.match(REFERENCE_TOKEN_PATTERN) !== null;
  if (safeReferenceImageCount === 0 || (!containsReferenceToken && safeReferenceImageCount <= 1)) {
    return normalizedPrompt;
  }

  const rangeLabel =
    safeReferenceImageCount === 1
      ? '第1张参考图'
      : `第1张到第${safeReferenceImageCount}张参考图`;

  return [
    `已附上${safeReferenceImageCount}张参考图，按附加顺序依次编号为${rangeLabel}。`,
    '如果提示词里提到某一张参考图，请严格对应到同序号的附件，不要混用不同参考图的元素。',
    '',
    normalizedPrompt,
  ].join('\n');
}
