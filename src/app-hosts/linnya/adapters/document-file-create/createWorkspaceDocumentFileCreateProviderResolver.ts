import { createMarkdownDocumentStore } from '../../application/markdown-image-assets';
import { createMarkdownImageSourceResolver, type MarkdownImageSourceContext } from '../../application/markdown-image-assets';
import type Database from 'better-sqlite3';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import {
  getDocumentTypeBackendHook,
  listDocumentTypeBackendHooks,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import {
  buildMarkdownDocumentFromText,
  buildMarkdownCitationReadProjection,
  countMarkdownTextCharacters,
  markdownTextDocumentBuilder,
  prepareMarkdownImageInput,
} from '../../../../domains/markdown';
import {
  ensureWorkspaceFileParentFolders,
  WorkspaceDocumentFileCreateFailure,
} from '../../../../features/workspace/document-file-create';
import { readPersistedWorkspaceVfsNode } from '../../../../features/workspace/vfs';
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
  readonly context: PluginToolContext & MarkdownImageSourceContext;
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
        db: params.db,
        workspaceService: params.workspaceService,
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
  readonly context: PluginToolContext & MarkdownImageSourceContext;
  readonly workspaceService: WorkspaceService;
  readonly resultCommit?: ToolOwnerResultCommit<WorkspaceDocumentFileCreateResult>;
}): WorkspaceDocumentFileCreateProvider {
  const documentStore = createMarkdownDocumentStore(params.db);
  return {
    displayName: 'Markdown',
    enabled: true,
    disabledMessage: 'Markdown 是永久启用的内建文档类型。',
    create: async request => {
      params.resultCommit?.prepare();
      const imageInput = await prepareMarkdownImageInput({
        markdown: request.content, existing: new Map(), resolve: createMarkdownImageSourceResolver(params.context),
      });
      const built = await buildMarkdownDocumentFromText({
        markdown: imageInput.markdown,
        imageSources: imageInput.imageSources,
        normalizer: markdownTextDocumentBuilder,
        resolveCitationSources: refs =>
          requireCitationSourceResolver(params.context).resolveSources(refs),
        resolveCitationSourcesByUrl: urls =>
          requireCitationSourceResolver(params.context).resolveSourcesByUrl(urls),
      });
      return params.db
        .transaction(() => {
          const parent = ensureWorkspaceFileParentFolders({
            projectId: request.projectId,
            parentPath: request.parentPath,
            workspace: {
              getChildNodes: (parentId, projectId) =>
                params.workspaceService.getChildNodes(parentId, projectId),
              isVisibleNode: nodeId => readPersistedWorkspaceVfsNode(params.db, nodeId) !== null,
              createFolder: (projectId, name, parentId) =>
                params.workspaceService.createFolder(projectId, name, parentId),
            },
          });
          const documentId = params.workspaceService.createDocument(
            request.projectId,
            request.name,
            parent.parentId,
            'document'
          );
          documentStore.createDocument(documentId, built.content);
          // 与编辑回执使用同一领域投影；普通链接、代码中的引用示例不冒充来源。
          const currentProjection = buildMarkdownCitationReadProjection({
            content: documentStore.getDocument(documentId),
            pendings: [],
            viewMode: 'preview',
          });
          const citationSourceCount = currentProjection.citationProjection.sources.length;
          const result: WorkspaceDocumentFileCreateResult = {
            documentId,
            createdFolders: parent.createdFolders,
            textMetrics: countMarkdownTextCharacters(currentProjection.viewBlocks),
            buildObservation: identity =>
              `已创建 Markdown 文件：${identity.path}。inode: ${identity.inode}。${citationSourceCount > 0 ? `当前全文可解析引用来源：${citationSourceCount}。` : ''}`,
          };
          params.resultCommit?.commit(result);
          return result;
        })
        .immediate();
    },
  };
}

function createPluginFileCreateProvider(params: {
  readonly db: Database.Database;
  readonly workspaceService: WorkspaceService;
  readonly registeredHook: DocumentTypeBackendHook;
  readonly enabledHook: DocumentTypeBackendHook | undefined;
  readonly context: PluginToolContext & MarkdownImageSourceContext;
}): WorkspaceDocumentFileCreateProvider {
  const unavailableMessage = buildPluginFileCreateUnavailableMessage(params.registeredHook);
  return {
    displayName: params.registeredHook.displayName,
    enabled: typeof params.enabledHook?.createDocument === 'function',
    disabledMessage: unavailableMessage,
    create: async request => {
      const createDocument = params.enabledHook?.createDocument;
      if (!createDocument) throw new Error(unavailableMessage);
      // 插件 hook 是异步边界；目录用独立短事务，不把 Promise 塞进 SQLite 事务。
      const parent = params.db
        .transaction(() =>
          ensureWorkspaceFileParentFolders({
            projectId: request.projectId,
            parentPath: request.parentPath,
            workspace: {
              getChildNodes: (parentId, projectId) =>
                params.workspaceService.getChildNodes(parentId, projectId),
              isVisibleNode: nodeId => readPersistedWorkspaceVfsNode(params.db, nodeId) !== null,
              createFolder: (projectId, name, parentId) =>
                params.workspaceService.createFolder(projectId, name, parentId),
            },
          })
        )
        .immediate();
      let result: Awaited<ReturnType<typeof createDocument>>;
      try {
        result = await createDocument({
          context: params.context,
          projectId: request.projectId,
          parentId: parent.parentId,
          name: request.name,
          content: request.content,
        });
      } catch (error) {
        // 不回删已经提交且可能被其他调用复用的目录；保留插件的原始失败原因。
        if (parent.createdFolders.length === 0) throw error;
        throw new WorkspaceDocumentFileCreateFailure(error, parent.createdFolders);
      }
      return {
        documentId: result.documentId,
        createdFolders: parent.createdFolders,
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
