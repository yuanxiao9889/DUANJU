import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal } from '@/components/ui';
import {
  formatMjPersonalizationCodeInput,
  normalizeMjPersonalizationCodeIdentity,
  normalizeMjPersonalizationCodes,
  parseMjPersonalizationCodeInput,
  sortMjStyleCodePresetsByUsage,
  type MjStyleCodePreset,
} from '@/features/midjourney/domain/styleCodePresets';
import { MjStyleCodeEditorModal } from '@/features/midjourney/ui/MjStyleCodeEditorModal';
import { MjStyleCodeManagerDialog } from '@/features/midjourney/ui/MjStyleCodeManagerDialog';
import { MjStyleCodePresetCard } from '@/features/midjourney/ui/MjStyleCodePresetCard';
import { useSettingsStore } from '@/stores/settingsStore';

interface MjStyleCodeDialogProps {
  isOpen: boolean;
  selectedCodes: string[];
  onClose: () => void;
  onConfirm: (codes: string[]) => void;
}

type EditorSource = 'picker' | 'manager';

interface EditorState {
  source: EditorSource;
  initialPreset: MjStyleCodePreset | null;
}

function MjStyleCodeDialogComponent({
  isOpen,
  selectedCodes,
  onClose,
  onConfirm,
}: MjStyleCodeDialogProps) {
  const { t } = useTranslation();
  const presets = useSettingsStore((state) => state.mjStyleCodePresets);
  const markMjStyleCodePresetUsed = useSettingsStore(
    (state) => state.markMjStyleCodePresetUsed
  );
  const wasOpenRef = useRef(false);

  const [manualCodeInput, setManualCodeInput] = useState('');
  const [selectedPresetCodes, setSelectedPresetCodes] = useState<string[]>([]);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  const sortedPresets = useMemo(
    () => sortMjStyleCodePresetsByUsage(presets),
    [presets]
  );

  const presetByCode = useMemo(
    () =>
      new Map(
        sortedPresets.map((preset) => [
          normalizeMjPersonalizationCodeIdentity(preset.code),
          preset,
        ] as const)
      ),
    [sortedPresets]
  );

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const normalizedSelectedCodes = normalizeMjPersonalizationCodes(selectedCodes);
      const nextManualCodes: string[] = [];
      const nextSelectedPresetCodes: string[] = [];

      normalizedSelectedCodes.forEach((code) => {
        const matchedPreset = presetByCode.get(
          normalizeMjPersonalizationCodeIdentity(code)
        );
        if (matchedPreset) {
          nextSelectedPresetCodes.push(matchedPreset.code);
          return;
        }

        nextManualCodes.push(code);
      });

      setManualCodeInput(formatMjPersonalizationCodeInput(nextManualCodes));
      setSelectedPresetCodes(nextSelectedPresetCodes);
      setIsManagerOpen(false);
      setEditorState(null);
    }

    if (!isOpen) {
      setIsManagerOpen(false);
      setEditorState(null);
    }

    wasOpenRef.current = isOpen;
  }, [isOpen, presetByCode, selectedCodes]);

  const togglePresetSelection = (code: string) => {
    setSelectedPresetCodes((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    );
  };

  const handlePresetDeleted = (deletedCode: string) => {
    setSelectedPresetCodes((current) => {
      if (!current.includes(deletedCode)) {
        return current;
      }

      setManualCodeInput((previousInput) =>
        formatMjPersonalizationCodeInput([
          ...parseMjPersonalizationCodeInput(previousInput),
          deletedCode,
        ])
      );
      return current.filter((code) => code !== deletedCode);
    });
  };

  const handleEditorSaved = ({
    preset,
    previousCode,
  }: {
    preset: MjStyleCodePreset;
    previousCode: string | null;
  }) => {
    const source = editorState?.source ?? 'picker';
    setEditorState(null);

    if (source === 'picker') {
      setSelectedPresetCodes((current) => {
        const nextCodes = previousCode
          ? current.filter((code) => code !== previousCode)
          : current;
        return nextCodes.includes(preset.code) ? nextCodes : [...nextCodes, preset.code];
      });
      setManualCodeInput((previousInput) =>
        formatMjPersonalizationCodeInput(
          parseMjPersonalizationCodeInput(previousInput).filter((code) => {
            if (code === preset.code) {
              return false;
            }
            if (previousCode && code === previousCode) {
              return false;
            }
            return true;
          })
        )
      );
      return;
    }

    if (!previousCode) {
      return;
    }

    setSelectedPresetCodes((current) => {
      if (!current.includes(previousCode)) {
        return current;
      }

      return normalizeMjPersonalizationCodes(
        current.map((code) => (code === previousCode ? preset.code : code))
      );
    });

    setManualCodeInput((previousInput) =>
      formatMjPersonalizationCodeInput(
        parseMjPersonalizationCodeInput(previousInput).map((code) =>
          code === previousCode ? preset.code : code
        )
      )
    );
  };

  return (
    <>
      <UiModal
        isOpen={isOpen}
        title={t('node.midjourney.personalization.title')}
        onClose={onClose}
        widthClassName="w-[calc(100vw-36px)] max-w-[980px]"
        footer={
          <>
            <UiButton type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </UiButton>
            <UiButton
              type="button"
              variant="muted"
              disabled={!manualCodeInput.trim() && selectedPresetCodes.length === 0}
              onClick={() => {
                setManualCodeInput('');
                setSelectedPresetCodes([]);
              }}
            >
              {t('node.midjourney.personalization.clearSelection')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              onClick={() => {
                const nextCodes = normalizeMjPersonalizationCodes([
                  ...parseMjPersonalizationCodeInput(manualCodeInput),
                  ...selectedPresetCodes,
                ]);

                selectedPresetCodes
                  .map((code) => presetByCode.get(code)?.id ?? null)
                  .filter((value): value is string => Boolean(value))
                  .forEach((presetId) => markMjStyleCodePresetUsed(presetId));
                onConfirm(nextCodes);
              }}
            >
              {t('common.confirm')}
            </UiButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[22px] border border-white/10 bg-black/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                  {t('node.midjourney.personalization.customInputLabel')}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t('node.midjourney.personalization.manualInputHint')}
                </div>
              </div>

              <UiButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setIsManagerOpen(true)}
              >
                <Settings className="mr-1 h-3.5 w-3.5" />
                {t('node.midjourney.personalization.managePresets')}
              </UiButton>
            </div>

            <div className="flex items-center gap-2">
              <UiInput
                value={manualCodeInput}
                placeholder={t('node.midjourney.personalization.customInputPlaceholder')}
                onChange={(event) => {
                  setManualCodeInput(event.target.value.replace(/\r\n?/g, '\n'));
                }}
              />
              <UiButton
                type="button"
                variant="muted"
                className="!h-10 !w-10 !px-0"
                aria-label={t('node.midjourney.personalization.addPreset')}
                title={t('node.midjourney.personalization.addPreset')}
                onClick={() =>
                  setEditorState({
                    source: 'picker',
                    initialPreset: null,
                  })
                }
              >
                <Plus className="h-4 w-4" />
              </UiButton>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-black/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                  {t('node.midjourney.personalization.presetsTitle')}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t('node.midjourney.personalization.presetsCount', {
                    count: sortedPresets.length,
                  })}
                </div>
              </div>
            </div>

            {sortedPresets.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(165px,165px))] content-start justify-start gap-3">
                {sortedPresets.map((preset) => (
                  <MjStyleCodePresetCard
                    key={preset.id}
                    preset={preset}
                    selected={selectedPresetCodes.includes(preset.code)}
                    className="w-full"
                    onClick={() => togglePresetSelection(preset.code)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                <div className="text-sm font-medium text-text-dark">
                  {t('node.midjourney.personalization.presetsEmpty')}
                </div>
                <div className="mt-2 text-xs leading-5 text-text-muted">
                  {t('node.midjourney.personalization.managerEmptyHint')}
                </div>
                <div className="mt-4">
                  <UiButton
                    type="button"
                    size="sm"
                    variant="muted"
                    onClick={() =>
                      setEditorState({
                        source: 'picker',
                        initialPreset: null,
                      })
                    }
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

      <MjStyleCodeEditorModal
        isOpen={Boolean(editorState)}
        initialPreset={editorState?.initialPreset ?? null}
        onClose={() => setEditorState(null)}
        onSaved={handleEditorSaved}
      />

      <MjStyleCodeManagerDialog
        isOpen={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        onRequestCreate={() =>
          setEditorState({
            source: 'manager',
            initialPreset: null,
          })
        }
        onRequestEdit={(preset) =>
          setEditorState({
            source: 'manager',
            initialPreset: preset,
          })
        }
        onPresetDeleted={handlePresetDeleted}
      />
    </>
  );
}

export const MjStyleCodeDialog = memo(MjStyleCodeDialogComponent);

MjStyleCodeDialog.displayName = 'MjStyleCodeDialog';
