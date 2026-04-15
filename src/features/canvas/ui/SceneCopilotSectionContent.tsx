import { Check, CornerDownLeft, SendHorizonal, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  SceneCopilotSelectionResolution,
  SceneCopilotThreadMessage,
} from '@/features/canvas/domain/canvasNodes';
import { UiScrollArea } from '@/components/ui';
import { SelectionDiffPreview } from './SelectionDiffPreview';

interface SceneCopilotSectionContentProps {
  currentCopilotMessages: SceneCopilotThreadMessage[];
  selectedDraftText: string;
  selectionRewriteInput: string;
  onSelectionRewriteInputChange: (value: string) => void;
  selectionRewriteError: string;
  isSelectionRewriteLoading: boolean;
  onRunSelectionRewrite: (instruction: string) => Promise<void>;
  copilotInput: string;
  onCopilotInputChange: (value: string) => void;
  copilotError: string;
  isCopilotLoading: boolean;
  onSendCopilotInput: () => Promise<void>;
  assistantLabel: string;
  userLabel: string;
  inputPlaceholder: string;
  inputHint: string;
  sendLabel: string;
  inputDisabled?: boolean;
  disabledHint?: string;
  expandedSelectionComparisons: Record<string, boolean>;
  onToggleSelectionComparison: (messageId: string, variantIndex: number) => void;
  hasSelectionTarget: (messageId: string) => boolean;
  onApplySelectionVariant: (
    messageId: string,
    variant: string,
    variantIndex: number,
    mode: 'replace' | 'insertBelow',
  ) => void;
  onDismissSelectionVariants: (messageId: string) => void;
}

function resolveSelectionResolutionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  resolution: SceneCopilotSelectionResolution | null | undefined,
  selectedVariantIndex?: number | null,
): string {
  const number = (selectedVariantIndex ?? 0) + 1;

  switch (resolution) {
    case 'replaced':
      return t('script.sceneStudio.selectionStatusReplaced', { number });
    case 'inserted':
      return t('script.sceneStudio.selectionStatusInserted', { number });
    case 'dismissed':
      return t('script.sceneStudio.selectionStatusDismissed');
    case 'pending':
    default:
      return t('script.sceneStudio.selectionVariantsHint');
  }
}

