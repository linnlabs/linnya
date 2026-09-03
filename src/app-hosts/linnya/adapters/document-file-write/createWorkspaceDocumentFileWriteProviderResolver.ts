import type Database from 'better-sqlite3';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import {
  getDocumentTypeBackendHook,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import {
  buildMarkdownPendingCitationMetadata,
  MarkdownDocumentService,
  MarkdownNormalizationService,
  writeMarkdownDocumentFromText,
} from '../../../../domains/markdown';
import { requireCitationSourceResolver } from '../../../../domains/citation';
import type {
  WorkspaceDocumentFileWriteProvider,
  WorkspaceDocumentFileWriteProviderResolver,
} from '../../../../features/workspace/document-file-write/definitions/workspaceDocumentFileWrite';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';
import { createWorkspaceDocumentUpdatedEvent } from '../../../../features/workspace/functions/createWorkspaceDocumentMutationEvent';
import { createSqliteWorkspaceDocumentMutationPort } from '../../../../features/workspace/document-mutation/infrastructure/sqlite/createSqliteWorkspaceDocumentMutationPort';
import { findFormatOwnershipByNodeType } from '../../plugin-registry/formatOwnershipCatalog';
import { buildPluginRuntimeDisabledMessage } from '../../plugin-registry/pluginRuntimeAccess';

export function createWorkspaceDocumentFileWriteProviderResolver(params: {
  readonly db: Database.Database;
  readonly context: PluginToolContext;
  readonly mutationPublisher?: WorkspaceMutationPublisher;
}): WorkspaceDocumentFileWriteProviderResolver {
  const markdownProvider = createMarkdownFileWriteProvider(params);
  return documentType => {
    if (documentType === 'document') {
      return markdownProvider;
    }

    const registeredHook = getDocumentTypeBackendHook(documentType, { includeDisabled: true });
    if (!registeredHook?.writeDocument) return undefined;
    return createPluginFileWriteProvider({
      registeredHook,
      enabledHook: getDocumentTypeBackendHook(documentType),
      context: params.context,
    });
  };
}

function createMarkdownFileWriteProvider(params: {
  readonly db: Database.Database;
  readonly context: PluginToolContext;
  readonly mutationPublisher?: WorkspaceMutationPublisher;
}): WorkspaceDocumentFileWriteProvider {
  const documentStore = new MarkdownDocumentService(params.db);
  const normalizer = new MarkdownNormalizationService(params.db, documentStore);
  const workspaceMutation = createSqliteWorkspaceDocumentMutationPort(params.db);
  return {
    displayName: 'Markdown',
    enabled: true,
    disabledMessage: 'Markdown 是永久启用的内建文档类型。',
    write: async request => {
      const normalized = await normalizer.normalizeDocumentIfNeeded(request.identity.documentId);
      if (normalized.status === 'failed') {
        throw new Error(
          `文档仍处于未规范化状态，无法安全写入 pending revision：${normalized.reason ?? '未知原因'}`
        );
      }

      const write = await writeMarkdownDocumentFromText({
        documentStore,
        documentId: request.identity.documentId,
        targetText: request.content,
        toolName: request.operation === 'edit' ? 'edit_file' : 'write_file',
        pendingMetaByMarkdown: await buildMarkdownPendingCitationMetadata(request.content, refs =>
          requireCitationSourceResolver(params.context).resolveSources(refs)
        ),
        touchDocumentUpdatedAt: workspaceMutation.touchDocumentUpdatedAt,
      });
      if (write.edits.length > 0) {
        params.mutationPublisher?.publish(
          createWorkspaceDocumentUpdatedEvent({
            node: {
              id: request.identity.documentId,
              project_id: request.identity.projectId,
              type: request.identity.documentType,
            },
            mutationKind: 'pending',
            source: 'tool',
          })
        );
      }

      return {
        observation:
          request.operation === 'edit'
            ? `已写入 Markdown 修订意图：${request.identity.path}，替换 ${request.replacedCount ?? 0} 处。`
            : `已写入 Markdown 修订意图：${request.identity.path}。`,
      };
    },
  };
}

function createPluginFileWriteProvider(params: {
  readonly registeredHook: DocumentTypeBackendHook;
  readonly enabledHook: DocumentTypeBackendHook | undefined;
  readonly context: PluginToolContext;
}): WorkspaceDocumentFileWriteProvider {
  const unavailableMessage = buildPluginFileWriteUnavailableMessage(params.registeredHook);
  return {
    displayName: params.registeredHook.displayName,
    enabled: typeof params.enabledHook?.writeDocument === 'function',
    disabledMessage: unavailableMessage,
    write: async request => {
      const writeDocument = params.enabledHook?.writeDocument;
      if (!writeDocument) throw new Error(unavailableMessage);
      const result = await writeDocument({
        context: params.context,
        projectId: request.identity.projectId,
        documentId: request.identity.documentId,
        documentName: request.identity.documentName,
        content: request.content,
        ...(request.expectedSourceKey ? { expectedSourceKey: request.expectedSourceKey } : {}),
      });
      const observation = params.enabledHook?.formatWriteObservation
        ? params.enabledHook.formatWriteObservation({
            path: request.identity.path,
            inode: request.identity.inode,
            result,
            operation: request.operation,
            ...(request.replacedCount !== undefined
              ? { replacedCount: request.replacedCount }
              : {}),
          })
        : request.operation === 'edit'
          ? `已编辑 ${params.registeredHook.displayName} 文件：${request.identity.path}，替换 ${request.replacedCount ?? 0} 处。version_number: ${result.versionNumber}。`
          : `已写入 ${params.registeredHook.displayName} 文件：${request.identity.path}。version_number: ${result.versionNumber}。`;
      return {
        observation,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      };
    },
  };
}

function buildPluginFileWriteUnavailableMessage(hook: DocumentTypeBackendHook): string {
  const ownership = findFormatOwnershipByNodeType(hook.docType);
  if (!ownership) {
    return `${hook.displayName} 文档类型后端 hook 未启用，不能写入该文档。`;
  }
  return buildPluginRuntimeDisabledMessage({
    pluginId: ownership.pluginId,
    pluginName: ownership.pluginName,
    action: `写入 ${hook.displayName} 文件`,
  });
}
