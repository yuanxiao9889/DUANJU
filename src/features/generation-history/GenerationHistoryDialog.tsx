import { useEffect, useMemo, useRef } from 'react';
import { AudioLines, ExternalLink, FileImage, Film, RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiIconButton, UiInput, UiSelect } from '@/components/ui';
import {
  openGenerationHistoryItemInFolder,
  type GenerationHistoryItemRecord,
  type GenerationHistoryMediaType,
  type GenerationHistoryProjectGroup,
} from '@/commands/generationHistory';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { formatAudioDuration } from '@/features/canvas/application/audioData';
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

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function GenerationHistoryCard({ item }: { item: GenerationHistoryItemRecord }) {
  const { t } = useTranslation();
  const previewSource = getItemPreviewSource(item);
  const metaParts = [
    t(`generationHistory.mediaTypes.${item.mediaType}`),
    item.durationMs ? formatAudioDuration(item.durationMs / 1000) : null,
    formatFileSize(item.fileSize),
    formatDateTime(item.modifiedAt),
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
      className="group overflow-hidden rounded-md border border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.035)] text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.18)] hover:bg-[rgba(255,255,255,0.055)]"
      title={item.fileName}
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-bg-dark/80">
        {previewSource ? (
          <img
            src={resolveImageDisplayUrl(previewSource)}
            alt={item.fileName}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            {mediaIcon(item.mediaType)}
          </div>
        )}
        <div className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {t(`generationHistory.mediaTypes.${item.mediaType}`)}
        </div>
      </div>
      <div className="space-y-1 px-2.5 py-2">
        <div className="truncate text-xs font-medium text-text-dark">{item.fileName}</div>
        <div className="truncate text-[11px] text-text-muted">{item.projectName}</div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-[11px] text-text-muted">{metaParts.join(' · ')}</div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-text-dark group-hover:opacity-100"
            title={t('generationHistory.openFolder')}
            onClick={handleOpenFolder}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function filterGroups(
  groups: GenerationHistoryProjectGroup[],
  searchQuery: string,
  mediaTypeFilter: MediaTypeFilter,
  projectFilter: string,
  currentProjectId: string | null
): GenerationHistoryProjectGroup[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const sortedGroups = [...groups].sort((left, right) => {
    if (currentProjectId) {
      if (left.projectId === currentProjectId && right.projectId !== currentProjectId) return -1;
      if (right.projectId === currentProjectId && left.projectId !== currentProjectId) return 1;
    }
    return right.updatedAt - left.updatedAt;
  });

  return sortedGroups
    .filter((group) => projectFilter === 'all' || group.projectId === projectFilter)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (mediaTypeFilter !== 'all' && item.mediaType !== mediaTypeFilter) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return [
          item.fileName,
          item.projectName,
          item.mediaType,
          item.sourcePath,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function GenerationHistoryDialog({ currentProjectId }: GenerationHistoryDialogProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    isOpen,
    isLoading,
    isScanning,
    error,
    snapshot,
    searchQuery,
    mediaTypeFilter,
    projectFilter,
    close,
    setSearchQuery,
    setMediaTypeFilter,
    setProjectFilter,
    load,
    scan,
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
    void scan(null);
  }, [isOpen, scan]);

  useEffect(() => {
    if (!isOpen || snapshot.indexedAt > 0) {
      return;
    }
    void load(null);
  }, [isOpen, load, snapshot.indexedAt]);

  const filteredGroups = useMemo(
    () => filterGroups(snapshot.groups, searchQuery, mediaTypeFilter, projectFilter, currentProjectId),
    [currentProjectId, mediaTypeFilter, projectFilter, searchQuery, snapshot.groups]
  );
  const projectOptions = useMemo(() => {
    return [...snapshot.groups].sort((left, right) => {
      if (currentProjectId) {
        if (left.projectId === currentProjectId && right.projectId !== currentProjectId) return -1;
        if (right.projectId === currentProjectId && left.projectId !== currentProjectId) return 1;
      }
      return right.updatedAt - left.updatedAt;
    });
  }, [currentProjectId, snapshot.groups]);
  const hasFilters =
    searchQuery.trim().length > 0 || mediaTypeFilter !== 'all' || projectFilter !== 'all';
  const isBusy = isLoading || isScanning;

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className="absolute bottom-[62px] right-4 z-[10020] flex max-h-[min(680px,calc(100vh-92px))] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-md"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-text-dark">{t('generationHistory.title')}</h2>
          <div className="text-[11px] text-text-muted">
            {t('generationHistory.totalCount', { count: snapshot.totalCount })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <UiButton size="sm" variant="muted" onClick={() => void scan(null)} disabled={isScanning}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            {t('generationHistory.refresh')}
          </UiButton>
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
              {t('generationHistory.scanFailed')}
            </div>
          ) : null}
        </div>

        <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
          {isBusy && snapshot.totalCount === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-text-muted">
              {t('generationHistory.loading')}
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-[rgba(255,255,255,0.12)] text-sm text-text-muted">
              {error
                ? t('generationHistory.emptyAfterError')
                : hasFilters
                  ? t('generationHistory.emptyFiltered')
                  : t('generationHistory.empty')}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((group) => (
                <section key={group.projectId} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-sm font-medium text-text-dark">
                      {group.projectName}
                    </h3>
                    <span className="shrink-0 text-xs text-text-muted">
                      {t('generationHistory.groupCount', { count: group.items.length })}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                    {group.items.map((item) => (
                      <GenerationHistoryCard key={item.id} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
