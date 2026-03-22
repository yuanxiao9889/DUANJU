import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X, Loader2, Check, Pencil, CheckCircle } from 'lucide-react';
import { generateBranches, type GeneratedBranch } from '@/commands/textGen';
import { UiButton } from '@/components/ui/primitives';
import type { ScriptChapterNodeData } from '@/features/canvas/domain/canvasNodes';

interface BranchPointDialogProps {
  isOpen: boolean;
  sourceNodeId: string;
  sourceChapterData: ScriptChapterNodeData;
  onClose: () => void;
  onConfirm: (branches: GeneratedBranch[]) => void;
}

export function BranchPointDialog({
  isOpen,
  sourceChapterData,
  onClose,
  onConfirm,
}: BranchPointDialogProps) {
  const { t } = useTranslation();
  const [branchCount, setBranchCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedBranches, setGeneratedBranches] = useState<GeneratedBranch[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editData, setEditData] = useState<GeneratedBranch | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setGeneratedBranches([]);
      setSelectedIndices(new Set());
      setEditingIndex(null);
      setError('');
    }
  }, [isOpen]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError('');
    setGeneratedBranches([]);
    setSelectedIndices(new Set());

    try {
      const branches = await generateBranches({
        chapterContent: sourceChapterData.content || sourceChapterData.summary || '',
        chapterTitle: sourceChapterData.title || `第${sourceChapterData.chapterNumber}章`,
        chapterNumber: sourceChapterData.chapterNumber,
        branchCount,
      });

      if (branches.length === 0) {
        setError(t('branch.generateFailed'));
        return;
      }

      setGeneratedBranches(branches);
      setSelectedIndices(new Set(branches.map((_, i) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('branch.generateFailed'));
    } finally {
      setIsGenerating(false);
    }
  }, [sourceChapterData, branchCount, t]);

  const toggleSelection = useCallback((index: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const startEditing = useCallback((index: number) => {
    setEditingIndex(index);
    setEditData({ ...generatedBranches[index] });
  }, [generatedBranches]);

  const saveEdit = useCallback(() => {
    if (editingIndex !== null && editData) {
      setGeneratedBranches(prev => {
        const next = [...prev];
        next[editingIndex] = editData;
        return next;
      });
      setEditingIndex(null);
      setEditData(null);
    }
  }, [editingIndex, editData]);

  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditData(null);
  }, []);

  const handleConfirm = useCallback(() => {
    const selectedBranches = generatedBranches.filter((_, i) => selectedIndices.has(i));
    if (selectedBranches.length > 0) {
      onConfirm(selectedBranches);
    }
  }, [generatedBranches, selectedIndices, onConfirm]);

  if (!isOpen) return null;

  const selectedCount = selectedIndices.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-dark border border-border-dark rounded-2xl max-w-2xl w-full mx-4 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border-dark">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-text-dark">
              {t('branch.createTitle')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-dark rounded text-text-muted hover:text-text-dark"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-text-dark">
              {t('branch.countLabel')}
            </label>
            <div className="flex gap-2">
              {[2, 3, 4].map(count => (
                <button
                  key={count}
                  onClick={() => setBranchCount(count)}
                  disabled={isGenerating}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    branchCount === count
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                      : 'bg-bg-dark text-text-muted border border-border-dark hover:border-purple-500/30'
                  }`}
                >
                  {count} {t('branch.countUnit')}
                </button>
              ))}
            </div>
          </div>

          <div className="text-sm text-text-muted">
            {t('branch.sourceChapter')}: 第{sourceChapterData.chapterNumber}章 {sourceChapterData.title}
          </div>

          <UiButton
            variant="primary"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('branch.generating')}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t('branch.generateButton')}
              </>
            )}
          </UiButton>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {generatedBranches.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm text-text-muted">
                {t('branch.selectHint')}
              </div>
              
              {generatedBranches.map((branch, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-xl border transition-all ${
                    selectedIndices.has(index)
                      ? 'border-purple-500/50 bg-purple-500/10'
                      : 'border-border-dark bg-bg-dark/50'
                  }`}
                >
                  {editingIndex === index ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editData?.title || ''}
                        onChange={e => setEditData(prev => prev ? { ...prev, title: e.target.value } : null)}
                        className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark"
                        placeholder={t('branch.titlePlaceholder')}
                      />
                      <textarea
                        value={editData?.summary || ''}
                        onChange={e => setEditData(prev => prev ? { ...prev, summary: e.target.value } : null)}
                        className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark resize-none"
                        rows={3}
                        placeholder={t('branch.summaryPlaceholder')}
                      />
                      <input
                        type="text"
                        value={editData?.condition || ''}
                        onChange={e => setEditData(prev => prev ? { ...prev, condition: e.target.value } : null)}
                        className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark"
                        placeholder={t('branch.conditionPlaceholder')}
                      />
                      <div className="flex gap-2">
                        <UiButton variant="ghost" onClick={cancelEdit} className="flex-1">
                          {t('common.cancel')}
                        </UiButton>
                        <UiButton variant="primary" onClick={saveEdit} className="flex-1">
                          {t('common.confirm')}
                        </UiButton>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => toggleSelection(index)}
                        className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedIndices.has(index)
                            ? 'border-purple-400 bg-purple-500/30'
                            : 'border-border-dark hover:border-purple-400/50'
                        }`}
                      >
                        {selectedIndices.has(index) && (
                          <Check className="w-3 h-3 text-purple-300" />
                        )}
                      </button>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-medium text-text-dark">
                            {t('branch.branchLabel')} {String.fromCharCode(65 + index)}: {branch.title}
                          </h4>
                          <button
                            onClick={() => startEditing(index)}
                            className="p-1 hover:bg-bg-dark rounded text-text-muted hover:text-text-dark"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-sm text-text-muted mt-1 line-clamp-2">
                          {branch.summary}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                            {branch.conditionType === 'choice' ? t('branch.typeChoice') :
                             branch.conditionType === 'random' ? t('branch.typeRandom') :
                             t('branch.typeCondition')}
                          </span>
                          <span className="text-xs text-text-muted">
                            {branch.condition}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-border-dark">
          <div className="text-sm text-text-muted">
            {generatedBranches.length > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-purple-400" />
                {t('branch.selectedCount', { count: selectedCount })}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <UiButton variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </UiButton>
            <UiButton
              variant="primary"
              onClick={handleConfirm}
              disabled={selectedCount === 0}
            >
              {t('branch.confirmCreate')}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
