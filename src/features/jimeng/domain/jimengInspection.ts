import type { TFunction } from 'i18next';

import type { JimengExtraControlSelection } from '@/features/canvas/domain/canvasNodes';

import type { JimengOptionDefinition } from './jimengOptions';

export type JimengInspectionStatus = 'idle' | 'syncing' | 'ready' | 'error';

export type JimengKnownControlKey =
  | 'creationType'
  | 'model'
  | 'referenceMode'
  | 'aspectRatio'
  | 'durationSeconds';

export interface JimengInspectionOption {
  text: string;
  disabled: boolean;
  selected: boolean;
  matchedValue?: string | null;
  matchedKnownControlKey?: JimengKnownControlKey | null;
}

export interface JimengInspectionControl {
  controlIndex?: number;
  triggerText: string;
  matchedValue?: string | null;
  matchedKnownControlKey?: JimengKnownControlKey | null;
  options: JimengInspectionOption[];
}

export interface JimengInspectionReport {
  inspectedAt?: string;
  locationHref?: string;
  documentTitle?: string;
  toolbar?: JimengInspectionControl[];
  knownControls?: Partial<Record<JimengKnownControlKey, JimengInspectionControl>>;
}

export interface JimengResolvedOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
}

export interface JimengResolvedExtraControl {
  controlIndex: number;
  triggerText: string;
  value: string;
  options: JimengResolvedOption<string>[];
}

function buildStaticOptions<T extends string | number>(
  options: JimengOptionDefinition<T>[],
  t: TFunction
): JimengResolvedOption<T>[] {
  return options.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
    description: option.descriptionKey ? t(option.descriptionKey) : undefined,
  }));
}

function dedupeTextOptions(options: JimengInspectionOption[]): JimengResolvedOption<string>[] {
  const seen = new Set<string>();
  const resolvedOptions: JimengResolvedOption<string>[] = [];

  options.forEach((option) => {
    const value = option.text.trim();
    if (!value || seen.has(value)) {
      return;
    }

    resolvedOptions.push({
      value,
      label: value,
    });
    seen.add(value);
  });

  return resolvedOptions;
}

export function mergeJimengDetectedOptions<T extends string | number>(
  options: JimengOptionDefinition<T>[],
  t: TFunction,
  detectedControl?: JimengInspectionControl | null
): JimengResolvedOption<T>[] {
  const staticOptions = buildStaticOptions(options, t);
  if (!detectedControl?.options?.length) {
    return staticOptions;
  }

  const optionMap = new Map(staticOptions.map((option) => [String(option.value), option]));
  const mergedOptions: JimengResolvedOption<T>[] = [];
  const seen = new Set<string>();

  detectedControl.options.forEach((detectedOption) => {
    const matchedValue = detectedOption.matchedValue;
    if (!matchedValue) {
      return;
    }

    const baseOption = optionMap.get(String(matchedValue));
    if (!baseOption || seen.has(String(baseOption.value))) {
      return;
    }

    mergedOptions.push({
      ...baseOption,
      label: detectedOption.text || baseOption.label,
    });
    seen.add(String(baseOption.value));
  });

  return mergedOptions.length > 0 ? mergedOptions : staticOptions;
}

export function resolveJimengExtraToolbarControls(
  report: JimengInspectionReport | null | undefined,
  selections: JimengExtraControlSelection[] | undefined
): JimengResolvedExtraControl[] {
  const selectionMap = new Map(
    (selections ?? []).map((selection) => [selection.controlIndex, selection])
  );

  return (report?.toolbar ?? [])
    .filter((control): control is JimengInspectionControl & { controlIndex: number } =>
      typeof control.controlIndex === 'number'
    )
    .filter((control) => !control.matchedKnownControlKey)
    .map((control) => {
      const options = dedupeTextOptions(control.options);
      if (options.length === 0) {
        return null;
      }

      const savedSelection = selectionMap.get(control.controlIndex);
      const selectedFromReport = control.options.find((option) => option.selected)?.text?.trim();
      const fallbackValue = options[0]?.value ?? '';
      const value =
        savedSelection?.optionText?.trim()
        || selectedFromReport
        || fallbackValue;

      if (value && !options.some((option) => option.value === value)) {
        options.unshift({
          value,
          label: value,
        });
      }

      return {
        controlIndex: control.controlIndex,
        triggerText: control.triggerText,
        value,
        options,
      };
    })
    .filter((control): control is JimengResolvedExtraControl => Boolean(control));
}
