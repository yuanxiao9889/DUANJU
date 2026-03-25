import { create } from 'zustand';

import type {
  JimengInspectionReport,
  JimengInspectionStatus,
} from '@/features/jimeng/domain/jimengInspection';

export type JimengPanelMode = 'hidden' | 'collapsed' | 'expanded' | 'fullscreen';

type JimengDockedMode = 'collapsed' | 'expanded';

interface JimengPanelState {
  mode: JimengPanelMode;
  isBusy: boolean;
  lastError: string | null;
  lastDockedMode: JimengDockedMode;
  inspectionRevision: number;
  inspectionStatus: JimengInspectionStatus;
  inspectionReport: JimengInspectionReport | null;
  inspectionError: string | null;
  setMode: (mode: JimengPanelMode) => void;
  togglePanel: () => void;
  toggleFullscreen: () => void;
  requestInspectionRefresh: () => void;
  setBusy: (isBusy: boolean) => void;
  setLastError: (message: string | null) => void;
  setInspectionState: (payload: {
    status: JimengInspectionStatus;
    report?: JimengInspectionReport | null;
    error?: string | null;
  }) => void;
}

export const useJimengPanelStore = create<JimengPanelState>((set) => ({
  mode: 'hidden',
  isBusy: false,
  lastError: null,
  lastDockedMode: 'expanded',
  inspectionRevision: 0,
  inspectionStatus: 'idle',
  inspectionReport: null,
  inspectionError: null,
  setMode: (mode) =>
    set((state) => ({
      mode,
      lastDockedMode:
        mode === 'collapsed' || mode === 'expanded' ? mode : state.lastDockedMode,
    })),
  togglePanel: () =>
    set((state) => {
      if (state.mode === 'hidden') {
        return {
          mode: 'expanded',
          lastDockedMode: 'expanded',
          lastError: null,
        };
      }

      if (state.mode === 'fullscreen') {
        return {
          mode: state.lastDockedMode,
          lastError: null,
        };
      }

      const nextDockedMode: JimengDockedMode =
        state.mode === 'expanded' ? 'collapsed' : 'expanded';

      return {
        mode: nextDockedMode,
        lastDockedMode: nextDockedMode,
        lastError: null,
      };
    }),
  toggleFullscreen: () =>
    set((state) => {
      if (state.mode === 'fullscreen') {
        return {
          mode: state.lastDockedMode,
          lastError: null,
        };
      }

      if (state.mode === 'hidden') {
        return {
          mode: 'fullscreen',
          lastDockedMode: 'expanded',
          lastError: null,
        };
      }

      return {
        mode: 'fullscreen',
        lastDockedMode: state.mode,
        lastError: null,
      };
    }),
  requestInspectionRefresh: () =>
    set((state) => ({
      inspectionRevision: state.inspectionRevision + 1,
    })),
  setBusy: (isBusy) => set({ isBusy }),
  setLastError: (message) => set({ lastError: message }),
  setInspectionState: ({ status, report, error }) =>
    set((state) => ({
      inspectionStatus: status,
      inspectionReport:
        report === undefined ? state.inspectionReport : report,
      inspectionError:
        error === undefined ? state.inspectionError : error,
    })),
}));
