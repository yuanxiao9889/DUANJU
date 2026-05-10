import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';

export interface ImageViewerTransformHandlers {
  containerRef: RefObject<HTMLDivElement>;
  transformTargetRef: RefObject<HTMLDivElement>;
  focusImageRef: RefObject<HTMLImageElement>;
  scaleDisplayRef: RefObject<HTMLDivElement>;
  viewerOpacity: number;
  isDragging: boolean;
  resetView: () => void;
  zoomToActualSize: () => void;
  handleContentMouseDown: (event: MouseEvent<HTMLElement>) => void;
  handleContainerMouseMove: (event: MouseEvent) => void;
  handleContainerMouseUp: () => void;
  handleContentMouseMove: (event: MouseEvent<HTMLElement>) => void;
  handleFocusImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  isPointOnImageContent: (clientX: number, clientY: number) => boolean;
}

export function useImageViewerTransform(isOpen: boolean): ImageViewerTransformHandlers {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformTargetRef = useRef<HTMLDivElement>(null);
  const focusImageRef = useRef<HTMLImageElement>(null);
  const scaleDisplayRef = useRef<HTMLDivElement>(null);

  const [viewerOpacity, setViewerOpacity] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const cssScaleRef = useRef(1);
  const imageScaleRef = useRef(1);
  const imagePositionRef = useRef({ x: 0, y: 0 });
  const targetScaleRef = useRef(1);
  const targetPositionRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const clampImageScale = useCallback((value: number): number => {
    return Math.max(0.1, Math.min(10, value));
  }, []);

  const updateContentTransform = useCallback((): void => {
    const target = transformTargetRef.current;
    if (!target) {
      return;
    }

    const scale = imageScaleRef.current;
    const pos = imagePositionRef.current;
    target.style.transform = `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`;

    if (scaleDisplayRef.current) {
      const totalScale = cssScaleRef.current * scale;
      scaleDisplayRef.current.innerText = `${Math.round(totalScale * 100)}%`;
    }
  }, []);

  const resetView = useCallback((): void => {
    imageScaleRef.current = 1;
    imagePositionRef.current = { x: 0, y: 0 };
    targetScaleRef.current = 1;
    targetPositionRef.current = { x: 0, y: 0 };
    updateContentTransform();
  }, [updateContentTransform]);

  const zoomToActualSize = useCallback((): void => {
    if (!Number.isFinite(cssScaleRef.current) || cssScaleRef.current <= 0) {
      return;
    }

    const actualSizeScale = clampImageScale(1 / cssScaleRef.current);
    imageScaleRef.current = actualSizeScale;
    targetScaleRef.current = actualSizeScale;
    imagePositionRef.current = { x: 0, y: 0 };
    targetPositionRef.current = { x: 0, y: 0 };
    updateContentTransform();
  }, [clampImageScale, updateContentTransform]);

  const isPointOnImageContent = useCallback((clientX: number, clientY: number): boolean => {
    const focusImage = focusImageRef.current;
    if (!focusImage || !focusImage.naturalWidth || !focusImage.naturalHeight) {
      return false;
    }

    const rect = focusImage.getBoundingClientRect();
    const imageRatio = focusImage.naturalWidth / focusImage.naturalHeight;
    const containerRatio = rect.width / rect.height;

    let contentWidth: number;
    let contentHeight: number;
    let offsetX: number;
    let offsetY: number;

    if (imageRatio > containerRatio) {
      contentWidth = rect.width;
      contentHeight = rect.width / imageRatio;
      offsetX = 0;
      offsetY = (rect.height - contentHeight) / 2;
    } else {
      contentHeight = rect.height;
      contentWidth = rect.height * imageRatio;
      offsetX = (rect.width - contentWidth) / 2;
      offsetY = 0;
    }

    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    return (
      clickX >= offsetX
      && clickX <= offsetX + contentWidth
      && clickY >= offsetY
      && clickY <= offsetY + contentHeight
    );
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setViewerOpacity(0);
    requestAnimationFrame(() => {
      setViewerOpacity(1);
    });

    const timer = window.setTimeout(() => {
      updateContentTransform();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [isOpen, updateContentTransform]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isOpen) {
      return;
    }

    const isMacOs =
      typeof navigator !== 'undefined'
      && typeof navigator.platform === 'string'
      && /mac/i.test(navigator.platform);

    const wheelDelta = (event: WheelEvent): number => {
      const factor = event.ctrlKey && isMacOs ? 10 : 1;
      const deltaModeFactor = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
      return -event.deltaY * deltaModeFactor * factor;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!isPointOnImageContent(event.clientX, event.clientY)) {
        return;
      }

      event.preventDefault();

      if (!animationFrameRef.current) {
        targetScaleRef.current = imageScaleRef.current;
        targetPositionRef.current = imagePositionRef.current;
      }

      const currentScale = targetScaleRef.current;
      const currentPos = targetPositionRef.current;
      const pinchDelta = wheelDelta(event);
      const newScale = clampImageScale(currentScale * Math.pow(2, pinchDelta));

      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const mouseFromCenter = { x: mouseX - centerX, y: mouseY - centerY };
      const scaleRatio = newScale / currentScale;
      const newPos = {
        x: mouseFromCenter.x * (1 - scaleRatio) + currentPos.x * scaleRatio,
        y: mouseFromCenter.y * (1 - scaleRatio) + currentPos.y * scaleRatio,
      };

      targetScaleRef.current = newScale;
      targetPositionRef.current = newPos;

      if (!animationFrameRef.current) {
        const loop = () => {
          const targetScale = targetScaleRef.current;
          const targetPos = targetPositionRef.current;
          const nextScale = imageScaleRef.current + (targetScale - imageScaleRef.current) * 0.3;
          const nextPos = {
            x: imagePositionRef.current.x + (targetPos.x - imagePositionRef.current.x) * 0.3,
            y: imagePositionRef.current.y + (targetPos.y - imagePositionRef.current.y) * 0.3,
          };

          imageScaleRef.current = nextScale;
          imagePositionRef.current = nextPos;
          updateContentTransform();

          if (
            Math.abs(nextScale - targetScale) < 0.001
            && Math.abs(nextPos.x - targetPos.x) < 0.1
            && Math.abs(nextPos.y - targetPos.y) < 0.1
          ) {
            imageScaleRef.current = targetScale;
            imagePositionRef.current = targetPos;
            updateContentTransform();
            animationFrameRef.current = null;
          } else {
            animationFrameRef.current = requestAnimationFrame(loop);
          }
        };

        animationFrameRef.current = requestAnimationFrame(loop);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [clampImageScale, isOpen, isPointOnImageContent, updateContentTransform]);

  const handleContentMouseDown = useCallback((event: MouseEvent<HTMLElement>): void => {
    if (event.button !== 0 || !isPointOnImageContent(event.clientX, event.clientY)) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: event.clientX - imagePositionRef.current.x,
      y: event.clientY - imagePositionRef.current.y,
    };
  }, [isPointOnImageContent]);

  const handleContainerMouseMove = useCallback((event: MouseEvent): void => {
    if (!isDragging) {
      return;
    }

    const newPos = {
      x: event.clientX - dragStartRef.current.x,
      y: event.clientY - dragStartRef.current.y,
    };
    imagePositionRef.current = newPos;
    targetPositionRef.current = newPos;
    updateContentTransform();
  }, [isDragging, updateContentTransform]);

  const handleContainerMouseUp = useCallback((): void => {
    setIsDragging(false);
  }, []);

  const handleContentMouseMove = useCallback((event: MouseEvent<HTMLElement>): void => {
    const isOnContent = isPointOnImageContent(event.clientX, event.clientY);
    event.currentTarget.style.cursor = isOnContent ? (isDragging ? 'grabbing' : 'default') : 'default';
  }, [isDragging, isPointOnImageContent]);

  const handleFocusImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>): void => {
    const focusImage = event.currentTarget;
    if (
      !focusImage.naturalWidth
      || !focusImage.naturalHeight
      || !focusImage.offsetWidth
      || !focusImage.offsetHeight
    ) {
      return;
    }

    const naturalRatio = focusImage.naturalWidth / focusImage.naturalHeight;
    const layoutRatio = focusImage.offsetWidth / focusImage.offsetHeight;

    const actualDisplayWidth = naturalRatio > layoutRatio
      ? focusImage.offsetWidth
      : focusImage.offsetHeight * naturalRatio;

    cssScaleRef.current = actualDisplayWidth / focusImage.naturalWidth;
    imageScaleRef.current = 1;
    targetScaleRef.current = 1;
    imagePositionRef.current = { x: 0, y: 0 };
    targetPositionRef.current = { x: 0, y: 0 };
    updateContentTransform();
  }, [updateContentTransform]);

  return {
    containerRef,
    transformTargetRef,
    focusImageRef,
    scaleDisplayRef,
    viewerOpacity,
    isDragging,
    resetView,
    zoomToActualSize,
    handleContentMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleContentMouseMove,
    handleFocusImageLoad,
    isPointOnImageContent,
  };
}
