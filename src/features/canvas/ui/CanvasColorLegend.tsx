import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_SEMANTIC_COLORS,
  CANVAS_SEMANTIC_COLOR_VISUALS,
  normalizeCanvasColorLabel,
  type CanvasColorLabelMap,
  type CanvasSemanticColor,
} from '@/features/canvas/domain/semanticColors';

interface CanvasColorLegendProps {
  eligibleSelectedCount: number;
  activeColor: CanvasSemanticColor | null;
  colorLabels: CanvasColorLabelMap;
  onApplyColor: (color: CanvasSemanticColor) => void;
  onUpdateLabel: (color: CanvasSemanticColor, label: string) => void;
}

const HOVER_CLOSE_DELAY_MS = 140;
const LEGEND_DOT_FILL_COLORS: Record<CanvasSemanticColor, string> = {
  red: 'rgba(174, 86, 86, 0.96)',
  purple: 'rgba(132, 92, 174, 0.96)',
  yellow: 'rgba(156, 132, 42, 0.96)',
  green: 'rgba(54, 134, 88, 0.96)',
};

export function CanvasColorLegend({
  eligibleSelectedCount,
  activeColor,
  colorLabels,
  onApplyColor,
  onUpdateLabel,
}: CanvasColorLegendProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipBlurCommitRef = useRef(false);
  const [hoveredColor, setHoveredColor] = useState<CanvasSemanticColor | null>(null);
  const [editingColor, setEditingColor] = useState<CanvasSemanticColor | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const isDisabled = eligibleSelectedCount === 0;

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editingColor) {
      return;
    }

    skipBlurCommitRef.current = false;
    setDraftLabel(colorLabels[editingColor]);
  }, [colorLabels, editingColor]);

  useEffect(() => {
    if (!editingColor) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingColor]);

  const clearHoverCloseTimer = () => {
    if (!hoverCloseTimerRef.current) {
      return;
    }

    clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  };

  const openColorCard = (color: CanvasSemanticColor) => {
    clearHoverCloseTimer();
    setHoveredColor(color);
  };

  const scheduleCloseColorCard = (color: CanvasSemanticColor) => {
    if (editingColor === color) {
      return;
    }

    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredColor((current) => (current === color ? null : current));
      hoverCloseTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  };

  const closeColorCardImmediately = () => {
    clearHoverCloseTimer();
    setEditingColor(null);
    setHoveredColor(null);
  };

  const commitEdit = (color: CanvasSemanticColor) => {
    const normalizedLabel = normalizeCanvasColorLabel(draftLabel, colorLabels[color]);
    onUpdateLabel(color, normalizedLabel);
    closeColorCardImmediately();
  };

  return (
    <aside className="pointer-events-auto absolute left-4 top-1/2 z-[1120] -translate-y-1/2">
      <div className="flex flex-col items-center gap-3">
        {CANVAS_SEMANTIC_COLORS.map((color) => {
          const visual = CANVAS_SEMANTIC_COLOR_VISUALS[color];
          const isEditing = editingColor === color;
          const isCardVisible = hoveredColor === color || isEditing;
          const isActive = activeColor === color;

          return (
            <div
              key={color}
              className="relative flex items-center"
              onMouseEnter={() => openColorCard(color)}
              onMouseLeave={() => scheduleCloseColorCard(color)}
            >
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => onApplyColor(color)}
                className={`h-3.5 w-3.5 rounded-full border transition-transform duration-150 ${
                  isDisabled
                    ? 'cursor-not-allowed opacity-35'
                    : 'hover:scale-[1.12] active:scale-100'
                }`}
                style={{
                  backgroundColor: LEGEND_DOT_FILL_COLORS[color],
                  borderColor: isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.22)',
                  boxShadow: isActive
                    ? `0 0 0 2px rgba(255,255,255,0.18), 0 3px 10px ${visual.borderColor}`
                    : '0 3px 10px rgba(0,0,0,0.2)',
                }}
                title={isDisabled
                  ? t('canvas.semanticColor.applyDisabled')
                  : t('canvas.semanticColor.applyLabel', { label: colorLabels[color] })}
              />

              <div
                className={`absolute left-full top-1/2 -translate-y-1/2 pl-2 transition-all duration-150 ${
                  isCardVisible
                    ? 'pointer-events-auto translate-x-0 opacity-100'
                    : 'pointer-events-none -translate-x-1 opacity-0'
                }`}
                onMouseEnter={() => openColorCard(color)}
                onMouseLeave={() => scheduleCloseColorCard(color)}
              >
                <div className="min-w-[156px] rounded-xl bg-surface-dark/96 px-3 py-2 shadow-[0_14px_28px_rgba(0,0,0,0.28)] backdrop-blur">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      type="text"
                      maxLength={MAX_CANVAS_COLOR_LABEL_LENGTH}
                      value={draftLabel}
                      onChange={(event) => setDraftLabel(event.target.value)}
                      onBlur={() => {
                        if (skipBlurCommitRef.current) {
                          skipBlurCommitRef.current = false;
                          return;
                        }

                        commitEdit(color);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitEdit(color);
                          return;
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault();
                          skipBlurCommitRef.current = true;
                          closeColorCardImmediately();
                        }
                      }}
                      className="h-8 w-full rounded-lg border border-border-dark/80 bg-bg-dark/90 px-2 text-sm text-text-dark outline-none transition-colors focus:border-accent/55"
                      placeholder={t('canvas.semanticColor.editPlaceholder')}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-dark">
                        {colorLabels[color]}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openColorCard(color);
                          setEditingColor(color);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                        title={t('canvas.semanticColor.editLabel')}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
