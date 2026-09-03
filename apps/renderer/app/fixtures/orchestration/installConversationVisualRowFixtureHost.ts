import { ensureBuiltinRendererPluginsRegistered } from '../../plugins/builtin';
import { useEnabledPluginsStore } from '../../plugins/enabledPluginsStore';
import { createWorkspaceNavigation } from '../../layout/orchestration/workspaceNavigation';
import { registerWorkspaceNavigationPort } from '../../../shared/ports/workspaceNavigationPort';
import { registerConversationResourceLinkPort } from '../../../domains/conversation/features/resource-link';
import { createConversationResourceLinkPort } from '../../workflows/conversation-resource-link/orchestration/createConversationResourceLinkPort';

/**
 * visual-row 夹具会挂载真实工具消息组件，因此必须满足与 App.vue 相同的导航端口合同。
 * 这里复用生产实现，不在 conversation domain 内伪造跨域依赖。
 */
export function installConversationVisualRowFixtureHost(): void {
  ensureBuiltinRendererPluginsRegistered();
  useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
  registerWorkspaceNavigationPort(createWorkspaceNavigation());
  registerConversationResourceLinkPort(createConversationResourceLinkPort());
}
