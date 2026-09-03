import { beforeEach, describe, expect, it, vi } from 'vitest';

import { attachPresentationCoordinatorToToolContext } from '../tools';
import { createSlidesDocumentHookRuntime } from './createSlidesDocumentHookRuntime';

const workspaceRuntimeMock = vi.hoisted(() => ({
  WorkspaceService: vi.fn(),
}));

vi.mock('@plugin/backend/workspaceRuntime', () => ({
  WorkspaceService: workspaceRuntimeMock.WorkspaceService,
}));

const coordinatorRuntimeMock = vi.hoisted(() => ({
  getSharedPptCoordinator: vi.fn(),
}));

vi.mock('@plugin/slides/backend-coordinator', () => ({
  getSharedPptCoordinator: coordinatorRuntimeMock.getSharedPptCoordinator,
}));

function createContext() {
  const db = { prepare: vi.fn() };
  const context = {
    databaseService: { getDb: () => db },
  };
  return { db, context };
}

function makeCoordinator() {
  const codegenPresentationService = {
    write: vi.fn(async () => ({
      presentationId: 'slides-1',
      versionId: 'version-2',
      versionNumber: 2,
      buildStatus: 'ready',
      diagnostics: [
        {
          phase: 'structure',
          severity: 'warning',
          code: 'LAYOUT_UNATTACHED_RENDERABLE_NODE',
          message: '元素未挂载。',
          hint: '将元素加入 Slide。',
          sourceSpan: { startLine: 3, endLine: 3 },
        },
      ],
    })),
    read: vi.fn(async () => ({
      type: 'text',
      file: {
        presentationId: 'slides-1',
        content: 'compose({ title: "Deck", slides: [] })',
      },
    })),
  };
  return {
    createEmptyPresentation: vi.fn(async () => ({
      nodeId: 'slides-1',
      versionId: 'version-1',
    })),
    getCodegenPresentationService: vi.fn(() => codegenPresentationService),
  };
}

describe('createSlidesDocumentHookRuntime', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('通用 document hook fallback 复用共享 coordinator', async () => {
    const { db, context } = createContext();
    const coordinator = makeCoordinator();
    coordinatorRuntimeMock.getSharedPptCoordinator.mockReturnValue(coordinator);

    const runtime = createSlidesDocumentHookRuntime(context);
    await runtime.createEmptyPresentation({
      projectId: 'project-1',
      title: 'Deck',
    });

    expect(coordinatorRuntimeMock.getSharedPptCoordinator).toHaveBeenCalledWith(db);
    expect(coordinator.createEmptyPresentation).toHaveBeenCalledWith({
      projectId: 'project-1',
      title: 'Deck',
    });
  });

  it('context 已有 coordinator 绑定时优先使用绑定，不再读取共享工厂', async () => {
    const { context } = createContext();
    const injectedCoordinator = makeCoordinator();
    attachPresentationCoordinatorToToolContext(context, injectedCoordinator);

    const runtime = createSlidesDocumentHookRuntime(context);
    await runtime.createEmptyPresentation({
      projectId: 'project-1',
      title: 'Deck',
    });

    expect(coordinatorRuntimeMock.getSharedPptCoordinator).not.toHaveBeenCalled();
    expect(injectedCoordinator.createEmptyPresentation).toHaveBeenCalledWith({
      projectId: 'project-1',
      title: 'Deck',
    });
  });

  it('writeSource 原样透传 codegen 诊断', async () => {
    const { context } = createContext();
    const coordinator = makeCoordinator();
    attachPresentationCoordinatorToToolContext(context, coordinator);

    const codegenPresentationService = coordinator.getCodegenPresentationService();
    const result = await createSlidesDocumentHookRuntime(context).writeSource(
      {
        presentationId: 'slides-1',
        source: 'const slide = createSlide();',
        expectedSourceKey: 'compiled:version-1',
      },
      { conversationId: 'conversation-1', projectId: 'project-1' }
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'LAYOUT_UNATTACHED_RENDERABLE_NODE',
        sourceSpan: { startLine: 3, endLine: 3 },
      }),
    ]);
    expect(result.buildStatus).toBe('ready');
    expect(codegenPresentationService.write).toHaveBeenCalledWith(
      {
        presentation_id: 'slides-1',
        source: 'const slide = createSlide();',
        expected_source_key: 'compiled:version-1',
      },
      {
        conversationId: 'conversation-1',
        projectId: 'project-1',
      }
    );
  });
});
