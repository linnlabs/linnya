// @vitest-environment jsdom

import type {
  PluginId,
  PluginStoreDetail,
  PluginStoreListItem,
  PluginStateView,
} from '@app/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '@/app/plugins/registry';

const loadRuntimeRendererPluginsMock = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => {}));

vi.mock('@/app/plugins/loader/runtimeRendererPluginLoader', () => ({
  loadRuntimeRendererPlugins: loadRuntimeRendererPluginsMock,
}));
vi.mock('@/app/plugins/loader/runtimeRendererPluginLoader.ts', () => ({
  loadRuntimeRendererPlugins: loadRuntimeRendererPluginsMock,
}));

import { useNotificationStore } from '@/app/notification';
import {
  cancelConfirmDialog,
  confirmDialogState,
  resolveConfirmDialog,
} from '@/shared/composables/confirmDialog';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import PluginStoreView from './PluginStoreView.vue';

const TestSurface = { name: 'PluginStoreTestSurface', template: '<div />' };
const TestSlidesIcon = { name: 'PluginStoreTestSlidesIcon', template: '<svg class="test-slides-icon" />' };

interface MountedPluginStore {
  readonly host: HTMLElement;
  readonly app: App<Element>;
  readonly pinia: Pinia;
}

interface PluginStoreTestApi {
  readonly plugins: {
    readonly storeList: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
    readonly getDetail: ReturnType<typeof vi.fn<(pluginId: string) => Promise<unknown>>>;
    readonly setEnabled: ReturnType<
      typeof vi.fn<(pluginId: string, enabled: boolean) => Promise<unknown>>
    >;
    readonly list: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
    readonly uninstall: ReturnType<typeof vi.fn<(pluginId: string) => Promise<unknown>>>;
    readonly checkRemoteUpdate: ReturnType<typeof vi.fn<(pluginId: string) => Promise<unknown>>>;
    readonly installFromRemote: ReturnType<typeof vi.fn<(pluginId: string) => Promise<unknown>>>;
    readonly rendererEntries: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  };
  readonly openExternalUrl: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;
}

const platformItem: PluginStoreListItem = {
  meta: {
    id: 'platform',
    name: 'Linnya Platform',
    version: '1.0.0',
    description: '平台内置能力',
    developer: 'Linnya',
    builtin: true,
    required: true,
  },
  state: 'enabled',
};

const mindmapEnabledItem: PluginStoreListItem = {
  meta: {
    id: 'mindmap',
    name: 'Mindmap',
    version: '1.0.1',
    description: '思维导图图形化编辑、AI agent 与 Mindmap 文件能力',
    developer: 'Linnya',
    builtin: true,
    required: false,
    dependsOn: ['platform'],
    compatMin: '0.0.36',
  },
  state: 'enabled',
};

const mindmapDisabledItem: PluginStoreListItem = {
  ...mindmapEnabledItem,
  state: 'disabled',
};

const mindmapMissingItem: PluginStoreListItem = {
  ...mindmapEnabledItem,
  state: 'missing',
  reason: '插件未安装',
};

const slidesEnabledItem: PluginStoreListItem = {
  meta: {
    id: 'slides',
    name: 'Slides',
    version: '1.0.0',
    description: 'AI 演示文稿插件',
    developer: 'Linnya',
    builtin: true,
    required: false,
    dependsOn: ['platform'],
    compatMin: '0.0.36',
  },
  state: 'enabled',
};

const slidesDetail: PluginStoreDetail = {
  ...slidesEnabledItem,
  sizeBytes: 524288,
  details: ['用于规划、生成和修复演示文稿。'],
  skills: [
    {
      name: 'slides-design',
      description: 'PPT 设计与 deck.js 生成技能。',
    },
  ],
  agents: [
    {
      name: 'Slides Agent',
      description: '规划、生成和修复演示文稿。',
    },
  ],
  releaseNotes: [
    {
      version: '1.0.0',
      title: 'Runtime 插件化',
      description: 'Slides runtime 插件化完成。',
    },
  ],
};

