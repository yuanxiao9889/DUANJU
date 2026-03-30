import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_GRSAI_CREDIT_TIER_ID,
  PRICE_DISPLAY_CURRENCY_MODES,
  type GrsaiCreditTierId,
  type PriceDisplayCurrencyMode,
} from '@/features/canvas/pricing/types';
import {
  DEFAULT_GROUP_NODES_SHORTCUT,
  normalizeShortcut,
} from '@/features/settings/keyboardShortcuts';
import { DEFAULT_ALIBABA_TEXT_MODEL } from '@/features/canvas/models/providers/alibaba';
import { DEFAULT_CODING_MODEL } from '@/features/canvas/models/providers/coding';
import {
  type CustomScriptModelEntry,
  type CustomStoryboardModelEntry,
  DEFAULT_BLTCY_TEXT_MODEL,
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  normalizeScriptCompatibleProviderConfig,
  normalizeScriptModelOverrides,
  normalizeScriptProviderCustomModels,
  normalizeScriptProviderEnabledSelection,
  normalizeStoryboardModelOverrides,
  normalizeStoryboardCompatibleModelConfig,
  normalizeStoryboardProviderCustomModels,
  type ScriptCompatibleProviderConfig,
  type StoryboardCompatibleModelConfig,
} from '@/features/canvas/models';
import {
  AUTO_REQUEST_ASPECT_RATIO,
  IMAGE_SIZES,
  type ImageSize,
} from '@/features/canvas/domain/canvasNodes';

export type UiRadiusPreset = 'compact' | 'default' | 'large';
export type ThemeTonePreset = 'neutral' | 'warm' | 'cool';
export type CanvasEdgeRoutingMode = 'spline' | 'orthogonal' | 'smartOrthogonal';
export type ProviderApiKeys = Record<string, string>;
export const DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL = 'nano-banana-pro';

export interface StyleTemplate {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
}

