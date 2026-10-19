import { useUIStore } from '@/shared/stores/ui';
import { selectModelManagementProvider } from '../features/model-picker';

/** 复用设置壳的导航意图，连接选择仍由模型域持有，不重复注册设置页面。 */
export function openConfiguredProviderManagement(configuredProviderId: string): void {
  selectModelManagementProvider(configuredProviderId);
  useUIStore().openSettingsModal('model-management');
}
