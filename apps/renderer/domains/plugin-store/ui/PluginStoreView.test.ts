// @vitest-environment jsdom

import type {
  PluginId,
  PluginInstallProgressEvent,
  PluginRemoteCatalogItem,
  PluginRemoteCatalogResult,
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
    readonly remoteCatalog: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
    readonly cancelRemoteInstall: ReturnType<typeof vi.fn<(pluginId: string) => Promise<unknown>>>;
    readonly onInstallProgress: (callback: (event: PluginInstallProgressEvent) => void) => () => void;
  };
  readonly openExternalUrl: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;
  /** 模拟 Host 推送的安装进度事件。 */
  readonly emitInstallProgress: (event: PluginInstallProgressEvent) => void;
}

const MB = 1024 * 1024;

function catalogItem(overrides: Partial<PluginRemoteCatalogItem> = {}): PluginRemoteCatalogItem {
  return {
    id: 'mindmap',
    name: 'Mindmap',
    version: '1.0.1',
    description: '思维导图图形化编辑、AI agent 与 Mindmap 文件能力',
    developer: 'Linnya',
    availability: { status: 'installable', downloadBytes: 3 * MB, unpackedBytes: 9 * MB, runtimes: [] },
    ...overrides,
  };
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
  readonly remoteServiceEnabled?: boolean;
  readonly runtimeStates?: readonly PluginStateView[];
  /** 默认：catalog 列出与本机同版本的 Mindmap，可安装。 */
  readonly remoteCatalog?: PluginRemoteCatalogResult;
}