export function SceneCopilotSectionContent({
  currentCopilotMessages,
  selectedDraftText,
  selectionRewriteInput,
  onSelectionRewriteInputChange,
  selectionRewriteError,
  isSelectionRewriteLoading,
  onRunSelectionRewrite,
  copilotInput,
  onCopilotInputChange,
  copilotError,
  isCopilotLoading,
  onSendCopilotInput,
  assistantLabel,
  userLabel,
  inputPlaceholder,
  inputHint,
  sendLabel,
  inputDisabled = false,
  disabledHint,
  expandedSelectionComparisons,
  onToggleSelectionComparison,
  hasSelectionTarget,
  onApplySelectionVariant,
  onDismissSelectionVariants,
}: SceneCopilotSectionContentProps) {
  const { t } = useTranslation();
  const combinedError = selectionRewriteError || copilotError;
  const isAnySelectionActionDisabled = inputDisabled || isSelectionRewriteLoading;

  return (
    <div className="space-y-3">
      {selectedDraftText.trim() ? (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
            {t('script.sceneStudio.selectionTitle')}
          </div>
          <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-text-dark">
            {selectedDraftText}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onRunSelectionRewrite(t('script.sceneStudio.selectionActionTightenPrompt'))}
              disabled={isAnySelectionActionDisabled}
              className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/8 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('script.sceneStudio.selectionActionTighten')}
            </button>
            <button
              type="button"
              onClick={() => void onRunSelectionRewrite(t('script.sceneStudio.selectionActionSubtextPrompt'))}
              disabled={isAnySelectionActionDisabled}
              className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/8 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('script.sceneStudio.selectionActionSubtext')}
            </button>
            <button
              type="button"
              onClick={() => void onRunSelectionRewrite(t('script.sceneStudio.selectionActionDialoguePrompt'))}
              disabled={isAnySelectionActionDisabled}
              className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/8 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('script.sceneStudio.selectionActionDialogue')}
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={selectionRewriteInput}
              onChange={(event) => onSelectionRewriteInputChange(event.target.value)}
              placeholder={t('script.sceneStudio.selectionInputPlaceholder')}
              disabled={inputDisabled}
              className="flex-1 rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void onRunSelectionRewrite(selectionRewriteInput)}
              disabled={isAnySelectionActionDisabled || selectionRewriteInput.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className={`h-3.5 w-3.5 ${isSelectionRewriteLoading ? 'animate-pulse' : ''}`} />
              {isSelectionRewriteLoading
                ? t('script.sceneStudio.selectionActionBusy')
                : t('script.sceneStudio.selectionActionCustom')}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-3 py-3 text-xs leading-5 text-text-muted">
          {t('script.sceneStudio.selectionEmpty')}
        </div>
      )}

      {currentCopilotMessages.length > 0 ? (
        <UiScrollArea
          className="max-h-[260px] rounded-2xl border border-border-dark bg-bg-dark/35"
          viewportClassName="max-h-[260px] p-3"
          contentClassName="space-y-2 pr-3"
        >
          {currentCopilotMessages.map((message) => {
            const isSelectionVariantsMessage = message.role === 'assistant'
              && message.mode === 'selection'
              && Boolean(message.selectionVariants?.length);

            return (
              <div
                key={message.id}
                className={`rounded-xl px-3 py-2 text-sm leading-6 ${
                  message.role === 'assistant'
                    ? 'bg-cyan-500/10 text-text-dark'
                    : 'bg-surface-dark text-text-dark'
                }`}
              >
                <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-text-muted">
                  {message.role === 'assistant' ? assistantLabel : userLabel}
                </div>

                {isSelectionVariantsMessage ? (
                  <div className="space-y-3">
                    <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                    <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/8 px-3 py-2 text-[11px] leading-5 text-cyan-100">
                      {resolveSelectionResolutionLabel(t, message.selectionResolution, message.selectedVariantIndex)}
                    </div>

                    {message.selectionVariants?.map((variant, index) => {
                      const sourceText = message.selectionSourceText?.trim() ?? '';
                      const comparisonKey = `${message.id}-${index}`;
                      const isComparisonOpen = Boolean(expandedSelectionComparisons[comparisonKey]);
                      const isChosen = message.selectedVariantIndex === index
                        && message.selectionResolution
                        && message.selectionResolution !== 'pending'
                        && message.selectionResolution !== 'dismissed';

                      return (
                        <div
                          key={`${message.id}-${index}`}
                          className="rounded-xl border border-border-dark/80 bg-bg-dark/45 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                              {t('script.sceneStudio.selectionVariantLabel', { number: index + 1 })}
                            </span>
                            {isChosen ? (
                              <span className="rounded-full border border-cyan-500/25 bg-cyan-500/12 px-2 py-0.5 text-[10px] text-cyan-100">
                                {t('script.sceneStudio.selectionChosen')}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {variant}
                          </div>

                          {sourceText ? (
                            <div className="mt-3 flex justify-end">
                              <button
                                type="button"
                                onClick={() => onToggleSelectionComparison(message.id, index)}
                                className="rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                              >
                                {isComparisonOpen
                                  ? t('script.sceneStudio.selectionCompareClose')
                                  : t('script.sceneStudio.selectionCompareOpen')}
                              </button>
                            </div>
                          ) : null}

                          {sourceText && isComparisonOpen ? (
                            <SelectionDiffPreview
                              originalText={sourceText}
                              rewrittenText={variant}
                              originalLabel={t('script.sceneStudio.selectionOriginalLabel')}
                              rewrittenLabel={t('script.sceneStudio.selectionRewriteLabel')}
                              addedLabel={t('script.sceneStudio.selectionDiffAdded')}
                              removedLabel={t('script.sceneStudio.selectionDiffRemoved')}
                            />
                          ) : null}

                          {message.selectionResolution === 'pending' ? (
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => onApplySelectionVariant(message.id, variant, index, 'replace')}
                                disabled={inputDisabled || !hasSelectionTarget(message.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/25 px-2 py-1 text-[11px] text-cyan-100 transition-colors hover:bg-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {t('script.sceneStudio.selectionApplyReplace')}
                              </button>
                              <button
                                type="button"
                                onClick={() => onApplySelectionVariant(message.id, variant, index, 'insertBelow')}
                                disabled={inputDisabled || !hasSelectionTarget(message.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <CornerDownLeft className="h-3.5 w-3.5" />
                                {t('script.sceneStudio.selectionApplyInsertBelow')}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {message.selectionResolution === 'pending' ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] leading-5 text-text-muted">
                          {hasSelectionTarget(message.id)
                            ? t('script.sceneStudio.selectionVariantsHint')
                            : t('script.sceneStudio.selectionNeedTarget')}
                        </div>
                        <button
                          type="button"
                          onClick={() => onDismissSelectionVariants(message.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                        >
                          <X className="h-3.5 w-3.5" />
                          {t('script.sceneStudio.selectionDismiss')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
              </div>
            );
          })}
        </UiScrollArea>
      ) : null}

      {combinedError ? (
        <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
          {combinedError}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border-dark bg-bg-dark/35 p-3">
        <textarea
          value={copilotInput}
          onChange={(event) => onCopilotInputChange(event.target.value)}
          rows={4}
          disabled={inputDisabled}
          className="ui-scrollbar w-full resize-none bg-transparent text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={inputPlaceholder}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className={`text-xs ${combinedError ? 'text-red-200' : 'text-text-muted'}`}>
            {inputDisabled ? (disabledHint ?? inputHint) : inputHint}
          </div>
          <button
            type="button"
            onClick={() => void onSendCopilotInput()}
            disabled={inputDisabled || isCopilotLoading || copilotInput.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <SendHorizonal className="h-3.5 w-3.5" />
            {sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
