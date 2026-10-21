import type Database from 'better-sqlite3';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import {
  getDocumentTypeBackendHook,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import {
  MarkdownDocumentService,
  MarkdownNormalizationService,
  writeMarkdownDocumentFromText,
  resolveMarkdownEscapeEquivalentText,
  prepareMarkdownFileWrite,
  projectMarkdownFileEditText,
  projectMarkdownFileWriteSnapshot,
  type MarkdownFileWriteSnapshot,
  MarkdownFileWriteConflictError,
} from '../../../../domains/markdown';
import { requireCitationRefAllocator, requireCitationSourceResolver, type CitationRefAllocatorPort } from '../../../../domains/citation';
import type {
  WorkspaceDocumentFileWriteProvider,
  WorkspaceDocumentFileWriteProviderResolver,
  WorkspaceDocumentFileWriteResult,
} from '../../../../features/workspace/document-file-write/definitions/workspaceDocumentFileWrite';
import type { ToolOwnerResultCommit } from '../../application/run-resumption';
import type { WorkspaceMutationPublisher } from '../../../../features/workspace/definitions/workspaceMutationPublisher';
import { createWorkspaceDocumentUpdatedEvent } from '../../../../features/workspace/functions/createWorkspaceDocumentMutationEvent';
import { createSqliteWorkspaceDocumentMutationPort } from '../../../../features/workspace/document-mutation/infrastructure/sqlite/createSqliteWorkspaceDocumentMutationPort';
import { findFormatOwnershipByNodeType } from '../../plugin-registry/formatOwnershipCatalog';
import { buildPluginRuntimeDisabledMessage } from '../../plugin-registry/pluginRuntimeAccess';

export function createWorkspaceDocumentFileWriteProviderResolver(params: {
  readonly db: Database.Database;
  readonly context: PluginToolContext;
  readonly mutationPublisher?: WorkspaceMutationPublisher;
  readonly resultCommit?: ToolOwnerResultCommit<WorkspaceDocumentFileWriteResult>;
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
  readonly resultCommit?: ToolOwnerResultCommit<WorkspaceDocumentFileWriteResult>;
}): WorkspaceDocumentFileWriteProvider {
  const documentStore = new MarkdownDocumentService(params.db);
  const normalizer = new MarkdownNormalizationService(params.db, documentStore);
  const workspaceMutation = createSqliteWorkspaceDocumentMutationPort(params.db);
  const captureSnapshot = (documentId: string): MarkdownFileWriteSnapshot => projectMarkdownFileWriteSnapshot({
    content: documentStore.getDocument(documentId),
    pendings: documentStore.getPendingRevisions(documentId),
    versionNumber: documentStore.getLatestVersion(documentId)?.version_number ?? null,
  });
  const normalize = async (documentId: string): Promise<void> => {
    const result = await normalizer.normalizeDocumentIfNeeded(documentId);
    if (result.status === 'failed') throw new Error(`文档仍处于未规范化状态，无法安全写入 pending revision：${result.reason ?? '未知原因'}`);
  };
  // 无引用文档不要求引用运行端口；按需调用仍须经过正式Host绑定，不能构造本地替代分配器。
  const allocator: CitationRefAllocatorPort = { allocate: anchors =>
    requireCitationRefAllocator(params.context).allocate(anchors) };
  return {
    displayName: 'Markdown',
    enabled: true,
    disabledMessage: 'Markdown 是永久启用的内建文档类型。',
    resolveEquivalentEditText: resolveMarkdownEscapeEquivalentText,
    prepareEdit: async request => {
      await normalize(request.identity.documentId);
      const snapshot = captureSnapshot(request.identity.documentId);
      if (snapshot.currentText !== request.currentText) throw new MarkdownFileWriteConflictError();
      return { text: await projectMarkdownFileEditText(snapshot, allocator), sourceKey: snapshot.sourceKey };
    },
    write: async request => {
      params.resultCommit?.prepare();
      const formatResult = (
        write: Awaited<ReturnType<typeof writeMarkdownDocumentFromText>>
      ): WorkspaceDocumentFileWriteResult => ({
        textMetrics: write.textMetrics,
        observation: buildMarkdownFileWriteObservation({
          operation: request.operation,
          path: request.identity.path,
          replacedCount: request.replacedCount,
          editedCount: write.edits.length,
          pendingCount: write.pendingCount,
          citationSourceCount: write.citationSourceCount,
          cancelledCount: write.cancelledCount,
          createdAnnotationCount: write.createdAnnotationIds.length,
          updatedAnnotationCount: write.updatedAnnotationIds.length,
          deletedAnnotationCount: write.deletedAnnotationIds.length,
        }),
      });
      await normalize(request.identity.documentId);
      const snapshot = captureSnapshot(request.identity.documentId);
      if (request.expectedSourceKey !== undefined && request.expectedSourceKey !== snapshot.sourceKey) throw new MarkdownFileWriteConflictError();
      const prepared = await prepareMarkdownFileWrite({
        snapshot, targetText: request.content, allocator,
        resolver: {
          resolveSources: refs => requireCitationSourceResolver(params.context).resolveSources(refs),
          resolveSourcesByUrl: urls => requireCitationSourceResolver(params.context).resolveSourcesByUrl(urls),
        },
      });
      const write = await writeMarkdownDocumentFromText({
        documentStore,
        documentId: request.identity.documentId,
        targetText: prepared.targetText,
        expectedCurrentText: request.expectedCurrentText,
        expectedSourceKey: snapshot.sourceKey,
        toolName: request.operation === 'edit' ? 'edit_file' : 'write_file',
        pendingMetaByMarkdown: prepared.pendingMetaByMarkdown,
        annotationAdmission: {
          author: 'AI',
          meta: {
            source: 'agent',
            ...(params.context.runId ? { runId: params.context.runId } : {}),
          },
        },
        touchDocumentUpdatedAt: workspaceMutation.touchDocumentUpdatedAt,
        commitResult: write => params.resultCommit?.commit(formatResult(write)),
      });
      if (
        write.edits.length > 0 || write.cancelledCount > 0 ||
        write.createdAnnotationIds.length > 0 ||
        write.updatedAnnotationIds.length > 0 ||
        write.deletedAnnotationIds.length > 0
      ) {
        const hasAnnotationChanges =
          write.createdAnnotationIds.length > 0 ||
          write.updatedAnnotationIds.length > 0 ||
          write.deletedAnnotationIds.length > 0;
        params.mutationPublisher?.publish(
          createWorkspaceDocumentUpdatedEvent({
            node: {
              id: request.identity.documentId,
              project_id: request.identity.projectId,
              type: request.identity.documentType,
            },
            mutationKind: hasAnnotationChanges ? 'incremental' : 'pending',
            source: 'tool',
          })
        );
      }

      return formatResult(write);
    },
  };
}

function buildMarkdownFileWriteObservation(params: {
  readonly operation: 'edit' | 'write';
  readonly path: string;
  readonly replacedCount?: number;
  readonly editedCount: number;
  readonly pendingCount: number;
  readonly citationSourceCount: number;
  readonly cancelledCount: number;
  readonly createdAnnotationCount: number;
  readonly updatedAnnotationCount: number;
  readonly deletedAnnotationCount: number;
}): string {
  const facts: string[] = [];
  // pendingCount 是文档当前总数，不能用它证明这次请求改变了正文或批注。
  if (
    params.editedCount === 0 && params.cancelledCount === 0 &&
    params.createdAnnotationCount === 0 && params.updatedAnnotationCount === 0 &&
    params.deletedAnnotationCount === 0
  ) {
    facts.push('本次规范化后正文和批注无变化');
  }
  if (params.cancelledCount > 0) facts.push(`已撤回 ${params.cancelledCount} 块正文修订`);
  if (params.pendingCount > 0) facts.push(`当前正文修订 ${params.pendingCount} 块待确认`);
  if (params.createdAnnotationCount > 0) {
    facts.push(`批注 ${params.createdAnnotationCount} 条已创建`);
  }
  if (params.updatedAnnotationCount > 0) {
    facts.push(`批注 ${params.updatedAnnotationCount} 条已更新`);
  }
  if (params.deletedAnnotationCount > 0) {
    facts.push(`批注 ${params.deletedAnnotationCount} 条已删除`);
  }
  const replacement = params.operation === 'edit' ? `，请求替换 ${params.replacedCount ?? 0} 处` : '';
  const citation = params.citationSourceCount > 0
    ? `当前全文可解析引用来源：${params.citationSourceCount}（含待确认修订）。`
    : '';
  return `已处理 Markdown 文件：${params.path}${replacement}；${facts.join('，')}。${citation}`;
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
