import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { readExtensionPackage } from '@/commands/extensions';
import { runExtensionStartupStep } from '@/features/extensions/application/extensionRuntime';
import type {
  ExtensionRuntimeState,
  LoadedExtensionPackage,
  ExtensionStartupStep,
} from '@/features/extensions/domain/types';

interface ExtensionsState {
  isHydrated: boolean;
  packages: Record<string, LoadedExtensionPackage>;
  enabledExtensionIds: string[];
  runtimeById: Record<string, ExtensionRuntimeState>;
  setHydrated: (isHydrated: boolean) => void;
  loadExtensionPackage: (folderPath: string) => Promise<LoadedExtensionPackage>;
  enableExtension: (extensionId: string) => Promise<void>;
  disableExtension: (extensionId: string) => void;
  removeExtensionPackage: (extensionId: string) => void;
}

const DEFAULT_EXTENSION_RUNTIME_STATE: ExtensionRuntimeState = {
  status: 'idle',
  progress: 0,
  currentStepId: null,
  error: null,
  startedAt: null,
  completedAt: null,
};

const FALLBACK_STARTUP_STEPS: ExtensionStartupStep[] = [
  {
    id: 'validate',
    label: 'Validate package',
    durationMs: 420,
  },
  {
    id: 'prepare-runtime',
    label: 'Prepare runtime',
    durationMs: 700,
  },
  {
    id: 'register-nodes',
    label: 'Register nodes',
    durationMs: 520,
  },
  {
    id: 'ready',
    label: 'Ready',
    durationMs: 260,
  },
];

function createStartingRuntimeState(firstStepId: string | null): ExtensionRuntimeState {
  return {
    status: 'starting',
    progress: 0,
    currentStepId: firstStepId,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };
}

export const useExtensionsStore = create<ExtensionsState>()(
  persist(
    (set, get) => ({
      isHydrated: false,
      packages: {},
      enabledExtensionIds: [],
      runtimeById: {},

      setHydrated: (isHydrated) => set({ isHydrated }),

      loadExtensionPackage: async (folderPath) => {
        const manifest = await readExtensionPackage(folderPath);
        const loadedPackage: LoadedExtensionPackage = {
          ...manifest,
          folderPath,
          loadedAt: Date.now(),
        };

        set((state) => ({
          packages: {
            ...state.packages,
            [loadedPackage.id]: loadedPackage,
          },
          runtimeById: {
            ...state.runtimeById,
            [loadedPackage.id]:
              state.runtimeById[loadedPackage.id] ?? DEFAULT_EXTENSION_RUNTIME_STATE,
          },
        }));

        return loadedPackage;
      },

      enableExtension: async (extensionId) => {
        const extensionPackage = get().packages[extensionId];
        if (!extensionPackage) {
          throw new Error(`Unknown extension: ${extensionId}`);
        }

        const currentRuntime = get().runtimeById[extensionId];
        if (
          get().enabledExtensionIds.includes(extensionId) &&
          currentRuntime?.status === 'ready'
        ) {
          return;
        }

        const steps = extensionPackage.startupSteps.length > 0
          ? extensionPackage.startupSteps
          : FALLBACK_STARTUP_STEPS;

        set((state) => ({
          runtimeById: {
            ...state.runtimeById,
            [extensionId]: createStartingRuntimeState(steps[0]?.id ?? null),
          },
        }));

        try {
          for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];
            set((state) => ({
              runtimeById: {
                ...state.runtimeById,
                [extensionId]: {
                  ...(state.runtimeById[extensionId] ?? DEFAULT_EXTENSION_RUNTIME_STATE),
                  status: 'starting',
                  currentStepId: step.id,
                  progress: Math.round((index / steps.length) * 100),
                  error: null,
                },
              },
            }));

            await runExtensionStartupStep(extensionPackage, step);
          }

          set((state) => ({
            enabledExtensionIds: Array.from(
              new Set([...state.enabledExtensionIds, extensionId])
            ),
            runtimeById: {
              ...state.runtimeById,
              [extensionId]: {
                status: 'ready',
                progress: 100,
                currentStepId: steps[steps.length - 1]?.id ?? null,
                error: null,
                startedAt:
                  state.runtimeById[extensionId]?.startedAt ?? Date.now(),
                completedAt: Date.now(),
              },
            },
          }));
        } catch (error) {
          set((state) => ({
            runtimeById: {
              ...state.runtimeById,
              [extensionId]: {
                ...(state.runtimeById[extensionId] ?? DEFAULT_EXTENSION_RUNTIME_STATE),
                status: 'error',
                error:
                  error instanceof Error && error.message.trim().length > 0
                    ? error.message
                    : 'Failed to start extension runtime.',
                completedAt: Date.now(),
              },
            },
          }));
          throw error;
        }
      },

      disableExtension: (extensionId) => {
        set((state) => ({
          enabledExtensionIds: state.enabledExtensionIds.filter(
            (id) => id !== extensionId
          ),
          runtimeById: {
            ...state.runtimeById,
            [extensionId]: {
              ...DEFAULT_EXTENSION_RUNTIME_STATE,
              completedAt: Date.now(),
            },
          },
        }));
      },

      removeExtensionPackage: (extensionId) => {
        set((state) => {
          if (!state.packages[extensionId]) {
            return {};
          }

          const nextPackages = { ...state.packages };
          delete nextPackages[extensionId];

          const nextRuntimeById = { ...state.runtimeById };
          delete nextRuntimeById[extensionId];

          return {
            packages: nextPackages,
            enabledExtensionIds: state.enabledExtensionIds.filter(
              (id) => id !== extensionId
            ),
            runtimeById: nextRuntimeById,
          };
        });
      },
    }),
    {
      name: 'extensions-storage',
      version: 1,
      partialize: (state) => ({
        packages: state.packages,
        enabledExtensionIds: state.enabledExtensionIds,
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('failed to hydrate extensions storage', error);
          }
          state?.setHydrated(true);
        };
      },
    }
  )
);

export function isExtensionEnabled(extensionId: string): boolean {
  return useExtensionsStore.getState().enabledExtensionIds.includes(extensionId);
}

export function isExtensionRequirementSatisfied(
  requiredExtensionId?: string | null,
  requiredExtensionIds?: string[] | null
): boolean {
  const candidates = [
    ...(requiredExtensionId ? [requiredExtensionId] : []),
    ...((requiredExtensionIds ?? []).filter((value) => value.trim().length > 0)),
  ];

  if (candidates.length === 0) {
    return true;
  }

  return candidates.some((extensionId) => isExtensionEnabled(extensionId));
}
