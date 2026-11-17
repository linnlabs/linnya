// @vitest-environment jsdom
import { effectScope, nextTick, reactive } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { KnowledgeProjectSummary } from '../../shared';
import { createKnowledgeBaseMessageResolver } from '../functions/resolveKnowledgeBaseMessage';
import { useKnowledgeBaseSettings } from './useKnowledgeBaseSettings';

const ports = vi.hoisted(() => ({
  list: vi.fn<() => Promise<KnowledgeProjectSummary[]>>(),
  links: vi.fn<(id: string, signal: AbortSignal) => Promise<string[]>>(),
  replace: vi.fn(), update: vi.fn(), notify: vi.fn(),
}));
vi.mock('../services/knowledgeBaseService', () => ({ knowledgeBaseService: { listProjects: ports.list } }));
vi.mock('../services/knowledgeProjectLinks', () => ({ readKnowledgeBaseProjectIds: ports.links, replaceKnowledgeBaseProjects: ports.replace }));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({ showWorkspaceNotification: ports.notify }));
vi.mock('../runtime.js', () => ({ useKnowledgeBase: () => ({
  getKnowledgeBaseById: (id: string) => ({ id, name: id, tags: [] }),
  updateKbModelSettings: ports.update,
}) }));
const message = createKnowledgeBaseMessageResolver((_key, fallback) => fallback);
const scopes: ReturnType<typeof effectScope>[] = [];
function openSettings() {
  const scope = effectScope(); scopes.push(scope);
  const props = reactive({ selectedKbId: 'first' });
  const settings = scope.run(() => useKnowledgeBaseSettings(props, message));
  if (!settings) throw new Error('Settings scope did not start');
  return { props, settings };
}
beforeEach(() => {
  vi.resetAllMocks();
  ports.list.mockResolvedValue([{ id: 'project-first', name: 'First' }, { id: 'project-second', name: 'Second' }]);
  ports.links.mockResolvedValue(['project-first']);
  ports.update.mockResolvedValue(undefined);
  ports.replace.mockResolvedValue(undefined);
});
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); });

it('关联读取失败不能保存空关系，迟到的旧库读取不能覆盖新库关系', async () => {
  ports.links.mockRejectedValueOnce(new Error('metadata unavailable'));
  const { props, settings } = openSettings();
  await vi.waitFor(() => expect(settings.projectLinksError.value).not.toBeNull());
  await settings.handleSaveBasicInfo();
  expect(ports.update).not.toHaveBeenCalled();
  expect(ports.replace).not.toHaveBeenCalled();

  let finishOld: (value: string[]) => void = () => {};
  let oldSignal: AbortSignal | undefined;
  ports.links.mockImplementationOnce((_id, signal) => {
    oldSignal = signal;
    return new Promise(resolve => { finishOld = resolve; });
  });
  props.selectedKbId = 'slow'; await nextTick();
  ports.links.mockResolvedValueOnce(['project-second']);
  props.selectedKbId = 'second'; await nextTick();
  await vi.waitFor(() => expect(settings.projectLinksReady.value).toBe(true));
  expect(oldSignal?.aborted).toBe(true);
  finishOld(['project-first']); await nextTick();
  expect(settings.linkedProjects.value.map(project => project.id)).toEqual(['project-second']);
  await settings.handleSaveBasicInfo();
  expect(ports.replace).toHaveBeenCalledWith('second', ['project-second'], expect.any(AbortSignal));
});

it('保存基础信息期间切库，不把原库后续关联写入新库，也不冒报新库已保存', async () => {
  const { props, settings } = openSettings();
  await vi.waitFor(() => expect(settings.projectLinksReady.value).toBe(true));
  let finishSave: () => void = () => {};
  ports.update.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
  settings.localName.value = 'First renamed';
  const saving = settings.handleSaveBasicInfo();
  expect(ports.update).toHaveBeenCalledWith('first', expect.objectContaining({ name: 'First renamed' }));
  props.selectedKbId = 'second'; await nextTick();
  finishSave(); await saving;
  expect(ports.replace).not.toHaveBeenCalled();
  expect(ports.notify).not.toHaveBeenCalled();
  expect(settings.localName.value).toBe('second');
});
