import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  FileText,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea } from '@/components/ui';
import { htmlToPlainText } from '@/features/canvas/application/sceneEpisodeGenerator';
import type {
  EpisodeCard,
  SceneContinuityCheck,
  SceneCopilotThreadMessage,
  ScriptSceneNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { LazyRichTextEditor } from './LazyRichTextEditor';
import { type SelectionRange } from './RichTextEditor';
import { SceneCopilotSectionContent } from './SceneCopilotSectionContent';

type WorkbenchTab = 'overview' | 'draft' | 'director';
type SectionState = Record<string, boolean>;

function parseMultilineItems(text: string): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  text.split(/\n+/g).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    items.push(trimmed);
  });

  return items;
}

function normalizeEpisodeStatus(value: string): EpisodeCard['status'] {
  switch (value) {
    case 'drafting':
    case 'reviewed':
    case 'locked':
      return value;
    case 'idea':
    default:
      return 'idea';
  }
}

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
    'w-full rounded-xl border border-border-dark bg-bg-dark/60 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-cyan-500/35';

  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} resize-none`}
          rows={rows}
          placeholder={placeholder}
          readOnly={readOnly}
        />
      ) : (
        <input
          type="text"
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

interface SceneNodeWorkbenchPanelProps {
  sceneNodeData: ScriptSceneNodeData;
  sourceChapterTitle: string;
  selectedEpisode: EpisodeCard | null;
  activeTab: WorkbenchTab;
  onChangeTab: (tab: WorkbenchTab) => void;
  onSelectEpisode: (episodeId: string) => void;
  onAddEpisode: () => void;
  onDeleteEpisode: (episodeId: string) => void;
  onGenerateEpisodes: (mode: 'initial' | 'regenerate') => Promise<void>;
  isEpisodeGenerating: boolean;
  episodeGenerationError: string;
  onUpdateScenePatch: (patch: Partial<ScriptSceneNodeData>) => void;
  onUpdateSelectedEpisode: (patch: Partial<EpisodeCard>) => void;
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
  episodeCatalog: true,
  sceneCard: true,
  sceneSource: false,
  episodeBlueprint: true,
  continuity: false,
  copilot: false,
  episodeDraft: true,
  director: true,
};

export function SceneNodeWorkbenchPanel({
  sceneNodeData,
  sourceChapterTitle,
  selectedEpisode,
  activeTab,
  onChangeTab,
  onSelectEpisode,
  onAddEpisode,
  onDeleteEpisode,
  onGenerateEpisodes,
  isEpisodeGenerating,
  episodeGenerationError,
  onUpdateScenePatch,
  onUpdateSelectedEpisode,
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
}: SceneNodeWorkbenchPanelProps) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<SectionState>(INITIAL_SECTION_STATE);
  const selectedEpisodeLabel = selectedEpisode
    ? `${sceneNodeData.chapterNumber || 1}-${selectedEpisode.episodeNumber}`
    : null;

  const toggleSection = (key: keyof SectionState) => {
    setSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const selectedEpisodePreview = selectedEpisode
    ? htmlToPlainText(selectedEpisode.draftHtml || selectedEpisode.summary)
    : '';

  return (
    <div className="relative flex-1 min-h-0">
      <UiLoadingOverlay visible={isEpisodeGenerating || isCopilotLoading || isSelectionRewriteLoading || isContinuityLoading} insetClassName="inset-3" />
      <UiScrollArea
        className="h-full"
        viewportClassName="h-full px-3 py-3"
        contentClassName="space-y-3 pr-3"
      >
        <CollapsibleSection
          title={t('script.sceneWorkbench.episodeWorkbench')}
          description={t('script.sceneWorkbench.episodeWorkbenchSubtitle')}
          isOpen={sections.episodeCatalog}
          onToggle={() => toggleSection('episodeCatalog')}
          actions={(
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onAddEpisode}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-dark bg-bg-dark text-text-dark transition-colors hover:bg-bg-dark/80"
                title={t('script.sceneWorkbench.addEpisode')}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onGenerateEpisodes(sceneNodeData.episodes.length > 0 ? 'regenerate' : 'initial')}
                disabled={isEpisodeGenerating}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-200 transition-colors hover:bg-teal-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                title={sceneNodeData.episodes.length > 0
                  ? t('script.sceneWorkbench.regenerateEpisodes')
                  : t('script.sceneWorkbench.generateEpisodes')}
              >
                {sceneNodeData.episodes.length > 0 ? <RefreshCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              </button>
            </div>
          )}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {sceneNodeData.episodes.map((episode) => {
                const isActive = selectedEpisode?.id === episode.id;

                return (
                  <button
                    key={episode.id}
                    type="button"
                    onClick={() => onSelectEpisode(episode.id)}
                    className={`flex h-[72px] w-[92px] shrink-0 flex-col rounded-2xl border px-2.5 py-2 text-left transition-colors ${
                      isActive
                        ? 'border-cyan-400/40 bg-cyan-500/12 text-cyan-100'
                        : 'border-border-dark bg-bg-dark/45 text-text-muted hover:border-cyan-500/25 hover:text-text-dark'
                    }`}
                  >
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em]">
                      {`${sceneNodeData.chapterNumber || 1}-${episode.episodeNumber}`}
                    </span>
                    <span className="mt-2 line-clamp-2 text-xs font-medium leading-4">
                      {episode.title || t('script.sceneWorkbench.untitledEpisode')}
                    </span>
                  </button>
                );
              })}

              {sceneNodeData.episodes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-3 py-5 text-center text-xs text-text-muted">
                  {t('script.sceneWorkbench.emptyEpisodes')}
                </div>
              ) : null}
            </div>

            {selectedEpisode ? (
              <div className="rounded-2xl border border-border-dark bg-bg-dark/35 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
                        {selectedEpisodeLabel}
                      </span>
                      <span className="truncate text-sm font-medium text-text-dark">
                        {selectedEpisode.title || t('script.sceneWorkbench.untitledEpisode')}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">
                      {selectedEpisodePreview || t('script.sceneWorkbench.emptyEpisodePreview')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteEpisode(selectedEpisode.id)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-transparent text-text-muted transition-colors hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200"
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}

            {episodeGenerationError ? (
              <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
                {episodeGenerationError}
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
                  ? 'border-cyan-500/40 bg-cyan-500/12 text-cyan-100'
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
              title={t('script.sceneWorkbench.sceneCardTitle')}
              description={t('script.sceneWorkbench.sceneCardSubtitle')}
              isOpen={sections.sceneCard}
              onToggle={() => toggleSection('sceneCard')}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneStudio.chapterLabel', { number: sceneNodeData.chapterNumber || 1 })}
                    value={sourceChapterTitle}
                    onChange={() => {}}
                    placeholder=""
                    readOnly
                  />
                  <Field
                    label={t('script.sceneCatalog.sceneLabel', { number: sceneNodeData.sourceSceneOrder + 1 })}
                    value={sceneNodeData.title}
                    onChange={(value) => onUpdateScenePatch({ title: value, displayName: value })}
                    placeholder={t('script.sceneStudio.untitledScene')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneStudio.chapterSummary')}
                    value={sceneNodeData.summary}
                    onChange={(value) => onUpdateScenePatch({ summary: value })}
                    placeholder={t('script.sceneWorkbench.sceneSummaryPlaceholder')}
                    multiline
                    rows={3}
                  />
                  <Field
                    label={t('script.sceneStudio.chapterPurpose')}
                    value={sceneNodeData.purpose}
                    onChange={(value) => onUpdateScenePatch({ purpose: value })}
                    placeholder={t('script.sceneWorkbench.scenePurposePlaceholder')}
                    multiline
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneWorkbench.pov')}
                    value={sceneNodeData.povCharacter}
                    onChange={(value) => onUpdateScenePatch({ povCharacter: value })}
                    placeholder={t('script.sceneWorkbench.povPlaceholder')}
                  />
                  <Field
                    label={t('script.sceneStudio.goal')}
                    value={sceneNodeData.goal}
                    onChange={(value) => onUpdateScenePatch({ goal: value })}
                    placeholder={t('script.sceneWorkbench.goalPlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneStudio.conflict')}
                    value={sceneNodeData.conflict}
                    onChange={(value) => onUpdateScenePatch({ conflict: value })}
                    placeholder={t('script.sceneWorkbench.conflictPlaceholder')}
                  />
                  <Field
                    label={t('script.sceneStudio.turn')}
                    value={sceneNodeData.turn}
                    onChange={(value) => onUpdateScenePatch({ turn: value })}
                    placeholder={t('script.sceneWorkbench.turnPlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('script.sceneStudio.emotionalShift')}
                    value={sceneNodeData.emotionalShift}
                    onChange={(value) => onUpdateScenePatch({ emotionalShift: value })}
                    placeholder={t('script.sceneWorkbench.emotionPlaceholder')}
                  />
                  <Field
                    label={t('script.sceneStudio.visualHook')}
                    value={sceneNodeData.visualHook}
                    onChange={(value) => onUpdateScenePatch({ visualHook: value })}
                    placeholder={t('script.sceneWorkbench.visualHookPlaceholder')}
                  />
                </div>

                <Field
                  label={t('script.sceneStudio.subtext')}
                  value={sceneNodeData.subtext}
                  onChange={(value) => onUpdateScenePatch({ subtext: value })}
                  placeholder={t('script.sceneWorkbench.subtextPlaceholder')}
                  multiline
                  rows={2}
                />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title={t('script.sceneWorkbench.sceneSourceTitle')}
              description={t('script.sceneWorkbench.sceneSourceSubtitle')}
              isOpen={sections.sceneSource}
              onToggle={() => toggleSection('sceneSource')}
            >
              <div className="h-[260px] rounded-2xl border border-border-dark bg-bg-dark/40 p-2">
                <LazyRichTextEditor
                  content={sceneNodeData.draftHtml}
                  onChange={(content) => onUpdateScenePatch({ draftHtml: content })}
                  placeholder={t('script.sceneWorkbench.sceneSourcePlaceholder')}
                  className="h-full"
                />
              </div>
            </CollapsibleSection>

            {selectedEpisode ? (
              <>
                <CollapsibleSection
                  title={t('script.sceneWorkbench.episodeBlueprint')}
                  description={selectedEpisodeLabel
                    ? `${selectedEpisodeLabel} / ${t('script.sceneWorkbench.episodeBlueprintSubtitle')}`
                    : t('script.sceneWorkbench.episodeBlueprintSubtitle')}
                  isOpen={sections.episodeBlueprint}
                  onToggle={() => toggleSection('episodeBlueprint')}
                >
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label={t('script.sceneWorkbench.episodeTitle')}
                        value={selectedEpisode.title}
                        onChange={(value) => onUpdateSelectedEpisode({ title: value })}
                        placeholder={t('script.sceneWorkbench.untitledEpisode')}
                      />
                      <Field
                        label={t('script.sceneWorkbench.status')}
                        value={selectedEpisode.status}
                        onChange={(value) => onUpdateSelectedEpisode({ status: normalizeEpisodeStatus(value) })}
                        placeholder="idea / drafting / reviewed / locked"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label={t('script.sceneStudio.chapterSummary')}
                        value={selectedEpisode.summary}
                        onChange={(value) => onUpdateSelectedEpisode({ summary: value })}
                        placeholder={t('script.sceneWorkbench.episodeSummaryPlaceholder')}
                        multiline
                        rows={3}
                      />
                      <Field
                        label={t('script.sceneStudio.chapterPurpose')}
                        value={selectedEpisode.purpose}
                        onChange={(value) => onUpdateSelectedEpisode({ purpose: value })}
                        placeholder={t('script.sceneWorkbench.episodePurposePlaceholder')}
                        multiline
                        rows={3}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label={t('script.sceneStudio.goal')}
                        value={selectedEpisode.goal}
                        onChange={(value) => onUpdateSelectedEpisode({ goal: value })}
                        placeholder={t('script.sceneWorkbench.goalPlaceholder')}
                      />
                      <Field
                        label={t('script.sceneStudio.conflict')}
                        value={selectedEpisode.conflict}
                        onChange={(value) => onUpdateSelectedEpisode({ conflict: value })}
                        placeholder={t('script.sceneWorkbench.conflictPlaceholder')}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label={t('script.sceneStudio.turn')}
                        value={selectedEpisode.turn}
                        onChange={(value) => onUpdateSelectedEpisode({ turn: value })}
                        placeholder={t('script.sceneWorkbench.turnPlaceholder')}
                      />
                      <Field
                        label={t('script.sceneStudio.emotionalShift')}
                        value={selectedEpisode.emotionalShift}
                        onChange={(value) => onUpdateSelectedEpisode({ emotionalShift: value })}
                        placeholder={t('script.sceneWorkbench.emotionPlaceholder')}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label={t('script.sceneStudio.visualHook')}
                        value={selectedEpisode.visualHook}
                        onChange={(value) => onUpdateSelectedEpisode({ visualHook: value })}
                        placeholder={t('script.sceneWorkbench.visualHookPlaceholder')}
                      />
                      <Field
                        label={t('script.sceneWorkbench.pov')}
                        value={selectedEpisode.povCharacter}
                        onChange={(value) => onUpdateSelectedEpisode({ povCharacter: value })}
                        placeholder={t('script.sceneWorkbench.povPlaceholder')}
                      />
                    </div>

                    <Field
                      label={t('script.sceneStudio.subtext')}
                      value={selectedEpisode.subtext}
                      onChange={(value) => onUpdateSelectedEpisode({ subtext: value })}
                      placeholder={t('script.sceneWorkbench.subtextPlaceholder')}
                      multiline
                      rows={2}
                    />
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title={t('script.sceneWorkbench.continuity')}
                  description={t('script.sceneWorkbench.continuitySubtitle')}
                  isOpen={sections.continuity}
                  onToggle={() => toggleSection('continuity')}
                  actions={(
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onRefreshContinuityMemory()}
                        disabled={isContinuityLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t('script.sceneWorkbench.refreshMemory')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRunContinuityCheck()}
                        disabled={isContinuityLoading}
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
                      label={t('script.sceneWorkbench.continuitySummary')}
                      value={selectedEpisode.continuitySummary}
                      onChange={(value) => onUpdateSelectedEpisode({ continuitySummary: value })}
                      placeholder={t('script.sceneWorkbench.continuitySummaryPlaceholder')}
                      multiline
                      rows={3}
                    />
                    <Field
                      label={t('script.sceneWorkbench.continuityFacts')}
                      value={selectedEpisode.continuityFacts.join('\n')}
                      onChange={(value) => onUpdateSelectedEpisode({ continuityFacts: parseMultilineItems(value) })}
                      placeholder={t('script.sceneWorkbench.continuityFactsPlaceholder')}
                      multiline
                      rows={4}
                    />
                    <Field
                      label={t('script.sceneWorkbench.continuityLoops')}
                      value={selectedEpisode.continuityOpenLoops.join('\n')}
                      onChange={(value) => onUpdateSelectedEpisode({ continuityOpenLoops: parseMultilineItems(value) })}
                      placeholder={t('script.sceneWorkbench.continuityLoopsPlaceholder')}
                      multiline
                      rows={4}
                    />

                    {latestContinuityCheck ? (
                      <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                        latestContinuityCheck.status === 'warning'
                          ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
                          : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-100'
                      }`}>
                        <div className="font-medium">{latestContinuityCheck.summary}</div>
                        {latestContinuityCheck.issues.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {latestContinuityCheck.issues.map((issue) => (
                              <div key={issue.id}>
                                <div className="font-medium">{issue.title}</div>
                                <div>{issue.detail}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {continuityError ? (
                      <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
                        {continuityError}
                      </div>
                    ) : null}
                  </div>
                </CollapsibleSection>
              </>
            ) : null}
          </>
        ) : null}

        {activeTab === 'draft' ? (
          selectedEpisode ? (
            <>
              <CollapsibleSection
                title={t('script.sceneWorkbench.copilot')}
                description={selectedEpisodeLabel
                  ? `${selectedEpisodeLabel} / ${t('script.sceneWorkbench.copilotSubtitle')}`
                  : t('script.sceneWorkbench.copilotSubtitle')}
                isOpen={sections.copilot}
                onToggle={() => toggleSection('copilot')}
                actions={(
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onRunCopilot('analysis')}
                      disabled={isCopilotLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {t('script.sceneWorkbench.analysis')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRunCopilot('director')}
                      disabled={isCopilotLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                    >
                      <Clapperboard className="h-3.5 w-3.5" />
                      {t('script.sceneWorkbench.directorPass')}
                    </button>
                  </div>
                )}
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
                  assistantLabel={t('script.sceneWorkbench.copilotAssistant')}
                  userLabel={t('script.sceneWorkbench.copilotYou')}
                  inputPlaceholder={t('script.sceneWorkbench.copilotInputPlaceholder')}
                  inputHint={t('script.sceneWorkbench.copilotHint')}
                  sendLabel={t('script.sceneWorkbench.sendCopilot')}
                  expandedSelectionComparisons={expandedSelectionComparisons}
                  onToggleSelectionComparison={onToggleSelectionComparison}
                  hasSelectionTarget={hasSelectionTarget}
                  onApplySelectionVariant={onApplySelectionVariant}
                  onDismissSelectionVariants={onDismissSelectionVariants}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title={t('script.sceneWorkbench.episodeDraft')}
                description={selectedEpisodeLabel
                  ? `${selectedEpisodeLabel} / ${t('script.sceneWorkbench.episodeDraftSubtitle')}`
                  : t('script.sceneWorkbench.episodeDraftSubtitle')}
                isOpen={sections.episodeDraft}
                onToggle={() => toggleSection('episodeDraft')}
                actions={(
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onRunCopilot('continue')}
                      disabled={isCopilotLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:opacity-60"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t('script.sceneWorkbench.continueDraft')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRewriteDraft()}
                      disabled={isCopilotLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {t('script.sceneWorkbench.rewriteDraft')}
                    </button>
                  </div>
                )}
              >
                <div className="h-[360px] rounded-2xl border border-border-dark bg-bg-dark/40 p-2">
                  <LazyRichTextEditor
                    content={selectedEpisode.draftHtml}
                    onChange={(content) => onUpdateSelectedEpisode({ draftHtml: content })}
                    onSelect={onDraftSelectionChange}
                    pendingSelectionReplacement={pendingSelectionReplacement}
                    onSelectionReplacementApplied={onSelectionReplacementApplied}
                    placeholder={t('script.sceneWorkbench.episodeDraftPlaceholder')}
                    className="h-full"
                  />
                </div>
              </CollapsibleSection>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-4 py-8 text-center text-sm text-text-muted">
              {t('script.sceneWorkbench.emptyEpisodes')}
            </div>
          )
        ) : null}

        {activeTab === 'director' ? (
          selectedEpisode ? (
            <CollapsibleSection
              title={t('script.sceneWorkbench.directorNotes')}
              description={selectedEpisodeLabel
                ? `${selectedEpisodeLabel} / ${t('script.sceneWorkbench.directorNotesSubtitle')}`
                : t('script.sceneWorkbench.directorNotesSubtitle')}
              isOpen={sections.director}
              onToggle={() => toggleSection('director')}
            >
              <Field
                label={t('script.sceneWorkbench.directorNotes')}
                value={selectedEpisode.directorNotes}
                onChange={(value) => onUpdateSelectedEpisode({ directorNotes: value })}
                placeholder={t('script.sceneWorkbench.directorNotesPlaceholder')}
                multiline
                rows={14}
              />
            </CollapsibleSection>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-4 py-8 text-center text-sm text-text-muted">
              {t('script.sceneWorkbench.emptyEpisodes')}
            </div>
          )
        ) : null}
      </UiScrollArea>
    </div>
  );
}
