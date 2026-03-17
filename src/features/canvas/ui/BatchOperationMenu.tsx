import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Upload, Sparkles, LayoutGrid, Type, X } from 'lucide-react';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';

import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
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
      if (!existing) {
        dedupedByLabel.set(definition.menuLabelKey, definition);
        continue;
      }

      if (!existing.visibleInMenu && definition.visibleInMenu) {
        dedupedByLabel.set(definition.menuLabelKey, definition);
      }
    }

    return Array.from(dedupedByLabel.values());
  }, []);

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
    const handleClickOutside = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  const nodeTypeLabel = sourceNodeType === 'imageNode' ? '图片' 
    : sourceNodeType === 'textNode' ? '文本' 
    : '节点';

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
          引用选中的 {sourceNodeIds.length} 个{nodeTypeLabel}节点生成
        </span>
        <button
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
