import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { useDraggableDialog } from '@/components/ui/useDraggableDialog';

interface RenameDialogProps {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function RenameDialog({
  isOpen,
  title,
  defaultValue = '',
  onClose,
  onConfirm,
}: RenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultValue);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);
  const {
    panelRef,
    overlayLayoutClassName,
    panelPositionClassName,
    panelStyle,
    dragHandleClassName,
    isDragging,
    handleDragStart,
  } = useDraggableDialog({
    isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      setName(defaultValue);
    }
  }, [defaultValue, isOpen]);

  const handleConfirm = () => {
    if (!name.trim()) {
      return;
    }

    onConfirm(name.trim());
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleConfirm();
    } else if (event.key === 'Escape') {
      onClose();
    }
  };

  const canConfirm = Boolean(name.trim());

  if (!shouldRender) {
    return null;
  }

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[100] ${overlayLayoutClassName}`}>
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div ref={panelRef} className={panelPositionClassName} style={panelStyle}>
        <div
          className={`relative w-96 rounded-2xl border border-border-dark/50 bg-surface-dark/95 p-6 shadow-[0_24px_48px_rgba(0,0,0,0.25)] backdrop-blur-md ${isDragging ? 'transition-none' : 'transition-[opacity,transform] duration-200'} ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        >
          <div
            className={`mb-4 ${dragHandleClassName}`}
            onPointerDown={handleDragStart}
          >
            <h2 className="text-lg font-semibold text-text-dark">{title}</h2>
          </div>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('project.namePlaceholder')}
            className="w-full rounded-xl border border-border-dark/50 bg-bg-dark/80 px-4 py-2.5 text-text-dark outline-none transition-all placeholder:text-text-muted focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
            autoFocus
          />
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-text-muted transition-colors hover:bg-bg-dark/50 hover:text-text-dark"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={`rounded-lg px-5 py-2 font-medium transition-all ${
                canConfirm
                  ? 'bg-accent text-white shadow-lg shadow-accent/20 hover:bg-accent/85'
                  : 'cursor-not-allowed bg-bg-dark/50 text-text-muted'
              }`}
            >
              {t('common.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
