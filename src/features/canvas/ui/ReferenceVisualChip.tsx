import {
  type MouseEventHandler,
  type PointerEventHandler,
  memo,
} from 'react';
import { Image as ImageIcon, Video, X } from 'lucide-react';

import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';

export interface ReferenceVisualChipProps {
  kind: 'image' | 'video';
  displayUrl: string | null;
  label: string;
  tokenLabel: string;
  metaLabel?: string | null;
  viewerImageList?: string[];
  isActive?: boolean;
  isDragging?: boolean;
  isDragTarget?: boolean;
  allowHoverLift?: boolean;
  cursorClassName?: string;
  reorderHint?: string | null;
  removeLabel?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  onRemove?: () => void;
}

export const ReferenceVisualChip = memo(({
  kind,
  displayUrl,
  label,
  tokenLabel,
  metaLabel,
  viewerImageList,
  isActive = false,
  isDragging = false,
  isDragTarget = false,
  allowHoverLift = true,
  cursorClassName,
  reorderHint,
  removeLabel,
  onClick,
  onMouseDown,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerCancel,
  onRemove,
}: ReferenceVisualChipProps) => {
  const baseStateClass = isDragging
    ? 'z-10 border-accent/35 bg-accent/10 opacity-35 shadow-[0_6px_16px_rgba(59,130,246,0.12)] scale-[0.98]'
    : isDragTarget || isActive
      ? 'z-10 border-accent/55 bg-accent/10 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
      : 'border-white/10 bg-black/15';
  const hoverClass = allowHoverLift && !isDragging
    ? 'motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-white/15 motion-safe:hover:shadow-[0_8px_20px_rgba(0,0,0,0.2)]'
    : '';
  const resolvedCursorClass = isDragging
    ? 'cursor-grabbing'
    : cursorClassName ?? (onClick || onPointerDown ? 'cursor-pointer' : '');
  const overlayClass = isDragging
    ? 'ring-1 ring-accent/55'
    : isDragTarget || isActive
      ? 'ring-1 ring-accent/40'
      : 'ring-0 group-hover/reference:ring-1 group-hover/reference:ring-white/8';

  return (
    <div
      className={`nodrag group/reference relative flex select-none items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ${baseStateClass} ${hoverClass} ${resolvedCursorClass}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerCancel}
    >
      {onRemove && removeLabel ? (
        <button
          type="button"
          draggable={false}
          className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-black/75 text-text-dark opacity-0 shadow-[0_6px_18px_rgba(0,0,0,0.28)] transition-opacity hover:bg-rose-500 hover:text-white group-hover/reference:opacity-100"
          aria-label={removeLabel}
          title={removeLabel}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" strokeWidth={2.4} />
        </button>
      ) : null}

      <div className="relative h-9 w-9 shrink-0">
        {displayUrl ? (
          <>
            <CanvasNodeImage
              src={displayUrl}
              alt={label}
              viewerSourceUrl={displayUrl}
              viewerImageList={viewerImageList}
              className="h-9 w-9 rounded-md object-cover"
              draggable={false}
            />
            {kind === 'video' ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center rounded-b-md bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
                <span className="inline-flex items-center gap-1 truncate">
                  <Video className="h-2.5 w-2.5 shrink-0" />
                  {metaLabel ?? 'VIDEO'}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-text-muted">
            {kind === 'video' ? (
              <span className="inline-flex items-center gap-1 text-[9px] font-medium uppercase tracking-[0.12em]">
                <Video className="h-3 w-3" />
                {metaLabel ?? 'VIDEO'}
              </span>
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-text-dark">
          {tokenLabel}
        </div>
        <div className="truncate text-[10px] text-text-muted">
          {label}
        </div>
      </div>

      <div
        className={`pointer-events-none absolute inset-0 rounded-lg ring-inset transition-all duration-200 ${overlayClass}`}
      />

      {reorderHint ? (
        <div
          className={`pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white/82 shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 ${
            isDragging
              ? 'opacity-0'
              : 'translate-y-1 opacity-0 group-hover/reference:translate-y-0 group-hover/reference:opacity-100'
          }`}
        >
          {reorderHint}
        </div>
      ) : null}
    </div>
  );
});

ReferenceVisualChip.displayName = 'ReferenceVisualChip';
