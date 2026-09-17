import { beforeEach, expect, it, vi } from 'vitest';
import type { FileSessionDescriptor } from '@linnya/plugin-host-contract/renderer/workspaceRuntime';

const state = vi.hoisted(() => ({
  events: [] as string[],
  save: vi.fn<() => Promise<void>>(),
  open: vi.fn<(session: FileSessionDescriptor) => Promise<void>>(),
}));
vi.mock('@/app/layout/store/layoutStore', () => ({ useLayoutStore: () => ({
  openDocument: () => state.events.push('mount'),
}) }));
vi.mock('@/shared/stores/workspaceScopeStore', () => ({ useWorkspaceScopeStore: () => ({ enterProject: vi.fn() }) }));
vi.mock('@/shared/stores/file', () => ({ useFileStore: () => ({ setFilePath: vi.fn() }) }));
vi.mock('@/shared/ports/documentSurfaceRuntimePort', () => ({ getDocumentSurfaceRuntimePort: () => ({
  waitForSurfaceReady: async () => { state.events.push('ready'); },
}) }));
vi.mock('@/domains/workspace/services/file-manager', () => ({
  getActiveFileSession: () => ({ documentId: 'previous', type: 'editable' }),
  saveDeactivateThen: async (action: () => Promise<void>) => { await state.save(); state.events.push('deactivate'); await action(); },
  activateFileSession: (session: FileSessionDescriptor) => state.open(session),
}));
vi.mock('@/app/plugins/registry', () => ({ getDocumentTypeByActiveType: () => ({
  pluginId: 'editable-plugin', activeDocumentType: 'editable', fileSessionType: 'editable',
}) }));
vi.mock('@/app/plugins/enabledPluginsStore', () => ({ useEnabledPluginsStore: () => ({ isPluginEnabled: () => true }) }));
vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({ useWorkspaceTreeStore: vi.fn() }));
vi.mock('@/domains/conversation/history/store/historyLoaderStore', () => ({ useHistoryLoaderStore: vi.fn() }));
vi.mock('@/domains/conversation/store/assistantStore', () => ({ useAssistantStore: vi.fn() }));
vi.mock('@/domains/workspace/features/project-overview/store/projectOverviewModalStore', () => ({
  useProjectOverviewModalStore: () => ({ close: vi.fn() }),
}));

import { createWorkspaceNavigation } from './workspaceNavigation';
const request = { documentId: 'next', projectId: 'project', type: 'editable', parameters: { slideNumber: 2 } };
beforeEach(() => { state.events = []; vi.resetAllMocks(); });

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
