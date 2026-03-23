import type { ReactNode } from 'react';

export type NodeStatusTone = 'processing' | 'warning' | 'danger';

interface NodeStatusBadgeProps {
  icon?: ReactNode;
  label: string;
  tone?: NodeStatusTone;
  animate?: boolean;
  title?: string;
}

const TONE_CLASS_MAP: Record<NodeStatusTone, string> = {
  processing:
    'border-accent/30 bg-accent/12 text-accent shadow-[0_8px_16px_rgba(var(--accent-rgb),0.12)]',
  warning:
    'border-amber-400/28 bg-amber-400/12 text-amber-200 shadow-[0_8px_16px_rgba(251,191,36,0.08)]',
  danger:
    'border-red-400/28 bg-red-400/12 text-red-200 shadow-[0_8px_16px_rgba(248,113,113,0.08)]',
};

export function NodeStatusBadge({
  icon,
  label,
  tone = 'warning',
  animate = false,
  title,
}: NodeStatusBadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium ${TONE_CLASS_MAP[tone]}`}
    >
      {icon ? (
        <span className={`inline-flex items-center justify-center ${animate ? 'animate-spin' : ''}`}>
          {icon}
        </span>
      ) : null}
      <span className="leading-none">{label}</span>
    </span>
  );
}
