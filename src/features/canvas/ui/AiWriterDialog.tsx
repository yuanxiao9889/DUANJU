import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, ArrowRight, GitFork } from 'lucide-react';
import { expandScript, rewriteScript, expandFromSummary, expandFromMergedBranches } from '@/commands/textGen';
import type { MergedBranchContent } from '@/commands/textGen';
import { UiButton, UiLoadingAnimation, UiLoadingBanner } from '@/components/ui';
import { useDraggableDialog } from '@/components/ui/useDraggableDialog';

function simpleMarkdownToHtml(text: string): string {
  let html = text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const blocks = html.split(/\n\n+/);
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h2>') || block.startsWith('<hr>')) {
      return block;
    }
    block = block.replace(/\n/g, '<br>');
    return `<p>${block}</p>`;
  }).join('\n');

  return html;
}

interface AiWriterDialogProps {
  isOpen: boolean;
  mode: 'expand' | 'rewrite' | 'expandFromSummary' | 'expandFromMerged';
  originalText: string;
  chapterTitle?: string;
  chapterNumber?: number;
  mergedBranchContents?: MergedBranchContent[];
  onClose: () => void;
  onConfirm: (result: string) => void;
  anchorRef?: React.RefObject<HTMLElement>;
  preferredPosition?: 'right' | 'left' | 'center';
}

