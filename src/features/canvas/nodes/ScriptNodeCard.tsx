import type { ReactNode } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ScriptNodeAccent = 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan';

const SCRIPT_NODE_IDLE_BORDER_CLASS =
  'border-[rgba(15,23,42,0.16)] hover:border-[rgba(15,23,42,0.24)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] dark:border-white/[0.14] dark:hover:border-white/[0.22] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)]';
const SCRIPT_NODE_SELECTED_BORDER_CLASS =
  'border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.3),0_4px_14px_rgba(15,23,42,0.1)] dark:border-white/[0.42] dark:shadow-[0_0_0_1px_rgba(245,245,245,0.16),0_4px_14px_rgba(0,0,0,0.2)]';

interface ScriptNodeCardProps {
  accent: ScriptNodeAccent;
  icon: ReactNode;
  title: string;
  selected?: boolean;
  width?: number;
  height?: number;
  minHeight?: number;
  isEditing: boolean;
  showEditButton?: boolean;
  headerActions?: ReactNode;
  contentClassName?: string;
  overlayContent?: ReactNode;
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
  }
> = {
  violet: {
    idle: SCRIPT_NODE_IDLE_BORDER_CLASS,
    selected: SCRIPT_NODE_SELECTED_BORDER_CLASS,
    iconWrap: 'border border-border-dark/55 bg-bg-dark',
    iconText: 'text-text-muted',
    divider: 'border-border-dark/45',
  },
  emerald: {
    idle: SCRIPT_NODE_IDLE_BORDER_CLASS,
    selected: SCRIPT_NODE_SELECTED_BORDER_CLASS,
    iconWrap: 'border border-border-dark/55 bg-bg-dark',
    iconText: 'text-text-muted',
    divider: 'border-border-dark/45',
  },
  amber: {
    idle: SCRIPT_NODE_IDLE_BORDER_CLASS,
    selected: SCRIPT_NODE_SELECTED_BORDER_CLASS,
    iconWrap: 'border border-border-dark/55 bg-bg-dark',
    iconText: 'text-text-muted',
    divider: 'border-border-dark/45',
  },
  rose: {
    idle: SCRIPT_NODE_IDLE_BORDER_CLASS,
    selected: SCRIPT_NODE_SELECTED_BORDER_CLASS,
    iconWrap: 'border border-border-dark/55 bg-bg-dark',
    iconText: 'text-text-muted',
    divider: 'border-border-dark/45',
  },
  cyan: {
    idle: SCRIPT_NODE_IDLE_BORDER_CLASS,
    selected: SCRIPT_NODE_SELECTED_BORDER_CLASS,
    iconWrap: 'border border-border-dark/55 bg-bg-dark',
    iconText: 'text-text-muted',
    divider: 'border-border-dark/45',
  },
};

export const SCRIPT_NODE_LABEL_CLASS =
  'mb-1 block text-[11px] font-medium tracking-[0.01em] text-text-muted';
export const SCRIPT_NODE_INPUT_CLASS =
  'nodrag nowheel w-full border ui-field px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-text-muted/60';
export const SCRIPT_NODE_TEXTAREA_CLASS = `${SCRIPT_NODE_INPUT_CLASS} ui-scrollbar resize-none`;
export const SCRIPT_NODE_SECONDARY_BUTTON_CLASS =
  'nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark/45 bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:border-border-dark/70 hover:bg-bg-dark/80';
export const SCRIPT_NODE_PRIMARY_BUTTON_CLASS =
  'nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark/55 bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:border-[rgba(15,23,42,0.34)] hover:bg-bg-dark/80 dark:hover:border-white/[0.26]';
export const SCRIPT_NODE_ICON_BUTTON_CLASS =
  'nodrag flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-text-muted transition-colors hover:border-border-dark/45 hover:bg-bg-dark hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-60';
export const SCRIPT_NODE_EMPTY_HINT_CLASS =
  'rounded-lg border border-dashed border-border-dark/45 bg-bg-dark/35 px-3 py-4 text-center text-xs text-text-muted';
export const SCRIPT_NODE_SCROLL_AREA_CLASS =
  'ui-scrollbar nodrag nowheel min-h-0 flex-1 overflow-y-auto pr-1';
export const SCRIPT_NODE_SECTION_CARD_CLASS =
  'rounded-xl border border-white/[0.07] bg-black/[0.08] px-3 py-2.5';

export function resolveScriptNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }

  return fallback;
}

export function ScriptNodeCard({
  accent,
  icon,
  title,
  selected,
  width = 280,
  height,
  minHeight = 120,
  isEditing,
  showEditButton = true,
  headerActions,
  contentClassName = '',
  overlayContent,
  onToggleEdit,
  onDelete,
  onClick,
  children,
}: ScriptNodeCardProps) {
  const { t } = useTranslation();
  const accentClasses = ACCENT_CLASS_MAP[accent];

  return (
    <div
      className={`group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 transition-all duration-150 ${
        selected ? accentClasses.selected : accentClasses.idle
      }`}
      style={{ width, minHeight, height }}
      onClick={onClick}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_42%)]" />

      <div className={`relative flex items-center gap-2 border-b px-3 py-2.5 ${accentClasses.divider}`}>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${accentClasses.iconWrap} ${accentClasses.iconText}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text-dark">{title}</div>
        </div>
        {headerActions}
        {showEditButton ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleEdit();
            }}
            className={SCRIPT_NODE_ICON_BUTTON_CLASS}
            title={isEditing ? t('common.cancel') : t('common.edit')}
          >
            <Edit2 className="h-4 w-4" />
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200`}
            title={t('common.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className={`relative flex min-h-0 flex-1 flex-col p-3 ${isEditing ? 'nodrag nowheel' : ''} ${contentClassName}`}>
        {children}
      </div>
      {overlayContent}
    </div>
  );
}
