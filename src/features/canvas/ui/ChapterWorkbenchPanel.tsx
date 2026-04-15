import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea } from '@/components/ui';
import { LazyRichTextEditor } from './LazyRichTextEditor';
import { type SelectionRange } from './RichTextEditor';
import { SceneCopilotSectionContent } from './SceneCopilotSectionContent';
import { htmlToPlainText } from '@/features/canvas/application/sceneEpisodeGenerator';
import type {
  SceneCard,
  SceneContinuityCheck,
  SceneCopilotThreadMessage,
  ScriptChapterNodeData,
  ScriptSceneNodeData,
} from '@/features/canvas/domain/canvasNodes';

type WorkbenchTab = 'overview' | 'draft' | 'director';

type SectionState = Record<string, boolean>;

function CollapsibleSection({
  title,
  description,
  actions,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-dark bg-surface-dark/80">
      <div className="flex items-start justify-between gap-3 border-b border-border-dark/80 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className="mt-0.5 text-text-muted">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-dark">{title}</span>
            {description ? <span className="mt-1 block text-xs leading-5 text-text-muted">{description}</span> : null}
          </span>
        </button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {isOpen ? <div className="px-4 py-4">{children}</div> : null}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  rows?: number;
  readOnly?: boolean;
}) {
  const className =
    `w-full rounded-xl border border-border-dark bg-bg-dark/60 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 ${
      readOnly ? 'cursor-default opacity-80' : 'focus:border-cyan-500/35'
    }`;

  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`ui-scrollbar ${className} resize-none`}
          rows={rows}
          placeholder={placeholder}
          readOnly={readOnly}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={className}
          placeholder={placeholder}
          readOnly={readOnly}
        />
      )}
    </label>
  );
}

interface ChapterWorkbenchPanelProps {
  chapterNodeData: ScriptChapterNodeData;
  chapterScenes: SceneCard[];
  selectedChapterScene: SceneCard | null;
  chapterSceneNodeBySceneId: Map<string, { id: string; data: ScriptSceneNodeData }>;
  activeTab: WorkbenchTab;
  onChangeTab: (tab: WorkbenchTab) => void;
  onUpdateChapterPatch: (patch: Partial<ScriptChapterNodeData>) => void;
  onSelectScene: (sceneId: string) => void;
  onAddScene: () => void;
  onDeleteScene: (sceneId: string) => void;
  onUpdateSelectedScene: (patch: Partial<SceneCard>) => void;
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
  onRunCopilot: (mode: 'analysis' | 'continue' | 'director' | 'custom', userPrompt?: string) => Promise<void>;
  onSendCopilotInput: () => Promise<void>;
  onRewriteDraft: () => Promise<void>;
  pendingSelectionReplacement: {
    requestId: number;
    text: string;
    range: SelectionRange | null;
    mode: 'replace' | 'insertBelow';
  } | null;
  onSelectionReplacementApplied: () => void;
  onDraftSelectionChange: (selection: { text: string; range: SelectionRange | null }) => void;
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
  isContinuityLoading: boolean;
  onRefreshContinuityMemory: () => Promise<void>;
  onRunContinuityCheck: () => Promise<void>;
  continuityError: string;
  latestContinuityCheck: SceneContinuityCheck | null;
}

const INITIAL_SECTION_STATE: SectionState = {
  sceneCatalog: true,
  chapterFocus: true,
  sceneBlueprint: true,
  continuity: false,
  copilot: false,
  draft: true,
  director: true,
};

