import type { ModelPricingDefinition } from '@/features/canvas/pricing/types';

export type MediaModelType = 'image' | 'video' | 'audio';

export interface ModelProviderDefinition {
  id: string;
  name: string;
  label: string;
}

export interface AspectRatioOption {
  value: string;
  label: string;
}

export interface ResolutionOption {
  value: string;
  label: string;
}

export interface ImageModelRuntimeContext {
  extraParams?: Record<string, unknown>;
}

export type ExtraParamType = 'boolean' | 'enum' | 'number' | 'string';

export interface ExtraParamDefinition {
  key: string;
  label: string;
  labelKey?: string;
  type: ExtraParamType;
  visibleResolutions?: string[];
  description?: string;
  descriptionKey?: string;
  defaultValue?: boolean | number | string;
  options?: Array<{ value: string; label: string; labelKey?: string }>;
  min?: number;
  max?: number;
  step?: number;
}

export type ExtraParamValue = boolean | number | string;

export function isExtraParamValue(value: unknown): value is ExtraParamValue {
  return (
    typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  );
}

export interface ImageModelDefinition {
  id: string;
  mediaType: 'image';
  displayName: string;
  providerId: string;
  description: string;
  eta: string;
  expectedDurationMs?: number;
  defaultAspectRatio: string;
  defaultResolution: string;
  aspectRatios: AspectRatioOption[];
  resolutions: ResolutionOption[];
  resolveResolutions?: (context: ImageModelRuntimeContext) => ResolutionOption[];
  extraParamsSchema?: ExtraParamDefinition[];
  defaultExtraParams?: Record<string, unknown>;
  pricing?: ModelPricingDefinition;
  resolveRequest: (context: { referenceImageCount: number }) => {
    requestModel: string;
    modeLabel: string;
  };
}

export function resolveImageModelExtraParams(
  model: Pick<ImageModelDefinition, 'extraParamsSchema'>,
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, ExtraParamValue> {
  const allowedKeys = new Set((model.extraParamsSchema ?? []).map((definition) => definition.key));
  if (allowedKeys.size === 0) {
    return {};
  }

  const resolved: Record<string, ExtraParamValue> = {};
  sources.forEach((source) => {
    if (!source) {
      return;
    }

    Object.entries(source).forEach(([key, value]) => {
      if (!allowedKeys.has(key) || !isExtraParamValue(value)) {
        return;
      }

      resolved[key] = value;
    });
  });

  return resolved;
}
