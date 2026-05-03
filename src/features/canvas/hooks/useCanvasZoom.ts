import { useStore } from '@xyflow/react';

export function useCanvasZoom(): number {
  return useStore((state) => state.transform[2]);
}
