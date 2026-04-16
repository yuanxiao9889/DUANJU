import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioLines,
  Film,
  ImagePlus,
  MapPin,
  Package,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';

import {
  UiButton,
  UiIconButton,
  UiInput,
  UiLoadingAnimation,
  UiModal,
  UiPanel,
  UiSelect,
  UiTextArea,
} from '@/components/ui';
import {
  ASSET_CATEGORIES,
  type AssetCategory,
  type AssetMediaType,
  type AssetItemRecord,
  type AssetLibraryRecord,
  resolveAssetMediaType,
} from '@/features/assets/domain/types';
import {
  formatAudioDuration,
  isSupportedAudioFile,
  prepareNodeAudioFromFile,
  resolveAudioDisplayUrl,
} from '@/features/canvas/application/audioData';
import {
  prepareNodeImageFromFile,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import { useAssetStore } from '@/stores/assetStore';

type LibraryDialogState =
  | { mode: 'create'; library: null }
  | { mode: 'rename'; library: AssetLibraryRecord }
  | null;

type SubcategoryDialogState =
  | {
      mode: 'create';
      category: AssetCategory;
      subcategoryId: null;
      initialName: string;
    }
  | {
      mode: 'rename';
      category: AssetCategory;
      subcategoryId: string;
      initialName: string;
    }
  | null;

type AssetDialogState =
  | { mode: 'create'; category: AssetCategory; asset: null }
  | { mode: 'edit'; category: AssetCategory; asset: AssetItemRecord }
  | null;

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
}

interface AssetCategorySectionProps {
  category: AssetCategory;
  library: AssetLibraryRecord;
  onCreateSubcategory: (category: AssetCategory) => void;
  onRenameSubcategory: (subcategoryId: string, category: AssetCategory, name: string) => void;
  onDeleteSubcategory: (subcategoryId: string) => void;
  onCreateAsset: (category: AssetCategory) => void;
  onQuickImportAssets: (category: AssetCategory, files: File[]) => Promise<void>;
  onEditAsset: (asset: AssetItemRecord) => void;
  onDeleteAsset: (assetId: string) => void;
}

function resolveCategoryLabel(t: (key: string) => string, category: AssetCategory): string {
  return t(`assets.categories.${category}`);
}

function resolveDefaultAssetName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i.test(file.name);
}

function isVoiceCategory(category: AssetCategory): boolean {
  return resolveAssetMediaType(category) === 'audio';
}

function resolveDroppedFiles(dataTransfer: DataTransfer | null, category: AssetCategory): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter((file) =>
    isVoiceCategory(category) ? isSupportedAudioFile(file) : isImageFile(file)
  );
}

function hasDroppedFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  return Array.from(dataTransfer.types).includes('Files');
}

function resolveCategoryIcon(category: AssetCategory) {
  switch (category) {
    case 'character':
      return <UserRound className="h-4 w-4 text-amber-400" />;
    case 'scene':
      return <MapPin className="h-4 w-4 text-emerald-400" />;
    case 'prop':
      return <Package className="h-4 w-4 text-sky-400" />;
    case 'voice':
      return <AudioLines className="h-4 w-4 text-rose-400" />;
  }
}