function createTestApi(
  storeItems: readonly PluginStoreListItem[],
  options: PluginStoreTestApiOptions = {}
): PluginStoreTestApi {
  const runtimeStates = options.runtimeStates ?? storeItems.map(toStateView);
  const progressListeners = new Set<(event: PluginInstallProgressEvent) => void>();
  const remoteCatalog: PluginRemoteCatalogResult = options.remoteCatalog ?? { status: 'available', items: [catalogItem()] };
  return {
    emitInstallProgress: event => {
      for (const listener of progressListeners) listener(event);
    },
    plugins: {
      remoteCatalog: vi.fn<() => Promise<unknown>>(async () => ({ success: true, data: remoteCatalog })),
      cancelRemoteInstall: vi.fn<(pluginId: string) => Promise<unknown>>(async () => ({ success: true, data: { cancelled: true } })),
      onInstallProgress: callback => {
        progressListeners.add(callback);
        return () => progressListeners.delete(callback);
      },
      storeList: vi.fn<() => Promise<unknown>>(async () => ({
        success: true,
        data: { items: [...storeItems], remoteServiceEnabled: options.remoteServiceEnabled ?? true },
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

async function openMarketTab(host: HTMLElement): Promise<void> {
  const marketTab = readButtons(host).find(button => button.textContent?.includes('插件市场'));
  if (!marketTab) throw new Error('plugin market tab not found');
  marketTab.click();
  await flushVueWork();
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
  it('远程服务关闭时可查看和启停随包插件，不检查更新或提供卸载与安装', async () => {
    const api = createTestApi([mindmapDisabledItem, { ...slidesEnabledItem, state: 'missing' }], {
      remoteServiceEnabled: false,
    });
    const mounted = mountPluginStore(api);
    await flushVueWork();

    const toggle = readSwitchInputs(findPluginCard(mounted.host, 'mindmap'))[0];
    expect(toggle?.disabled).toBe(false);
    toggle?.click();
    await flushVueWork();
    expect(api.plugins.setEnabled).toHaveBeenCalledWith('mindmap', true);

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();
    expect(api.plugins.getDetail).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.checkRemoteUpdate).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('.plugin-store-uninstall-button')).toBeNull();
    expect(mounted.host.textContent).toContain('远程安装和更新暂未开放');

    findButtonByText(mounted.host, '插件').click();
    await flushVueWork();
    const marketplaceTab = readButtons(mounted.host).find(button => button.textContent?.includes('插件市场'));
    if (!marketplaceTab) throw new Error('marketplace tab not found');
    marketplaceTab.click();
    await flushVueWork();
    expect(findPluginCard(mounted.host, 'slides')).toBeDefined();
    expect(mounted.host.querySelector('.plugin-store-install-button')).toBeNull();
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
    expect(api.plugins.uninstall).not.toHaveBeenCalled();
  });

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
    expect(mindmapSwitch.checked).toBe(true);
  });

  it('点击卡片进入详情，不自动检查或下载更新', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem]);
    const mounted = mountPluginStore(api);

    await flushVueWork();

    findPluginCard(mounted.host, 'mindmap').click();
    await flushVueWork();

    expect(api.plugins.getDetail).toHaveBeenCalledWith('mindmap');
    expect(api.plugins.checkRemoteUpdate).not.toHaveBeenCalled();
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

  it('插件服务无法连接时提示原因，远程安装按钮不可点，已安装插件照常可用', async () => {
    const api = createTestApi([platformItem, mindmapMissingItem, slidesEnabledItem], {
      remoteCatalog: { status: 'unavailable', code: 'network' },
    });
    const mounted = mountPluginStore(api);
    await flushVueWork();

    expect(mounted.host.textContent).toContain('暂时无法连接插件服务，不能安装或更新插件。已安装的插件不受影响。');
    expect(readSwitchInputs(findPluginCard(mounted.host, 'slides'))).toHaveLength(1);
    await openMarketTab(mounted.host);
    // 显示不可点的安装按钮，而不是停用开关；原因由页面顶部提示说明。
    const installButton = findButtonByText(findPluginCard(mounted.host, 'mindmap'), '安装');
    expect(installButton.disabled).toBe(true);
    expect(readSwitchInputs(findPluginCard(mounted.host, 'mindmap'))).toHaveLength(0);
    installButton.click();
    await flushVueWork();
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
  });

  it('catalog 最高版本需要更新 Linnya 时卡片写明要求，不提供安装', async () => {
    const api = createTestApi([platformItem, mindmapMissingItem], {
      remoteCatalog: { status: 'available', items: [catalogItem({ version: '2.0.0', availability: { status: 'requires-app-update', minApp: '9.0.0' } })] },
    });
    const mounted = mountPluginStore(api);
    await flushVueWork();
    await openMarketTab(mounted.host);

    const card = findPluginCard(mounted.host, 'mindmap');
    expect(card.textContent).toContain('需要 Linnya 9.0.0 或更高版本');
    expect(readButtons(card).some(button => button.textContent?.trim() === '安装')).toBe(false);
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();
  });

  it('catalog 有更高版本时显示有新版本与下载大小，点更新才安装并提示重启生效', async () => {
    const api = createTestApi([platformItem, mindmapEnabledItem], {
      remoteCatalog: { status: 'available', items: [catalogItem({ version: '1.0.2', availability: { status: 'installable', downloadBytes: 2 * MB, unpackedBytes: 6 * MB, runtimes: [] } })] },
    });
    api.plugins.installFromRemote.mockResolvedValueOnce({
      success: true,
      data: { status: 'installed', pluginId: 'mindmap', version: '1.0.2', previousVersion: '1.0.1', restartRequired: true },
    });
    const mounted = mountPluginStore(api);
    await flushVueWork();

    const card = findPluginCard(mounted.host, 'mindmap');
    expect(card.textContent).toContain('有新版本');
    expect(card.textContent).toContain('当前 1.0.1，可更新到 1.0.2');
    expect(card.textContent).toContain('下载 2 MB');
    expect(api.plugins.installFromRemote).not.toHaveBeenCalled();

    findButtonByText(card, '更新').click();
    await flushVueWork();

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

  it('只在 catalog 中的插件进入插件市场；详情显示下载与安装后大小，以及所需运行时组件', async () => {
    const api = createTestApi([platformItem, slidesEnabledItem], {
      remoteCatalog: {
        status: 'available',
        items: [catalogItem({
          availability: {
            status: 'installable',
            downloadBytes: 26 * MB,
            unpackedBytes: 74 * MB,
            runtimes: [{ id: 'qdrant', version: '1.14.1', downloadBytes: 23.5 * MB, unpackedBytes: 61.5 * MB, installed: false }],
          },
        })],
      },
    });
    const mounted = mountPluginStore(api);
    await flushVueWork();
    await openMarketTab(mounted.host);

    const card = findPluginCard(mounted.host, 'mindmap');
    expect(card.textContent).toContain('未安装');
    expect(card.textContent).toContain('下载 26 MB');

    card.click();
    await flushVueWork();
    // 本机没有该插件的 Host 详情，不发起详情请求。
    expect(api.plugins.getDetail).not.toHaveBeenCalled();
    expect(mounted.host.textContent).toContain('下载 26 MB，安装后约 74 MB');
    expect(mounted.host.textContent).toContain('包含所需的向量检索组件（Qdrant 1.14.1，23.5 MB）');
    expect(readButtons(mounted.host.querySelector('.plugin-store-detail-actions') as HTMLElement).map(button => button.textContent?.trim())).toEqual(['安装']);
  });

  it('安装中卡片显示进度条与已下载字节；详情页可取消，取消后显示已取消且不弹失败提示', async () => {
    const api = createTestApi([platformItem, mindmapMissingItem]);
    let finishInstall: (value: unknown) => void = () => {};
    api.plugins.installFromRemote.mockImplementationOnce(() => new Promise(resolve => { finishInstall = resolve; }));
    const mounted = mountPluginStore(api);
    await flushVueWork();
    await openMarketTab(mounted.host);

    findButtonByText(findPluginCard(mounted.host, 'mindmap'), '安装').click();
    await flushVueWork();
    const runtime = { kind: 'runtime', id: 'qdrant', version: '1.14.1', totalBytes: 8 * MB } as const;
    const plugin = { kind: 'plugin', id: 'mindmap', version: '1.0.1', totalBytes: 2 * MB } as const;
    api.emitInstallProgress({ pluginId: 'mindmap', progress: { stage: 'planned', downloads: [runtime, plugin] } });
    api.emitInstallProgress({ pluginId: 'mindmap', progress: { stage: 'downloading', item: runtime, receivedBytes: 4 * MB } });
    await flushVueWork();

    const card = findPluginCard(mounted.host, 'mindmap');
    expect(card.textContent).toContain('安装中');
    expect(card.textContent).toContain('正在下载 4 MB / 10 MB');
    expect(card.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    // 列表上不放取消，也不能重复安装。
    expect(readButtons(card).map(button => button.textContent?.trim())).toEqual([]);

    card.click();
    await flushVueWork();
    expect(mounted.host.textContent).toContain('正在下载向量检索组件 · 4 MB / 8 MB');
    expect(mounted.host.textContent).toContain('40%');
    expect(mounted.host.textContent).toContain('共 10 MB。可以离开此页，安装会在后台继续。');

    findButtonByText(mounted.host.querySelector('.plugin-store-detail-actions') as HTMLElement, '取消').click();
    await flushVueWork();
    expect(api.plugins.cancelRemoteInstall).toHaveBeenCalledWith('mindmap');

    finishInstall({ success: false, error: { code: 'cancelled', pluginId: 'mindmap' } });
    await flushVueWork();
    expect(mounted.host.textContent).toContain('已取消安装，未完成的下载内容已丢弃。');
    expect(mounted.host.querySelector('[role="progressbar"]')).toBeNull();
    expect(readNotificationMessage(mounted.pinia)).toBe('');
    expect(findButtonByText(mounted.host.querySelector('.plugin-store-detail-actions') as HTMLElement, '安装')).toBeTruthy();
  });

  it('磁盘空间不足：卡片显示红色失败标签与简短原因，详情写明需要与剩余空间，重试成功后清除失败状态', async () => {
    const api = createTestApi([platformItem, mindmapMissingItem]);
    api.plugins.installFromRemote.mockResolvedValueOnce({
      success: false,
      error: { code: 'disk-space', pluginId: 'mindmap', diskSpace: { requiredBytes: 100 * MB, availableBytes: 35 * MB } },
    });
    const mounted = mountPluginStore(api);
    await flushVueWork();
    await openMarketTab(mounted.host);

    findButtonByText(findPluginCard(mounted.host, 'mindmap'), '安装').click();
    await flushVueWork();

    const card = findPluginCard(mounted.host, 'mindmap');
    const chip = card.querySelector('.plugin-store-state-chip');
    expect(chip?.textContent).toContain('安装失败');
    expect(chip?.classList.contains('is-error')).toBe(true);
    expect(card.textContent).toContain('磁盘空间不足，请在详情页重试');

    card.click();
    await flushVueWork();
    expect(mounted.host.querySelector('.plugin-store-install-error')?.textContent)
      .toContain('磁盘空间不足：安装需要约 100 MB 可用空间，当前剩余 35 MB。释放空间后重试。');

    findButtonByText(mounted.host.querySelector('.plugin-store-detail-actions') as HTMLElement, '重试').click();
    await flushVueWork();
    expect(api.plugins.installFromRemote).toHaveBeenCalledTimes(2);
    expect(mounted.host.querySelector('.plugin-store-install-error')).toBeNull();
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 已安装，重启后完全生效');
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
    expect(readNotificationMessage(mounted.pinia)).toBe('Mindmap 已卸载，数据已保留');
  });
});
