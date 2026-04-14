import {
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const TRACK_PADDING = 6;
const MIN_THUMB_SIZE = 28;

type ScrollMetrics = {
  isOverflowing: boolean;
  thumbHeight: number;
  thumbOffset: number;
  trackHeight: number;
  maxScrollTop: number;
};

type DragState = {
  startY: number;
  startScrollTop: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function areMetricsEqual(left: ScrollMetrics, right: ScrollMetrics): boolean {
  return left.isOverflowing === right.isOverflowing
    && left.thumbHeight === right.thumbHeight
    && left.thumbOffset === right.thumbOffset
    && left.trackHeight === right.trackHeight
    && left.maxScrollTop === right.maxScrollTop;
}

export interface UiScrollAreaProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  viewportClassName?: string;
  viewportStyle?: CSSProperties;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  thumbMinSize?: number;
}

export function UiScrollArea({
  children,
  className = '',
  style,
  viewportClassName = '',
  viewportStyle,
  contentClassName = '',
  contentStyle,
  thumbMinSize = MIN_THUMB_SIZE,
  ...rest
}: UiScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    isOverflowing: false,
    thumbHeight: 0,
    thumbOffset: 0,
    trackHeight: 0,
    maxScrollTop: 0,
  });

  const updateMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const clientHeight = viewport.clientHeight;
    const scrollHeight = viewport.scrollHeight;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const trackHeight = Math.max(0, clientHeight - TRACK_PADDING * 2);

    if (trackHeight <= 0 || maxScrollTop <= 0) {
      setMetrics((current) => {
        const nextMetrics: ScrollMetrics = {
          isOverflowing: false,
          thumbHeight: 0,
          thumbOffset: 0,
          trackHeight,
          maxScrollTop,
        };
        return areMetricsEqual(current, nextMetrics) ? current : nextMetrics;
      });
      return;
    }

    const thumbHeight = clamp(
      Math.round(trackHeight * (clientHeight / scrollHeight)),
      thumbMinSize,
      trackHeight,
    );
    const maxThumbOffset = Math.max(0, trackHeight - thumbHeight);
    const thumbOffset = maxScrollTop > 0
      ? Math.round((viewport.scrollTop / maxScrollTop) * maxThumbOffset)
      : 0;

    setMetrics((current) => {
      const nextMetrics: ScrollMetrics = {
        isOverflowing: true,
        thumbHeight,
        thumbOffset,
        trackHeight,
        maxScrollTop,
      };
      return areMetricsEqual(current, nextMetrics) ? current : nextMetrics;
    });
  }, [thumbMinSize]);

  useEffect(() => {
    updateMetrics();
  }, [children, updateMetrics]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport) {
      return;
    }

    const handleScroll = () => {
      updateMetrics();
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateMetrics();
      });
      resizeObserver.observe(viewport);
      if (content) {
        resizeObserver.observe(content);
      }
    } else {
      window.addEventListener('resize', updateMetrics);
    }

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
      if (!resizeObserver) {
        window.removeEventListener('resize', updateMetrics);
      }
    };
  }, [updateMetrics]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'none';
      window.getSelection()?.removeAllRanges();
    }

    const handlePointerMove = (event: PointerEvent) => {
      const viewport = viewportRef.current;
      const dragState = dragStateRef.current;
      if (!viewport || !dragState || metrics.trackHeight <= 0 || metrics.maxScrollTop <= 0) {
        return;
      }

      const maxThumbOffset = Math.max(1, metrics.trackHeight - metrics.thumbHeight);
      const deltaY = event.clientY - dragState.startY;
      const scrollRatio = metrics.maxScrollTop / maxThumbOffset;
      viewport.scrollTop = clamp(
        dragState.startScrollTop + deltaY * scrollRatio,
        0,
        metrics.maxScrollTop,
      );
      updateMetrics();
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('selectstart', handleSelectStart);

    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('selectstart', handleSelectStart);
    };
  }, [isDragging, metrics.maxScrollTop, metrics.thumbHeight, metrics.trackHeight, updateMetrics]);

  const handleThumbPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      startY: event.clientY,
      startScrollTop: viewport.scrollTop,
    };
    setIsDragging(true);
  }, []);

  const handleTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !metrics.isOverflowing || metrics.trackHeight <= 0) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const maxThumbOffset = Math.max(0, metrics.trackHeight - metrics.thumbHeight);
    const nextThumbOffset = clamp(
      event.clientY - rect.top - metrics.thumbHeight / 2,
      0,
      maxThumbOffset,
    );
    const scrollRatio = maxThumbOffset > 0 ? nextThumbOffset / maxThumbOffset : 0;
    viewport.scrollTop = scrollRatio * metrics.maxScrollTop;
    updateMetrics();
  }, [metrics.isOverflowing, metrics.maxScrollTop, metrics.thumbHeight, metrics.trackHeight, updateMetrics]);

  const trackStyle = useMemo<CSSProperties>(() => ({
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    right: 2,
    width: 8,
    background: 'var(--ui-scrollbar-track)',
    border: '1px solid rgba(var(--border-rgb), 0.18)',
    borderRadius: '9999px',
    opacity: metrics.isOverflowing ? 1 : 0,
    transition: 'opacity 160ms ease, background-color 160ms ease',
  }), [metrics.isOverflowing]);

  const thumbStyle = useMemo<CSSProperties>(() => ({
    top: metrics.thumbOffset,
    height: metrics.thumbHeight,
    background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.18), var(--ui-scrollbar-thumb))',
    border: '1px solid var(--ui-scrollbar-thumb-border)',
    borderRadius: '9999px',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.18)',
    cursor: 'default',
  }), [metrics.thumbHeight, metrics.thumbOffset]);

  return (
    <div
      className={`relative min-h-0 overflow-hidden ${className}`.trim()}
      style={style}
      {...rest}
    >
      <div
        ref={viewportRef}
        className={`ui-scrollarea-viewport h-full w-full overflow-auto ${viewportClassName}`.trim()}
        style={viewportStyle}
      >
        <div
          ref={contentRef}
          className={`${contentClassName}`.trim()}
          style={contentStyle}
        >
          {children}
        </div>
      </div>

      {metrics.isOverflowing ? (
        <div
          className="absolute z-20 cursor-default"
          style={trackStyle}
          onPointerDown={handleTrackPointerDown}
        >
          <div
            className="absolute left-0 right-0"
            style={thumbStyle}
            onPointerDown={handleThumbPointerDown}
          />
        </div>
      ) : null}
    </div>
  );
}
