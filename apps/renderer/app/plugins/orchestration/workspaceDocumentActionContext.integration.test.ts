import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/domains/workspace/services/file-manager', () => ({
  getActiveFileSession: () => ({ documentId: 'document-a' }),
}));
vi.mock('@/shared/stores/ui', () => ({
  useUIStore: () => { throw new Error('Another active editor must not be read'); },
}));
vi.mock('@/app/navigation', () => ({ useNavigationScope: () => ({ currentProjectId: 'project-one' }) }));
vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: { 'read-document': async ({ documentId }: { documentId: string }) => ({
    success: true, data: { content: { documentId } },
  }) },
}));
vi.mock('@/domains/editor/document-export', () => ({
  parseMarkdownDocumentForExport: async (content: unknown) => content,
}));
vi.mock('@/shared/utils/markdownSerializer', () => ({
  createMarkdownSerializer: () => ({ serialize: (document: { documentId: string }) => `saved:${document.documentId}` }),
}));
import { freezeWorkspaceDocumentActionContext } from './workspaceDocumentActionContext';

afterEach(() => vi.unstubAllGlobals());

it('跨文档菜单经正式引用 SDK 只发送冻结身份，保留右键目标的标题与正文', async () => {
  const resolve = vi.fn(async () => ({
    documentId: 'document-b', status: 'available', nodeType: 'document', title: 'Bravo', path: '/Bravo.md',
  }));
  vi.stubGlobal('window', { electronAPI: { 'document-references:resolve': resolve } });
  const context = freezeWorkspaceDocumentActionContext({
    projectId: 'project-one', documentId: 'document-b', activeDocumentType: 'editor', displayName: 'Old Bravo',
  });
  // SDK 的严格请求 schema 是真实生产边界，菜单的附加字段不能直接透传。
  await expect(context.readMarkdownSnapshot?.(new AbortController().signal)).resolves.toEqual({
    displayName: 'Bravo', markdown: 'saved:document-b',
  });
  expect(resolve).toHaveBeenCalledWith({ projectId: 'project-one', documentId: 'document-b' });
});
