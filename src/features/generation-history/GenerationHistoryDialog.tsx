import { useEffect, useMemo, useRef } from 'react';
import { AudioLines, ExternalLink, FileImage, Film, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiIconButton, UiInput, UiSelect } from '@/components/ui';
import {
  openGenerationHistoryItemInFolder,
  type GenerationHistoryItemRecord,
  type GenerationHistoryMediaType,
  type GenerationHistoryProjectOption,
} from '@/commands/generationHistory';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  GENERATION_HISTORY_DRAG_MIME_TYPE,
  serializeGenerationHistoryDragPayload,
  toGenerationHistoryDragPayload,
} from './domain/types';
import { useGenerationHistoryStore } from './store';

interface GenerationHistoryDialogProps {
  currentProjectId: string | null;
}

type MediaTypeFilter = GenerationHistoryMediaType | 'all';

interface GenerationHistoryDisplayGroup {
  projectId: string;
  projectName: string;
  updatedAt: number;
  items: GenerationHistoryItemRecord[];
}

function formatDateTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function resolveHistoryTime(item: GenerationHistoryItemRecord): number {
  return item.indexedAt || item.modifiedAt || item.createdAt;
}

function getItemPreviewSource(item: GenerationHistoryItemRecord): string | null {
  if (item.mediaType === 'image') {
    return item.sourcePath;
  }
  return item.previewPath;
}

function mediaIcon(mediaType: GenerationHistoryMediaType) {
  if (mediaType === 'video') {
    return <Film className="h-5 w-5" />;
  }
  if (mediaType === 'audio') {
    return <AudioLines className="h-5 w-5" />;
  }
  return <FileImage className="h-5 w-5" />;
}

function resolveItemTitle(item: GenerationHistoryItemRecord): string {
  const fileStem = item.fileName.replace(/\.[^.]+$/, '').trim();
  return fileStem || item.fileName || item.sourcePath;
}

