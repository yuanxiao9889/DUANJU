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
    'border-[rgba(15,23,42,0.18)] bg-bg-dark text-[#222222] shadow-[0_8px_16px_rgba(15,23,42,0.06)] dark:border-white/18 dark:bg-white/[0.06] dark:text-text-dark dark:shadow-[0_8px_16px_rgba(0,0,0,0.18)]',
  danger:
    'border-red-900/30 bg-red-950/[0.06] text-red-900 shadow-[0_8px_16px_rgba(127,29,29,0.08)] dark:border-red-400/28 dark:bg-red-400/12 dark:text-red-200 dark:shadow-[0_8px_16px_rgba(248,113,113,0.08)]',
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
        <span className="inline-flex items-center justify-center">
          {icon}
        </span>
      ) : animate ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current/75" />
      ) : null}
      <span className="leading-none">{label}</span>
    </span>
  );
}