const mindmapDetail: PluginStoreDetail = {
  ...mindmapEnabledItem,
  sizeBytes: 394240,
  details: ['用于组织复杂推理。'],
  releaseNotes: [
    {
      version: '1.0.4',
      title: '用户详情契约收口',
      description: '详细介绍成为插件必填字段，Mindmap 只声明 Agents。',
    },
    {
      version: '1.0.3',
      title: '详情结构化',
      description: '插件商店详情改为原生结构化展示。',
    },
  ],
  agents: [
    {
      name: 'Workflow Leader',
      description: '统筹拆解、提出假设和验证路径。',
    },
    {
      name: 'Reasoning Canvas',
      description: '围绕当前导图节点进行假设验证、证据挂载、状态和置信度更新。',
    },
  ],
};

const mountedViews: MountedPluginStore[] = [];

function toStateView(item: PluginStoreListItem): PluginStateView {
  return {
    meta: item.meta,
    state: item.state,
    ...(item.reason ? { reason: item.reason } : {}),
  };
}

interface PluginStoreTestApiOptions {
  readonly runtimeStates?: readonly PluginStateView[];
}

function createTestApi(
  storeItems: readonly PluginStoreListItem[],
  options: PluginStoreTestApiOptions = {}
): PluginStoreTestApi {
  const runtimeStates = options.runtimeStates ?? storeItems.map(toStateView);
  return {
    plugins: {
      storeList: vi.fn<() => Promise<unknown>>(async () => ({
        success: true,
        data: [...storeItems],
      })),
      getDetail: vi.fn<(pluginId: string) => Promise<unknown>>(async pluginId => {
        if (pluginId === 'mindmap') {
          return { success: true, data: mindmapDetail };
        }
        if (pluginId === 'slides') {
          return { success: true, data: slidesDetail };
        }
        return { success: true, data: platformItem };
      }),
      setEnabled: vi.fn<(pluginId: string, enabled: boolean) => Promise<unknown>>(async () => ({
        success: true,
      })),
      list: vi.fn<() => Promise<unknown>>(async () => ({
        success: true,
        data: [...runtimeStates],
      })),
      uninstall: vi.fn<(pluginId: string) => Promise<unknown>>(async () => ({ success: true })),
      checkRemoteUpdate: vi.fn<(pluginId: string) => Promise<unknown>>(async pluginId => {
        const item = storeItems.find(candidate => candidate.meta.id === pluginId);
        return {
          success: true,
          data: {
            status: 'current',
            pluginId,
            currentVersion: item?.meta.version ?? '1.0.1',
            latestVersion: item?.meta.version ?? '1.0.1',
          },
        };
      }),
      installFromRemote: vi.fn<(pluginId: string) => Promise<unknown>>(async pluginId => {
        const item = storeItems.find(candidate => candidate.meta.id === pluginId);
        if (item?.state === 'missing') {
          return {
            success: true,
            data: {
              status: 'installed',
              pluginId,
              version: '1.0.1',
              previousVersion: null,
              restartRequired: true,
            },
          };
        }

        return {
          success: true,
          data: {
            status: 'skipped',
            pluginId,
            version: '1.0.1',
            reason: 'current',
          },
        };
      }),
      rendererEntries: vi.fn<() => Promise<unknown>>(async () => ({ success: true, data: [] })),
    },
    openExternalUrl: vi.fn<(url: string) => Promise<unknown>>(async () => ({ success: true })),
  };
}

function installElectronApi(api: PluginStoreTestApi): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
}

function mountPluginStore(api: PluginStoreTestApi): MountedPluginStore {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const pinia = createPinia();
  setActivePinia(pinia);
  installElectronApi(api);

  const app = createApp(PluginStoreView);
  app.use(pinia);
  app.mount(host);

  const mounted = { host, app, pinia };
  mountedViews.push(mounted);
  return mounted;
}

async function flushVueWork(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await nextTick();
    await new Promise(resolve => {
      window.setTimeout(resolve, 0);
    });
  }
}

function readButtons(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('button')).filter(
    (element): element is HTMLButtonElement => element instanceof HTMLButtonElement
  );
}

function readSwitchInputs(host: HTMLElement): HTMLInputElement[] {
  return Array.from(host.querySelectorAll('input.switch-control-input')).filter(
    (element): element is HTMLInputElement => element instanceof HTMLInputElement
  );
}

function findButtonByText(host: HTMLElement, label: string): HTMLButtonElement {
  const button = readButtons(host).find(candidate => candidate.textContent?.trim() === label);
  if (!button) {
    throw new Error(`button not found: ${label}`);
  }
  return button;
}

