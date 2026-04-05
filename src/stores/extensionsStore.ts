import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  type ExtensionRuntimeStatus,
  getExtensionRuntimeStatus,
  readExtensionPackage,
  startExtensionRuntime,
  stopExtensionRuntime,
} from '@/commands/extensions';
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
  runtimeObservedAtById: Record<string, number>;
  setHydrated: (isHydrated: boolean) => void;
  loadExtensionPackage: (folderPath: string) => Promise<LoadedExtensionPackage>;
  enableExtension: (extensionId: string) => Promise<void>;
  syncExtensionRuntimeStates: (extensionIds?: string[]) => Promise<void>;
  disableExtension: (extensionId: string) => Promise<void>;
  removeExtensionPackage: (extensionId: string) => Promise<void>;
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

function createReadyRuntimeState(startedAt: number | null): ExtensionRuntimeState {
  const resolvedStartedAt = typeof startedAt === 'number' && Number.isFinite(startedAt)
    ? startedAt
    : Date.now();

  return {
    status: 'ready',
    progress: 100,
    currentStepId: null,
    error: null,
    startedAt: resolvedStartedAt,
    completedAt: Date.now(),
  };
}

function createIdleRuntimeState(): ExtensionRuntimeState {
  return {
    ...DEFAULT_EXTENSION_RUNTIME_STATE,
    completedAt: Date.now(),
  };
}

function createErroredRuntimeState(
  previousState: ExtensionRuntimeState | undefined,
  errorMessage: string
): ExtensionRuntimeState {
  return {
    ...(previousState ?? DEFAULT_EXTENSION_RUNTIME_STATE),
    status: 'error',
    error: errorMessage,
    completedAt: Date.now(),
  };
}

function shouldApplyRuntimeObservation(
  observedAtById: Record<string, number>,
  extensionId: string,
  requestedAt: number
): boolean {
  return (observedAtById[extensionId] ?? 0) <= requestedAt;
}

function isExtensionSessionReady(
  enabledExtensionIds: string[],
  runtimeById: Record<string, ExtensionRuntimeState>,
  extensionId: string
): boolean {
  return enabledExtensionIds.includes(extensionId)
    && runtimeById[extensionId]?.status === 'ready';
}

