import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Pencil, Trash2, Plus, X } from 'lucide-react';
import { useSettingsStore, StyleTemplate } from '@/stores/settingsStore';
import { UiButton, UiInput } from '@/components/ui';
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';

interface StyleTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EditTemplateModalProps {
  template?: StyleTemplate;
  onSave: (name: string, prompt: string) => void;
  onCancel: () => void;
}

function EditTemplateModal({ template, onSave, onCancel }: EditTemplateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(template?.name ?? '');
  const [prompt, setPrompt] = useState(template?.prompt ?? '');

  const handleSave = () => {
    if (name.trim() && prompt.trim()) {
      onSave(name.trim(), prompt.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-2xl">
        <h3 className="mb-4 text-base font-semibold text-text-dark">
          {template ? t('styleTemplate.editTemplate') : t('styleTemplate.newTemplate')}
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              {t('styleTemplate.templateName')}
            </label>
            <UiInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('styleTemplate.templateNamePlaceholder')}
              className="w-full"
            />
          </div>
          
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              {t('styleTemplate.templatePrompt')}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('styleTemplate.templatePromptPlaceholder')}
              className="h-32 w-full resize-none rounded-lg border border-border bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>
        </div>
        
        <div className="mt-5 flex justify-end gap-2">
          <UiButton variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </UiButton>
        <UiButton
          variant="primary"
          onClick={handleSave}
          disabled={!name.trim() || !prompt.trim()}
        >
          {t('common.save')}
        </UiButton>
        </div>
      </div>
    </div>
  );
}

export function StyleTemplateDialog({ isOpen, onClose }: StyleTemplateDialogProps) {
  const { t } = useTranslation();
  const { styleTemplates, addStyleTemplate, updateStyleTemplate, deleteStyleTemplate } = useSettingsStore();
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);
  
  const [editingTemplate, setEditingTemplate] = useState<StyleTemplate | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!shouldRender) return null;

  const handleCreate = () => {
    setShowCreateModal(true);
  };

  const handleSaveNew = (name: string, prompt: string) => {
    addStyleTemplate({ name, prompt });
    setShowCreateModal(false);
  };

  const handleSaveEdit = (name: string, prompt: string) => {
    if (editingTemplate) {
      updateStyleTemplate(editingTemplate.id, { name, prompt });
      setEditingTemplate(null);
    }
  };

  const handleDelete = (id: string) => {
    deleteStyleTemplate(id);
    setDeletingId(null);
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-150 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      >
        <div
          className={`w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl bg-surface shadow-2xl transition-transform duration-150 ${
            isVisible ? 'scale-100' : 'scale-95'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-accent" />
              <h2 className="text-base font-semibold text-text-dark">
                {t('styleTemplate.title')}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-dark"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="p-4">
            <UiButton
              variant="ghost"
              onClick={handleCreate}
              className="mb-4 w-full"
            >
              <Plus className="h-4 w-4" />
              {t('styleTemplate.newTemplate')}
            </UiButton>
            
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {styleTemplates.length === 0 ? (
                <div className="py-8 text-center text-sm text-text-muted">
                  {t('styleTemplate.emptyHint')}
                </div>
              ) : (
                styleTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="group rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent/30"
                  >
                    {deletingId === template.id ? (
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-text-dark">{t('styleTemplate.deleteConfirm')}</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDeletingId(null)}
                            className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            onClick={() => handleDelete(template.id)}
                            className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-text-dark">
                            {template.name}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-text-muted">
                            {template.prompt}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => setEditingTemplate(template)}
                            className="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-dark"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeletingId(template.id)}
                            className="rounded p-1.5 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <EditTemplateModal
          onSave={handleSaveNew}
          onCancel={() => setShowCreateModal(false)}
        />
      )}
      
      {editingTemplate && (
        <EditTemplateModal
          template={editingTemplate}
          onSave={handleSaveEdit}
          onCancel={() => setEditingTemplate(null)}
        />
      )}
    </>
  );
}
