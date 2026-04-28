import { Trans, useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

import { UiInput, UiSelect } from '@/components/ui';
import {
  STORYBOARD_COMPATIBLE_API_FORMATS,
  STORYBOARD_NEWAPI_API_FORMATS,
  type CustomScriptModelEntry,
  type CustomStoryboardModelEntry,
  type ModelProviderDefinition,
  type ScriptCompatibleProviderConfig,
  type StoryboardCompatibleApiFormat,
  type StoryboardCompatibleModelConfig,
  type StoryboardNewApiApiFormat,
  type StoryboardNewApiModelConfig,
} from '@/features/canvas/models';
import { GRSAI_NANO_BANANA_PRO_MODEL_OPTIONS } from '@/features/canvas/models/providers/grsai';

interface ProviderModelOption {
  modelId: string;
  label: string;
  source: 'builtin' | 'custom';
  customModelId?: string;
}

interface ProviderModelSettingsSectionProps {
  provider: ModelProviderDefinition;
  isScriptTab: boolean;
  isScriptCompatibleProvider: boolean;
  isStoryboardCustomizableProvider: boolean;
  resolvedScriptModel: string;
  scriptModelOptions: ProviderModelOption[];
  customScriptModels: CustomScriptModelEntry[];
  customScriptModelIdInput: string;
  customScriptModelDisplayNameInput: string;
  onSelectScriptModel: (modelId: string) => void;
  onScriptModelIdInputChange: (value: string) => void;
  onScriptModelDisplayNameInputChange: (value: string) => void;
  onAddCustomScriptModel: () => void;
  onRemoveCustomScriptModel: (model: CustomScriptModelEntry) => void;
  scriptCompatibleProviderConfig: ScriptCompatibleProviderConfig;
  onScriptCompatibleEndpointUrlChange: (value: string) => void;
  storyboardModelOptions: ProviderModelOption[];
  customStoryboardModels: CustomStoryboardModelEntry[];
  customStoryboardModelIdInput: string;
  customStoryboardModelDisplayNameInput: string;
  onStoryboardModelIdInputChange: (value: string) => void;
  onStoryboardModelDisplayNameInputChange: (value: string) => void;
  onAddCustomStoryboardModel: () => void;
  onRemoveCustomStoryboardModel: (model: CustomStoryboardModelEntry) => void;
  storyboardCompatibleModelConfig: StoryboardCompatibleModelConfig;
  onStoryboardCompatibleFormatChange: (format: StoryboardCompatibleApiFormat) => void;
  onStoryboardCompatibleEndpointUrlChange: (value: string) => void;
  storyboardNewApiModelConfig: StoryboardNewApiModelConfig;
  onStoryboardNewApiFormatChange: (format: StoryboardNewApiApiFormat) => void;
  onStoryboardNewApiEndpointUrlChange: (value: string) => void;
  grsaiNanoBananaProModel: string;
  onGrsaiNanoBananaProModelChange: (value: string) => void;
}

const STORYBOARD_COMPATIBLE_FORMAT_LABEL_KEYS: Record<StoryboardCompatibleApiFormat, string> = {
  'openai-generations': 'settings.storyboardCompatibleFormatOpenaiGenerations',
  'openai-chat': 'settings.storyboardCompatibleFormatOpenaiChat',
  'openai-edits': 'settings.storyboardCompatibleFormatOpenaiEdits',
  'gemini-generate-content': 'settings.storyboardCompatibleFormatGeminiGenerateContent',
};

const STORYBOARD_NEWAPI_FORMAT_LABEL_KEYS: Record<StoryboardNewApiApiFormat, string> = {
  openai: 'settings.storyboardNewApiFormatOpenai',
  'openai-images': 'settings.storyboardNewApiFormatOpenaiImages',
  gemini: 'settings.storyboardNewApiFormatGemini',
};

function resolveCompatibleEndpointPlaceholder(apiFormat: StoryboardCompatibleApiFormat): string {
  if (apiFormat === 'gemini-generate-content') {
    return 'https://generativelanguage.googleapis.com';
  }

  if (apiFormat === 'openai-edits') {
    return 'https://your-api-host/v1/images/edits';
  }

  if (apiFormat === 'openai-chat') {
    return 'https://your-api-host/v1/chat/completions';
  }

  return 'https://your-api-host/v1/images/generations';
}

function resolveStoryboardCustomModelIdPlaceholder(providerId: string, fallback: string): string {
  if (providerId === 'compatible') {
    return 'gpt-image-1 / gemini-2.5-flash-image-preview';
  }

  if (providerId === 'newapi') {
    return 'gemini-3.1-flash-image / gemini-3.0-pro-image';
  }

  if (providerId === 'api2ok') {
    return 'gemini-3-pro-image-preview / gemini-3.1-flash-image';
  }

  if (providerId === 'oopii') {
    return 'gpt-image-2 / gemini-3-pro-image-preview';
  }

  return fallback;
}

function resolveStoryboardNewApiEndpointPlaceholder(apiFormat: StoryboardNewApiApiFormat): string {
  return apiFormat === 'gemini'
    ? 'https://your-newapi-host'
    : 'https://your-newapi-host/v1';
}

function resolveStoryboardNewApiHintKey(apiFormat: StoryboardNewApiApiFormat): string {
  if (apiFormat === 'openai-images') {
    return 'settings.storyboardNewApiHintOpenaiImages';
  }

  if (apiFormat === 'gemini') {
    return 'settings.storyboardNewApiHintGemini';
  }

  return 'settings.storyboardNewApiHintOpenai';
}

export function ProviderModelSettingsSection({
  provider,
  isScriptTab,
  isScriptCompatibleProvider,
  isStoryboardCustomizableProvider,
  resolvedScriptModel,
  scriptModelOptions,
  customScriptModels,
  customScriptModelIdInput,
  customScriptModelDisplayNameInput,
  onSelectScriptModel,
  onScriptModelIdInputChange,
  onScriptModelDisplayNameInputChange,
  onAddCustomScriptModel,
  onRemoveCustomScriptModel,
  scriptCompatibleProviderConfig,
  onScriptCompatibleEndpointUrlChange,
  storyboardModelOptions,
  customStoryboardModels,
  customStoryboardModelIdInput,
  customStoryboardModelDisplayNameInput,
  onStoryboardModelIdInputChange,
  onStoryboardModelDisplayNameInputChange,
  onAddCustomStoryboardModel,
  onRemoveCustomStoryboardModel,
  storyboardCompatibleModelConfig,
  onStoryboardCompatibleFormatChange,
  onStoryboardCompatibleEndpointUrlChange,
  storyboardNewApiModelConfig,
  onStoryboardNewApiFormatChange,
  onStoryboardNewApiEndpointUrlChange,
  grsaiNanoBananaProModel,
  onGrsaiNanoBananaProModelChange,
}: ProviderModelSettingsSectionProps) {
  const { t } = useTranslation();
  const customScriptModelMap = new Map(customScriptModels.map((model) => [model.id, model]));
  const customStoryboardModelMap = new Map(customStoryboardModels.map((model) => [model.id, model]));
  const scriptModelSelectionDescKey =
    provider.id === 'oopii'
      ? 'settings.scriptOopiiModelSelectionDesc'
      : 'settings.scriptModelSelectionDesc';
  const storyboardModelSelectionDescKey =
    provider.id === 'compatible'
      ? 'settings.storyboardCompatibleModelSelectionDesc'
      : provider.id === 'oopii'
        ? 'settings.storyboardOopiiModelSelectionDesc'
        : 'settings.storyboardModelSelectionDesc';

  return (
    <>
      {isScriptTab && (
        <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
          <div className="mb-1 text-xs font-medium text-text-dark">
            {t('settings.scriptModelSelection')}
          </div>
          <p className="mb-3 text-xs leading-5 text-text-muted">
            {t(scriptModelSelectionDescKey)}
          </p>
          <div className="space-y-3">
            <UiSelect
              value={resolvedScriptModel}
              onChange={(event) => {
                onSelectScriptModel(event.target.value);
              }}
              className="h-9 text-sm"
              disabled={scriptModelOptions.length === 0}
            >
              {scriptModelOptions.length > 0 ? (
                scriptModelOptions.map((option) => (
                  <option key={option.modelId} value={option.modelId}>
                    {option.label}
                  </option>
                ))
              ) : (
                <option value="">-</option>
              )}
            </UiSelect>

            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] font-medium text-text-muted">
                  {t('settings.scriptCustomModelIdLabel')}
                </div>
                <UiInput
                  value={customScriptModelIdInput}
                  onChange={(event) => onScriptModelIdInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onAddCustomScriptModel();
                    }
                  }}
                  placeholder={t('settings.scriptCustomModelIdPlaceholder')}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-text-muted">
                  {t('settings.scriptCustomModelDisplayNameLabel')}
                </div>
                <UiInput
                  value={customScriptModelDisplayNameInput}
                  onChange={(event) => onScriptModelDisplayNameInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onAddCustomScriptModel();
                    }
                  }}
                  placeholder={t('settings.scriptCustomModelDisplayNamePlaceholder')}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <button
                type="button"
                onClick={onAddCustomScriptModel}
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('settings.scriptCustomModelAdd')}
              </button>
            </div>

            {scriptModelOptions.length > 0 ? (
              <div className="space-y-2">
                {scriptModelOptions.map((option) => {
                  const customModel = option.customModelId
                    ? customScriptModelMap.get(option.customModelId)
                    : undefined;

                  return (
                    <div
                      key={option.customModelId ?? `builtin:${option.modelId}`}
                      className="flex items-center gap-3 rounded-md border border-border-dark bg-surface-dark px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text-dark">{option.label}</div>
                        <div className="truncate text-[11px] text-text-muted">{option.modelId}</div>
                      </div>
                      {customModel ? (
                        <button
                          type="button"
                          onClick={() => onRemoveCustomScriptModel(customModel)}
                          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                          title={t('settings.scriptCustomModelDelete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border-dark px-3 py-2 text-[11px] leading-5 text-text-muted">
                {t('settings.scriptCustomModelEmpty')}
              </div>
            )}
          </div>
        </div>
      )}

      {isScriptTab && isScriptCompatibleProvider && (
        <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
          <div className="mb-1 text-xs font-medium text-text-dark">
            {t('settings.scriptCompatibleTitle')}
          </div>
          <p className="mb-3 text-xs leading-5 text-text-muted">
            {t('settings.scriptCompatibleDesc')}
          </p>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-text-dark">
                {t('settings.scriptCompatibleEndpointUrl')}
              </div>
              <UiInput
                value={scriptCompatibleProviderConfig.endpointUrl}
                onChange={(event) => onScriptCompatibleEndpointUrlChange(event.target.value)}
                placeholder="https://your-api-host/v1/chat/completions"
                className="h-9 text-sm"
              />
            </div>
            <div className="rounded-md border border-border-dark bg-black/10 px-3 py-2 text-[11px] leading-5 text-text-muted">
              {t('settings.scriptCompatibleHint')}
            </div>
          </div>
        </div>
      )}

      {!isScriptTab && isStoryboardCustomizableProvider && (
        <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
          <div className="mb-1 text-xs font-medium text-text-dark">
            {t('settings.storyboardModelSelection')}
          </div>
          <p className="mb-3 text-xs leading-5 text-text-muted">
            {t(storyboardModelSelectionDescKey)}
          </p>
          <div className="space-y-3">
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] font-medium text-text-muted">
                  {t('settings.scriptCustomModelIdLabel')}
                </div>
                <UiInput
                  value={customStoryboardModelIdInput}
                  onChange={(event) => onStoryboardModelIdInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onAddCustomStoryboardModel();
                    }
                  }}
                  placeholder={resolveStoryboardCustomModelIdPlaceholder(
                    provider.id,
                    t('settings.storyboardCustomModelIdPlaceholder')
                  )}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-text-muted">
                  {t('settings.scriptCustomModelDisplayNameLabel')}
                </div>
                <UiInput
                  value={customStoryboardModelDisplayNameInput}
                  onChange={(event) => onStoryboardModelDisplayNameInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onAddCustomStoryboardModel();
                    }
                  }}
                  placeholder={t('settings.storyboardCustomModelDisplayNamePlaceholder')}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <button
                type="button"
                onClick={onAddCustomStoryboardModel}
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('settings.scriptCustomModelAdd')}
              </button>
            </div>

            {storyboardModelOptions.length > 0 ? (
              <div className="space-y-2">
                {storyboardModelOptions.map((option) => {
                  const customModel = option.customModelId
                    ? customStoryboardModelMap.get(option.customModelId)
                    : undefined;

                  return (
                    <div
                      key={option.customModelId ?? `builtin:${option.modelId}`}
                      className="flex items-center gap-3 rounded-md border border-border-dark bg-surface-dark px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text-dark">{option.label}</div>
                        <div className="truncate text-[11px] text-text-muted">{option.modelId}</div>
                      </div>
                      {customModel ? (
                        <button
                          type="button"
                          onClick={() => onRemoveCustomStoryboardModel(customModel)}
                          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                          title={t('settings.scriptCustomModelDelete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border-dark px-3 py-2 text-[11px] leading-5 text-text-muted">
                {t('settings.storyboardCustomModelEmpty')}
              </div>
            )}
          </div>
        </div>
      )}

      {!isScriptTab && provider.id === 'compatible' && (
        <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
          <div className="mb-1 text-xs font-medium text-text-dark">
            {t('settings.storyboardCompatibleTitle')}
          </div>
          <p className="mb-3 text-xs leading-5 text-text-muted">
            {t('settings.storyboardCompatibleDesc')}
          </p>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-text-dark">
                {t('settings.storyboardCompatibleFormat')}
              </div>
              <UiSelect
                value={storyboardCompatibleModelConfig.apiFormat}
                onChange={(event) =>
                  onStoryboardCompatibleFormatChange(
                    event.target.value as StoryboardCompatibleApiFormat
                  )
                }
                className="h-9 text-sm"
              >
                {STORYBOARD_COMPATIBLE_API_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {t(STORYBOARD_COMPATIBLE_FORMAT_LABEL_KEYS[format])}
                  </option>
                ))}
              </UiSelect>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-text-dark">
                {t('settings.storyboardCompatibleEndpointUrl')}
              </div>
              <UiInput
                value={storyboardCompatibleModelConfig.endpointUrl}
                onChange={(event) => onStoryboardCompatibleEndpointUrlChange(event.target.value)}
                placeholder={resolveCompatibleEndpointPlaceholder(
                  storyboardCompatibleModelConfig.apiFormat
                )}
                className="h-9 text-sm"
              />
            </div>
            <div className="rounded-md border border-border-dark bg-black/10 px-3 py-2 text-[11px] leading-5 text-text-muted">
              {t('settings.storyboardCompatibleHint')}
            </div>
          </div>
        </div>
      )}

      {!isScriptTab && provider.id === 'newapi' && (
        <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
          <div className="mb-1 text-xs font-medium text-text-dark">
            {t('settings.storyboardNewApiTitle')}
          </div>
          <p className="mb-3 text-xs leading-5 text-text-muted">
            {t('settings.storyboardNewApiDesc')}
          </p>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-text-dark">
                {t('settings.storyboardNewApiFormat')}
              </div>
              <UiSelect
                value={storyboardNewApiModelConfig.apiFormat}
                onChange={(event) =>
                  onStoryboardNewApiFormatChange(event.target.value as StoryboardNewApiApiFormat)
                }
                className="h-9 text-sm"
              >
                {STORYBOARD_NEWAPI_API_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {t(STORYBOARD_NEWAPI_FORMAT_LABEL_KEYS[format])}
                  </option>
                ))}
              </UiSelect>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-text-dark">
                {t('settings.storyboardNewApiEndpointUrl')}
              </div>
              <UiInput
                value={storyboardNewApiModelConfig.endpointUrl}
                onChange={(event) => onStoryboardNewApiEndpointUrlChange(event.target.value)}
                placeholder={resolveStoryboardNewApiEndpointPlaceholder(
                  storyboardNewApiModelConfig.apiFormat
                )}
                className="h-9 text-sm"
              />
            </div>
            <div className="rounded-md border border-border-dark bg-black/10 px-3 py-2 text-[11px] leading-5 text-text-muted">
              {t(resolveStoryboardNewApiHintKey(storyboardNewApiModelConfig.apiFormat))}
            </div>
          </div>
        </div>
      )}

      {!isScriptTab && provider.id === 'grsai' && (
        <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
          <div className="mb-1 text-xs font-medium text-text-dark">
            {t('settings.nanoBananaProModel')}
          </div>
          <p className="mb-2 text-xs text-text-muted">
            <Trans
              i18nKey="settings.nanoBananaProModelDesc"
              components={{
                modelListLink: (
                  <a
                    href="https://grsai.com/zh/dashboard/models"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  />
                ),
              }}
            />
          </p>
          <UiSelect
            value={grsaiNanoBananaProModel}
            onChange={(event) => onGrsaiNanoBananaProModelChange(event.target.value)}
            className="h-9 text-sm"
          >
            {GRSAI_NANO_BANANA_PRO_MODEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </UiSelect>
        </div>
      )}
    </>
  );
}
