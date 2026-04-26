import { memo } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiPanel } from "@/components/ui";
import {
  SHOT_PARAM_CATEGORIES,
  type ShotParamOption,
} from "@/features/canvas/shot-params/shotParamsConfig";

const SHOT_PARAM_LABEL_STYLE = {
  textShadow:
    "0 1px 0 rgba(0,0,0,0.92), 1px 0 0 rgba(0,0,0,0.92), 0 -1px 0 rgba(0,0,0,0.92), -1px 0 0 rgba(0,0,0,0.92)",
} as const;

interface ShotParamsPanelProps {
  onClose: () => void;
  onInsert: (option: ShotParamOption) => void;
  className?: string;
}

export const ShotParamsPanel = memo(
  ({ onClose, onInsert, className = "" }: ShotParamsPanelProps) => {
    const { t } = useTranslation();

    return (
      <UiPanel
        className={`nodrag nowheel absolute bottom-0 left-[calc(100%+12px)] top-0 z-40 flex w-[340px] min-h-0 flex-col overflow-hidden border-white/[0.06] bg-surface-dark/96 shadow-[0_22px_56px_rgba(0,0,0,0.42)] backdrop-blur ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <div className="text-[13px] font-semibold text-text-dark">
            {t("shotParams.title")}
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-text-muted transition-colors hover:bg-white/[0.08] hover:text-text-dark"
            aria-label={t("shotParams.close")}
            title={t("shotParams.close")}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="ui-scrollbar nowheel min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {SHOT_PARAM_CATEGORIES.map((category) => (
            <section key={category.id} className="space-y-2">
              <div className="px-1 text-[11px] font-medium tracking-[0.02em] text-text-muted">
                {category.title}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {category.options.map((option) => {
                  return (
                    <button
                      key={`${category.id}-${option.value}`}
                      type="button"
                      className="nodrag nowheel group relative flex h-[78px] overflow-hidden rounded-lg border border-white/10 bg-black/20 text-left transition hover:border-accent/45 hover:shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onInsert(option);
                      }}
                    >
                      {option.imageUrl ? (
                        <>
                          <img
                            src={option.imageUrl}
                            alt={option.label}
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                            draggable={false}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/18 to-black/8" />
                        </>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-text-muted">
                            {t("shotParams.previewUnavailable")}
                          </span>
                        </div>
                      )}

                      <div className="relative z-10 mt-auto w-full px-3 py-2">
                        <div
                          className="truncate text-[12px] font-semibold text-white"
                          style={SHOT_PARAM_LABEL_STYLE}
                        >
                          {option.label}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </UiPanel>
    );
  },
);

ShotParamsPanel.displayName = "ShotParamsPanel";
