import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ChapterCountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (count: number) => void;
}

export function ChapterCountDialog({ isOpen, onClose, onConfirm }: ChapterCountDialogProps) {
  const { t } = useTranslation();
  const [count, setCount] = useState(10);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (count >= 1) {
      onConfirm(count);
      setCount(10);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-surface-dark/95 backdrop-blur-md border border-border-dark/50 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-[0_24px_48px_rgba(0,0,0,0.25)]">
        <h2 className="text-lg font-semibold text-text-dark mb-4">
          {t('script.importChapterCount') || '导入剧本'}
        </h2>
        <p className="text-sm text-text-muted mb-4">
          {t('script.importChapterCountDesc') || '请输入章节数量，将创建对应数量的空章节节点'}
        </p>
        <input
          type="number"
          value={count}
          onChange={(e) => {
            const nextCount = Math.floor(Number(e.target.value));
            setCount(Number.isFinite(nextCount) && nextCount > 0 ? nextCount : 1);
          }}
          onKeyDown={handleKeyDown}
          min={1}
          className="w-full px-4 py-2.5 bg-bg-dark/80 border border-border-dark/50 rounded-xl text-text-dark placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
          autoFocus
        />
        <div className="flex justify-end gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-text-muted hover:text-text-dark hover:bg-bg-dark/50 rounded-lg transition-colors"
          >
            {t('common.cancel') || '取消'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 rounded-lg font-medium bg-accent text-white hover:bg-accent/85 shadow-lg shadow-accent/20 transition-all"
          >
            {t('common.confirm') || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
