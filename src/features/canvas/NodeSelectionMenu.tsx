import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Upload, Sparkles, LayoutGrid, Type, GitBranch } from 'lucide-react';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';

import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import type { MenuIconKey } from '@/features/canvas/domain/nodeRegistry';

export interface SpecialMenuItem {
  id: string;
  icon: typeof Upload;
  labelKey: string;
  action: 'createBranch' | 'createSupplement';
}

interface NodeSelectionMenuProps {
  position: { x: number; y: number };
  allowedTypes?: CanvasNodeType[];
  onSelect: (type: CanvasNodeType) => void;
  onSpecialAction?: (action: 'createBranch' | 'createSupplement') => void;
  showBranchOption?: boolean;
  onlyBranchOption?: boolean;
  showSupplementOption?: boolean;
  onlySupplementOption?: boolean;
  onClose: () => void;
  projectType?: 'storyboard' | 'script';
}

const iconMap: Record<MenuIconKey, typeof Upload> = {
  upload: Upload,
  sparkles: Sparkles,
  layout: LayoutGrid,
  text: Type,
};

const BRANCH_MENU_ITEM: SpecialMenuItem = {
  id: 'create-branch',
  icon: GitBranch,
  labelKey: 'node.menu.createBranch',
  action: 'createBranch',
};

const SUPPLEMENT_MENU_ITEM: SpecialMenuItem = {
  id: 'create-supplement',
  icon: Sparkles,
  labelKey: 'node.menu.createSupplement',
  action: 'createSupplement',
};

export function NodeSelectionMenu({
  position,
  allowedTypes,
  onSelect,
  onSpecialAction,
  showBranchOption = false,
  onlyBranchOption = false,
  showSupplementOption = false,
  onlySupplementOption = false,
  onClose,
  projectType = 'storyboard',
}: NodeSelectionMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const allowedTypeSet = useMemo(
    () => (allowedTypes ? new Set(allowedTypes) : null),
    [allowedTypes]
  );

  const menuItems = useMemo(() => {
    const candidates = !allowedTypeSet || !allowedTypes
      ? nodeCatalog.getMenuDefinitions()
      : Array.from(new Set(allowedTypes)).map((type) => nodeCatalog.getDefinition(type));

    const filteredCandidates = candidates.filter((item) => {
      if (projectType === 'script') {
        return item.menuLabelKey !== 'node.generateImage';
      }
      return true;
    });

    const dedupedByLabel = new Map<string, typeof filteredCandidates[number]>();
    for (const definition of filteredCandidates) {
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
  }, [allowedTypeSet, allowedTypes, projectType]);

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
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      handleClose();
    };

    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
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
      style={{ left: position.x, top: position.y }}
    >
      {(showBranchOption || onlyBranchOption) && (
        <button
          key={BRANCH_MENU_ITEM.id}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark ${!onlyBranchOption ? 'border-b border-border-dark' : ''}`}
          style={{ transitionDelay: isVisible ? '0ms' : '0ms' }}
          onClick={() => {
            onSpecialAction?.(BRANCH_MENU_ITEM.action);
            handleClose();
          }}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-500/20">
            <BRANCH_MENU_ITEM.icon className="h-4 w-4 text-purple-400" />
          </div>
          <span className="text-sm text-text-dark">{t(BRANCH_MENU_ITEM.labelKey)}</span>
        </button>
      )}
      {(showSupplementOption || onlySupplementOption) && (
        <button
          key={SUPPLEMENT_MENU_ITEM.id}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark ${!onlySupplementOption ? 'border-b border-border-dark' : ''}`}
          style={{ transitionDelay: isVisible ? `${(showBranchOption ? 1 : 0) * 30}ms` : '0ms' }}
          onClick={() => {
            onSpecialAction?.(SUPPLEMENT_MENU_ITEM.action);
            handleClose();
          }}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/20">
            <SUPPLEMENT_MENU_ITEM.icon className="h-4 w-4 text-green-400" />
          </div>
          <span className="text-sm text-text-dark">{t(SUPPLEMENT_MENU_ITEM.labelKey)}</span>
        </button>
      )}
      {!onlyBranchOption && !onlySupplementOption && menuItems.map((item, index) => {
        const Icon = iconMap[item.menuIcon] ?? Image;
        return (
          <button
            key={item.type}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark"
            style={{ transitionDelay: isVisible ? `${((showBranchOption ? 1 : 0) + (showSupplementOption ? 1 : 0) + index) * 30}ms` : '0ms' }}
            onClick={() => {
              onSelect(item.type);
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
  );
}
