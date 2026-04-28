import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { Check, Copy, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';

import {
  CANVAS_NODE_TYPES,
  TTS_TEXT_NODE_DEFAULT_HEIGHT,
  TTS_TEXT_NODE_DEFAULT_WIDTH,
  type TextAnnotationNodeData,
  type TtsTextNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';

type TextAnnotationNodeProps = NodeProps & {
  id: string;
  type?: string;
  data: TextAnnotationNodeData | TtsTextNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = TTS_TEXT_NODE_DEFAULT_WIDTH;
const DEFAULT_HEIGHT = TTS_TEXT_NODE_DEFAULT_HEIGHT;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const succeeded = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!succeeded) {
    throw new Error('execCommand copy failed');
  }
}

export const TextAnnotationNode = memo(({
  id,
  type,
  data,
  selected,
  width,
  height,
}: TextAnnotationNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const content = typeof data.content === 'string' ? data.content : '';
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const resolvedNodeType = type === CANVAS_NODE_TYPES.ttsText
    ? CANVAS_NODE_TYPES.ttsText
    : CANVAS_NODE_TYPES.textAnnotation;
  const translationKeyPrefix = resolvedNodeType === CANVAS_NODE_TYPES.ttsText
    ? 'node.ttsText'
    : 'node.textAnnotation';
  const defaultWidth = resolvedNodeType === CANVAS_NODE_TYPES.ttsText
    ? TTS_TEXT_NODE_DEFAULT_WIDTH
    : DEFAULT_WIDTH;
  const defaultHeight = resolvedNodeType === CANVAS_NODE_TYPES.ttsText
    ? TTS_TEXT_NODE_DEFAULT_HEIGHT
    : DEFAULT_HEIGHT;
  const resolvedTitle = resolveNodeDisplayName(resolvedNodeType, data);
  const resolvedWidth = Math.max(MIN_WIDTH, Math.round(width ?? defaultWidth));
  const resolvedHeight = Math.max(MIN_HEIGHT, Math.round(height ?? defaultHeight));
  const showCopyButton =
    resolvedNodeType === CANVAS_NODE_TYPES.textAnnotation
    && data.showCopyButton === true;
  const isGeneratingOutput =
    resolvedNodeType === CANVAS_NODE_TYPES.textAnnotation
    && data.isGenerating === true;
  const generationStatusText =
    typeof data.generationStatusText === 'string' && data.generationStatusText.trim().length > 0
      ? data.generationStatusText
      : t('node.llmLogic.running');
  const handleMarkdownLinkClick = useCallback((href?: string) => {
    if (!href) {
      return;
    }
    void openUrl(href);
  }, []);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => () => {
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
  }, []);

  const copyButtonLabel = copied ? t('common.copied') : t('common.copy');

  const handleCopyContent = useCallback(async () => {
    try {
      await copyTextToClipboard(content);
      setCopied(true);
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimeoutRef.current = null;
      }, 1200);
    } catch {
      setCopied(false);
      await showErrorDialog(t('copyFailed'), t('common.error'));
    }
  }, [content, t]);

  return (
    <div
      className={`
        group relative h-full w-full overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-1.5 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<FileText className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <NodeResizeHandle
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        maxWidth={MAX_WIDTH}
        maxHeight={MAX_HEIGHT}
        isVisible={selected}
      />

      {showCopyButton && !isGeneratingOutput ? (
        <button
          type="button"
          title={copyButtonLabel}
          aria-label={copyButtonLabel}
          disabled={content.length === 0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void handleCopyContent();
          }}
          className="nodrag absolute bottom-2.5 right-2.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-text-muted shadow-[0_6px_14px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors hover:border-white/18 hover:bg-white/[0.08] hover:text-text-dark disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.02] disabled:text-text-muted/45"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.1} />
          )}
        </button>
      ) : null}

      {isGeneratingOutput ? (
        <div className="pointer-events-none absolute right-2.5 top-2.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-text-muted shadow-[0_6px_14px_rgba(0,0,0,0.18)] backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} />
        </div>
      ) : null}

      {selected ? (
        <textarea
          autoFocus
          readOnly={isGeneratingOutput}
          value={content}
          onChange={(event) => {
            const nextValue = event.target.value;
            updateNodeData(id, { content: nextValue });
          }}
          placeholder={t(`${translationKeyPrefix}.placeholder`)}
          className={`nodrag nowheel h-full w-full resize-none border-none bg-transparent px-1 py-0.5 pb-2 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70 ${
            showCopyButton ? 'pr-10 pb-10' : 'pr-2'
          }`}
        />
      ) : (
        <div
          className={`nodrag nowheel h-full w-full overflow-auto px-1 py-0.5 pb-2 text-sm leading-6 text-text-dark ${
            showCopyButton ? 'pr-10 pb-10' : 'pr-2'
          }`}
        >
          {content.trim().length > 0 ? (
            <div className="markdown-body break-words [&_a]:text-accent [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-white/10 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_p+_p]:mt-4 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-black/30 [&_pre]:p-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a
                      {...props}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        handleMarkdownLinkClick(href);
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="pt-1 text-text-muted">{t(`${translationKeyPrefix}.empty`)}</div>
          )}
        </div>
      )}

      {isGeneratingOutput ? (
        <div className="pointer-events-none absolute inset-[36px_6px_6px_6px] z-10 flex items-center justify-center rounded-[20px] bg-black/28 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-text-dark shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
            <span>{generationStatusText}</span>
          </div>
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
      {resolvedNodeType === CANVAS_NODE_TYPES.textAnnotation ? (
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          className="!h-3 !w-3 !border-2 !border-white !bg-accent"
        />
      ) : null}
    </div>
  );
});

TextAnnotationNode.displayName = 'TextAnnotationNode';
