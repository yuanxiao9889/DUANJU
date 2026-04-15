import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clapperboard, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';

interface EpisodeCatalogMenuItem {
  id: string;
  episodeNumber: number;
  title: string;
  summary: string;
  created: boolean;
}

interface EpisodeCatalogMenuProps {
  position: { x: number; y: number };
  chapterNumber: number;
  sceneOrder: number;
  sceneTitle: string;
  episodes: EpisodeCatalogMenuItem[];
  onSelect: (episodeId: string) => void;
  onClose: () => void;
}

export function EpisodeCatalogMenu({
  position,
  chapterNumber,
  sceneOrder,
  sceneTitle,
  episodes,
  onSelect,
  onClose,
}: EpisodeCatalogMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    window.setTimeout(onClose, UI_POPOVER_TRANSITION_MS);
  }, [onClose]);

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      handleClose();
    };

    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [handleClose]);

  return (
    <div
      ref={menuRef}
      className={`absolute z-50 transition-opacity duration-150 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: position.x, top: position.y }}
    >
      <div className="w-[340px] overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-xl">
        <div className="border-b border-border-dark px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-cyan-200/80">
            <Clapperboard className="h-3.5 w-3.5" />
            {t('script.episodeCatalog.title')}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
              {t('script.sceneCatalog.chapterLabel', { number: chapterNumber })}
            </span>
            <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
              {t('script.sceneCatalog.sceneLabel', { number: sceneOrder + 1 })}
            </span>
            <span className="truncate text-sm font-medium text-text-dark">
              {sceneTitle || t('script.sceneStudio.untitledScene')}
            </span>
          </div>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {episodes.map((episode) => (
            <button
              key={episode.id}
              type="button"
              onClick={() => onSelect(episode.id)}
              className={`mb-2 flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors last:mb-0 ${
                episode.created
                  ? 'border-cyan-500/30 bg-cyan-500/8 hover:bg-cyan-500/14'
                  : 'border-border-dark bg-bg-dark/30 hover:border-cyan-500/35 hover:bg-cyan-500/8'
              }`}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-dark text-cyan-200">
                {episode.created ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-text-dark">
                    {episode.title || t('script.sceneWorkbench.untitledEpisode')}
                  </span>
                  <span className="shrink-0 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
                    {`${chapterNumber}-${episode.episodeNumber}`}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {episode.summary || t('script.episodeCatalog.emptySummary')}
                </p>
                <div className="mt-2 text-[11px] font-medium text-text-muted">
                  {episode.created
                    ? t('script.episodeCatalog.openExisting')
                    : t('script.episodeCatalog.generateNew')}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
