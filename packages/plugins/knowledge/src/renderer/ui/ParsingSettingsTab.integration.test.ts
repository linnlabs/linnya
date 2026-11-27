// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ParsingSettingsTab from './ParsingSettingsTab.vue';

// 知识库开关与全局模型选择是两份独立事实；这里分别控制，验证界面在两者不一致时提示用户
const kb = reactive({ id: 'kb', name: 'Research', enableGraphIndexing: false });
const models = vi.hoisted(() => ({
  graphExtraction: null as string | null,
  listeners: new Set<() => void>(),
  openModelConfiguration: vi.fn(),
}));
const notifications = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('../runtime.js', () => ({ useKnowledgeBase: () => ({
  parsingSettings: { forceVisionMode: false },
  getKnowledgeBaseById: (id: string) => (id === kb.id ? kb : null),
  updateKbModelSettings: async (_id: string, settings: { enableGraphIndexing: boolean }) => {
    kb.enableGraphIndexing = settings.enableGraphIndexing;
  },
  updateParsingSettings: vi.fn(),
}) }));
vi.mock('@plugin/renderer/modelConfiguration', () => ({
  readAuxiliaryModelId: () => models.graphExtraction,
  subscribeModelConfigurationChanges: (listener: () => void) => {
    models.listeners.add(listener);
    return () => models.listeners.delete(listener);
  },
  openModelConfiguration: models.openModelConfiguration,
}));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({ showWorkspaceNotification: notifications.show }));

let app: App | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  app = createApp({ render: () => h(ParsingSettingsTab, { selectedKbId: 'kb' }) });
  app.use(createPinia());
  app.mount(container);
});
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  kb.enableGraphIndexing = false;
  models.graphExtraction = null;
  models.listeners.clear();
  vi.clearAllMocks();
});

function selectGraphExtractionModel(modelId: string): void {
  models.graphExtraction = modelId;
  for (const listener of models.listeners) listener();
}

async function toggleGraph(): Promise<void> {
  const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="知识图谱构建"]');
  if (!toggle) throw new Error('Graph switch missing');
  toggle.click();
  await nextTick();
  await nextTick();
}

const warning = () => container.querySelector('.parsing-option-warning');

it('没选图谱抽取模型时打开图谱：警告通知、开关下方提示与去选择入口；选好模型后提示消失', async () => {
  expect(warning()).toBeNull();

  await toggleGraph();

  expect(kb.enableGraphIndexing).toBe(true);
  expect(notifications.show).toHaveBeenCalledWith(expect.stringContaining('还没有选择图谱抽取模型'), 'warning', 4500);
  expect(warning()?.textContent).toContain('还没有选择图谱抽取模型');
  const choose = warning()?.querySelector('button');
  if (!choose) throw new Error('Choose model action missing');
  choose.click();
  expect(models.openModelConfiguration).toHaveBeenCalledTimes(1);

  selectGraphExtractionModel('graph-model');
  await nextTick();
  expect(warning()).toBeNull();
});

it('已选图谱抽取模型时打开图谱只提示已启用；关闭图谱后不再提示缺模型', async () => {
  selectGraphExtractionModel('graph-model');
  await toggleGraph();
  expect(notifications.show).toHaveBeenCalledWith('已启用知识图谱构建', 'success', 2500);
  expect(warning()).toBeNull();

  models.graphExtraction = null;
  for (const listener of models.listeners) listener();
  await nextTick();
  expect(warning()).not.toBeNull();

  await toggleGraph();
  expect(kb.enableGraphIndexing).toBe(false);
  expect(warning()).toBeNull();
});
