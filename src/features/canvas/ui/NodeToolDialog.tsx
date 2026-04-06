import { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  NODE_TOOL_TYPES,
  isAudioNode,
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
  isVideoNode,
  type NodeToolType,
} from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import {
  canvasEventBus,
  canvasToolProcessor,
} from '@/features/canvas/application/canvasServices';
import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { prepareNodeImage, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { resolveMinEdgeFittedSize } from '@/features/canvas/application/imageNodeSizing';
import { readStoryboardImageMetadata } from '@/commands/image';
import { getToolPlugin, type ToolOptions } from '@/features/canvas/tools';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiButton, UiModal } from '@/components/ui';
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { FormToolEditor } from './tool-editors/FormToolEditor';
import { CropToolEditor } from './tool-editors/CropToolEditor';
import { MediaTrimToolEditor } from './tool-editors/MediaTrimToolEditor';
import { AnnotateToolEditor } from './tool-editors/AnnotateToolEditor';
import { SplitStoryboardToolEditor } from './tool-editors/SplitStoryboardToolEditor';

export function NodeToolDialog() {
  const { t } = useTranslation();
  const activeToolDialog = useCanvasStore((state) => state.activeToolDialog);
  const addNode = useCanvasStore((state) => state.addNode);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addStoryboardSplitResultNode = useCanvasStore((state) => state.addStoryboardSplitResultNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ToolOptions>({});
  const [isSplitImageReady, setIsSplitImageReady] = useState(true);
  const [displayToolDialog, setDisplayToolDialog] = useState(activeToolDialog);

  useEffect(() => {
    if (activeToolDialog) {
      setDisplayToolDialog(activeToolDialog);
      return;
    }

    const timer = setTimeout(() => {
      setDisplayToolDialog(null);
    }, UI_DIALOG_TRANSITION_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [activeToolDialog]);

  const sourceNode = useCanvasNodeById(displayToolDialog?.nodeId ?? '');

  const sourceAsset = useMemo(() => {
    if (!sourceNode) {
      return null;
    }

    if (isUploadNode(sourceNode) || isImageEditNode(sourceNode) || isExportImageNode(sourceNode)) {
      return {
        mediaType: 'image' as const,
        sourceUrl: sourceNode.data.imageUrl,
      };
    }

    if (isVideoNode(sourceNode)) {
      return {
        mediaType: 'video' as const,
        sourceUrl: sourceNode.data.videoUrl,
      };
    }

    if (isAudioNode(sourceNode)) {
      return {
        mediaType: 'audio' as const,
        sourceUrl: sourceNode.data.audioUrl,
      };
    }

    return null;
  }, [sourceNode]);

  const sourceImageUrl = sourceAsset?.mediaType === 'image' ? sourceAsset.sourceUrl : null;
  const sourceMediaUrl = sourceAsset?.sourceUrl ?? null;
  const sourceTrimMediaType = sourceAsset?.mediaType === 'video' || sourceAsset?.mediaType === 'audio'
    ? sourceAsset.mediaType
    : null;

  const activePlugin = useMemo(() => {
    if (!displayToolDialog) {
      return null;
    }

    return getToolPlugin(displayToolDialog.toolType);
  }, [displayToolDialog]);

  const dialogKey = displayToolDialog
    ? `${displayToolDialog.nodeId}:${displayToolDialog.toolType}`
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

  const resolveToolLabel = useCallback((toolType: NodeToolType | undefined) => {
    if (!toolType) {
      return '';
    }
    if (toolType === NODE_TOOL_TYPES.crop) {
      return t('tool.crop');
    }
    if (toolType === NODE_TOOL_TYPES.annotate) {
      return t('tool.annotate');
    }
    if (toolType === NODE_TOOL_TYPES.splitStoryboard) {
      return t('tool.split');
    }
    return '';
  }, [t]);
  const resolveResultNodeTitle = useCallback((toolType: NodeToolType | undefined) => {
    if (toolType === NODE_TOOL_TYPES.crop) {
      return t('toolDialog.cropResultTitle');
    }
    if (toolType === NODE_TOOL_TYPES.annotate) {
      return t('toolDialog.annotateResultTitle');
    }
    return EXPORT_RESULT_DISPLAY_NAME.generic;
  }, [t]);

  const handleApply = useCallback(async () => {
    if (!activeToolDialog || !sourceNode || !sourceMediaUrl || !activePlugin) {
      setError(t('toolDialog.noProcessableImage'));
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await activePlugin.execute(sourceMediaUrl, options, {
        processTool: (toolType, imageUrl, toolOptions) =>
          canvasToolProcessor.process(toolType, imageUrl, toolOptions),
      });

      if (result.storyboardFrames && result.rows && result.cols) {
        const createdNodeId = addStoryboardSplitResultNode(
          sourceNode.id,
          result.rows,
          result.cols,
          result.storyboardFrames,
          result.frameAspectRatio
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      } else if (result.outputImageUrl) {
        const prepared = await prepareNodeImage(result.outputImageUrl);
        const createdNodeId = addDerivedExportNode(
          sourceNode.id,
          prepared.imageUrl,
          prepared.aspectRatio,
          prepared.previewImageUrl,
          {
            defaultTitle: resolveResultNodeTitle(activeToolDialog.toolType),
            resultKind: 'generic',
            aspectRatioStrategy: 'provided',
            sizeStrategy: 'autoMinEdge',
          }
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      } else if (result.outputVideoUrl) {
        const aspectRatio = result.aspectRatio?.trim() || '16:9';
        const mediaSize = resolveMinEdgeFittedSize(aspectRatio, {
          minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
          minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
        });
        const createdNodeId = addNode(
          CANVAS_NODE_TYPES.video,
          findNodePosition(sourceNode.id, mediaSize.width, mediaSize.height + 54),
          {
            videoUrl: result.outputVideoUrl,
            previewImageUrl: result.previewImageUrl ?? null,
            videoFileName: result.outputFileName ?? undefined,
            aspectRatio,
            duration: result.duration,
            displayName: t('toolDialog.trimResultTitle'),
          },
          { inheritParentFromNodeId: sourceNode.id }
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      } else if (result.outputAudioUrl) {
        const createdNodeId = addNode(
          CANVAS_NODE_TYPES.audio,
          findNodePosition(sourceNode.id, AUDIO_NODE_DEFAULT_WIDTH, AUDIO_NODE_DEFAULT_HEIGHT),
          {
            audioUrl: result.outputAudioUrl,
            previewImageUrl: result.previewImageUrl ?? null,
            audioFileName: result.outputFileName ?? undefined,
            duration: result.duration,
            mimeType: result.mimeType,
            displayName: t('toolDialog.trimResultTitle'),
          },
          { inheritParentFromNodeId: sourceNode.id }
        );
        if (createdNodeId) {
          addEdge(sourceNode.id, createdNodeId);
        }
      }

      closeDialog();
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : t('toolDialog.processFailed'));
    } finally {
      setIsProcessing(false);
    }
  }, [
    activeToolDialog,
    sourceNode,
    sourceMediaUrl,
    activePlugin,
    options,
    addNode,
    addStoryboardSplitResultNode,
    addDerivedExportNode,
    addEdge,
    closeDialog,
    findNodePosition,
    resolveResultNodeTitle,
    t,
  ]);

  const isTrimRangeInvalid = useMemo(() => {
    if (!sourceTrimMediaType) {
      return false;
    }

    const startTime = typeof options.startTime === 'number' ? options.startTime : Number.NaN;
    const endTime = typeof options.endTime === 'number' ? options.endTime : Number.NaN;
    const duration = typeof options.duration === 'number' ? options.duration : Number.NaN;

    return (
      !Number.isFinite(startTime)
      || !Number.isFinite(endTime)
      || !Number.isFinite(duration)
      || duration <= 0
      || startTime < 0
      || endTime <= startTime
      || endTime - startTime < 0.1
    );
  }, [options.duration, options.endTime, options.startTime, sourceTrimMediaType]);

  const widthClassName = useMemo(() => {
    if (!activePlugin) {
      return 'w-[min(460px,calc(100vw-40px))]';
    }
    if (activePlugin.editor === 'crop') {
      if (sourceTrimMediaType === 'audio') {
        return 'w-[min(760px,calc(100vw-40px))]';
      }
      return 'w-[min(980px,calc(100vw-40px))]';
    }
    if (activePlugin.editor === 'annotate') {
      return 'w-[min(1120px,calc(100vw-40px))]';
    }
    if (activePlugin.editor === 'split') {
      return 'w-[min(1120px,calc(100vw-40px))]';
    }
    return 'w-[min(460px,calc(100vw-40px))]';
  }, [activePlugin, sourceTrimMediaType]);

  const editorContent = useMemo(() => {
    if (!activePlugin) {
      return null;
    }

    if (activePlugin.editor === 'crop' && sourceTrimMediaType && sourceMediaUrl) {
      return (
        <MediaTrimToolEditor
          plugin={activePlugin}
          sourceMediaUrl={sourceMediaUrl}
          mediaType={sourceTrimMediaType}
          options={options}
          onOptionsChange={setOptions}
        />
      );
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
  }, [activePlugin, options, sourceImageUrl, sourceMediaUrl, sourceTrimMediaType]);

  const isOpen = Boolean(activeToolDialog && isSplitImageReady);
  const isApplyDisabled = isProcessing || !sourceMediaUrl || isTrimRangeInvalid;

  return (
    <UiModal
      isOpen={isOpen}
      title={`${resolveToolLabel(activePlugin?.type)}${t('toolDialog.suffix')}`}
      onClose={closeDialog}
      widthClassName={widthClassName}
      draggable={activePlugin?.editor === 'split' || activePlugin?.editor === 'crop'}
      footer={
        <>
          <UiButton variant="ghost" size="sm" onClick={closeDialog}>
            {t('common.cancel')}
          </UiButton>
          <UiButton size="sm" variant="primary" onClick={handleApply} disabled={isApplyDisabled}>
            {isProcessing ? t('toolDialog.processing') : t('toolDialog.apply')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3 max-h-[82vh] overflow-y-auto pr-1">
        {editorContent}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </UiModal>
  );
}
