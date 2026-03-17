import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Lock,
  Unlock,
  Trash2,
  FileText,
  Download,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { BranchSelectionDialog } from './ui/BranchSelectionDialog';

interface CanvasToolbarProps {
  isLocked: boolean;
  onToggleLock: () => void;
}

export const CanvasToolbar = memo(({ isLocked, onToggleLock }: CanvasToolbarProps) => {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const addNode = useCanvasStore((state) => state.addNode);
  const clearCanvas = useCanvasStore((state) => state.clearCanvas);
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

      {projectType === 'script' && (
        <>
          <button
            onClick={() => setShowExportDialog(true)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
            title="导出剧本"
          >
            <Download className="h-4 w-4" />
            导出
          </button>
          <div className="h-6 w-px bg-border-dark" />
        </>
      )}

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
        {isLocked ? <Lock className="h-4 w-4 text-accent" /> : <Unlock className="h-4 w-4 text-text-muted" />}
      </button>

      <button
        onClick={clearCanvas}
        disabled={isLocked}
        className="rounded p-1.5 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        title={t('common.delete')}
      >
        <Trash2 className="h-4 w-4 text-red-500" />
      </button>

      <BranchSelectionDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
    </div>
  );
});

CanvasToolbar.displayName = 'CanvasToolbar';
