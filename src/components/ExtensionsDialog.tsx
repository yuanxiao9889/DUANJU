import { useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  Loader2,
  PackageOpen,
  PlugZap,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';
import { useExtensionsStore } from '@/stores/extensionsStore';

interface ExtensionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function normalizeDialogDirectoryPath(value: string | string[] | null): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    const [firstValue] = value;
    return typeof firstValue === 'string' && firstValue.trim().length > 0
      ? firstValue
      : null;
  }

  return null;
}

const NODE_FEATURE_LABEL_KEYS: Record<string, string> = {
  panoramaNode: 'node.menu.panorama',
  panoramaResultNode: 'node.menu.panoramaResult',
  ttsTextNode: 'node.menu.textAnnotation',
  ttsVoiceDesignNode: 'node.menu.ttsVoiceDesign',
  ttsSavedVoiceNode: 'node.menu.ttsSavedVoice',
  voxCpmVoiceDesignNode: 'node.menu.voxCpmVoiceDesign',
  voxCpmVoiceCloneNode: 'node.menu.voxCpmVoiceClone',
  voxCpmUltimateCloneNode: 'node.menu.voxCpmUltimateClone',
};

const MODEL_ROLE_LABEL_KEYS: Record<string, string> = {
  voiceDesign: 'extensions.modelRoles.voiceDesign',
  voiceClone: 'extensions.modelRoles.voiceClone',
  customVoice: 'extensions.modelRoles.customVoice',
  tokenizer: 'extensions.modelRoles.tokenizer',
  unknown: 'extensions.modelRoles.unknown',
};

