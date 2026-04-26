import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Copy, RotateCcw, X } from 'lucide-react';

import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import type { ImageViewerMetadata } from '@/features/canvas/domain/canvasNodes';
import { getModelProvider } from '@/features/canvas/models';

import { useImageViewerTransform } from '../hooks/useImageViewerTransform';

export interface ImageViewerModalProps {
  open: boolean;
  imageUrl: string;
  imageList: string[];
  currentIndex: number;
  metadata: ImageViewerMetadata | null;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
}

export function ImageViewerModal({
  open,
  imageUrl,
  imageList,
  currentIndex,
  metadata,
  onClose,
  onNavigate,
}: ImageViewerModalProps): JSX.Element | null {
  const { t, i18n } = useTranslation();
  const viewerControlClass =
    'inline-flex h-10 items-center justify-center rounded-full border border-white/20 bg-black/60 px-4 text-sm text-white backdrop-blur-xl transition-colors hover:bg-white/10';
  const metadataCardClass =
    'rounded-2xl border border-white/[0.05] bg-white/[0.035] p-4';
  const promptActionClass =
    'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-medium text-white/88 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45';
  const promptActionCopiedClass =
    'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-emerald-400/14 px-3 text-xs font-medium text-white/88 transition-colors hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-45';
  const promptSurfaceClass =
    'ui-scrollbar min-h-[180px] flex-1 rounded-[24px] border border-white/[0.05] bg-white/[0.04] p-4 text-sm leading-6 text-white/84 shadow-inner shadow-black/10';
  const [isVisible, setIsVisible] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [displayImageUrl, setDisplayImageUrl] = useState(imageUrl);
  const [isPromptCopied, setIsPromptCopied] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  const {
    containerRef,
    imageRef,
    scaleDisplayRef,
    viewerOpacity,
    resetView,
    zoomToActualSize,
    handleImageMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleImageMouseMove,
    handleImageLoad,
    isPointOnImageContent,
  } = useImageViewerTransform(open && isVisible);

  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US';
  const providerName = useMemo(() => {
    const providerId = metadata?.providerId?.trim() ?? '';
    if (!providerId) {
      return null;
    }

    const provider = getModelProvider(providerId);
    if (provider.id === 'unknown') {
      return providerId;
    }

    return (
      (i18n.language.startsWith('zh') ? provider.label : provider.name).trim()
      || provider.label.trim()
      || provider.name.trim()
      || providerId
    );
  }, [i18n.language, metadata?.providerId]);

  const generatedAtLabel = useMemo(() => {
    if (!metadata?.generatedAt || !Number.isFinite(metadata.generatedAt)) {
      return null;
    }

    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(metadata.generatedAt));
  }, [locale, metadata?.generatedAt]);

  const promptText = metadata?.prompt?.trim() ?? '';
  const hasMetadata = Boolean(metadata);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isVisible]);

  useEffect(() => {
    if (open) {
      setDisplayImageUrl(imageUrl);
      setIsVisible(true);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setOverlayOpacity(0);
      requestAnimationFrame(() => {
        setOverlayOpacity(1);
      });
      return;
    }

    if (!isVisible) {
      return;
    }

    setOverlayOpacity(0);
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      setDisplayImageUrl('');
    }, 400);

    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open, isVisible, imageUrl]);

  useEffect(() => {
    if (!open || !imageUrl) {
      return;
    }

    setDisplayImageUrl(imageUrl);
  }, [open, imageUrl]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    resetView();
  }, [open, imageUrl, resetView]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        onNavigate('prev');
      } else if (event.key === 'ArrowRight') {
        onNavigate('next');
      } else if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onNavigate, onClose]);

  useEffect(() => {
    setIsPromptCopied(false);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
  }, [imageUrl, metadata, open]);

  const handleCopyPrompt = async () => {
    if (!promptText || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(promptText);
    setIsPromptCopied(true);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setIsPromptCopied(false);
      copyResetTimerRef.current = null;
    }, 1200);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[10060] overflow-hidden bg-black/90 backdrop-blur-lg`}
      style={{
        opacity: overlayOpacity,
        transition: 'opacity 400ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        className="absolute inset-0 z-10 flex h-full w-full flex-col gap-4 overflow-auto p-4 md:p-6 xl:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          ref={containerRef}
          className="relative min-h-[52vh] min-w-0 flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-black/55 shadow-[0_24px_64px_rgba(0,0,0,0.4)] xl:min-h-0"
          style={{ overscrollBehavior: 'contain' }}
          onMouseMove={handleContainerMouseMove}
          onMouseUp={handleContainerMouseUp}
          onMouseLeave={handleContainerMouseUp}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/55 to-transparent" />

          <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <img
              ref={imageRef}
              src={displayImageUrl}
              alt={t('viewer.imageAlt', '图片')}
              className="select-none transition-opacity duration-300"
              style={{
                opacity: viewerOpacity * overlayOpacity,
                transformOrigin: 'center',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
              onLoad={handleImageLoad}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onClick={(event) => {
                if (isPointOnImageContent(event.clientX, event.clientY)) {
                  event.stopPropagation();
                } else {
                  onClose();
                }
              }}
              draggable={false}
            />
          </div>

          <div className="absolute right-4 top-4 z-20 flex flex-wrap items-center justify-end gap-2">
            {imageList.length > 1 && (
              <div className={`${viewerControlClass} min-w-[78px]`}>
                {currentIndex + 1} / {imageList.length}
              </div>
            )}
            <div
              ref={scaleDisplayRef}
              className={`${viewerControlClass} min-w-[74px]`}
            >
              100%
            </div>
            <button
              type="button"
              onClick={zoomToActualSize}
              className={viewerControlClass}
              title={t('viewer.actualSize', '1:1')}
            >
              1:1
            </button>
            <button
              type="button"
              onClick={resetView}
              className={viewerControlClass}
              title={t('viewer.reset', '重置视图')}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className={viewerControlClass}
              title={t('common.close', '关闭')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {imageList.length > 1 && (
            <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('prev')}
                disabled={currentIndex <= 0}
                className="rounded-full bg-zinc-800/80 p-2 text-white backdrop-blur-sm transition-all duration-200 hover:bg-zinc-700/80 disabled:cursor-not-allowed disabled:opacity-50"
                title={t('viewer.prev', '上一张')}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('next')}
                disabled={currentIndex >= imageList.length - 1}
                className="rounded-full bg-zinc-800/80 p-2 text-white backdrop-blur-sm transition-all duration-200 hover:bg-zinc-700/80 disabled:cursor-not-allowed disabled:opacity-50"
                title={t('viewer.next', '下一张')}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col rounded-[28px] border border-white/[0.06] bg-white/[0.045] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.24)] backdrop-blur-xl xl:min-h-0 xl:w-[380px]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className={metadataCardClass}>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/34">
                {t('viewer.provider', '厂商')}
              </div>
              <div className="mt-2 text-sm leading-6 text-white/92">
                {providerName ?? t('viewer.unavailable', '暂无')}
              </div>
            </div>

            <div className={metadataCardClass}>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/34">
                {t('viewer.model', '模型')}
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-white/92">
                {metadata?.requestModel?.trim() || t('viewer.unavailable', '暂无')}
              </div>
            </div>

            <div className={`${metadataCardClass} sm:col-span-2 xl:col-span-1`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/34">
                {t('viewer.generatedAt', '生成时间')}
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-white/92">
                {generatedAtLabel ?? t('viewer.unavailable', '暂无')}
              </div>
            </div>
          </div>

          <div className="mt-4 flex min-h-[220px] flex-1 flex-col xl:min-h-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/34">
                {t('viewer.prompt', '提示词')}
              </div>
              <button
                type="button"
                disabled={!promptText}
                className={isPromptCopied ? promptActionCopiedClass : promptActionClass}
                onClick={() => {
                  void handleCopyPrompt();
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {isPromptCopied ? t('common.copied', '已复制') : t('viewer.copyPrompt', '复制提示词')}
              </button>
            </div>

            {hasMetadata && promptText ? (
              <textarea
                readOnly
                value={promptText}
                className={`${promptSurfaceClass} resize-none appearance-none outline-none`}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  color: 'rgba(255, 255, 255, 0.84)',
                }}
              />
            ) : (
              <div className={`${promptSurfaceClass} overflow-auto`}>
                <div className="text-white/42">
                  {hasMetadata
                    ? t('viewer.promptEmpty', '未记录提示词')
                    : t('viewer.noMetadata', '这张图片暂时没有生成信息')}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
