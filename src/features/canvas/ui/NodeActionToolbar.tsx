import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react';
import { Copy, Crop, Download, FileText, FolderOpen, PenLine, RefreshCw, Save, Scissors, Trash2, Unlink2, Table, Upload, Sparkles, Send, Check, LayoutTemplate } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';

import {
  NODE_TOOL_TYPES,
  isAudioNode,
  isExportImageNode,
  isGroupNode,
  isImageEditNode,
  isStoryboardGenNode,
  isStoryboardSplitNode,
  isStoryboardSplitResultNode,
  isUploadNode,
  nodeSupportsDescriptionPanel,
  type CanvasNode,
  type NodeToolType,
} from '@/features/canvas/domain/canvasNodes';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { getNodeToolPlugins } from '@/features/canvas/tools';
import type { ToolIconKey } from '@/features/canvas/tools';
import { UiChipButton, UiPanel } from '@/components/ui';
import {
  saveImageSourceToDirectory,
  saveImageSourceToPath,
} from '@/commands/image';
import { sendImageToPhotoshop } from '@/commands/psIntegration';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { usePsIntegrationStore } from '@/stores/psIntegrationStore';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import { sanitizeStoryboardText } from '@/features/canvas/application/storyboardText';
import { buildGenerationErrorReport } from '@/features/canvas/application/generationErrorReport';
import { resolveConnectedTtsText } from '@/features/canvas/nodes/qwenTtsShared';
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_OFFSET,
  NODE_TOOLBAR_POSITION,
} from './nodeToolbarConfig';
import { NodeAddToAssetsButton } from './NodeAddToAssetsButton';

interface NodeActionToolbarProps {
  node: CanvasNode;
}

const toolIconMap: Record<ToolIconKey, typeof Crop> = {
  crop: Crop,
  annotate: PenLine,
  split: Scissors,
  table: Table,
  import: Upload,
  ai: Sparkles,
};

const TOOLBAR_BUTTON_RADIUS_CLASS = 'rounded-full';
const TOOLBAR_NEUTRAL_BUTTON_CLASS =
  'border-[rgba(255,255,255,0.18)] bg-bg-dark/70 text-text-dark hover:border-[rgba(255,255,255,0.32)] hover:bg-bg-dark';

const SCRIPT_ASSET_NODE_TYPES = new Set<string>([
  'scriptCharacterNode',
  'scriptLocationNode',
  'scriptItemNode',
  'scriptPlotPointNode',
  'scriptWorldviewNode',
]);

function isScriptAssetNode(node: CanvasNode): boolean {
  return SCRIPT_ASSET_NODE_TYPES.has(node.type ?? '');
}

