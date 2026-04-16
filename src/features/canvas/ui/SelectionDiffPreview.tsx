import { useMemo } from 'react';

type DiffKind = 'common' | 'removed' | 'added';

type DiffSegment = {
  kind: DiffKind;
  text: string;
};

interface SelectionDiffPreviewProps {
  originalText: string;
  rewrittenText: string;
  originalLabel: string;
  rewrittenLabel: string;
  addedLabel: string;
  removedLabel: string;
}

function tokenizeForDiff(text: string): string[] {
  return text.match(/[\u3400-\u9fff]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\u3400-\u9fff]/g) ?? [];
}

function buildDiffSegments(sourceText: string, targetText: string): DiffSegment[] {
  const sourceTokens = tokenizeForDiff(sourceText);
  const targetTokens = tokenizeForDiff(targetText);
  const lcs: number[][] = Array.from(
    { length: sourceTokens.length + 1 },
    () => Array.from({ length: targetTokens.length + 1 }, () => 0)
  );

  for (let sourceIndex = sourceTokens.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let targetIndex = targetTokens.length - 1; targetIndex >= 0; targetIndex -= 1) {
      if (sourceTokens[sourceIndex] === targetTokens[targetIndex]) {
        lcs[sourceIndex][targetIndex] = lcs[sourceIndex + 1][targetIndex + 1] + 1;
      } else {
        lcs[sourceIndex][targetIndex] = Math.max(
          lcs[sourceIndex + 1][targetIndex],
          lcs[sourceIndex][targetIndex + 1]
        );
      }
    }
  }

  const segments: DiffSegment[] = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  const pushSegment = (kind: DiffKind, text: string) => {
    if (!text) {
      return;
    }

    const previousSegment = segments[segments.length - 1];
    if (previousSegment?.kind === kind) {
      previousSegment.text += text;
      return;
    }

    segments.push({ kind, text });
  };

  while (sourceIndex < sourceTokens.length && targetIndex < targetTokens.length) {
    if (sourceTokens[sourceIndex] === targetTokens[targetIndex]) {
      pushSegment('common', sourceTokens[sourceIndex]);
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }

    if (lcs[sourceIndex + 1][targetIndex] >= lcs[sourceIndex][targetIndex + 1]) {
      pushSegment('removed', sourceTokens[sourceIndex]);
      sourceIndex += 1;
      continue;
    }

    pushSegment('added', targetTokens[targetIndex]);
    targetIndex += 1;
  }

  while (sourceIndex < sourceTokens.length) {
    pushSegment('removed', sourceTokens[sourceIndex]);
    sourceIndex += 1;
  }

  while (targetIndex < targetTokens.length) {
    pushSegment('added', targetTokens[targetIndex]);
    targetIndex += 1;
  }

  return segments;
}

function countMeaningfulTokens(segments: DiffSegment[], kind: DiffKind): number {
  return segments
    .filter((segment) => segment.kind === kind)
    .reduce((count, segment) => {
      const tokens = tokenizeForDiff(segment.text);
      return count + tokens.filter((token) => token.trim().length > 0).length;
    }, 0);
}

function renderSegments(segments: DiffSegment[], visibleKinds: DiffKind[]) {
  return segments.flatMap((segment, index) => {
    if (!visibleKinds.includes(segment.kind)) {
      return [];
    }

    const className = segment.kind === 'removed'
      ? 'rounded bg-red-500/14 text-red-100'
      : segment.kind === 'added'
        ? 'rounded bg-cyan-500/16 text-cyan-100'
        : '';

    return (
      <span
        key={`${segment.kind}-${index}`}
        className={className}
      >
        {segment.text}
      </span>
    );
  });
}

export function SelectionDiffPreview({
  originalText,
  rewrittenText,
  originalLabel,
  rewrittenLabel,
  addedLabel,
  removedLabel,
}: SelectionDiffPreviewProps) {
  const { segments, addedCount, removedCount } = useMemo(() => {
    const nextSegments = buildDiffSegments(originalText, rewrittenText);
    return {
      segments: nextSegments,
      addedCount: countMeaningfulTokens(nextSegments, 'added'),
      removedCount: countMeaningfulTokens(nextSegments, 'removed'),
    };
  }, [originalText, rewrittenText]);

  return (
    <div className="mt-3 rounded-xl border border-border-dark/80 bg-surface-dark/70 p-3">
      <div className="flex flex-wrap gap-2 text-[11px] leading-5">
        <span className="rounded-full border border-red-500/20 bg-red-500/8 px-2 py-0.5 text-red-100">
          {removedLabel}: {removedCount}
        </span>
        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/8 px-2 py-0.5 text-cyan-100">
          {addedLabel}: {addedCount}
        </span>
      </div>

      <div className="mt-3 grid gap-3">
        <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
            {originalLabel}
          </div>
          <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-dark">
            {renderSegments(segments, ['common', 'removed'])}
          </div>
        </div>

        <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
            {rewrittenLabel}
          </div>
          <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-dark">
            {renderSegments(segments, ['common', 'added'])}
          </div>
        </div>
      </div>
    </div>
  );
}
