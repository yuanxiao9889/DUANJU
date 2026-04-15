import {
  type WheelEvent as ReactWheelEvent,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Camera, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiModal } from "@/components/ui";
import {
  CAMERA_APERTURE_OPTIONS,
  CAMERA_BODY_PRESETS,
  CAMERA_HELP_ENTRIES,
  CAMERA_LENS_PRESETS,
  EMPTY_CAMERA_PARAMS_SELECTION,
  hasCameraParamsSelection,
  normalizeCameraParamsSelection,
  resolveCameraFocalLengthOptions,
  type CameraHelpEntry,
  type CameraLensPreset,
  type CameraPresetOption,
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
  previousLabel?: string | null;
  nextLabel?: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  emphasizeValue?: boolean;
}

function resolveTranslatedText(
  t: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function findOptionIndex<T>(options: readonly T[], value: T): number {
  return options.findIndex((option) => option === value);
}

function resolveRelativeLabel<T>(
  options: readonly T[],
  currentIndex: number,
  offset: number,
  resolver: (option: T) => string,
): string | null {
  const nextIndex = currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= options.length) {
    return null;
  }

  return resolver(options[nextIndex]);
}

function CameraWheelColumn({
  label,
  currentLabel,
  currentSubLabel,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onWheel,
  emphasizeValue = false,
}: CameraWheelColumnProps) {
  return (
    <div className="flex min-w-[156px] flex-1 flex-col items-center gap-2">
      <div className="text-[11px] font-medium tracking-[0.02em] text-text-muted">
        {label}
      </div>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/8 hover:text-text-dark"
        onClick={onPrevious}
      >
        <ChevronUp className="h-4 w-4" strokeWidth={2} />
      </button>
      <div
        className="w-full rounded-[24px] border border-white/10 bg-[rgba(255,255,255,0.03)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        onWheel={onWheel}
      >
        <div className="flex min-h-[164px] flex-col items-center justify-center gap-2 overflow-hidden text-center">
          <div className="min-h-[18px] text-[11px] text-white/28">
            {previousLabel ?? " "}
          </div>
          <div className="flex min-h-[94px] w-full flex-col items-center justify-center rounded-[20px] border border-white/10 bg-[rgba(255,255,255,0.045)] px-3 py-4">
            <div
              className={`max-w-full text-center font-semibold text-text-dark ${
                emphasizeValue
                  ? "text-[32px] leading-none tracking-[-0.02em]"
                  : "text-[15px] leading-6"
              }`}
            >
              <span className="inline-block max-w-full truncate">
                {currentLabel}
              </span>
            </div>
            {currentSubLabel ? (
              <div className="mt-2 text-[11px] text-text-muted">
                {currentSubLabel}
              </div>
            ) : null}
          </div>
          <div className="min-h-[18px] text-[11px] text-white/28">
            {nextLabel ?? " "}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/8 hover:text-text-dark"
        onClick={onNext}
      >
        <ChevronDown className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}

function CameraHelpContent() {
  const { t } = useTranslation();

  const helpEntries = useMemo(
    () =>
      CAMERA_HELP_ENTRIES.map((entry) => ({
        ...entry,
        title: resolveTranslatedText(t, entry.titleKey, entry.fallbackTitle),
        body: resolveTranslatedText(t, entry.bodyKey, entry.fallbackBody),
        tags: entry.tags.map((tag) =>
          resolveTranslatedText(t, tag.key, tag.fallback),
        ),
      })),
    [t],
  );

  return (
    <div className="ui-scrollbar max-h-[68vh] space-y-4 overflow-y-auto pr-1">
      <div className="rounded-2xl border border-white/8 bg-[rgba(255,255,255,0.03)] px-4 py-3">
        <div className="text-sm font-medium text-text-dark">
          {t("cameraHelp.title")}
        </div>
        <div className="mt-1 text-sm leading-6 text-text-muted">
          {t("cameraHelp.subtitle")}
        </div>
      </div>

      {helpEntries.map((entry) => (
        <CameraHelpCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function CameraHelpCard({
  entry,
}: {
  entry: CameraHelpEntry & {
    title: string;
    body: string;
    tags: string[];
  };
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-[rgba(255,255,255,0.03)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-text-dark">
            {entry.title}
          </div>
          <div className="mt-2 text-sm leading-7 text-text-muted">
            {entry.body}
          </div>
        </div>
        <div className="rounded-full border border-white/10 bg-[rgba(255,255,255,0.05)] px-3 py-1 text-xs font-medium text-text-muted">
          {entry.focalLengthMm}mm
        </div>
      </div>

      {entry.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/8 bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] text-text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
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

    useEffect(() => {
      if (!isOpen) {
        setIsHelpOpen(false);
        return;
      }

      setDraft(normalizeCameraParamsSelection(value));
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
    const notSetLabel = t("cameraParams.notSet");
    const cameraBodyIndex = Math.max(
      0,
      findOptionIndex(
        translatedCameraBodies,
        translatedCameraBodies.find((option) => option.id === draft.cameraBodyId)
          ?? translatedCameraBodies[0],
      ),
    );
    const lensIndex = Math.max(
      0,
      findOptionIndex(
        translatedLenses,
        translatedLenses.find((option) => option.id === draft.lensId)
          ?? translatedLenses[0],
      ),
    );
    const focalLengthIndex = draft.focalLengthMm
      ? Math.max(0, findOptionIndex(focalLengthOptions, draft.focalLengthMm))
      : 0;
    const apertureIndex = draft.aperture
      ? Math.max(0, findOptionIndex(apertureOptions, draft.aperture))
      : 0;

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

    const stepOption = <T,>(
      options: readonly T[],
      currentValue: T | null | undefined,
      direction: -1 | 1,
      onResolve: (value: T) => void,
    ) => {
      if (options.length === 0) {
        return;
      }

      const currentIndex = currentValue == null
        ? (direction > 0 ? 0 : options.length - 1)
        : options.findIndex((option) => option === currentValue);
      const safeIndex = currentIndex < 0
        ? (direction > 0 ? 0 : options.length - 1)
        : currentIndex;
      const nextIndex = Math.max(0, Math.min(options.length - 1, safeIndex + direction));
      onResolve(options[nextIndex]);
    };

    const handleWheelStep = (
      event: ReactWheelEvent<HTMLDivElement>,
      step: () => void,
      inverseStep: () => void,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY > 0) {
        step();
        return;
      }
      if (event.deltaY < 0) {
        inverseStep();
      }
    };

    const setLensId = (nextLensId: string | null) => {
      setDraft((previous) => {
        const nextFocalLengths = resolveCameraFocalLengthOptions(nextLensId);
        const currentFocalLengthStillValid =
          typeof previous.focalLengthMm === "number"
          && nextFocalLengths.includes(previous.focalLengthMm);

        return {
          ...previous,
          lensId: nextLensId,
          focalLengthMm: currentFocalLengthStillValid
            ? previous.focalLengthMm
            : (nextLensId ? (nextFocalLengths[0] ?? null) : previous.focalLengthMm),
        };
      });
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
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/8 bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm leading-6 text-text-muted">
              {t("cameraParams.dialogHint")}
            </div>

            <div className="flex items-start gap-3">
              <div className="hidden h-[220px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.cameraBody")}
                currentLabel={currentCameraBodyLabel}
                previousLabel={resolveRelativeLabel(
                  translatedCameraBodies,
                  cameraBodyIndex,
                  -1,
                  (option) => option.label,
                )}
                nextLabel={resolveRelativeLabel(
                  translatedCameraBodies,
                  cameraBodyIndex,
                  1,
                  (option) => option.label,
                )}
                onPrevious={() => {
                  stepOption(
                    translatedCameraBodies,
                    translatedCameraBodies.find((option) => option.id === draft.cameraBodyId)
                      ?? null,
                    -1,
                    (next) =>
                      setDraft((previous) => ({
                        ...previous,
                        cameraBodyId: next.id,
                      })),
                  );
                }}
                onNext={() => {
                  stepOption(
                    translatedCameraBodies,
                    translatedCameraBodies.find((option) => option.id === draft.cameraBodyId)
                      ?? null,
                    1,
                    (next) =>
                      setDraft((previous) => ({
                        ...previous,
                        cameraBodyId: next.id,
                      })),
                  );
                }}
                onWheel={(event) =>
                  handleWheelStep(
                    event,
                    () => {
                      stepOption(
                        translatedCameraBodies,
                        translatedCameraBodies.find((option) => option.id === draft.cameraBodyId)
                          ?? null,
                        1,
                        (next) =>
                          setDraft((previous) => ({
                            ...previous,
                            cameraBodyId: next.id,
                          })),
                      );
                    },
                    () => {
                      stepOption(
                        translatedCameraBodies,
                        translatedCameraBodies.find((option) => option.id === draft.cameraBodyId)
                          ?? null,
                        -1,
                        (next) =>
                          setDraft((previous) => ({
                            ...previous,
                            cameraBodyId: next.id,
                          })),
                      );
                    },
                  )
                }
              />

              <div className="hidden h-[220px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.lens")}
                currentLabel={currentLensLabel}
                previousLabel={resolveRelativeLabel(
                  translatedLenses,
                  lensIndex,
                  -1,
                  (option) => option.label,
                )}
                nextLabel={resolveRelativeLabel(
                  translatedLenses,
                  lensIndex,
                  1,
                  (option) => option.label,
                )}
                onPrevious={() => {
                  stepOption(
                    translatedLenses,
                    translatedLenses.find((option) => option.id === draft.lensId) ?? null,
                    -1,
                    (next) => setLensId(next.id),
                  );
                }}
                onNext={() => {
                  stepOption(
                    translatedLenses,
                    translatedLenses.find((option) => option.id === draft.lensId) ?? null,
                    1,
                    (next) => setLensId(next.id),
                  );
                }}
                onWheel={(event) =>
                  handleWheelStep(
                    event,
                    () => {
                      stepOption(
                        translatedLenses,
                        translatedLenses.find((option) => option.id === draft.lensId) ?? null,
                        1,
                        (next) => setLensId(next.id),
                      );
                    },
                    () => {
                      stepOption(
                        translatedLenses,
                        translatedLenses.find((option) => option.id === draft.lensId) ?? null,
                        -1,
                        (next) => setLensId(next.id),
                      );
                    },
                  )
                }
              />

              <div className="hidden h-[220px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.focalLength")}
                currentLabel={currentFocalLengthLabel}
                currentSubLabel={draft.focalLengthMm ? "mm" : null}
                previousLabel={resolveRelativeLabel(
                  focalLengthOptions,
                  focalLengthIndex,
                  -1,
                  (option) => `${option}`,
                )}
                nextLabel={resolveRelativeLabel(
                  focalLengthOptions,
                  focalLengthIndex,
                  1,
                  (option) => `${option}`,
                )}
                emphasizeValue={Boolean(draft.focalLengthMm)}
                onPrevious={() => {
                  stepOption(
                    focalLengthOptions,
                    draft.focalLengthMm,
                    -1,
                    (next) =>
                      setDraft((previous) => ({
                        ...previous,
                        focalLengthMm: next,
                      })),
                  );
                }}
                onNext={() => {
                  stepOption(
                    focalLengthOptions,
                    draft.focalLengthMm,
                    1,
                    (next) =>
                      setDraft((previous) => ({
                        ...previous,
                        focalLengthMm: next,
                      })),
                  );
                }}
                onWheel={(event) =>
                  handleWheelStep(
                    event,
                    () => {
                      stepOption(
                        focalLengthOptions,
                        draft.focalLengthMm,
                        1,
                        (next) =>
                          setDraft((previous) => ({
                            ...previous,
                            focalLengthMm: next,
                          })),
                      );
                    },
                    () => {
                      stepOption(
                        focalLengthOptions,
                        draft.focalLengthMm,
                        -1,
                        (next) =>
                          setDraft((previous) => ({
                            ...previous,
                            focalLengthMm: next,
                          })),
                      );
                    },
                  )
                }
              />

              <div className="hidden h-[220px] w-px self-center bg-white/8 md:block" />
              <CameraWheelColumn
                label={t("cameraParams.fields.aperture")}
                currentLabel={currentApertureLabel}
                previousLabel={resolveRelativeLabel(
                  apertureOptions,
                  apertureIndex,
                  -1,
                  (option) => option,
                )}
                nextLabel={resolveRelativeLabel(
                  apertureOptions,
                  apertureIndex,
                  1,
                  (option) => option,
                )}
                emphasizeValue={Boolean(draft.aperture)}
                onPrevious={() => {
                  stepOption(
                    apertureOptions,
                    draft.aperture,
                    -1,
                    (next) =>
                      setDraft((previous) => ({
                        ...previous,
                        aperture: next,
                      })),
                  );
                }}
                onNext={() => {
                  stepOption(
                    apertureOptions,
                    draft.aperture,
                    1,
                    (next) =>
                      setDraft((previous) => ({
                        ...previous,
                        aperture: next,
                      })),
                  );
                }}
                onWheel={(event) =>
                  handleWheelStep(
                    event,
                    () => {
                      stepOption(
                        apertureOptions,
                        draft.aperture,
                        1,
                        (next) =>
                          setDraft((previous) => ({
                            ...previous,
                            aperture: next,
                          })),
                      );
                    },
                    () => {
                      stepOption(
                        apertureOptions,
                        draft.aperture,
                        -1,
                        (next) =>
                          setDraft((previous) => ({
                            ...previous,
                            aperture: next,
                          })),
                      );
                    },
                  )
                }
              />
            </div>
          </div>
        </UiModal>

        <UiModal
          isOpen={isHelpOpen}
          title={t("cameraHelp.title")}
          onClose={() => setIsHelpOpen(false)}
          widthClassName="w-[920px] max-w-[calc(100vw-32px)]"
        >
          <CameraHelpContent />
        </UiModal>
      </>
    );
  },
);

CameraParamsDialog.displayName = "CameraParamsDialog";
