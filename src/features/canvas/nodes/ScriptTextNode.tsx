import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { FileText, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { generateStoryboardScriptsFromText } from '@/commands/textGen';
import { UiButton, UiLoadingOverlay } from '@/components/ui';
import {
  CANVAS_NODE_TYPES,
  SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT,
  SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH,
  SCRIPT_TEXT_NODE_DEFAULT_HEIGHT,
  SCRIPT_TEXT_NODE_DEFAULT_WIDTH,
  type ScriptTextNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  useCanvasStore,
  type GeneratedScriptChapterInput,
} from '@/stores/canvasStore';

type ScriptTextNodeProps = NodeProps & {
  id: string;
  data: ScriptTextNodeData;
  selected?: boolean;
};

const MIN_WIDTH = 360;
const MIN_HEIGHT = 220;
const MAX_WIDTH = 960;
const MAX_HEIGHT = 960;
const SCRIPT_TEXT_INPUT_MAX_LENGTH = 3000;
const SCRIPT_TEXT_OUTPUT_LIMIT = 6;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function joinNonEmptyLines(lines: Array<string | null | undefined>): string {
  return lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter((line) => line.length > 0)
    .join('\n');
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export const ScriptTextNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ScriptTextNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addGeneratedScriptChapters = useCanvasStore((state) => state.addGeneratedScriptChapters);
  const content = typeof data.content === 'string' ? data.content : '';
  const isGenerating = data.isGenerating === true;
  const lastError = typeof data.lastError === 'string' ? data.lastError.trim() : '';
  const lastGeneratedAt = typeof data.lastGeneratedAt === 'number' ? data.lastGeneratedAt : null;
  const lastGeneratedCount = typeof data.lastGeneratedCount === 'number'
    ? Math.max(0, Math.floor(data.lastGeneratedCount))
    : 0;
  const remainingCharacters = SCRIPT_TEXT_INPUT_MAX_LENGTH - content.length;
  const showBlockingOverlay = isGenerating;
  const resolvedWidth = Math.max(
    MIN_WIDTH,
    Math.round(width ?? SCRIPT_TEXT_NODE_DEFAULT_WIDTH)
  );
  const resolvedHeight = Math.max(
    MIN_HEIGHT,
    Math.round(height ?? SCRIPT_TEXT_NODE_DEFAULT_HEIGHT)
  );
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptText, data);
  const generatedAtLabel = useMemo(() => {
    if (!lastGeneratedAt) {
      return '';
    }

    return new Date(lastGeneratedAt).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [i18n.language, lastGeneratedAt]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isGenerating, lastError, lastGeneratedAt, resolvedHeight, resolvedWidth, updateNodeInternals]);

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

  const handleGenerate = useCallback(async () => {
    if (isGenerating) {
      return;
    }

    const normalizedContent = content.trim();
    if (!normalizedContent) {
      updateNodeData(
        id,
        {
          lastError: t('node.scriptText.contentRequired'),
        },
        { historyMode: 'skip' }
      );
      focusTextareaToEnd();
      return;
    }

    updateNodeData(
      id,
      {
        isGenerating: true,
        lastError: null,
      },
      { historyMode: 'skip' }
    );

    try {
      const generatedScripts = await generateStoryboardScriptsFromText({
        content: normalizedContent,
        maxScripts: SCRIPT_TEXT_OUTPUT_LIMIT,
      });

      if (generatedScripts.length === 0) {
        throw new Error(t('node.scriptText.noResults'));
      }

      const chapterInputs: GeneratedScriptChapterInput[] = generatedScripts.map((script, index) => {
        const title = script.title.trim() || t('node.scriptText.defaultScriptTitle', { index: index + 1 });
        const summary = script.summary.trim();
        const plainContent = script.content.trim();
        const visualFocus = script.visualFocus.trim();
        const soundCue = script.soundCue.trim();
        const sceneHeading = script.sceneHeading.trim();

        return {
          title,
          summary,
          contentHtml: plainTextToHtml(plainContent),
          sceneTitle: title,
          sceneSummary: summary || sceneHeading || title,
          sceneHeading,
          characters: normalizeStringArray(script.characters),
          location: script.location.trim(),
          items: normalizeStringArray(script.props),
          visualHook: visualFocus,
          directorNotes: joinNonEmptyLines([visualFocus, soundCue]),
          sourceDraftLabel: t('node.scriptText.generatedDraftLabel'),
        };
      });

      const createdNodeIds = addGeneratedScriptChapters(
        id,
        chapterInputs,
        {
          nodeWidth: SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH,
          nodeHeight: SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT,
        }
      );

      if (createdNodeIds.length === 0) {
        throw new Error(t('node.scriptText.createNodeFailed'));
      }

      updateNodeData(
        id,
        {
          isGenerating: false,
          lastError: null,
          lastGeneratedAt: Date.now(),
          lastGeneratedCount: createdNodeIds.length,
        },
        { historyMode: 'skip' }
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.scriptText.generateFailed');
      updateNodeData(
        id,
        {
          isGenerating: false,
          lastError: message,
        },
        { historyMode: 'skip' }
      );
    }
  }, [addGeneratedScriptChapters, content, focusTextareaToEnd, id, isGenerating, t, updateNodeData]);

  return (
    <div
      className={`
        group relative h-full w-full overflow-visible rounded-[var(--node-radius)] border bg-surface-dark p-1.5 transition-colors duration-150
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
          maxLength={SCRIPT_TEXT_INPUT_MAX_LENGTH}
          onChange={(event) => {
            updateNodeData(id, {
              content: event.target.value,
            });
          }}
          placeholder={t('node.scriptText.placeholder')}
          className="nodrag nowheel h-full w-full resize-none border-none bg-transparent px-1 py-0.5 pb-24 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70"
        />
      ) : (
        <div className="nodrag nowheel h-full w-full overflow-auto whitespace-pre-wrap break-words px-1 py-0.5 pb-24 text-sm leading-6 text-text-dark">
          {content.trim().length > 0 ? content : (
            <div className="pt-1 text-text-muted">{t('node.scriptText.empty')}</div>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-text-muted">
          <span>
            {t('node.scriptText.charCount', {
              current: content.length,
              max: SCRIPT_TEXT_INPUT_MAX_LENGTH,
            })}
          </span>
          <span className={remainingCharacters <= 200 ? 'text-amber-200' : undefined}>
            {t('node.scriptText.outputLimit', { count: SCRIPT_TEXT_OUTPUT_LIMIT })}
          </span>
        </div>

        {(lastError || lastGeneratedCount > 0 || lastGeneratedAt) ? (
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-text-muted">
            {lastError ? (
              <div className="text-rose-300">{lastError}</div>
            ) : (
              <div>
                {t('node.scriptText.generatedSummary', {
                  count: lastGeneratedCount,
                  time: generatedAtLabel,
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="pointer-events-auto">
          <UiButton
            type="button"
            variant="primary"
            size="sm"
            className="h-10 w-full justify-center gap-2"
            disabled={isGenerating || content.trim().length === 0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerate();
            }}
          >
            <Sparkles className="h-4 w-4" />
            {isGenerating ? t('node.scriptText.generating') : t('node.scriptText.generate')}
          </UiButton>
        </div>
      </div>
      <UiLoadingOverlay visible={showBlockingOverlay} insetClassName="inset-3" />

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
    </div>
  );
});

ScriptTextNode.displayName = 'ScriptTextNode';