function findPluginCard(host: HTMLElement, pluginId: PluginId): HTMLElement {
  const cards = Array.from(host.querySelectorAll('.plugin-store-card'));
  const card = cards.find(candidate =>
    candidate.textContent?.includes(
      pluginId === 'platform' ? 'Linnya Platform' : pluginId === 'slides' ? 'Slides' : 'Mindmap'
    )
  );
  if (!(card instanceof HTMLElement)) {
    throw new Error(`plugin card not found: ${pluginId}`);
  }
  return card;
}

function readNotificationMessage(pinia: Pinia): string {
  setActivePinia(pinia);
  return useNotificationStore().message;
}

beforeEach(() => {
  clearRendererPluginRegistryForTest();
});

afterEach(() => {
  if (confirmDialogState.visible) {
    cancelConfirmDialog();
  }
  while (mountedViews.length > 0) {
    const mounted = mountedViews.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
  loadRuntimeRendererPluginsMock.mockReset();
  clearRendererPluginRegistryForTest();
});

describe('PluginStoreView', () => {
  it('只渲染可管理插件，不展示内部 platform 基座', async () => {
    const api = createTestApi([mindmapDisabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    expect(api.plugins.storeList).toHaveBeenCalledTimes(1);
    expect(mounted.host.textContent).not.toContain('Linnya Platform');
    expect(mounted.host.textContent).not.toContain('核心能力不可禁用');
    expect(mounted.host.textContent).not.toContain('刷新');
    expect(mounted.host.textContent).not.toContain('检查更新');
    expect(mounted.host.textContent).not.toContain('详情');
    expect(mounted.host.textContent).not.toContain('卸载');
    expect(mounted.host.textContent).toContain('Mindmap');
    expect(mounted.host.textContent).toContain('版本 1.0.1');
    expect(mounted.host.textContent).toContain('开发者 Linnya');
    expect(mounted.host.textContent).toContain('已停用');
    expect(mounted.host.textContent).toContain('思维导图图形化编辑');

    const switches = readSwitchInputs(mounted.host);
    expect(switches).toHaveLength(1);
    expect(switches[0]?.disabled).toBe(false);
  });

  it('商店列表只补展示素材，启停状态以运行态列表为准', async () => {
    const api = createTestApi([mindmapDisabledItem], {
      runtimeStates: [toStateView(mindmapEnabledItem)],
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pinia = createPinia();
    setActivePinia(pinia);
    installElectronApi(api);
    const pluginsStore = useEnabledPluginsStore();

    await pluginsStore.refresh();

    const app = createApp(PluginStoreView);
    app.use(pinia);
    app.mount(host);
    mountedViews.push({ host, app, pinia });
    await flushVueWork();

    const mindmapCard = findPluginCard(host, 'mindmap');
    expect(api.plugins.list).toHaveBeenCalledTimes(1);
    expect(api.plugins.storeList).toHaveBeenCalledTimes(1);
    expect(mindmapCard.textContent).toContain('已启用');
    const mindmapSwitch = readSwitchInputs(mindmapCard)[0];
    expect(mindmapSwitch?.checked).toBe(true);
  });

  it('Slides 插件商店卡片使用文档类型注册表图标，不渲染静态资源 mask', async () => {
    registerRendererPlugin({
      meta: slidesEnabledItem.meta,
      documentTypes: [{
        pluginId: 'slides',
        nodeType: 'presentation',
        activeDocumentType: 'slides',
        createRequestType: 'presentation',
        createBackend: 'plugin-document',
        createHandlerId: 'slides.document-create',
        surfaceComponent: TestSurface,
        label: '演示文稿',
        createLabel: '新建演示文稿',
        defaultName: '未命名演示文稿',
        iconComponent: TestSlidesIcon,
        iconClass: 'presentation-icon',
        createPriority: 40,
        entityReferences: [{
          kind: 'deck',
          uriPattern: 'linnya://slides/{documentId}',
          description: 'Slides 演示文稿本体。',
        }],
      }],
    });
    const api = createTestApi([slidesEnabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    const slidesCard = findPluginCard(mounted.host, 'slides');
    expect(slidesCard.querySelector('.plugin-store-plugin-symbol-component')).not.toBeNull();
    expect(slidesCard.querySelector('.test-slides-icon')).not.toBeNull();
    expect(slidesCard.innerHTML).not.toContain('plugin://');
  });

  it('启停 mindmap 后刷新 renderer 插件并提示成功', async () => {
    const api = createTestApi([platformItem, mindmapDisabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    const mindmapSwitch = readSwitchInputs(findPluginCard(mounted.host, 'mindmap'))[0];
    if (!mindmapSwitch) {
      throw new Error('mindmap switch not found');
    }
    mindmapSwitch.click();
    await flushVueWork();

    expect(api.plugins.setEnabled).toHaveBeenCalledWith('mindmap', true);
    expect(loadRuntimeRendererPluginsMock).toHaveBeenCalledTimes(1);
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 已启用');
  });

  it('启停失败时展示本地化错误并回刷列表', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    api.plugins.setEnabled.mockResolvedValueOnce({
      success: false,
      error: '插件依赖未满足，不能禁用 mindmap',
    });
    const mounted = mountPluginStore(api);

    await flushVueWork();

    const mindmapSwitch = readSwitchInputs(findPluginCard(mounted.host, 'mindmap'))[0];
    if (!mindmapSwitch) {
      throw new Error('mindmap switch not found');
    }
    mindmapSwitch.click();
    await flushVueWork();

    expect(loadRuntimeRendererPluginsMock).not.toHaveBeenCalled();
    expect(api.plugins.storeList).toHaveBeenCalledTimes(2);
    expect(readNotificationMessage(mounted.pinia)).toBe('插件启停失败，请稍后重试。');
  });

  it('点击卡片进入详情并静默检查当前版本', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    expect(api.plugins.getDetail).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.checkRemoteUpdate).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
    expect(loadRuntimeRendererPluginsMock).not.toHaveBeenCalled();
    expect(mounted.host.textContent).toContain('插件');
    expect(mounted.host.querySelector('.plugin-store-detail')).not.toBeNull();
    expect(mounted.host.textContent).toContain('版本');
    expect(mounted.host.textContent).toContain('1.0.1');
    expect(mounted.host.textContent).toContain('开发者');
    expect(mounted.host.textContent).toContain('Linnya');
    expect(mounted.host.textContent).toContain('大小');
    expect(mounted.host.textContent).toContain('385 KB');
    expect(mounted.host.textContent).toContain('介绍');
    expect(mounted.host.textContent).toContain('版本更新');
    expect(mounted.host.textContent).toContain('1.0.4');
    expect(mounted.host.textContent).toContain('用户详情契约收口');
    expect(mounted.host.textContent).toContain('展开全部');
    expect(mounted.host.textContent).not.toContain('1.0.3');
    const expandReleaseNotesButton = Array.from(mounted.host.querySelectorAll('button')).find(
      button => button.textContent?.includes('展开全部') === true
    );
    if (!expandReleaseNotesButton) {
      throw new Error('release notes expand button not found');
    }
    expandReleaseNotesButton.click();
    await flushVueWork();
    expect(mounted.host.textContent).toContain('1.0.3');
    expect(mounted.host.textContent).toContain('详情结构化');
    expect(mounted.host.textContent).toContain('收起');
    expect(mounted.host.textContent).not.toContain('Skill');
    expect(mounted.host.textContent).toContain('Agents');
    expect(mounted.host.textContent).toContain('Reasoning Canvas');
    expect(mounted.host.textContent).toContain('Workflow Leader');
    expect(mounted.host.textContent).toContain('用于组织复杂推理。');
    expect(mounted.host.querySelector('.plugin-store-detail-copy')).not.toBeNull();
  });

  it('详情页渲染插件声明的 Skills 能力展示', async () => {
    const api = createTestApi([platformItem, slidesEnabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'slides').click();
    await flushVueWork();

    expect(api.plugins.getDetail).toHaveBeenCalledWith('slides');
    expect(mounted.host.textContent).toContain('介绍');
    expect(mounted.host.textContent).toContain('用于规划、生成和修复演示文稿。');
    expect(mounted.host.textContent).toContain('技能');
    expect(mounted.host.textContent).toContain('slides-design');
    expect(mounted.host.textContent).toContain('PPT 设计与 deck.js 生成技能。');
    expect(mounted.host.textContent).toContain('智能体');
    expect(mounted.host.textContent).toContain('Slides Agent');
  });

  it('点击已停用插件会检查更新，但当前版本不触发远程安装入口', async () => {
    const api = createTestApi([platformItem, mindmapDisabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    expect(api.plugins.getDetail).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.checkRemoteUpdate).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
    expect(loadRuntimeRendererPluginsMock).not.toHaveBeenCalled();
  });

  it('点击详情时自动检查更新失败保持静默，不阻断详情页', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    api.plugins.checkRemoteUpdate.mockResolvedValueOnce({
      success: false,
      error: '请求 latest.json 失败: 404 Not Found',
    });
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    expect(api.plugins.getDetail).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.checkRemoteUpdate).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('.plugin-store-detail')).not.toBeNull();
    expect(readNotificationMessage(mounted.pinia)).toBe('');
  });

  it('检查更新发现不兼容时不展示后端 detail 文案', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    api.plugins.checkRemoteUpdate.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'incompatible',
        pluginId: 'mindmap',
        currentVersion: '1.0.1',
        latestVersion: '1.0.2',
        detail: '当前应用版本 0.0.38 低于插件最低要求 0.0.39',
      },
    });
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    expect(api.plugins.checkRemoteUpdate).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 与当前应用版本不兼容');
  });

  it('点击卡片检查到新版本时自动安装更新并提示重启生效', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    api.plugins.checkRemoteUpdate.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'available',
        pluginId: 'mindmap',
        currentVersion: '1.0.1',
        latestVersion: '1.0.2',
      },
    });
    api.plugins.installFromRemote.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'installed',
        pluginId: 'mindmap',
        version: '1.0.2',
        previousVersion: '1.0.1',
        restartRequired: true,
      },
    });
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    expect(api.plugins.checkRemoteUpdate).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.installFromRemote).toHaveBeenCalledWith('mindmap');
    expect(loadRuntimeRendererPluginsMock).toHaveBeenCalledTimes(1);
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 已更新，重启后完全生效');
  });

  it('未安装 mindmap 走远程安装入口，成功后提示重启生效', async () => {
    const api = createTestApi([platformItem, mindmapMissingItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    expect(mounted.host.textContent).toContain('暂无已安装的插件');
    expect(mounted.host.textContent).toContain('去插件市场安装吧');
    expect(mounted.host.querySelector('.plugin-store-empty-state')).not.toBeNull();
    expect(mounted.host.querySelector('.plugin-store-empty-state.plugin-store-placeholder')).toBeNull();
    const marketTab = readButtons(mounted.host).find(button =>
      button.textContent?.includes('插件市场')
    );
    if (!marketTab) {
      throw new Error('plugin market tab not found');
    }
    marketTab.click();
    await flushVueWork();

    expect(readSwitchInputs(findPluginCard(mounted.host, 'mindmap'))).toHaveLength(0);

    findButtonByText(findPluginCard(mounted.host, 'mindmap'), '安装').click();
    await flushVueWork();

    expect(api.plugins.installFromRemote).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.getDetail).not.toHaveBeenCalled();
    expect(loadRuntimeRendererPluginsMock).toHaveBeenCalledTimes(1);
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 已安装，重启后完全生效');
  });

  it('远程安装返回不兼容时不展示后端 detail 文案', async () => {
    const api = createTestApi([platformItem, mindmapMissingItem]);
    api.plugins.installFromRemote.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'skipped',
        pluginId: 'mindmap',
        version: '1.0.2',
        reason: 'incompatible',
        detail: '当前应用版本 0.0.38 低于插件最低要求 0.0.39',
      },
    });
    const mounted = mountPluginStore(api);

    await flushVueWork();

    const marketTab = readButtons(mounted.host).find(button =>
      button.textContent?.includes('插件市场')
    );
    if (!marketTab) {
      throw new Error('plugin market tab not found');
    }
    marketTab.click();
    await flushVueWork();

    findButtonByText(findPluginCard(mounted.host, 'mindmap'), '安装').click();
    await flushVueWork();

    expect(api.plugins.installFromRemote).toHaveBeenCalledWith('mindmap');
    expect(loadRuntimeRendererPluginsMock).not.toHaveBeenCalled();
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 与当前应用版本不兼容');
  });

  it('卸载 mindmap 前确认不会删除文档数据，确认后调用卸载 IPC', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    findButtonByText(mounted.host, '卸载').click();
    await flushVueWork();

    expect(confirmDialogState.message).toBe('卸载 Mindmap？插件会从本机移除，但不会删除已有文档数据。');
    expect(confirmDialogState.isDangerousAction).toBe(true);

    resolveConfirmDialog();
    await flushVueWork();

    expect(api.plugins.uninstall).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.getDetail).toHaveBeenCalledWith('mindmap');
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 已卸载，重启后完全移除');
  });
});
