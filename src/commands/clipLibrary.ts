import { invoke } from '@tauri-apps/api/core';

import type {
  AddNodeMediaToClipLibraryPayload,
  AddNodeMediaToClipLibraryResult,
  ClipDeleteImpactQuery,
  ClipDeleteImpactRecord,
  ClipFolderRecord,
  ClipItemRecord,
  ClipLibraryChapterRecord,
  ClipLibraryRecord,
  ClipLibrarySnapshot,
  ClipLibraryUiStateRecord,
  CreateClipFolderPayload,
  CreateClipLibraryChapterPayload,
  CreateClipLibraryPayload,
  MoveClipFolderPayload,
  MoveClipItemPayload,
  MoveClipLibraryChapterPayload,
  RenameClipFolderPayload,
  RenameClipItemPayload,
  SaveClipLibraryUiStatePayload,
  UpdateClipItemDescriptionPayload,
  UpdateClipLibraryChapterPayload,
  UpdateClipLibraryPayload,
} from '@/features/clip-library/domain/types';

export async function listClipLibraries(): Promise<ClipLibraryRecord[]> {
  return await invoke<ClipLibraryRecord[]>('list_clip_libraries');
}

export async function getClipLibrarySnapshot(libraryId: string): Promise<ClipLibrarySnapshot> {
  return await invoke<ClipLibrarySnapshot>('get_clip_library_snapshot', { libraryId });
}

export async function createClipLibrary(
  payload: CreateClipLibraryPayload
): Promise<ClipLibraryRecord> {
  return await invoke<ClipLibraryRecord>('create_clip_library', { payload });
}

export async function openClipLibraryRoot(libraryId: string): Promise<void> {
  await invoke('open_clip_library_root', { libraryId });
}

export async function updateClipLibrary(
  payload: UpdateClipLibraryPayload
): Promise<ClipLibraryRecord> {
  return await invoke<ClipLibraryRecord>('update_clip_library', { payload });
}

export async function deleteClipLibrary(libraryId: string): Promise<void> {
  await invoke('delete_clip_library', { libraryId });
}

export async function createClipLibraryChapter(
  payload: CreateClipLibraryChapterPayload
): Promise<ClipLibraryChapterRecord> {
  return await invoke<ClipLibraryChapterRecord>('create_clip_library_chapter', { payload });
}

export async function updateClipLibraryChapter(
  payload: UpdateClipLibraryChapterPayload
): Promise<ClipLibraryChapterRecord> {
  return await invoke<ClipLibraryChapterRecord>('update_clip_library_chapter', { payload });
}

export async function moveClipLibraryChapter(
  payload: MoveClipLibraryChapterPayload
): Promise<ClipLibrarySnapshot> {
  return await invoke<ClipLibrarySnapshot>('move_clip_library_chapter', { payload });
}

export async function deleteClipLibraryChapter(chapterId: string): Promise<void> {
  await invoke('delete_clip_library_chapter', { chapterId });
}

export async function createClipFolder(
  payload: CreateClipFolderPayload
): Promise<ClipFolderRecord> {
  return await invoke<ClipFolderRecord>('create_clip_folder', { payload });
}

export async function moveClipFolder(
  payload: MoveClipFolderPayload
): Promise<ClipLibrarySnapshot> {
  return await invoke<ClipLibrarySnapshot>('move_clip_folder', { payload });
}

export async function renameClipFolder(
  payload: RenameClipFolderPayload
): Promise<ClipFolderRecord> {
  return await invoke<ClipFolderRecord>('rename_clip_folder', { payload });
}

export async function deleteClipFolder(folderId: string): Promise<void> {
  await invoke('delete_clip_folder', { folderId });
}

export async function addNodeMediaToClipLibrary(
  payload: AddNodeMediaToClipLibraryPayload
): Promise<AddNodeMediaToClipLibraryResult> {
  return await invoke<AddNodeMediaToClipLibraryResult>('add_node_media_to_clip_library', {
    payload,
  });
}

export async function updateClipItemDescription(
  payload: UpdateClipItemDescriptionPayload
): Promise<ClipItemRecord> {
  return await invoke<ClipItemRecord>('update_clip_item_description', { payload });
}

export async function renameClipItem(payload: RenameClipItemPayload): Promise<ClipItemRecord> {
  return await invoke<ClipItemRecord>('rename_clip_item', { payload });
}

export async function moveClipItem(payload: MoveClipItemPayload): Promise<ClipItemRecord> {
  return await invoke<ClipItemRecord>('move_clip_item', { payload });
}

export async function deleteClipItem(itemId: string): Promise<void> {
  await invoke('delete_clip_item', { itemId });
}

export async function saveClipLibraryUiState(
  payload: SaveClipLibraryUiStatePayload
): Promise<ClipLibraryUiStateRecord> {
  return await invoke<ClipLibraryUiStateRecord>('save_clip_library_ui_state', { payload });
}

export async function getClipDeleteImpact(
  query: ClipDeleteImpactQuery
): Promise<ClipDeleteImpactRecord> {
  return await invoke<ClipDeleteImpactRecord>('get_clip_delete_impact', { query });
}
