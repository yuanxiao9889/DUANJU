import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioLines,
  ChevronRight,
  GitBranch,
  Image,
  LayoutGrid,
  Link2,
  Sparkles,
  Type,
  Upload,
  Video,
} from 'lucide-react';

import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import {
  isCanvasNodeTypeEnabled,
  nodeCatalog,
} from '@/features/canvas/application/nodeCatalog';
import {
  canvasNodeMenuGroups,
  isNodeTypeAvailableInProject,
  type CanvasNodeDefinition,
  type MenuIconKey,
  type NodeMenuGroupKey,
  type NodeMenuProjectType,
} from '@/features/canvas/domain/nodeRegistry';
import { useProjectStore } from '@/stores/projectStore';

export interface SpecialMenuItem {
  id: string;
  icon: typeof Upload;
  labelKey: string;
  action: 'createBranch';
}

interface NodeSelectionMenuProps {
  position: { x: number; y: number };
  allowedTypes?: CanvasNodeType[];
  onSelect: (type: CanvasNodeType) => void;
  onSpecialAction?: (action: 'createBranch') => void;
  showBranchOption?: boolean;
  onlyBranchOption?: boolean;
  onClose: () => void;
  projectType?: NodeMenuProjectType;
}

interface MenuLeafEntry {
  kind: 'item';
  definition: CanvasNodeDefinition;
}

interface MenuGroupEntry {
  kind: 'group';
  groupId: NodeMenuGroupKey;
  items: CanvasNodeDefinition[];
}

type MenuEntry = MenuLeafEntry | MenuGroupEntry;

const iconMap: Record<MenuIconKey, typeof Upload> = {
  upload: Upload,
  sparkles: Sparkles,
  layout: LayoutGrid,
  link: Link2,
  text: Type,
  video: Video,
  audio: AudioLines,
};

const BRANCH_MENU_ITEM: SpecialMenuItem = {
  id: 'create-branch',
  icon: GitBranch,
  labelKey: 'node.menu.createBranch',
  action: 'createBranch',
};

function renderIcon(iconKey: MenuIconKey) {
  const Icon = iconMap[iconKey] ?? Image;
  return <Icon className="h-4 w-4 text-accent" />;
}

