import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

const UI_DIALOG_EDGE_GAP = 20;
const UI_DIALOG_X_VAR = '--ui-dialog-x';
const UI_DIALOG_Y_VAR = '--ui-dialog-y';

interface DialogPosition {
  x: number;
  y: number;
}

interface DialogSize {
  width: number;
  height: number;
}

interface DialogContainerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface UseDraggableDialogOptions {
  enabled?: boolean;
  isOpen: boolean;
  initialPosition?: DialogPosition | null;
}

interface UseDraggableDialogResult {
  panelRef: RefObject<HTMLDivElement>;
  overlayLayoutClassName: string;
  panelPositionClassName: string;
  panelStyle: CSSProperties | undefined;
  dragHandleClassName: string;
  isDragging: boolean;
  handleDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function useDraggableDialog({
  enabled = true,
  isOpen,
  initialPosition = null,
}: UseDraggableDialogOptions): UseDraggableDialogResult {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<DialogPosition | null>(null);
  const panelSizeRef = useRef<DialogSize>({ width: 0, height: 0 });
  const positionRef = useRef<DialogPosition | null>(null);
  const pendingPositionRef = useRef<DialogPosition | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hasManualDragRef = useRef(false);
  const hasPositionRef = useRef(false);
  const [hasPosition, setHasPosition] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const measurePanelSize = useCallback((): DialogSize => {
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) {
      return panelSizeRef.current;
    }

    const nextSize = {
      width: panelRect.width,
      height: panelRect.height,
    };
    panelSizeRef.current = nextSize;
    return nextSize;
  }, []);

