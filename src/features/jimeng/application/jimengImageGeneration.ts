import {
  generateJimengChromeImages,
  inspectJimengChromeOptions,
  type SubmitJimengPanelPayload,
} from '@/commands/jimengPanel';
import { prepareNodeImage } from '@/features/canvas/application/imageData';
import type {
  JimengGeneratedImageItem,
  JimengNodeControlOption,
  JimengNodeControlState,
} from '@/features/canvas/domain/canvasNodes';
import {
  buildJimengSubmissionPrompt,
  prepareJimengReferenceImages,
} from '@/features/jimeng/application/jimengSubmission';
import type {
  JimengInspectionControl,
  JimengInspectionOption,
  JimengInspectionReport,
  JimengKnownControlKey,
} from '@/features/jimeng/domain/jimengInspection';

const KNOWN_CONTROL_ORDER: JimengKnownControlKey[] = [
  'creationType',
  'model',
  'referenceMode',
  'aspectRatio',
  'durationSeconds',
];

function normalizeControlOption(option: JimengInspectionOption): JimengNodeControlOption | null {
  const text = option.text.trim();
  if (!text) {
    return null;
  }

  return {
    text,
    disabled: option.disabled === true,
    selected: option.selected === true,
    matchedValue: option.matchedValue ?? null,
    matchedKnownControlKey: option.matchedKnownControlKey ?? null,
  };
}

function resolveInitialOptionText(
  options: JimengNodeControlOption[],
  previousControl: JimengNodeControlState | null | undefined
): string {
  const previousOptionText = previousControl?.optionText?.trim() ?? '';
  if (previousOptionText && options.some((option) => option.text === previousOptionText)) {
    return previousOptionText;
  }

  const selectedOption = options.find((option) => option.selected && !option.disabled);
  if (selectedOption) {
    return selectedOption.text;
  }

  const firstEnabledOption = options.find((option) => !option.disabled);
  if (firstEnabledOption) {
    return firstEnabledOption.text;
  }

  return options[0]?.text ?? '';
}

function normalizeInspectionControl(
  control: JimengInspectionControl,
  previousControl: JimengNodeControlState | null | undefined,
  knownControlKey?: JimengKnownControlKey | null
): JimengNodeControlState | null {
  const triggerText = control.triggerText.trim();
  const options = (control.options ?? [])
    .map(normalizeControlOption)
    .filter((option): option is JimengNodeControlOption => option !== null);

  if (!triggerText || options.length === 0) {
    return null;
  }

  return {
    controlIndex: control.controlIndex,
    triggerText,
    matchedValue: control.matchedValue ?? null,
    matchedKnownControlKey: knownControlKey ?? control.matchedKnownControlKey ?? null,
    optionText: resolveInitialOptionText(options, previousControl),
    options,
  };
}

function buildPreviousControlLookup(controls: JimengNodeControlState[] | undefined) {
  const byKnownKey = new Map<string, JimengNodeControlState>();
  const byIndex = new Map<number, JimengNodeControlState>();

  for (const control of controls ?? []) {
    if (control.matchedKnownControlKey) {
      byKnownKey.set(control.matchedKnownControlKey, control);
    }
    if (typeof control.controlIndex === 'number') {
      byIndex.set(control.controlIndex, control);
    }
  }

  return {
    byKnownKey,
    byIndex,
  };
}

export function buildJimengControlStatesFromInspection(
  report: JimengInspectionReport,
  previousControls?: JimengNodeControlState[]
): JimengNodeControlState[] {
  const previousLookup = buildPreviousControlLookup(previousControls);
  const controls: JimengNodeControlState[] = [];

  for (const key of KNOWN_CONTROL_ORDER) {
    const inspectionControl = report.knownControls?.[key];
    if (!inspectionControl) {
      continue;
    }

    const normalized = normalizeInspectionControl(
      inspectionControl,
      previousLookup.byKnownKey.get(key),
      key
    );
    if (normalized) {
      controls.push(normalized);
    }
  }

  for (const toolbarControl of report.toolbar ?? []) {
    if (
      toolbarControl.matchedKnownControlKey
      || typeof toolbarControl.controlIndex !== 'number'
    ) {
      continue;
    }

    const normalized = normalizeInspectionControl(
      toolbarControl,
      previousLookup.byIndex.get(toolbarControl.controlIndex)
    );
    if (normalized) {
      controls.push(normalized);
    }
  }

  return controls;
}

