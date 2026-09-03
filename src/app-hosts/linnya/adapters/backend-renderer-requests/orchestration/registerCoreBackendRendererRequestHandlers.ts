import type { BackendRuntimeOwner } from '../../../backend-runtime/orchestration/backendRuntimeOwner';
import { registerWorkspaceHandlers } from 'src/electron-main/ipc/handlers/workspace/workspace-ipc';
import { registerAgentsHandlers } from 'src/electron-main/ipc/handlers/workspace/agents-ipc';
import { registerTodoHandlers } from 'src/electron-main/ipc/handlers/todo/todo-ipc';
import { registerProjectKnowledgeBaseLinksHandlers } from 'src/electron-main/ipc/handlers/knowledge-base/project-knowledge-base-links-ipc';
import { registerKnowledgeBaseHandlers } from 'src/electron-main/ipc/handlers/knowledge-base/knowledge-base-ipc';
import { registerMarkdownDocumentHandlers } from 'src/electron-main/ipc/handlers/workspace/documents/markdown_document/document-ipc';
import { registerAudioBlockHandlers } from 'src/electron-main/ipc/handlers/workspace/documents/markdown_document/audio-block-ipc';
import { registerBlockHistoryHandlers } from 'src/electron-main/ipc/handlers/workspace/documents/markdown_document/block-history-ipc';
import { registerWebSearchConfigHandlers } from 'src/electron-main/ipc/handlers/web-search/web-search-ipc';
import { registerWebReadConfigHandlers } from 'src/electron-main/ipc/handlers/web-read/web-read-ipc';
import { registerPluginsHandlers } from 'src/electron-main/ipc/handlers/plugins/plugins-ipc';
import { registerConversationFileLinkHandlers } from 'src/electron-main/ipc/handlers/conversation-files/conversation-file-link-ipc';
import {
  getRegisteredBackendPluginIpcChannels,
  registerRegisteredBackendPluginIpcHandlers,
} from '../../../plugin-registry/builtin';
import {
  getPluginRuntimeState,
} from '../../../plugin-registry/pluginRuntimeState';
import { invokeBackendPluginIpcHandler } from '@plugin/backend/pluginIpcRuntime';
import { dispatchPluginInvoke } from 'src/electron-main/ipc/handlers/plugins/pluginInvokeDispatcher';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';
import { createBackendRendererIpcStyleRegistrar } from './createBackendRendererIpcStyleRegistrar';
import type {
  BackendRendererIntegrationPort,
  DesktopCredentialProtectionPort,
  DesktopFileRevealPort,
} from '../../../desktop-capabilities';

/**
 * App Server 内注册数据库与插件请求；文件 reveal 只依赖窄 Desktop port，审批 sender 语义仍留在 Main。
 * 现有 handler 的物理目录仍在 electron-main 历史目录，但只依赖 App Host 的 Backend runtime owner。
 */
export async function registerCoreBackendRendererRequestHandlers(input: {
  readonly runtimeOwner: BackendRuntimeOwner;
  readonly registry: BackendRendererRequestRegistryPort;
  readonly credentialProtection: DesktopCredentialProtectionPort;
  readonly rendererIntegration: BackendRendererIntegrationPort;
  readonly applicationVersion: string;
  readonly packaged: boolean;
  readonly fileReveal: DesktopFileRevealPort;
}): Promise<void> {
  const ipc = createBackendRendererIpcStyleRegistrar(input.registry);
  registerWorkspaceHandlers(input.runtimeOwner, ipc);
  registerAgentsHandlers(input.runtimeOwner, ipc);
  registerTodoHandlers(input.runtimeOwner, ipc);
  registerProjectKnowledgeBaseLinksHandlers(input.runtimeOwner, ipc);
  registerKnowledgeBaseHandlers(input.runtimeOwner, ipc);
  registerMarkdownDocumentHandlers(input.runtimeOwner, ipc);
  registerAudioBlockHandlers(input.runtimeOwner, ipc);
  registerBlockHistoryHandlers(input.runtimeOwner, ipc);
  await registerWebSearchConfigHandlers(ipc, {
    credentialProtection: input.credentialProtection,
  });
  await registerWebReadConfigHandlers(ipc, {
    credentialProtection: input.credentialProtection,
  });
  registerConversationFileLinkHandlers({ ipc, fileReveal: input.fileReveal });

  registerRegisteredBackendPluginIpcHandlers(input.runtimeOwner);
  input.registry.handle('plugin:invoke', request => dispatchPluginInvoke(undefined, request, {
    getRuntimeState: getPluginRuntimeState,
    listAllowedChannels: getRegisteredBackendPluginIpcChannels,
    invokeHandler: invokeBackendPluginIpcHandler,
  }));
  await registerPluginsHandlers({
    runtimeOwner: input.runtimeOwner,
    ipc,
    applicationVersion: input.applicationVersion,
    packaged: input.packaged,
    rendererIntegration: input.rendererIntegration,
  });
}
