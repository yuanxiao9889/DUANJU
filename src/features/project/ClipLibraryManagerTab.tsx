import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';

import { UiButton, UiInput, UiLoadingAnimation, UiLoadingBanner, UiPanel } from '@/components/ui';
import { openClipLibraryRoot } from '@/commands/clipLibrary';
import {
  CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
  emitToClipLibraryPanel,
  isClipLibraryPanelOpenBlocked,
  openClipLibraryPanelWindow,
  queueClipLibraryPanelLibrary,
} from '@/features/clip-library/application/clipLibraryPanelBridge';
import { useClipLibraryStore } from '@/stores/clipLibraryStore';
import { useProjectStore } from '@/stores/projectStore';

function describeDeleteImpact(
  t: (key: string, options?: Record<string, unknown>) => string,
  impact: { projectCount: number; nodeCount: number; folderCount: number; itemCount: number }
) {
  return t('clipLibraryManager.deleteImpact', {
    projects: impact.projectCount,
    nodes: impact.nodeCount,
    folders: impact.folderCount,
    items: impact.itemCount,
  });
}

export function ClipLibraryManagerTab() {
  const { t } = useTranslation();
  const currentProjectClipLibraryId = useProjectStore(
    (state) => state.currentProject?.clipLibraryId ?? null,
  );
  const setCurrentProjectClipLibrary = useProjectStore((state) => state.setCurrentProjectClipLibrary);
  const refreshProjectSummaries = useProjectStore((state) => state.refreshProjectSummaries);
  const hydrate = useClipLibraryStore((state) => state.hydrate);
  const libraries = useClipLibraryStore((state) => state.libraries);
  const currentLibraryId = useClipLibraryStore((state) => state.currentLibraryId);
  const isHydrated = useClipLibraryStore((state) => state.isHydrated);
  const isLoadingLibraries = useClipLibraryStore((state) => state.isLoadingLibraries);
  const loadLibrary = useClipLibraryStore((state) => state.loadLibrary);
  const createLibrary = useClipLibraryStore((state) => state.createLibrary);
  const renameLibrary = useClipLibraryStore((state) => state.renameLibrary);
  const removeLibrary = useClipLibraryStore((state) => state.removeLibrary);
  const getDeleteImpact = useClipLibraryStore((state) => state.getDeleteImpact);

  const [newLibraryName, setNewLibraryName] = useState('');
  const [newLibraryRootPath, setNewLibraryRootPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleCreateLibrary = async () => {
    const name = newLibraryName.trim();
    const rootPath = newLibraryRootPath.trim();
    if (!name || !rootPath || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const library = await createLibrary({ name, rootPath });
      setNewLibraryName('');
      setNewLibraryRootPath('');
      await loadLibrary(library.id);
    } catch (error) {
      console.error('Failed to create clip library', error);
      window.alert(t('clipLibraryManager.createLibraryFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectLibraryRootPath = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        defaultPath: newLibraryRootPath.trim() || undefined,
        title: t('clipLibraryManager.selectRootPathDialogTitle'),
      });

      if (typeof selectedPath === 'string' && selectedPath.trim()) {
        setNewLibraryRootPath(selectedPath.trim());
      }
    } catch (error) {
      console.error('Failed to select clip library root path', error);
      window.alert(t('clipLibraryManager.selectRootPathFailed'));
    }
  };

  const handleRenameLibrary = async (libraryId: string, currentName: string) => {
    const nextName = window.prompt(t('clipLibraryManager.renameLibraryPrompt'), currentName)?.trim();
    if (!nextName || nextName === currentName) {
      return;
    }

    try {
      await renameLibrary({ id: libraryId, name: nextName });
    } catch (error) {
      console.error('Failed to rename clip library', error);
      window.alert(t('clipLibraryManager.renameLibraryFailed'));
    }
  };

  const handleDeleteLibrary = async (libraryId: string, name: string) => {
    try {
      const impact = await getDeleteImpact({ libraryId });
      const confirmed = window.confirm(
        `${t('clipLibraryManager.deleteLibraryConfirm', { name })}\n\n${describeDeleteImpact(
          t,
          impact
        )}`
      );
      if (!confirmed) {
        return;
      }

      await removeLibrary(libraryId);
      await refreshProjectSummaries();
      if (currentProjectClipLibraryId === libraryId) {
        setCurrentProjectClipLibrary(null);
      }
    } catch (error) {
      console.error('Failed to delete clip library', error);
      window.alert(t('clipLibraryManager.deleteLibraryFailed'));
    }
  };

  const handleOpenSharedWindow = async (libraryId: string) => {
    if (isClipLibraryPanelOpenBlocked()) {
      return;
    }

    queueClipLibraryPanelLibrary(libraryId);
    try {
      await openClipLibraryPanelWindow(t('clipLibrary.windowTitle'));
      await emitToClipLibraryPanel(CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT, libraryId);
    } catch (error) {
      console.error('Failed to open clip library shared window', error);
      window.alert(t('clipLibraryManager.openWindowFailed'));
    }
  };

  const handleOpenRootPath = async (libraryId: string) => {
    try {
      await openClipLibraryRoot(libraryId);
    } catch (error) {
      console.error('Failed to open clip library root path', error);
      window.alert(t('clipLibraryManager.openRootFailed'));
    }
  };

  return (
    <div className="space-y-5">
      <UiPanel className="space-y-4 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-text-dark">
              <BookOpen className="h-4 w-4 text-accent" />
              {t('clipLibraryManager.title')}
            </div>
            <p className="mt-1 text-xs text-text-muted">{t('clipLibraryManager.subtitle')}</p>
          </div>
          {isLoadingLibraries ? <UiLoadingAnimation size="sm" /> : null}
        </div>

        <div className="grid gap-3 rounded-xl border border-border-dark/60 bg-bg-dark/40 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <UiInput
            value={newLibraryName}
            onChange={(event) => setNewLibraryName(event.target.value)}
            placeholder={t('clipLibraryManager.libraryNamePlaceholder')}
          />
          <button
            type="button"
            className="flex min-w-0 items-center gap-3 rounded-lg border ui-field px-3 py-3 text-left transition-colors hover:border-accent/45 hover:bg-white/[0.02]"
            onClick={() => void handleSelectLibraryRootPath()}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-text-muted">
              <FolderOpen className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-text-muted">
                {t('clipLibraryManager.libraryRootPathLabel')}
              </span>
              <span
                className={`mt-1 block truncate text-sm ${newLibraryRootPath ? 'text-text-dark' : 'text-text-muted'}`}
              >
                {newLibraryRootPath || t('clipLibraryManager.libraryRootPathPlaceholder')}
              </span>
            </span>
          </button>
          <UiButton
            type="button"
            variant="primary"
            className="gap-2"
            onClick={() => void handleCreateLibrary()}
            disabled={isSubmitting || !newLibraryName.trim() || !newLibraryRootPath.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('clipLibraryManager.createLibrary')}
          </UiButton>
        </div>
      </UiPanel>

      {!isHydrated ? <UiLoadingBanner /> : null}

      {libraries.length === 0 ? (
        <UiPanel className="rounded-xl border-dashed px-4 py-8 text-sm text-text-muted">
          {t('clipLibraryManager.emptyLibraries')}
        </UiPanel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {libraries.map((library) => {
            const isActive = currentLibraryId === library.id;
            return (
              <UiPanel
                key={library.id}
                className={`space-y-4 p-4 transition-colors ${isActive ? 'border-accent/45 bg-accent/10' : ''}`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => void loadLibrary(library.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-text-dark">
                        {library.name}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-text-muted">
                        {library.rootPath}
                      </div>
                    </div>
                    {isActive ? (
                      <span className="rounded-full border border-accent/35 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                        {t('clipLibraryManager.currentLibraryBadge')}
                      </span>
                    ) : null}
                  </div>
                </button>

                <div className="flex flex-wrap gap-2">
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={() => void handleOpenSharedWindow(library.id)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('clipLibraryManager.openWindow')}
                  </UiButton>
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={() => void handleOpenRootPath(library.id)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t('clipLibrary.openRoot')}
                  </UiButton>
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRenameLibrary(library.id, library.name)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </UiButton>
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDeleteLibrary(library.id, library.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </UiButton>
                </div>
              </UiPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}
