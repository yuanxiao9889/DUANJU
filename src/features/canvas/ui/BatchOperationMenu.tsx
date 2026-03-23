import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, LayoutGrid, Sparkles, Type, Upload, Video, X } from 'lucide-react';

import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import type { MenuIconKey } from '@/features/canvas/domain/nodeRegistry';

interface BatchOperationMenuProps {
  position: { x: number; y: number };
  sourceNodeIds: string[];
  sourceNodeType: string;
  onSelectNodeType: (nodeType: CanvasNodeType) => void;
  onClose: () => void;
}

const iconMap: Record<MenuIconKey, typeof Upload> = {
  upload: Upload,
  sparkles: Sparkles,
  layout: LayoutGrid,
  text: Type,
  video: Video,
};

const sourceTypeLabelKeyMap: Partial<Record<CanvasNodeType, string>> = {
  [CANVAS_NODE_TYPES.upload]: 'node.menu.uploadImage',
  [CANVAS_NODE_TYPES.imageEdit]: 'node.menu.aiImageGeneration',
  [CANVAS_NODE_TYPES.storyboardGen]: 'node.menu.storyboardGen',
  [CANVAS_NODE_TYPES.storyboardSplit]: 'node.menu.storyboard',
  [CANVAS_NODE_TYPES.textAnnotation]: 'node.menu.textAnnotation',
  [CANVAS_NODE_TYPES.video]: 'node.menu.videoNode',
};

export function BatchOperationMenu({
  position,
  sourceNodeIds,
  sourceNodeType,
  onSelectNodeType,
  onClose,
}: BatchOperationMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const menuItems = useMemo(() => {
    const candidates = nodeCatalog.getMenuDefinitions();
    const dedupedByLabel = new Map<string, typeof candidates[number]>();

    for (const definition of candidates) {
      const existing = dedupedByLabel.get(definition.menuLabelKey);
      if (!existing || (!existing.visibleInMenu && definition.visibleInMenu)) {
        dedupedByLabel.set(definition.menuLabelKey, definition);
      }
    }

    return Array.from(dedupedByLabel.values());
  }, []);

  const sourceNodeLabel = t(
    sourceTypeLabelKeyMap[sourceNodeType as CanvasNodeType] ?? 'canvas.batchMenu.node'
  );

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, UI_POPOVER_TRANSITION_MS);
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        handleClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [handleClose]);

  return (
    <div
      ref={menuRef}
      className={`
        absolute z-50 min-w-[220px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl
        transition-opacity duration-150
        ${isVisible ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ left: position.x, top: position.y, transform: 'translate(-50%, 10px)' }}
    >
      <div className="flex items-center justify-between border-b border-border-dark px-4 py-3">
        <span className="text-xs text-text-muted">
          {t('canvas.batchMenu.referenceSelected', {
            count: sourceNodeIds.length,
            type: sourceNodeLabel,
          })}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="rounded p-1 text-text-muted hover:bg-bg-dark"
        >
          <X style={{ width: '14px', height: '14px' }} />
        </button>
      </div>

      <div className="py-1">
        {menuItems.map((item, index) => {
          const Icon = iconMap[item.menuIcon] ?? Image;

          return (
            <button
              key={item.type}
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark"
              style={{ transitionDelay: isVisible ? `${index * 30}ms` : '0ms' }}
              onClick={() => {
                onSelectNodeType(item.type);
                handleClose();
              }}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-dark">
                <Icon className="h-4 w-4 text-accent" />
              </div>
              <span className="text-sm text-text-dark">{t(item.menuLabelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
