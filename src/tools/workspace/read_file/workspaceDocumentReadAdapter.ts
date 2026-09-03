/**
 * @file workspaceDocumentReadAdapter.ts
 * @description 把 ToolContext 和 workspace-read feature 连接起来的 Host adapter。
 *
 * 该 adapter 不拥有文档读取规则，只负责现有工具运行时依赖的派生、服务装配和参数映射。
 */

import type { ToolContext } from '../../types';
import {
  DEFAULT_MAX_CHARS,
  MAX_ALLOWED_CHARS,
} from '../../../features/workspace/document-read/definitions/workspaceDocumentRead';
import {
  readWorkspaceDocumentView,
  type WorkspaceDocumentReadDependencies,
} from '../../../features/workspace/document-read/orchestration/readWorkspaceDocumentView';
import type { WorkspaceDocumentReadResult } from '@app/schemas';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { createWorkspaceDocumentTypeReadProviderResolver } from '../../../app-hosts/linnya/adapters/document-read/createWorkspaceDocumentTypeReadProviderResolver';
import { createMarkdownDocumentTypeReadProviderResolver } from '../../../app-hosts/linnya/adapters/document-read/createMarkdownDocumentTypeReadProviderResolver';
import { clampNumber } from '../shared/numberUtils';
import { ensureWorkspaceServiceToolContext } from '../shared/workspaceToolContext';

export async function readWorkspaceDocumentForTool(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<WorkspaceDocumentReadResult> {
  const databaseService = context.databaseService;
  if (!databaseService) {
    throw new Error('Workspace database not available in tool context.');
  }

  const resolvedContext = ensureWorkspaceServiceToolContext(context);
  const db = databaseService.getDb();
  const viewMode = args.view_mode === 'base' || args.view_mode === 'preview'
    ? args.view_mode
    : 'preview';
  const maxChars = clampNumber(
    typeof args.max_chars === 'number' ? args.max_chars : DEFAULT_MAX_CHARS,
    500,
    MAX_ALLOWED_CHARS,
  );
  const offsetChars = typeof args.offset_chars === 'number' && Number.isFinite(args.offset_chars)
    ? args.offset_chars
    : 0;

  const dependencies: WorkspaceDocumentReadDependencies = {
    db,
    workspaceService: resolvedContext.workspaceService,
    resolveDocumentTypeReadProvider: createWorkspaceDocumentTypeReadProviderResolver({
      context: resolvedContext.context,
      resolveBuiltIn: createMarkdownDocumentTypeReadProviderResolver({ db }),
    }),
    nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
  };
  return readWorkspaceDocumentView(
    {
      documentId: typeof args.document_id === 'string' ? args.document_id : '',
      viewMode,
      maxChars,
      offsetChars,
      structureOnly: args.include_structure_only === true,
      pluginArgs: args,
    },
    dependencies,
  );
}
