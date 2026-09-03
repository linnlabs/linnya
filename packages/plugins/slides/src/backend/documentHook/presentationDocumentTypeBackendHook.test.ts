import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SLIDES_DOCUMENT_TYPE } from '@plugin/slides/shared';

import { createPresentationDocumentTypeBackendHook } from './presentationDocumentTypeBackendHook';
import type { SlidesDocumentHookRuntime } from './presentationDocumentHookRuntime';

function makeRuntime(): SlidesDocumentHookRuntime {
  return {
    createEmptyPresentation: vi.fn(async () => ({
      nodeId: 'slides-empty',
      versionId: 'version-empty',
    })),
    writeSource: vi.fn(async () => ({
      presentationId: 'slides-from-source',
      versionId: 'version-from-source',
      versionNumber: 2,
      buildStatus: 'ready',
      diagnostics: [
        {
          phase: 'structure',
          severity: 'warning',
          code: 'LAYOUT_UNATTACHED_CONTENT_SUBTREE',
          message: '容器未接入最终 Slide 树。',
          hint: '检查该页的 .add(...)。',
          slideNumber: 4,
          sourceSpan: { startLine: 209, endLine: 209 },
        },
      ],
    })),
    readSource: vi.fn(async () => ({
      type: 'text',
      file: {
        presentationId: 'slides-from-source',
        title: 'Source Deck',
        versionId: 'version-from-source',
        content: 'const slide = createSlide();',
      },
    })),
    renameCreatedNodeToRequestedFileName: vi.fn(),
  };
}

function makeRuntimeWithReadOutput(
  readSourceOutput: Awaited<ReturnType<SlidesDocumentHookRuntime['readSource']>>
): SlidesDocumentHookRuntime {
  const runtime = makeRuntime();
  vi.mocked(runtime.readSource).mockResolvedValue(readSourceOutput);
  return runtime;
}

describe('createPresentationDocumentTypeBackendHook.createDocument', () => {
  it('creates a blank presentation through the runtime when content is omitted', async () => {
    const runtime = makeRuntime();
    const hook = createPresentationDocumentTypeBackendHook(() => runtime);
    const result = await hook.createDocument?.({
      context: {},
      projectId: 'project-1',
      parentId: 'folder-1',
      name: '空白演示',
    });

    expect(result).toEqual({
      documentId: 'slides-empty',
      toolResultData: {
        presentationId: 'slides-empty',
        versionId: 'version-empty',
      },
    });
    expect(runtime.createEmptyPresentation).toHaveBeenCalledWith({
      projectId: 'project-1',
      parentId: 'folder-1',
      title: '空白演示',
    });
    expect(runtime.writeSource).not.toHaveBeenCalled();
  });

  it('keeps write-file creation on the codegen source path when content is provided', async () => {
    const runtime = makeRuntime();
    const hook = createPresentationDocumentTypeBackendHook(() => runtime);
    const result = await hook.createDocument?.({
      context: { conversationId: 'conversation-1' },
      projectId: 'project-1',
      parentId: null,
      name: 'source.slides',
      content: 'const slide = createSlide();',
    });

    expect(result?.documentId).toBe('slides-from-source');
    expect(result?.toolResultData).toMatchObject({
      presentationId: 'slides-from-source',
      versionId: 'version-from-source',
      versionNumber: 2,
    });
    expect(result?.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'LAYOUT_UNATTACHED_CONTENT_SUBTREE',
        message: '容器未接入最终 Slide 树。 建议：检查该页的 .add(...)。',
        target: 'line 209, slide 4',
      },
    ]);
    expect(runtime.createEmptyPresentation).not.toHaveBeenCalled();
    expect(runtime.writeSource).toHaveBeenCalledWith(
      { source: 'const slide = createSlide();' },
      {
        conversationId: 'conversation-1',
        projectId: 'project-1',
        requestedTitle: 'source.slides',
      }
    );
    expect(runtime.renameCreatedNodeToRequestedFileName).toHaveBeenCalledWith({
      nodeId: 'slides-from-source',
      fileName: 'source.slides',
    });
  });

  it('首次编译失败仍返回创建成功，并把结构化失败作为 error diagnostic', async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.writeSource).mockResolvedValueOnce({
      presentationId: 'slides-draft',
      versionId: 'version-shell',
      versionNumber: 1,
      buildStatus: 'draft',
      diagnostics: [],
      draftStatus: {
        baseVersionId: 'version-shell',
        baseVersionNumber: 1,
        errorKind: 'slides.codegen.typecheck',
        errorSummary: 'TS8006 at line 1',
        updatedAt: 100,
      },
      buildFailure: {
        code: 'slides.codegen.typecheck',
        phase: 'typecheck',
        retryable: false,
        sourceFixable: true,
        summary: 'Sandbox compile error: TS8006.',
        nextAction: 'Fix the reported deck.js lines, then write the source again.',
        diagnostics: [{ tsCode: 8006, line: 1, column: 1 }],
        draftSaved: true,
        presentationId: 'slides-draft',
        expectedRevision: { revisionId: 'version-shell', revision: 1 },
      },
    });
    const hook = createPresentationDocumentTypeBackendHook(() => runtime);

    const result = await hook.createDocument?.({
      context: { conversationId: 'conversation-1' },
      projectId: 'project-1',
      parentId: null,
      name: 'broken.slides',
      content: 'interface Broken { x: number; }',
    });

    expect(result).toMatchObject({
      documentId: 'slides-draft',
      toolResultData: {
        buildStatus: 'draft',
        draftStatus: { errorKind: 'slides.codegen.typecheck' },
      },
      diagnostics: [{
        severity: 'error',
        code: 'slides.codegen.typecheck',
        target: 'line 1, column 1 (TS8006)',
      }],
    });
    if (!result) throw new Error('Expected Slides create result.');
    expect(hook.formatCreateObservation?.({
      path: '/broken.slides',
      inode: 'slides-draft',
      result,
    })).toContain('源码已保存，但 PPT 编译失败');
  });
});