function AssetCategorySection({
  category,
  library,
  onCreateSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  onCreateAsset,
  onQuickImportAssets,
  onEditAsset,
  onDeleteAsset,
}: AssetCategorySectionProps) {
  const { t } = useTranslation();
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [importingCount, setImportingCount] = useState(0);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const dragDepthRef = useRef(0);
  const subcategories = useMemo(
    () => library.subcategories.filter((subcategory) => subcategory.category === category),
    [category, library.subcategories]
  );
  const assets = useMemo(
    () => library.items.filter((item) => item.category === category),
    [category, library.items]
  );
  const subcategoryNameMap = useMemo(
    () =>
      new Map(
        subcategories.map((subcategory) => [subcategory.id, subcategory.name] as const)
      ),
    [subcategories]
  );
  const categoryLabel = resolveCategoryLabel(t, category);
  const categoryMediaType = resolveAssetMediaType(category);
  const isImporting = importingCount > 0;
  const filteredAssets = useMemo(
    () =>
      selectedSubcategoryId
        ? assets.filter((asset) => asset.subcategoryId === selectedSubcategoryId)
        : assets,
    [assets, selectedSubcategoryId]
  );

  useEffect(() => {
    if (!selectedSubcategoryId) {
      return;
    }

    if (!subcategories.some((subcategory) => subcategory.id === selectedSubcategoryId)) {
      setSelectedSubcategoryId('');
    }
  }, [selectedSubcategoryId, subcategories]);

  const resetDragState = () => {
    dragDepthRef.current = 0;
    setIsFileDragActive(false);
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (isImporting || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsFileDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (isImporting || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isFileDragActive) {
      setIsFileDragActive(true);
    }
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (isImporting || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsFileDragActive(false);
    }
  };

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    if (isImporting) {
      return;
    }

    const files = resolveDroppedFiles(event.dataTransfer, category);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    resetDragState();
    setImportingCount(files.length);
    try {
      await onQuickImportAssets(category, files);
    } finally {
      setImportingCount(0);
    }
  };

  return (
    <UiPanel
      className={`relative overflow-hidden !rounded-xl transition-[border-color,box-shadow,background-color] ${
        isFileDragActive || isImporting
          ? 'border-accent/40 bg-accent/[0.04] shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.18)]'
          : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      {isFileDragActive || isImporting ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[rgba(7,10,18,0.56)] px-6 text-center backdrop-blur-[1px]">
          <div className="rounded-xl border border-accent/30 bg-black/35 px-5 py-3">
            <div className="text-sm font-semibold text-text-dark">
              {isImporting
                ? t(
                    categoryMediaType === 'audio'
                      ? 'assets.importingAudioToCategory'
                      : 'assets.importingToCategory',
                    { count: importingCount, category: categoryLabel }
                  )
                : t(
                    categoryMediaType === 'audio'
                      ? 'assets.dropAudioToCategory'
                      : 'assets.dropImagesToCategory',
                    { category: categoryLabel }
                  )}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t('assets.dropImportAutoFill')}
            </div>
          </div>
        </div>
      ) : null}
      <div className="border-b border-[rgba(255,255,255,0.08)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04]">
              {resolveCategoryIcon(category)}
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-dark">
                {categoryLabel}
              </h3>
              <p className="text-xs text-text-muted">
                {t('assets.countSummary', {
                  assetCount: assets.length,
                  subcategoryCount: subcategories.length,
                })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => onCreateSubcategory(category)}
            >
              <Plus className="h-4 w-4" />
              {t('assets.addSubcategory')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              size="sm"
              className="gap-2"
              onClick={() => onCreateAsset(category)}
            >
              {categoryMediaType === 'audio' ? (
                <AudioLines className="h-4 w-4" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {t('assets.addAsset')}
            </UiButton>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-text-muted/80">
            {t('assets.subcategories')}
          </div>
          {subcategories.length === 0 ? (
            <p className="text-sm text-text-muted">{t('assets.emptySubcategories')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {subcategories.map((subcategory) => (
                <div
                  key={subcategory.id}
                  className={`flex items-center gap-2 rounded-full border px-2 py-1.5 text-sm transition-colors ${
                    selectedSubcategoryId === subcategory.id
                      ? 'border-accent/35 bg-accent/12 text-text-dark'
                      : 'border-[rgba(255,255,255,0.12)] bg-white/[0.04] text-text-dark'
                  }`}
                >
                  <button
                    type="button"
                    className={`rounded-full px-2 py-0.5 transition-colors ${
                      selectedSubcategoryId === subcategory.id
                        ? 'text-accent'
                        : 'text-text-dark hover:text-accent'
                    }`}
                    onClick={() =>
                      setSelectedSubcategoryId((current) =>
                        current === subcategory.id ? '' : subcategory.id
                      )
                    }
                    title={t('assets.filterBySubcategory', { name: subcategory.name })}
                  >
                    {subcategory.name}
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-text-muted transition-colors hover:bg-white/[0.08] hover:text-text-dark"
                    onClick={() =>
                      onRenameSubcategory(subcategory.id, category, subcategory.name)
                    }
                    title={t('common.edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => onDeleteSubcategory(subcategory.id)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {filteredAssets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[rgba(255,255,255,0.12)] px-5 py-10 text-center">
              <div className="text-sm text-text-muted">
                {selectedSubcategoryId ? t('assets.emptyFilterResult') : t('assets.emptyAssets')}
              </div>
              {!selectedSubcategoryId ? (
                <div className="mt-2 text-xs text-text-muted/80">
                  {t(
                    categoryMediaType === 'audio'
                      ? 'assets.dropAudioToCategory'
                      : 'assets.dropImagesToCategory',
                    { category: categoryLabel }
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="group w-full max-w-[220px] justify-self-start overflow-hidden rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03]"
                  title={asset.name}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-bg-dark/70">
                    {asset.mediaType === 'audio' ? (
                      <div className="flex h-full flex-col justify-between bg-[linear-gradient(160deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-rose-300">
                          <AudioLines className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <div className="truncate text-sm font-medium text-text-dark">
                            {asset.name}
                          </div>
                          <div className="text-xs text-text-muted">
                            {formatAudioDuration(asset.durationMs ? asset.durationMs / 1000 : null)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={resolveImageDisplayUrl(asset.previewPath || asset.sourcePath)}
                        alt={asset.name}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    )}
                    <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <UiIconButton
                        type="button"
                        className="h-8 w-8 border-none bg-black/45 text-white hover:bg-black/60"
                        onClick={() => onEditAsset(asset)}
                      >
                        <Pencil className="h-4 w-4" />
                      </UiIconButton>
                      <UiIconButton
                        type="button"
                        className="h-8 w-8 border-none bg-black/45 text-white hover:bg-red-500/70"
                        onClick={() => onDeleteAsset(asset.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </UiIconButton>
                    </div>
                  </div>
                  <div
                    className="border-t border-[rgba(255,255,255,0.08)] bg-black/10 px-2.5 py-1.5"
                    title={
                      asset.subcategoryId
                        ? (subcategoryNameMap.get(asset.subcategoryId) ?? t('assets.unassigned'))
                        : t('assets.unassigned')
                    }
                  >
                    <div className="truncate text-center text-[11px] font-medium leading-none text-text-muted/90">
                      {asset.name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </UiPanel>
  );
}

interface LibraryNameDialogProps {
  state: LibraryDialogState;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
}

function LibraryNameDialog({ state, onClose, onConfirm }: LibraryNameDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(state?.mode === 'rename' ? state.library.name : '');
  }, [state]);

  return (
    <UiModal
      isOpen={Boolean(state)}
      title={state?.mode === 'rename' ? t('assets.renameLibrary') : t('assets.createLibrary')}
      onClose={onClose}
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={value.trim().length === 0}
            onClick={() => void onConfirm(value.trim())}
          >
            {t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-muted">{t('assets.libraryNameHint')}</p>
        <UiInput
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('assets.libraryNamePlaceholder')}
        />
      </div>
    </UiModal>
  );
}

interface SubcategoryDialogProps {
  state: SubcategoryDialogState;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
}

function SubcategoryDialog({ state, onClose, onConfirm }: SubcategoryDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(state?.initialName ?? '');
  }, [state]);

  return (
    <UiModal
      isOpen={Boolean(state)}
      title={state?.mode === 'rename' ? t('assets.renameSubcategory') : t('assets.createSubcategory')}
      onClose={onClose}
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={value.trim().length === 0}
            onClick={() => void onConfirm(value.trim())}
          >
            {t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-muted">{t('assets.subcategoryNameHint')}</p>
        <UiInput
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('assets.subcategoryNamePlaceholder')}
        />
      </div>
    </UiModal>
  );
}

interface AssetEditorDialogProps {
  library: AssetLibraryRecord | null;
  state: AssetDialogState;
  onClose: () => void;
  onConfirm: (payload: {
    id?: string;
    category: AssetCategory;
    mediaType: AssetMediaType;
    subcategoryId: string | null;
    name: string;
    description: string;
    tags: string[];
    sourcePath: string;
    previewPath: string | null;
    mimeType: string | null;
    durationMs: number | null;
    aspectRatio: string;
    metadata: AssetItemRecord['metadata'];
  }) => Promise<void>;
}

function AssetEditorDialog({ library, state, onClose, onConfirm }: AssetEditorDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<AssetCategory>('character');
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [isPreparingSource, setIsPreparingSource] = useState(false);

  const mediaType = resolveAssetMediaType(category);

  useEffect(() => {
    if (!state) {
      return;
    }

    if (state.mode === 'edit') {
      setCategory(state.asset.category);
      setSubcategoryId(state.asset.subcategoryId ?? '');
      setName(state.asset.name);
      setDescription(state.asset.description);
      setTagsText(state.asset.tags.join(', '));
      setSourcePath(state.asset.sourcePath);
      setPreviewPath(state.asset.previewPath);
      setMimeType(state.asset.mimeType);
      setDurationMs(state.asset.durationMs);
      setAspectRatio(state.asset.aspectRatio);
      return;
    }

    setCategory(state.category);
    setSubcategoryId('');
    setName('');
    setDescription('');
    setTagsText('');
    setSourcePath('');
    setPreviewPath(null);
    setMimeType(null);
    setDurationMs(null);
    setAspectRatio('1:1');
  }, [state]);

  const availableCategories = useMemo(() => {
    if (!state) {
      return ASSET_CATEGORIES.filter((option) => resolveAssetMediaType(option) === mediaType);
    }

    const baseMediaType =
      state.mode === 'edit'
        ? state.asset.mediaType
        : resolveAssetMediaType(state.category);

    return ASSET_CATEGORIES.filter((option) => resolveAssetMediaType(option) === baseMediaType);
  }, [mediaType, state]);

  const subcategoryOptions = useMemo(
    () =>
      (library?.subcategories ?? []).filter((subcategory) => subcategory.category === category),
    [category, library?.subcategories]
  );

  useEffect(() => {
    if (!subcategoryId) {
      return;
    }

    if (!subcategoryOptions.some((subcategory) => subcategory.id === subcategoryId)) {
      setSubcategoryId('');
    }
  }, [subcategoryId, subcategoryOptions]);

  const handleSelectSource = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsPreparingSource(true);
    try {
      if (mediaType === 'audio') {
        const prepared = await prepareNodeAudioFromFile(file);
        setSourcePath(prepared.audioUrl);
        setPreviewPath(prepared.previewImageUrl);
        setMimeType(prepared.mimeType);
        setDurationMs(Math.round(prepared.duration * 1000));
        setAspectRatio('1:1');
      } else {
        const prepared = await prepareNodeImageFromFile(file);
        setSourcePath(prepared.imageUrl);
        setPreviewPath(prepared.previewImageUrl);
        setMimeType(file.type.trim() || null);
        setDurationMs(null);
        setAspectRatio(prepared.aspectRatio);
      }
      if (state?.mode === 'create' && name.trim().length === 0) {
        setName(resolveDefaultAssetName(file.name) || t('assets.untitledAsset'));
      }
    } catch (error) {
      console.error('Failed to prepare asset media', error);
    } finally {
      setIsPreparingSource(false);
      event.target.value = '';
    }
  };

  const canSubmit =
    Boolean(library) &&
    name.trim().length > 0 &&
    sourcePath.trim().length > 0 &&
    (mediaType === 'audio' || Boolean(previewPath?.trim())) &&
    !isPreparingSource;

  return (
    <UiModal
      isOpen={Boolean(state)}
      title={state?.mode === 'edit' ? t('assets.editAsset') : t('assets.createAsset')}
      onClose={onClose}
      widthClassName="w-[640px]"
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() =>
              void onConfirm({
                id: state?.mode === 'edit' ? state.asset.id : undefined,
                category,
                mediaType,
                subcategoryId: subcategoryId || null,
                name: name.trim(),
                description: description.trim(),
                tags: tagsText
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                sourcePath,
                previewPath,
                mimeType,
                durationMs,
                aspectRatio,
                metadata: state?.mode === 'edit' ? state.asset.metadata : null,
              })
            }
          >
            {t('common.save')}
          </UiButton>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/70">
            <div className="aspect-[4/3]">
              {mediaType === 'audio' ? (
                sourcePath ? (
                  <div className="flex h-full flex-col justify-between p-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] text-rose-300">
                      <AudioLines className="h-6 w-6" />
                    </div>
                    <div className="space-y-2">
                      <div className="truncate text-sm font-medium text-text-dark">
                        {name || t('assets.previewAlt')}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatAudioDuration(durationMs ? durationMs / 1000 : null)}
                      </div>
                      <audio
                        controls
                        src={resolveAudioDisplayUrl(sourcePath)}
                        className="h-10 w-full"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-text-muted">
                    {t('assets.previewAudioEmpty')}
                  </div>
                )
              ) : previewPath || sourcePath ? (
                <img
                  src={resolveImageDisplayUrl(previewPath || sourcePath)}
                  alt={name || t('assets.previewAlt')}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  {t('assets.previewEmpty')}
                </div>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={mediaType === 'audio' ? 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm' : 'image/*'}
            className="hidden"
            onChange={handleSelectSource}
          />
          <UiButton
            type="button"
            variant="ghost"
            className="w-full gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPreparingSource}
          >
            {mediaType === 'audio' ? (
              <AudioLines className="h-4 w-4" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            {isPreparingSource
              ? t(mediaType === 'audio' ? 'assets.preparingAudio' : 'assets.preparingImage')
              : t(mediaType === 'audio' ? 'assets.selectAudio' : 'assets.selectImage')}
          </UiButton>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
                {t('assets.category')}
              </label>
              <UiSelect value={category} onChange={(event) => setCategory(event.target.value as AssetCategory)}>
                {availableCategories.map((option) => (
                  <option key={option} value={option}>
                    {resolveCategoryLabel(t, option)}
                  </option>
                ))}
              </UiSelect>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
                {t('assets.subcategory')}
              </label>
              <UiSelect value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}>
                <option value="">{t('assets.unassigned')}</option>
                {subcategoryOptions.map((subcategory) => (
                  <option key={subcategory.id} value={subcategory.id}>
                    {subcategory.name}
                  </option>
                ))}
              </UiSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('assets.assetName')}
            </label>
            <UiInput value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('assets.tags')}
            </label>
            <UiInput
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder={t('assets.tagsPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('assets.description')}
            </label>
            <UiTextArea
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('assets.descriptionPlaceholder')}
            />
          </div>
        </div>
      </div>
    </UiModal>
  );
}

export function AssetManagerTab() {
  const { t } = useTranslation();
  const libraries = useAssetStore((state) => state.libraries);
  const isLoading = useAssetStore((state) => state.isLoading);
  const hydrate = useAssetStore((state) => state.hydrate);
  const createLibrary = useAssetStore((state) => state.createLibrary);
  const renameLibrary = useAssetStore((state) => state.renameLibrary);
  const deleteLibrary = useAssetStore((state) => state.deleteLibrary);
  const createSubcategory = useAssetStore((state) => state.createSubcategory);
  const renameSubcategory = useAssetStore((state) => state.renameSubcategory);
  const deleteSubcategory = useAssetStore((state) => state.deleteSubcategory);
  const createItem = useAssetStore((state) => state.createItem);
  const updateItem = useAssetStore((state) => state.updateItem);
  const deleteItem = useAssetStore((state) => state.deleteItem);

  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('');
  const [libraryDialogState, setLibraryDialogState] = useState<LibraryDialogState>(null);
  const [subcategoryDialogState, setSubcategoryDialogState] =
    useState<SubcategoryDialogState>(null);
  const [assetDialogState, setAssetDialogState] = useState<AssetDialogState>(null);
  const [confirmDialogState, setConfirmDialogState] = useState<ConfirmDialogState | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (libraries.length === 0) {
      setSelectedLibraryId('');
      return;
    }

    if (!libraries.some((library) => library.id === selectedLibraryId)) {
      setSelectedLibraryId(libraries[0].id);
    }
  }, [libraries, selectedLibraryId]);

  const selectedLibrary =
    libraries.find((library) => library.id === selectedLibraryId) ?? null;

  const handleConfirmLibrary = async (name: string) => {
    if (!libraryDialogState) {
      return;
    }

    if (libraryDialogState.mode === 'create') {
      const library = await createLibrary(name);
      setSelectedLibraryId(library.id);
    } else {
      await renameLibrary(libraryDialogState.library.id, name);
    }

    setLibraryDialogState(null);
  };

  const handleConfirmSubcategory = async (name: string) => {
    if (!subcategoryDialogState || !selectedLibrary) {
      return;
    }

    if (subcategoryDialogState.mode === 'create') {
      await createSubcategory(selectedLibrary.id, subcategoryDialogState.category, name);
    } else {
      await renameSubcategory(subcategoryDialogState.subcategoryId, name);
    }

    setSubcategoryDialogState(null);
  };

  const handleConfirmAsset = async (payload: {
    id?: string;
    category: AssetCategory;
    mediaType: AssetMediaType;
    subcategoryId: string | null;
    name: string;
    description: string;
    tags: string[];
    sourcePath: string;
    previewPath: string | null;
    mimeType: string | null;
    durationMs: number | null;
    aspectRatio: string;
    metadata: AssetItemRecord['metadata'];
  }) => {
    if (!selectedLibrary) {
      return;
    }

    if (payload.id) {
      await updateItem({
        id: payload.id,
        libraryId: selectedLibrary.id,
        category: payload.category,
        mediaType: payload.mediaType,
        subcategoryId: payload.subcategoryId,
        name: payload.name,
        description: payload.description,
        tags: payload.tags,
        sourcePath: payload.sourcePath,
        previewPath: payload.previewPath,
        mimeType: payload.mimeType,
        durationMs: payload.durationMs,
        aspectRatio: payload.aspectRatio,
        metadata: payload.metadata,
      });
    } else {
      await createItem({
        libraryId: selectedLibrary.id,
        category: payload.category,
        mediaType: payload.mediaType,
        subcategoryId: payload.subcategoryId,
        name: payload.name,
        description: payload.description,
        tags: payload.tags,
        sourcePath: payload.sourcePath,
        previewPath: payload.previewPath,
        mimeType: payload.mimeType,
        durationMs: payload.durationMs,
        aspectRatio: payload.aspectRatio,
        metadata: payload.metadata,
      });
    }

    setAssetDialogState(null);
  };

  const handleQuickImportAssets = async (category: AssetCategory, files: File[]) => {
    if (!selectedLibrary || files.length === 0) {
      return;
    }

    for (const file of files) {
      try {
        const mediaType = resolveAssetMediaType(category);
        if (mediaType === 'audio') {
          const prepared = await prepareNodeAudioFromFile(file);
          await createItem({
            libraryId: selectedLibrary.id,
            category,
            mediaType,
            subcategoryId: null,
            name: resolveDefaultAssetName(file.name) || t('assets.untitledAsset'),
            description: '',
            tags: [],
            sourcePath: prepared.audioUrl,
            previewPath: prepared.previewImageUrl,
            mimeType: prepared.mimeType,
            durationMs: Math.round(prepared.duration * 1000),
            aspectRatio: '1:1',
            metadata: null,
          });
          continue;
        }

        const prepared = await prepareNodeImageFromFile(file);
        await createItem({
          libraryId: selectedLibrary.id,
          category,
          mediaType,
          subcategoryId: null,
          name: resolveDefaultAssetName(file.name) || t('assets.untitledAsset'),
          description: '',
          tags: [],
          sourcePath: prepared.imageUrl,
          previewPath: prepared.previewImageUrl,
          mimeType: file.type.trim() || null,
          durationMs: null,
          aspectRatio: prepared.aspectRatio,
          metadata: null,
        });
      } catch (error) {
        console.error('Failed to import dropped asset image', {
          category,
          fileName: file.name,
          error,
        });
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-text-dark">{t('assets.title')}</h2>
          <p className="mt-1 text-sm text-text-muted">{t('assets.subtitle')}</p>
        </div>
        <UiButton
          type="button"
          variant="primary"
          className="gap-2"
          onClick={() => setLibraryDialogState({ mode: 'create', library: null })}
        >
          <Film className="h-4 w-4" />
          {t('assets.createLibrary')}
        </UiButton>
      </div>

      {libraries.length === 0 ? (
        <UiPanel className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-6 py-12 text-center !rounded-xl">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <Film className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-dark">{t('assets.emptyTitle')}</h3>
            <p className="mt-2 max-w-md text-sm text-text-muted">{t('assets.emptyHint')}</p>
          </div>
          <UiButton
            type="button"
            variant="primary"
            className="gap-2"
            onClick={() => setLibraryDialogState({ mode: 'create', library: null })}
          >
            <Plus className="h-4 w-4" />
            {t('assets.createLibrary')}
          </UiButton>
        </UiPanel>
      ) : (
        <>
          <UiPanel className="px-4 py-3.5 !rounded-xl">
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-[minmax(0,260px)_1fr_auto_auto] md:items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
                  {t('assets.library')}
                </label>
                <UiSelect
                  value={selectedLibraryId}
                  onChange={(event) => setSelectedLibraryId(event.target.value)}
                >
                  {libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name}
                    </option>
                  ))}
                </UiSelect>
              </div>

              <div className="text-sm text-text-muted md:pb-0.5">
                {selectedLibrary
                  ? t('assets.libraryMeta', {
                      count: selectedLibrary.items.length,
                      updatedAt: new Date(selectedLibrary.updatedAt).toLocaleDateString(),
                    })
                  : null}
              </div>

              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                className="gap-2"
                disabled={!selectedLibrary}
                onClick={() =>
                  selectedLibrary
                    ? setLibraryDialogState({ mode: 'rename', library: selectedLibrary })
                    : undefined
                }
              >
                <Pencil className="h-4 w-4" />
                {t('assets.renameLibrary')}
              </UiButton>

              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                className="gap-2 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                disabled={!selectedLibrary}
                onClick={() => {
                  if (!selectedLibrary) {
                    return;
                  }
                  setConfirmDialogState({
                    title: t('common.delete'),
                    message: t('assets.deleteLibraryConfirm', { name: selectedLibrary.name }),
                    onConfirm: async () => {
                      await deleteLibrary(selectedLibrary.id);
                    },
                  });
                }}
              >
                <Trash2 className="h-4 w-4" />
                {t('common.delete')}
              </UiButton>
            </div>
          </UiPanel>

          {selectedLibrary ? (
            <div className="space-y-6">
              {ASSET_CATEGORIES.map((category) => (
                <AssetCategorySection
                  key={category}
                  category={category}
                  library={selectedLibrary}
                  onCreateSubcategory={(nextCategory) =>
                    setSubcategoryDialogState({
                      mode: 'create',
                      category: nextCategory,
                      subcategoryId: null,
                      initialName: '',
                    })
                  }
                  onRenameSubcategory={(subcategoryId, nextCategory, name) =>
                    setSubcategoryDialogState({
                      mode: 'rename',
                      category: nextCategory,
                      subcategoryId,
                      initialName: name,
                    })
                  }
                  onDeleteSubcategory={(subcategoryId) =>
                    setConfirmDialogState({
                      title: t('common.delete'),
                      message: t('assets.deleteSubcategoryConfirm'),
                      onConfirm: async () => {
                        await deleteSubcategory(subcategoryId);
                      },
                    })
                  }
                  onCreateAsset={(nextCategory) =>
                    setAssetDialogState({
                      mode: 'create',
                      category: nextCategory,
                      asset: null,
                    })
                  }
                  onQuickImportAssets={handleQuickImportAssets}
                  onEditAsset={(asset) =>
                    setAssetDialogState({
                      mode: 'edit',
                      category: asset.category,
                      asset,
                    })
                  }
                  onDeleteAsset={(assetId) =>
                    setConfirmDialogState({
                      title: t('common.delete'),
                      message: t('assets.deleteAssetConfirm'),
                      onConfirm: async () => {
                        await deleteItem(assetId);
                      },
                    })
                  }
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      {isLoading ? <UiLoadingAnimation size="md" /> : null}

      <LibraryNameDialog
        state={libraryDialogState}
        onClose={() => setLibraryDialogState(null)}
        onConfirm={handleConfirmLibrary}
      />
      <SubcategoryDialog
        state={subcategoryDialogState}
        onClose={() => setSubcategoryDialogState(null)}
        onConfirm={handleConfirmSubcategory}
      />
      <AssetEditorDialog
        library={selectedLibrary}
        state={assetDialogState}
        onClose={() => setAssetDialogState(null)}
        onConfirm={handleConfirmAsset}
      />
      <UiModal
        isOpen={Boolean(confirmDialogState)}
        title={confirmDialogState?.title ?? t('common.delete')}
        onClose={() => setConfirmDialogState(null)}
        footer={
          <>
            <UiButton type="button" variant="ghost" onClick={() => setConfirmDialogState(null)}>
              {t('common.cancel')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              className="bg-red-500 hover:bg-red-600"
              onClick={async () => {
                if (!confirmDialogState) {
                  return;
                }
                await confirmDialogState.onConfirm();
                setConfirmDialogState(null);
              }}
            >
              {confirmDialogState?.confirmLabel ?? t('common.delete')}
            </UiButton>
          </>
        }
      >
        <p className="text-sm text-text-muted">{confirmDialogState?.message ?? ''}</p>
      </UiModal>
    </div>
  );
}
