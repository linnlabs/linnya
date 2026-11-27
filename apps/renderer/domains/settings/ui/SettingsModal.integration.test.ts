// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { CustomSelect, Modal } from '@linnya/renderer-ui';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { useUIStore } from '@/shared/stores/ui';
import { clearSettingsContributionsForTest, registerSettingsContribution } from '../registry/settingsRegistry';
import SettingsModal from './SettingsModal.vue';
import SettingsPage from './kit/SettingsPage.vue';

let app: App | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { app?.unmount(); container?.remove(); clearSettingsContributionsForTest(); });

describe('设置页头所有权', () => {
  it('页面拥有标题和按钮时只呈现一个页头，切回普通设置页仍由壳层显示标题', async () => {
    clearSettingsContributionsForTest();
    registerSettingsContribution({ id: 'appearance', title: '外观', group: 'general', order: 0,
      component: defineComponent({ render: () => h('p', '外观设置') }) });
    registerSettingsContribution({ id: 'skills', title: 'Skill', group: 'document-types', order: 1, headerMode: 'page',
      component: defineComponent({ render: () => h(SettingsPage, { title: '已安装的 Skill' }, {
        actions: () => h('button', '安装'), default: () => h('p', 'Skill 列表'),
      }) }) });
    const pinia = createPinia();
    useUIStore(pinia).openSettingsModal('skills');
    container = document.createElement('div'); document.body.append(container);
    app = createApp(SettingsModal); app.use(pinia); app.mount(container);
    await nextTick();
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelector('h2')?.textContent).toBe('已安装的 Skill');
    expect(container.querySelector('.settings-page-header button')?.textContent).toBe('安装');
    container.querySelector<HTMLButtonElement>('[data-tab-id="appearance"]')?.click();
    await nextTick();
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelector('.settings-modal-panel-title')?.textContent).toBe('外观');
  });
});

describe('设置里的嵌套弹窗', () => {
  it('Escape 先关闭最上层的详情弹窗，再次 Escape 才关闭设置', async () => {
    clearSettingsContributionsForTest();
    const detailVisible = ref(false);
    registerSettingsContribution({ id: 'models', title: '模型管理', group: 'general', order: 0,
      component: defineComponent({ render: () => h(Modal, {
        isVisible: detailVisible.value,
        title: '模型详情',
        onClose: () => { detailVisible.value = false; },
      }) }) });
    const pinia = createPinia();
    const uiStore = useUIStore(pinia);
    uiStore.openSettingsModal('models');
    // 与 GlobalModals 一致：设置关闭即卸载。
    const Host = defineComponent({
      setup: () => () => (uiStore.settingsModalVisible ? h(SettingsModal) : null),
    });
    container = document.createElement('div'); document.body.append(container);
    app = createApp(Host); app.use(pinia); app.mount(container);
    await nextTick();

    detailVisible.value = true;
    await nextTick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(detailVisible.value).toBe(false);
    expect(uiStore.settingsModalVisible).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(uiStore.settingsModalVisible).toBe(false);
  });

  it('开着下拉时第一次点遮罩只关下拉，再点一次才关闭设置', async () => {
    clearSettingsContributionsForTest();
    registerSettingsContribution({ id: 'appearance', title: '外观', group: 'general', order: 0,
      component: defineComponent({ render: () => h(CustomSelect, {
        modelValue: 'zh-CN',
        options: [{ value: 'zh-CN', text: '简体中文' }, { value: 'en', text: 'English' }],
      }) }) });
    const pinia = createPinia();
    const uiStore = useUIStore(pinia);
    uiStore.openSettingsModal('appearance');
    const Host = defineComponent({
      setup: () => () => (uiStore.settingsModalVisible ? h(SettingsModal) : null),
    });
    container = document.createElement('div'); document.body.append(container);
    app = createApp(Host); app.use(pinia); app.mount(container);
    await nextTick();

    const trigger = container.querySelector<HTMLButtonElement>('.select-trigger');
    trigger?.click();
    await nextTick();
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    // 真实点击先在遮罩上按下，再收到 click。
    const clickBackdrop = (): void => {
      const overlay = container?.querySelector('.settings-modal-overlay');
      overlay?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    clickBackdrop();
    await nextTick();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(uiStore.settingsModalVisible).toBe(true);

    clickBackdrop();
    await nextTick();
    expect(uiStore.settingsModalVisible).toBe(false);
  });
});