export function ChapterWorkbenchPanel({
  chapterNodeData,
  chapterScenes,
  selectedChapterScene,
  chapterSceneNodeBySceneId,
  activeTab,
  onChangeTab,
  onUpdateChapterPatch,
  onSelectScene,
  onAddScene,
  onDeleteScene,
  onUpdateSelectedScene,
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
  onRunCopilot,
  onSendCopilotInput,
  onRewriteDraft,
  pendingSelectionReplacement,
  onSelectionReplacementApplied,
  onDraftSelectionChange,
  expandedSelectionComparisons,
  onToggleSelectionComparison,
  hasSelectionTarget,
  onApplySelectionVariant,
  onDismissSelectionVariants,
  isContinuityLoading,
  onRefreshContinuityMemory,
  onRunContinuityCheck,
  continuityError,
  latestContinuityCheck,
}: ChapterWorkbenchPanelProps) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<SectionState>(INITIAL_SECTION_STATE);

  const toggleSection = (key: keyof SectionState) => {
    setSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const selectedScenePreview = selectedChapterScene
    ? htmlToPlainText(selectedChapterScene.summary || selectedChapterScene.visualHook || selectedChapterScene.draftHtml)
    : '';
  const selectedSceneNode = selectedChapterScene
    ? chapterSceneNodeBySceneId.get(selectedChapterScene.id)
    : null;
  const isSelectedSceneLocked = Boolean(selectedSceneNode);

  return (
    <div className="relative flex-1 min-h-0">
      <UiLoadingOverlay visible={isCopilotLoading || isSelectionRewriteLoading || isContinuityLoading} insetClassName="inset-3" />
      <UiScrollArea
        className="h-full"
        viewportClassName="h-full px-3 py-3"
        contentClassName="space-y-3 pr-3"
      >
        <CollapsibleSection
          title={t('script.chapterCatalog.title')}
          description={selectedChapterScene ? t('script.sceneStudio.sceneBlueprintSubtitle') : undefined}
          isOpen={sections.sceneCatalog}
          onToggle={() => toggleSection('sceneCatalog')}
          actions={(
            <button
              type="button"
              onClick={onAddScene}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-dark bg-bg-dark text-text-dark transition-colors hover:bg-bg-dark/80"
              title={t('script.chapterCatalog.addScene')}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {chapterScenes.map((scene) => {
                const isActive = selectedChapterScene?.id === scene.id;
                const sceneNode = chapterSceneNodeBySceneId.get(scene.id);

                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => onSelectScene(scene.id)}
                    className={`flex h-[72px] w-[92px] shrink-0 flex-col rounded-2xl border px-2.5 py-2 text-left transition-colors ${
                      isActive
                        ? 'border-amber-400/40 bg-amber-500/12 text-amber-100'
                        : 'border-border-dark bg-bg-dark/45 text-text-muted hover:border-amber-500/25 hover:text-text-dark'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em]">
                        {t('script.sceneCatalog.sceneLabel', { number: scene.order + 1 })}
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          sceneNode ? 'bg-cyan-300' : 'bg-border-dark'
                        }`}
                      />
                    </div>
                    <span className="mt-2 line-clamp-2 text-xs font-medium leading-4">
                      {scene.title || t('script.sceneStudio.untitledScene')}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedChapterScene ? (
              <div className="rounded-2xl border border-border-dark bg-bg-dark/35 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                        {t('script.sceneCatalog.sceneLabel', { number: selectedChapterScene.order + 1 })}
                      </span>
                      <span className="truncate text-sm font-medium text-text-dark">
                        {selectedChapterScene.title || t('script.sceneStudio.untitledScene')}
                      </span>
                      {isSelectedSceneLocked ? (
                        <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
                          {t('script.chapterCatalog.lockedBadge')}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">
                      {selectedScenePreview || t('script.sceneStudio.sceneCardHint')}
                    </p>
                    {isSelectedSceneLocked ? (
                      <p className="mt-2 text-xs leading-5 text-cyan-100/85">
                        {t('script.chapterCatalog.lockedHint')}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    {selectedSceneNode ? (
                      <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-right text-[11px] leading-5 text-cyan-100">
                        <div>{t('script.chapterCatalog.created')}</div>
                        <div>
                          {t('script.sceneWorkbench.episodeCount', {
                            count: selectedSceneNode.data.episodes.length,
                          })}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (isSelectedSceneLocked) {
                          return;
                        }
                        onDeleteScene(selectedChapterScene.id);
                      }}
                      aria-disabled={isSelectedSceneLocked}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                        isSelectedSceneLocked
                          ? 'cursor-not-allowed border-border-dark/70 bg-bg-dark/30 text-text-muted/45'
                          : 'border-transparent text-text-muted hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200'
                      }`}
                      title={isSelectedSceneLocked
                        ? t('script.chapterCatalog.deleteLockedHint')
                        : t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </CollapsibleSection>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'overview', label: t('script.sceneStudio.workspacePlanning') },
            { id: 'draft', label: t('script.sceneStudio.workspaceWriting') },
            { id: 'director', label: t('script.sceneStudio.workspaceDirector') },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id as WorkbenchTab)}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-amber-500/40 bg-amber-500/12 text-amber-100'
                  : 'border-border-dark bg-bg-dark/45 text-text-muted hover:text-text-dark'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <>
            <CollapsibleSection
              title={t('script.sceneStudio.chapterFocusTitle')}
              description={t('script.sceneStudio.chapterFocusSubtitle')}
              isOpen={sections.chapterFocus}
              onToggle={() => toggleSection('chapterFocus')}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneStudio.chapterLabel', { number: chapterNodeData.chapterNumber || 1 })}
                    value={chapterNodeData.title || chapterNodeData.displayName || ''}
                    onChange={(value) => onUpdateChapterPatch({ title: value, displayName: value })}
                    placeholder={t('script.sceneStudio.untitledChapter')}
                  />
                  <Field
                    label={t('script.sceneStudio.chapterQuestion')}
                    value={chapterNodeData.chapterQuestion ?? ''}
                    onChange={(value) => onUpdateChapterPatch({ chapterQuestion: value })}
                    placeholder={t('script.sceneStudio.chapterQuestionPlaceholder')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneStudio.chapterSummary')}
                    value={chapterNodeData.summary}
                    onChange={(value) => onUpdateChapterPatch({ summary: value })}
                    placeholder={t('script.sceneStudio.chapterSummaryPlaceholder')}
                    multiline
                    rows={3}
                  />
                  <Field
                    label={t('script.sceneStudio.chapterPurpose')}
                    value={chapterNodeData.chapterPurpose ?? ''}
                    onChange={(value) => onUpdateChapterPatch({ chapterPurpose: value })}
                    placeholder={t('script.sceneStudio.chapterPurposePlaceholder')}
                    multiline
                    rows={3}
                  />
                </div>
              </div>
            </CollapsibleSection>

            {selectedChapterScene ? (
              <>
                <CollapsibleSection
                  title={t('script.sceneStudio.sceneBlueprintTitle')}
                  description={t('script.sceneStudio.sceneBlueprintSubtitle')}
                  isOpen={sections.sceneBlueprint}
                  onToggle={() => toggleSection('sceneBlueprint')}
                >
                  <div className="space-y-3">
                    {isSelectedSceneLocked ? (
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/8 px-3 py-2 text-xs leading-5 text-cyan-100">
                        {t('script.chapterCatalog.lockedPanelHint')}
                      </div>
                    ) : null}
                    <Field
                      label={t('script.sceneStudio.sceneTitle')}
                      value={selectedChapterScene.title}
                      onChange={(value) => onUpdateSelectedScene({ title: value })}
                      placeholder={t('script.sceneStudio.sceneTitlePlaceholder')}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.sceneSummary')}
                      value={selectedChapterScene.summary}
                      onChange={(value) => onUpdateSelectedScene({ summary: value })}
                      placeholder={t('script.sceneStudio.sceneSummaryPlaceholder')}
                      multiline
                      rows={3}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.scenePurpose')}
                      value={selectedChapterScene.purpose}
                      onChange={(value) => onUpdateSelectedScene({ purpose: value })}
                      placeholder={t('script.sceneStudio.scenePurposePlaceholder')}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.goal')}
                      value={selectedChapterScene.goal}
                      onChange={(value) => onUpdateSelectedScene({ goal: value })}
                      placeholder={t('script.sceneStudio.goalPlaceholder')}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.conflict')}
                      value={selectedChapterScene.conflict}
                      onChange={(value) => onUpdateSelectedScene({ conflict: value })}
                      placeholder={t('script.sceneStudio.conflictPlaceholder')}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.turn')}
                      value={selectedChapterScene.turn}
                      onChange={(value) => onUpdateSelectedScene({ turn: value })}
                      placeholder={t('script.sceneStudio.turnPlaceholder')}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.visualHook')}
                      value={selectedChapterScene.visualHook}
                      onChange={(value) => onUpdateSelectedScene({ visualHook: value })}
                      placeholder={t('script.sceneStudio.visualHookPlaceholder')}
                      readOnly={isSelectedSceneLocked}
                    />
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title={t('script.sceneStudio.continuityTitle')}
                  description={t('script.sceneStudio.continuitySubtitle')}
                  isOpen={sections.continuity}
                  onToggle={() => toggleSection('continuity')}
                  actions={(
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onRefreshContinuityMemory()}
                        disabled={isContinuityLoading || isSelectedSceneLocked}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t('script.sceneStudio.continuityRefresh')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRunContinuityCheck()}
                        disabled={isContinuityLoading || isSelectedSceneLocked}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/18 disabled:opacity-60"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {t('script.sceneWorkbench.checkContinuity')}
                      </button>
                    </div>
                  )}
                >
                  <div className="space-y-3">
                    <Field
                      label={t('script.sceneStudio.continuitySummary')}
                      value={selectedChapterScene.continuitySummary}
                      onChange={(value) => onUpdateSelectedScene({ continuitySummary: value })}
                      placeholder={t('script.sceneStudio.continuitySummaryPlaceholder')}
                      multiline
                      rows={3}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.continuityFacts')}
                      value={selectedChapterScene.continuityFacts.join('\n')}
                      onChange={(value) => onUpdateSelectedScene({ continuityFacts: value.split('\n').map((line) => line.trim()).filter(Boolean) })}
                      placeholder={t('script.sceneStudio.continuityFactsPlaceholder')}
                      multiline
                      rows={4}
                      readOnly={isSelectedSceneLocked}
                    />
                    <Field
                      label={t('script.sceneStudio.continuityOpenLoops')}
                      value={selectedChapterScene.continuityOpenLoops.join('\n')}
                      onChange={(value) => onUpdateSelectedScene({ continuityOpenLoops: value.split('\n').map((line) => line.trim()).filter(Boolean) })}
                      placeholder={t('script.sceneStudio.continuityOpenLoopsPlaceholder')}
                      multiline
                      rows={4}
                      readOnly={isSelectedSceneLocked}
                    />
                    {latestContinuityCheck ? (
                      <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                        latestContinuityCheck.status === 'warning'
                          ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
                          : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-100'
                      }`}>
                        <div className="font-medium">{latestContinuityCheck.summary}</div>
                      </div>
                    ) : null}
                    {continuityError ? <div className="text-xs text-red-200">{continuityError}</div> : null}
                  </div>
                </CollapsibleSection>
              </>
            ) : null}
          </>
        ) : null}

        {activeTab === 'draft' && selectedChapterScene ? (
          <>
            <CollapsibleSection
              title={t('script.sceneStudio.copilotTitle')}
              description={t('script.sceneStudio.copilotSubtitle')}
              isOpen={sections.copilot}
              onToggle={() => toggleSection('copilot')}
            >
              <SceneCopilotSectionContent
                currentCopilotMessages={currentCopilotMessages}
                selectedDraftText={selectedDraftText}
                selectionRewriteInput={selectionRewriteInput}
                onSelectionRewriteInputChange={onSelectionRewriteInputChange}
                selectionRewriteError={selectionRewriteError}
                isSelectionRewriteLoading={isSelectionRewriteLoading}
                onRunSelectionRewrite={onRunSelectionRewrite}
                copilotInput={copilotInput}
                onCopilotInputChange={onCopilotInputChange}
                copilotError={copilotError}
                isCopilotLoading={isCopilotLoading}
                onSendCopilotInput={onSendCopilotInput}
                assistantLabel={t('script.sceneStudio.copilotAssistantLabel')}
                userLabel={t('script.sceneStudio.copilotUserLabel')}
                inputPlaceholder={t('script.sceneStudio.copilotInputPlaceholder')}
                inputHint={t('script.sceneStudio.copilotEmpty')}
                sendLabel={t('script.sceneStudio.copilotAsk')}
                inputDisabled={isSelectedSceneLocked}
                disabledHint={t('script.chapterCatalog.lockedCopilotHint')}
                expandedSelectionComparisons={expandedSelectionComparisons}
                onToggleSelectionComparison={onToggleSelectionComparison}
                hasSelectionTarget={hasSelectionTarget}
                onApplySelectionVariant={onApplySelectionVariant}
                onDismissSelectionVariants={onDismissSelectionVariants}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title={t('script.sceneStudio.draft')}
              description={t('script.sceneStudio.draftSubtitle')}
              isOpen={sections.draft}
              onToggle={() => toggleSection('draft')}
              actions={(
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void onRunCopilot('continue')} disabled={isCopilotLoading || isSelectedSceneLocked} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:opacity-60">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('script.sceneStudio.copilotActionContinue')}
                  </button>
                  <button type="button" onClick={() => void onRewriteDraft()} disabled={isCopilotLoading || isSelectedSceneLocked} className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('script.sceneWorkbench.rewriteDraft')}
                  </button>
                </div>
              )}
            >
              <div className="h-[360px] rounded-2xl border border-border-dark bg-bg-dark/40 p-2">
                <LazyRichTextEditor
                  content={selectedChapterScene.draftHtml}
                  onChange={(content) => onUpdateSelectedScene({ draftHtml: content })}
                  onSelect={onDraftSelectionChange}
                  pendingSelectionReplacement={pendingSelectionReplacement}
                  onSelectionReplacementApplied={onSelectionReplacementApplied}
                  placeholder={t('script.sceneStudio.draftPlaceholder')}
                  className="h-full"
                  readOnly={isSelectedSceneLocked}
                />
              </div>
            </CollapsibleSection>
          </>
        ) : null}

        {activeTab === 'director' && selectedChapterScene ? (
          <CollapsibleSection
            title={t('script.sceneStudio.directorNotes')}
            description={t('script.sceneStudio.directorNotesSubtitle')}
            isOpen={sections.director}
            onToggle={() => toggleSection('director')}
          >
            <Field label={t('script.sceneStudio.directorNotes')} value={selectedChapterScene.directorNotes} onChange={(value) => onUpdateSelectedScene({ directorNotes: value })} placeholder={t('script.sceneStudio.directorNotesPlaceholder')} multiline rows={14} readOnly={isSelectedSceneLocked} />
          </CollapsibleSection>
        ) : null}
      </UiScrollArea>
    </div>
  );
}