interface SettingsState {
  isHydrated: boolean;
  scriptApiKeys: ProviderApiKeys;
  storyboardApiKeys: ProviderApiKeys;
  scriptProviderEnabled: string;
  scriptModelOverrides: Record<string, string>;
  scriptProviderCustomModels: Record<string, CustomScriptModelEntry[]>;
  scriptCompatibleProviderConfig: ScriptCompatibleProviderConfig;
  storyboardModelOverrides: Record<string, string>;
  storyboardProviderCustomModels: Record<string, CustomStoryboardModelEntry[]>;
  storyboardCompatibleModelConfig: StoryboardCompatibleModelConfig;
  lastImageEditModelId: string;
  lastImageEditSize: ImageSize;
  lastImageEditRequestAspectRatio: string;
  hrsaiNanoBananaProModel: string;
  alibabaTextModel: string;
  codingModel: string;
  hideProviderGuidePopover: boolean;
  downloadPresetPaths: string[];
  useUploadFilenameAsNodeTitle: boolean;
  storyboardGenKeepStyleConsistent: boolean;
  storyboardGenDisableTextInImage: boolean;
  storyboardGenAutoInferEmptyFrame: boolean;
  ignoreAtTagWhenCopyingAndGenerating: boolean;
  enableStoryboardGenGridPreviewShortcut: boolean;
  groupNodesShortcut: string;
  showStoryboardGenAdvancedRatioControls: boolean;
  showNodePrice: boolean;
  priceDisplayCurrencyMode: PriceDisplayCurrencyMode;
  usdToCnyRate: number;
  preferDiscountedPrice: boolean;
  grsaiCreditTierId: GrsaiCreditTierId;
  uiRadiusPreset: UiRadiusPreset;
  themeTonePreset: ThemeTonePreset;
  accentColor: string;
  canvasEdgeRoutingMode: CanvasEdgeRoutingMode;
  autoCheckAppUpdateOnLaunch: boolean;
  enableUpdateDialog: boolean;
  showMiniMap: boolean;
  showGrid: boolean;
  showAlignmentGuides: boolean;
  styleTemplates: StyleTemplate[];
  psIntegrationEnabled: boolean;
  psServerPort: number;
  psAutoStartServer: boolean;
  setIsHydrated: (isHydrated: boolean) => void;
  setScriptProviderApiKey: (providerId: string, key: string) => void;
  setStoryboardProviderApiKey: (providerId: string, key: string) => void;
  setScriptProviderEnabled: (providerId: string) => void;
  setScriptModelOverride: (providerId: string, model: string) => void;
  setScriptProviderCustomModels: (
    providerId: string,
    models: CustomScriptModelEntry[]
  ) => void;
  setScriptCompatibleProviderConfig: (
    config: Partial<ScriptCompatibleProviderConfig>
  ) => void;
  setStoryboardModelOverride: (providerId: string, model: string) => void;
  setStoryboardProviderCustomModels: (
    providerId: string,
    models: CustomStoryboardModelEntry[]
  ) => void;
  setStoryboardCompatibleModelConfig: (
    config: Partial<StoryboardCompatibleModelConfig>
  ) => void;
  setLastImageEditDefaults: (defaults: {
    modelId?: string;
    size?: ImageSize | string;
    requestAspectRatio?: string;
  }) => void;
  setGrsaiNanoBananaProModel: (model: string) => void;
  setAlibabaTextModel: (model: string) => void;
  setCodingModel: (model: string) => void;
  setHideProviderGuidePopover: (hide: boolean) => void;
  setDownloadPresetPaths: (paths: string[]) => void;
  setUseUploadFilenameAsNodeTitle: (enabled: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setEnableStoryboardGenGridPreviewShortcut: (enabled: boolean) => void;
  setGroupNodesShortcut: (shortcut: string) => void;
  setShowStoryboardGenAdvancedRatioControls: (enabled: boolean) => void;
  setShowNodePrice: (enabled: boolean) => void;
  setPriceDisplayCurrencyMode: (mode: PriceDisplayCurrencyMode) => void;
  setUsdToCnyRate: (rate: number) => void;
  setPreferDiscountedPrice: (enabled: boolean) => void;
  setGrsaiCreditTierId: (tierId: GrsaiCreditTierId) => void;
  setUiRadiusPreset: (preset: UiRadiusPreset) => void;
  setThemeTonePreset: (preset: ThemeTonePreset) => void;
  setAccentColor: (color: string) => void;
  setCanvasEdgeRoutingMode: (mode: CanvasEdgeRoutingMode) => void;
  setAutoCheckAppUpdateOnLaunch: (enabled: boolean) => void;
  setEnableUpdateDialog: (enabled: boolean) => void;
  setShowMiniMap: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowAlignmentGuides: (show: boolean) => void;
  addStyleTemplate: (template: Omit<StyleTemplate, 'id' | 'createdAt'>) => void;
  updateStyleTemplate: (id: string, updates: Partial<Pick<StyleTemplate, 'name' | 'prompt'>>) => void;
  deleteStyleTemplate: (id: string) => void;
  setPsIntegrationEnabled: (enabled: boolean) => void;
  setPsServerPort: (port: number) => void;
  setPsAutoStartServer: (enabled: boolean) => void;
}

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return '#3B82F6';
  }
  return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function normalizeApiKey(input: string): string {
  return input.trim();
}

function normalizePriceDisplayCurrencyMode(
  input: PriceDisplayCurrencyMode | string | null | undefined
): PriceDisplayCurrencyMode {
  return PRICE_DISPLAY_CURRENCY_MODES.includes(input as PriceDisplayCurrencyMode)
    ? (input as PriceDisplayCurrencyMode)
    : 'auto';
}

function normalizeUsdToCnyRate(input: number | string | null | undefined): number {
  const numeric = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 7.2;
  }

  return Math.min(100, Math.max(0.01, Math.round(numeric * 100) / 100));
}

