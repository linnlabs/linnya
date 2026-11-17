import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceNavigation } from './workspaceNavigation';
import { activateRendererPlugin, clearRendererPluginRegistryForTest, deactivateRendererPlugin,
  registerRendererPlugin } from '@/app/plugins/registry';

const state = vi.hoisted(() => ({
  save: vi.fn<() => Promise<void>>(async () => undefined), events: [] as string[],
}));
vi.mock('@/app/layout/store/layoutStore', () => ({ useLayoutStore: () => ({
  openBypassView: (view: { type: string }) => state.events.push(view.type), setSidebarNav: vi.fn(),
}) }));
vi.mock('@/app/navigation', () => ({ useNavigationScope: () => ({ enterProject: vi.fn() }) }));
vi.mock('@/app/active-document', () => ({ useFileStore: vi.fn() }));
vi.mock('@/domains/workspace/services/file-manager', () => ({
  saveDeactivateThen: async (action: () => Promise<void>) => { await state.save(); await action(); },
}));
vi.mock('@/app/plugins/enabledPluginsStore', () => ({ useEnabledPluginsStore: () => ({
  enabledPluginIds: new Set(['knowledge']),
}) }));
vi.mock('@/domains/workspace/tree', () => ({ useWorkspaceTree: vi.fn() }));
vi.mock('@/domains/conversation/history/loader', () => ({ useHistoryLoader: vi.fn() }));
vi.mock('@/domains/conversation/store/assistantStore', () => ({ useAssistantStore: vi.fn() }));
vi.mock('@/domains/workspace/features/project-overview/store/projectKnowledgeBaseModalStore', () => ({
  useProjectKnowledgeBaseModalStore: () => ({ close: vi.fn() }),
}));

async function install(prepare: (signal: AbortSignal) => Promise<void>) {
  const component = { render: () => null };
  registerRendererPlugin({ meta: { id: 'knowledge', name: 'Knowledge', version: '1',
    description: 'Test', developer: 'Test', builtin: true },
  applicationSurface: { title: 'Knowledge', iconComponent: component, pageComponent: component, prepare },
  }, { applicationSurfaceSlot: 'knowledge-base' });
  await activateRendererPlugin('knowledge');
}
beforeEach(() => { clearRendererPluginRegistryForTest(); state.events = []; state.save.mockReset(); });
describe('application surface navigation', () => {
  it('先完成保存和页面准备，再挂载；保存失败不清空旧页面', async () => {
    const prepare = vi.fn(async () => { state.events.push('prepare'); });
    await install(prepare);
    state.save.mockRejectedValueOnce(new Error('save failed'));
    await expect(createWorkspaceNavigation().openKnowledgeBase()).rejects.toThrow('save failed');
    expect(prepare).not.toHaveBeenCalled();
    await createWorkspaceNavigation().openKnowledgeBase();
    expect(state.events).toEqual(['prepare', 'knowledge-base']);
  });
  it.each(['disable', 'navigate'] as const)('准备期间 %s 会取消，迟到完成不能重开页面', async mode => {
    let complete: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    let entered: (() => void) | undefined;
    const preparing = new Promise<void>(resolve => { entered = resolve; });
    await install(async current => {
      signal = current; entered?.();
      await new Promise<void>(resolve => { complete = resolve; });
      current.throwIfAborted();
    });
    const navigation = createWorkspaceNavigation();
    const opening = navigation.openKnowledgeBase();
    await preparing;
    if (mode === 'disable') await deactivateRendererPlugin('knowledge');
    else await navigation.openProjectOverview('project-b');
    expect(signal?.aborted).toBe(true);
    complete?.(); await opening;
    expect(state.events).not.toContain('knowledge-base');
    if (mode === 'navigate') expect(state.events).toEqual(['project-overview']);
  });
});
