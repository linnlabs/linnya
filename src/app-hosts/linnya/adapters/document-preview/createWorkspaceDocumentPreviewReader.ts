import path from 'node:path';
import { createMarkdownPreviewResources } from './createMarkdownPreviewResources';
import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import {
  createDocumentPreviewOperations,
  createFilePreviewCache,
} from 'src/domains/document-preview';
import { getDocumentTypeBackendHook } from 'src/plugin-sdk/backend/documentTypeBackendHook';
import { readWorkspaceDocumentIdentity } from 'src/plugin-sdk/backend/workspaceDocumentProjection';
import { readWorkspaceNodeTextSnapshot } from 'src/features/workspace/infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';
import { createMarkdownPreviewCapability } from 'src/domains/markdown';
import { getWorkspaceDataPath } from 'src/shared/utils/pathManager';

/** App 装配 Markdown 与插件 provider；domain 不 import 其他业务内部。 */
export function createWorkspaceDocumentPreviewReader(db: PluginSqliteDatabaseLike) {
  const markdown = createMarkdownPreviewCapability(db, createMarkdownPreviewResources(db));
  return createDocumentPreviewOperations({
    context: { databaseService: { getDb: () => db } },
    readNode: id => readWorkspaceDocumentIdentity(db, id),
    readTextSnapshot: id => readWorkspaceNodeTextSnapshot(db, id)?.text ?? null,
    resolveProvider: nodeType =>
      nodeType === 'document' ? markdown : (getDocumentTypeBackendHook(nodeType)?.preview ?? null),
    cache: createFilePreviewCache(path.join(getWorkspaceDataPath(), 'document-previews')),
  });
}
