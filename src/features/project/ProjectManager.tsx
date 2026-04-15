import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare,
  FileText,
  Film,
  FolderOpen,
  Link2,
  Palette,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import { UiLoadingBanner } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { UiButton, UiSelect } from '@/components/ui/primitives';
import { MissingApiKeyHint } from '@/features/settings/MissingApiKeyHint';
import { getConfiguredApiKeyCount, useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore, type ProjectType } from '@/stores/projectStore';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ProjectTypeSelector, CreateProjectDialog } from './ProjectTypeSelector';
import { RenameDialog } from './RenameDialog';
import { StyleTemplateDialog } from './StyleTemplateDialog';

type ProjectSortField = 'name' | 'createdAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type ProjectManagerTab = 'projects' | 'assets';

const AssetManagerTab = lazy(() =>
  import('./AssetManagerTab').then((module) => ({
    default: module.AssetManagerTab,
  }))
);

function ProjectListView({
  sortField,
  sortDirection,
  setSortField,
  setSortDirection,
  handleCreateProject,
  handleEnterSelectMode,
  handleSelectAll,
  handleExitSelectMode,
  handleDeleteSelected,
  handleCardClick,
  handleToggleSelect,
  handleRenameClick,
  handleDeleteClick,
  handleLinkClick,
  isSelectMode,
  projects,
  selectedProjectIds,
  sortedProjects,
  configuredApiKeyCount,
  setShowStyleTemplateDialog,
  linkedStoryboardCountByScriptId,
  scriptProjects,
}: {
  sortField: ProjectSortField;
  sortDirection: SortDirection;
  setSortField: (value: ProjectSortField) => void;
  setSortDirection: (value: SortDirection) => void;
  handleCreateProject: () => void;
  handleEnterSelectMode: () => void;
  handleSelectAll: () => void;
  handleExitSelectMode: () => void;
  handleDeleteSelected: () => void;
  handleCardClick: (id: string) => void;
  handleToggleSelect: (id: string, e: ReactMouseEvent) => void;
  handleRenameClick: (id: string, name: string, e: ReactMouseEvent) => void;
  handleDeleteClick: (id: string, e: ReactMouseEvent) => void;
  handleLinkClick: (id: string, currentLinkedScriptProjectId: string | null, e: ReactMouseEvent) => void;
  isSelectMode: boolean;
  projects: ReturnType<typeof useProjectStore.getState>['projects'];
  selectedProjectIds: Set<string>;
  sortedProjects: ReturnType<typeof useProjectStore.getState>['projects'];
  configuredApiKeyCount: number;
  setShowStyleTemplateDialog: (open: boolean) => void;
  linkedStoryboardCountByScriptId: Map<string, number>;
  scriptProjects: ReturnType<typeof useProjectStore.getState>['projects'];
}) {
  const { t } = useTranslation();

  const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString();

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
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
        <div className="flex flex-wrap items-center gap-2">
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
                <X className="h-4 w-4" />
                {t('project.exitSelectMode')}
              </UiButton>
              {selectedProjectIds.size > 0 ? (
                <UiButton
                  type="button"
                  variant="primary"
                  onClick={handleDeleteSelected}
                  className="gap-2 bg-red-500 hover:bg-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('project.deleteSelected')} ({selectedProjectIds.size})
                </UiButton>
              ) : null}
            </>
          ) : (
            <>
              {projects.length > 0 ? (
                <UiButton
                  type="button"
                  variant="ghost"
                  onClick={handleEnterSelectMode}
                  className="gap-2"
                >
                  <CheckSquare className="h-5 w-5" />
                  {t('project.selectMode')}
                </UiButton>
              ) : null}
              <UiButton
                type="button"
                variant="ghost"
                onClick={() => setShowStyleTemplateDialog(true)}
                className="gap-2"
              >
                <Palette className="h-5 w-5" />
                {t('styleTemplate.title')}
              </UiButton>
              <UiButton
                type="button"
                variant="primary"
                onClick={handleCreateProject}
                className="gap-2"
              >
                <Plus className="h-5 w-5" />
                {t('project.newProject')}
              </UiButton>
            </>
          )}
        </div>
      </div>

      {configuredApiKeyCount === 0 ? <MissingApiKeyHint className="mb-8" /> : null}

      {isSelectMode && selectedProjectIds.size > 0 ? (
        <div className="mb-4 rounded-lg bg-accent/10 px-4 py-2 text-sm text-accent">
          {t('project.selectedCount', { count: selectedProjectIds.size })}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="relative mb-6">
            <div className="absolute inset-0 scale-150 rounded-full bg-accent/10 blur-3xl" />
            <FolderOpen className="relative h-20 w-20 text-accent/50" />
          </div>
          <p className="text-xl font-medium text-text-dark">{t('project.empty')}</p>
          <p className="mt-2 text-sm text-text-muted">{t('project.emptyHint')}</p>
          <UiButton variant="primary" onClick={handleCreateProject} className="mt-6 gap-2">
            <Plus className="h-4 w-4" />
            {t('project.newProject')}
          </UiButton>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sortedProjects.map((project) => {
            const isSelected = selectedProjectIds.has(project.id);
            const linkedScriptProject = project.linkedScriptProjectId
              ? scriptProjects.find((candidate) => candidate.id === project.linkedScriptProjectId) ?? null
              : null;
            const linkedStoryboardCount = linkedStoryboardCountByScriptId.get(project.id) ?? 0;
            return (
              <div
                key={project.id}
                onClick={() => handleCardClick(project.id)}
                className={`
                  group relative cursor-pointer overflow-hidden rounded-xl border bg-surface-dark/80 p-5 backdrop-blur-sm
                  transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(0,0,0,0.15)]
                  ${isSelected ? 'border-accent ring-2 ring-accent/30' : 'border-border-dark/50 hover:border-accent/40'}
                `}
              >
                {isSelectMode ? (
                  <div className="absolute right-3 top-3 z-10">
                    <button
                      type="button"
                      onClick={(event) => handleToggleSelect(project.id, event)}
                      className="rounded p-1 transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-accent" />
                      ) : (
                        <Square className="h-5 w-5 text-text-muted hover:text-text-dark" />
                      )}
                    </button>
                  </div>
                ) : null}

                <div className="mb-3 flex items-start justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        project.projectType === 'script' ? 'bg-amber-500/15' : 'bg-accent/15'
                      }`}
                    >
                      {project.projectType === 'script' ? (
                        <FileText className="h-5 w-5 text-amber-400" />
                      ) : (
                        <Film className="h-5 w-5 text-accent" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold text-text-dark">{project.name}</h3>
                    </div>
                  </div>

                  {!isSelectMode ? (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(event) => handleLinkClick(project.id, project.linkedScriptProjectId ?? null, event)}
                        className={`rounded-lg p-1.5 transition-colors ${
                          project.projectType === 'storyboard'
                            ? 'hover:bg-cyan-500/10'
                            : 'cursor-default opacity-40'
                        }`}
                        title={t('project.linkScript')}
                        disabled={project.projectType !== 'storyboard'}
                      >
                        <Link2 className="h-4 w-4 text-text-muted hover:text-cyan-300" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => handleRenameClick(project.id, project.name, event)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-bg-dark"
                        title={t('project.rename')}
                      >
                        <Pencil className="h-4 w-4 text-text-muted hover:text-text-dark" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => handleDeleteClick(project.id, event)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-red-500/10"
                        title={t('project.delete')}
                      >
                        <Trash2 className="h-4 w-4 text-text-muted hover:text-red-400" />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs ${
                      project.projectType === 'script'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-accent/15 text-accent'
                    }`}
                  >
                    {project.projectType === 'script'
                      ? t('project.types.script')
                      : t('project.types.storyboard')}
                  </span>
                </div>

                <div className="space-y-1 text-xs text-text-muted">
                  {project.projectType === 'storyboard' ? (
                    <p className="flex items-center gap-1.5">
                      <span className="opacity-60">{t('project.linkedScriptLabel')}:</span>
                      <span className={linkedScriptProject ? 'text-cyan-200' : ''}>
                        {linkedScriptProject?.name || t('project.linkedScriptEmpty')}
                      </span>
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5">
                      <span className="opacity-60">{t('project.linkedStoryboardCountLabel')}:</span>
                      <span>{t('project.linkedStoryboardCountValue', { count: linkedStoryboardCount })}</span>
                    </p>
                  )}
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
    </>
  );
}

