import { createContext, useContext } from 'react';

export type CanvasRenderMode = 'full' | 'overview';
export type CanvasEdgeRenderMode = 'full' | 'light' | 'hidden';

export interface CanvasPerformanceState {
  renderMode: CanvasRenderMode;
  edgeRenderMode: CanvasEdgeRenderMode;
  suspendMedia: boolean;
  preferThumbnailMedia: boolean;
}

const DEFAULT_CANVAS_PERFORMANCE_STATE: CanvasPerformanceState = {
  renderMode: 'full',
  edgeRenderMode: 'full',
  suspendMedia: false,
  preferThumbnailMedia: false,
};

export const CanvasPerformanceContext = createContext<CanvasPerformanceState>(
  DEFAULT_CANVAS_PERFORMANCE_STATE
);

export function useCanvasPerformanceState(): CanvasPerformanceState {
  return useContext(CanvasPerformanceContext);
}

export function useIsOverviewCanvasRender(): boolean {
  return useCanvasPerformanceState().renderMode === 'overview';
}

export function useShouldSuspendCanvasMedia(): boolean {
  return useCanvasPerformanceState().suspendMedia;
}

export function useShouldPreferCanvasThumbnailMedia(): boolean {
  return useCanvasPerformanceState().preferThumbnailMedia;
}
