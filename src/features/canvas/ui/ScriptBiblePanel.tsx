import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { useReactFlow } from '@xyflow/react';
import { ChevronLeft, ChevronRight, Download, FilePlus, FileText, FolderTree, Package, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';
import { PlotTreeView } from './PlotTreeView';
import { ScriptImportDialog } from './ScriptImportDialog';
import { BranchSelectionDialog } from './BranchSelectionDialog';
import {
  buildDefaultScriptProjectPackageFileName,
  exportScriptProjectPackageBundle,
} from '../application/scriptProjectPackage';
import {
  CANVAS_NODE_TYPES,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
} from '../domain/canvasNodes';

const SCRIPT_BIBLE_PANEL_WIDTH_STORAGE_KEY = 'script-bible-panel-width';
const SCRIPT_BIBLE_PANEL_COLLAPSED_STORAGE_KEY = 'script-bible-panel-collapsed';
const SCRIPT_BIBLE_PANEL_DEFAULT_WIDTH = 272;
const SCRIPT_BIBLE_PANEL_MIN_WIDTH = 220;
const SCRIPT_BIBLE_PANEL_MAX_WIDTH = 420;
const SCRIPT_BIBLE_PANEL_COLLAPSED_WIDTH = 52;

function clampPanelWidth(value: number): number {
  return Math.min(
    SCRIPT_BIBLE_PANEL_MAX_WIDTH,
    Math.max(SCRIPT_BIBLE_PANEL_MIN_WIDTH, Math.round(value))
  );
}

function readPanelWidth(): number {
  if (typeof window === 'undefined') {
    return SCRIPT_BIBLE_PANEL_DEFAULT_WIDTH;
  }

  const raw = Number(window.localStorage.getItem(SCRIPT_BIBLE_PANEL_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) {
    return SCRIPT_BIBLE_PANEL_DEFAULT_WIDTH;
  }

  return clampPanelWidth(raw);
}

function readPanelCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(SCRIPT_BIBLE_PANEL_COLLAPSED_STORAGE_KEY) === 'true';
}

export function ScriptBiblePanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.getCurrentProject());
  const {
    nodes,
    edges,
    addNode,
    currentViewport,
    history,
    selectedNodeId,
    setSelectedNode,
  } = useCanvasStore();
  const focusChapter = useScriptEditorStore((state) => state.focusChapter);
  const { setCenter } = useReactFlow();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => readPanelWidth());
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => readPanelCollapsed());
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const panelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const projectType = currentProject?.projectType;
  const rootNode = useMemo(() => (
    nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot) as
      | { id: string; data: ScriptRootNodeData; position: { x: number; y: number } }
      | undefined
  ), [nodes]);
  const chapters = useMemo(() => (
    nodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.scriptChapter)
      .map((node) => ({
        id: node.id,
        data: node.data as ScriptChapterNodeData,
        position: node.position,
      }))
      .sort((left, right) => (left.data.chapterNumber || 0) - (right.data.chapterNumber || 0))
  ), [nodes]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SCRIPT_BIBLE_PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SCRIPT_BIBLE_PANEL_COLLAPSED_STORAGE_KEY,
      isPanelCollapsed ? 'true' : 'false'
    );
  }, [isPanelCollapsed]);

  useEffect(() => {
    if (!isPanelResizing || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = panelResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      setPanelWidth(clampPanelWidth(resizeState.startWidth + (event.clientX - resizeState.startX)));
    };

    const handlePointerUp = () => {
      panelResizeStateRef.current = null;
      setIsPanelResizing(false);
    };

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('selectstart', handleSelectStart);
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('selectstart', handleSelectStart);
    };
  }, [isPanelResizing]);

  const handleNodeClick = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return;
    }

    setSelectedNode(nodeId);
    if (node.type === CANVAS_NODE_TYPES.scriptChapter) {
      focusChapter(node.id);
    }

    const nodeWidth = node.measured?.width ?? 220;
    const nodeHeight = node.measured?.height ?? 160;
    setCenter(
      node.position.x + nodeWidth / 2,
      node.position.y + nodeHeight / 2,
      { zoom: 1, duration: 300 }
    );
  }, [focusChapter, nodes, setCenter, setSelectedNode]);

  const handleAddChapter = useCallback(() => {
    const createdNodeId = addNode(
      CANVAS_NODE_TYPES.scriptChapter,
      { x: 180, y: 120 + chapters.length * 220 },
      { chapterNumber: chapters.length + 1 }
    );
    handleNodeClick(createdNodeId);
  }, [addNode, chapters.length, handleNodeClick]);

  const handleExportNativePackage = useCallback(async () => {
    const rootTitle = rootNode?.data.title?.trim() || 'Untitled Script';
    const selectedPath = await save({
      defaultPath: buildDefaultScriptProjectPackageFileName(rootTitle),
      filters: [{ name: 'Script Project Package', extensions: ['scpkg'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await exportScriptProjectPackageBundle(selectedPath, {
      currentProject,
      nodes: nodes as any,
      edges: edges as any,
      viewport: currentViewport,
      history,
      selectedNodeId,
    });
  }, [currentProject, currentViewport, edges, history, nodes, rootNode, selectedNodeId]);

  if (projectType !== 'script') {
    return null;
  }

  if (isPanelCollapsed) {
    return (
      <div
        className="flex h-full shrink-0 flex-col border-r border-border-dark bg-surface-dark transition-all duration-300"
        style={{ width: SCRIPT_BIBLE_PANEL_COLLAPSED_WIDTH }}
      >
        <button
          type="button"
          onClick={() => setIsPanelCollapsed(false)}
          className="flex flex-col items-center justify-center px-1 py-4 transition-colors hover:bg-bg-dark group"
          title={t('script.scriptCatalog.panelExpand')}
        >
          <ChevronRight className="h-5 w-5 text-text-muted transition-colors group-hover:text-text-dark" />
          <FolderTree className="mt-2 h-4 w-4 text-text-dark" />
          <span className="mt-1 text-xs text-text-muted">{t('script.scriptCatalog.shortTitle')}</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      className={`relative h-full shrink-0 border-r border-border-dark bg-surface-dark ${
        isPanelResizing ? 'transition-none' : 'transition-[width] duration-300'
      }`}
      style={{ width: panelWidth }}
    >
      <div
        className="absolute right-0 top-0 z-10 h-full w-[4px] translate-x-full cursor-col-resize touch-none transition-colors hover:bg-[rgba(15,23,42,0.16)] dark:hover:bg-white/16"
        onPointerDown={(event) => {
          event.preventDefault();
          panelResizeStateRef.current = {
            startX: event.clientX,
            startWidth: panelWidth,
          };
          setIsPanelResizing(true);
        }}
      />

      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-dark px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 text-text-dark" />
            <span className="truncate text-sm font-semibold text-text-dark">
              {t('script.scriptCatalog.title')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleAddChapter}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
              title={t('script.scriptCatalog.addChapter')}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowExportDialog(true)}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
              title={t('script.scriptCatalog.export')}
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleExportNativePackage}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
              title={t('scriptExportDialog.exportPackage')}
            >
              <Package className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowImportDialog(true)}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
              title={t('scriptImportDialog.title')}
            >
              <FilePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsPanelCollapsed(true)}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
              title={t('script.scriptCatalog.panelCollapse')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        <UiScrollArea
          className="flex-1"
          viewportClassName="h-full"
          contentClassName="space-y-4 p-3"
        >
          <div className="rounded-2xl border border-border-dark bg-bg-dark/35 p-3">
            <div className="text-sm font-semibold text-text-dark">
              {rootNode?.data.title || t('script.scriptCatalog.defaultScriptTitle')}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
              <span className="rounded-full bg-bg-dark px-2.5 py-1">
                {t('script.scriptCatalog.chapterCount', { count: chapters.length })}
              </span>
              {rootNode?.data.genre ? (
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {rootNode.data.genre}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-border-dark bg-surface-dark/80">
            <div className="border-b border-border-dark/80 px-4 py-3">
              <div className="text-sm font-semibold text-text-dark">
                {t('script.scriptCatalog.directoryTitle')}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-muted">
                {t('script.scriptCatalog.directorySubtitle')}
              </div>
            </div>
            <div className="px-2 py-2">
              <PlotTreeView chapters={chapters} onNodeClick={handleNodeClick} />
            </div>
          </div>
        </UiScrollArea>

        {showImportDialog ? (
          <ScriptImportDialog
            isOpen={showImportDialog}
            onClose={() => setShowImportDialog(false)}
          />
        ) : null}

        {showExportDialog ? (
          <BranchSelectionDialog
            isOpen={showExportDialog}
            onClose={() => setShowExportDialog(false)}
          />
        ) : null}
      </div>
    </aside>
  );
}
