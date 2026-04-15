import { memo, useCallback, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import {
  Download,
  FileText,
  Lock,
  Maximize2,
  Package,
  Plus,
  Trash2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import {
  buildDefaultScriptProjectPackageFileName,
  exportScriptProjectPackageBundle,
} from '@/features/canvas/application/scriptProjectPackage';
import { BranchSelectionDialog } from '@/features/canvas/ui/BranchSelectionDialog';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

interface CanvasToolbarProps {
  isLocked: boolean;
  onToggleLock: () => void;
}

export const CanvasToolbar = memo(({ isLocked, onToggleLock }: CanvasToolbarProps) => {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const addNode = useCanvasStore((state) => state.addNode);
  const clearCanvas = useCanvasStore((state) => state.clearCanvas);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const currentViewport = useCanvasStore((state) => state.currentViewport);
  const history = useCanvasStore((state) => state.history);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const currentProject = useProjectStore((state) => state.getCurrentProject());
  const [showExportDialog, setShowExportDialog] = useState(false);

  const projectType = currentProject?.projectType;

  const handleAddImageNode = useCallback(() => {
    const x = Math.random() * 320 + 120;
    const y = Math.random() * 260 + 120;
    addNode(CANVAS_NODE_TYPES.imageEdit, { x, y });
  }, [addNode]);

  const handleAddChapterNode = useCallback(() => {
    const x = Math.random() * 320 + 120;
    const y = Math.random() * 260 + 120;
    addNode(CANVAS_NODE_TYPES.scriptChapter, { x, y });
  }, [addNode]);

  const handleAddRootNode = useCallback(() => {
    const x = 50;
    const y = Math.random() * 260 + 120;
    addNode(CANVAS_NODE_TYPES.scriptRoot, { x, y });
  }, [addNode]);

  const handleExportNativePackage = useCallback(async () => {
    const rootTitle = (nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot)?.data as {
      title?: string;
    } | undefined)?.title?.trim() || 'Untitled Script';
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
  }, [currentProject, currentViewport, edges, history, nodes, selectedNodeId]);

  return (
    <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border-dark bg-surface-dark px-2 py-1.5 shadow-lg">
      {projectType === 'script' ? (
        <>
          <button
            onClick={handleAddRootNode}
            disabled={isLocked}
            className={`
              flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200
              ${
                isLocked
                  ? 'cursor-not-allowed bg-border-dark text-text-muted'
                  : 'bg-amber-500 text-white hover:bg-amber-500/80'
              }
            `}
          >
            <FileText className="h-4 w-4" />
            新建剧本
          </button>

          <button
            onClick={handleAddChapterNode}
            disabled={isLocked}
            className={`
              flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200
              ${
                isLocked
                  ? 'cursor-not-allowed bg-border-dark text-text-muted'
                  : 'bg-amber-500/80 text-white hover:bg-amber-500/70'
              }
            `}
          >
            <Plus className="h-4 w-4" />
            添加章节
          </button>
        </>
      ) : (
        <button
          onClick={handleAddImageNode}
          disabled={isLocked}
          className={`
            flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200
            ${
              isLocked
                ? 'cursor-not-allowed bg-border-dark text-text-muted'
                : 'bg-accent text-white hover:bg-accent/80'
            }
          `}
        >
          <Plus className="h-4 w-4" />
          {t('canvas.addImage')}
        </button>
      )}

      <div className="h-6 w-px bg-border-dark" />

      {projectType === 'script' ? (
        <>
          <button
            onClick={() => setShowExportDialog(true)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
            title={t('scriptExportDialog.exportScript')}
          >
            <Download className="h-4 w-4" />
            {t('scriptExportDialog.exportScript')}
          </button>
          <button
            onClick={handleExportNativePackage}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
            title={t('scriptExportDialog.exportPackage')}
          >
            <Package className="h-4 w-4" />
            {t('scriptExportDialog.exportPackage')}
          </button>
          <div className="h-6 w-px bg-border-dark" />
        </>
      ) : null}

      <button
        onClick={() => zoomIn()}
        disabled={isLocked}
        className="rounded p-1.5 transition-colors hover:bg-bg-dark disabled:opacity-50"
        title={t('canvas.toolbar.zoomIn')}
      >
        <ZoomIn className="h-4 w-4 text-text-muted" />
      </button>

      <button
        onClick={() => zoomOut()}
        disabled={isLocked}
        className="rounded p-1.5 transition-colors hover:bg-bg-dark disabled:opacity-50"
        title={t('canvas.toolbar.zoomOut')}
      >
        <ZoomOut className="h-4 w-4 text-text-muted" />
      </button>

      <button
        onClick={() => fitView({ padding: 0.2 })}
        className="rounded p-1.5 transition-colors hover:bg-bg-dark"
        title={t('canvas.toolbar.fitView')}
      >
        <Maximize2 className="h-4 w-4 text-text-muted" />
      </button>

      <div className="h-6 w-px bg-border-dark" />

      <button
        onClick={onToggleLock}
        className="rounded p-1.5 transition-colors hover:bg-bg-dark"
        title={isLocked ? t('canvas.toolbar.unlock') : t('canvas.toolbar.lock')}
      >
        {isLocked ? (
          <Lock className="h-4 w-4 text-accent" />
        ) : (
          <Unlock className="h-4 w-4 text-text-muted" />
        )}
      </button>

      <button
        onClick={clearCanvas}
        disabled={isLocked}
        className="rounded p-1.5 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        title={t('common.delete')}
      >
        <Trash2 className="h-4 w-4 text-red-500" />
      </button>

      {showExportDialog ? (
        <BranchSelectionDialog
          isOpen={showExportDialog}
          onClose={() => setShowExportDialog(false)}
        />
      ) : null}
    </div>
  );
});

CanvasToolbar.displayName = 'CanvasToolbar';
