import { memo, useEffect, useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  Download,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';
import {
  exportMjStyleCodePackage,
  importMjStyleCodePackage,
} from '@/commands/stylePresetPackage';
import {
  sortMjStyleCodePresetsByUsage,
  type MjStyleCodePreset,
} from '@/features/midjourney/domain/styleCodePresets';
import { MjStyleCodePresetCard } from '@/features/midjourney/ui/MjStyleCodePresetCard';
import {
  buildMjStyleCodePackageData,
  MJ_STYLE_CODE_PACKAGE_FILE_NAME,
  prepareMjStyleCodePackageDataForExport,
} from '@/features/settings/stylePresetPackages';
import {
  formatMjStyleCodeExportSuccessMessage,
  formatMjStyleCodeImportSummaryMessage,
  resolveMjStyleCodePackageErrorMessage,
} from '@/features/settings/stylePresetPackageUi';
import { useSettingsStore } from '@/stores/settingsStore';

interface MjStyleCodeManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestCreate: () => void;
  onRequestEdit: (preset: MjStyleCodePreset) => void;
  onPresetDeleted?: (code: string) => void;
}

interface ActionStatus {
  tone: 'success' | 'error';
  message: string;
}

function MjStyleCodeManagerDialogComponent({
  isOpen,
  onClose,
  onRequestCreate,
  onRequestEdit,
  onPresetDeleted,
}: MjStyleCodeManagerDialogProps) {
  const { t } = useTranslation();
  const presets = useSettingsStore((state) => state.mjStyleCodePresets);
  const deleteMjStyleCodePreset = useSettingsStore((state) => state.deleteMjStyleCodePreset);
  const importMjStyleCodePackageData = useSettingsStore(
    (state) => state.importMjStyleCodePackageData
  );
  const [pendingDelete, setPendingDelete] = useState<MjStyleCodePreset | null>(null);
  const [activeAction, setActiveAction] = useState<'import' | 'export' | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);

  const sortedPresets = useMemo(
    () => sortMjStyleCodePresetsByUsage(presets),
    [presets]
  );
  const exportablePackageData = useMemo(
    () => buildMjStyleCodePackageData(presets),
    [presets]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveAction(null);
    setActionStatus(null);
  }, [isOpen]);

  const handleImportPackage = async () => {
    setActiveAction('import');
    setActionStatus(null);

    try {
      const selectedPath = await open({
        multiple: false,
        filters: [{ name: 'Style Code Package', extensions: ['scpreset'] }],
      });

      if (typeof selectedPath !== 'string') {
        return;
      }

      const importedPackage = await importMjStyleCodePackage(selectedPath);
      const summary = importMjStyleCodePackageData(importedPackage.data);
      setActionStatus({
        tone: 'success',
        message: formatMjStyleCodeImportSummaryMessage(t, summary),
      });
    } catch (error) {
      console.error('[MjStyleCodeManagerDialog] failed to import package', error);
      setActionStatus({
        tone: 'error',
        message: resolveMjStyleCodePackageErrorMessage(t, error, 'import'),
      });
    } finally {
      setActiveAction(null);
    }
  };

  const handleExportPackage = async () => {
    setActiveAction('export');
    setActionStatus(null);

    try {
      const selectedPath = await save({
        defaultPath: MJ_STYLE_CODE_PACKAGE_FILE_NAME,
        filters: [{ name: 'Style Code Package', extensions: ['scpreset'] }],
      });

      if (typeof selectedPath !== 'string') {
        return;
      }

      const exportData = await prepareMjStyleCodePackageDataForExport(presets);
      await exportMjStyleCodePackage({
        targetPath: selectedPath,
        data: exportData,
      });
      setActionStatus({
        tone: 'success',
        message: formatMjStyleCodeExportSuccessMessage(
          t,
          exportData.presets.length
        ),
      });
    } catch (error) {
      console.error('[MjStyleCodeManagerDialog] failed to export package', error);
      setActionStatus({
        tone: 'error',
        message: resolveMjStyleCodePackageErrorMessage(t, error, 'export'),
      });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <>
      <UiModal
        isOpen={isOpen}
        title={t('node.midjourney.personalization.managerTitle')}
        onClose={onClose}
        widthClassName="w-[calc(100vw-40px)] max-w-[1120px]"
      >
        <div className="space-y-4">
          {actionStatus ? (
            <div
              className={`rounded-[16px] border px-4 py-3 text-sm ${
                actionStatus.tone === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/20 bg-rose-500/10 text-rose-100'
              }`}
            >
              {actionStatus.message}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-black/10 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-text-dark">
                {t('node.midjourney.personalization.presetsTitle')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {t('node.midjourney.personalization.presetsCount', {
                  count: sortedPresets.length,
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <UiButton
                type="button"
                size="sm"
                variant="muted"
                disabled={activeAction !== null}
                onClick={() => {
                  void handleImportPackage();
                }}
              >
                {activeAction === 'import' ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                {t('common.import')}
              </UiButton>
              <UiButton
                type="button"
                size="sm"
                variant="muted"
                disabled={exportablePackageData.presets.length === 0 || activeAction !== null}
                onClick={() => {
                  void handleExportPackage();
                }}
              >
                {activeAction === 'export' ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                {t('common.export')}
              </UiButton>
              <UiButton
                type="button"
                size="sm"
                variant="muted"
                disabled={activeAction !== null}
                onClick={onRequestCreate}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('node.midjourney.personalization.newPreset')}
              </UiButton>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-black/10 p-4">
            {sortedPresets.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,170px))] content-start justify-start gap-3">
                {sortedPresets.map((preset) => (
                  <MjStyleCodePresetCard
                    key={preset.id}
                    preset={preset}
                    className="w-full"
                    actions={
                      <>
                        <button
                          type="button"
                          className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
                          aria-label={t('node.midjourney.personalization.editPreset', {
                            name: preset.name,
                          })}
                          onClick={() => onRequestEdit(preset)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-rose-500/12 hover:text-rose-300"
                          aria-label={t('node.midjourney.personalization.deletePreset', {
                            name: preset.name,
                          })}
                          onClick={() => setPendingDelete(preset)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center">
                <div className="space-y-4 text-center">
                  <div className="text-sm font-medium text-text-dark">
                    {t('node.midjourney.personalization.managerEmpty')}
                  </div>
                  <div className="text-xs leading-5 text-text-muted">
                    {t('node.midjourney.personalization.managerEmptyHint')}
                  </div>
                  <UiButton
                    type="button"
                    size="sm"
                    variant="muted"
                    onClick={onRequestCreate}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('node.midjourney.personalization.newPreset')}
                  </UiButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </UiModal>

      <UiModal
        isOpen={Boolean(pendingDelete)}
        title={t('node.midjourney.personalization.deleteTitle')}
        onClose={() => setPendingDelete(null)}
        widthClassName="w-[calc(100vw-32px)] max-w-[440px]"
        footer={
          <>
            <UiButton
              type="button"
              variant="ghost"
              onClick={() => setPendingDelete(null)}
            >
              {t('common.cancel')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              onClick={() => {
                if (!pendingDelete) {
                  return;
                }

                deleteMjStyleCodePreset(pendingDelete.id);
                onPresetDeleted?.(pendingDelete.code);
                setPendingDelete(null);
              }}
            >
              {t('common.delete')}
            </UiButton>
          </>
        }
      >
        <p className="text-sm leading-6 text-text-muted">
          {t('node.midjourney.personalization.deleteConfirm', {
            name: pendingDelete?.name ?? '',
          })}
        </p>
      </UiModal>
    </>
  );
}

export const MjStyleCodeManagerDialog = memo(MjStyleCodeManagerDialogComponent);

MjStyleCodeManagerDialog.displayName = 'MjStyleCodeManagerDialog';