function LinkScriptProjectDialog({
  isOpen,
  storyboardProject,
  scriptProjects,
  initialLinkedScriptProjectId,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  storyboardProject: ReturnType<typeof useProjectStore.getState>['projects'][number] | null;
  scriptProjects: ReturnType<typeof useProjectStore.getState>['projects'];
  initialLinkedScriptProjectId: string | null;
  onClose: () => void;
  onConfirm: (linkedScriptProjectId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [selectedScriptProjectId, setSelectedScriptProjectId] = useState(initialLinkedScriptProjectId ?? '');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedScriptProjectId(initialLinkedScriptProjectId ?? '');
  }, [initialLinkedScriptProjectId, isOpen]);

  if (!isOpen || !storyboardProject) {
    return null;
  }

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-border-dark/50 bg-surface-dark/95 p-6 shadow-[0_24px_48px_rgba(0,0,0,0.25)] backdrop-blur-md">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-text-dark">{t('project.linkScriptTitle')}</h2>
          <p className="mt-2 text-sm text-text-muted">
            {t('project.linkScriptDescription', { name: storyboardProject.name })}
          </p>
        </div>

        <label className="block">
          <div className="mb-2 text-sm font-medium text-text-dark">{t('project.linkScript')}</div>
          <UiSelect
            value={selectedScriptProjectId}
            onChange={(event) => setSelectedScriptProjectId(event.target.value)}
            className="h-11 w-full rounded-xl text-sm"
          >
            <option value="">{t('project.linkedScriptEmpty')}</option>
            {scriptProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </UiSelect>
        </label>

        {scriptProjects.length === 0 ? (
          <p className="mt-3 text-sm text-amber-200">{t('project.linkScriptNoScripts')}</p>
        ) : null}

        <div className="mt-6 flex gap-3">
          <UiButton variant="ghost" onClick={onClose} className="flex-1">
            {t('common.cancel')}
          </UiButton>
          <UiButton
            variant="ghost"
            onClick={() => onConfirm(null)}
            className="flex-1"
          >
            {t('project.unlinkScript')}
          </UiButton>
          <UiButton
            variant="primary"
            onClick={() => onConfirm(selectedScriptProjectId.trim() || null)}
            className="flex-1"
          >
            {t('common.confirm')}
          </UiButton>
        </div>
      </div>
    </div>
  );
}

