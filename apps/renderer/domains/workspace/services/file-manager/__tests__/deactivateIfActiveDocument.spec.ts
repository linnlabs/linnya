// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toRef } from 'vue';

// 中文说明：
// - file-manager/index.ts 会在 ensureHooks 中调用 pinia.storeToRefs；
// - 本用例只关心会话收尾逻辑，不需要真实 Pinia store；
// - 因此把 storeToRefs 简化为“直接返回对象本身”，让解构到的字段仍然是 ref。
vi.mock('pinia', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        storeToRefs: (store) => {
            return {
                autoSaveInterval: toRef(store, 'autoSaveInterval'),
                currentFilePath: toRef(store, 'currentFilePath'),
                isDirty: toRef(store, 'isDirty'),
                isSaving: toRef(store, 'isSaving'),
                isLoading: toRef(store, 'isLoading'),
            };
        },
    };
});

// 伪造 fileStore，避免引入 Electron IPC 依赖（window.electronAPI）
const fileStore = {
    currentFilePath: null,
    currentFileName: null,
    isDirty: false,
    isLoading: false,
    isSaving: false,
    clearEditorRequested: false,
    // 置 0：确保 initAutoSaveScheduler 不会 setInterval
    autoSaveInterval: 0,
    setFilePath: (path, name = null) => {
        fileStore.currentFilePath = path;
        fileStore.currentFileName = name;
    },
    setDirty: (dirty) => {
        fileStore.isDirty = dirty;
    },
    runPreSaveHooks: async () => true,
};

vi.mock('@/shared/stores/file', () => ({ useFileStore: () => fileStore }));

// file-manager/index.ts 会 re-export 内置 handlers；这里 mock 掉以避免其模块加载触发 IPC 单例
vi.mock('../handlers/markdown', () => ({ markdownHandler: { type: 'markdown', open: async () => {} } }));
vi.mock('../handlers/mindmap', () => ({ mindmapHandler: { type: 'mindmap', open: async () => {} } }));

describe('file-manager deactivateIfActiveDocument', () => {
    beforeEach(() => {
        // 中文说明：file-manager 内部有模块级单例状态（activeSession/hooksInitialized），需要隔离每个用例
        vi.resetModules();
        fileStore.currentFilePath = null;
        fileStore.currentFileName = null;
        fileStore.isDirty = false;
        fileStore.isLoading = false;
        fileStore.isSaving = false;
        fileStore.autoSaveInterval = 0;
    });

    it('仅当 documentId 命中 activeSession 时才会关闭会话并清空 filePath', async () => {
        const fm = await import('../index');

        let closedCount = 0;
        fm.registerFileTypeHandler({
            type: 'markdown',
            open: async () => {},
            close: async () => {
                closedCount += 1;
            },
            save: async () => true,
        });

        await fm.activateFileSession({
            documentId: 'doc-1',
            displayName: 'Doc 1',
            type: 'markdown',
        });

        expect(fm.getActiveFileSession()?.documentId).toBe('doc-1');
        expect(fileStore.currentFilePath).toBe('doc-1');

        await fm.deactivateIfActiveDocument('doc-2');
        expect(fm.getActiveFileSession()?.documentId).toBe('doc-1');
        expect(fileStore.currentFilePath).toBe('doc-1');
        expect(closedCount).toBe(0);

        await fm.deactivateIfActiveDocument('  doc-1  ');
        expect(fm.getActiveFileSession()).toBeNull();
        expect(fileStore.currentFilePath).toBeNull();
        expect(closedCount).toBe(1);
    });

    it('打开动作被取消后不会保留 activeSession 或 filePath', async () => {
        const fm = await import('../index');

        const controller = new AbortController();
        let releaseOpen: (() => void) | null = null;
        const openStarted = new Promise<void>((resolve) => {
            fm.registerFileTypeHandler({
                type: 'markdown',
                open: async (session) => {
                    resolve();
                    await new Promise<void>((release) => {
                        releaseOpen = release;
                    });
                    fm.throwIfFileSessionOpenCancelled(session);
                },
            });
        });

        const activation = fm.activateFileSession({
            documentId: 'doc-cancelled',
            displayName: 'Cancelled',
            type: 'markdown',
            openSignal: controller.signal,
        });

        await openStarted;
        expect(fileStore.currentFilePath).toBe('doc-cancelled');

        controller.abort();
        releaseOpen?.();

        await expect(activation).rejects.toBeInstanceOf(fm.FileSessionOpenCancelledError);
        expect(fm.getActiveFileSession()).toBeNull();
        expect(fileStore.currentFilePath).toBeNull();
        expect(fileStore.isDirty).toBe(false);
    });
});
