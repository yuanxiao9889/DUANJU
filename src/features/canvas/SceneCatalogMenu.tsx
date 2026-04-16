import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clapperboard, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';

interface SceneCatalogMenuScene {
  id: string;
  order: number;
  title: string;
  summary: string;
  created: boolean;
}

interface SceneCatalogMenuProps {
  position: { x: number; y: number };
  chapterNumber: number;
  chapterTitle: string;
  scenes: SceneCatalogMenuScene[];
  onSelect: (sceneId: string) => void;
  onClose: () => void;
}

function stripHtmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return (document.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function SceneCatalogMenu({
  position,
  chapterNumber,
  chapterTitle,
  scenes,
  onSelect,
  onClose,
}: SceneCatalogMenuProps) {
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
      <div className="w-[320px] overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-xl">
        <div className="border-b border-border-dark px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-teal-300/80">
            <Clapperboard className="h-3.5 w-3.5" />
            {t('script.sceneCatalog.title')}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
              {t('script.sceneCatalog.chapterLabel', { number: chapterNumber })}
            </span>
            <span className="truncate text-sm font-medium text-text-dark">
              {chapterTitle || t('script.sceneCatalog.untitledChapter')}
            </span>
          </div>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2">
          {scenes.map((scene) => {
            const previewText = stripHtmlToPlainText(scene.summary);
            return (
              <button
                key={scene.id}
                type="button"
                disabled={scene.created}
                onClick={() => {
                  onSelect(scene.id);
                }}
                className={`mb-2 flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors last:mb-0 ${
                  scene.created
                    ? 'cursor-not-allowed border-border-dark bg-bg-dark/45 opacity-65'
                    : 'border-border-dark bg-bg-dark/30 hover:border-teal-500/35 hover:bg-teal-500/8'
                }`}
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-dark text-teal-300">
                  {scene.created ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-text-dark">
                      {scene.title || t('script.sceneCatalog.untitledScene')}
                    </span>
                    <span className="shrink-0 rounded-full bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-200">
                      {t('script.sceneCatalog.sceneLabel', { number: scene.order + 1 })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    {previewText || t('script.sceneCatalog.emptySummary')}
                  </p>
                  {scene.created ? (
                    <div className="mt-2 text-[11px] font-medium text-text-muted">
                      {t('script.sceneCatalog.created')}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
