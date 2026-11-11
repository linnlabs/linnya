import { beforeEach, expect, it, vi } from 'vitest';
import type { FileSessionDescriptor } from '@linnya/plugin-host-contract/renderer/workspaceRuntime';

const state = vi.hoisted(() => ({
  events: [] as string[],
  save: vi.fn<() => Promise<void>>(),
  open: vi.fn<(session: FileSessionDescriptor) => Promise<void>>(),
  defer: false,
  enabled: true,
}));
vi.mock('@/app/layout/store/layoutStore', () => ({ useLayoutStore: () => ({
  openDocument: () => state.events.push('mount'),
}) }));
vi.mock('@/app/navigation', () => ({ useNavigationScope: () => ({ enterProject: vi.fn() }) }));
vi.mock('@/app/active-document', () => ({ useFileStore: () => ({ setFilePath: vi.fn() }) }));
vi.mock('@/shared/ports/documentSurfaceRuntimePort', () => ({ getDocumentSurfaceRuntimePort: () => ({
  waitForSurfaceReady: async () => { state.events.push('ready'); },
}) }));
vi.mock('@/domains/workspace/services/file-manager', () => ({
  getActiveFileSession: () => ({ documentId: 'previous', type: 'editable' }),
  saveDeactivateThen: async (action: () => Promise<void>) => { await state.save(); state.events.push('deactivate'); await action(); },
  activateFileSession: (session: FileSessionDescriptor) => state.open(session),
}));
vi.mock('@/app/plugins/registry', () => ({ getDocumentTypeByActiveType: (type: string) => type === 'editable' ? ({
  pluginId: 'editable-plugin', activeDocumentType: 'editable', fileSessionType: 'editable',
  deferSurfaceUntilOpen: state.defer,
}) : null,
getDocumentTypeByNodeType: (type: string) => type === 'persisted-document' ? ({ activeDocumentType: 'editable' }) : null,
}));
vi.mock('@/app/plugins/enabledPluginsStore', () => ({ useEnabledPluginsStore: () => ({ isPluginEnabled: () => state.enabled }) }));
vi.mock('@/domains/workspace/tree', () => ({ useWorkspaceTree: vi.fn() }));
vi.mock('@/domains/conversation/history/loader', () => ({ useHistoryLoader: vi.fn() }));
vi.mock('@/domains/conversation/store/assistantStore', () => ({ useAssistantStore: vi.fn() }));
vi.mock('@/domains/workspace/features/project-overview/store/projectKnowledgeBaseModalStore', () => ({
  useProjectKnowledgeBaseModalStore: () => ({ close: vi.fn() }),
}));

import { createWorkspaceNavigation } from './workspaceNavigation';
const request = { documentId: 'next', projectId: 'project', type: 'editable', parameters: { slideNumber: 2 } };
beforeEach(() => { state.events = []; state.defer = false; state.enabled = true; vi.resetAllMocks(); });

it('文档内目标跳转等待旧会话保存，再挂载 surface 并携带定位参数打开 file session', async () => {
  let saved!: () => void;
  state.save.mockImplementation(() => new Promise<void>(resolve => { saved = resolve; }));
  state.open.mockImplementation(async () => { state.events.push('open'); });
  const opening = createWorkspaceNavigation().openDocumentTarget(request);
  await Promise.resolve();
  expect(state.events).toEqual([]);
  saved(); await opening;
  expect(state.events).toEqual(['deactivate', 'mount', 'ready', 'open']);
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'next', type: 'editable',
    payload: expect.objectContaining({ navigationParameters: { slideNumber: 2 } }) }));
});

it('旧文稿保存失败时保留原 surface，不打开目标文稿', async () => {
  state.save.mockRejectedValue(new Error('save failed'));
  await expect(createWorkspaceNavigation().openDocumentTarget(request)).rejects.toThrow('save failed');
  expect(state.events).toEqual([]);
  expect(state.open).not.toHaveBeenCalled();
});

it('依赖会话身份的 surface 在引用跳转时也等待目标会话再挂载', async () => {
  state.defer = true; state.open.mockImplementation(async () => { state.events.push('open'); });
  await createWorkspaceNavigation().openDocumentTarget(request);
  expect(state.events).toEqual(['deactivate', 'open', 'mount', 'ready']);
  expect(state.open).toHaveBeenCalledTimes(1);
});

it('延迟挂载文档打开失败时不挂载无会话的界面', async () => {
  state.defer = true; state.open.mockRejectedValue(new Error('document unavailable'));
  await expect(createWorkspaceNavigation().openDocumentTarget(request)).rejects.toThrow('document unavailable');
  expect(state.events).toEqual(['deactivate']);
});

it('引用的持久nodeType经唯一registry映射后复用保存与正式文档目标导航', async () => {
  state.open.mockImplementation(async () => { state.events.push('open'); });
  await createWorkspaceNavigation().openDocumentByNodeType({
    documentId: 'next', projectId: 'project', nodeType: 'persisted-document', parameters: { section: 'overview' },
  });
  expect(state.events).toEqual(['deactivate', 'mount', 'ready', 'open']);
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ type: 'editable',
    payload: expect.objectContaining({ projectId: 'project', navigationParameters: { section: 'overview' } }) }));
  await expect(createWorkspaceNavigation().openDocumentTarget({ ...request, type: 'persisted-document' })).rejects.toThrow('unsupported document type');
});

it('未知节点类型或已停用owner在替换当前文档前明确拒绝', async () => {
  const navigation = createWorkspaceNavigation();
  await expect(navigation.openDocumentByNodeType({ documentId: 'next', projectId: 'project', nodeType: 'missing' })).rejects.toThrow('unsupported document node type');
  state.enabled = false;
  await expect(navigation.openDocumentByNodeType({ documentId: 'next', projectId: 'project', nodeType: 'persisted-document' })).rejects.toThrow('plugin disabled');
  expect(state.save).not.toHaveBeenCalled(); expect(state.events).toEqual([]); expect(state.open).not.toHaveBeenCalled();
});
