export type ReleaseNoteSectionKey = 'added' | 'optimized' | 'fixed';

export interface ReleaseNoteEntry {
  version: string;
  date: string;
  sections: Partial<Record<ReleaseNoteSectionKey, string[]>>;
}

export const RELEASE_NOTE_SECTION_ORDER: ReleaseNoteSectionKey[] = [
  'added',
  'optimized',
  'fixed',
];

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '0.1.17',
    date: '2026-03-23',
    sections: {
      added: [
        'settings.releaseNotesEntries.v0_1_17.added.batchImageExport',
      ],
      optimized: [
        'settings.releaseNotesEntries.v0_1_17.optimized.imageEditDefaults',
        'settings.releaseNotesEntries.v0_1_17.optimized.generatedNodeSpacing',
        'settings.releaseNotesEntries.v0_1_17.optimized.groupOverlayExport',
      ],
      fixed: [
        'settings.releaseNotesEntries.v0_1_17.fixed.parallelImageBranches',
        'settings.releaseNotesEntries.v0_1_17.fixed.manualImageRefresh',
        'settings.releaseNotesEntries.v0_1_17.fixed.videoPersistence',
      ],
    },
  },
  {
    version: '0.1.16',
    date: '2026-03-23',
    sections: {
      added: [
        'settings.releaseNotesEntries.v0_1_16.added.groupShortcut',
        'settings.releaseNotesEntries.v0_1_16.added.groupSidebar',
        'settings.releaseNotesEntries.v0_1_16.added.releaseNotes',
      ],
      optimized: [
        'settings.releaseNotesEntries.v0_1_16.optimized.generatedNodeLayout',
        'settings.releaseNotesEntries.v0_1_16.optimized.groupAutoArrange',
        'settings.releaseNotesEntries.v0_1_16.optimized.dragIntoGroup',
        'settings.releaseNotesEntries.v0_1_16.optimized.spacePanWhileConnecting',
      ],
      fixed: [
        'settings.releaseNotesEntries.v0_1_16.fixed.groupSidebarReopen',
        'settings.releaseNotesEntries.v0_1_16.fixed.groupAltDuplicate',
      ],
    },
  },
];
