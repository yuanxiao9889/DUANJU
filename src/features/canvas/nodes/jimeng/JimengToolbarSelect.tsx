import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

import { UiChipButton, UiPanel } from '@/components/ui';

export interface JimengToolbarSelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
}

interface JimengToolbarSelectProps<T extends string | number> {
  value: T;
  options: JimengToolbarSelectOption<T>[];
  onChange: (value: T) => void;
  icon?: ReactNode;
  className?: string;
  panelClassName?: string;
  align?: 'start' | 'center';
  layout?: 'list' | 'grid';
  columnsClassName?: string;
  showChevron?: boolean;
  renderTriggerLabel?: (option: JimengToolbarSelectOption<T> | undefined) => ReactNode;
  renderGridOption?: (option: JimengToolbarSelectOption<T>, active: boolean) => ReactNode;
  triggerButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

interface PanelAnchor {
  left: number;
  top: number;
}

function buildPanelStyle(
  anchor: PanelAnchor | null,
  align: 'start' | 'center'
): React.CSSProperties | undefined {
  if (!anchor) {
    return undefined;
  }

  const xTransform = align === 'center' ? 'translateX(-50%) ' : '';
  return {
    left: `${anchor.left}px`,
    top: `${anchor.top}px`,
    transform: `${xTransform}translateY(-100%)`,
  };
}

export function JimengToolbarSelect<T extends string | number>({
  value,
  options,
  onChange,
  icon,
  className = '',
  panelClassName = 'min-w-[220px] p-1',
  align = 'center',
  layout = 'list',
  columnsClassName = 'grid-cols-3',
  showChevron = true,
  renderTriggerLabel,
  renderGridOption,
  triggerButtonProps,
}: JimengToolbarSelectProps<T>) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelAnchor, setPanelAnchor] = useState<PanelAnchor | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  );
  const {
    className: triggerButtonClassName,
    onClick: onTriggerButtonClick,
    ...restTriggerButtonProps
  } = triggerButtonProps ?? {};

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const updateAnchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      setPanelAnchor({
        left: align === 'center' ? rect.left + rect.width / 2 : rect.left,
        top: rect.top - 8,
      });
    };

    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [align, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [isOpen]);

  return (
    <>
      <div ref={triggerRef} className="relative flex">
        <UiChipButton
          active={isOpen}
          className={`${className} ${triggerButtonClassName ?? ''}`.trim()}
          onClick={(event) => {
            event.stopPropagation();
            onTriggerButtonClick?.(event);
            if (event.defaultPrevented) {
              return;
            }
            setIsOpen((previous) => !previous);
          }}
          {...restTriggerButtonProps}
        >
          {icon ? <span className="flex h-4 w-4 items-center justify-center">{icon}</span> : null}
          <span className="truncate">{renderTriggerLabel ? renderTriggerLabel(selectedOption) : selectedOption?.label}</span>
          {showChevron ? (
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          ) : null}
        </UiChipButton>
      </div>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[140]"
            style={buildPanelStyle(panelAnchor, align)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <UiPanel className={panelClassName}>
              {layout === 'grid' ? (
                <div className={`grid gap-2 ${columnsClassName}`}>
                  {options.map((option) => {
                    const active = option.value === value;
                    return (
                      <button
                        key={String(option.value)}
                        type="button"
                        className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl border px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'border-accent/50 bg-accent/14 text-text-dark'
                            : 'border-white/8 bg-white/[0.03] text-text-muted hover:border-white/18 hover:bg-white/[0.06] hover:text-text-dark'
                        }`}
                        onClick={() => {
                          onChange(option.value);
                          setIsOpen(false);
                        }}
                      >
                        {renderGridOption ? (
                          renderGridOption(option, active)
                        ) : (
                          <span className="font-medium">{option.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="max-h-[320px] space-y-1 overflow-y-auto">
                  {options.map((option) => {
                    const active = option.value === value;
                    return (
                      <button
                        key={String(option.value)}
                        type="button"
                        className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                          active
                            ? 'border-accent/40 bg-white/[0.06] text-text-dark'
                            : 'border-transparent bg-transparent text-text-muted hover:border-white/10 hover:bg-white/[0.04] hover:text-text-dark'
                        }`}
                        onClick={() => {
                          onChange(option.value);
                          setIsOpen(false);
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-inherit">{option.label}</div>
                          {option.description ? (
                            <div className="mt-1 text-xs text-text-muted">{option.description}</div>
                          ) : null}
                        </div>
                        {active ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-text-dark" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </UiPanel>
          </div>,
          document.body
        )
        : null}
    </>
  );
}
