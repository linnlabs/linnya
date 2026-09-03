import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import { getDocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';
import type {
  WorkspaceDocumentTypeReadProviderResolver,
} from '../../../../features/workspace/document-read/definitions/workspaceDocumentRead';

/**
 * 组合永久内建文档 provider 与插件 hook。
 *
 * Markdown provider 由调用方显式注入，不注册进插件启停账本；插件 provider 则保留运行态 enabled 检查。
 */
export function createWorkspaceDocumentTypeReadProviderResolver(params: {
  readonly context: PluginToolContext;
  readonly resolveBuiltIn: WorkspaceDocumentTypeReadProviderResolver;
}): WorkspaceDocumentTypeReadProviderResolver {
  return (docType) => {
    const builtIn = params.resolveBuiltIn(docType);
    if (builtIn) return builtIn;

    const registeredHook = getDocumentTypeBackendHook(docType, { includeDisabled: true });
    if (!registeredHook?.readDocument) return undefined;
    const enabledHook = getDocumentTypeBackendHook(docType);
    const enabledRead = enabledHook?.readDocument;
    return {
      displayName: registeredHook.displayName,
      enabled: typeof enabledRead === 'function',
      disabledMessage: `${registeredHook.displayName} 插件未启用，无法读取该文档。`,
      read: async request => {
        if (!enabledRead) return null;
        return enabledRead({
          context: params.context,
          ...(request.pluginArgs ? { args: request.pluginArgs } : {}),
          documentId: request.documentId,
          documentName: request.documentName,
          maxChars: request.maxChars,
          offsetChars: request.offsetChars,
          structureOnly: request.structureOnly,
        });
      },
    };
  };
}
