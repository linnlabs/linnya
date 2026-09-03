/**
 * @file useActiveDocumentPluginAvailabilityGuard.ts
 * @description 当前打开文档的插件可用性守卫。
 *
 * 中文说明：
 * - 文件树和新建入口已经按 enabledPluginIds 过滤；
 * - 这里处理“插件在文档打开后被禁用/卸载”的运行期变化；
 * - 逻辑放在 app 层，通过 registry + navigation port 协调，不让 plugin-store 或 layout store 互相硬依赖。
 */

import { watch } from 'vue';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { resolveDocumentTypeByActiveType } from './registry';
import { useEnabledPluginsStore } from './enabledPluginsStore';

export function useActiveDocumentPluginAvailabilityGuard(): void {
  const layoutStore = useLayoutStore();
  const enabledPluginsStore = useEnabledPluginsStore();
  let isHandlingUnavailableDocument = false;

  watch(
    () => ({
      activeDocument: layoutStore.state.activeDocument,
      enabledPluginIds: enabledPluginsStore.enabledPluginIds,
      hasLoaded: enabledPluginsStore.hasLoaded,
    }),
    async ({ activeDocument, enabledPluginIds, hasLoaded }) => {
      if (!hasLoaded || !activeDocument || isHandlingUnavailableDocument) return;

      const availability = resolveDocumentTypeByActiveType(activeDocument.type, enabledPluginIds);
      if (availability.state === 'enabled') return;

      isHandlingUnavailableDocument = true;
      try {
        await getWorkspaceNavigationPort().openPluginStore();
        layoutStore.clearActiveDocument();
      } finally {
        isHandlingUnavailableDocument = false;
      }
    },
    { immediate: true },
  );
}
