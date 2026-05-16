import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal, UiSelect } from '@/components/ui';
import {
  expandScriptAssetExtractionToStoryboardProject,
  rankStoryboardProjectCandidates,
  type StoryboardProjectCandidate,
} from '@/features/canvas/application/storyboardAssetExpand';

interface StoryboardAssetExpandDialogProps {
  isOpen: boolean;
  sourceNodeId: string | null;
  onClose: () => void;
}

type ExpandTargetMode = 'new' | 'existing';

function formatUpdatedAt(value: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  } catch {
    return new Date(value).toLocaleString();
  }
}

function resolveRecommendedCandidate(
  candidates: StoryboardProjectCandidate[]
): StoryboardProjectCandidate | null {
  return candidates[0] ?? null;
}

export function StoryboardAssetExpandDialog({
  isOpen,
  sourceNodeId,
  onClose,
}: StoryboardAssetExpandDialogProps) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<ExpandTargetMode>('new');
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const candidates = useMemo(
    () => (sourceNodeId ? rankStoryboardProjectCandidates(sourceNodeId) : []),
    [sourceNodeId]
  );
  const recommendedCandidate = useMemo(
    () => resolveRecommendedCandidate(candidates),
    [candidates]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode('new');
    setNewProjectName('');
    setSelectedProjectId(recommendedCandidate?.id ?? '');
    setIsSubmitting(false);
    setErrorMessage(null);
  }, [isOpen, recommendedCandidate?.id]);

  const canSubmit =
    Boolean(sourceNodeId)
    && !isSubmitting
    && (
      mode === 'new'
        ? newProjectName.trim().length > 0
        : selectedProjectId.trim().length > 0
    );

  const handleSubmit = async () => {
    if (!sourceNodeId || !canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await expandScriptAssetExtractionToStoryboardProject({
        sourceNodeId,
        targetProjectId: mode === 'existing' ? selectedProjectId : null,
        newProjectName: mode === 'new' ? newProjectName.trim() : null,
      });
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('project.storyboardAssetExpand.errors.generic')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={t('project.storyboardAssetExpand.title')}
      onClose={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
      widthClassName="w-[calc(100vw-32px)] max-w-[560px]"
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </UiButton>
          <UiButton type="button" variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {isSubmitting
              ? t('project.storyboardAssetExpand.submitting')
              : t('project.storyboardAssetExpand.confirm')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
              mode === 'new'
                ? 'border-accent bg-accent/12 text-text-dark'
                : 'border-border-dark bg-bg-dark/30 text-text-muted hover:text-text-dark'
            }`}
          >
            <div className="text-sm font-semibold">{t('project.storyboardAssetExpand.modeNew')}</div>
            <div className="mt-1 text-xs leading-5">{t('project.storyboardAssetExpand.modeNewHint')}</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
              mode === 'existing'
                ? 'border-accent bg-accent/12 text-text-dark'
                : 'border-border-dark bg-bg-dark/30 text-text-muted hover:text-text-dark'
            }`}
          >
            <div className="text-sm font-semibold">{t('project.storyboardAssetExpand.modeExisting')}</div>
            <div className="mt-1 text-xs leading-5">{t('project.storyboardAssetExpand.modeExistingHint')}</div>
          </button>
        </div>

        {mode === 'new' ? (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
              {t('project.storyboardAssetExpand.newNameLabel')}
            </label>
            <UiInput
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder={t('project.storyboardAssetExpand.newNamePlaceholder')}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
              {t('project.storyboardAssetExpand.existingLabel')}
            </label>
            <UiSelect value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              <option value="" disabled>
                {t('project.storyboardAssetExpand.existingPlaceholder')}
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </UiSelect>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-2xl border border-border-dark bg-bg-dark/25 p-3">
              {candidates.length === 0 ? (
                <div className="text-sm text-text-muted">
                  {t('project.storyboardAssetExpand.noCandidates')}
                </div>
              ) : (
                candidates.map((candidate) => {
                  const isSelected = selectedProjectId === candidate.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSelectedProjectId(candidate.id)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent/12'
                          : 'border-border-dark bg-surface-dark/55 hover:border-accent/40'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-dark">{candidate.name}</span>
                        {candidate.sameSourceScript ? (
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2 py-0.5 text-[11px] text-emerald-200">
                            {t('project.storyboardAssetExpand.sameSource')}
                          </span>
                        ) : null}
                        {recommendedCandidate?.id === candidate.id ? (
                          <span className="rounded-full border border-accent/30 bg-accent/12 px-2 py-0.5 text-[11px] text-text-dark">
                            {t('project.storyboardAssetExpand.recommended')}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {t('project.storyboardAssetExpand.updatedAt', {
                          value: formatUpdatedAt(candidate.updatedAt, i18n.language),
                        })}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {errorMessage ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </UiModal>
  );
}
