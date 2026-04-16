import { useState } from 'react';
import { Film, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore, type ProjectType } from '@/stores/projectStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { UiButton } from '@/components/ui/primitives';
import { useDraggableDialog } from '@/components/ui/useDraggableDialog';

interface ProjectTypeSelectorProps {
  onClose: () => void;
  onSelectType: (type: ProjectType) => void;
}

export function ProjectTypeSelector({ onClose, onSelectType }: ProjectTypeSelectorProps) {
  const { t } = useTranslation();
  const {
    panelRef,
    overlayLayoutClassName,
    panelPositionClassName,
    panelStyle,
    dragHandleClassName,
    handleDragStart,
  } = useDraggableDialog({
    isOpen: true,
  });

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 ${overlayLayoutClassName}`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} className={panelPositionClassName} style={panelStyle}>
        <div className="relative w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-border-dark/50 bg-surface-dark/95 p-8 shadow-[0_24px_48px_rgba(0,0,0,0.25)] backdrop-blur-md">
          <div
            className={`mb-8 text-center ${dragHandleClassName}`}
            onPointerDown={handleDragStart}
          >
            <h2 className="text-2xl font-bold text-text-dark">{t('project.newProjectTitle')}</h2>
            <p className="mt-2 text-text-muted">{t('project.selectMode')}</p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-5">
            <button
              onClick={() => onSelectType('storyboard')}
              className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-border-dark/50 bg-bg-dark/30 p-6 transition-all duration-300 hover:border-accent/50 hover:bg-accent/5 hover:shadow-[0_8px_24px_rgba(59,130,246,0.15)]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-accent/10 transition-all group-hover:scale-110 group-hover:bg-accent/20">
                <Film className="h-8 w-8 text-accent" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-text-dark">{t('project.types.storyboard')}</h3>
              </div>
            </button>

            <button
              onClick={() => onSelectType('script')}
              className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-border-dark/50 bg-bg-dark/30 p-6 transition-all duration-300 hover:border-amber-500/50 hover:bg-amber-500/5 hover:shadow-[0_8px_24px_rgba(245,158,11,0.15)]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-amber-500/10 transition-all group-hover:scale-110 group-hover:bg-amber-500/20">
                <FileText className="h-8 w-8 text-amber-400" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-text-dark">{t('project.types.script')}</h3>
              </div>
            </button>
          </div>

          <UiButton variant="ghost" onClick={onClose} className="w-full">
            {t('common.cancel')}
          </UiButton>
        </div>
      </div>
    </div>
  );
}

interface CreateProjectDialogProps {
  projectType: ProjectType;
  isOpen: boolean;
  onClose: () => void;
}

export function CreateProjectDialog({ projectType, isOpen, onClose }: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const { createProject } = useProjectStore();
  const [name, setName] = useState('');
  const {
    panelRef,
    overlayLayoutClassName,
    panelPositionClassName,
    panelStyle,
    dragHandleClassName,
    handleDragStart,
  } = useDraggableDialog({
    isOpen,
  });

  if (!isOpen) {
    return null;
  }

  const handleConfirm = () => {
    if (!name.trim()) {
      return;
    }

    createProject(name.trim(), projectType);
    onClose();
    setName('');
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && name.trim()) {
      handleConfirm();
    }
  };

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 ${overlayLayoutClassName}`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} className={panelPositionClassName} style={panelStyle}>
        <div className="relative w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-border-dark/50 bg-surface-dark/95 p-8 shadow-[0_24px_48px_rgba(0,0,0,0.25)] backdrop-blur-md">
          <div
            className={`mb-5 ${dragHandleClassName}`}
            onPointerDown={handleDragStart}
          >
            <h2 className="text-xl font-bold text-text-dark">
              {t('project.newProjectTitle')} - {projectType === 'script' ? t('project.types.script') : t('project.types.storyboard')}
            </h2>
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-text-dark">
              {t('project.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('project.namePlaceholder')}
              className="w-full rounded-xl border border-border-dark/50 bg-bg-dark/80 px-4 py-2.5 text-text-dark outline-none transition-all placeholder:text-text-muted focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <UiButton variant="ghost" onClick={onClose} className="flex-1 rounded-xl">
              {t('common.cancel')}
            </UiButton>
            <UiButton
              variant="primary"
              onClick={handleConfirm}
              disabled={!name.trim()}
              className="flex-1 rounded-xl shadow-lg shadow-accent/20"
            >
              {t('common.confirm')}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
