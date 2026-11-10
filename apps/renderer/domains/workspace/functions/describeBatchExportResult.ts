import type { NotificationType } from '@linnya/renderer-ui';
import type { BatchExportResult } from '../features/import-export/services/batchExportService';
import type { WorkspaceMessageResolver } from '../definitions/workspaceMessages';

/** 结果提示里最多列出的失败文档名；其余用省略号表示，完整名单在诊断日志里。 */
const MAX_LISTED_FAILURES = 5;

export interface BatchExportResultNotice {
  readonly message: string;
  readonly type: NotificationType;
  readonly durationMs: number;
}

/** 把批量导出结果写成一条提示：导出几篇、哪些失败、几份插件文档不在范围内。 */
export function describeBatchExportResult(
  result: Extract<BatchExportResult, { success: true }>,
  workspaceMessage: WorkspaceMessageResolver,
): BatchExportResultNotice {
  const parts: string[] = [];
  const failedCount = result.failedDocumentNames.length;
  if (failedCount === 0) {
    parts.push(workspaceMessage('workspace.sidebar.fileTree.batchExportComplete', { count: result.exportedCount }));
  } else {
    const listed = result.failedDocumentNames.slice(0, MAX_LISTED_FAILURES);
    const names = listed.join(workspaceMessage('workspace.sidebar.fileTree.batchExportNameSeparator'))
      + (failedCount > listed.length ? '…' : '');
    parts.push(workspaceMessage('workspace.sidebar.fileTree.batchExportPartial', {
      count: result.exportedCount,
      failedCount,
      names,
    }));
  }
  if (result.skippedPluginDocumentCount > 0) {
    parts.push(workspaceMessage('workspace.sidebar.fileTree.batchExportPluginDocumentsSkipped', {
      count: result.skippedPluginDocumentCount,
    }));
  }
  return failedCount === 0
    ? { message: parts.join(' '), type: 'success', durationMs: 3_000 }
    : { message: parts.join(' '), type: 'warning', durationMs: 10_000 };
}