export const NodeActionToolbar = memo(({ node }: NodeActionToolbarProps) => {
  const { t, i18n } = useTranslation();
  const isImageEdit = isImageEditNode(node);
  const isStoryboardGen = isStoryboardGenNode(node);
  const isStoryboardSplit = isStoryboardSplitNode(node);
  const isStoryboardSplitResult = isStoryboardSplitResultNode(node);
  const isExportResultImage = isExportImageNode(node);
  const canCopyStoryboardText = isStoryboardGen || isStoryboardSplit || isStoryboardSplitResult;
  const isAssetNode = isScriptAssetNode(node);
  const tools = useMemo(() => getNodeToolPlugins(node), [node]);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const layoutGroupNode = useCanvasStore((state) => state.layoutGroupNode);
  const ungroupNode = useCanvasStore((state) => state.ungroupNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isDescriptionPanelOpen = useCanvasStore(
    (state) => Boolean(state.nodeDescriptionPanelOpenById[node.id])
  );
  const toggleNodeDescriptionPanel = useCanvasStore(
    (state) => state.toggleNodeDescriptionPanel
  );
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);
  const ignoreAtTagWhenCopyingAndGenerating = useSettingsStore(
    (state) => state.ignoreAtTagWhenCopyingAndGenerating
  );
  const psServerStatus = usePsIntegrationStore((state) => state.serverStatus);
  const [downloadMenu, setDownloadMenu] = useState<{ x: number; y: number } | null>(null);
  const [isDownloadMenuVisible, setIsDownloadMenuVisible] = useState(false);
  const [isCopyTextSuccess, setIsCopyTextSuccess] = useState(false);
  const [isCopyErrorSuccess, setIsCopyErrorSuccess] = useState(false);
  const [isSendingToPs, setIsSendingToPs] = useState(false);
  const [isPsSendSuccess, setIsPsSendSuccess] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const copyTextFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyErrorFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageSource = useMemo(() => {
    if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) {
      return node.data.imageUrl || node.data.previewImageUrl || null;
    }
    return null;
  }, [node]);
  const audioSource = useMemo(() => {
    if (isAudioNode(node)) {
      return node.data.audioUrl || null;
    }
    return null;
  }, [node]);
  const canSaveVoicePreset = useMemo(() => {
    if (!isAudioNode(node)) {
      return false;
    }

    const audioUrl = typeof node.data.audioUrl === 'string' ? node.data.audioUrl.trim() : '';
    if (node.data.generationSource !== 'ttsVoiceDesign' || audioUrl.length === 0) {
      return false;
    }

    const storedReferenceText =
      typeof node.data.ttsPresetSource?.referenceText === 'string'
        ? node.data.ttsPresetSource.referenceText.trim()
        : '';
    if (storedReferenceText.length > 0) {
      return true;
    }

    const sourceNodeId = typeof node.data.sourceNodeId === 'string' ? node.data.sourceNodeId.trim() : '';
    return sourceNodeId.length > 0 && resolveConnectedTtsText(sourceNodeId, nodes, edges).trim().length > 0;
  }, [edges, node, nodes]);
  const supportsDescriptionPanel = nodeSupportsDescriptionPanel(node);
  const hasNodeDescription =
    typeof node.data.nodeDescription === 'string'
    && node.data.nodeDescription.trim().length > 0;
  const canHandleImage = Boolean(imageSource);
  const canAddToAssets = Boolean(imageSource || audioSource);
  const generationError =
    isExportImageNode(node)
    && typeof (node.data as { generationError?: unknown }).generationError === 'string'
      ? ((node.data as { generationError?: string }).generationError ?? '').trim()
      : '';
  const generationErrorDetails =
    isExportImageNode(node)
    && typeof (node.data as { generationErrorDetails?: unknown }).generationErrorDetails === 'string'
      ? ((node.data as { generationErrorDetails?: string }).generationErrorDetails ?? '').trim()
      : '';
  const canCopyGenerationError = isExportImageNode(node) && generationError.length > 0;
  const generationJobId =
    isExportResultImage
    && typeof (node.data as { generationJobId?: unknown }).generationJobId === 'string'
      ? ((node.data as { generationJobId?: string }).generationJobId ?? '').trim()
      : '';
  const generationProviderId =
    isExportResultImage
    && typeof (node.data as { generationProviderId?: unknown }).generationProviderId === 'string'
      ? ((node.data as { generationProviderId?: string }).generationProviderId ?? '').trim()
      : '';
  const isGenerationPending =
    isExportResultImage
    && typeof (node.data as { isGenerating?: unknown }).isGenerating === 'boolean'
      ? (node.data as { isGenerating?: boolean }).isGenerating === true
      : false;
  const canRefetchGenerationResult =
    isExportResultImage && generationJobId.length > 0 && generationProviderId.length > 0;
  const generationErrorReport = useMemo(
    () =>
      buildGenerationErrorReport({
        errorMessage: generationError || t('ai.error'),
        errorDetails: generationErrorDetails || undefined,
        context: (node.data as { generationDebugContext?: unknown }).generationDebugContext,
      }),
    [generationError, generationErrorDetails, node.data, t]
  );

  const closeDownloadMenu = useCallback(() => {
    setIsDownloadMenuVisible(false);
    if (downloadMenuCloseTimerRef.current) {
      clearTimeout(downloadMenuCloseTimerRef.current);
    }
    downloadMenuCloseTimerRef.current = setTimeout(() => {
      setDownloadMenu(null);
      downloadMenuCloseTimerRef.current = null;
    }, UI_POPOVER_TRANSITION_MS);
  }, []);

  const resolveToolLabel = useCallback((toolType: NodeToolType) => {
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

  useEffect(() => {
    if (!downloadMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const menuElement = downloadMenuRef.current;
      if (!menuElement) {
        closeDownloadMenu();
        return;
      }
      if (menuElement.contains(event.target as Node)) {
        return;
      }
      closeDownloadMenu();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [closeDownloadMenu, downloadMenu]);

  useEffect(() => {
    if (!downloadMenu) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      setIsDownloadMenuVisible(true);
    });
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [downloadMenu]);

  useEffect(() => {
    return () => {
      if (copyTextFeedbackTimerRef.current) {
        clearTimeout(copyTextFeedbackTimerRef.current);
      }
      if (copyErrorFeedbackTimerRef.current) {
        clearTimeout(copyErrorFeedbackTimerRef.current);
      }
      if (downloadMenuCloseTimerRef.current) {
        clearTimeout(downloadMenuCloseTimerRef.current);
      }
    };
  }, []);

  const storyboardText = useMemo(() => {
    if (isStoryboardGen) {
      return node.data.frames
        .map((frame, index) => t('nodeToolbar.storyboardLine', {
          index: String(index + 1).padStart(2, '0'),
          content: sanitizeStoryboardText(
            frame.description ?? '',
            ignoreAtTagWhenCopyingAndGenerating
          ),
        }))
        .join('\n');
    }
    if (isStoryboardSplit || isStoryboardSplitResult) {
      const orderedFrames = [...node.data.frames].sort((a, b) => a.order - b.order);
      return orderedFrames
        .map((frame, index) => t('nodeToolbar.storyboardLine', {
          index: String(index + 1).padStart(2, '0'),
          content: sanitizeStoryboardText(frame.note ?? '', ignoreAtTagWhenCopyingAndGenerating),
        }))
        .join('\n');
    }
    return '';
  }, [
    ignoreAtTagWhenCopyingAndGenerating,
    isStoryboardGen,
    isStoryboardSplit,
    isStoryboardSplitResult,
    node,
    t,
    i18n.language,
  ]);

  const handleCopyStoryboardText = useCallback(async () => {
    if (!storyboardText) {
      return;
    }

    setIsCopyTextSuccess(true);
    if (copyTextFeedbackTimerRef.current) {
      clearTimeout(copyTextFeedbackTimerRef.current);
    }
    copyTextFeedbackTimerRef.current = setTimeout(() => {
      setIsCopyTextSuccess(false);
      copyTextFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await navigator.clipboard.writeText(storyboardText);
    } catch (error) {
      console.error('Failed to copy storyboard text', error);
    }
  }, [storyboardText]);

  const handleCopyGenerationError = useCallback(async () => {
    if (!canCopyGenerationError) {
      return;
    }

    setIsCopyErrorSuccess(true);
    if (copyErrorFeedbackTimerRef.current) {
      clearTimeout(copyErrorFeedbackTimerRef.current);
    }
    copyErrorFeedbackTimerRef.current = setTimeout(() => {
      setIsCopyErrorSuccess(false);
      copyErrorFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await navigator.clipboard.writeText(generationErrorReport);
    } catch (error) {
      console.error('Failed to copy generation error report', error);
    }
  }, [canCopyGenerationError, generationErrorReport]);

  const handleRefetchGenerationResult = useCallback(() => {
    if (!canRefetchGenerationResult || isGenerationPending) {
      return;
    }

    updateNodeData(node.id, {
      isGenerating: true,
      generationStartedAt: Date.now(),
      generationError: null,
      generationErrorDetails: null,
    });
  }, [canRefetchGenerationResult, isGenerationPending, node.id, updateNodeData]);

  const handleSendToPs = useCallback(async () => {
    if (!imageSource) {
      console.warn('handleSendToPs: no imageSource');
      return;
    }
    
    if (!psServerStatus.running) {
      console.warn('handleSendToPs: PS server not running');
      return;
    }
    
    if (!psServerStatus.ps_connected) {
      console.warn('handleSendToPs: PS not connected');
      return;
    }

    console.log('handleSendToPs: sending image...', imageSource.substring(0, 50));
    setIsSendingToPs(true);
    setIsPsSendSuccess(false);

    try {
      await sendImageToPhotoshop(imageSource);
      console.log('handleSendToPs: success');
      setIsPsSendSuccess(true);
      setTimeout(() => {
        setIsPsSendSuccess(false);
      }, 1500);
    } catch (error) {
      console.error('Failed to send image to Photoshop:', error);
    } finally {
      setIsSendingToPs(false);
    }
  }, [imageSource, psServerStatus.running, psServerStatus.ps_connected]);

  const handleDownloadSaveAs = useCallback(async () => {
    if (!imageSource) {
      return;
    }

    try {
      const selectedPath = await save({
        defaultPath: `node-${node.id}.png`,
      });
      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }
      await saveImageSourceToPath(imageSource, selectedPath);
      closeDownloadMenu();
    } catch (error) {
      console.error('Failed to save image with save-as', error);
    }
  }, [closeDownloadMenu, imageSource, node.id]);

  const handleDownloadToPreset = useCallback(
    async (targetDir: string) => {
      if (!imageSource) {
        return;
      }
      try {
        await saveImageSourceToDirectory(imageSource, targetDir, `node-${node.id}`);
        closeDownloadMenu();
      } catch (error) {
        console.error('Failed to save image to preset dir', error);
      }
    },
    [closeDownloadMenu, imageSource, node.id]
  );

  return (
    <ReactFlowNodeToolbar
      nodeId={node.id}
      isVisible
      position={NODE_TOOLBAR_POSITION}
      align={NODE_TOOLBAR_ALIGN}
      offset={NODE_TOOLBAR_OFFSET}
      className={NODE_TOOLBAR_CLASS}
    >
      <UiPanel className="flex items-center gap-1 rounded-full p-1">
        {!isImageEdit && tools.map((tool) => {
          const Icon = toolIconMap[tool.icon] ?? Crop;

          return (
            <UiChipButton
              key={tool.type}
              className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
              onClick={() =>
                canvasEventBus.publish('tool-dialog/open', {
                  nodeId: node.id,
                  toolType: tool.type,
                })
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {resolveToolLabel(tool.type)}
            </UiChipButton>
          );
        })}
        {!isImageEdit && supportsDescriptionPanel && (
          <UiChipButton
            key="node-description-toggle"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${
              isDescriptionPanelOpen || hasNodeDescription
                ? '!border-accent/45 !bg-accent/15 !text-text-dark hover:!bg-accent/20'
                : TOOLBAR_NEUTRAL_BUTTON_CLASS
            }`}
            title={
              isDescriptionPanelOpen
                ? t('nodeToolbar.collapseDescription')
                : t('nodeToolbar.expandDescription')
            }
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              toggleNodeDescriptionPanel(node.id);
            }}
          >
            <FileText className="h-3.5 w-3.5" />
            {t('nodeToolbar.description')}
          </UiChipButton>
        )}
        {!isImageEdit && canSaveVoicePreset && (
          <UiChipButton
            key="audio-save-preset"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              canvasEventBus.publish('audio-node/open-save-preset', {
                nodeId: node.id,
              });
            }}
          >
            <Save className="h-3.5 w-3.5" />
            {t('node.audioNode.saveAsPreset')}
          </UiChipButton>
        )}
        {!isImageEdit && canAddToAssets && (
          <NodeAddToAssetsButton
            node={node}
            mediaSource={audioSource ?? imageSource ?? ''}
            mediaType={audioSource ? 'audio' : 'image'}
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
          />
        )}
        {!isImageEdit && canCopyStoryboardText && (
          <UiChipButton
            key="storyboard-text-copy"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopyTextSuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : ''
            }`}
            onClick={() => {
              void handleCopyStoryboardText();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('nodeToolbar.copyText')}
          </UiChipButton>
        )}
        {!isImageEdit && canCopyGenerationError && (
          <UiChipButton
            key="generation-error-copy"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopyErrorSuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : '!border-red-500/45 !bg-red-500/15 !text-red-200 hover:!bg-red-500/25'
            }`}
            onClick={() => {
              void handleCopyGenerationError();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {isCopyErrorSuccess ? t('nodeToolbar.copied') : t('nodeToolbar.copyErrorReport')}
          </UiChipButton>
        )}
        {!isImageEdit && canRefetchGenerationResult && (
          <UiChipButton
            key="generation-refetch"
            className={`h-8 w-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} !px-0 ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              handleRefetchGenerationResult();
            }}
            disabled={isGenerationPending}
            title={t('node.imageNode.manualRefresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isGenerationPending ? 'animate-spin' : ''}`} />
          </UiChipButton>
        )}
        {!isImageEdit && canHandleImage && (
          <UiChipButton
            key="image-download"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              if (downloadPresetPaths.length === 0) {
                void handleDownloadSaveAs();
                return;
              }
              setDownloadMenu({
                x: event.clientX,
                y: event.clientY,
              });
              setIsDownloadMenuVisible(false);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {t('nodeToolbar.download')}
          </UiChipButton>
        )}
        {!isImageEdit && canHandleImage && psServerStatus.running && (
          <UiChipButton
            key="send-to-ps"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${
              isPsSendSuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : !psServerStatus.ps_connected
                  ? '!border-gray-500/30 !bg-gray-500/10 !text-gray-400'
                  : TOOLBAR_NEUTRAL_BUTTON_CLASS
            }`}
            onClick={(event) => {
              event.stopPropagation();
              if (psServerStatus.ps_connected) {
                void handleSendToPs();
              }
            }}
            disabled={isSendingToPs || !psServerStatus.ps_connected}
            title={psServerStatus.ps_connected ? t('nodeToolbar.sendToPs') : t('nodeToolbar.psNotConnected')}
          >
            {isSendingToPs ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : isPsSendSuccess ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {isPsSendSuccess ? t('nodeToolbar.sent') : (psServerStatus.ps_connected ? t('nodeToolbar.sendToPs') : t('nodeToolbar.psNotConnected'))}
          </UiChipButton>
        )}
        {!isImageEdit && isGroupNode(node) && (
          <UiChipButton
            key="group-layout"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-cyan-400/60 hover:!bg-cyan-500/20 hover:!text-cyan-100`}
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              layoutGroupNode(node.id);
            }}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            {t('nodeToolbar.arrangeGroup')}
          </UiChipButton>
        )}
        {!isImageEdit && isGroupNode(node) && (
          <UiChipButton
            key="group-ungroup"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-amber-400/60 hover:!bg-amber-500/20 hover:!text-amber-200`}
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              ungroupNode(node.id);
            }}
          >
            <Unlink2 className="h-3.5 w-3.5" />
            {t('nodeToolbar.ungroup')}
          </UiChipButton>
        )}
        {!isAssetNode && (
          <UiChipButton
            key="node-delete"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} border-red-500/45 bg-red-500/15 px-2.5 text-xs text-red-300 hover:bg-red-500/25`}
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              deleteNode(node.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('common.delete')}
          </UiChipButton>
        )}
      </UiPanel>

      {!isImageEdit && downloadMenu && (
        <div
          ref={downloadMenuRef}
          className={`fixed z-[120] min-w-[280px] rounded-xl border border-[rgba(255,255,255,0.18)] bg-surface-dark/95 p-2 shadow-2xl backdrop-blur-sm transition-opacity duration-150 ${isDownloadMenuVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{ left: `${downloadMenu.x}px`, top: `${downloadMenu.y}px` }}
        >
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-text-dark transition-colors hover:bg-bg-dark"
            onClick={() => {
              void handleDownloadSaveAs();
            }}
          >
            <Download className="h-4 w-4" />
            {t('nodeToolbar.saveAs')}
          </button>

          {downloadPresetPaths.length > 0 ? (
            <div className="mt-1 space-y-1 border-t border-[rgba(255,255,255,0.1)] pt-2">
              {downloadPresetPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-text-dark transition-colors hover:bg-bg-dark"
                  onClick={() => {
                    void handleDownloadToPreset(path);
                  }}
                  title={path}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="truncate">{path}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-1 border-t border-[rgba(255,255,255,0.1)] px-2.5 pt-2 text-xs text-text-muted">
              {t('nodeToolbar.noDownloadPresetPathsHint')}
            </div>
          )}
        </div>
      )}
    </ReactFlowNodeToolbar>
  );
});

NodeActionToolbar.displayName = 'NodeActionToolbar';
