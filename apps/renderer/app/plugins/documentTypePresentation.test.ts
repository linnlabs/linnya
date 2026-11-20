import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import { PLUGIN_CONTRIBUTION_MESSAGE_CATALOG } from './definitions/pluginContributionMessageCatalog';

const ports = vi.hoisted(() => ({ availability: vi.fn(), openStore: vi.fn() }));
vi.mock('./registry', () => ({
  getDocumentTypeByNodeType: () => null,
  resolveDocumentTypeByNodeType: ports.availability,
}));
vi.mock('./enabledPluginsStore', () => ({
  useEnabledPluginsStore: () => ({ enabledPluginIds: [], states: {}, setPluginEnabled: vi.fn() }),
}));
vi.mock('@/shared/ports/workspaceNavigationPort', () => ({
  getWorkspaceNavigationPort: () => ({ openPluginStore: ports.openStore }),
}));
import { readDocumentTypeRecoveryAction } from './documentTypePresentation';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  vi.clearAllMocks();
  clearLocalizationRegistryForTest();
});

it('文档类型不可用时的恢复动作按钮文字按界面语言生成', () => {
  registerMessageCatalogs(PLUGIN_CONTRIBUTION_MESSAGE_CATALOG);
  const labels = () => {
    ports.availability.mockReturnValueOnce({ state: 'disabled', pluginId: 'p' });
    const enable = readDocumentTypeRecoveryAction('slides')?.label;
    ports.availability.mockReturnValueOnce({ state: 'missing' });
    const store = readDocumentTypeRecoveryAction('slides')?.label;
    return [enable, store];
  };
  expect(labels()).toEqual(['启用插件', '前往插件商店']);
  useLocalizationStore().setCurrentLocale('en-US');
  expect(labels()).toEqual(['Enable plugin', 'Go to plugin store']);
  ports.availability.mockReturnValueOnce({ state: 'enabled' });
  expect(readDocumentTypeRecoveryAction('slides')).toBeNull();
});