function GenerationHistoryRow({ item }: { item: GenerationHistoryItemRecord }) {
  const { t } = useTranslation();
  const previewSource = getItemPreviewSource(item);
  const metaParts = [
    t(`generationHistory.mediaTypes.${item.mediaType}`),
    formatDateTime(resolveHistoryTime(item)),
  ].filter(Boolean);

  const handleOpenFolder = () => {
    void openGenerationHistoryItemInFolder(item.id).catch((error) => {
      console.error('Failed to open generation history item folder', error);
    });
  };

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(
          GENERATION_HISTORY_DRAG_MIME_TYPE,
          serializeGenerationHistoryDragPayload(toGenerationHistoryDragPayload(item))
        );
        event.dataTransfer.setData('text/plain', item.sourcePath);
      }}
      className="group flex min-h-[58px] items-center gap-3 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-left transition-[border-color,background-color] hover:border-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.055)]"
      title={item.fileName}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-[rgba(255,255,255,0.08)] bg-bg-dark/80 text-text-muted">
        {previewSource ? (
          <img
            src={resolveImageDisplayUrl(previewSource)}
            alt={item.fileName}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          mediaIcon(item.mediaType)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text-dark">{resolveItemTitle(item)}</div>
        <div className="mt-0.5 truncate text-[11px] text-text-muted">{metaParts.join(' / ')}</div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-1.5 text-text-muted opacity-70 transition-[opacity,background-color,color] hover:bg-white/10 hover:text-text-dark group-hover:opacity-100"
        title={t('generationHistory.openFolder')}
        onClick={handleOpenFolder}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function sortProjectOptions(
  projects: GenerationHistoryProjectOption[],
  currentProjectId: string | null
): GenerationHistoryProjectOption[] {
  return [...projects].sort((left, right) => {
    if (currentProjectId) {
      if (left.projectId === currentProjectId && right.projectId !== currentProjectId) return -1;
      if (right.projectId === currentProjectId && left.projectId !== currentProjectId) return 1;
    }
    return right.updatedAt - left.updatedAt;
  });
}

function groupPageItems(
  items: GenerationHistoryItemRecord[],
  projects: GenerationHistoryProjectOption[],
  currentProjectId: string | null
): GenerationHistoryDisplayGroup[] {
  const projectMeta = new Map(projects.map((project) => [project.projectId, project]));
  const groups = new Map<string, GenerationHistoryDisplayGroup>();

  for (const item of items) {
    const meta = projectMeta.get(item.projectId);
    const itemTime = resolveHistoryTime(item);
    const group = groups.get(item.projectId) ?? {
      projectId: item.projectId,
      projectName: meta?.projectName ?? item.projectName,
      updatedAt: Math.max(meta?.updatedAt ?? 0, itemTime),
      items: [],
    };
    group.updatedAt = Math.max(group.updatedAt, itemTime);
    group.items.push(item);
    groups.set(item.projectId, group);
  }

  for (const group of groups.values()) {
    group.items.sort((left, right) => resolveHistoryTime(right) - resolveHistoryTime(left));
  }

  return [...groups.values()].sort((left, right) => {
    if (currentProjectId) {
      if (left.projectId === currentProjectId && right.projectId !== currentProjectId) return -1;
      if (right.projectId === currentProjectId && left.projectId !== currentProjectId) return 1;
    }
    return right.updatedAt - left.updatedAt;
  });
}

export function GenerationHistoryDialog({ currentProjectId }: GenerationHistoryDialogProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    isOpen,
    isLoading,
    isLoadingMore,
    error,
    items,
    projects,
    totalCount,
    hasMore,
    searchQuery,
    mediaTypeFilter,
    projectFilter,
    close,
    setSearchQuery,
    setMediaTypeFilter,
    setProjectFilter,
    resetAndLoad,
    loadMore,
  } = useGenerationHistoryStore();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target)) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      void resetAndLoad();
    }, searchQuery.trim() ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, mediaTypeFilter, projectFilter, resetAndLoad, searchQuery]);

  const displayGroups = useMemo(
    () => groupPageItems(items, projects, currentProjectId),
    [currentProjectId, items, projects]
  );
  const projectOptions = useMemo(
    () => sortProjectOptions(projects, currentProjectId),
    [currentProjectId, projects]
  );
  const hasFilters =
    searchQuery.trim().length > 0 || mediaTypeFilter !== 'all' || projectFilter !== 'all';
  const isInitialLoading = isLoading && items.length === 0;

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className="absolute bottom-[62px] right-4 z-[10020] flex max-h-[min(680px,calc(100vh-92px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-md"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-text-dark">{t('generationHistory.title')}</h2>
          <div className="text-[11px] text-text-muted">
            {t('generationHistory.totalCount', { count: totalCount })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <UiIconButton className="h-8 w-8" onClick={close} title={t('common.close')}>
            <X className="h-4 w-4" />
          </UiIconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 border-b border-[rgba(255,255,255,0.08)] px-3.5 py-3">
          <div className="grid gap-2 md:grid-cols-[1fr_132px_176px]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <UiInput
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('generationHistory.searchPlaceholder')}
                className="h-8 pl-8"
              />
            </div>
            <UiSelect
              value={mediaTypeFilter}
              onChange={(event) => setMediaTypeFilter(event.target.value as MediaTypeFilter)}
              aria-label={t('generationHistory.mediaTypeFilter')}
            >
              <option value="all">{t('generationHistory.allMediaTypes')}</option>
              <option value="image">{t('generationHistory.mediaTypes.image')}</option>
              <option value="video">{t('generationHistory.mediaTypes.video')}</option>
              <option value="audio">{t('generationHistory.mediaTypes.audio')}</option>
            </UiSelect>
            <UiSelect
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              aria-label={t('generationHistory.projectFilter')}
            >
              <option value="all">{t('generationHistory.allProjects')}</option>
              {projectOptions.map((group) => (
                <option key={group.projectId} value={group.projectId}>
                  {group.projectName}
                </option>
              ))}
            </UiSelect>
          </div>
          {error ? (
            <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {t('generationHistory.loadFailed')}
            </div>
          ) : null}
        </div>

        <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
          {isInitialLoading ? (
            <div className="flex h-56 items-center justify-center text-sm text-text-muted">
              {t('generationHistory.loading')}
            </div>
          ) : displayGroups.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[rgba(255,255,255,0.12)] px-6 text-center text-sm text-text-muted">
              <div>
                {error
                  ? t('generationHistory.emptyAfterError')
                  : hasFilters
                    ? t('generationHistory.emptyFiltered')
                    : t('generationHistory.empty')}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {displayGroups.map((group) => (
                <section key={group.projectId} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-sm font-medium text-text-dark">
                      {group.projectName}
                    </h3>
                    <span className="shrink-0 text-xs text-text-muted">
                      {t('generationHistory.groupCount', { count: group.items.length })}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <GenerationHistoryRow key={item.id} item={item} />
                    ))}
                  </div>
                </section>
              ))}
              {hasMore ? (
                <div className="flex justify-center pt-1">
                  <UiButton size="sm" variant="muted" onClick={() => void loadMore()} disabled={isLoadingMore}>
                    {isLoadingMore ? t('generationHistory.loadingMore') : t('generationHistory.loadMore')}
                  </UiButton>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
