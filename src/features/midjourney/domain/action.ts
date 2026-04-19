import type {
  MjActionButton,
  MjActionFamily,
  MjActionScope,
  MjModalKind,
} from '@/features/canvas/domain/canvasNodes';

export interface MidjourneyButtonSnapshot {
  customId?: unknown;
  label?: unknown;
  type?: unknown;
  style?: unknown;
  emoji?: unknown;
  groupIndex?: unknown;
  order?: unknown;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeActionFamilyToken(value: string): MjActionFamily {
  if (value.includes('upsample') || value.includes('upscale') || /^u[1-4]$/.test(value)) {
    return 'upscale';
  }
  if (
    value.includes('variation')
    || value.includes('vary')
    || /^v[1-4]$/.test(value)
  ) {
    return 'variation';
  }
  if (value.includes('reroll') || value.includes('re-roll') || value.includes('refresh')) {
    return 'reroll';
  }
  if (value.includes('zoom')) {
    return 'zoom';
  }
  if (value.includes('pan') || value.includes('outpaint')) {
    return 'pan';
  }
  return 'other';
}

function resolveActionFamily(customId: string, label: string): MjActionFamily {
  const loweredCustomId = customId.toLowerCase();
  const loweredLabel = label.toLowerCase();
  const familyFromCustomId = normalizeActionFamilyToken(loweredCustomId);
  if (familyFromCustomId !== 'other') {
    return familyFromCustomId;
  }
  return normalizeActionFamilyToken(loweredLabel);
}

function resolveImageIndex(customId: string, label: string): number | null {
  const compactLabel = label.trim().toUpperCase();
  const labelMatch = compactLabel.match(/^(?:U|V)([1-4])$/);
  if (labelMatch) {
    return Number.parseInt(labelMatch[1], 10) - 1;
  }

  const loweredCustomId = customId.toLowerCase();
  const keywordMatch = loweredCustomId.match(
    /(?:upsample|upscale|variation|vary)[^0-9]{0,8}([1-4])/
  );
  if (keywordMatch) {
    return Number.parseInt(keywordMatch[1], 10) - 1;
  }

  const standaloneMatch = loweredCustomId.match(/(?:^|[^0-9])([1-4])(?:[^0-9]|$)/);
  if (standaloneMatch && /(?:upsample|upscale|variation|vary|u\d|v\d)/.test(loweredCustomId)) {
    return Number.parseInt(standaloneMatch[1], 10) - 1;
  }

  return null;
}

export function resolveMidjourneyActionScope(
  customId: string,
  label: string
): MjActionScope {
  return resolveImageIndex(customId, label) !== null ? 'image' : 'batch';
}

export function buildMidjourneyActionKey(
  customId: string,
  label: string
): string {
  const normalizedCustomId = customId.trim().toLowerCase();
  if (normalizedCustomId) {
    return normalizedCustomId;
  }

  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

export function inferMidjourneyModalKind(
  button: Pick<MjActionButton, 'family' | 'customId' | 'label'>,
  requiresModal = false
): MjModalKind {
  const loweredCustomId = button.customId.trim().toLowerCase();
  const loweredLabel = button.label.trim().toLowerCase();

  if (loweredCustomId.includes('custom_zoom') || loweredLabel.includes('custom zoom')) {
    return 'customZoom';
  }

  if (
    loweredCustomId.includes('remix')
    || loweredLabel.includes('remix')
  ) {
    return 'remixPrompt';
  }

  if (
    requiresModal
    && (
      button.family === 'variation'
      || button.family === 'pan'
      || button.family === 'reroll'
    )
  ) {
    return 'remixPrompt';
  }

  return requiresModal ? 'unsupported' : 'none';
}

export function normalizeMidjourneyButtons(
  value: unknown
): MjActionButton[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): MjActionButton | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as MidjourneyButtonSnapshot;
      const customId = normalizeText(record.customId);
      if (!customId) {
        return null;
      }

      const label = normalizeText(record.label) || customId;
      const family = resolveActionFamily(customId, label);
      const imageIndex = resolveImageIndex(customId, label);
      const actionKey = buildMidjourneyActionKey(customId, label);
      const scope = imageIndex !== null ? 'image' : resolveMidjourneyActionScope(customId, label);

      return {
        customId,
        label,
        type: normalizeOptionalText(record.type),
        style: normalizeOptionalText(record.style),
        emoji: normalizeOptionalText(record.emoji),
        family,
        scope,
        imageIndex,
        actionKey,
        requiresModal: inferMidjourneyModalKind(
          {
            customId,
            label,
            family,
          },
          false
        ) !== 'none',
        modalKind: inferMidjourneyModalKind(
          {
            customId,
            label,
            family,
          },
          false
        ),
        groupIndex: Number.isFinite(record.groupIndex)
          ? Math.max(0, Math.round(Number(record.groupIndex)))
          : 0,
        order: Number.isFinite(record.order)
          ? Math.max(0, Math.round(Number(record.order)))
          : index,
      };
    })
    .filter((item): item is MjActionButton => Boolean(item))
    .sort((left, right) => {
      const groupDelta = left.groupIndex - right.groupIndex;
      if (groupDelta !== 0) {
        return groupDelta;
      }

      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) {
        return orderDelta;
      }

      return left.label.localeCompare(right.label);
    });
}

export function isSupportedMidjourneyActionButton(button: MjActionButton): boolean {
  return button.family !== 'other';
}
