import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { resolveBuiltinStyleTemplatePreviewImageUrl } from "@/features/project/defaultStyleTemplates";
import type { StyleTemplate } from "@/features/project/styleTemplateUtils";

interface StyleTemplateCardProps {
  template: StyleTemplate;
  categoryLabel?: string | null;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
  size?: "default" | "compact";
  radius?: "default" | "compact";
}

function StyleTemplateCardContent({
  template,
  categoryLabel,
  actions,
  size = "default",
  radius = "default",
}: Pick<StyleTemplateCardProps, "template" | "categoryLabel" | "actions" | "size" | "radius">) {
  const { t } = useTranslation();
  const previewImageSources = useMemo(() => {
    const candidates = [
      template.imageUrl,
      resolveBuiltinStyleTemplatePreviewImageUrl(template),
    ];
    const seen = new Set<string>();

    return candidates.reduce<string[]>((accumulator, candidate) => {
      const trimmedCandidate = typeof candidate === "string" ? candidate.trim() : "";
      if (!trimmedCandidate) {
        return accumulator;
      }

      const displayUrl = resolveImageDisplayUrl(trimmedCandidate);
      if (!displayUrl || seen.has(displayUrl)) {
        return accumulator;
      }

      seen.add(displayUrl);
      accumulator.push(displayUrl);
      return accumulator;
    }, []);
  }, [template]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const isCompact = size === "compact";
  const isCompactRadius = radius === "compact";
  const displayImageUrl = previewImageSources[activeImageIndex] ?? null;

  useEffect(() => {
    setActiveImageIndex(0);
  }, [previewImageSources]);

  return (
    <>
      <div
        className={`relative overflow-hidden border border-white/10 bg-black/15 ${
          isCompact
            ? isCompactRadius
              ? "rounded-[10px]"
              : "rounded-[14px]"
            : isCompactRadius
              ? "rounded-[14px]"
              : "rounded-[20px]"
        }`}
      >
        <div className="aspect-[3/4] w-full">
          {displayImageUrl ? (
            <img
              src={displayImageUrl}
              alt={template.name}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() =>
                setActiveImageIndex((currentIndex) =>
                  currentIndex + 1 < previewImageSources.length
                    ? currentIndex + 1
                    : currentIndex
                )
              }
            />
          ) : (
            <div
              className={`flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] text-center ${
                isCompact ? "gap-2 px-3" : "gap-3 px-4"
              }`}
            >
              <div
                className={`flex items-center justify-center border border-white/12 bg-white/8 text-text-dark ${
                  isCompact
                    ? isCompactRadius
                      ? "h-9 w-9 rounded-[10px]"
                      : "h-9 w-9 rounded-xl"
                    : isCompactRadius
                      ? "h-12 w-12 rounded-[14px]"
                      : "h-12 w-12 rounded-2xl"
                }`}
              >
                <Palette className={isCompact ? "h-4 w-4" : "h-5 w-5"} />
              </div>
              <div className={isCompact ? "space-y-0.5" : "space-y-1"}>
                <div
                  className={`font-medium text-text-dark ${
                    isCompact ? "text-xs" : "text-sm"
                  }`}
                >
                  {t("styleTemplate.noImage")}
                </div>
                <div
                  className={`text-text-muted ${
                    isCompact ? "text-[10px] leading-4" : "text-[11px] leading-5"
                  }`}
                >
                  {t("styleTemplate.noImageHint")}
                </div>
              </div>
            </div>
          )}
        </div>

        {actions ? (
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 flex justify-end ${
              isCompact ? "p-1.5" : "p-2"
            }`}
          >
            <div
              className={`pointer-events-auto flex gap-1 rounded-full border border-white/10 bg-surface-dark/88 shadow-[0_10px_30px_rgba(0,0,0,0.26)] ${
                isCompact ? "p-0.5" : "p-1"
              }`}
            >
              {actions}
            </div>
          </div>
        ) : null}

        {!displayImageUrl ? (
          <div
            className={`pointer-events-none absolute flex items-center justify-center rounded-full border border-white/12 bg-black/35 text-white/85 ${
              isCompact ? "left-2 top-2 h-6 w-6" : "left-3 top-3 h-7 w-7"
            }`}
          >
            <ImageIcon className={isCompact ? "h-3 w-3" : "h-3.5 w-3.5"} />
          </div>
        ) : null}
      </div>

      <div className={`min-w-0 px-0.5 ${isCompact ? "mt-1.5" : "mt-2"}`}>
        <div
          className={`truncate font-medium text-text-dark ${
            isCompact ? "text-xs" : "text-sm"
          }`}
        >
          {template.name}
        </div>
        {categoryLabel ? (
          <div
            className={`truncate text-text-muted ${
              isCompact ? "mt-0.5 text-[10px]" : "mt-1 text-[11px]"
            }`}
          >
            {categoryLabel}
          </div>
        ) : null}
      </div>
    </>
  );
}

export const StyleTemplateCard = memo(
  ({
    template,
    categoryLabel,
    onClick,
    actions,
    className = "",
    size = "default",
    radius = "default",
  }: StyleTemplateCardProps) => {
    const isCompact = size === "compact";
    const isCompactRadius = radius === "compact";

    if (onClick) {
      return (
        <button
          type="button"
          className={`group block w-full border border-transparent text-left transition-all hover:-translate-y-0.5 hover:border-white/10 hover:bg-white/[0.03] ${
            isCompact
              ? isCompactRadius
                ? "rounded-[12px] p-1.5"
                : "rounded-[18px] p-1.5"
              : isCompactRadius
                ? "rounded-[16px] p-2"
                : "rounded-[24px] p-2"
          } ${className}`}
          onClick={onClick}
        >
          <StyleTemplateCardContent
            template={template}
            categoryLabel={categoryLabel}
            actions={actions}
            size={size}
            radius={radius}
          />
        </button>
      );
    }

    return (
      <div
        className={`group border border-white/10 bg-white/[0.03] transition-colors hover:bg-white/[0.05] ${
          isCompact
            ? isCompactRadius
              ? "rounded-[12px] p-1.5"
              : "rounded-[18px] p-1.5"
            : isCompactRadius
              ? "rounded-[16px] p-2"
              : "rounded-[24px] p-2"
        } ${className}`}
      >
        <StyleTemplateCardContent
          template={template}
          categoryLabel={categoryLabel}
          actions={actions}
          size={size}
          radius={radius}
        />
      </div>
    );
  },
);

StyleTemplateCard.displayName = "StyleTemplateCard";
