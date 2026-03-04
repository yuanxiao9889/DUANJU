import { useMemo, useState, useEffect, useCallback } from 'react';

import { isExportImageNode, isImageEditNode, isUploadNode } from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import {
  canvasEventBus,
  canvasToolProcessor,
} from '@/features/canvas/application/canvasServices';
import { prepareNodeImage, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { readStoryboardImageMetadata } from '@/commands/image';
import { getToolPlugin, type ToolOptions } from '@/features/canvas/tools';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiButton, UiModal } from '@/components/ui';
import { FormToolEditor } from './tool-editors/FormToolEditor';
import { CropToolEditor } from './tool-editors/CropToolEditor';
import { AnnotateToolEditor } from './tool-editors/AnnotateToolEditor';
import { SplitStoryboardToolEditor } from './tool-editors/SplitStoryboardToolEditor';

export function NodeToolDialog() {
  const activeToolDialog = useCanvasStore((state) => state.activeToolDialog);
  const nodes = useCanvasStore((state) => state.nodes);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addStoryboardSplitNode = useCanvasStore((state) => state.addStoryboardSplitNode);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ToolOptions>({});
  const [isSplitImageReady, setIsSplitImageReady] = useState(true);

  const sourceNode = useMemo(() => {
    if (!activeToolDialog) {
      return null;
    }

    return nodes.find((node) => node.id === activeToolDialog.nodeId) ?? null;
  }, [activeToolDialog, nodes]);

  const sourceImageUrl = useMemo(() => {
    if (!sourceNode) {
      return null;
    }

    if (isUploadNode(sourceNode) || isImageEditNode(sourceNode) || isExportImageNode(sourceNode)) {
      return sourceNode.data.imageUrl;
    }

    return null;
  }, [sourceNode]);

  const activePlugin = useMemo(() => {
    if (!activeToolDialog) {
      return null;
    }

    return getToolPlugin(activeToolDialog.toolType);
  }, [activeToolDialog]);

  const dialogKey = activeToolDialog
    ? `${activeToolDialog.nodeId}:${activeToolDialog.toolType}`
    : null;

  useEffect(() => {
    if (!sourceNode || !activePlugin) {
      return;
    }

    let cancelled = false;
    setError(null);
    const initialOptions = activePlugin.createInitialOptions(sourceNode);
    setOptions(initialOptions);

    if (activePlugin.editor !== 'split' || !sourceImageUrl) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const metadata = await readStoryboardImageMetadata(sourceImageUrl);
        if (!metadata || cancelled) {
          return;
        }

        const nextRows = Math.max(1, Math.min(8, Math.floor(metadata.gridRows)));
        const nextCols = Math.max(1, Math.min(8, Math.floor(metadata.gridCols)));
        if (!Number.isFinite(nextRows) || !Number.isFinite(nextCols)) {
          return;
        }

        setOptions((previous) => ({
          ...previous,
          rows: nextRows,
          cols: nextCols,
        }));
      } catch (error) {
        console.warn('[StoryboardMetadata] read failed on split dialog init', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dialogKey, sourceNode, activePlugin, sourceImageUrl]);

  useEffect(() => {
    const requiresSplitPreload = activePlugin?.editor === 'split' && Boolean(sourceImageUrl);
    if (!requiresSplitPreload || !sourceImageUrl) {
      setIsSplitImageReady(true);
      return;
    }

    let cancelled = false;
    const image = new Image();
    const displayImageUrl = resolveImageDisplayUrl(sourceImageUrl);

    setIsSplitImageReady(false);

    image.onload = () => {
      if (cancelled) {
        return;
      }
      setIsSplitImageReady(true);
    };

    image.onerror = () => {
      if (cancelled) {
        return;
      }
      setIsSplitImageReady(true);
    };

    image.src = displayImageUrl;
    if (image.complete) {
      setIsSplitImageReady(true);
    }

    return () => {
      cancelled = true;
    };
  }, [activePlugin?.editor, sourceImageUrl]);

  const closeDialog = useCallback(() => {
    canvasEventBus.publish('tool-dialog/close', undefined);
  }, []);

  const handleApply = useCallback(async () => {
    if (!activeToolDialog || !sourceNode || !sourceImageUrl || !activePlugin) {
      setError('当前节点没有可处理的图片');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await activePlugin.execute(sourceImageUrl, options, {
        processTool: (toolType, imageUrl, toolOptions) =>
          canvasToolProcessor.process(toolType, imageUrl, toolOptions),
      });

      if (result.storyboardFrames && result.rows && result.cols) {
        addStoryboardSplitNode(
          sourceNode.id,
          result.rows,
          result.cols,
          result.storyboardFrames,
          result.frameAspectRatio
        );
      } else if (result.outputImageUrl) {
        const prepared = await prepareNodeImage(result.outputImageUrl);
        addDerivedExportNode(
          sourceNode.id,
          prepared.imageUrl,
          prepared.aspectRatio,
          prepared.previewImageUrl,
          {
            defaultTitle: EXPORT_RESULT_DISPLAY_NAME.generic,
            resultKind: 'generic',
          }
        );
      }

      closeDialog();
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '处理失败');
    } finally {
      setIsProcessing(false);
    }
  }, [
    activeToolDialog,
    sourceNode,
    sourceImageUrl,
    activePlugin,
    options,
    addStoryboardSplitNode,
    addDerivedExportNode,
    closeDialog,
  ]);

  const widthClassName = useMemo(() => {
    if (!activePlugin) {
      return 'w-[460px]';
    }
    if (activePlugin.editor === 'crop') {
      return 'w-[980px]';
    }
    if (activePlugin.editor === 'annotate') {
      return 'w-[1120px]';
    }
    if (activePlugin.editor === 'split') {
      return 'w-[1120px]';
    }
    return 'w-[460px]';
  }, [activePlugin]);

  const editorContent = useMemo(() => {
    if (!activePlugin) {
      return null;
    }

    if (activePlugin.editor === 'crop' && sourceImageUrl) {
      return (
        <CropToolEditor
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
        />
      );
    }

    if (activePlugin.editor === 'annotate' && sourceImageUrl) {
      return (
        <AnnotateToolEditor
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
        />
      );
    }

    if (activePlugin.editor === 'split' && sourceImageUrl) {
      return (
        <SplitStoryboardToolEditor
          plugin={activePlugin}
          sourceImageUrl={sourceImageUrl}
          options={options}
          onOptionsChange={setOptions}
        />
      );
    }

    return (
      <FormToolEditor
        plugin={activePlugin}
        fields={activePlugin.fields}
        options={options}
        onOptionsChange={setOptions}
      />
    );
  }, [activePlugin, options, sourceImageUrl]);

  const isOpen = Boolean(activeToolDialog && sourceNode && activePlugin && isSplitImageReady);

  return (
    <UiModal
      isOpen={isOpen}
      title={`${activePlugin?.label ?? ''}工具`}
      onClose={closeDialog}
      widthClassName={widthClassName}
      footer={
        <>
          <UiButton variant="ghost" size="sm" onClick={closeDialog}>
            取消
          </UiButton>
          <UiButton size="sm" variant="primary" onClick={handleApply} disabled={isProcessing || !sourceImageUrl}>
            {isProcessing ? '处理中...' : '应用'}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3">
        {editorContent}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </UiModal>
  );
}
