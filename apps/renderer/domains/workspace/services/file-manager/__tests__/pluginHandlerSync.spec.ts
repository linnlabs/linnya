// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toRef } from 'vue';

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    storeToRefs: (store: Record<string, unknown>) => ({
      autoSaveInterval: toRef(store, 'autoSaveInterval'),
      currentFilePath: toRef(store, 'currentFilePath'),
      isDirty: toRef(store, 'isDirty'),
      isSaving: toRef(store, 'isSaving'),
      isLoading: toRef(store, 'isLoading'),
    }),
  };
});

const fileStore = {
  currentFilePath: null as string | null,
  currentFileName: null as string | null,
  isDirty: false,
  isLoading: false,
  isSaving: false,
  autoSaveInterval: 0,
  setFilePath(path: string | null, name: string | null = null) {
    this.currentFilePath = path;
    this.currentFileName = name;
  },
  setDirty(dirty: boolean) {
    this.isDirty = dirty;
  },
  runPreSaveHooks: async () => true,
};

const closeMindmap = vi.fn(async () => {});

vi.mock('@/shared/stores/file', () => ({ useFileStore: () => fileStore }));
vi.mock('../handlers/markdown', () => ({ markdownHandler: { type: 'markdown', open: async () => {} } }));
vi.mock('@/app/plugins/builtin', () => ({
  ensureBuiltinRendererPluginsRegistered: vi.fn(),
}));
vi.mock('@/app/plugins/registry', () => ({
  listDocumentTypes: () => [
    {
      pluginId: 'platform',
      label: '文档',
      fileHandler: { type: 'markdown', open: async () => {} },
    },
    {
      pluginId: 'mindmap',
      label: '思维导图',
      fileHandler: {
        type: 'mindmap',
        open: async () => {},
        close: closeMindmap,
      },
    },
    {
      pluginId: 'slides',
      label: '演示文稿',
    },
  ],
}));

describe('file-manager plugin handler sync', () => {
  beforeEach(() => {
    vi.resetModules();
    closeMindmap.mockClear();
    fileStore.currentFilePath = null;
    fileStore.currentFileName = null;
    fileStore.isDirty = false;
    fileStore.isLoading = false;
    fileStore.isSaving = false;
    fileStore.autoSaveInterval = 0;
  });

  it('registers and unregisters file handlers from the enabled plugin snapshot', async () => {
    const setup = await import('../setup');
    const fm = await import('../index');

    setup.initFileManager();
    await setup.syncFileManagerHandlers(new Set(['platform', 'mindmap']));

    expect(fm.getRegisteredFileTypes().sort()).toEqual([
      'markdown',
      'mindmap',
    ]);

    await setup.syncFileManagerHandlers(new Set(['platform']));

    expect(fm.getRegisteredFileTypes().sort()).toEqual([
      'markdown',
    ]);
  });

  it('deactivates the active session before unregistering its handler', async () => {
    const setup = await import('../setup');
    const fm = await import('../index');

    setup.initFileManager();
    await setup.syncFileManagerHandlers(new Set(['platform', 'mindmap']));
    await fm.activateFileSession({
      documentId: 'mindmap-1',
      displayName: 'Mindmap 1',
      type: 'mindmap',
    });

    await setup.syncFileManagerHandlers(new Set(['platform']));

    expect(closeMindmap).toHaveBeenCalledTimes(1);
    expect(fm.getActiveFileSession()).toBeNull();
    expect(fileStore.currentFilePath).toBeNull();
    expect(fm.getRegisteredFileTypes()).not.toContain('mindmap');
  });
});