export function ExtensionsDialog({ isOpen, onClose }: ExtensionsDialogProps) {
  const { t } = useTranslation();
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);
  const loadExtensionPackage = useExtensionsStore((state) => state.loadExtensionPackage);
  const enableExtension = useExtensionsStore((state) => state.enableExtension);
  const disableExtension = useExtensionsStore((state) => state.disableExtension);
  const removeExtensionPackage = useExtensionsStore((state) => state.removeExtensionPackage);
  const [isLoadingPackage, setIsLoadingPackage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsedPackageIds, setCollapsedPackageIds] = useState<Record<string, boolean>>({});
  const lastOpenedFolderSignatureRef = useRef<string | null>(null);

  const sortedPackages = useMemo(
    () =>
      Object.values(extensionPackages).sort(
        (left, right) => right.loadedAt - left.loadedAt
      ),
    [extensionPackages]
  );
  const packageFolderPaths = useMemo(
    () => Object.values(extensionPackages).map((extensionPackage) => extensionPackage.folderPath).sort(),
    [extensionPackages]
  );
  const packageFolderSignature = useMemo(
    () => packageFolderPaths.join('\n'),
    [packageFolderPaths]
  );
  const summary = useMemo(() => ({
    loadedPackageCount: sortedPackages.length,
    enabledPackageCount: sortedPackages.filter(
      (extensionPackage) => (
        enabledExtensionIds.includes(extensionPackage.id)
        && runtimeById[extensionPackage.id]?.status === 'ready'
      )
    ).length,
    modelAssetCount: sortedPackages.reduce(
      (count, extensionPackage) => count + (extensionPackage.models?.length ?? 0),
      0
    ),
  }), [enabledExtensionIds, runtimeById, sortedPackages]);

  useEffect(() => {
    setCollapsedPackageIds((previous) => {
      let hasChanged = false;
      const nextState = { ...previous };

      sortedPackages.forEach((extensionPackage) => {
        if (nextState[extensionPackage.id] !== undefined) {
          return;
        }

        nextState[extensionPackage.id] = true;
        hasChanged = true;
      });

      Object.keys(nextState).forEach((extensionId) => {
        if (sortedPackages.some((extensionPackage) => extensionPackage.id === extensionId)) {
          return;
        }

        delete nextState[extensionId];
        hasChanged = true;
      });

      return hasChanged ? nextState : previous;
    });
  }, [sortedPackages]);

  useEffect(() => {
    if (!isOpen) {
      lastOpenedFolderSignatureRef.current = null;
      return;
    }

    if (packageFolderPaths.length === 0) {
      return;
    }

    if (lastOpenedFolderSignatureRef.current === packageFolderSignature) {
      return;
    }
    lastOpenedFolderSignatureRef.current = packageFolderSignature;

    let cancelled = false;

    void Promise.all(
      packageFolderPaths.map(async (folderPath) => {
        try {
          await loadExtensionPackage(folderPath);
        } catch (error) {
          if (cancelled) {
            return;
          }

          console.warn(
            `failed to refresh extension package while opening Extensions Center: ${folderPath}`,
            error
          );
        }
      })
    );

    return () => {
      cancelled = true;
    };
  }, [isOpen, loadExtensionPackage, packageFolderPaths, packageFolderSignature]);

  const handleLoadFolder = async () => {
    setLoadError(null);
    setIsLoadingPackage(true);

    try {
      const folderPath = normalizeDialogDirectoryPath(
        await open({
          directory: true,
          multiple: false,
          title: t('extensions.loadFolderTitle'),
        })
      );

      if (!folderPath) {
        return;
      }

      await loadExtensionPackage(folderPath);
    } catch (error) {
      setLoadError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('extensions.loadFailed')
      );
    } finally {
      setIsLoadingPackage(false);
    }
  };

  const handleOpenFolder = async (folderPath: string) => {
    setLoadError(null);

    try {
      await revealItemInDir(folderPath);
    } catch (revealError) {
      try {
        await openPath(folderPath);
      } catch (openError) {
        console.error('Failed to open extension folder:', revealError, openError);
        setLoadError(t('extensions.openFolderFailed'));
      }
    }
  };

  const resolveFeatureLabel = (
    value: string,
    labelKeys: Record<string, string>
  ): string => t(labelKeys[value] ?? value, { defaultValue: value });

  const hasHardwareRequirements = (extensionId: string): boolean => {
    const hardwareRequirements = extensionPackages[extensionId]?.hardwareRequirements;
    return Boolean(
      hardwareRequirements?.summary?.trim()
      || hardwareRequirements?.recommendations?.length
      || hardwareRequirements?.notes?.length
    );
  };

  const togglePackageCollapsed = (extensionId: string) => {
    setCollapsedPackageIds((previous) => ({
      ...previous,
      [extensionId]: !previous[extensionId],
    }));
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={t('extensions.title')}
      onClose={onClose}
      widthClassName="w-[920px]"
      footer={
        <>
          <UiButton variant="ghost" onClick={onClose}>
            {t('common.close')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border-dark bg-bg-dark/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-text-dark">
                <PackageOpen className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium">
                  {t('extensions.centerTitle')}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                {t('extensions.centerDescription')}
              </p>
              <p className="mt-2 text-xs leading-5 text-text-muted">
                {t('extensions.bridgeHint')}
              </p>
            </div>

            <UiButton
              onClick={() => void handleLoadFolder()}
              disabled={isLoadingPackage}
            >
              {isLoadingPackage ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('extensions.loadingPackage')}
                </>
              ) : (
                <>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {t('extensions.loadFolder')}
                </>
              )}
            </UiButton>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {t('extensions.loadedPackages')}
              </div>
              <div className="mt-1 text-xl font-semibold text-text-dark">
                {summary.loadedPackageCount}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {t('extensions.enabledPackages')}
              </div>
              <div className="mt-1 text-xl font-semibold text-text-dark">
                {summary.enabledPackageCount}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {t('extensions.modelAssets')}
              </div>
              <div className="mt-1 text-xl font-semibold text-text-dark">
                {summary.modelAssetCount}
              </div>
            </div>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-200">
              {loadError}
            </div>
          ) : null}
        </div>

        {sortedPackages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-dark bg-bg-dark/50 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
              <PlugZap className="h-5 w-5 text-text-muted" />
            </div>
            <div className="mt-4 text-sm font-medium text-text-dark">
              {t('extensions.emptyTitle')}
            </div>
            <p className="mt-2 text-sm text-text-muted">
              {t('extensions.emptyDescription')}
            </p>
          </div>
        ) : (
          <div className="ui-scrollbar max-h-[min(56vh,620px)] space-y-3 overflow-y-auto pr-1">
            {sortedPackages.map((extensionPackage) => {
              const runtime = runtimeById[extensionPackage.id];
              const isEnabled = enabledExtensionIds.includes(extensionPackage.id)
                && runtime?.status === 'ready';
              const isStarting = runtime?.status === 'starting';
              const isError = runtime?.status === 'error';
              const isCollapsed = Boolean(collapsedPackageIds[extensionPackage.id]);
              const currentStep = extensionPackage.startupSteps.find(
                (step) => step.id === runtime?.currentStepId
              );
              const progress = isStarting
                ? runtime?.progress ?? 0
                : isEnabled
                  ? 100
                  : 0;
              const showRuntimeProgress = isStarting || isError;
              const runtimeHint = isStarting
                ? currentStep?.description ?? t('extensions.statusStarting')
                : null;
              const currentStepLabel = currentStep
                ? `${t('extensions.currentStep')}: ${currentStep.label}`
                : isStarting
                  ? t('extensions.statusStarting')
                  : t('extensions.statusError');
              const collapsedSummary = t('extensions.collapsedSummary', {
                nodes: extensionPackage.features.nodes.length,
                models: extensionPackage.models?.length ?? 0,
              });

              return (
                <div
                  key={extensionPackage.id}
                  className="rounded-xl border border-border-dark bg-bg-dark/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => togglePackageCollapsed(extensionPackage.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-text-dark">
                            {extensionPackage.name}
                          </div>
                          <div className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-text-muted">
                            v{extensionPackage.version}
                          </div>
                          <div
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                              isEnabled
                                ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                : isError
                                  ? 'border border-red-400/20 bg-red-400/10 text-red-200'
                                  : 'border border-white/10 bg-white/[0.04] text-text-muted'
                            }`}
                          >
                            {isEnabled ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : isError ? (
                              <AlertCircle className="h-3.5 w-3.5" />
                            ) : (
                              <PackageOpen className="h-3.5 w-3.5" />
                            )}
                            {isEnabled
                              ? t('extensions.statusEnabled')
                              : isStarting
                                ? t('extensions.statusStarting')
                                : isError
                                  ? t('extensions.statusError')
                                  : t('extensions.statusLoaded')}
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
                          <span>{collapsedSummary}</span>
                          {isStarting ? <span>{progress}%</span> : null}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <UiButton
                        variant="ghost"
                        onClick={() => {
                          void handleOpenFolder(extensionPackage.folderPath);
                        }}
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        {t('extensions.openFolder')}
                      </UiButton>

                      <UiButton
                        variant="ghost"
                        onClick={() => togglePackageCollapsed(extensionPackage.id)}
                      >
                        {isCollapsed
                          ? t('extensions.expandDetails')
                          : t('extensions.collapseDetails')}
                      </UiButton>

                      <UiButton
                        variant="ghost"
                        onClick={() => {
                          const shouldRemove = window.confirm(
                            t('extensions.deleteConfirm', {
                              name: extensionPackage.name,
                            })
                          );
                          if (!shouldRemove) {
                            return;
                          }

                          void removeExtensionPackage(extensionPackage.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('extensions.delete')}
                      </UiButton>

                      {isEnabled ? (
                        <UiButton
                          variant="ghost"
                          onClick={() => {
                            void disableExtension(extensionPackage.id);
                          }}
                        >
                          {t('extensions.disable')}
                        </UiButton>
                      ) : (
                        <UiButton
                          onClick={() => {
                            void enableExtension(extensionPackage.id);
                          }}
                          disabled={isStarting}
                        >
                          {isStarting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t('extensions.enabling')}
                            </>
                          ) : (
                            t('extensions.enable')
                          )}
                        </UiButton>
                      )}
                    </div>
                  </div>

                  {showRuntimeProgress ? (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-text-muted">
                        <span>
                          {currentStepLabel}
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-[width] duration-300 ${
                            isError ? 'bg-red-400' : 'bg-accent'
                          }`}
                          style={{
                            width: `${progress}%`,
                          }}
                        />
                      </div>
                      {runtimeHint ? (
                        <div className="text-[11px] text-text-muted">
                          {runtimeHint}
                        </div>
                      ) : null}
                      {runtime?.error ? (
                        <div className="text-xs text-red-200">{runtime.error}</div>
                      ) : null}
                    </div>
                  ) : null}

                  {!isCollapsed ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid gap-2 text-xs text-text-muted md:grid-cols-3">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="font-medium text-text-dark">
                            {t('extensions.packageId')}
                          </div>
                          <div className="mt-1 break-all">{extensionPackage.id}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="font-medium text-text-dark">
                            {t('extensions.runtime')}
                          </div>
                          <div className="mt-1">{extensionPackage.runtime}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="font-medium text-text-dark">
                            {t('extensions.modelAssets')}
                          </div>
                          <div className="mt-1">{extensionPackage.models?.length ?? 0}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="font-medium text-text-dark">
                            {t('extensions.folder')}
                          </div>
                          <div className="mt-1 break-all">{extensionPackage.folderPath}</div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-1">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-xs font-medium text-text-dark">
                            {t('extensions.nodesTitle')}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {extensionPackage.features.nodes.length > 0
                              ? extensionPackage.features.nodes.map((nodeName) => (
                                  <span
                                    key={nodeName}
                                    className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[11px] text-accent"
                                  >
                                    {resolveFeatureLabel(nodeName, NODE_FEATURE_LABEL_KEYS)}
                                  </span>
                                ))
                              : (
                                  <span className="text-[11px] text-text-muted">
                                    {t('extensions.noDeclaredFeatures')}
                                  </span>
                              )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-xs font-medium text-text-dark">
                          {t('extensions.modelsTitle')}
                        </div>
                        {extensionPackage.models && extensionPackage.models.length > 0 ? (
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {extensionPackage.models.map((model) => (
                              <div
                                key={model.id}
                                className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-text-muted"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-medium text-text-dark">
                                    {model.id}
                                  </div>
                                  <div className="rounded-full border border-white/10 px-2 py-0.5 text-[11px]">
                                    {resolveFeatureLabel(model.role ?? 'unknown', MODEL_ROLE_LABEL_KEYS)}
                                  </div>
                                </div>
                                <div className="mt-2 break-all">{model.path}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] text-text-muted">
                            {t('extensions.noModels')}
                          </div>
                        )}
                      </div>

                      {hasHardwareRequirements(extensionPackage.id) ? (
                        <div className="rounded-lg border border-amber-400/18 bg-amber-400/[0.06] p-3">
                          <div className="text-xs font-medium text-text-dark">
                            {t('extensions.hardwareTitle')}
                          </div>

                          {extensionPackage.hardwareRequirements?.summary ? (
                            <div className="mt-2 text-sm leading-6 text-text-muted">
                              {extensionPackage.hardwareRequirements.summary}
                            </div>
                          ) : null}

                          {extensionPackage.hardwareRequirements?.recommendations?.length ? (
                            <div className="mt-3">
                              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
                                {t('extensions.hardwareRecommendations')}
                              </div>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-text-muted">
                                {extensionPackage.hardwareRequirements.recommendations.map((item, index) => (
                                  <li key={`${extensionPackage.id}-hardware-rec-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {extensionPackage.hardwareRequirements?.notes?.length ? (
                            <div className="mt-3">
                              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
                                {t('extensions.hardwareNotes')}
                              </div>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-text-muted">
                                {extensionPackage.hardwareRequirements.notes.map((item, index) => (
                                  <li key={`${extensionPackage.id}-hardware-note-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </UiModal>
  );
}
