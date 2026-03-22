import { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import { FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { calculateNodesBounds } from '@/features/canvas/application/nodeBounds';

interface SelectionGroupBarProps {
  selectedNodes: Node[];
  viewport: { x: number; y: number; zoom: number };
  onGroup: () => void;
}

export function SelectionGroupBar({
  selectedNodes,
  viewport,
  onGroup,
}: SelectionGroupBarProps) {
  const { t } = useTranslation();
  const overlayPosition = useMemo(() => {
    if (selectedNodes.length < 2) {
      return null;
    }

    const bounds = calculateNodesBounds(selectedNodes);
    return {
      x: bounds.centerX * viewport.zoom + viewport.x,
      y: bounds.top * viewport.zoom + viewport.y - 16,
    };
  }, [selectedNodes, viewport]);

  if (!overlayPosition || selectedNodes.length < 2) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute z-[1200]"
      style={{
        left: overlayPosition.x,
        top: overlayPosition.y,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <button
        type="button"
        onClick={onGroup}
        className="flex items-center gap-2 rounded-full border border-accent/40 bg-surface-dark/95 px-3 py-2 text-sm font-medium text-text-dark shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition-colors hover:border-accent/70 hover:bg-accent/10"
      >
        <FolderPlus className="h-4 w-4 text-accent" />
        <span>{t('group.groupSelected', { count: selectedNodes.length })}</span>
      </button>
    </div>
  );
}
