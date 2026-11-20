import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation } from '@app/schemas';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import { PLUGIN_CONTRIBUTION_MESSAGE_CATALOG } from '../../definitions/pluginContributionMessageCatalog';
import { createWorkspaceDocumentReferenceKind } from './createWorkspaceDocumentReferenceKind';
const reference = { id: 'ref', pluginId: 'platform', kind: 'workspace-document', label: '文档', previewText: '', text: '', metadata: { documentId: 'document', projectId: 'project' } };
const typeIcon = vi.fn((nodeType: string | null) => ({ name: nodeType ?? 'generic' }));
const available: DocumentReferencePresentation = { documentId: 'document', status: 'available', title: '新标题', nodeType: 'markdown', path: 'workspace:/文档.md' };
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => clearLocalizationRegistryForTest());
describe('Workspace引用激活', () => {
  it('输入框引用标签上显示的失败提示按界面语言生成', async () => {
    registerMessageCatalogs(PLUGIN_CONTRIBUTION_MESSAGE_CATALOG);
    useLocalizationStore().setCurrentLocale('en-US');
    const read = vi.fn(async () => available);
    const kind = createWorkspaceDocumentReferenceKind({ currentProjectId: () => 'project', read, open: vi.fn(), typeIcon });
    read.mockResolvedValueOnce({ ...available, status: 'deleted' });
    await expect(kind.onActivate?.(reference)).rejects.toThrow('The referenced document is not accessible right now.');
    read.mockResolvedValueOnce({ ...available, status: 'plugin_unavailable' });
    await expect(kind.onActivate?.(reference)).rejects.toThrow('Enable or install the required plugin from the preview to open this document.');
    const foreign = createWorkspaceDocumentReferenceKind({ currentProjectId: () => null, read, open: vi.fn(), typeIcon });
    await expect(foreign.onActivate?.(reference)).rejects.toThrow('This reference is not in the current project, so it cannot be previewed or opened.');
  });
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