export function ProjectManager() {
  const { t } = useTranslation();
  const projectsTabLabel = t('project.tabs.projects');
  const assetsTabLabel = t('project.tabs.assets');
  const configuredApiKeyCount = useSettingsStore((state) =>
    getConfiguredApiKeyCount({ ...state.scriptApiKeys, ...state.storyboardApiKeys })
  );

  const [activeTab, setActiveTab] = useState<ProjectManagerTab>('projects');
  const [assetTabLoaded, setAssetTabLoaded] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [sortField, setSortField] = useState<ProjectSortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedProjectType, setSelectedProjectType] = useState<ProjectType | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [showStyleTemplateDialog, setShowStyleTemplateDialog] = useState(false);
  const [linkDialogProjectId, setLinkDialogProjectId] = useState<string | null>(null);
  const [linkDialogLinkedScriptProjectId, setLinkDialogLinkedScriptProjectId] = useState<string | null>(null);

  const {
    projects,
    isOpeningProject,
    deleteProject,
    deleteProjects,
    renameProject,
    setProjectLinkedScriptProject,
    openProject,
  } =
    useProjectStore();

  const sortedProjects = useMemo(() => {
    const list = [...projects];
    const direction = sortDirection === 'asc' ? 1 : -1;

    list.sort((left, right) => {
      if (sortField === 'name') {
        return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' }) * direction;
      }

      const leftValue = sortField === 'createdAt' ? left.createdAt : left.updatedAt;
      const rightValue = sortField === 'createdAt' ? right.createdAt : right.updatedAt;
      return (leftValue - rightValue) * direction;
    });

    return list;
  }, [projects, sortDirection, sortField]);

  const pendingDeleteNames = useMemo(
    () =>
      pendingDeleteIds
        .map((id) => projects.find((project) => project.id === id)?.name)
        .filter((name): name is string => name !== undefined),
    [pendingDeleteIds, projects]
  );
  const scriptProjects = useMemo(
    () => projects.filter((project) => project.projectType === 'script'),
    [projects]
  );
  const linkedStoryboardCountByScriptId = useMemo(() => {
    const nextMap = new Map<string, number>();
    projects.forEach((project) => {
      if (project.projectType !== 'storyboard' || !project.linkedScriptProjectId) {
        return;
      }
      nextMap.set(
        project.linkedScriptProjectId,
        (nextMap.get(project.linkedScriptProjectId) ?? 0) + 1
      );
    });
    return nextMap;
  }, [projects]);
  const linkDialogProject = linkDialogProjectId
    ? projects.find((project) => project.id === linkDialogProjectId) ?? null
    : null;

  useEffect(() => {
    if (activeTab === 'assets') {
      setAssetTabLoaded(true);
    }
  }, [activeTab]);

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

  const handleRenameClick = (id: string, name: string, event: ReactMouseEvent) => {
    event.stopPropagation();
    setEditingProjectId(id);
    setEditingProjectName(name);
    setShowRenameDialog(true);
  };

  const handleDeleteClick = (id: string, event: ReactMouseEvent) => {
    event.stopPropagation();
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

  const handleToggleSelect = (id: string, event: ReactMouseEvent) => {
    event.stopPropagation();
    setSelectedProjectIds((previous) => {
      const next = new Set(previous);
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
      setSelectedProjectIds(new Set(sortedProjects.map((project) => project.id)));
    }
  };

  const handleDeleteSelected = () => {
    setPendingDeleteIds(Array.from(selectedProjectIds));
    setShowDeleteConfirm(true);
  };

  const handleCardClick = (id: string) => {
    if (isSelectMode) {
      setSelectedProjectIds((previous) => {
        const next = new Set(previous);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      return;
    }

    openProject(id);
  };

  const handleConfirmRename = (name: string) => {
    if (editingProjectId) {
      renameProject(editingProjectId, name);
    }
  };

  const handleLinkClick = (
    id: string,
    currentLinkedScriptProjectId: string | null,
    event: ReactMouseEvent,
  ) => {
    event.stopPropagation();
    setLinkDialogProjectId(id);
    setLinkDialogLinkedScriptProjectId(currentLinkedScriptProjectId);
  };

  return (
    <div className="ui-scrollbar h-full min-h-0 w-full overflow-y-auto overflow-x-hidden p-8">
      <div className="mx-auto max-w-6xl pb-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <UiButton
              type="button"
              size="sm"
              variant={activeTab === 'projects' ? 'primary' : 'ghost'}
              onClick={() => setActiveTab('projects')}
            >
              {projectsTabLabel}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant={activeTab === 'assets' ? 'primary' : 'ghost'}
              onClick={() => {
                setAssetTabLoaded(true);
                setActiveTab('assets');
              }}
            >
              {assetsTabLabel}
            </UiButton>
          </div>
        </div>

        {activeTab === 'projects' ? (
          <ProjectListView
            sortField={sortField}
            sortDirection={sortDirection}
            setSortField={setSortField}
            setSortDirection={setSortDirection}
            handleCreateProject={handleCreateProject}
            handleEnterSelectMode={handleEnterSelectMode}
            handleSelectAll={handleSelectAll}
            handleExitSelectMode={handleExitSelectMode}
            handleDeleteSelected={handleDeleteSelected}
            handleCardClick={handleCardClick}
            handleToggleSelect={handleToggleSelect}
            handleRenameClick={handleRenameClick}
            handleDeleteClick={handleDeleteClick}
            handleLinkClick={handleLinkClick}
            isSelectMode={isSelectMode}
            projects={projects}
            selectedProjectIds={selectedProjectIds}
            sortedProjects={sortedProjects}
            configuredApiKeyCount={configuredApiKeyCount}
            setShowStyleTemplateDialog={setShowStyleTemplateDialog}
            linkedStoryboardCountByScriptId={linkedStoryboardCountByScriptId}
            scriptProjects={scriptProjects}
          />
        ) : (
          <Suspense
            fallback={
              <div className="rounded-xl border border-border-dark bg-surface-dark/70 p-6">
                <UiLoadingBanner />
              </div>
            }
          >
            {assetTabLoaded ? <AssetManagerTab /> : null}
          </Suspense>
        )}
      </div>

      {isOpeningProject ? (
        <div className={`pointer-events-none fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} flex items-center justify-center bg-black/18 backdrop-blur-[2px]`}>
          <UiLoadingBanner />
        </div>
      ) : null}

      <RenameDialog
        isOpen={showRenameDialog}
        title={editingProjectId ? t('project.renameTitle') : t('project.newProjectTitle')}
        defaultValue={editingProjectName}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleConfirmRename}
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

      {showTypeSelector ? (
        <ProjectTypeSelector
          onClose={() => setShowTypeSelector(false)}
          onSelectType={handleTypeSelected}
        />
      ) : null}

      {selectedProjectType ? (
        <CreateProjectDialog
          projectType={selectedProjectType}
          isOpen={true}
          onClose={handleCreateDialogClose}
        />
      ) : null}

      <StyleTemplateDialog
        isOpen={showStyleTemplateDialog}
        onClose={() => setShowStyleTemplateDialog(false)}
      />

      <LinkScriptProjectDialog
        isOpen={Boolean(linkDialogProjectId)}
        storyboardProject={linkDialogProject}
        scriptProjects={scriptProjects}
        initialLinkedScriptProjectId={linkDialogLinkedScriptProjectId}
        onClose={() => {
          setLinkDialogProjectId(null);
          setLinkDialogLinkedScriptProjectId(null);
        }}
        onConfirm={(linkedScriptProjectId) => {
          if (!linkDialogProjectId) {
            return;
          }
          void setProjectLinkedScriptProject(linkDialogProjectId, linkedScriptProjectId);
          setLinkDialogProjectId(null);
          setLinkDialogLinkedScriptProjectId(null);
        }}
      />
    </div>
  );
}