function normalizeGrsaiCreditTierId(
  input: GrsaiCreditTierId | string | null | undefined
): GrsaiCreditTierId {
  switch (input) {
    case 'tier-10':
    case 'tier-20':
    case 'tier-49':
    case 'tier-99':
    case 'tier-499':
    case 'tier-999':
      return input;
    default:
      return DEFAULT_GRSAI_CREDIT_TIER_ID;
  }
}

function normalizeGrsaiNanoBananaProModel(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim().toLowerCase();
  if (trimmed === DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL || trimmed.startsWith('nano-banana-pro-')) {
    return trimmed;
  }
  return DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL;
}

function normalizeImageEditModelId(
  input: string | null | undefined,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): string {
  return getImageModel((input ?? '').trim(), compatibleConfig, customStoryboardModels).id;
}

function normalizeImageEditSize(input: ImageSize | string | null | undefined): ImageSize {
  return IMAGE_SIZES.includes(input as ImageSize) ? (input as ImageSize) : '2K';
}

function normalizeImageEditRequestAspectRatio(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim();
  return trimmed.length > 0 ? trimmed : AUTO_REQUEST_ASPECT_RATIO;
}

function normalizeCanvasEdgeRoutingMode(
  input: CanvasEdgeRoutingMode | string | null | undefined
): CanvasEdgeRoutingMode {
  if (input === 'orthogonal' || input === 'smartOrthogonal' || input === 'spline') {
    return input;
  }
  return 'spline';
}

function normalizeApiKeys(input: ProviderApiKeys | null | undefined): ProviderApiKeys {
  if (!input) {
    return {};
  }

  return Object.entries(input).reduce<ProviderApiKeys>((acc, [providerId, key]) => {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      return acc;
    }

    acc[normalizedProviderId] = normalizeApiKey(key);
    return acc;
  }, {});
}

export function hasConfiguredApiKey(apiKeys: ProviderApiKeys): boolean {
  return getConfiguredApiKeyCount(apiKeys) > 0;
}

