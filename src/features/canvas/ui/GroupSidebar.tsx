import { useMemo, useState } from 'react';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';

interface GroupSidebarProps {
  groups: CanvasNode[];
  selectedGroupId: string | null;
  onLocateGroup: (groupId: string) => void;
  onSelectGroup?: (groupId: string) => void;
}

export function GroupSidebar({
  groups,
  selectedGroupId,
  onLocateGroup,
  onSelectGroup,
}: GroupSidebarProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((left, right) => {
        if (left.position.y !== right.position.y) {
          return left.position.y - right.position.y;
        }
        return left.position.x - right.position.x;
      }),
    [groups]
  );

  if (sortedGroups.length === 0) {
    return null;
  }

  return (
    <aside
      className={`pointer-events-auto absolute left-4 top-4 z-[1100] overflow-hidden rounded-2xl border border-border-dark bg-surface-dark/92 shadow-[0_18px_36px_rgba(0,0,0,0.32)] backdrop-blur ${collapsed ? 'w-[52px]' : 'w-[244px]'}`}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 border-b border-border-dark px-2 py-3">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-accent transition-colors hover:bg-bg-dark hover:text-accent"
            title={t('group.expandSidebar')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-border-dark px-3 py-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-accent" />
            <div>
              <div className="text-sm font-medium text-text-dark">{t('group.sidebarTitle')}</div>
              <div className="text-[11px] text-text-muted">{t('group.sidebarCount', { count: sortedGroups.length })}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
            title={t('group.collapseSidebar')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="max-h-[calc(100vh-140px)] overflow-y-auto px-2 py-2 ui-scrollbar">
          {sortedGroups.map((group) => {
            const groupName = resolveNodeDisplayName(CANVAS_NODE_TYPES.group, group.data);
            const isActive = selectedGroupId === group.id;

            return (
              <div
                key={group.id}
                className={`flex items-center gap-2 rounded-xl px-2 py-2 transition-colors ${isActive ? 'bg-accent/12' : 'hover:bg-bg-dark/80'}`}
              >
                <button
                  type="button"
                  onClick={() => onLocateGroup(group.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent transition-colors hover:bg-accent/20"
                  title={t('group.locate')}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectGroup?.(group.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium text-text-dark">{groupName}</div>
                  <div className="truncate text-[11px] text-text-muted">
                    {Math.round(group.position.x)}, {Math.round(group.position.y)}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
