// @vitest-environment jsdom
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateProjectModal from '@/domains/workspace/ui/sidebar/components/CreateProjectModal.vue';
import { knowledgeRendererPlugin } from '@plugin/knowledge/renderer';
const KnowledgeProjectCreation = knowledgeRendererPlugin.applicationSurface?.projectCreationComponent;
if (!KnowledgeProjectCreation) throw new Error('Knowledge project creation contribution is missing');
import type { ProjectFormValues } from '@/domains/workspace/ui/sidebar/definitions/projectOperations';
const surface = shallowRef<{ pluginId: string; contribution: { projectCreationComponent: typeof KnowledgeProjectCreation } } | null>(null);
const runtime = vi.hoisted(() => ({ ensureDataLoaded: vi.fn<() => Promise<void>>(),
  knowledgeBases: [{ id: 'kb-a', name: 'Library A' }], error: null }));
vi.mock('../../../../../packages/plugins/knowledge/src/renderer/runtime.js', () => ({ useKnowledgeBase: () => runtime }));
vi.mock('@/app/plugins/composables', () => ({ useApplicationSurface: () => surface }));
vi.mock('@/domains/workspace/ui/useWorkspaceLocalization', () => ({
  useWorkspaceLocalization: () => ({ workspaceMessage: (key: string) => key }),
}));
let app: App | undefined;
beforeEach(() => {
  runtime.ensureDataLoaded.mockReset();
  surface.value = { pluginId: 'knowledge', contribution: { projectCreationComponent: KnowledgeProjectCreation } };
});
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; });
async function mount(edit = false) {
  const saved: ProjectFormValues[] = [];
  const container = document.createElement('div'); document.body.append(container);
  app = createApp({ render: () => h(CreateProjectModal, { show: true, isEditMode: edit,
    initialData: edit ? { id: 'project', name: 'Existing' } : null,
    onConfirm: (value: ProjectFormValues) => saved.push(value),
  }) });
  app.use(createPinia()); app.mount(container);
  await nextTick(); await nextTick();
  if (!edit) await vi.waitFor(() => expect(runtime.ensureDataLoaded).toHaveBeenCalledOnce());
  await nextTick();
  return saved;
}
function click(selector: string) {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  node.click();
}
function confirm() {
  const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent?.trim() === 'workspace.project.modal.create');
  if (!button) throw new Error('Missing create action');
  button.click();
}
describe('project creation contribution', () => {
  it('慢知识库不阻塞名称聚焦；编辑项目不加载目录或提交关联', async () => {
    runtime.ensureDataLoaded.mockImplementation(() => new Promise(() => undefined));
    await mount();
    expect(document.activeElement).toBe(document.querySelector('.create-project-content input'));
    expect(runtime.ensureDataLoaded).toHaveBeenCalledOnce();
    app?.unmount(); app = undefined; document.body.innerHTML = ''; runtime.ensureDataLoaded.mockClear();
    await mount(true);
    expect(runtime.ensureDataLoaded).not.toHaveBeenCalled();
    expect(document.querySelector('.kb-tag-form-group')).toBeNull();
  });
  it('下拉已选未点加号仍提交；停用丢弃未提交关联草稿', async () => {
    const saved = await mount();
    await nextTick();
    click('.kb-tag-form-group .select-trigger'); await nextTick(); await nextTick();
    click('.select-option'); await nextTick();
    confirm();
    expect(saved[0]?.kbIds).toEqual(['kb-a']);
    surface.value = null; await nextTick();
    expect(document.querySelector('.kb-tag-form-group')).toBeNull();
    confirm();
    expect(saved[1]?.kbIds).toEqual([]);
  });
});
