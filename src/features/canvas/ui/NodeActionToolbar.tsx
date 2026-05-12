import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react';
import { Copy, Crop, Download, FileText, FolderOpen, PenLine, RefreshCw, Save, Scissors, Trash2, Unlink2, Table, Upload, Sparkles, Send, Check, LayoutTemplate } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';

import { UiLoadingAnimation } from '@/components/ui';
import {
  NODE_TOOL_TYPES,
  isAudioNode,
  isExportImageNode,
  isGroupNode,
  isImageCompareNode,
  isImageEditNode,
  isPanorama360Node,
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
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
} from '@/features/canvas/application/generationErrorReport';
import { resolveConnectedTtsText } from '@/features/canvas/nodes/qwenTtsShared';
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_OFFSET,
  NODE_TOOLBAR_POSITION,
} from './nodeToolbarConfig';
import { NodeAddToAssetsButton } from './NodeAddToAssetsButton';
import { NodeAddToClipLibraryButton } from './NodeAddToClipLibraryButton';

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
  'border-[rgba(15,23,42,0.16)] bg-bg-dark/70 text-text-dark hover:border-[rgba(15,23,42,0.28)] hover:bg-bg-dark dark:border-[rgba(255,255,255,0.18)] dark:hover:border-[rgba(255,255,255,0.32)]';
const TOOLBAR_DANGER_BUTTON_CLASS =
  'border-red-900/35 bg-red-950/[0.06] text-red-900 hover:border-red-900/55 hover:bg-red-950/[0.1] dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/16';
const TOOLBAR_DANGER_BUTTON_OVERRIDE_CLASS =
  '!border-red-900/35 !bg-red-950/[0.06] !text-red-900 hover:!border-red-900/55 hover:!bg-red-950/[0.1] dark:!border-red-400/30 dark:!bg-red-400/10 dark:!text-red-200 dark:hover:!bg-red-400/16';
const DOWNLOAD_MENU_MIN_WIDTH = 280;
const DOWNLOAD_MENU_VIEWPORT_MARGIN = 12;
const DOWNLOAD_MENU_BUTTON_OFFSET = 8;
const DOWNLOAD_MENU_ESTIMATED_ROW_HEIGHT = 36;
const DOWNLOAD_MENU_VERTICAL_PADDING = 16;

const SCRIPT_ASSET_NODE_TYPES = new Set<string>([
  'scriptCharacterNode',
  'scriptLocationNode',
  'scriptItemNode',
  'scriptStoryNoteNode',
  'scriptPlotPointNode',
  'scriptWorldviewNode',
]);

