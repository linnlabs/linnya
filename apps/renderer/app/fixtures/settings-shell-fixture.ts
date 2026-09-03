// 设置壳层（分组导航 + 面板）的开发预览 fixture。
// 只装配 UI，不接后端：IPC 一律返回失败，让各 tab 走自己的不可用/空态分支。
// 额外注册两个假的文档类型贡献，用来验证「文档与插件」分组和「关于」的无标题分组分隔线。

import { createApp, defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import '../styles/index.css';
import '../../domains/settings/styles/index.css';
import SettingsModal from '../../domains/settings/ui/SettingsModal.vue';
import { ensureCoreSettingsContributionsRegistered } from '../../domains/settings/registry/registerCoreSettingsContributions';
import { registerSettingsContribution } from '../../domains/settings/registry/settingsRegistry';
import { initializeLocalization } from '../localization';
import {
  ensureSharedComponentLocalizationRegistered,
  provideSharedComponentLocalization,
} from '../localization/orchestration/provideSharedComponentLocalization';
import { useUIStore } from '../../shared/stores/ui';
import { ensureEditorDocumentSettingsContributionRegistered } from '../../domains/editor/features/DocumentSettings/registry/registerEditorDocumentSettingsContribution';

Object.defineProperty(window, 'electronAPI', {
  configurable: true,
  value: {
    openExternalUrl: async () => ({ success: true }),
    invoke: async (channel: string) => ({ success: false, error: `Fixture 不支持通道：${channel}` }),
  },
});

function placeholderTab(label: string) {
  return defineComponent({
    setup: () => () => h('div', { class: 'settings-tab-content' }, [
      h('h3', label),
      h('p', { class: 'setting-description' }, '预览占位内容。'),
    ]),
  });
}

ensureCoreSettingsContributionsRegistered();
ensureEditorDocumentSettingsContributionRegistered();
ensureSharedComponentLocalizationRegistered();

registerSettingsContribution({
  id: 'fixture-document-type',
  title: '扩展文档',
  group: 'document-types',
  order: 40,
  component: placeholderTab('扩展文档'),
});

const app = createApp(defineComponent({
  setup: () => () => h(SettingsModal),
}));
const pinia = createPinia();
app.use(pinia);
provideSharedComponentLocalization(app);
initializeLocalization({ document });
useUIStore(pinia).openSettingsModal('appearance');
app.mount('#app');
