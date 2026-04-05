import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { FileText, Loader2, Undo2, Wand2 } from 'lucide-react';
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
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
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

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 180;
const MIN_WIDTH = 180;
const MIN_HEIGHT = 100;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;

interface TextOptimizationUndoState {
  previousContent: string;
  appliedContent: string;
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const content = typeof data.content === 'string' ? data.content : '';
  const contentRef = useRef(content);
  const [isOptimizingContent, setIsOptimizingContent] = useState(false);
  const [lastOptimizationUndoState, setLastOptimizationUndoState] =
    useState<TextOptimizationUndoState | null>(null);
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
  const handleMarkdownLinkClick = useCallback((href?: string) => {
    if (!href) {
      return;
    }
    void openUrl(href);
  }, []);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  const focusTextareaToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      const nextCursor = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, []);

  const handleOptimizeContent = useCallback(async () => {
    const sourceContent = contentRef.current;
    const normalizedSourceContent = sourceContent.trim();
    if (!normalizedSourceContent) {
      await showErrorDialog(
        t(`${translationKeyPrefix}.contentRequired`),
        t('common.error'),
      );
      return;
    }

    setIsOptimizingContent(true);
    try {
      const result = await optimizeCanvasPrompt({
        mode: 'dialogue',
        prompt: normalizedSourceContent,
      });

      if (contentRef.current !== sourceContent) {
        return;
      }

      const nextContent = result.prompt.trim();
      if (!nextContent) {
        throw new Error(t(`${translationKeyPrefix}.optimizePromptFailed`));
      }

      setLastOptimizationUndoState(
        nextContent === sourceContent
          ? null
          : {
              previousContent: sourceContent,
              appliedContent: nextContent,
            },
      );
      updateNodeData(id, { content: nextContent });
      focusTextareaToEnd();
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t(`${translationKeyPrefix}.optimizePromptFailed`);
      await showErrorDialog(message, t('common.error'));
    } finally {
      setIsOptimizingContent(false);
    }
  }, [focusTextareaToEnd, id, t, translationKeyPrefix, updateNodeData]);

  const handleUndoOptimizedContent = useCallback(() => {
    if (!lastOptimizationUndoState) {
      return;
    }

    if (contentRef.current !== lastOptimizationUndoState.appliedContent) {
      return;
    }

    setLastOptimizationUndoState(null);
    updateNodeData(id, { content: lastOptimizationUndoState.previousContent });
    focusTextareaToEnd();
  }, [focusTextareaToEnd, id, lastOptimizationUndoState, updateNodeData]);

  const canUndoOptimizedContent = Boolean(
    lastOptimizationUndoState &&
      content === lastOptimizationUndoState.appliedContent,
  );

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

      {selected ? (
        <textarea
          ref={textareaRef}
          autoFocus
          value={content}
          onChange={(event) => {
            const nextValue = event.target.value;
            updateNodeData(id, { content: nextValue });
          }}
          placeholder={t(`${translationKeyPrefix}.placeholder`)}
          className="nodrag nowheel h-full w-full resize-none border-none bg-transparent px-1 py-0.5 pb-10 pr-14 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70"
        />
      ) : (
        <div className="nodrag nowheel h-full w-full overflow-auto px-1 py-0.5 pb-10 text-sm leading-6 text-text-dark">
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

      {selected ? (
        <div className="pointer-events-none absolute bottom-2 right-2 z-20 flex items-center gap-1">
          <button
            type="button"
            title={
              isOptimizingContent
                ? t(`${translationKeyPrefix}.optimizingPrompt`)
                : t(`${translationKeyPrefix}.optimizePrompt`)
            }
            disabled={isOptimizingContent || content.trim().length === 0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleOptimizeContent();
            }}
            className="nodrag pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-black/55 text-text-dark shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm transition-colors hover:border-accent/45 hover:bg-accent/14 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-black/28 disabled:text-text-muted/45"
          >
            {isOptimizingContent ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" strokeWidth={2.25} />
            )}
          </button>
          {canUndoOptimizedContent ? (
            <button
              type="button"
              title={t(`${translationKeyPrefix}.undoOptimizedPrompt`)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleUndoOptimizedContent();
              }}
              className="nodrag pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-black/55 text-text-dark shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm transition-colors hover:border-white/22 hover:bg-white/10"
            >
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
    </div>
  );
});

TextAnnotationNode.displayName = 'TextAnnotationNode';
