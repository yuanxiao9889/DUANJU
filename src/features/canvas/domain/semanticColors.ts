export const CANVAS_SEMANTIC_COLORS = ['red', 'purple', 'yellow', 'green'] as const;

export type CanvasSemanticColor = (typeof CANVAS_SEMANTIC_COLORS)[number];

export interface CanvasColorLabelMap {
  red: string;
  purple: string;
  yellow: string;
  green: string;
}

export const MAX_CANVAS_COLOR_LABEL_LENGTH = 20;

export const DEFAULT_CANVAS_COLOR_LABELS: CanvasColorLabelMap = {
  red: '重要剧情',
  purple: '情绪高潮',
  yellow: '待补细节',
  green: '普通节点',
};

export const CANVAS_SEMANTIC_COLOR_VISUALS: Record<
  CanvasSemanticColor,
  {
    borderColor: string;
    glowShadow: string;
  }
> = {
  red: {
    borderColor: 'rgba(255, 118, 118, 0.98)',
    glowShadow:
      '0 0 10px rgba(255, 118, 118, 0.34), 0 0 22px rgba(255, 118, 118, 0.2), 0 10px 24px rgba(255, 118, 118, 0.16)',
  },
  purple: {
    borderColor: 'rgba(199, 134, 255, 0.98)',
    glowShadow:
      '0 0 9px rgba(199, 134, 255, 0.28), 0 0 18px rgba(199, 134, 255, 0.16), 0 8px 18px rgba(199, 134, 255, 0.12)',
  },
  yellow: {
    borderColor: 'rgba(255, 212, 56, 0.98)',
    glowShadow:
      '0 0 8px rgba(255, 212, 56, 0.24), 0 0 14px rgba(255, 212, 56, 0.12), 0 6px 14px rgba(255, 212, 56, 0.08)',
  },
  green: {
    borderColor: 'rgba(74, 222, 128, 0.98)',
    glowShadow:
      '0 0 7px rgba(74, 222, 128, 0.18), 0 0 12px rgba(74, 222, 128, 0.08), 0 5px 12px rgba(74, 222, 128, 0.06)',
  },
};

export function isCanvasSemanticColor(value: unknown): value is CanvasSemanticColor {
  return typeof value === 'string' && CANVAS_SEMANTIC_COLORS.includes(value as CanvasSemanticColor);
}

export function createDefaultCanvasColorLabelMap(): CanvasColorLabelMap {
  return { ...DEFAULT_CANVAS_COLOR_LABELS };
}

export function normalizeCanvasColorLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return Array.from(trimmed).slice(0, MAX_CANVAS_COLOR_LABEL_LENGTH).join('');
}

export function normalizeCanvasColorLabelMap(value: unknown): CanvasColorLabelMap {
  const record = value && typeof value === 'object'
    ? (value as Partial<Record<CanvasSemanticColor, unknown>>)
    : {};

  return {
    red: normalizeCanvasColorLabel(record.red, DEFAULT_CANVAS_COLOR_LABELS.red),
    purple: normalizeCanvasColorLabel(record.purple, DEFAULT_CANVAS_COLOR_LABELS.purple),
    yellow: normalizeCanvasColorLabel(record.yellow, DEFAULT_CANVAS_COLOR_LABELS.yellow),
    green: normalizeCanvasColorLabel(record.green, DEFAULT_CANVAS_COLOR_LABELS.green),
  };
}