function isScriptAssetNode(node: CanvasNode): boolean {
  return SCRIPT_ASSET_NODE_TYPES.has(node.type ?? '');
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripUrlSearchAndHash(value: string): string {
  const separatorIndex = value.search(/[?#]/);
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
}

function getFileNameFromPathLike(value: string): string {
  const cleaned = stripUrlSearchAndHash(value.trim()).replace(/\\/g, '/');
  const segments = cleaned.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '').trim();
}

function getFileExtension(value: string): string {
  const fileName = getFileNameFromPathLike(value);
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex >= fileName.length - 1) {
    return '';
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function resolveAudioExtensionFromMime(mimeType: unknown): string {
  const normalized = normalizeText(mimeType).split(';', 1)[0]?.toLowerCase() ?? '';
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
  if (
    normalized === 'audio/wav'
    || normalized === 'audio/x-wav'
    || normalized === 'audio/wave'
    || normalized === 'audio/x-pn-wav'
  ) {
    return 'wav';
  }
  if (normalized === 'audio/ogg') return 'ogg';
  if (normalized === 'audio/webm') return 'webm';
  if (normalized === 'audio/mp4' || normalized === 'audio/x-m4a') return 'm4a';
  if (normalized === 'audio/aac') return 'aac';
  if (normalized === 'audio/flac' || normalized === 'audio/x-flac') return 'flac';
  return '';
}

function resolveVideoExtensionFromMime(mimeType: unknown): string {
  const normalized = normalizeText(mimeType).split(';', 1)[0]?.toLowerCase() ?? '';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/ogg') return 'ogv';
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'video/x-msvideo') return 'avi';
  if (normalized === 'video/x-matroska') return 'mkv';
  return '';
}

function sanitizeDownloadFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return sanitized || 'node-media';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveDownloadMenuPosition(
  triggerRect: DOMRect,
  itemCount: number
): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return {
      x: triggerRect.left,
      y: triggerRect.bottom + DOWNLOAD_MENU_BUTTON_OFFSET,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const estimatedMenuHeight =
    DOWNLOAD_MENU_VERTICAL_PADDING
    + DOWNLOAD_MENU_ESTIMATED_ROW_HEIGHT
    + Math.max(0, itemCount) * DOWNLOAD_MENU_ESTIMATED_ROW_HEIGHT;
  const maxX = Math.max(
    DOWNLOAD_MENU_VIEWPORT_MARGIN,
    viewportWidth - DOWNLOAD_MENU_MIN_WIDTH - DOWNLOAD_MENU_VIEWPORT_MARGIN
  );
  const x = clampNumber(
    triggerRect.left,
    DOWNLOAD_MENU_VIEWPORT_MARGIN,
    maxX
  );
  const preferredY = triggerRect.bottom + DOWNLOAD_MENU_BUTTON_OFFSET;
  const shouldPlaceAbove =
    preferredY + estimatedMenuHeight > viewportHeight - DOWNLOAD_MENU_VIEWPORT_MARGIN
    && triggerRect.top - estimatedMenuHeight - DOWNLOAD_MENU_BUTTON_OFFSET > DOWNLOAD_MENU_VIEWPORT_MARGIN;
  const rawY = shouldPlaceAbove
    ? triggerRect.top - estimatedMenuHeight - DOWNLOAD_MENU_BUTTON_OFFSET
    : preferredY;
  const maxY = Math.max(
    DOWNLOAD_MENU_VIEWPORT_MARGIN,
    viewportHeight - estimatedMenuHeight - DOWNLOAD_MENU_VIEWPORT_MARGIN
  );
  const y = clampNumber(rawY, DOWNLOAD_MENU_VIEWPORT_MARGIN, maxY);

  return { x, y };
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
  const splitImageCompareNode = useCanvasStore((state) => state.splitImageCompareNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isDescriptionPanelOpen = useCanvasStore(
    (state) => Boolean(state.nodeDescriptionPanelOpenById[node.id])
  );
  const toggleNodeDescriptionPanel = useCanvasStore(
    (state) => state.toggleNodeDescriptionPanel
  );
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
    if (
      isUploadNode(node)
      || isImageEditNode(node)
      || isPanorama360Node(node)
      || isExportImageNode(node)
    ) {
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
  const videoSource = useMemo(() => {
    const source = normalizeText((node.data as { videoUrl?: unknown }).videoUrl);
    return source || null;
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
    if (sourceNodeId.length === 0) {
      return false;
    }

    const { nodes, edges } = useCanvasStore.getState();
    return resolveConnectedTtsText(sourceNodeId, nodes, edges).trim().length > 0;
  }, [node]);
  const supportsDescriptionPanel = nodeSupportsDescriptionPanel(node);
  const hasNodeDescription =
    typeof node.data.nodeDescription === 'string'
    && node.data.nodeDescription.trim().length > 0;
  const canHandleImage = Boolean(imageSource);
  const downloadableSource = audioSource ?? videoSource ?? imageSource;
  const canDownloadMedia = Boolean(downloadableSource);
  const downloadDefaultFileName = useMemo(() => {
    if (isAudioNode(node)) {
      const sourceExtension = getFileExtension(audioSource ?? '');
      const audioExtension =
        getFileExtension(normalizeText(node.data.audioFileName))
        || sourceExtension
        || resolveAudioExtensionFromMime(node.data.mimeType)
        || 'mp3';
      const baseName =
        normalizeText(node.data.audioFileName)
        || normalizeText(node.data.assetName)
        || getFileNameFromPathLike(audioSource ?? '')
        || `node-${node.id}`;
      const safeName = sanitizeDownloadFileName(baseName);
      return getFileExtension(safeName) ? safeName : `${safeName}.${audioExtension}`;
    }

    if (videoSource) {
      const sourceExtension = getFileExtension(videoSource);
      const videoFileName = normalizeText((node.data as { videoFileName?: unknown }).videoFileName);
      const videoExtension =
        getFileExtension(videoFileName)
        || sourceExtension
        || resolveVideoExtensionFromMime((node.data as { mimeType?: unknown }).mimeType)
        || 'mp4';
      const baseName =
        videoFileName
        || getFileNameFromPathLike(videoSource)
        || `node-${node.id}`;
      const safeName = sanitizeDownloadFileName(baseName);
      return getFileExtension(safeName) ? safeName : `${safeName}.${videoExtension}`;
    }

    const imageFileName = getFileNameFromPathLike(imageSource ?? '');
    const imageExtension = getFileExtension(imageFileName) || 'png';
    const baseName = imageFileName || `node-${node.id}`;
    const safeName = sanitizeDownloadFileName(baseName);
    return getFileExtension(safeName) ? safeName : `${safeName}.${imageExtension}`;
  }, [audioSource, imageSource, node, videoSource]);
  const downloadSuggestedFileStem = useMemo(
    () => stripFileExtension(downloadDefaultFileName) || `node-${node.id}`,
    [downloadDefaultFileName, node.id]
  );
  const canAddToAssets = Boolean(imageSource || audioSource);
  const canAddToClipLibrary =
    Boolean(audioSource)
    || (
      typeof (node.data as { videoUrl?: unknown }).videoUrl === 'string'
      && ((node.data as { videoUrl?: string }).videoUrl ?? '').trim().length > 0
    );
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
  const generationStartedAt =
    isExportResultImage
    && typeof (node.data as { generationStartedAt?: unknown }).generationStartedAt === 'number'
      ? (node.data as { generationStartedAt?: number }).generationStartedAt ?? null
      : null;
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
    if (!canRefetchGenerationResult) {
      return;
    }

    const refreshRequestedAt = Date.now();
    updateNodeData(node.id, {
      isGenerating: true,
      generationPhase: 'running',
      generationFailureStage: null,
      generationStartedAt: generationStartedAt ?? refreshRequestedAt,
      generationForceRefreshRequestedAt: refreshRequestedAt,
      generationClientSessionId: CURRENT_RUNTIME_SESSION_ID,
      generationError: null,
      generationErrorDetails: null,
    });
  }, [canRefetchGenerationResult, generationStartedAt, node.id, updateNodeData]);

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
    if (!downloadableSource) {
      return;
    }

    try {
      const selectedPath = await save({
        defaultPath: downloadDefaultFileName,
      });
      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }
      await saveImageSourceToPath(downloadableSource, selectedPath);
      closeDownloadMenu();
    } catch (error) {
      console.error('Failed to save media with save-as', error);
    }
  }, [closeDownloadMenu, downloadableSource, downloadDefaultFileName]);

  const handleDownloadToPreset = useCallback(
    async (targetDir: string) => {
      if (!downloadableSource) {
        return;
      }
      try {
        await saveImageSourceToDirectory(downloadableSource, targetDir, downloadSuggestedFileStem);
        closeDownloadMenu();
      } catch (error) {
        console.error('Failed to save media to preset dir', error);
      }
    },
    [closeDownloadMenu, downloadableSource, downloadSuggestedFileStem]
  );

  const downloadMenuContent = !isImageEdit && downloadMenu ? (
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
  ) : null;

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
        {!isImageEdit && canAddToClipLibrary && (
          <NodeAddToClipLibraryButton
            node={node}
            mediaSource={audioSource ?? videoSource ?? ''}
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
                : TOOLBAR_DANGER_BUTTON_OVERRIDE_CLASS
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
            title={t('node.imageNode.manualRefresh')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </UiChipButton>
        )}
        {!isImageEdit && canDownloadMedia && (
          <UiChipButton
            key="media-download"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              if (downloadPresetPaths.length === 0) {
                void handleDownloadSaveAs();
                return;
              }
              setDownloadMenu(resolveDownloadMenuPosition(
                event.currentTarget.getBoundingClientRect(),
                downloadPresetPaths.length
              ));
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
              <UiLoadingAnimation size="xs" />
            ) : isPsSendSuccess ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {isPsSendSuccess ? t('nodeToolbar.sent') : (psServerStatus.ps_connected ? t('nodeToolbar.sendToPs') : t('nodeToolbar.psNotConnected'))}
          </UiChipButton>
        )}
        {!isImageEdit && isImageCompareNode(node) && (
          <UiChipButton
            key="image-compare-separate"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-[rgba(15,23,42,0.32)] hover:!bg-[rgba(15,23,42,0.1)] hover:!text-text-dark dark:hover:!border-accent/45 dark:hover:!bg-accent/14`}
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              splitImageCompareNode(node.id);
            }}
          >
            <Unlink2 className="h-3.5 w-3.5" />
            {t('nodeToolbar.separateCompare')}
          </UiChipButton>
        )}
        {!isImageEdit && isGroupNode(node) && (
          <UiChipButton
            key="group-layout"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-[rgba(15,23,42,0.32)] hover:!bg-[rgba(15,23,42,0.1)] hover:!text-text-dark dark:hover:!border-accent/45 dark:hover:!bg-accent/14`}
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
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-[rgba(15,23,42,0.32)] hover:!bg-[rgba(15,23,42,0.1)] hover:!text-text-dark dark:hover:!border-accent/45 dark:hover:!bg-accent/14`}
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
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_DANGER_BUTTON_CLASS}`}
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

      {downloadMenuContent ? createPortal(downloadMenuContent, document.body) : null}
    </ReactFlowNodeToolbar>
  );
});

NodeActionToolbar.displayName = 'NodeActionToolbar';
