import { useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, X, Loader2, ArrowRight } from 'lucide-react';
import { expandScript, rewriteScript } from '@/commands/textGen';
import { UiButton } from '@/components/ui/primitives';

interface AiWriterDialogProps {
  isOpen: boolean;
  mode: 'expand' | 'rewrite';
  originalText: string;
  onClose: () => void;
  onConfirm: (result: string) => void;
  anchorRef?: React.RefObject<HTMLElement>;
  preferredPosition?: 'right' | 'left' | 'center';
}

export function AiWriterDialog({
  isOpen,
  mode,
  originalText,
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
  const dialogRef = useRef<HTMLDivElement>(null);

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
  }, [mode, originalText, instruction]);

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
      const anchorRect = anchorRef.current!.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const dialogWidth = 400;
      const dialogHeight = 360;
      const gap = 8;

      let position: { left?: number; right?: number; top?: number } = {};

      if (preferredPosition === 'right') {
        position.left = anchorRect.right + gap;
      } else if (preferredPosition === 'left') {
        position.left = Math.max(gap, anchorRect.left - dialogWidth - gap);
      } else {
        position.left = Math.max(gap, (viewportWidth - dialogWidth) / 2);
      }

      if (position.left + dialogWidth > viewportWidth - gap) {
        position.left = Math.max(gap, anchorRect.left - dialogWidth - gap);
      }

      position.top = anchorRect.top;

      if (position.top + dialogHeight > viewportHeight - gap) {
        position.top = Math.max(gap, viewportHeight - dialogHeight - gap);
      }

      setDialogPosition(position);
    };

    calculatePosition();
    window.addEventListener('resize', calculatePosition);
    return () => window.removeEventListener('resize', calculatePosition);
  }, [isOpen, anchorRef, preferredPosition]);

  if (!isOpen) return null;

  const isPositioned = dialogPosition !== null && anchorRef?.current;

  return (
    <div className={`fixed inset-0 z-50 ${isPositioned ? '' : 'flex items-center justify-center'}`}>
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div
        ref={dialogRef}
        className="relative bg-surface-dark border border-border-dark rounded-xl max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col"
        style={isPositioned ? {
          position: 'fixed',
          left: dialogPosition.left,
          right: dialogPosition.right,
          top: dialogPosition.top,
          maxWidth: '400px',
          margin: 0,
        } : {}}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-dark">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-text-dark">
              {mode === 'expand' ? 'AI 扩写' : 'AI 改写'}
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

          {mode === 'expand' && (
            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                扩写要求（可选）
              </label>
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：增加细节描写、丰富人物心理..."
                className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500"
              />
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
                  <Loader2 className="w-4 h-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {mode === 'expand' ? '开始扩写' : '开始改写'}
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
    </div>
  );
}
