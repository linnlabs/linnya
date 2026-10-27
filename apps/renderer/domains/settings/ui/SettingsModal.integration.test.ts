// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 两个设置页夹具用于验证切换时页头所有权不会重复或丢失。 */
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
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
