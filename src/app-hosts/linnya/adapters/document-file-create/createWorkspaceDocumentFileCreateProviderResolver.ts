import type Database from 'better-sqlite3';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import {
  getDocumentTypeBackendHook,
  listDocumentTypeBackendHooks,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import {
  buildMarkdownDocumentFromText,
  MarkdownDocumentService,
  MarkdownNormalizationService,
} from '../../../../domains/markdown';
import { requireCitationSourceResolver } from '../../../../domains/citation';
import type {
  WorkspaceDocumentFileCreateFormat,
  WorkspaceDocumentFileCreateProvider,
  WorkspaceDocumentFileCreateProviderResolver,
  WorkspaceDocumentFileCreateResult,
} from '../../../../features/workspace/document-file-create/definitions/workspaceDocumentFileCreate';
import type { ToolOwnerResultCommit } from '../../application/run-resumption';
import type { WorkspaceService } from '../../../../electron-main/services/workspace/workspace';
import {
  findFormatOwnershipByExtension,
  findFormatOwnershipByNodeType,
} from '../../plugin-registry/formatOwnershipCatalog';
import { buildPluginRuntimeDisabledMessage } from '../../plugin-registry/pluginRuntimeAccess';

export function createWorkspaceDocumentFileCreateProviderResolver(params: {
  readonly db: Database.Database;
  readonly context: PluginToolContext;
  readonly workspaceService: WorkspaceService;
  readonly resultCommit?: ToolOwnerResultCommit<WorkspaceDocumentFileCreateResult>;
}): WorkspaceDocumentFileCreateProviderResolver {
  const markdownProvider = createMarkdownFileCreateProvider(params);
  return fileName => {
    const registeredHook = findPluginDocumentHookByFileName(fileName, { includeDisabled: true });
    if (registeredHook) {
      return createPluginFileCreateProvider({
        registeredHook,
        enabledHook: getDocumentTypeBackendHook(registeredHook.docType),
        context: params.context,
      });
    }

    const unavailableOwnership = findFormatOwnershipByExtension(fileName);
    if (unavailableOwnership) {
      const message = buildPluginRuntimeDisabledMessage({
        pluginId: unavailableOwnership.pluginId,
        pluginName: unavailableOwnership.pluginName,
        action: `创建 ${unavailableOwnership.label} 文件`,
        includeExistingDataNote: false,
      });
      return {
        displayName: unavailableOwnership.label,
        enabled: false,
        disabledMessage: message,
        create: async () => {
          throw new Error(message);
        },
      };
    }

    return isMarkdownCreatePath(fileName) ? markdownProvider : undefined;
  };
}

export function listWorkspaceDocumentFileCreateFormats(): readonly WorkspaceDocumentFileCreateFormat[] {
  return listDocumentTypeBackendHooks()
    .filter(hook => hook.createDocument)
    .map(hook => ({
      displayName: hook.displayName,
      extensions: listHookFileExtensions(hook),
    }))
    .filter(format => format.extensions.length > 0);
}

function createMarkdownFileCreateProvider(params: {
  readonly db: Database.Database;
  readonly context: PluginToolContext;
  readonly workspaceService: WorkspaceService;
  readonly resultCommit?: ToolOwnerResultCommit<WorkspaceDocumentFileCreateResult>;
}): WorkspaceDocumentFileCreateProvider {
  const documentStore = new MarkdownDocumentService(params.db);
  const normalizer = new MarkdownNormalizationService(params.db, documentStore);
  return {
    displayName: 'Markdown',
    enabled: true,
    disabledMessage: 'Markdown 是永久启用的内建文档类型。',
    create: async request => {
      params.resultCommit?.prepare();
      const built = await buildMarkdownDocumentFromText({
        markdown: request.content,
        normalizer,
        resolveCitationSources: refs =>
          requireCitationSourceResolver(params.context).resolveSources(refs),
      });
      return params.db
        .transaction(() => {
          const documentId = params.workspaceService.createDocument(
            request.projectId,
            request.name,
            request.parentId,
            'document'
          );
          documentStore.createDocument(documentId, built.content);
          const result: WorkspaceDocumentFileCreateResult = {
            documentId,
            buildObservation: identity =>
              `已创建 Markdown 文件：${identity.path}。inode: ${identity.inode}。`,
          };
          params.resultCommit?.commit(result);
          return result;
        })
        .immediate();
    },
  };
}

function createPluginFileCreateProvider(params: {
  readonly registeredHook: DocumentTypeBackendHook;
  readonly enabledHook: DocumentTypeBackendHook | undefined;
  readonly context: PluginToolContext;
}): WorkspaceDocumentFileCreateProvider {
  const unavailableMessage = buildPluginFileCreateUnavailableMessage(params.registeredHook);
  return {
    displayName: params.registeredHook.displayName,
    enabled: typeof params.enabledHook?.createDocument === 'function',
    disabledMessage: unavailableMessage,
    create: async request => {
      const createDocument = params.enabledHook?.createDocument;
      if (!createDocument) throw new Error(unavailableMessage);
      const result = await createDocument({
        context: params.context,
        projectId: request.projectId,
        parentId: request.parentId,
        name: request.name,
        content: request.content,
      });
      return {
        documentId: result.documentId,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        buildObservation: identity =>
          params.enabledHook?.formatCreateObservation
            ? params.enabledHook.formatCreateObservation({
                path: identity.path,
                inode: identity.inode,
                result,
              })
            : `已创建 ${params.registeredHook.displayName} 文件：${identity.path}。inode: ${identity.inode}。`,
      };
    },
  };
}

function listHookFileExtensions(hook: DocumentTypeBackendHook): string[] {
  const extensions = [
    ...(typeof hook.fileExtension === 'string' ? [hook.fileExtension] : []),
    ...(hook.fileExtensions ?? []),
  ]
    .map(extension => extension.trim().toLowerCase())
    .filter(extension => extension.length > 0);
  return Array.from(new Set(extensions));
}

function findPluginDocumentHookByFileName(
  fileName: string,
  options: { readonly includeDisabled?: boolean } = {}
): DocumentTypeBackendHook | undefined {
  const lower = fileName.toLowerCase();
  return listDocumentTypeBackendHooks(options).find(
    hook =>
      !!hook.createDocument &&
      listHookFileExtensions(hook).some(extension => lower.endsWith(extension))
  );
}

function isMarkdownCreatePath(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return true;
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex <= 0 || lastDotIndex === fileName.length - 1;
}

function buildPluginFileCreateUnavailableMessage(hook: DocumentTypeBackendHook): string {
  const ownership = findFormatOwnershipByNodeType(hook.docType);
  if (!ownership) {
    return `${hook.displayName} 文档类型后端 hook 未启用，不能创建该文件。`;
  }
  return buildPluginRuntimeDisabledMessage({
    pluginId: ownership.pluginId,
    pluginName: ownership.pluginName,
    action: `创建 ${hook.displayName} 文件`,
    includeExistingDataNote: false,
  });
}