export function getConfiguredApiKeyCount(
  apiKeys: ProviderApiKeys,
  providerIds?: readonly string[]
): number {
  const keysToCount = providerIds
    ? providerIds.map((providerId) => apiKeys[providerId] ?? '')
    : Object.values(apiKeys);

  return keysToCount.reduce((count, key) => {
    return normalizeApiKey(key).length > 0 ? count + 1 : count;
  }, 0);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      isHydrated: false,
      scriptApiKeys: {},
      storyboardApiKeys: {},
      scriptProviderEnabled: 'alibaba',
      scriptModelOverrides: {
        alibaba: DEFAULT_ALIBABA_TEXT_MODEL,
        coding: DEFAULT_CODING_MODEL,
        bltcy: DEFAULT_BLTCY_TEXT_MODEL,
      },
      scriptProviderCustomModels: {},
      scriptCompatibleProviderConfig: normalizeScriptCompatibleProviderConfig(undefined),
      storyboardModelOverrides: {},
      storyboardProviderCustomModels: {},
      storyboardCompatibleModelConfig: normalizeStoryboardCompatibleModelConfig(undefined),
      lastImageEditModelId: DEFAULT_IMAGE_MODEL_ID,
      lastImageEditSize: '2K',
      lastImageEditRequestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
      hrsaiNanoBananaProModel: DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL,
      alibabaTextModel: DEFAULT_ALIBABA_TEXT_MODEL,
      codingModel: DEFAULT_CODING_MODEL,
      hideProviderGuidePopover: false,
      downloadPresetPaths: [],
      useUploadFilenameAsNodeTitle: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: true,
      storyboardGenAutoInferEmptyFrame: true,
      ignoreAtTagWhenCopyingAndGenerating: true,
      enableStoryboardGenGridPreviewShortcut: false,
      groupNodesShortcut: DEFAULT_GROUP_NODES_SHORTCUT,
      showStoryboardGenAdvancedRatioControls: false,
      showNodePrice: true,
      priceDisplayCurrencyMode: 'auto',
      usdToCnyRate: 7.2,
      preferDiscountedPrice: false,
      grsaiCreditTierId: DEFAULT_GRSAI_CREDIT_TIER_ID,
      uiRadiusPreset: 'default',
      themeTonePreset: 'neutral',
      accentColor: '#3B82F6',
      canvasEdgeRoutingMode: 'spline',
      autoCheckAppUpdateOnLaunch: true,
      enableUpdateDialog: true,
      showMiniMap: true,
      showGrid: true,
      showAlignmentGuides: true,
      styleTemplates: [],
      psIntegrationEnabled: true,
      psServerPort: 9527,
      psAutoStartServer: true,
      setIsHydrated: (isHydrated) => set({ isHydrated }),
      setScriptProviderApiKey: (providerId, key) =>
        set((state) => ({
          scriptApiKeys: {
            ...state.scriptApiKeys,
            [providerId]: normalizeApiKey(key),
          },
        })),
      setStoryboardProviderApiKey: (providerId, key) =>
        set((state) => ({
          storyboardApiKeys: {
            ...state.storyboardApiKeys,
            [providerId]: normalizeApiKey(key),
          },
        })),
      setScriptProviderEnabled: (providerId) => set({ scriptProviderEnabled: providerId }),
      setScriptModelOverride: (providerId, model) =>
        set((state) => ({
          scriptModelOverrides: {
            ...state.scriptModelOverrides,
            [providerId]: model.trim(),
          },
          ...(providerId === 'alibaba' ? { alibabaTextModel: model.trim() } : {}),
          ...(providerId === 'coding' ? { codingModel: model.trim() } : {}),
        })),
      setScriptProviderCustomModels: (providerId, models) =>
        set((state) => ({
          scriptProviderCustomModels: {
            ...state.scriptProviderCustomModels,
            [providerId]:
              normalizeScriptProviderCustomModels({ [providerId]: models })[providerId] ?? [],
          },
        })),
      setScriptCompatibleProviderConfig: (config) =>
        set((state) => ({
          scriptCompatibleProviderConfig: normalizeScriptCompatibleProviderConfig({
            ...state.scriptCompatibleProviderConfig,
            ...config,
          }),
        })),
      setStoryboardModelOverride: (providerId, model) =>
        set((state) => ({
          storyboardModelOverrides: {
            ...state.storyboardModelOverrides,
            [providerId]: model.trim(),
          },
        })),
      setStoryboardProviderCustomModels: (providerId, models) =>
        set((state) => ({
          storyboardProviderCustomModels: {
            ...state.storyboardProviderCustomModels,
            [providerId]:
              normalizeStoryboardProviderCustomModels(
                { [providerId]: models },
                state.storyboardCompatibleModelConfig
              )[providerId] ?? [],
          },
        })),
      setStoryboardCompatibleModelConfig: (config) =>
        set((state) => ({
          storyboardCompatibleModelConfig:
            normalizeStoryboardCompatibleModelConfig({
              ...state.storyboardCompatibleModelConfig,
              ...config,
            }),
        })),
      setLastImageEditDefaults: ({ modelId, size, requestAspectRatio }) =>
        set((state) => ({
          lastImageEditModelId: normalizeImageEditModelId(
            modelId ?? state.lastImageEditModelId,
            state.storyboardCompatibleModelConfig,
            state.storyboardProviderCustomModels
          ),
          lastImageEditSize: normalizeImageEditSize(size ?? state.lastImageEditSize),
          lastImageEditRequestAspectRatio: normalizeImageEditRequestAspectRatio(
            requestAspectRatio ?? state.lastImageEditRequestAspectRatio
          ),
        })),
      setGrsaiNanoBananaProModel: (model) =>
        set({
          hrsaiNanoBananaProModel: normalizeGrsaiNanoBananaProModel(model),
        }),
      setAlibabaTextModel: (model) => set({ alibabaTextModel: model }),
      setCodingModel: (model) => set({ codingModel: model }),
      setHideProviderGuidePopover: (hide) => set({ hideProviderGuidePopover: hide }),
      setDownloadPresetPaths: (paths) => {
        const uniquePaths = Array.from(
          new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))
        ).slice(0, 8);
        set({ downloadPresetPaths: uniquePaths });
      },
      setUseUploadFilenameAsNodeTitle: (enabled) => set({ useUploadFilenameAsNodeTitle: enabled }),
      setStoryboardGenKeepStyleConsistent: (enabled) =>
        set({ storyboardGenKeepStyleConsistent: enabled }),
      setStoryboardGenDisableTextInImage: (enabled) =>
        set({ storyboardGenDisableTextInImage: enabled }),
      setStoryboardGenAutoInferEmptyFrame: (enabled) =>
        set({ storyboardGenAutoInferEmptyFrame: enabled }),
      setIgnoreAtTagWhenCopyingAndGenerating: (enabled) =>
        set({ ignoreAtTagWhenCopyingAndGenerating: enabled }),
      setEnableStoryboardGenGridPreviewShortcut: (enabled) =>
        set({ enableStoryboardGenGridPreviewShortcut: enabled }),
      setGroupNodesShortcut: (shortcut) =>
        set({ groupNodesShortcut: normalizeShortcut(shortcut) }),
      setShowStoryboardGenAdvancedRatioControls: (enabled) =>
        set({ showStoryboardGenAdvancedRatioControls: enabled }),
      setShowNodePrice: (enabled) => set({ showNodePrice: enabled }),
      setPriceDisplayCurrencyMode: (priceDisplayCurrencyMode) =>
        set({
          priceDisplayCurrencyMode:
            normalizePriceDisplayCurrencyMode(priceDisplayCurrencyMode),
        }),
      setUsdToCnyRate: (usdToCnyRate) =>
        set({ usdToCnyRate: normalizeUsdToCnyRate(usdToCnyRate) }),
      setPreferDiscountedPrice: (enabled) => set({ preferDiscountedPrice: enabled }),
      setGrsaiCreditTierId: (grsaiCreditTierId) =>
        set({ grsaiCreditTierId: normalizeGrsaiCreditTierId(grsaiCreditTierId) }),
      setUiRadiusPreset: (uiRadiusPreset) => set({ uiRadiusPreset }),
      setThemeTonePreset: (themeTonePreset) => set({ themeTonePreset }),
      setAccentColor: (color) => set({ accentColor: normalizeHexColor(color) }),
      setCanvasEdgeRoutingMode: (canvasEdgeRoutingMode) =>
        set({ canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(canvasEdgeRoutingMode) }),
      setAutoCheckAppUpdateOnLaunch: (enabled) => set({ autoCheckAppUpdateOnLaunch: enabled }),
      setEnableUpdateDialog: (enabled) => set({ enableUpdateDialog: enabled }),
      setShowMiniMap: (show) => set({ showMiniMap: show }),
      setShowGrid: (show) => set({ showGrid: show }),
      setShowAlignmentGuides: (show) => set({ showAlignmentGuides: show }),
      addStyleTemplate: (template) =>
        set((state) => ({
          styleTemplates: [
            ...state.styleTemplates,
            {
              ...template,
              id: crypto.randomUUID(),
              createdAt: Date.now(),
            },
          ],
        })),
      updateStyleTemplate: (id, updates) =>
        set((state) => ({
          styleTemplates: state.styleTemplates.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),
      deleteStyleTemplate: (id) =>
        set((state) => ({
          styleTemplates: state.styleTemplates.filter((t) => t.id !== id),
        })),
      setPsIntegrationEnabled: (enabled) => set({ psIntegrationEnabled: enabled }),
      setPsServerPort: (port) => set({ psServerPort: port }),
      setPsAutoStartServer: (enabled) => set({ psAutoStartServer: enabled }),
    }),
    {
      name: 'settings-storage',
      version: 22,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('failed to hydrate settings storage', error);
          }
          state?.setIsHydrated(true);
        };
      },
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as {
          apiKey?: string;
          apiKeys?: ProviderApiKeys;
          scriptApiKeys?: ProviderApiKeys;
          storyboardApiKeys?: ProviderApiKeys;
          scriptProviderEnabled?: string;
          scriptModelOverrides?: Record<string, string>;
          scriptProviderCustomModels?: Record<string, CustomScriptModelEntry[]>;
          scriptCompatibleProviderConfig?: Partial<ScriptCompatibleProviderConfig>;
          storyboardProviderEnabled?: string;
          storyboardModelOverrides?: Record<string, string>;
          storyboardProviderCustomModels?: Record<string, CustomStoryboardModelEntry[]>;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          grsaiNanoBananaProModel?: string;
          hideProviderGuidePopover?: boolean;
          lastImageEditModelId?: string;
          lastImageEditSize?: ImageSize | string;
          lastImageEditRequestAspectRatio?: string;
          alibabaTextModel?: string;
          codingModel?: string;
          canvasEdgeRoutingMode?: CanvasEdgeRoutingMode | string;
          autoCheckAppUpdateOnLaunch?: boolean;
          enableUpdateDialog?: boolean;
          storyboardCompatibleModelConfig?: Partial<StoryboardCompatibleModelConfig>;
          enableStoryboardGenGridPreviewShortcut?: boolean;
          groupNodesShortcut?: string;
          showStoryboardGenAdvancedRatioControls?: boolean;
          storyboardGenAutoInferEmptyFrame?: boolean;
          showNodePrice?: boolean;
          priceDisplayCurrencyMode?: PriceDisplayCurrencyMode | string;
          usdToCnyRate?: number | string;
          preferDiscountedPrice?: boolean;
          grsaiCreditTierId?: GrsaiCreditTierId | string;
          showMiniMap?: boolean;
          showGrid?: boolean;
          showAlignmentGuides?: boolean;
        };

        const migratedLegacyApiKeys = normalizeApiKeys(state.apiKeys);
        const migratedScriptApiKeys = normalizeApiKeys(state.scriptApiKeys);
        const migratedStoryboardApiKeys = normalizeApiKeys(state.storyboardApiKeys);
        const fallbackApiKeys =
          Object.keys(migratedLegacyApiKeys).length > 0
            ? migratedLegacyApiKeys
            : state.apiKey
              ? { ppio: normalizeApiKey(state.apiKey) }
              : {};
        const resolvedScriptApiKeys =
          Object.keys(migratedScriptApiKeys).length > 0
            ? migratedScriptApiKeys
            : fallbackApiKeys;
        const resolvedStoryboardApiKeys =
          Object.keys(migratedStoryboardApiKeys).length > 0
            ? migratedStoryboardApiKeys
            : fallbackApiKeys;
        const normalizedScriptProviderEnabled = normalizeScriptProviderEnabledSelection(
          state.scriptProviderEnabled,
          resolvedScriptApiKeys
        );
        const ignoreAtTagWhenCopyingAndGenerating =
          state.ignoreAtTagWhenCopyingAndGenerating ?? true;
        const normalizedStoryboardCompatibleModelConfig =
          normalizeStoryboardCompatibleModelConfig(state.storyboardCompatibleModelConfig);
        const normalizedStoryboardProviderCustomModels = normalizeStoryboardProviderCustomModels(
          state.storyboardProviderCustomModels,
          normalizedStoryboardCompatibleModelConfig
        );
        const normalizedStoryboardModelOverrides = normalizeStoryboardModelOverrides(
          state.storyboardModelOverrides,
          normalizedStoryboardProviderCustomModels,
          normalizedStoryboardCompatibleModelConfig
        );
        const normalizedScriptProviderCustomModels = normalizeScriptProviderCustomModels(
          state.scriptProviderCustomModels
        );
        const normalizedScriptCompatibleProviderConfig = normalizeScriptCompatibleProviderConfig(
          state.scriptCompatibleProviderConfig
        );
        const normalizedScriptModelOverrides = normalizeScriptModelOverrides(
          state.scriptModelOverrides,
          normalizedScriptProviderCustomModels,
          {
            alibaba: state.alibabaTextModel,
            coding: state.codingModel,
            bltcy: DEFAULT_BLTCY_TEXT_MODEL,
          }
        );

        return {
          ...(persistedState as object),
          isHydrated: true,
          scriptApiKeys: resolvedScriptApiKeys,
          storyboardApiKeys: resolvedStoryboardApiKeys,
          scriptProviderEnabled: normalizedScriptProviderEnabled,
          scriptModelOverrides: normalizedScriptModelOverrides,
          scriptProviderCustomModels: normalizedScriptProviderCustomModels,
          scriptCompatibleProviderConfig: normalizedScriptCompatibleProviderConfig,
          storyboardModelOverrides: normalizedStoryboardModelOverrides,
          storyboardProviderCustomModels: normalizedStoryboardProviderCustomModels,
          storyboardCompatibleModelConfig: normalizedStoryboardCompatibleModelConfig,
          lastImageEditModelId: normalizeImageEditModelId(
            state.lastImageEditModelId,
            normalizedStoryboardCompatibleModelConfig,
            normalizedStoryboardProviderCustomModels
          ),
          lastImageEditSize: normalizeImageEditSize(state.lastImageEditSize),
          lastImageEditRequestAspectRatio: normalizeImageEditRequestAspectRatio(
            state.lastImageEditRequestAspectRatio
          ),
          ignoreAtTagWhenCopyingAndGenerating,
          grsaiNanoBananaProModel: normalizeGrsaiNanoBananaProModel(
            state.grsaiNanoBananaProModel
          ),
          alibabaTextModel:
            normalizedScriptModelOverrides.alibaba || DEFAULT_ALIBABA_TEXT_MODEL,
          codingModel:
            normalizedScriptModelOverrides.coding || DEFAULT_CODING_MODEL,
          hideProviderGuidePopover: state.hideProviderGuidePopover ?? false,
          canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(state.canvasEdgeRoutingMode),
          autoCheckAppUpdateOnLaunch: state.autoCheckAppUpdateOnLaunch ?? true,
          enableUpdateDialog: state.enableUpdateDialog ?? true,
          enableStoryboardGenGridPreviewShortcut:
            state.enableStoryboardGenGridPreviewShortcut ?? false,
          groupNodesShortcut: normalizeShortcut(state.groupNodesShortcut),
          showStoryboardGenAdvancedRatioControls:
            state.showStoryboardGenAdvancedRatioControls ?? false,
          storyboardGenAutoInferEmptyFrame: state.storyboardGenAutoInferEmptyFrame ?? true,
          showNodePrice: state.showNodePrice ?? true,
          priceDisplayCurrencyMode: normalizePriceDisplayCurrencyMode(
            state.priceDisplayCurrencyMode
          ),
          usdToCnyRate: normalizeUsdToCnyRate(state.usdToCnyRate),
          preferDiscountedPrice: state.preferDiscountedPrice ?? false,
          grsaiCreditTierId: normalizeGrsaiCreditTierId(state.grsaiCreditTierId),
          showMiniMap: state.showMiniMap ?? true,
          showGrid: state.showGrid ?? true,
          showAlignmentGuides: state.showAlignmentGuides ?? true,
          styleTemplates: [],
          psIntegrationEnabled: true,
          psServerPort: 9527,
          psAutoStartServer: true,
        };
      },
    }
  )
);