function dedupeMenuDefinitions(definitions: CanvasNodeDefinition[]): CanvasNodeDefinition[] {
  const dedupedByLabel = new Map<string, CanvasNodeDefinition>();

  for (const definition of definitions) {
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
}

function buildMenuEntries(definitions: CanvasNodeDefinition[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const groupedEntries = new Map<NodeMenuGroupKey, MenuGroupEntry>();

  for (const definition of definitions) {
    const groupId = definition.menuGroup;
    if (!groupId) {
      entries.push({
        kind: 'item',
        definition,
      });
      continue;
    }

    let groupEntry = groupedEntries.get(groupId);
    if (!groupEntry) {
      groupEntry = {
        kind: 'group',
        groupId,
        items: [],
      };
      groupedEntries.set(groupId, groupEntry);
      entries.push(groupEntry);
    }

    groupEntry.items.push(definition);
  }

  const normalizedEntries = entries.flatMap((entry) => {
    if (entry.kind === 'group' && entry.items.length === 1) {
      return [{
        kind: 'item' as const,
        definition: entry.items[0],
      }];
    }

    return [entry];
  });

  if (
    normalizedEntries.length === 1
    && normalizedEntries[0].kind === 'group'
  ) {
    return normalizedEntries[0].items.map((definition) => ({
      kind: 'item' as const,
      definition,
    }));
  }

  return normalizedEntries;
}

export function NodeSelectionMenu({
  position,
  allowedTypes,
  onSelect,
  onSpecialAction,
  showBranchOption = false,
  onlyBranchOption = false,
  onClose,
  projectType = 'storyboard',
}: NodeSelectionMenuProps) {
  const { t } = useTranslation();
  const linkedScriptProjectId = useProjectStore(
    (state) => state.currentProject?.linkedScriptProjectId ?? null,
  );
  const linkedAdProjectId = useProjectStore(
    (state) => state.currentProject?.linkedAdProjectId ?? null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef(new Map<NodeMenuGroupKey, HTMLButtonElement>());
  const [isVisible, setIsVisible] = useState(false);
  const [hoveredGroupId, setHoveredGroupId] = useState<NodeMenuGroupKey | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const menuAvailabilityOptions = useMemo(
    () => ({
      linkedScriptProjectId,
      linkedAdProjectId,
    }),
    [linkedAdProjectId, linkedScriptProjectId]
  );

  const allowedTypeSet = useMemo(
    () => (allowedTypes ? new Set(allowedTypes) : null),
    [allowedTypes]
  );

  const menuEntries = useMemo(() => {
    const candidates = !allowedTypeSet || !allowedTypes
      ? nodeCatalog.getMenuDefinitions(projectType, menuAvailabilityOptions)
      : Array.from(new Set(allowedTypes))
        .filter((type) => isNodeTypeAvailableInProject(type, projectType, menuAvailabilityOptions))
        .filter((type) => isCanvasNodeTypeEnabled(type))
        .map((type) => nodeCatalog.getDefinition(type));

    return buildMenuEntries(dedupeMenuDefinitions(candidates));
  }, [allowedTypeSet, allowedTypes, menuAvailabilityOptions, projectType]);

  const hoveredGroupEntry = useMemo(
    () => menuEntries.find((entry): entry is MenuGroupEntry => (
      entry.kind === 'group' && entry.groupId === hoveredGroupId
    )) ?? null,
    [hoveredGroupId, menuEntries]
  );

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  useEffect(() => {
    if (!hoveredGroupId) {
      return;
    }

    const groupStillExists = menuEntries.some((entry) => (
      entry.kind === 'group' && entry.groupId === hoveredGroupId
    ));
    if (!groupStillExists) {
      setHoveredGroupId(null);
    }
  }, [hoveredGroupId, menuEntries]);

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

  const openSubmenu = useCallback((groupId: NodeMenuGroupKey) => {
    const menuElement = menuRef.current;
    const buttonElement = groupButtonRefs.current.get(groupId);
    if (menuElement && buttonElement) {
      const menuRect = menuElement.getBoundingClientRect();
      const buttonRect = buttonElement.getBoundingClientRect();
      setSubmenuTop(Math.max(0, buttonRect.top - menuRect.top - 1));
    }

    setHoveredGroupId(groupId);
  }, []);

  const clearSubmenu = useCallback(() => {
    setHoveredGroupId(null);
  }, []);

  const renderSpecialButton = useCallback((
    item: SpecialMenuItem,
    className: string,
    colorClassName: string,
    delayMs: number
  ) => {
    const SpecialIcon = item.icon;
    return (
      <button
        key={item.id}
        className={className}
        style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
        onMouseEnter={clearSubmenu}
        onClick={() => {
          onSpecialAction?.(item.action);
          handleClose();
        }}
      >
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${colorClassName}`}>
          <SpecialIcon className="h-4 w-4" />
        </div>
        <span className="text-sm text-text-dark">{t(item.labelKey)}</span>
      </button>
    );
  }, [handleClose, isVisible, onSpecialAction, t]);

  const renderLeafButton = useCallback((
    definition: CanvasNodeDefinition,
    delayMs: number
  ) => (
    <button
      key={definition.type}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-bg-dark"
      style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
      onMouseEnter={clearSubmenu}
      onClick={() => {
        onSelect(definition.type);
        handleClose();
      }}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-dark">
        {renderIcon(definition.menuIcon)}
      </div>
      <span className="text-sm text-text-dark">{t(definition.menuLabelKey)}</span>
    </button>
  ), [handleClose, isVisible, onSelect, t]);

  const renderGroupButton = useCallback((
    entry: MenuGroupEntry,
    delayMs: number
  ) => {
    const group = canvasNodeMenuGroups[entry.groupId];
    return (
      <button
        key={entry.groupId}
        ref={(element) => {
          if (element) {
            groupButtonRefs.current.set(entry.groupId, element);
            return;
          }

          groupButtonRefs.current.delete(entry.groupId);
        }}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-bg-dark ${
          hoveredGroupId === entry.groupId ? 'bg-bg-dark' : ''
        }`}
        style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
        onMouseEnter={() => openSubmenu(entry.groupId)}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-dark">
          {renderIcon(group.menuIcon)}
        </div>
        <span className="min-w-0 flex-1 text-sm text-text-dark">{t(group.labelKey)}</span>
        <ChevronRight className="h-4 w-4 text-text-muted" />
      </button>
    );
  }, [hoveredGroupId, isVisible, openSubmenu, t]);

  const specialItemCount = showBranchOption ? 1 : 0;

  return (
    <div
      ref={menuRef}
      className={`
        absolute z-50 transition-opacity duration-150
        ${isVisible ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="relative overflow-visible"
        onMouseLeave={clearSubmenu}
      >
        <div
          className={`
        w-[188px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl
        transition-opacity duration-150
      `}
        >
      {(showBranchOption || onlyBranchOption) && renderSpecialButton(
        BRANCH_MENU_ITEM,
        `flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-bg-dark ${!onlyBranchOption ? 'border-b border-border-dark' : ''}`,
        'bg-purple-500/20 text-purple-400',
        0
      )}

      {!onlyBranchOption && menuEntries.map((entry, index) => {
        const delayMs = (specialItemCount + index) * 30;
        return entry.kind === 'group'
          ? renderGroupButton(entry, delayMs)
          : renderLeafButton(entry.definition, delayMs);
      })}
        </div>

        {!onlyBranchOption && hoveredGroupEntry && (
          <div
            className="absolute left-[calc(100%-1px)] w-[196px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl"
            style={{ top: submenuTop }}
            onMouseEnter={() => setHoveredGroupId(hoveredGroupEntry.groupId)}
          >
            <div className="border-b border-border-dark px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
              {t(canvasNodeMenuGroups[hoveredGroupEntry.groupId].labelKey)}
            </div>
            {hoveredGroupEntry.items.map((definition, index) => (
              <button
                key={definition.type}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-bg-dark"
                style={{ transitionDelay: isVisible ? `${index * 30}ms` : '0ms' }}
                onClick={() => {
                  onSelect(definition.type);
                  handleClose();
                }}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-dark">
                  {renderIcon(definition.menuIcon)}
                </div>
                <span className="text-sm text-text-dark">{t(definition.menuLabelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
