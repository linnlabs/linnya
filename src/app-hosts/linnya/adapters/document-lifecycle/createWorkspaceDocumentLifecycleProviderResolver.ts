import type Database from 'better-sqlite3';
import {
  getDocumentTypeBackendHook,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import type { DatabaseService } from '../../../../electron-main/services/database';
import type { WorkspaceService } from '../../../../electron-main/services/workspace/workspace';
import {
  MarkdownDocumentService,
  createDefaultMarkdownDocument,
} from '../../../../domains/markdown';
import type {
  WorkspaceDocumentLifecycleProvider,
  WorkspaceDocumentLifecycleProviderResolver,
} from '../../../../features/workspace/document-lifecycle/definitions/workspaceDocumentLifecycle';
import { findFormatOwnershipByNodeType } from '../../plugin-registry/formatOwnershipCatalog';
import { buildPluginRuntimeDisabledMessage } from '../../plugin-registry/pluginRuntimeAccess';

export function createWorkspaceDocumentLifecycleProviderResolver(params: {
  readonly db: Database.Database;
  readonly databaseService: DatabaseService;
  readonly workspaceService: WorkspaceService;
}): WorkspaceDocumentLifecycleProviderResolver {
  const markdownProvider = createMarkdownLifecycleProvider(params);
  return (documentType) => {
    if (documentType === 'document') {
      return markdownProvider;
    }
    const registeredHook = getDocumentTypeBackendHook(documentType, { includeDisabled: true });
    if (!registeredHook?.createDocument && !registeredHook?.duplicateDocument) {
      return undefined;
    }
    const enabledHook = getDocumentTypeBackendHook(documentType);
    return createPluginLifecycleProvider({
      registeredHook,
      enabledHook,
      databaseService: params.databaseService,
      workspaceService: params.workspaceService,
    });
  };
}

function createMarkdownLifecycleProvider(params: {
  readonly db: Database.Database;
  readonly workspaceService: WorkspaceService;
}): WorkspaceDocumentLifecycleProvider {
  const documentStore = new MarkdownDocumentService(params.db);
  return {
    displayName: 'Markdown',
    defaultDocumentName: '未命名文档',
    enabled: true,
    disabledMessage: 'Markdown 是永久启用的内建文档类型。',
    create: async request => {
      let documentId = '';
      params.db.transaction(() => {
        documentId = params.workspaceService.createDocument(
          request.projectId,
          request.name,
          request.parentId,
          'document',
        );
        documentStore.createDocument(documentId, createDefaultMarkdownDocument());
      }).immediate();
      return { documentId };
    },
    duplicate: async request => {
      let documentId = '';
      params.db.transaction(() => {
        const content = documentStore.getDocument(request.sourceDocumentId);
        documentId = params.workspaceService.createDocument(
          request.projectId,
          request.name,
          request.parentId,
          'document',
        );
        documentStore.createDocument(documentId, content);
      }).immediate();
      return { documentId };
    },
  };
}

function createPluginLifecycleProvider(params: {
  readonly registeredHook: DocumentTypeBackendHook;
  readonly enabledHook: DocumentTypeBackendHook | undefined;
  readonly databaseService: DatabaseService;
  readonly workspaceService: WorkspaceService;
}): WorkspaceDocumentLifecycleProvider {
  const unavailableMessage = buildPluginLifecycleUnavailableMessage(params.registeredHook);
  const context = {
    databaseService: params.databaseService,
    workspaceService: params.workspaceService,
  };
  return {
    displayName: params.registeredHook.displayName,
    defaultDocumentName: buildPluginDefaultDocumentName(params.registeredHook),
    enabled: !!params.enabledHook,
    disabledMessage: unavailableMessage,
    ...(params.registeredHook.createDocument
      ? {
          create: async request => {
            const create = params.enabledHook?.createDocument;
            if (!create) throw new Error(unavailableMessage);
            return create({ context, ...request });
          },
        }
      : {}),
    ...(params.registeredHook.duplicateDocument
      ? {
          duplicate: async request => {
            const duplicate = params.enabledHook?.duplicateDocument;
            if (!duplicate) throw new Error(unavailableMessage);
            return duplicate({
              context,
              sourceDocumentId: request.sourceDocumentId,
              projectId: request.projectId,
              parentId: request.parentId,
              name: request.name,
            });
          },
        }
      : {}),
  };
}

function buildPluginDefaultDocumentName(hook: DocumentTypeBackendHook): string {
  const label = hook.displayName.trim() || hook.docType;
  const extension = hook.fileExtension?.trim();
  const suffix = extension && !label.endsWith(extension) ? extension : '';
  return `未命名${label}${suffix}`;
}

function buildPluginLifecycleUnavailableMessage(hook: DocumentTypeBackendHook): string {
  const ownership = findFormatOwnershipByNodeType(hook.docType);
  if (!ownership) {
    return `${hook.displayName} 文档类型后端 hook 未启用。`;
  }
  return buildPluginRuntimeDisabledMessage({
    pluginId: ownership.pluginId,
    pluginName: ownership.pluginName,
    action: `操作 ${ownership.label} 文档`,
  });
}
