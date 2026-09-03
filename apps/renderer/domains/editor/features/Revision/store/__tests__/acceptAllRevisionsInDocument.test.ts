import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlag } from '../../../../ui/services/editorFeatureFlags';
import { useRevisionStore } from '../useRevisionStore';
import type { MarkdownDocJsonDTO } from '../../../../../../shared/ipc/workspaceGateway';

const mocks = vi.hoisted(() => {
  const fileStore = {
    currentFilePath: 'doc-1' as string | null,
    setDirty: vi.fn(),
  };
  return {
    fileStore,
    applyAllPendingRevisions: vi.fn(),
    clearPendingRevision: vi.fn(),
    clearAllPendingRevisions: vi.fn(),
    applyPendingRevision: vi.fn(),
    setPendingRevisionsBatch: vi.fn(),
    readDocument: vi.fn(),
    requestSave: vi.fn(),
    loadDocumentJsonAtomically: vi.fn(),
  };
});

vi.mock('../../../../../../shared/stores/file', () => ({
  useFileStore: () => mocks.fileStore,
}));

vi.mock('../../../../services/editorDocumentStateLoader', () => ({
  countRootBlocksInDocJson: (content: MarkdownDocJsonDTO) => content.content.length,
  loadDocumentJsonAtomically: mocks.loadDocumentJsonAtomically,
}));

vi.mock('../../../../../../shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'apply-all-pending-revisions': mocks.applyAllPendingRevisions,
    'clear-pending-revision': mocks.clearPendingRevision,
    'clear-all-pending-revisions': mocks.clearAllPendingRevisions,
    'apply-pending-revision': mocks.applyPendingRevision,
    'set-pending-revisions-batch': mocks.setPendingRevisionsBatch,
    'read-document': mocks.readDocument,
  },
}));

vi.mock('../../../../../workspace/services/file-manager/index', () => ({
  requestSave: mocks.requestSave,
}));

function buildDoc(text: string): MarkdownDocJsonDTO {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'b1' },
        content: [
          {
            type: 'baseBlock',
            attrs: { id: 'b1-inner' },
            content: [{ type: 'text', text }],
          },
        ],
      },
    ],
  };
}

function createEditor() {
  return {
    commands: {
      setContent: vi.fn(() => true),
      acceptAllRevisionsInBlock: vi.fn(() => true),
      rejectAllRevisionsInBlock: vi.fn(() => true),
      clearBlockRevisionMarks: vi.fn(() => true),
    },
    on: vi.fn(),
    state: {
      doc: {
        childCount: 0,
        child: vi.fn(),
        nodeAt: vi.fn(),
      },
    },
    view: {
      dispatch: vi.fn(),
    },
    chain: vi.fn(),
  };
}

describe('useRevisionStore document-level apply all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDocumentJsonAtomically.mockReturnValue({});
    mocks.fileStore.currentFilePath = 'doc-1';
    setFlag('enableBackendPendingApply', true);
    mocks.applyAllPendingRevisions.mockResolvedValue({
      success: true,
      data: {
        status: 'ok',
        documentId: 'doc-1',
        appliedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        docJson: buildDoc('accepted'),
      },
    });
  });

  it('accept all 走后端一次性合并，并严格原子装载返回 docJson', async () => {
    const editor = createEditor();
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0]);
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    };

    const status = await store.acceptAllRevisionsInDocument();

    expect(mocks.applyAllPendingRevisions).toHaveBeenCalledWith({
      documentId: 'doc-1',
      mode: 'accept',
    });
    expect(mocks.loadDocumentJsonAtomically).toHaveBeenCalledWith(editor, buildDoc('accepted'));
    expect(store.canonicalPendingBlockCount.value).toBe(0);
    expect(mocks.fileStore.setDirty).toHaveBeenCalledWith(false);
    expect(mocks.requestSave).not.toHaveBeenCalled();
    expect(status).toBe('applied');
  });

  it('reject all 使用同一条后端路径，但 mode 为 reject', async () => {
    const editor = createEditor();
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0]);
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'insert',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    };

    const status = await store.rejectAllRevisionsInDocument();

    expect(mocks.applyAllPendingRevisions).toHaveBeenCalledWith({
      documentId: 'doc-1',
      mode: 'reject',
    });
    expect(mocks.loadDocumentJsonAtomically).toHaveBeenCalledWith(editor, buildDoc('accepted'));
    expect(store.canonicalPendingBlockCount.value).toBe(0);
    expect(mocks.fileStore.setDirty).toHaveBeenCalledWith(false);
    expect(status).toBe('applied');
  });

  it('后端明确返回 failed 时不回退旧路径，也不清空本地 canonical', async () => {
    mocks.applyAllPendingRevisions.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'failed',
        documentId: 'doc-1',
        appliedCount: 0,
        skippedCount: 0,
        failedCount: 1,
        docJson: buildDoc('old'),
        errors: [{ blockId: '__document__', reason: 'stale' }],
      },
    });
    const editor = createEditor();
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0]);
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    };

    const status = await store.acceptAllRevisionsInDocument();

    expect(mocks.loadDocumentJsonAtomically).not.toHaveBeenCalled();
    expect(editor.commands.acceptAllRevisionsInBlock).not.toHaveBeenCalled();
    expect(store.canonicalPendingBlockCount.value).toBe(1);
    expect(mocks.fileStore.setDirty).not.toHaveBeenCalled();
    expect(status).toBe('blocked');
  });

  it('后端已提交但 Editor 严格装载失败时保留 canonical、dirty 与 runtime，并返回重新打开状态', async () => {
    mocks.loadDocumentJsonAtomically.mockImplementationOnce(() => {
      throw new Error('unknown mark');
    });
    const editor = createEditor();
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0]);
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    };

    const status = await store.acceptAllRevisionsInDocument();

    expect(store.canonicalPendingBlockCount.value).toBe(1);
    expect(mocks.fileStore.setDirty).not.toHaveBeenCalled();
    expect(status).toBe('reload-required');
    expect(editor.commands.acceptAllRevisionsInBlock).not.toHaveBeenCalled();
  });

  it('IPC 失败时不再执行逐块 fallback', async () => {
    mocks.applyAllPendingRevisions.mockResolvedValueOnce({
      success: false,
      error: 'ipc failed',
    });
    const editor = createEditor();
    const store = useRevisionStore(editor as unknown as Parameters<typeof useRevisionStore>[0]);
    store.canonicalPendingSessions.value = {
      b1: {
        pendingId: 'p1',
        blockId: 'b1',
        operation: 'update',
        revisionId: 'ai-p1',
        createdAt: 1,
      },
    };

    const status = await store.acceptAllRevisionsInDocument();

    expect(editor.commands.acceptAllRevisionsInBlock).not.toHaveBeenCalled();
    expect(mocks.requestSave).not.toHaveBeenCalled();
    expect(store.canonicalPendingBlockCount.value).toBe(1);
    expect(status).toBe('blocked');
  });
});
