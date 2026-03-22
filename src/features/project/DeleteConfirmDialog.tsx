import { useTranslation } from 'react-i18next';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';

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

  const count = projectNames.length;
  const isMultiple = count > 1;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[100] flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`relative w-96 rounded-2xl border border-border-dark/50 bg-surface-dark/95 backdrop-blur-md p-6 shadow-[0_24px_48px_rgba(0,0,0,0.25)] transition-all duration-200 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        onKeyDown={handleKeyDown}
      >
        <h2 className="text-lg font-semibold text-text-dark mb-4">
          {t('project.deleteConfirmTitle')}
        </h2>
        
        <div className="mb-5">
          {isMultiple ? (
            <>
              <p className="text-text-dark mb-3">
                {t('project.deleteSelectedConfirmMessage', { count })}
              </p>
              <div className="max-h-32 overflow-y-auto ui-scrollbar bg-bg-dark/50 rounded-lg p-2">
                <ul className="text-sm text-text-muted space-y-1">
                  {projectNames.map((name, index) => (
                    <li key={index} className="truncate">
                      • {name}
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
          <p className="text-sm text-red-400 mt-3">
            {t('project.emptyHint').includes('不可撤销') || isMultiple 
              ? '' 
              : ''}
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-text-muted hover:text-text-dark hover:bg-bg-dark/50 rounded-lg transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-5 py-2 rounded-lg font-medium bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
