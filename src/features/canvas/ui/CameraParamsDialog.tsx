import {
  type WheelEvent as ReactWheelEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiChipButton, UiModal } from "@/components/ui";
import {
  areCameraParamsSelectionsEqual,
  CAMERA_APERTURE_OPTIONS,
  CAMERA_BODY_PRESETS,
  CAMERA_HELP_TABS,
  CAMERA_LENS_PRESETS,
  CAMERA_QUICK_PRESETS,
  EMPTY_CAMERA_PARAMS_SELECTION,
  hasCameraParamsSelection,
  normalizeCameraParamsSelection,
  resolveCameraApertureImage,
  resolveCameraFocalLengthOptions,
  type CameraHelpItem,
  type CameraHelpTab,
  type CameraHelpTabId,
  type CameraQuickPreset,
} from "@/features/canvas/camera/cameraPresets";
import type { CameraParamsSelection } from "@/features/canvas/domain/canvasNodes";

interface CameraParamsDialogProps {
  isOpen: boolean;
  value: Partial<CameraParamsSelection> | null | undefined;
  onApply: (value: CameraParamsSelection | null) => void;
  onClose: () => void;
}

interface CameraWheelColumnProps {
  label: string;
  currentLabel: string;
  currentSubLabel?: string | null;
  currentImageSrc?: string | null;
  currentImageAlt?: string | null;
  onStep: (direction: CameraWheelStepDirection) => void;
  animationSignal: CameraWheelAnimationSignal;
  emphasizeValue?: boolean;
}

interface TranslatedCameraHelpItem extends CameraHelpItem {
  title: string;
}

interface TranslatedCameraHelpTab extends Omit<CameraHelpTab, "items"> {
  label: string;
  items: TranslatedCameraHelpItem[];
}

interface TranslatedCameraQuickPreset extends CameraQuickPreset {
  title: string;
  summary: string;
}

interface CameraWheelContent {
  signature: string;
  label: string;
  subLabel?: string | null;
  imageSrc?: string | null;
  imageAlt?: string | null;
  emphasizeValue: boolean;
}

type CameraWheelStepDirection = -1 | 1;
type CameraWheelKind = "cameraBody" | "lens" | "focalLength" | "aperture";

interface CameraWheelAnimationSignal {
  key: number;
  direction: CameraWheelStepDirection;
}

type CameraWheelAnimationState = Record<CameraWheelKind, CameraWheelAnimationSignal>;

function createInitialCameraWheelAnimations(): CameraWheelAnimationState {
  return {
    cameraBody: { key: 0, direction: 1 },
    lens: { key: 0, direction: 1 },
    focalLength: { key: 0, direction: 1 },
    aperture: { key: 0, direction: 1 },
  };
}

