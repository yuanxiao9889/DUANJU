import type { ReactNode } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ScriptNodeAccent = 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan';

interface ScriptNodeCardProps {
  accent: ScriptNodeAccent;
  icon: ReactNode;
  title: string;
  selected?: boolean;
  width?: number;
  minHeight?: number;
  isEditing: boolean;
  onToggleEdit: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  children: ReactNode;
}

const ACCENT_CLASS_MAP: Record<
  ScriptNodeAccent,
  {
    idle: string;
    selected: string;
    iconWrap: string;
    iconText: string;
    divider: string;
    topBar: string;
  }
> = {
  violet: {
    idle: 'border-violet-300/18 hover:border-violet-300/32',
    selected:
      'border-violet-300/55 shadow-[0_0_0_1px_rgba(196,181,253,0.42),0_18px_30px_rgba(15,23,42,0.2)]',
    iconWrap: 'bg-violet-400/12',
    iconText: 'text-violet-200',
    divider: 'border-violet-300/10',
    topBar: 'bg-violet-300/60',
  },
  emerald: {
    idle: 'border-emerald-300/18 hover:border-emerald-300/32',
    selected:
      'border-emerald-300/55 shadow-[0_0_0_1px_rgba(167,243,208,0.42),0_18px_30px_rgba(15,23,42,0.2)]',
    iconWrap: 'bg-emerald-400/12',
    iconText: 'text-emerald-200',
    divider: 'border-emerald-300/10',
    topBar: 'bg-emerald-300/60',
  },
  amber: {
    idle: 'border-amber-300/18 hover:border-amber-300/32',
    selected:
      'border-amber-300/55 shadow-[0_0_0_1px_rgba(252,211,77,0.42),0_18px_30px_rgba(15,23,42,0.2)]',
    iconWrap: 'bg-amber-400/12',
    iconText: 'text-amber-200',
    divider: 'border-amber-300/10',
    topBar: 'bg-amber-300/60',
  },
  rose: {
    idle: 'border-rose-300/18 hover:border-rose-300/32',
    selected:
      'border-rose-300/55 shadow-[0_0_0_1px_rgba(253,164,175,0.42),0_18px_30px_rgba(15,23,42,0.2)]',
    iconWrap: 'bg-rose-400/12',
    iconText: 'text-rose-200',
    divider: 'border-rose-300/10',
    topBar: 'bg-rose-300/60',
  },
  cyan: {
    idle: 'border-cyan-300/18 hover:border-cyan-300/32',
    selected:
      'border-cyan-300/55 shadow-[0_0_0_1px_rgba(165,243,252,0.42),0_18px_30px_rgba(15,23,42,0.2)]',
    iconWrap: 'bg-cyan-400/12',
    iconText: 'text-cyan-200',
    divider: 'border-cyan-300/10',
    topBar: 'bg-cyan-300/60',
  },
};

export const SCRIPT_NODE_LABEL_CLASS =
  'mb-1 block text-[11px] font-medium tracking-[0.01em] text-text-muted';
export const SCRIPT_NODE_INPUT_CLASS =
  'w-full rounded-lg border border-border-dark/75 bg-bg-dark/82 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent/45';
export const SCRIPT_NODE_TEXTAREA_CLASS = `${SCRIPT_NODE_INPUT_CLASS} resize-none`;
export const SCRIPT_NODE_SECONDARY_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-border-dark/70 bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:border-border-dark hover:bg-bg-dark/80';
export const SCRIPT_NODE_PRIMARY_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-accent/28 bg-accent/12 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/18';
export const SCRIPT_NODE_EMPTY_HINT_CLASS =
  'rounded-lg border border-dashed border-border-dark/70 bg-bg-dark/45 px-3 py-4 text-center text-xs text-text-muted';

export function ScriptNodeCard({
  accent,
  icon,
  title,
  selected,
  width = 280,
  minHeight = 120,
  isEditing,
  onToggleEdit,
  onDelete,
  onClick,
  children,
}: ScriptNodeCardProps) {
  const { t } = useTranslation();
  const accentClasses = ACCENT_CLASS_MAP[accent];

  return (
    <div
      className={`group relative overflow-hidden rounded-[18px] border bg-surface-dark/96 shadow-[0_18px_34px_rgba(2,6,23,0.18)] transition-[border-color,box-shadow,transform] duration-200 ${
        selected ? accentClasses.selected : accentClasses.idle
      }`}
      style={{ width, minHeight }}
      onClick={onClick}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_42%)]" />
      <div className={`absolute inset-x-0 top-0 h-[2px] ${accentClasses.topBar}`} />

      <div className={`relative flex items-center gap-2 border-b px-3 py-2.5 ${accentClasses.divider}`}>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${accentClasses.iconWrap} ${accentClasses.iconText}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text-dark">{title}</div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleEdit();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-text-muted transition-colors hover:border-border-dark/70 hover:bg-bg-dark hover:text-text-dark"
          title={isEditing ? t('common.cancel') : t('common.edit')}
        >
          <Edit2 className="h-4 w-4" />
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-text-muted transition-colors hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200"
            title={t('common.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="relative p-3">{children}</div>
    </div>
  );
}
