import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TestDocumentType = string;

interface TestActiveDocumentSession {
  readonly documentId: string;
  readonly displayName?: string | null;
  readonly type: TestDocumentType;
}

interface TestDocumentSummary {
  readonly id: string;
  readonly title?: string;
  readonly type: TestDocumentType;
  readonly projectId?: string;
}

const workspaceContextMock = vi.hoisted(() => {
  const state: {
    activeSession: TestActiveDocumentSession | null;
    summaries: Map<string, TestDocumentSummary>;
  } = {
    activeSession: null,
    summaries: new Map(),
  };

  return {
    state,
    port: {
      getActiveDocumentSession() {
        return state.activeSession;
      },
      findDocumentSummary(documentId: string) {
        return state.summaries.get(documentId) ?? null;
      },
      getCurrentProjectSummary() {
        return null;
      },
      getProjectFileSummaries() {
        return [];
      },
      async requestSaveBeforeAiInvoke() {
        return true;
      },
    },
  };
});

vi.mock('../../../../../shared/stores/file', () => ({
  useFileStore: () => ({
    currentFilePath: null,
    currentFileName: null,
  }),
}));

vi.mock('../../../../../shared/ports/workspaceContextPort', () => ({
  getWorkspaceContextPort: () => workspaceContextMock.port,
}));

vi.mock('../../../../../app/plugins/registry', () => ({
  getDocumentTypeByCreateRequestType(type: string) {
    const activeDocumentTypeByCreateRequestType: Record<string, string> = {
      markdown: 'editor',
      mindmap: 'mindmap',
      sheet: 'sheet',
      presentation: 'slides',
      whiteboard: 'whiteboard-canvas',
    };
    const activeDocumentType = activeDocumentTypeByCreateRequestType[type];
    return activeDocumentType
      ? { createRequestType: type, activeDocumentType }
      : null;
  },
}));

beforeAll(() => {
  const storage = {
    getItem: (_key: string) => null,
    setItem: (_key: string, _value: string) => {},
    removeItem: (_key: string) => {},
    clear: () => {},
    key: (_index: number) => null,
    length: 0,
  } satisfies Storage;

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'electronAPI', {
    value: {
      onApiPortSet: (_listener: (port: number) => void) => {},
      invoke: async (_channel: string) => 3000,
    },
    configurable: true,
  });
});

beforeEach(async () => {
  workspaceContextMock.state.activeSession = null;
  workspaceContextMock.state.summaries.clear();
  const pageContextProvider = await import('@plugin/renderer/pageContextProvider');
  pageContextProvider.clearRendererPageContextProvidersForTest();
});

describe('formatPageContextForContextBefore', () => {
  it('includes slides summary when current page is a presentation', async () => {
    const { formatPageContextForContextBefore } = await import('./pageContext');

    const pageContext = {
      kind: 'slides',
      projectId: 'project-1',
      document: {
        id: 'pres-1',
        type: 'presentation',
        title: 'Q3 Review',
      },
      pluginSummary: {
        sections: [{
          sectionName: 'slides_summary',
          lines: [
            'slide_count=12',
            'current_slide_number=4',
            'warning_count=1',
          ],
        }],
      },
    } as const;

    const text = formatPageContextForContextBefore(pageContext);

    expect(text).toContain('[page_context]');
    expect(text).toContain('document_id=pres-1');
    expect(text).toContain('document_type=presentation');
    expect(text).toContain('document_title=Q3 Review');
    expect(text).toContain('[slides_summary]');
    expect(text).toContain('slide_count=12');
    expect(text).toContain('current_slide_number=4');
    expect(text).toContain('warning_count=1');
    expect(text).not.toContain('presentation_id=');
    expect(text).not.toContain('presentation_title=');
    expect(text).not.toContain('presentation_version=');
    expect(text).not.toContain('current_slide_layout=');
    expect(text).not.toContain('kind=slides');
  });

  it('keeps page kind when no document is open', async () => {
    const { formatPageContextForContextBefore } = await import('./pageContext');

    expect(formatPageContextForContextBefore({ kind: 'project_home' })).toBe([
      '[page_context]',
      'kind=project_home',
    ].join('\n'));
  });
});

describe('buildPageContextV1', () => {
  it('maps active presentation sessions to presentation document context', async () => {
    workspaceContextMock.state.activeSession = {
      documentId: 'deck-1',
      displayName: '路线图.slides',
      type: 'presentation',
    };
    workspaceContextMock.state.summaries.set('deck-1', {
      id: 'deck-1',
      title: '路线图.slides',
      type: 'presentation',
      projectId: 'project-1',
    });

    const { buildPageContextV1, formatPageContextForContextBefore } = await import('./pageContext');
    const context = buildPageContextV1();

    expect(context).toMatchObject({
      kind: 'slides',
      projectId: 'project-1',
      document: {
        id: 'deck-1',
        type: 'presentation',
        title: '路线图.slides',
      },
    });
    expect(formatPageContextForContextBefore(context)).toContain('document_type=presentation');
  });

  it('does not synthesize a current document from stale page context providers', async () => {
    const pageContextProvider = await import('@plugin/renderer/pageContextProvider');
    pageContextProvider.registerRendererPageContextProvider({
      id: 'stale-slides-provider',
      kind: 'slides',
      documentType: 'presentation',
      buildDocument: () => ({
        id: 'stale-deck',
        type: 'presentation',
        title: '已关闭的演示文稿',
      }),
    });

    const { buildPageContextV1 } = await import('./pageContext');

    expect(buildPageContextV1()).toEqual({
      kind: 'project_home',
      projectId: undefined,
      document: undefined,
      selection: undefined,
      pluginSummary: undefined,
    });
  });

  it('uses renderer document registry strings for plugin document page kind', async () => {
    workspaceContextMock.state.activeSession = {
      documentId: 'board-1',
      displayName: '白板',
      type: 'whiteboard',
    };
    workspaceContextMock.state.summaries.set('board-1', {
      id: 'board-1',
      title: '白板',
      type: 'whiteboard',
      projectId: 'project-1',
    });

    const { buildPageContextV1, formatPageContextForContextBefore } = await import('./pageContext');
    const context = buildPageContextV1();

    expect(context).toMatchObject({
      kind: 'whiteboard-canvas',
      document: {
        id: 'board-1',
        type: 'whiteboard',
        title: '白板',
      },
    });
    expect(formatPageContextForContextBefore(context)).toContain('document_type=whiteboard');
  });
});
