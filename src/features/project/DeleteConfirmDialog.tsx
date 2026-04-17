import { useTranslation } from 'react-i18next';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { useDraggableDialog } from '@/components/ui/useDraggableDialog';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  projectNames: string[];
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  isOpen,
  projectNames,
  onClose,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation();
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
    isPresent: shouldRender,
  });

  const count = projectNames.length;
  const isMultiple = count > 1;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

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
          onKeyDown={handleKeyDown}
        >
          <div
            className={`mb-4 ${dragHandleClassName}`}
            onPointerDown={handleDragStart}
          >
            <h2 className="text-lg font-semibold text-text-dark">
              {t('project.deleteConfirmTitle')}
            </h2>
          </div>

          <div className="mb-5">
            {isMultiple ? (
              <>
                <p className="mb-3 text-text-dark">
                  {t('project.deleteSelectedConfirmMessage', { count })}
                </p>
                <div className="ui-scrollbar max-h-32 overflow-y-auto rounded-lg bg-bg-dark/50 p-2">
                  <ul className="space-y-1 text-sm text-text-muted">
                    {projectNames.map((name, index) => (
                      <li key={index} className="truncate">
                        - {name}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <p className="text-text-dark">
                {t('project.deleteConfirmMessage', { name: projectNames[0] })}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-text-muted transition-colors hover:bg-bg-dark/50 hover:text-text-dark"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="rounded-lg bg-red-500 px-5 py-2 font-medium text-white shadow-lg shadow-red-500/20 transition-all hover:bg-red-600"
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