describe('createPresentationDocumentTypeBackendHook.writeDocument', () => {
  it('writes source without using readSource as an authorization step', async () => {
    const runtime = makeRuntime();
    const hook = createPresentationDocumentTypeBackendHook(() => runtime);

    const result = await hook.writeDocument?.({
      context: { conversationId: 'conversation-1' },
      projectId: 'project-1',
      documentId: 'slides-1',
      documentName: 'source.slides',
      content: 'const slide = createSlide();',
      expectedSourceKey: 'compiled:version-1',
    });

    expect(runtime.readSource).not.toHaveBeenCalled();
    expect(runtime.writeSource).toHaveBeenCalledWith(
      {
        presentationId: 'slides-1',
        source: 'const slide = createSlide();',
        expectedSourceKey: 'compiled:version-1',
      },
      {
        conversationId: 'conversation-1',
        projectId: 'project-1',
      }
    );
    expect(result?.toolResultData).toMatchObject({
      presentationId: 'slides-from-source',
      versionId: 'version-from-source',
      versionNumber: 2,
    });
    expect(result?.diagnostics?.[0]).toMatchObject({
      code: 'LAYOUT_UNATTACHED_CONTENT_SUBTREE',
      target: 'line 209, slide 4',
    });
  });
});

describe('createPresentationDocumentTypeBackendHook.readProjectCharCount', () => {
  it('counts current Slides deck source and excludes deleted workspace nodes', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE workspace_nodes (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE presentation_documents (
          node_id TEXT PRIMARY KEY,
          deck_source TEXT NOT NULL,
          title TEXT NOT NULL,
          slide_count INTEGER NOT NULL
        );
      `);
      db.prepare(
        `
        INSERT INTO workspace_nodes (id, project_id, type, name, deleted_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('slides-1', 'project-1', SLIDES_DOCUMENT_TYPE, 'Deck.slides', null);
      db.prepare(
        `
        INSERT INTO workspace_nodes (id, project_id, type, name, deleted_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('slides-deleted', 'project-1', SLIDES_DOCUMENT_TYPE, 'Deleted.slides', 1);
      db.prepare(
        `
        INSERT INTO presentation_documents (node_id, deck_source, title, slide_count)
        VALUES (?, ?, ?, ?)
      `
      ).run('slides-1', 'latest source text', 'Deck', 1);
      db.prepare(
        `
        INSERT INTO presentation_documents (node_id, deck_source, title, slide_count)
        VALUES (?, ?, ?, ?)
      `
      ).run('slides-deleted', 'deleted source text', 'Deleted', 1);

      const hook = createPresentationDocumentTypeBackendHook(makeRuntime);

      expect(
        hook.readProjectCharCount?.({
          db: {
            prepare: sql => ({
              get: (...params: readonly unknown[]) => db.prepare(sql).get(...params),
            }),
          },
          projectId: 'project-1',
        })
      ).toBe('latest source text'.length);
    } finally {
      db.close();
    }
  });
});

describe('createPresentationDocumentTypeBackendHook.duplicateDocument', () => {
  it('duplicates the latest source through the source creation path', async () => {
    const runtime = makeRuntime();
    const hook = createPresentationDocumentTypeBackendHook(() => runtime);

    const result = await hook.duplicateDocument?.({
      context: { conversationId: 'conversation-1' },
      sourceDocumentId: 'slides-source',
      projectId: 'project-1',
      parentId: 'folder-1',
      name: '复制演示.slides',
    });

    expect(result).toEqual({ documentId: 'slides-from-source' });
    expect(runtime.readSource).toHaveBeenCalledWith({
      presentationId: 'slides-source',
      conversationId: 'conversation-1',
    });
    expect(runtime.writeSource).toHaveBeenCalledWith(
      { source: 'const slide = createSlide();' },
      {
        conversationId: 'conversation-1',
        projectId: 'project-1',
        parentId: 'folder-1',
        requestedTitle: '复制演示.slides',
      }
    );
    expect(runtime.renameCreatedNodeToRequestedFileName).toHaveBeenCalledWith({
      nodeId: 'slides-from-source',
      fileName: '复制演示.slides',
    });
  });

  it('returns null when source code is unavailable', async () => {
    const runtime = makeRuntimeWithReadOutput({
      type: 'deck_unchanged',
      file: {
        presentationId: 'slides-source',
        title: 'Source Deck',
      },
    });
    const hook = createPresentationDocumentTypeBackendHook(() => runtime);

    const result = await hook.duplicateDocument?.({
      context: { conversationId: 'conversation-1' },
      sourceDocumentId: 'slides-source',
      projectId: 'project-1',
      parentId: null,
      name: '复制演示.slides',
    });

    expect(result).toBeNull();
    expect(runtime.writeSource).not.toHaveBeenCalled();
    expect(runtime.renameCreatedNodeToRequestedFileName).not.toHaveBeenCalled();
  });
});
