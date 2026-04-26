import { memo } from 'react';

import { useCanvasStore } from '@/stores/canvasStore';

export const CanvasZoomIndicator = memo(() => {
  const zoom = useCanvasStore((state) => state.currentViewport.zoom);

  return (
    <span
      style={{
        minWidth: '40px',
        textAlign: 'center',
        fontSize: '12px',
        color: '#6b7280',
      }}
    >
      {Math.round((zoom ?? 1) * 100)}%
    </span>
  );
});

CanvasZoomIndicator.displayName = 'CanvasZoomIndicator';