function resolveTranslatedText(
  t: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function buildCameraWheelContent({
  label,
  subLabel,
  imageSrc,
  imageAlt,
  emphasizeValue,
}: {
  label: string;
  subLabel?: string | null;
  imageSrc?: string | null;
  imageAlt?: string | null;
  emphasizeValue: boolean;
}): CameraWheelContent {
  return {
    signature: JSON.stringify([
      label,
      subLabel ?? null,
      imageSrc ?? null,
      imageAlt ?? null,
      emphasizeValue,
    ]),
    label,
    subLabel,
    imageSrc,
    imageAlt,
    emphasizeValue,
  };
}

function resolveStepDirectionByIndex<T>(
  options: readonly T[],
  currentValue: T | null | undefined,
  nextValue: T | null | undefined,
): CameraWheelStepDirection {
  if (nextValue == null) {
    return 1;
  }

  const currentIndex = currentValue == null
    ? -1
    : options.findIndex((option) => option === currentValue);
  const nextIndex = options.findIndex((option) => option === nextValue);

  if (nextIndex < 0) {
    return 1;
  }

  return nextIndex < currentIndex ? -1 : 1;
}

function resolveStepDirectionByNumber(
  currentValue: number | null | undefined,
  nextValue: number | null | undefined,
): CameraWheelStepDirection {
  if (typeof currentValue !== "number" || typeof nextValue !== "number") {
    return 1;
  }

  return nextValue < currentValue ? -1 : 1;
}

function CameraWheelContentView({
  content,
  className = "",
}: {
  content: CameraWheelContent;
  className?: string;
}) {
  if (content.imageSrc) {
    return (
      <div className={`flex w-full flex-col items-center justify-center ${className}`}>
        <img
          src={content.imageSrc}
          alt={content.imageAlt ?? ""}
          className="pointer-events-none h-[58px] max-w-[118px] select-none object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.3)]"
          draggable={false}
        />
        <div className="mt-2 max-w-full truncate text-[10px] font-medium text-text-dark/88">
          {content.label}
        </div>
        {content.subLabel ? (
          <div className="mt-1 text-[11px] text-text-muted">
            {content.subLabel}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className={`max-w-full text-center font-semibold text-text-dark ${
          content.emphasizeValue
            ? "text-[32px] leading-none tracking-[-0.02em]"
            : "text-[15px] leading-6"
        }`}
      >
        <span className="inline-block max-w-full truncate">
          {content.label}
        </span>
      </div>
      {content.subLabel ? (
        <div className="mt-2 text-[11px] text-text-muted">
          {content.subLabel}
        </div>
      ) : null}
    </div>
  );
}

function CameraWheelColumn({
  label,
  currentLabel,
  currentSubLabel,
  currentImageSrc,
  currentImageAlt,
  onStep,
  animationSignal,
  emphasizeValue = false,
}: CameraWheelColumnProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const incomingContentRef = useRef<HTMLDivElement | null>(null);
  const outgoingContentRef = useRef<HTMLDivElement | null>(null);
  const transitionCleanupTimerRef = useRef<number | null>(null);
  const currentContent = useMemo(
    () =>
      buildCameraWheelContent({
        label: currentLabel,
        subLabel: currentSubLabel,
        imageSrc: currentImageSrc,
        imageAlt: currentImageAlt,
        emphasizeValue,
      }),
    [
      currentImageAlt,
      currentImageSrc,
      currentLabel,
      currentSubLabel,
      emphasizeValue,
    ],
  );
  const [displayedContent, setDisplayedContent] = useState<CameraWheelContent>(
    currentContent,
  );
  const [transitionContent, setTransitionContent] = useState<{
    outgoing: CameraWheelContent;
    incoming: CameraWheelContent;
    direction: CameraWheelStepDirection;
    token: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (transitionCleanupTimerRef.current != null) {
        window.clearTimeout(transitionCleanupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (displayedContent.signature === currentContent.signature) {
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (animationSignal.key === 0 || prefersReducedMotion) {
      if (transitionCleanupTimerRef.current != null) {
        window.clearTimeout(transitionCleanupTimerRef.current);
        transitionCleanupTimerRef.current = null;
      }
      setTransitionContent(null);
      setDisplayedContent(currentContent);
      return;
    }

    setTransitionContent({
      outgoing: displayedContent,
      incoming: currentContent,
      direction: animationSignal.direction,
      token: animationSignal.key,
    });
    setDisplayedContent(currentContent);
  }, [
    animationSignal.direction,
    animationSignal.key,
    currentContent,
    displayedContent,
  ]);

  useEffect(() => {
    if (!transitionContent) {
      return;
    }

    if (
      typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    ) {
      return;
    }

    const incomingNode = incomingContentRef.current;
    const outgoingNode = outgoingContentRef.current;
    if (!incomingNode) {
      return;
    }

    const cardNode = cardRef.current;
    const incomingStartOffset = transitionContent.direction === 1 ? 76 : -76;
    const outgoingEndOffset = incomingStartOffset * -0.84;

    incomingNode.getAnimations().forEach((animation) => animation.cancel());
    outgoingNode?.getAnimations().forEach((animation) => animation.cancel());
    cardNode?.getAnimations().forEach((animation) => animation.cancel());

    incomingNode.animate(
      [
        {
          opacity: 0.4,
          transform: `translateY(${incomingStartOffset}px) scale(0.92)`,
          filter: "blur(10px)",
        },
        {
          opacity: 1,
          transform: `translateY(${incomingStartOffset * -0.13}px) scale(1.018)`,
          filter: "blur(0px)",
          offset: 0.72,
        },
        {
          opacity: 1,
          transform: `translateY(${incomingStartOffset * 0.045}px) scale(0.998)`,
          filter: "blur(0px)",
          offset: 0.88,
        },
        {
          opacity: 1,
          transform: "translateY(0px) scale(1)",
          filter: "blur(0px)",
        },
      ],
      {
        duration: 520,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );

    outgoingNode?.animate(
      [
        {
          opacity: 1,
          transform: "translateY(0px) scale(1)",
          filter: "blur(0px)",
        },
        {
          opacity: 0.84,
          transform: `translateY(${outgoingEndOffset * 0.72}px) scale(0.986)`,
          filter: "blur(1px)",
          offset: 0.55,
        },
        {
          opacity: 0,
          transform: `translateY(${outgoingEndOffset}px) scale(0.95)`,
          filter: "blur(8px)",
        },
      ],
      {
        duration: 460,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      },
    );

    cardNode?.animate(
      [
        {
          transform: "scale(0.988)",
          boxShadow: "0 0 0 rgba(0, 0, 0, 0)",
        },
        {
          transform: "scale(1.013)",
          boxShadow: "0 16px 32px rgba(0, 0, 0, 0.18)",
          offset: 0.62,
        },
        {
          transform: "scale(0.999)",
          boxShadow: "0 10px 18px rgba(0, 0, 0, 0.08)",
          offset: 0.86,
        },
        {
          transform: "scale(1)",
          boxShadow: "0 0 0 rgba(0, 0, 0, 0)",
        },
      ],
      {
        duration: 540,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );

    if (transitionCleanupTimerRef.current != null) {
      window.clearTimeout(transitionCleanupTimerRef.current);
    }

    transitionCleanupTimerRef.current = window.setTimeout(() => {
      setTransitionContent((previous) =>
        previous?.token === transitionContent.token ? null : previous,
      );
      transitionCleanupTimerRef.current = null;
    }, 560);
  }, [transitionContent]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.deltaY > 0) {
      onStep(1);
      return;
    }
    if (event.deltaY < 0) {
      onStep(-1);
    }
  };

  return (
    <div className="flex min-w-[156px] flex-1 flex-col items-center gap-0.5">
      <div className="text-[11px] font-medium tracking-[0.02em] text-text-muted">
        {label}
      </div>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/8 hover:text-text-dark active:scale-90"
        onClick={() => onStep(-1)}
      >
        <ChevronUp className="h-4 w-4" strokeWidth={2} />
      </button>
      <div
        className="w-full px-2 py-0.5"
        onWheel={handleWheel}
      >
        <div className="flex justify-center overflow-hidden text-center">
          <div
            ref={cardRef}
            className="flex h-[116px] w-full max-w-[154px] flex-col items-center justify-center rounded-[20px] border border-white/10 bg-[rgba(255,255,255,0.045)] px-3 py-4 transition-[border-color,background-color,box-shadow,transform] duration-300 will-change-transform"
          >
            <div className="relative h-full w-full overflow-hidden">
              {transitionContent ? (
                <>
                  <div
                    ref={outgoingContentRef}
                    className="absolute inset-0 flex items-center justify-center will-change-transform"
                  >
                    <CameraWheelContentView content={transitionContent.outgoing} />
                  </div>
                  <div
                    ref={incomingContentRef}
                    className="absolute inset-0 flex items-center justify-center will-change-transform"
                  >
                    <CameraWheelContentView content={transitionContent.incoming} />
                  </div>
                </>
              ) : (
                <div
                  ref={incomingContentRef}
                  className="absolute inset-0 flex items-center justify-center will-change-transform"
                >
                  <CameraWheelContentView content={displayedContent} />
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-[rgba(28,28,28,0.2)] to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-[rgba(28,28,28,0.22)] to-transparent" />
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-all duration-200 hover:translate-y-0.5 hover:bg-white/8 hover:text-text-dark active:scale-90"
        onClick={() => onStep(1)}
      >
        <ChevronDown className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}

function CameraHelpContent() {
  const { t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState<CameraHelpTabId>("focalLength");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const helpTabs = useMemo(
    () =>
      CAMERA_HELP_TABS.map((tab) => ({
        ...tab,
        label: resolveTranslatedText(t, tab.labelKey, tab.fallbackLabel),
        items: tab.items.map((item) => ({
          ...item,
          title: resolveTranslatedText(t, item.titleKey, item.fallbackTitle),
        })),
      })) satisfies TranslatedCameraHelpTab[],
    [t],
  );
  const activeTab =
    helpTabs.find((tab) => tab.id === activeTabId) ?? helpTabs[0] ?? null;

  useEffect(() => {
    if (!activeTab && helpTabs[0]) {
      setActiveTabId(helpTabs[0].id);
      return;
    }

    if (activeTab) {
      return;
    }

    setActiveTabId("focalLength");
  }, [activeTab, helpTabs]);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, [activeTab?.id]);

  return (
    <div className="space-y-3.5">
      <div className="rounded-[18px] border border-white/8 bg-[rgba(255,255,255,0.024)] p-1.5">
        <div className="flex flex-wrap gap-1.5">
          {helpTabs.map((tab) => (
            <UiChipButton
              key={tab.id}
              type="button"
              active={tab.id === activeTab?.id}
              className={`!h-8 !rounded-[11px] !px-3 !text-[11px] !font-medium ${
                tab.id === activeTab?.id
                  ? "!border-accent/45 !bg-accent/15 !text-text-dark"
                  : "!border-white/7 !bg-transparent !text-text-muted hover:!bg-white/[0.045]"
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.label}
            </UiChipButton>
          ))}
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        className="ui-scrollbar max-h-[68vh] overflow-y-auto pr-1.5"
      >
        {activeTab ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-3.5">
            {activeTab.items.map((item) => (
              <CameraHelpImageCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CameraHelpImageCard({
  item,
}: {
  item: TranslatedCameraHelpItem;
}) {
  const isHero = item.layout === "hero";

  return (
    <div
      className={`overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.022))] p-3 shadow-[0_16px_34px_rgba(0,0,0,0.16)] ${
        isHero ? "md:col-span-2" : ""
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isHero ? "bg-accent/90 shadow-[0_0_14px_rgba(var(--accent-rgb),0.35)]" : "bg-white/45"
          }`}
        />
        <div
          className={`min-w-0 truncate font-semibold tracking-[0.01em] text-text-dark ${
            isHero ? "text-[15px]" : "text-[13px]"
          }`}
        >
          {item.title}
        </div>
      </div>
      <div className="overflow-hidden rounded-[18px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.055),rgba(12,12,12,0.16)_52%,rgba(8,8,8,0.28)_100%)]">
        <img
          src={item.imageSrc}
          alt={item.title}
          className="block w-full object-contain"
          loading="lazy"
          draggable={false}
        />
      </div>
    </div>
  );
}

export const CameraParamsDialog = memo(
  ({ isOpen, value, onApply, onClose }: CameraParamsDialogProps) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<CameraParamsSelection>(
      EMPTY_CAMERA_PARAMS_SELECTION,
    );
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [animationSignals, setAnimationSignals] = useState<CameraWheelAnimationState>(
      () => createInitialCameraWheelAnimations(),
    );

    useEffect(() => {
      if (!isOpen) {
        setIsHelpOpen(false);
        setAnimationSignals(createInitialCameraWheelAnimations());
        return;
      }

      setDraft(normalizeCameraParamsSelection(value));
      setAnimationSignals(createInitialCameraWheelAnimations());
    }, [isOpen, value]);

    const cameraBodyOptions = CAMERA_BODY_PRESETS;
    const lensOptions = CAMERA_LENS_PRESETS;
    const focalLengthOptions = useMemo(
      () => resolveCameraFocalLengthOptions(draft.lensId),
      [draft.lensId],
    );
    const apertureOptions = CAMERA_APERTURE_OPTIONS;

    const translatedCameraBodies = useMemo(
      () =>
        cameraBodyOptions.map((option) => ({
          ...option,
          label: resolveTranslatedText(t, option.labelKey, option.fallbackLabel),
        })),
      [cameraBodyOptions, t],
    );
    const translatedLenses = useMemo(
      () =>
        lensOptions.map((option) => ({
          ...option,
          label: resolveTranslatedText(t, option.labelKey, option.fallbackLabel),
        })),
      [lensOptions, t],
    );
    const translatedQuickPresets = useMemo(
      () =>
        CAMERA_QUICK_PRESETS.map((preset) => ({
          ...preset,
          title: resolveTranslatedText(t, preset.titleKey, preset.fallbackTitle),
          summary: resolveTranslatedText(t, preset.summaryKey, preset.fallbackSummary),
        })) satisfies TranslatedCameraQuickPreset[],
      [t],
    );
    const notSetLabel = t("cameraParams.notSet");
    const currentCameraBodyLabel = translatedCameraBodies.find(
      (option) => option.id === draft.cameraBodyId,
    )?.label ?? notSetLabel;
    const currentLensLabel = translatedLenses.find(
      (option) => option.id === draft.lensId,
    )?.label ?? notSetLabel;
    const currentFocalLengthLabel = draft.focalLengthMm
      ? String(draft.focalLengthMm)
      : notSetLabel;
    const currentApertureLabel = draft.aperture ?? notSetLabel;
    const selectedCameraBodyOption = translatedCameraBodies.find(
      (option) => option.id === draft.cameraBodyId,
    ) ?? null;
    const selectedLensOption = translatedLenses.find(
      (option) => option.id === draft.lensId,
    ) ?? null;
    const selectedApertureValue = draft.aperture ?? null;
    const activeQuickPresetId = translatedQuickPresets.find((preset) =>
      areCameraParamsSelectionsEqual(draft, preset.selection)
    )?.id ?? null;

    const resolveSteppedOption = <T,>(
      options: readonly T[],
      currentValue: T | null | undefined,
      direction: -1 | 1,
    ): T | null => {
      if (options.length === 0) {
        return null;
      }

      const currentIndex = currentValue == null
        ? -1
        : options.findIndex((option) => option === currentValue);
      const safeIndex = currentIndex < 0 ? -1 : currentIndex;
      const nextIndex = Math.max(0, Math.min(options.length - 1, safeIndex + direction));
      return options[nextIndex] ?? null;
    };

    const bumpAnimation = (
      target: CameraWheelKind,
      direction: CameraWheelStepDirection,
    ) => {
      setAnimationSignals((previous) => ({
        ...previous,
        [target]: {
          key: previous[target].key + 1,
          direction,
        },
      }));
    };

    const handleCameraBodyStep = (direction: CameraWheelStepDirection) => {
      const currentOption = translatedCameraBodies.find(
        (option) => option.id === draft.cameraBodyId,
      ) ?? null;
      const nextOption = resolveSteppedOption(
        translatedCameraBodies,
        currentOption,
        direction,
      );

      if (!nextOption || nextOption.id === draft.cameraBodyId) {
        return;
      }

      bumpAnimation("cameraBody", direction);
      setDraft((previous) => ({
        ...previous,
        cameraBodyId: nextOption.id,
      }));
    };

    const handleLensStep = (direction: CameraWheelStepDirection) => {
      const currentOption = translatedLenses.find(
        (option) => option.id === draft.lensId,
      ) ?? null;
      const nextOption = resolveSteppedOption(
        translatedLenses,
        currentOption,
        direction,
      );

      if (!nextOption || nextOption.id === draft.lensId) {
        return;
      }

      const nextFocalLengths = resolveCameraFocalLengthOptions(nextOption.id);
      const nextFocalLength =
        typeof draft.focalLengthMm === "number"
        && nextFocalLengths.includes(draft.focalLengthMm)
          ? draft.focalLengthMm
          : (nextOption.id ? (nextFocalLengths[0] ?? null) : draft.focalLengthMm);

      bumpAnimation("lens", direction);
      if (nextFocalLength !== draft.focalLengthMm) {
        bumpAnimation("focalLength", direction);
      }

      setDraft((previous) => ({
        ...previous,
        lensId: nextOption.id,
        focalLengthMm: nextFocalLength,
      }));
    };

    const handleFocalLengthStep = (direction: CameraWheelStepDirection) => {
      const nextFocalLength = resolveSteppedOption(
        focalLengthOptions,
        draft.focalLengthMm,
        direction,
      );

      if (nextFocalLength == null || nextFocalLength === draft.focalLengthMm) {
        return;
      }

      bumpAnimation("focalLength", direction);
      setDraft((previous) => ({
        ...previous,
        focalLengthMm: nextFocalLength,
      }));
    };

    const handleApertureStep = (direction: CameraWheelStepDirection) => {
      const nextAperture = resolveSteppedOption(
        apertureOptions,
        draft.aperture,
        direction,
      );

      if (!nextAperture || nextAperture === draft.aperture) {
        return;
      }

      bumpAnimation("aperture", direction);
      setDraft((previous) => ({
        ...previous,
        aperture: nextAperture,
      }));
    };

    const handleApplyQuickPreset = (preset: CameraQuickPreset) => {
      const nextSelection = normalizeCameraParamsSelection(preset.selection);
      if (areCameraParamsSelectionsEqual(draft, nextSelection)) {
        return;
      }

      if (nextSelection.cameraBodyId !== draft.cameraBodyId) {
        bumpAnimation(
          "cameraBody",
          resolveStepDirectionByIndex(
            cameraBodyOptions.map((option) => option.id),
            draft.cameraBodyId,
            nextSelection.cameraBodyId,
          ),
        );
      }

      if (nextSelection.lensId !== draft.lensId) {
        bumpAnimation(
          "lens",
          resolveStepDirectionByIndex(
            lensOptions.map((option) => option.id),
            draft.lensId,
            nextSelection.lensId,
          ),
        );
      }

      if (nextSelection.focalLengthMm !== draft.focalLengthMm) {
        bumpAnimation(
          "focalLength",
          resolveStepDirectionByNumber(
            draft.focalLengthMm,
            nextSelection.focalLengthMm,
          ),
        );
      }

      if (nextSelection.aperture !== draft.aperture) {
        bumpAnimation(
          "aperture",
          resolveStepDirectionByIndex(
            apertureOptions,
            draft.aperture,
            nextSelection.aperture,
          ),
        );
      }

      setDraft(nextSelection);
    };

    const handleUse = () => {
      const normalized = normalizeCameraParamsSelection(draft);
      onApply(hasCameraParamsSelection(normalized) ? normalized : null);
      onClose();
    };

    const handleClear = () => {
      onApply(null);
      onClose();
    };

    return (
      <>
        <UiModal
          isOpen={isOpen}
          title={t("cameraParams.title")}
          onClose={onClose}
          widthClassName="w-[820px] max-w-[calc(100vw-32px)]"
          headerClassName="border-b-0"
          footer={(
            <div className="flex w-full items-center justify-between gap-3">
              <button
                type="button"
                className="text-xs text-text-muted transition-colors hover:text-text-dark"
                onClick={() => setIsHelpOpen(true)}
              >
                {t("cameraParams.helpLink")}
              </button>
              <div className="flex items-center gap-2">
                <UiButton type="button" variant="ghost" size="sm" onClick={handleClear}>
                  {t("cameraParams.clear")}
                </UiButton>
                <UiButton type="button" variant="muted" size="sm" onClick={onClose}>
                  {t("common.cancel")}
                </UiButton>
                <UiButton type="button" variant="primary" size="sm" onClick={handleUse}>
                  {t("cameraParams.use")}
                </UiButton>
              </div>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="rounded-[16px] bg-[rgba(255,255,255,0.02)] px-2.5 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="text-[10px] font-medium tracking-[0.02em] text-text-muted">
                  {t("cameraParams.quickPresets.title")}
                </div>
                <div className="text-[9px] text-text-muted/80">
                  {t("cameraParams.quickPresets.hint")}
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {translatedQuickPresets.map((preset) => {
                  const isActive = preset.id === activeQuickPresetId;

                  return (
                    <UiChipButton
                      key={preset.id}
                      type="button"
                      active={isActive}
                      className={`!h-auto !min-h-[44px] !items-start !justify-start !rounded-[10px] !px-2.5 !py-1.5 !text-left ${
                        isActive
                          ? "!border-accent/45 !bg-accent/15"
                          : "!border-white/8 !bg-[rgba(255,255,255,0.026)] hover:!bg-white/[0.05]"
                      }`}
                      onClick={() => handleApplyQuickPreset(preset)}
                    >
                      <span className="flex min-w-0 flex-col items-start gap-1">
                        <span className="truncate text-[11px] font-medium leading-none text-text-dark">
                          {preset.title}
                        </span>
                        <span className="truncate text-[9px] leading-none text-text-muted">
                          {preset.summary}
                        </span>
                      </span>
                    </UiChipButton>
                  );
                })}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CameraWheelColumn
                label={t("cameraParams.fields.cameraBody")}
                currentLabel={currentCameraBodyLabel}
                currentImageSrc={selectedCameraBodyOption?.imageSrc ?? null}
                currentImageAlt={selectedCameraBodyOption?.label ?? currentCameraBodyLabel}
                onStep={handleCameraBodyStep}
                animationSignal={animationSignals.cameraBody}
              />

              <div className="hidden h-[198px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.lens")}
                currentLabel={currentLensLabel}
                currentImageSrc={selectedLensOption?.imageSrc ?? null}
                currentImageAlt={selectedLensOption?.label ?? currentLensLabel}
                onStep={handleLensStep}
                animationSignal={animationSignals.lens}
              />

              <div className="hidden h-[198px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.focalLength")}
                currentLabel={currentFocalLengthLabel}
                currentSubLabel={draft.focalLengthMm ? "mm" : null}
                emphasizeValue={Boolean(draft.focalLengthMm)}
                onStep={handleFocalLengthStep}
                animationSignal={animationSignals.focalLength}
              />

              <div className="hidden h-[198px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.aperture")}
                currentLabel={currentApertureLabel}
                currentImageSrc={resolveCameraApertureImage(selectedApertureValue)}
                currentImageAlt={selectedApertureValue}
                emphasizeValue={Boolean(draft.aperture)}
                onStep={handleApertureStep}
                animationSignal={animationSignals.aperture}
              />
            </div>
          </div>
        </UiModal>

        <UiModal
          isOpen={isHelpOpen}
          title={t("cameraHelp.title")}
          onClose={() => setIsHelpOpen(false)}
          widthClassName="w-[1080px] max-w-[calc(100vw-24px)]"
          containerClassName="px-3 py-4"
          headerClassName="border-b-0 pb-2"
          draggable={false}
        >
          <CameraHelpContent />
        </UiModal>
      </>
    );
  },
);

CameraParamsDialog.displayName = "CameraParamsDialog";