export async function inspectJimengImageControls(
  previousControls?: JimengNodeControlState[]
): Promise<JimengNodeControlState[]> {
  const report = await inspectJimengChromeOptions<JimengInspectionReport>({
    creationType: 'image',
  });

  return buildJimengControlStatesFromInspection(report, previousControls);
}

function parseDurationControlValue(control: JimengNodeControlState): number | null {
  const matchedValue = control.matchedValue?.trim() ?? '';
  if (matchedValue) {
    const parsed = Number(matchedValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }

  const text = control.optionText.trim();
  const match = text.match(/(\d{1,2})/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function buildJimengImageSubmitPayload(
  prompt: string,
  controls: JimengNodeControlState[],
  referenceImages: Awaited<ReturnType<typeof prepareJimengReferenceImages>>
): SubmitJimengPanelPayload {
  const payload: SubmitJimengPanelPayload = {
    prompt,
    creationType: 'image',
    referenceImages,
    autoSubmit: true,
    skipToolbarAutomation: false,
  };

  const extraControls: NonNullable<SubmitJimengPanelPayload['extraControls']> = [];

  for (const control of controls) {
    const optionText = control.optionText.trim();
    if (!optionText) {
      continue;
    }

    const resolvedValue = control.matchedValue?.trim() || optionText;
    switch (control.matchedKnownControlKey) {
      case 'creationType':
        payload.creationType = resolvedValue;
        break;
      case 'model':
        payload.model = resolvedValue;
        break;
      case 'referenceMode':
        payload.referenceMode = resolvedValue;
        break;
      case 'aspectRatio':
        payload.aspectRatio = resolvedValue;
        break;
      case 'durationSeconds': {
        const parsedDuration = parseDurationControlValue(control);
        if (parsedDuration !== null) {
          payload.durationSeconds = parsedDuration;
        } else if (typeof control.controlIndex === 'number') {
          extraControls.push({
            controlIndex: control.controlIndex,
            triggerText: control.triggerText,
            optionText,
          });
        }
        break;
      }
      default:
        if (typeof control.controlIndex === 'number') {
          extraControls.push({
            controlIndex: control.controlIndex,
            triggerText: control.triggerText,
            optionText,
          });
        }
        break;
    }
  }

  if (extraControls.length > 0) {
    payload.extraControls = extraControls;
  }

  return payload;
}

export interface GenerateJimengImagePayload {
  prompt: string;
  controls?: JimengNodeControlState[];
  referenceImageSources?: string[];
}

export async function generateJimengImages(
  payload: GenerateJimengImagePayload
): Promise<JimengGeneratedImageItem[]> {
  const normalizedPrompt = buildJimengSubmissionPrompt(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error('Prompt is required for Jimeng image generation');
  }

  const referenceImages = await prepareJimengReferenceImages(payload.referenceImageSources);
  const submitPayload = buildJimengImageSubmitPayload(
    normalizedPrompt,
    payload.controls ?? [],
    referenceImages
  );

  const generatedImages = await generateJimengChromeImages(submitPayload);
  return await Promise.all(
    generatedImages.map(async (result, index) => {
      const prepared = await prepareNodeImage(result.sourceUrl);
      return {
        id: `jimeng-image-${Date.now()}-${index + 1}`,
        sourceUrl: result.sourceUrl,
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: prepared.aspectRatio,
        width: result.width ?? undefined,
        height: result.height ?? undefined,
        fileName: `jimeng-image-${index + 1}.png`,
      } satisfies JimengGeneratedImageItem;
    })
  );
}
