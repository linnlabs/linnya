import type { Component } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { getDocumentTypeByNodeType, resolveDocumentTypeByNodeType } from './registry';
import { useEnabledPluginsStore } from './enabledPluginsStore';
import type { DocumentTypeRecoveryAction } from './definitions/documentTypePresentation';

/** Host文档界面消费窄展示能力，不读取插件store或自行驱动registry生命周期。 */
export function readDocumentTypeIcon(nodeType: string): Component {
  return getDocumentTypeByNodeType(nodeType)?.iconComponent ?? DocumentIcon;
}
export function readDocumentTypeRecoveryAction(
  nodeType: string
): DocumentTypeRecoveryAction | null {
  const store = useEnabledPluginsStore();
  const availability = resolveDocumentTypeByNodeType(
    nodeType,
    store.enabledPluginIds,
    store.states
  );
  if (availability.state === 'enabled') return null;
  if (availability.state === 'disabled') {
    return {
      label: '启用插件',
      activate: () => store.setPluginEnabled(availability.pluginId, true),
    };
  }
  return { label: '前往插件商店', activate: () => getWorkspaceNavigationPort().openPluginStore() };
}
export type { DocumentTypeRecoveryAction } from './definitions/documentTypePresentation';