export function AiWriterDialog({
  isOpen,
  mode,
  originalText,
  chapterTitle,
  chapterNumber,
  mergedBranchContents,
  onClose,
  onConfirm,
  anchorRef,
  preferredPosition = 'center',
}: AiWriterDialogProps) {
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dialogPosition, setDialogPosition] = useState<{ left?: number; right?: number; top?: number } | null>(null);
  const initialDialogPosition =
    dialogPosition?.left != null && dialogPosition?.top != null
      ? {
          x: dialogPosition.left,
          y: dialogPosition.top,
        }
      : null;
  const {
    panelRef,
    overlayLayoutClassName,
    panelPositionClassName,
    panelStyle,
    dragHandleClassName,
    handleDragStart,
  } = useDraggableDialog({
    isOpen,
    initialPosition: initialDialogPosition,
  });

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim() && mode === 'rewrite') {
      setError('请输入改写要求');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      let generatedText: string;
      if (mode === 'expand') {
        generatedText = await expandScript({
          content: originalText,
          instruction: instruction || '请扩写这段内容，使其更加丰富生动',
        });
      } else if (mode === 'expandFromSummary') {
        const rawText = await expandFromSummary({
          summary: originalText,
          chapterTitle: chapterTitle || '未命名章节',
          chapterNumber,
          instruction: instruction || undefined,
        });
        generatedText = simpleMarkdownToHtml(rawText);
      } else if (mode === 'expandFromMerged') {
        const rawText = await expandFromMergedBranches({
          summary: originalText,
          chapterTitle: chapterTitle || '未命名章节',
          chapterNumber,
          mergedBranches: mergedBranchContents || [],
          instruction: instruction || undefined,
        });
        generatedText = simpleMarkdownToHtml(rawText);
      } else {
        generatedText = await rewriteScript({
          content: originalText,
          requirement: instruction,
        });
      }
      setResult(generatedText);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [mode, originalText, instruction, chapterTitle, chapterNumber, mergedBranchContents]);

  const handleConfirm = useCallback(() => {
    if (result) {
      onConfirm(result);
      handleReset();
    }
  }, [result, onConfirm]);

  const handleReset = useCallback(() => {
    setInstruction('');
    setResult('');
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  useEffect(() => {
    if (!isOpen || !anchorRef?.current) {
      setDialogPosition(null);
      return;
    }

    const calculatePosition = () => {
      if (!anchorRef?.current) return;
      
      const anchorRect = anchorRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const dialogWidth = 400;
      const dialogHeight = 360;
      const gap = 8;

      console.log('[AiWriterDialog] 锚点位置:', {
        left: anchorRect.left,
        right: anchorRect.right,
        top: anchorRect.top,
        width: anchorRect.width,
        height: anchorRect.height,
        viewportWidth,
        viewportHeight,
        preferredPosition
      });

      let position: { left?: number; right?: number; top?: number } = {};

      // 计算水平位置 - 紧邻锚点显示
      if (preferredPosition === 'right') {
        // 放在锚点右侧，紧邻锚点
        position.left = anchorRect.right + gap;
        console.log('[AiWriterDialog] 初始 left:', position.left, 'anchorRect.right:', anchorRect.right, 'gap:', gap);
        // 如果超出视口右边界，则放在锚点左侧
        if (position.left + dialogWidth > viewportWidth - gap) {
          console.log('[AiWriterDialog] 超出右边界，调整到左侧');
          position.left = Math.max(gap, anchorRect.left - dialogWidth - gap);
        }
      } else if (preferredPosition === 'left') {
        // 放在锚点左侧
        position.left = Math.max(gap, anchorRect.left - dialogWidth - gap);
        // 如果超出视口左边界，则放在锚点右侧
        if (position.left < gap) {
          position.left = anchorRect.right + gap;
        }
      } else {
        // 居中显示
        position.left = Math.max(gap, (viewportWidth - dialogWidth) / 2);
      }

      // 计算垂直位置：弹窗顶部对齐锚点顶部（更紧凑）
      position.top = anchorRect.top;
      
      // 确保不超出视口底部
      if (position.top + dialogHeight > viewportHeight - gap) {
        position.top = Math.max(gap, viewportHeight - dialogHeight - gap);
      }

      console.log('[AiWriterDialog] 弹窗位置:', position);

      setDialogPosition(position);
    };

    // 使用 requestAnimationFrame 确保在浏览器绘制完成后获取位置
    let rafId: number;
    const timer = setTimeout(() => {
      rafId = requestAnimationFrame(() => {
        calculatePosition();
        // 再延迟一帧，确保位置稳定
        rafId = requestAnimationFrame(() => {
          calculatePosition();
        });
      });
    }, 0);
    
    window.addEventListener('resize', calculatePosition);
    return () => {
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', calculatePosition);
    };
  }, [isOpen, anchorRef, preferredPosition]);

  if (!isOpen) return null;

  // 如果锚点模式但位置还未计算好，显示透明遮罩等待定位
  const isPositioning = Boolean(anchorRef?.current && dialogPosition === null);
  const isAnchoredMode = Boolean(anchorRef?.current);

  return createPortal(
    <div className={`fixed inset-0 z-50 ${overlayLayoutClassName}`}>
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      {isPositioning ? (
        // 位置计算中，显示加载指示器
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          <UiLoadingBanner />
        </div>
      ) : (
        <div
          ref={panelRef}
          className={`bg-surface-dark border border-border-dark rounded-xl shadow-2xl max-h-[80vh] flex flex-col ${panelPositionClassName} ${
            isAnchoredMode
              ? 'w-[400px] max-w-[calc(100vw-16px)]'
              : 'w-[min(calc(100vw-2rem),42rem)] max-w-2xl'
          }`}
          style={panelStyle}
        >
          <div
            className={`flex items-center justify-between p-4 border-b border-border-dark ${dragHandleClassName}`}
            onPointerDown={handleDragStart}
          >
            <div className="flex items-center gap-2">
              {mode === 'expandFromMerged' ? (
                <GitFork className="w-5 h-5 text-cyan-400" />
              ) : (
                <Sparkles className="w-5 h-5 text-amber-400" />
              )}
              <h2 className="text-lg font-semibold text-text-dark">
                {mode === 'expandFromMerged' ? '基于分支融合扩写' :
                 mode === 'expandFromSummary' ? '基于摘要扩写' :
                 mode === 'expand' ? 'AI 扩写' : 'AI 改写'}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="p-1 hover:bg-bg-dark rounded text-text-muted hover:text-text-dark"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                原文
              </label>
              <div className="p-3 bg-bg-dark rounded-lg text-sm text-text-dark font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                {originalText}
              </div>
            </div>

            {mode === 'rewrite' && (
              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  改写要求
                </label>
                <input
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="例如：让语气更紧张、增加动作描写..."
                  className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {(mode === 'expand' || mode === 'expandFromSummary' || mode === 'expandFromMerged') && (
              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  扩写要求（可选）
                </label>
                <input
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={mode === 'expandFromMerged' ? '例如：融合所有分支、选择主线发展...' :
                              mode === 'expandFromSummary' ? '例如：增加对白、强化冲突...' :
                              '例如：增加细节描写、丰富人物心理...'}
                  className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {mergedBranchContents && mergedBranchContents.length > 0 && (
              <div className="border border-cyan-500/30 rounded-lg p-3 bg-cyan-500/5">
                <label className="block text-sm font-medium text-cyan-400 mb-2 flex items-center gap-2">
                  <GitFork className="w-4 h-4" />
                  已接入的分支内容 ({mergedBranchContents.length}个)
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {mergedBranchContents.map((branch, index) => (
                    <div key={index} className="p-2 bg-bg-dark rounded-lg text-xs border border-cyan-500/20">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-medium">
                          {branch.branchLabel || `分支${String.fromCharCode(65 + index)}`}
                        </span>
                        <span className="font-medium text-text-dark">
                          {branch.title}
                        </span>
                      </div>
                      <div className="text-text-muted line-clamp-2">
                        {branch.content || branch.summary}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            {result && (
              <div>
                <label className="block text-sm font-medium text-text-dark mb-2 flex items-center gap-2">
                  生成结果
                  <ArrowRight className="w-4 h-4 text-text-muted" />
                </label>
                <div className="p-3 bg-bg-dark rounded-lg text-sm text-text-dark font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-amber-500/30">
                  {result}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 p-4 border-t border-border-dark">
            <UiButton variant="ghost" onClick={handleClose}>
              取消
            </UiButton>
            {!result ? (
              <UiButton
                variant="primary"
                onClick={handleGenerate}
                disabled={isLoading}
                className="flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <UiLoadingAnimation size="sm" />
                    生成中...
                  </>
                ) : (
                  <>
                    {mode === 'expandFromMerged' ? <GitFork className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                    {mode === 'expandFromMerged' ? '开始融合扩写' :
                     mode === 'expandFromSummary' ? '开始扩写' :
                     mode === 'expand' ? '开始扩写' : '开始改写'}
                  </>
                )}
              </UiButton>
            ) : (
              <UiButton
                variant="primary"
                onClick={handleConfirm}
                className="flex items-center gap-2"
              >
                确认替换
              </UiButton>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
