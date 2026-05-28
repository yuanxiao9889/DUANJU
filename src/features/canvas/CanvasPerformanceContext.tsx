import { createContext, useContext } from 'react';

export type CanvasRenderMode = 'full' | 'overview';
export type CanvasEdgeRenderMode = 'full' | 'light' | 'hidden';

export interface CanvasPerformanceState {
  renderMode: CanvasRenderMode;
  edgeRenderMode: CanvasEdgeRenderMode;
  suspendMedia: boolean;
  preferThumbnailMedia: boolean;
  enableResultOriginalOnHover: boolean;
}

export interface CanvasMediaPerformanceState {
  renderMode: CanvasRenderMode;
  suspendMedia: boolean;
  preferThumbnailMedia: boolean;
  enableResultOriginalOnHover: boolean;
}

const DEFAULT_CANVAS_MEDIA_PERFORMANCE_STATE: CanvasMediaPerformanceState = {
  renderMode: 'full',
  suspendMedia: false,
  preferThumbnailMedia: false,
  enableResultOriginalOnHover: false,
};

export const CanvasMediaPerformanceContext = createContext<CanvasMediaPerformanceState>(
  DEFAULT_CANVAS_MEDIA_PERFORMANCE_STATE
);

export const CanvasEdgePerformanceContext = createContext<CanvasEdgeRenderMode>('full');

export const CanvasPerformanceContext = CanvasMediaPerformanceContext;

export function useCanvasPerformanceState(): CanvasPerformanceState {
  const mediaState = useContext(CanvasMediaPerformanceContext);
  const edgeRenderMode = useContext(CanvasEdgePerformanceContext);
  return {
    ...mediaState,
    edgeRenderMode,
  };
}

export function useIsOverviewCanvasRender(): boolean {
  return useContext(CanvasMediaPerformanceContext).renderMode === 'overview';
}

export function useShouldSuspendCanvasMedia(): boolean {
  return useContext(CanvasMediaPerformanceContext).suspendMedia;
}

export function useShouldPreferCanvasThumbnailMedia(): boolean {
  return useContext(CanvasMediaPerformanceContext).preferThumbnailMedia;
}

export function useShouldShowCanvasResultOriginalOnHover(): boolean {
  const mediaState = useContext(CanvasMediaPerformanceContext);
  return mediaState.renderMode === 'full' && mediaState.enableResultOriginalOnHover;
}

export function useCanvasEdgeRenderMode(): CanvasEdgeRenderMode {
  return useContext(CanvasEdgePerformanceContext);
}
