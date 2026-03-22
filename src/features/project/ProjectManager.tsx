import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FolderOpen, Pencil, Trash2, Film, FileText, CheckSquare, Square, X, Palette } from 'lucide-react';
import { useProjectStore, type ProjectType } from '@/stores/projectStore';
import { getConfiguredApiKeyCount, useSettingsStore } from '@/stores/settingsStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { UiButton, UiSelect } from '@/components/ui/primitives';
import { MissingApiKeyHint } from '@/features/settings/MissingApiKeyHint';
import { listModelProviders } from '@/features/canvas/models';
import { RenameDialog } from './RenameDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ProjectTypeSelector, CreateProjectDialog } from './ProjectTypeSelector';
import { StyleTemplateDialog } from './StyleTemplateDialog';

type ProjectSortField = 'name' | 'createdAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

export function ProjectManager() {
  const { t } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [sortField, setSortField] = useState<ProjectSortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const providerIds = useMemo(() => listModelProviders().map((provider) => provider.id), []);
  const configuredApiKeyCount = useSettingsStore((state) =>
    getConfiguredApiKeyCount(state.apiKeys, providerIds)
  );
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedProjectType, setSelectedProjectType] = useState<ProjectType | null>(null);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [showStyleTemplateDialog, setShowStyleTemplateDialog] = useState(false);

  const { projects, isOpeningProject, deleteProject, deleteProjects, renameProject, openProject } =
    useProjectStore();

  const handleCreateProject = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setShowTypeSelector(true);
  };

  const handleTypeSelected = (type: ProjectType) => {
    setSelectedProjectType(type);
    setShowTypeSelector(false);
  };

  const handleCreateDialogClose = () => {
    setSelectedProjectType(null);
  };

  const handleRenameClick = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(id);
    setEditingProjectName(name);
    setShowRenameDialog(true);
  };

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteIds([id]);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (pendingDeleteIds.length === 1) {
      deleteProject(pendingDeleteIds[0]);
    } else if (pendingDeleteIds.length > 1) {
      deleteProjects(pendingDeleteIds);
    }
    setPendingDeleteIds([]);
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedProjectIds(new Set());
    }
  };

  const handleEnterSelectMode = () => {
    setIsSelectMode(true);
    setSelectedProjectIds(new Set());
  };

  const handleExitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedProjectIds(new Set());
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedProjectIds.size === sortedProjects.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(sortedProjects.map((p) => p.id)));
    }
  };

  const handleDeleteSelected = () => {
    setPendingDeleteIds(Array.from(selectedProjectIds));
    setShowDeleteConfirm(true);
  };

  const handleCardClick = (id: string) => {
    if (isSelectMode) {
      setSelectedProjectIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    } else {
      openProject(id);
    }
  };

  const handleConfirm = (name: string) => {
    if (editingProjectId) {
      renameProject(editingProjectId, name);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const sortedProjects = useMemo(() => {
    const list = [...projects];
    const direction = sortDirection === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === 'name') {
        return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' }) * direction;
      }

      const left = sortField === 'createdAt' ? a.createdAt : a.updatedAt;
      const right = sortField === 'createdAt' ? b.createdAt : b.updatedAt;
      return (left - right) * direction;
    });

    return list;
  }, [projects, sortDirection, sortField]);

  const pendingDeleteNames = useMemo(() => {
    return pendingDeleteIds
      .map((id) => projects.find((p) => p.id === id)?.name)
      .filter((name): name is string => name !== undefined);
  }, [pendingDeleteIds, projects]);

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-dark">{t('project.title')}</h1>
            <div className="flex items-center gap-2">
              <UiSelect
                aria-label={t('project.sortBy')}
                value={sortField}
                onChange={(event) => setSortField(event.target.value as ProjectSortField)}
                className="h-9 w-[100px] rounded-lg text-sm"
              >
                <option value="name">{t('project.sortByName')}</option>
                <option value="createdAt">{t('project.sortByCreatedAt')}</option>
                <option value="updatedAt">{t('project.sortByUpdatedAt')}</option>
              </UiSelect>
              <UiSelect
                aria-label={t('project.sortDirection')}
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as SortDirection)}
                className="h-9 w-[60px] rounded-lg text-sm"
              >
                <option value="asc">{t('project.sortAsc')}</option>
                <option value="desc">{t('project.sortDesc')}</option>
              </UiSelect>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSelectMode ? (
              <>
                <UiButton
                  type="button"
                  variant="ghost"
                  onClick={handleSelectAll}
                  className="gap-2"
                >
                  {selectedProjectIds.size === sortedProjects.length
                    ? t('project.deselectAll')
                    : t('project.selectAll')}
                </UiButton>
                <UiButton
                  type="button"
                  variant="ghost"
                  onClick={handleExitSelectMode}
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  {t('project.exitSelectMode')}
                </UiButton>
                {selectedProjectIds.size > 0 && (
                  <UiButton
                    type="button"
                    variant="primary"
                    onClick={handleDeleteSelected}
                    className="gap-2 bg-red-500 hover:bg-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('project.deleteSelected')} ({selectedProjectIds.size})
                  </UiButton>
                )}
              </>
            ) : (
              <>
                {projects.length > 0 && (
                  <UiButton
                    type="button"
                    variant="ghost"
                    onClick={handleEnterSelectMode}
                    className="gap-2"
                  >
                    <CheckSquare className="w-5 h-5" />
                    {t('project.selectMode')}
                  </UiButton>
                )}
                <UiButton
                  type="button"
                  variant="ghost"
                  onClick={() => setShowStyleTemplateDialog(true)}
                  className="gap-2"
                >
                  <Palette className="w-5 h-5" />
                  {t('styleTemplate.title')}
                </UiButton>
                <UiButton type="button" variant="primary" onClick={handleCreateProject} className="gap-2">
                  <Plus className="w-5 h-5" />
                  {t('project.newProject')}
                </UiButton>
              </>
            )}
          </div>
        </div>

        {configuredApiKeyCount === 0 && <MissingApiKeyHint className="mb-8" />}

        {isSelectMode && selectedProjectIds.size > 0 && (
          <div className="mb-4 px-4 py-2 bg-accent/10 rounded-lg text-sm text-accent">
            {t('project.selectedCount', { count: selectedProjectIds.size })}
          </div>
        )}

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-accent/10 rounded-full blur-3xl scale-150" />
              <FolderOpen className="relative w-20 h-20 text-accent/50" />
            </div>
            <p className="text-xl text-text-dark font-medium">{t('project.empty')}</p>
            <p className="text-sm text-text-muted mt-2">{t('project.emptyHint')}</p>
            <UiButton variant="primary" onClick={handleCreateProject} className="mt-6 gap-2">
              <Plus className="w-4 h-4" />
              {t('project.newProject')}
            </UiButton>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sortedProjects.map((project) => {
              const isSelected = selectedProjectIds.has(project.id);
              return (
                <div
                  key={project.id}
                  onClick={() => handleCardClick(project.id)}
                  className={`
                    relative overflow-hidden
                    bg-surface-dark/80 backdrop-blur-sm
                    border rounded-xl p-5
                    cursor-pointer
                    transition-all duration-300 ease-out
                    hover:shadow-[0_8px_32px_rgba(0,0,0,0.15)]
                    hover:-translate-y-1
                    group
                    ${isSelected ? 'border-accent ring-2 ring-accent/30' : 'border-border-dark/50 hover:border-accent/40'}
                    ${isSelectMode ? 'hover:border-accent/40' : ''}
                  `}
                >
                  {isSelectMode && (
                    <div className="absolute top-3 right-3 z-10">
                      <button
                        type="button"
                        onClick={(e) => handleToggleSelect(project.id, e)}
                        className="p-1 rounded transition-colors"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-accent" />
                        ) : (
                          <Square className="w-5 h-5 text-text-muted hover:text-text-dark" />
                        )}
                      </button>
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        project.projectType === 'script' 
                          ? 'bg-amber-500/15' 
                          : 'bg-accent/15'
                      }`}>
                        {project.projectType === 'script' ? (
                          <FileText className="w-5 h-5 text-amber-400" />
                        ) : (
                          <Film className="w-5 h-5 text-accent" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-text-dark truncate">
                          {project.name}
                        </h3>
                      </div>
                    </div>
                    {!isSelectMode && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => handleRenameClick(project.id, project.name, e)}
                          className="p-1.5 hover:bg-bg-dark rounded-lg transition-colors"
                          title={t('project.rename')}
                        >
                          <Pencil className="w-4 h-4 text-text-muted hover:text-text-dark" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(project.id, e)}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                          title={t('project.delete')}
                        >
                          <Trash2 className="w-4 h-4 text-text-muted hover:text-red-400" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full ${
                      project.projectType === 'script' 
                        ? 'bg-amber-500/15 text-amber-400' 
                        : 'bg-accent/15 text-accent'
                    }`}>
                      {project.projectType === 'script' ? '剧本' : '分镜'}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted space-y-1">
                    <p className="flex items-center gap-1.5">
                      <span className="opacity-60">{t('project.modified')}:</span>
                      <span>{formatDate(project.updatedAt)}</span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="opacity-60">{t('project.created')}:</span>
                      <span>{formatDate(project.createdAt)}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isOpeningProject && (
        <div className={`pointer-events-none fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} bg-black/10`} />
      )}

      <RenameDialog
        isOpen={showRenameDialog}
        title={editingProjectId ? t('project.renameTitle') : t('project.newProjectTitle')}
        defaultValue={editingProjectName}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleConfirm}
      />

      <DeleteConfirmDialog
        isOpen={showDeleteConfirm}
        projectNames={pendingDeleteNames}
        onClose={() => {
          setShowDeleteConfirm(false);
          setPendingDeleteIds([]);
        }}
        onConfirm={handleConfirmDelete}
      />

      {showTypeSelector && (
        <ProjectTypeSelector
          onClose={() => setShowTypeSelector(false)}
          onSelectType={handleTypeSelected}
        />
      )}

      {selectedProjectType && (
        <CreateProjectDialog
          projectType={selectedProjectType}
          isOpen={true}
          onClose={handleCreateDialogClose}
        />
      )}

      <StyleTemplateDialog
        isOpen={showStyleTemplateDialog}
        onClose={() => setShowStyleTemplateDialog(false)}
      />
    </div>
  );
}
