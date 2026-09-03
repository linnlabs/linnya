import { registerSettingsContribution } from './settingsRegistry';
import AboutTab from '../ui/tabs/AboutTab.vue';
import {
  ModelRegistrationSettingsPage,
  ModelConfigurationSettingsPage,
  ModelManagementSettingsPage,
} from '@/domains/model-configuration';
import AppearanceTab from '../ui/tabs/AppearanceTab.vue';
import ConversationTab from '../ui/tabs/ConversationTab.vue';
import KitGalleryTab from '../ui/tabs/KitGalleryTab.vue';
import WebSearchTab from '../ui/tabs/WebSearchTab.vue';
import CommandPermissionSettingsTab from '../features/command-permission-settings/ui/CommandPermissionSettingsTab.vue';
import StorageSpaceSettingsTab from '../features/storage-space/ui/StorageSpaceSettingsTab.vue';
import { ensureSettingsLocalizationRegistered } from '../orchestration/ensureSettingsLocalizationRegistered';
import { SETTINGS_MESSAGE_FALLBACKS } from '../definitions/settingsMessageCatalog';

let registered = false;

export function ensureCoreSettingsContributionsRegistered(): void {
  if (registered) return;

  ensureSettingsLocalizationRegistered();

  registerSettingsContribution({
    id: 'appearance',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.appearance'],
    titleMessageKey: 'settings.tabs.appearance',
    group: 'general',
    order: 10,
    component: AppearanceTab,
  });
  registerSettingsContribution({
    id: 'conversation',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.conversation'],
    titleMessageKey: 'settings.tabs.conversation',
    group: 'general',
    order: 20,
    component: ConversationTab,
  });
  registerSettingsContribution({
    id: 'command-permission',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.commandPermission'],
    titleMessageKey: 'settings.tabs.commandPermission',
    group: 'general',
    order: 30,
    component: CommandPermissionSettingsTab,
  });
  registerSettingsContribution({
    id: 'storage-space',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.storageSpace'],
    titleMessageKey: 'settings.tabs.storageSpace',
    group: 'general',
    order: 40,
    component: StorageSpaceSettingsTab,
  });
  registerSettingsContribution({
    id: 'web-search',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.webSearch'],
    titleMessageKey: 'settings.tabs.webSearch',
    group: 'models',
    order: 45,
    component: WebSearchTab,
  });
  registerSettingsContribution({
    id: 'model',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.addModel'],
    titleMessageKey: 'settings.tabs.addModel',
    group: 'models',
    order: 50,
    component: ModelRegistrationSettingsPage,
  });
  registerSettingsContribution({
    id: 'model-management',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.modelManagement'],
    titleMessageKey: 'settings.tabs.modelManagement',
    group: 'models',
    order: 60,
    component: ModelManagementSettingsPage,
  });
  registerSettingsContribution({
    id: 'model-config',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.modelConfig'],
    titleMessageKey: 'settings.tabs.modelConfig',
    group: 'models',
    order: 70,
    component: ModelConfigurationSettingsPage,
  });
  registerSettingsContribution({
    id: 'about',
    title: SETTINGS_MESSAGE_FALLBACKS['settings.tabs.about'],
    titleMessageKey: 'settings.tabs.about',
    group: 'about',
    order: 90,
    component: AboutTab,
  });

  // Settings Kit 示例页：只在开发模式出现，供新建设置页时对照抄写。
  registerSettingsContribution({
    id: 'kit-gallery',
    title: '件套示例',
    group: 'document-types',
    order: 900,
    component: KitGalleryTab,
    isAvailable: () => import.meta.env.DEV === true,
  });

  registered = true;
}
