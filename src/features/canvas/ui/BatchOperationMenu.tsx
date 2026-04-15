import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioLines,
  ChevronRight,
  Image,
  LayoutGrid,
  Sparkles,
  Type,
  Upload,
  Video,
  X,
} from 'lucide-react';

import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import {
  canvasNodeMenuGroups,
  type CanvasNodeDefinition,
  type MenuIconKey,
  type NodeMenuGroupKey,
  type NodeMenuProjectType,
} from '@/features/canvas/domain/nodeRegistry';
import { useProjectStore } from '@/stores/projectStore';

interface BatchOperationMenuProps {
  position: { x: number; y: number };
  sourceNodeIds: string[];
  sourceNodeType: string;
  onSelectNodeType: (nodeType: CanvasNodeType) => void;
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
  text: Type,
  video: Video,
  audio: AudioLines,
};

const sourceTypeLabelKeyMap: Partial<Record<CanvasNodeType, string>> = {
  [CANVAS_NODE_TYPES.upload]: 'node.menu.uploadImage',
  [CANVAS_NODE_TYPES.imageEdit]: 'node.menu.aiImageGeneration',
  [CANVAS_NODE_TYPES.storyboardGen]: 'node.menu.storyboardGen',
  [CANVAS_NODE_TYPES.storyboardSplit]: 'node.menu.storyboardCompose',
  [CANVAS_NODE_TYPES.storyboardSplitResult]: 'node.menu.storyboardSplitResult',
  [CANVAS_NODE_TYPES.textAnnotation]: 'node.menu.textAnnotation',
  [CANVAS_NODE_TYPES.ttsText]: 'node.menu.ttsText',
  [CANVAS_NODE_TYPES.scriptText]: 'node.menu.scriptText',
  [CANVAS_NODE_TYPES.scriptChapter]: 'node.menu.scriptChapter',
  [CANVAS_NODE_TYPES.video]: 'node.menu.videoNode',
  [CANVAS_NODE_TYPES.audio]: 'node.menu.audioNode',
};

function dedupeMenuDefinitions(definitions: CanvasNodeDefinition[]): CanvasNodeDefinition[] {
  const dedupedByLabel = new Map<string, CanvasNodeDefinition>();

  for (const definition of definitions) {
    const existing = dedupedByLabel.get(definition.menuLabelKey);
    if (!existing || (!existing.visibleInMenu && definition.visibleInMenu)) {
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

  return entries.flatMap((entry) => {
    if (entry.kind === 'group' && entry.items.length === 1) {
      return [{
        kind: 'item' as const,
        definition: entry.items[0],
      }];
    }

    return [entry];
  });
}

export function BatchOperationMenu({
  position,
  sourceNodeIds,
  sourceNodeType,
  onSelectNodeType,
  onClose,
  projectType = 'storyboard',
}: BatchOperationMenuProps) {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.currentProject);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef(new Map<NodeMenuGroupKey, HTMLButtonElement>());
  const [isVisible, setIsVisible] = useState(false);
  const [hoveredGroupId, setHoveredGroupId] = useState<NodeMenuGroupKey | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const menuAvailabilityOptions = useMemo(
    () => ({
      linkedScriptProjectId: currentProject?.linkedScriptProjectId ?? null,
    }),
    [currentProject?.linkedScriptProjectId]
  );

  const menuEntries = useMemo(() => {
    const candidates = nodeCatalog.getMenuDefinitions(projectType, menuAvailabilityOptions);
    return buildMenuEntries(dedupeMenuDefinitions(candidates));
  }, [menuAvailabilityOptions, projectType]);

  const hoveredGroupEntry = useMemo(
    () => menuEntries.find((entry): entry is MenuGroupEntry => (
      entry.kind === 'group' && entry.groupId === hoveredGroupId
    )) ?? null,
    [hoveredGroupId, menuEntries]
  );

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
        absolute z-50 transition-opacity duration-150
        ${isVisible ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ left: position.x, top: position.y, transform: 'translate(-50%, 10px)' }}
    >
      <div className="relative overflow-visible" onMouseLeave={clearSubmenu}>
        <div
          className={`
            min-w-[220px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl
        transition-opacity duration-150
      `}
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
          {menuEntries.map((entry, index) => {
            if (entry.kind === 'item') {
              const Icon = iconMap[entry.definition.menuIcon] ?? Image;
              return (
                <button
                  key={entry.definition.type}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark"
                  style={{ transitionDelay: isVisible ? `${index * 30}ms` : '0ms' }}
                  onMouseEnter={clearSubmenu}
                  onClick={() => {
                    onSelectNodeType(entry.definition.type);
                    handleClose();
                  }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-dark">
                    <Icon className="h-4 w-4 text-accent" />
                  </div>
                  <span className="text-sm text-text-dark">{t(entry.definition.menuLabelKey)}</span>
                </button>
              );
            }

            const group = canvasNodeMenuGroups[entry.groupId];
            const Icon = iconMap[group.menuIcon] ?? Image;
            return (
              <button
                key={entry.groupId}
                type="button"
                ref={(element) => {
                  if (element) {
                    groupButtonRefs.current.set(entry.groupId, element);
                    return;
                  }

                  groupButtonRefs.current.delete(entry.groupId);
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark ${
                  hoveredGroupId === entry.groupId ? 'bg-bg-dark' : ''
                }`}
                style={{ transitionDelay: isVisible ? `${index * 30}ms` : '0ms' }}
                onMouseEnter={() => openSubmenu(entry.groupId)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-dark">
                  <Icon className="h-4 w-4 text-accent" />
                </div>
                <span className="min-w-0 flex-1 text-sm text-text-dark">{t(group.labelKey)}</span>
                <ChevronRight className="h-4 w-4 text-text-muted" />
              </button>
            );
          })}
        </div>
        </div>

        {hoveredGroupEntry ? (
          <div
            className="absolute left-[calc(100%-1px)] w-[196px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl"
            style={{ top: submenuTop }}
            onMouseEnter={() => setHoveredGroupId(hoveredGroupEntry.groupId)}
          >
            <div className="border-b border-border-dark px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
              {t(canvasNodeMenuGroups[hoveredGroupEntry.groupId].labelKey)}
            </div>
            {hoveredGroupEntry.items.map((definition, index) => {
              const Icon = iconMap[definition.menuIcon] ?? Image;
              return (
                <button
                  key={definition.type}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-dark"
                  style={{ transitionDelay: isVisible ? `${index * 30}ms` : '0ms' }}
                  onClick={() => {
                    onSelectNodeType(definition.type);
                    handleClose();
                  }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-dark">
                    <Icon className="h-4 w-4 text-accent" />
                  </div>
                  <span className="text-sm text-text-dark">{t(definition.menuLabelKey)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