export const useExtensionsStore = create<ExtensionsState>()(
  persist(
    (set, get) => ({
      isHydrated: false,
      packages: {},
      enabledExtensionIds: [],
      runtimeById: {},
      runtimeObservedAtById: {},

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
          runtimeObservedAtById: {
            ...state.runtimeObservedAtById,
            [loadedPackage.id]: state.runtimeObservedAtById[loadedPackage.id] ?? 0,
          },
        }));

        await get().syncExtensionRuntimeStates([loadedPackage.id]);

        return loadedPackage;
      },

      enableExtension: async (extensionId) => {
        let extensionPackage = get().packages[extensionId];
        if (!extensionPackage) {
          throw new Error(`Unknown extension: ${extensionId}`);
        }

        if (
          isExtensionSessionReady(
            get().enabledExtensionIds,
            get().runtimeById,
            extensionId
          )
        ) {
          return;
        }

        extensionPackage = await get().loadExtensionPackage(extensionPackage.folderPath);

        const startupRequestedAt = Date.now();
        let existingRuntimeStatus: ExtensionRuntimeStatus | null = null;
        if (extensionPackage.runtime === 'python-bridge') {
          try {
            const runtimeStatus = await getExtensionRuntimeStatus(extensionPackage.folderPath);
            if (runtimeStatus.running) {
              existingRuntimeStatus = runtimeStatus;
            }
          } catch (error) {
            console.warn('Failed to query extension runtime status before startup', error);
          }
        }

        const steps = extensionPackage.startupSteps.length > 0
          ? extensionPackage.startupSteps
          : FALLBACK_STARTUP_STEPS;
        const persistentRuntimeStartupStepId = extensionPackage.runtime === 'python-bridge'
          ? (steps.find((step) => step.id === 'verify-runtime')?.id ?? steps[0]?.id ?? null)
          : null;
        let runtimeStartedAt = Date.now();
        let hasStartedPersistentRuntime = false;

        set((state) => ({
          runtimeById: {
            ...state.runtimeById,
            [extensionId]: {
              ...createStartingRuntimeState(steps[0]?.id ?? null),
              startedAt: runtimeStartedAt,
            },
          },
          runtimeObservedAtById: {
            ...state.runtimeObservedAtById,
            [extensionId]: startupRequestedAt,
          },
        }));

        try {
          if (extensionPackage.runtime === 'python-bridge' && existingRuntimeStatus?.running) {
            const stoppedRuntimeStatus = await stopExtensionRuntime(extensionPackage.folderPath);
            if (stoppedRuntimeStatus.running) {
              throw new Error('Failed to stop the previous extension runtime before startup.');
            }
            existingRuntimeStatus = null;
          }

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

            if (
              extensionPackage.runtime === 'python-bridge'
              && !hasStartedPersistentRuntime
              && step.id === persistentRuntimeStartupStepId
            ) {
              const runtimeStatus = await startExtensionRuntime(extensionPackage.folderPath);
              if (!runtimeStatus.running) {
                throw new Error('Extension runtime did not stay alive after startup.');
              }

              runtimeStartedAt = runtimeStatus.startedAt ?? runtimeStartedAt;
              hasStartedPersistentRuntime = true;

              set((state) => ({
                runtimeById: {
                  ...state.runtimeById,
                  [extensionId]: {
                    ...(state.runtimeById[extensionId] ?? DEFAULT_EXTENSION_RUNTIME_STATE),
                    startedAt: runtimeStartedAt,
                  },
                },
              }));
            }

            await runExtensionStartupStep(extensionPackage, step);
          }

          set((state) => {
            if (
              !shouldApplyRuntimeObservation(
                state.runtimeObservedAtById,
                extensionId,
                startupRequestedAt
              )
            ) {
              return state;
            }

            return {
              enabledExtensionIds: Array.from(
                new Set([...state.enabledExtensionIds, extensionId])
              ),
              runtimeById: {
                ...state.runtimeById,
                [extensionId]: {
                  ...createReadyRuntimeState(runtimeStartedAt),
                  currentStepId: steps[steps.length - 1]?.id ?? null,
                },
              },
              runtimeObservedAtById: {
                ...state.runtimeObservedAtById,
                [extensionId]: Date.now(),
              },
            };
          });
        } catch (error) {
          if (extensionPackage.runtime === 'python-bridge') {
            try {
              await stopExtensionRuntime(extensionPackage.folderPath);
            } catch (stopError) {
              console.warn('Failed to stop extension runtime after startup failure', stopError);
            }
          }

          set((state) => {
            if (
              !shouldApplyRuntimeObservation(
                state.runtimeObservedAtById,
                extensionId,
                startupRequestedAt
              )
            ) {
              return state;
            }

            return {
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
              runtimeObservedAtById: {
                ...state.runtimeObservedAtById,
                [extensionId]: Date.now(),
              },
            };
          });
          throw error;
        }
      },

      syncExtensionRuntimeStates: async (extensionIds) => {
        const packages = get().packages;
        const targetIds = Array.from(new Set(
          (extensionIds ?? Object.keys(packages)).filter((extensionId) => Boolean(packages[extensionId]))
        ));

        if (targetIds.length === 0) {
          return;
        }

        const currentRuntimeById = get().runtimeById;
        const syncedStates = await Promise.all(targetIds.map(async (extensionId) => {
          const extensionPackage = packages[extensionId];
          const requestedAt = Date.now();
          if (!extensionPackage) {
            return null;
          }

          if (extensionPackage.runtime !== 'python-bridge') {
            return {
              extensionId,
              isRunning: false,
              requestedAt,
              runtimeState: currentRuntimeById[extensionId] ?? DEFAULT_EXTENSION_RUNTIME_STATE,
            };
          }

          try {
            const runtimeStatus = await getExtensionRuntimeStatus(extensionPackage.folderPath);
            return {
              extensionId,
              isRunning: runtimeStatus.running,
              requestedAt,
              runtimeState: runtimeStatus.running
                ? createReadyRuntimeState(runtimeStatus.startedAt)
                : createIdleRuntimeState(),
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Failed to sync extension runtime state.';

            return {
              extensionId,
              isRunning: false,
              requestedAt,
              runtimeState: createErroredRuntimeState(currentRuntimeById[extensionId], errorMessage),
            };
          }
        }));

        set((state) => {
          const nextEnabledIds = state.enabledExtensionIds.filter(
            (extensionId) => !targetIds.includes(extensionId)
          );
          const nextRuntimeById = { ...state.runtimeById };
          const nextRuntimeObservedAtById = { ...state.runtimeObservedAtById };

          syncedStates.forEach((syncedState) => {
            if (!syncedState) {
              return;
            }

            const wasEnabledInSession = state.enabledExtensionIds.includes(syncedState.extensionId);

            if (
              !shouldApplyRuntimeObservation(
                state.runtimeObservedAtById,
                syncedState.extensionId,
                syncedState.requestedAt
              )
            ) {
              if (wasEnabledInSession) {
                nextEnabledIds.push(syncedState.extensionId);
              }
              return;
            }

            nextRuntimeById[syncedState.extensionId] = syncedState.runtimeState;
            nextRuntimeObservedAtById[syncedState.extensionId] = syncedState.requestedAt;
            if (syncedState.isRunning && wasEnabledInSession) {
              nextEnabledIds.push(syncedState.extensionId);
            }
          });

          return {
            enabledExtensionIds: Array.from(new Set(nextEnabledIds)),
            runtimeById: nextRuntimeById,
            runtimeObservedAtById: nextRuntimeObservedAtById,
          };
        });
      },

      disableExtension: async (extensionId) => {
        const extensionPackage = get().packages[extensionId];
        if (extensionPackage?.runtime === 'python-bridge') {
          try {
            await stopExtensionRuntime(extensionPackage.folderPath);
          } catch (error) {
            console.warn('Failed to stop extension runtime', error);
          }
        }

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
          runtimeObservedAtById: {
            ...state.runtimeObservedAtById,
            [extensionId]: Date.now(),
          },
        }));
      },

      removeExtensionPackage: async (extensionId) => {
        const extensionPackage = get().packages[extensionId];
        if (extensionPackage?.runtime === 'python-bridge') {
          try {
            await stopExtensionRuntime(extensionPackage.folderPath);
          } catch (error) {
            console.warn('Failed to stop extension runtime before removing package', error);
          }
        }

        set((state) => {
          if (!state.packages[extensionId]) {
            return {};
          }

          const nextPackages = { ...state.packages };
          delete nextPackages[extensionId];

          const nextRuntimeById = { ...state.runtimeById };
          delete nextRuntimeById[extensionId];

          const nextRuntimeObservedAtById = { ...state.runtimeObservedAtById };
          delete nextRuntimeObservedAtById[extensionId];

          return {
            packages: nextPackages,
            enabledExtensionIds: state.enabledExtensionIds.filter(
              (id) => id !== extensionId
            ),
            runtimeById: nextRuntimeById,
            runtimeObservedAtById: nextRuntimeObservedAtById,
          };
        });
      },
    }),
    {
      name: 'extensions-storage',
      version: 2,
      partialize: (state) => ({
        packages: state.packages,
      }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<ExtensionsState>;
        return {
          packages: state.packages ?? {},
          enabledExtensionIds: [],
          runtimeById: {},
          runtimeObservedAtById: {},
          isHydrated: false,
        };
      },
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('failed to hydrate extensions storage', error);
          }
          state?.setHydrated(true);

          const persistedPackages = Object.values(state?.packages ?? {});
          if (persistedPackages.length === 0) {
            void state?.syncExtensionRuntimeStates();
            return;
          }

          void Promise.all(
            persistedPackages.map(async (extensionPackage) => {
              try {
                await state?.loadExtensionPackage(extensionPackage.folderPath);
              } catch (loadError) {
                console.warn(
                  `failed to refresh extension package from disk: ${extensionPackage.folderPath}`,
                  loadError
                );
              }
            })
          ).finally(() => {
            void state?.syncExtensionRuntimeStates();
          });
        };
      },
    }
  )
);

export function isExtensionEnabled(extensionId: string): boolean {
  const state = useExtensionsStore.getState();
  return isExtensionSessionReady(
    state.enabledExtensionIds,
    state.runtimeById,
    extensionId
  );
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
