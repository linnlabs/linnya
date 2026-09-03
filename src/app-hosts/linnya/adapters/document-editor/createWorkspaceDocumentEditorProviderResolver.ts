import type Database from 'better-sqlite3';
import { getDocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';
import {
  MarkdownDocumentService,
  MarkdownNormalizationService,
  readMarkdownEditorDocument,
  writeMarkdownEditorDocument,
} from '../../../../domains/markdown';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';
import { createWorkspaceDocumentUpdatedEvent } from '../../../../features/workspace/functions/createWorkspaceDocumentMutationEvent';
import { adaptDocumentTypeBackendDatabase } from '../../plugin-registry/documentTypeBackendDatabaseAdapter';
import type {
  WorkspaceDocumentEditorProvider,
  WorkspaceDocumentEditorProviderResolver,
} from '../../../../features/workspace/document-editor/definitions/workspaceDocumentEditor';

export function createWorkspaceDocumentEditorProviderResolver(params: {
  readonly db: Database.Database;
  readonly mutationPublisher: WorkspaceMutationPublisher;
}): WorkspaceDocumentEditorProviderResolver {
  const markdownProvider = createMarkdownEditorProvider(params);
  const hookDb = adaptDocumentTypeBackendDatabase(params.db);
  return (documentType) => {
    if (documentType === 'document') {
      return markdownProvider;
    }

    const registeredHook = getDocumentTypeBackendHook(documentType, { includeDisabled: true });
    if (!registeredHook?.readEditorDocument && !registeredHook?.writeEditorDocument) {
      return undefined;
    }
    const enabledHook = getDocumentTypeBackendHook(documentType);
    return {
      displayName: registeredHook.displayName,
      enabled: !!enabledHook,
      disabledMessage: `${registeredHook.displayName} 插件未启用，无法编辑该文档。`,
      ...(registeredHook.readEditorDocument
        ? {
            read: async (identity) => {
              const read = enabledHook?.readEditorDocument?.({
                db: hookDb,
                documentId: identity.documentId,
                documentName: identity.documentName,
              });
              return read
                ? {
                    content: read.content,
                    pendingRevisions: read.pendingRevisions ?? [],
                  }
                : null;
            },
          }
        : {}),
      ...(registeredHook.writeEditorDocument
        ? {
            write: async (identity, content) => {
              const result = enabledHook?.writeEditorDocument?.({
                db: hookDb,
                documentId: identity.documentId,
                documentName: identity.documentName,
                content,
              });
              if (!result) {
                throw new Error(`${registeredHook.displayName} 插件未启用，无法编辑该文档。`);
              }
              return result;
            },
          }
        : {}),
    };
  };
}

function createMarkdownEditorProvider(params: {
  readonly db: Database.Database;
  readonly mutationPublisher: WorkspaceMutationPublisher;
}): WorkspaceDocumentEditorProvider {
  const documentStore = new MarkdownDocumentService(params.db);
  const normalizer = new MarkdownNormalizationService(params.db, documentStore);
  return {
    displayName: 'Markdown',
    enabled: true,
    disabledMessage: 'Markdown 是永久启用的内建文档类型。',
    read: identity => readMarkdownEditorDocument({
      documentId: identity.documentId,
      documentStore,
      normalizer,
    }),
    write: async (identity, content) => {
      const result = writeMarkdownEditorDocument({
        documentId: identity.documentId,
        content,
        documentStore,
      });
      params.mutationPublisher.publish(createWorkspaceDocumentUpdatedEvent({
        node: {
          id: identity.documentId,
          project_id: identity.projectId,
          type: identity.documentType,
        },
        mutationKind: 'version',
        versionNumber: result.versionNumber,
        source: 'user',
      }));
      return result;
    },
  };
}
