import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal, UiSelect } from '@/components/ui';
import {
  createOrSelectStoryboardProjectForDirectorTable,
} from '@/features/canvas/application/smartDirectorStoryboard';
import { rankStoryboardProjectCandidates } from '@/features/canvas/application/storyboardAssetExpand';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  CANVAS_NODE_TYPES,
  type SmartDirectorStoryboardNodeData,
} from '@/features/canvas/domain/canvasNodes';

interface SmartDirectorStoryboardExpandDialogProps {
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

export function SmartDirectorStoryboardExpandDialog({
  isOpen,
  sourceNodeId,
  onClose,
}: SmartDirectorStoryboardExpandDialogProps) {
  const { t, i18n } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const [mode, setMode] = useState<ExpandTargetMode>('new');
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sourceAssetNodeId = useMemo(() => {
    if (!sourceNodeId) {
      return null;
    }
    const node = nodes.find(
      (item) => item.id === sourceNodeId
    );
    if (!node) {
      return null;
    }
    if (node.type === CANVAS_NODE_TYPES.smartDirectorStoryboard) {
      return (node.data as SmartDirectorStoryboardNodeData).sourceAssetExtractNodeId ?? null;
    }
    if (node.type === CANVAS_NODE_TYPES.scriptStoryboardTable) {
      return (node.data as { sourceAssetExtractNodeId?: string | null }).sourceAssetExtractNodeId ?? null;
    }
    return null;
  }, [nodes, sourceNodeId]);

  const candidates = useMemo(
    () => (sourceAssetNodeId ? rankStoryboardProjectCandidates(sourceAssetNodeId) : []),
    [sourceAssetNodeId]
  );
  const recommendedCandidate = candidates[0] ?? null;

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
      await createOrSelectStoryboardProjectForDirectorTable({
        sourceNodeId,
        targetProjectId: mode === 'existing' ? selectedProjectId : null,
        newProjectName: mode === 'new' ? newProjectName.trim() : null,
      });
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('project.smartDirectorStoryboardExpand.errors.generic')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={t('project.smartDirectorStoryboardExpand.title')}
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
          <UiButton
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {isSubmitting
              ? t('project.smartDirectorStoryboardExpand.submitting')
              : t('project.smartDirectorStoryboardExpand.confirm')}
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
            <div className="text-sm font-semibold">
              {t('project.smartDirectorStoryboardExpand.modeNew')}
            </div>
            <div className="mt-1 text-xs leading-5">
              {t('project.smartDirectorStoryboardExpand.modeNewHint')}
            </div>
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
            <div className="text-sm font-semibold">
              {t('project.smartDirectorStoryboardExpand.modeExisting')}
            </div>
            <div className="mt-1 text-xs leading-5">
              {t('project.smartDirectorStoryboardExpand.modeExistingHint')}
            </div>
          </button>
        </div>

        {mode === 'new' ? (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
              {t('project.smartDirectorStoryboardExpand.newNameLabel')}
            </label>
            <UiInput
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder={t('project.smartDirectorStoryboardExpand.newNamePlaceholder')}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
              {t('project.smartDirectorStoryboardExpand.existingLabel')}
            </label>
            <UiSelect
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="" disabled>
                {t('project.smartDirectorStoryboardExpand.existingPlaceholder')}
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
                  {t('project.smartDirectorStoryboardExpand.noCandidates')}
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
                            {t('project.smartDirectorStoryboardExpand.sameSource')}
                          </span>
                        ) : null}
                        {recommendedCandidate?.id === candidate.id ? (
                          <span className="rounded-full border border-accent/30 bg-accent/12 px-2 py-0.5 text-[11px] text-text-dark">
                            {t('project.smartDirectorStoryboardExpand.recommended')}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {t('project.smartDirectorStoryboardExpand.updatedAt', {
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
