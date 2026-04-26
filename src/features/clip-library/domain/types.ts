export const CLIP_MEDIA_TYPES = ['video', 'audio'] as const;
export const CLIP_FOLDER_KINDS = ['shot', 'script'] as const;

export type ClipMediaType = (typeof CLIP_MEDIA_TYPES)[number];
export type ClipFolderKind = (typeof CLIP_FOLDER_KINDS)[number];

export interface ClipLibraryRecord {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClipLibraryChapterRecord {
  id: string;
  libraryId: string;
  name: string;
  sortOrder: number;
  fsName: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClipFolderRecord {
  id: string;
  libraryId: string;
  chapterId: string;
  parentId: string | null;
  kind: ClipFolderKind;
  name: string;
  sortOrder: number;
  shotOrder: number | null;
  numberCode: string | null;
  fsName: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClipItemRecord {
  id: string;
  libraryId: string;
  folderId: string;
  mediaType: ClipMediaType;
  name: string;
  descriptionText: string;
  fileName: string;
  sourcePath: string;
  previewPath: string | null;
  durationMs: number | null;
  mimeType: string | null;
  waveformPath: string | null;
  sourceNodeId: string | null;
  sourceNodeTitle: string | null;
  sourceProjectId: string | null;
  sourceProjectName: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClipLibraryUiStateRecord {
  libraryId: string;
  expandedKeysJson: string;
  selectedKey: string | null;
  scrollTop: number;
  leftWidth: number | null;
  rightWidth: number | null;
  lastFilterJson: string;
  alwaysOnTop: boolean;
  updatedAt: number;
}

export interface ClipLibrarySnapshot {
  library: ClipLibraryRecord;
  chapters: ClipLibraryChapterRecord[];
  folders: ClipFolderRecord[];
  items: ClipItemRecord[];
  uiState: ClipLibraryUiStateRecord | null;
}

export interface ClipDeleteImpactRecord {
  projectCount: number;
  nodeCount: number;
  folderCount: number;
  itemCount: number;
}

export interface AddNodeMediaToClipLibraryResult {
  item: ClipItemRecord;
  clipLibraryId: string;
  clipFolderId: string;
}

export interface AddNodeMediaToClipLibraryMediaOverride {
  mediaType: ClipMediaType;
  sourcePath: string;
  previewPath?: string | null;
  title?: string | null;
  descriptionText?: string | null;
  durationMs?: number | null;
  mimeType?: string | null;
}

export interface CreateClipLibraryPayload {
  name: string;
  rootPath: string;
}

export interface UpdateClipLibraryPayload {
  id: string;
  name: string;
}

export interface CreateClipLibraryChapterPayload {
  libraryId: string;
  name: string;
  insertIndex?: number | null;
}

export interface UpdateClipLibraryChapterPayload {
  id: string;
  name: string;
}

export interface MoveClipLibraryChapterPayload {
  chapterId: string;
  targetIndex: number;
}

export interface CreateClipFolderPayload {
  libraryId: string;
  chapterId?: string | null;
  parentId?: string | null;
  kind: ClipFolderKind;
  name?: string | null;
  insertBeforeId?: string | null;
  insertAfterId?: string | null;
}

export interface MoveClipFolderPayload {
  folderId: string;
  targetChapterId?: string | null;
  targetParentId?: string | null;
  targetIndex: number;
}

export interface RenameClipFolderPayload {
  id: string;
  name: string;
}

export interface UpdateClipItemDescriptionPayload {
  itemId: string;
  descriptionText: string;
}

export interface RenameClipItemPayload {
  itemId: string;
  name: string;
}

export interface MoveClipItemPayload {
  itemId: string;
  targetFolderId: string;
}

export interface SaveClipLibraryUiStatePayload {
  libraryId: string;
  expandedKeysJson: string;
  selectedKey?: string | null;
  scrollTop: number;
  leftWidth?: number | null;
  rightWidth?: number | null;
  lastFilterJson: string;
  alwaysOnTop: boolean;
}

export interface ClipDeleteImpactQuery {
  libraryId?: string | null;
  chapterId?: string | null;
  folderId?: string | null;
  itemId?: string | null;
}

export interface AddNodeMediaToClipLibraryPayload {
  projectId: string;
  nodeId: string;
  libraryId: string;
  folderId: string;
  mediaOverride?: AddNodeMediaToClipLibraryMediaOverride | null;
}
