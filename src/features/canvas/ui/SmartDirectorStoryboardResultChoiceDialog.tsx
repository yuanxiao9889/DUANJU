import { FilePlus2, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';

interface SmartDirectorStoryboardResultChoiceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (choice: 'reuse' | 'new') => void;
}

interface ChoiceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function ChoiceCard({
  title,
  description,
  icon,
  onClick,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-3xl border border-border-dark bg-surface-dark/80 p-4 text-left shadow-[0_18px_42px_rgba(15,23,42,0.14)] transition-all hover:-translate-y-0.5 hover:border-accent/45 hover:bg-accent/10"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent transition-colors group-hover:border-accent/40 group-hover:bg-accent/15">
          {icon}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-semibold text-text-dark">{title}</div>
          <div className="text-xs leading-5 text-text-muted">{description}</div>
        </div>
      </div>
    </button>
  );
}

export function SmartDirectorStoryboardResultChoiceDialog({
  isOpen,
  onClose,
  onSelect,
}: SmartDirectorStoryboardResultChoiceDialogProps) {
  const { t } = useTranslation();

  return (
    <UiModal
      isOpen={isOpen}
      title={t('project.smartDirectorStoryboard.resultChoiceDialog.title')}
      onClose={onClose}
      widthClassName="w-[calc(100vw-32px)] max-w-[560px]"
      footer={(
        <UiButton type="button" variant="ghost" onClick={onClose}>
          {t('project.smartDirectorStoryboard.resultChoiceDialog.cancel')}
        </UiButton>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-border-dark bg-bg-dark/35 px-4 py-3 text-sm leading-6 text-text-muted">
          {t('project.smartDirectorStoryboard.resultChoiceDialog.subtitle')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            title={t('project.smartDirectorStoryboard.resultChoiceDialog.reuseTitle')}
            description={t('project.smartDirectorStoryboard.resultChoiceDialog.reuseHint')}
            icon={<RefreshCcw className="h-5 w-5" />}
            onClick={() => onSelect('reuse')}
          />
          <ChoiceCard
            title={t('project.smartDirectorStoryboard.resultChoiceDialog.newTitle')}
            description={t('project.smartDirectorStoryboard.resultChoiceDialog.newHint')}
            icon={<FilePlus2 className="h-5 w-5" />}
            onClick={() => onSelect('new')}
          />
        </div>
      </div>
    </UiModal>
  );
}
