import { useProjectStore } from "@/stores/projectStore";

export async function flushCurrentProjectToDiskSafely(
  reason: string,
): Promise<void> {
  try {
    await useProjectStore.getState().flushCurrentProjectToDisk();
  } catch (error) {
    console.error(
      `[projectPersistence] failed to flush current project after ${reason}`,
      error,
    );
  }
}
