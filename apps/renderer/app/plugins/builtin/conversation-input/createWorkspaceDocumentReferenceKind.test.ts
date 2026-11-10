import { describe, expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation } from '@app/schemas';
import { createWorkspaceDocumentReferenceKind } from './createWorkspaceDocumentReferenceKind';
const reference = { id: 'ref', pluginId: 'platform', kind: 'workspace-document', label: '文档', previewText: '', text: '', metadata: { documentId: 'document', projectId: 'project' } };
const typeIcon = vi.fn((nodeType: string | null) => ({ name: nodeType ?? 'generic' }));
const available: DocumentReferencePresentation = { documentId: 'document', status: 'available', title: '新标题', nodeType: 'markdown', path: 'workspace:/文档.md' };
describe('Workspace引用激活', () => {
  it('读取正式身份后打开当前标题，异步期间切项目则拒绝导航', async () => {
    let project: string | null = 'project';
    const open = vi.fn(async () => {}), read = vi.fn(async () => available);
    const kind = createWorkspaceDocumentReferenceKind({ currentProjectId: () => project, read, open, typeIcon });
    await kind.onActivate?.(reference);
    expect(open).toHaveBeenCalledWith(available, 'project');
    open.mockClear();
    read.mockImplementationOnce(async () => { project = 'another'; return available; });
    await expect(kind.onActivate?.(reference)).rejects.toThrow('不在当前项目');
    expect(open).not.toHaveBeenCalled();
  });
  it('跨项目不发请求；删除或插件不可用不打开旧文档', async () => {
    const open = vi.fn(async () => {}), read = vi.fn(async () => available);
    const foreign = createWorkspaceDocumentReferenceKind({ currentProjectId: () => null, read, open, typeIcon });
    await expect(foreign.onActivate?.(reference)).rejects.toThrow('不在当前项目');
    expect(read).not.toHaveBeenCalled();
    const kind = createWorkspaceDocumentReferenceKind({ currentProjectId: () => 'project', read, open, typeIcon });
    read.mockResolvedValueOnce({ ...available, status: 'plugin_unavailable' });
    await expect(kind.onActivate?.(reference)).rejects.toThrow('启用或安装');
    read.mockResolvedValueOnce({ ...available, status: 'deleted' });
    await expect(kind.onActivate?.(reference)).rejects.toThrow('不可访问');
    expect(open).not.toHaveBeenCalled();
  });
  it('标签图标取引用时记下的文档类型，与文件树同源；缺类型时交给 Host 兜底', () => {
    const kind = createWorkspaceDocumentReferenceKind({ currentProjectId: () => 'project', read: vi.fn(), open: vi.fn(), typeIcon });
    expect(kind.chip.icon?.({ ...reference, metadata: { ...reference.metadata, documentType: 'canvas' } })).toEqual({ name: 'canvas' });
    expect(kind.chip.icon?.(reference)).toEqual({ name: 'generic' });
  });
});