  const getContainerBounds = useCallback((): DialogContainerBounds => {
    if (typeof window === 'undefined') {
      return {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      };
    }

    const panelElement = panelRef.current;
    const offsetParent = panelElement?.offsetParent;

    if (offsetParent instanceof HTMLElement) {
      const rect = offsetParent.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }, []);

  const clampLocalPosition = useCallback((left: number, top: number): DialogPosition => {
    if (typeof window === 'undefined') {
      return { x: left, y: top };
    }

    const containerBounds = getContainerBounds();
    const { width, height } = measurePanelSize();
    const maxLeft = Math.max(UI_DIALOG_EDGE_GAP, containerBounds.width - width - UI_DIALOG_EDGE_GAP);
    const maxTop = Math.max(UI_DIALOG_EDGE_GAP, containerBounds.height - height - UI_DIALOG_EDGE_GAP);

    return {
      x: Math.min(Math.max(UI_DIALOG_EDGE_GAP, left), maxLeft),
      y: Math.min(Math.max(UI_DIALOG_EDGE_GAP, top), maxTop),
    };
  }, [getContainerBounds, measurePanelSize]);

  const clampViewportPosition = useCallback((left: number, top: number): DialogPosition => {
    const containerBounds = getContainerBounds();
    return clampLocalPosition(left - containerBounds.left, top - containerBounds.top);
  }, [clampLocalPosition, getContainerBounds]);

  const commitPosition = useCallback((nextPosition: DialogPosition) => {
    const panelElement = panelRef.current;
    positionRef.current = nextPosition;
    pendingPositionRef.current = null;

    if (panelElement) {
      panelElement.style.setProperty(UI_DIALOG_X_VAR, `${nextPosition.x}px`);
      panelElement.style.setProperty(UI_DIALOG_Y_VAR, `${nextPosition.y}px`);
    }

    if (!hasPositionRef.current) {
      hasPositionRef.current = true;
      setHasPosition(true);
    }
  }, []);

  const flushPendingPosition = useCallback(() => {
    animationFrameRef.current = null;

    const pendingPosition = pendingPositionRef.current;
    if (!pendingPosition) {
      return;
    }

    commitPosition(pendingPosition);
  }, [commitPosition]);

  const cancelScheduledCommit = useCallback(() => {
    if (animationFrameRef.current == null || typeof window === 'undefined') {
      return;
    }

    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const schedulePositionUpdate = useCallback((nextPosition: DialogPosition) => {
    pendingPositionRef.current = nextPosition;

    if (typeof window === 'undefined') {
      commitPosition(nextPosition);
      return;
    }

    if (animationFrameRef.current != null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(flushPendingPosition);
  }, [commitPosition, flushPendingPosition]);

  const syncAutoPosition = useCallback(() => {
    if (!enabled || !isOpen || typeof window === 'undefined') {
      return;
    }

    const { width, height } = measurePanelSize();
    if (width === 0 && height === 0) {
      return;
    }

    const nextPosition = hasManualDragRef.current && positionRef.current
      ? clampLocalPosition(positionRef.current.x, positionRef.current.y)
      : initialPosition
        ? clampViewportPosition(initialPosition.x, initialPosition.y)
        : (() => {
            const containerBounds = getContainerBounds();
            return clampLocalPosition(
              (containerBounds.width - width) / 2,
              (containerBounds.height - height) / 2,
            );
          })();

    schedulePositionUpdate(nextPosition);
  }, [
    clampLocalPosition,
    clampViewportPosition,
    enabled,
    getContainerBounds,
    initialPosition,
    isOpen,
    measurePanelSize,
    schedulePositionUpdate,
  ]);

  const resetDialogPosition = useCallback(() => {
    cancelScheduledCommit();
    dragOffsetRef.current = null;
    panelSizeRef.current = { width: 0, height: 0 };
    positionRef.current = null;
    pendingPositionRef.current = null;
    hasManualDragRef.current = false;
    hasPositionRef.current = false;
    setHasPosition(false);
    setIsDragging(false);

    const panelElement = panelRef.current;
    if (panelElement) {
      panelElement.style.removeProperty(UI_DIALOG_X_VAR);
      panelElement.style.removeProperty(UI_DIALOG_Y_VAR);
    }
  }, [cancelScheduledCommit]);

  useEffect(() => {
    if (!enabled) {
      if (!isOpen) {
        resetDialogPosition();
      }
      return;
    }

    if (!isOpen || typeof window === 'undefined') {
      resetDialogPosition();
      return;
    }

    let secondFrameId: number | null = null;
    const firstFrameId = window.requestAnimationFrame(() => {
      syncAutoPosition();
      secondFrameId = window.requestAnimationFrame(syncAutoPosition);
    });

    const handleWindowResize = () => {
      syncAutoPosition();
    };

    window.addEventListener('resize', handleWindowResize);

    let resizeObserver: ResizeObserver | null = null;
    if ('ResizeObserver' in window && panelRef.current) {
      resizeObserver = new ResizeObserver(() => {
        syncAutoPosition();
      });
      resizeObserver.observe(panelRef.current);
    }

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId != null) {
        window.cancelAnimationFrame(secondFrameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [enabled, isOpen, resetDialogPosition, syncAutoPosition]);

  useEffect(() => {
    if (!enabled || !isOpen || typeof window === 'undefined') {
      return;
    }

    if (!panelRef.current || hasPositionRef.current) {
      return;
    }

    syncAutoPosition();
  });

  useEffect(() => {
    if (!enabled || !isDragging || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragOffset = dragOffsetRef.current;
      if (!dragOffset) {
        return;
      }

      schedulePositionUpdate(
        clampViewportPosition(event.clientX - dragOffset.x, event.clientY - dragOffset.y),
      );
    };

    const handlePointerUp = () => {
      if (pendingPositionRef.current) {
        cancelScheduledCommit();
        flushPendingPosition();
      }

      dragOffsetRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    cancelScheduledCommit,
    clampViewportPosition,
    enabled,
    flushPendingPosition,
    isDragging,
    schedulePositionUpdate,
  ]);

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const target = event.target;
    if (
      target instanceof Element
      && target.closest('button, input, textarea, select, a, [data-ui-modal-drag-ignore="true"]')
    ) {
      return;
    }

    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) {
      return;
    }

    panelSizeRef.current = {
      width: panelRect.width,
      height: panelRect.height,
    };
    dragOffsetRef.current = {
      x: event.clientX - panelRect.left,
      y: event.clientY - panelRect.top,
    };

    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    hasManualDragRef.current = true;
    commitPosition(clampViewportPosition(panelRect.left, panelRect.top));
    setIsDragging(true);
    event.preventDefault();
  }, [clampViewportPosition, commitPosition, enabled]);

  return {
    panelRef,
    overlayLayoutClassName: enabled ? '' : 'flex items-center justify-center',
    panelPositionClassName: enabled
      ? `absolute ${hasPosition ? '' : 'left-1/2 top-1/2 pointer-events-none'}`
      : 'relative',
    panelStyle: enabled
      ? hasPosition
        ? {
            left: 0,
            top: 0,
            transform: 'translate3d(var(--ui-dialog-x, 0px), var(--ui-dialog-y, 0px), 0)',
            willChange: isDragging ? 'transform' : undefined,
          }
        : {
            transform: 'translate(-50%, -50%)',
          }
      : undefined,
    dragHandleClassName: enabled
      ? `select-none touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-move'}`
      : '',
    isDragging,
    handleDragStart,
  };
}
