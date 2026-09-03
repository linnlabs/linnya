/**
 * @file readWorkspaceDocumentView.ts
 * @description 按 Workspace 节点身份读取结构化 DocumentView。
 *
 * 这里拥有 Workspace 节点确认、内建/插件文档分派、禁用态快照和统一结果 admission；
 * Markdown 文档内部读取由注入的 domain provider 完成。VFS 普通文本仍由 readWorkspaceVfsNode 调度。
 */

import type Database from 'better-sqlite3';
import {
  sliceTextWindow,
  WorkspaceDocumentReadDataSchema,
  WorkspaceDocumentReadResultSchema,
  type WorkspaceDocumentReadResult,
} from '@app/schemas';
import { validate as isUuid } from 'uuid';
import type { WorkspaceService } from '../../../../electron-main/services/workspace/workspace';
import type { WorkspaceVfsNodeTypeAccessPolicy } from '../../vfs/orchestration/listWorkspaceVfsNodes';
import { readWorkspaceNodeTextSnapshot } from '../../infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';
import type {
  WorkspaceDocumentReadRequest,
  WorkspaceDocumentTypeReadProviderResolver,
} from '../definitions/workspaceDocumentRead';
import { buildWorkspaceObservationPreviewMeta } from '../functions/observationPreviewMeta';

export interface WorkspaceDocumentReadDependencies {
  readonly db: Database.Database;
  readonly workspaceService: Pick<WorkspaceService, 'getNode'>;
  readonly resolveDocumentTypeReadProvider: WorkspaceDocumentTypeReadProviderResolver;
  readonly nodeTypeAccessPolicy: WorkspaceVfsNodeTypeAccessPolicy;
}

export async function readWorkspaceDocumentView(
  request: WorkspaceDocumentReadRequest,
  dependencies: WorkspaceDocumentReadDependencies,
): Promise<WorkspaceDocumentReadResult> {
  const documentId = request.documentId.trim();
  if (!documentId) {
    throw new Error('documentId is required to read a Workspace DocumentView.');
  }
  if (!isUuid(documentId)) {
    throw new Error(
      `Invalid document_id format: ${documentId}. Workspace DocumentView only accepts workspace_nodes.id UUIDs, not document names.`,
    );
  }

  const node = dependencies.workspaceService.getNode(documentId);
  if (!node) {
    throw new Error(`Document not found: ${documentId}`);
  }
  if (typeof node.name !== 'string' || node.name.trim().length === 0) {
    throw new Error(`Workspace document has no valid name: ${documentId}`);
  }

  const documentName = node.name.trim();
  const docType = node.type;
  const provider = dependencies.resolveDocumentTypeReadProvider(docType);
  if (provider) {
    if (!provider.enabled) {
      const snapshot = readTextSnapshotDocument({
        dependencies,
        documentId,
        documentName,
        docType,
        maxChars: request.maxChars,
        offsetChars: request.offsetChars,
      });
      if (snapshot) return snapshot;

      if (!dependencies.nodeTypeAccessPolicy.canReadContent(docType)) {
        throw new Error(
          dependencies.nodeTypeAccessPolicy.buildDisabledMessage(
            docType,
            `读取 ${provider.displayName} 文档`,
          ),
        );
      }
      throw new Error(provider.disabledMessage);
    }

    const readResult = await provider.read({
      ...request,
      documentId,
      documentName,
    });
    if (!readResult) {
      throw new Error(`${provider.displayName} not found: ${documentId}`);
    }
    return admitWorkspaceDocumentReadResult({
      data: WorkspaceDocumentReadDataSchema.parse(readResult.data),
      observation: readResult.observation,
      observationPreviewMeta: buildWorkspaceObservationPreviewMeta({ documentName, docType }),
      ...(readResult.citationSources
        ? { citationSources: readResult.citationSources }
        : {}),
      ...(readResult.citationDiagnostics
        ? { citationDiagnostics: readResult.citationDiagnostics }
        : {}),
    });
  }

  const snapshot = readTextSnapshotDocument({
    dependencies,
    documentId,
    documentName,
    docType,
    maxChars: request.maxChars,
    offsetChars: request.offsetChars,
  });
  if (snapshot) return snapshot;
  throw new Error(`不支持读取的文档类型: ${docType}`);
}

function admitWorkspaceDocumentReadResult(
  result: WorkspaceDocumentReadResult,
): WorkspaceDocumentReadResult {
  return WorkspaceDocumentReadResultSchema.parse(result);
}

function readTextSnapshotDocument(params: {
  readonly dependencies: WorkspaceDocumentReadDependencies;
  readonly documentId: string;
  readonly documentName: string;
  readonly docType: string;
  readonly maxChars: number;
  readonly offsetChars: number;
}): WorkspaceDocumentReadResult | null {
  const snapshot = readWorkspaceNodeTextSnapshot(params.dependencies.db, params.documentId);
  if (!snapshot) return null;

  const windowResult = sliceTextWindow(
    snapshot.text,
    params.offsetChars,
    params.maxChars,
    true,
  );
  return admitWorkspaceDocumentReadResult({
    data: {
      documentId: params.documentId,
      docType: params.docType,
      documentName: params.documentName,
      truncatedByChars: windowResult.truncated,
      totalTextLength: windowResult.totalLength,
      nextOffset: windowResult.nextOffset,
      presentation: { kind: 'text', text: windowResult.text },
      details: { snapshotUpdatedAt: snapshot.updatedAt },
    },
    observation: windowResult.text,
    observationPreviewMeta: buildWorkspaceObservationPreviewMeta({
      documentName: params.documentName,
      docType: params.docType,
    }),
  });
}
