import type { PendingRevision } from '../definitions/pendingRevision';
import type { MarkdownPendingRevisionDTO } from '@app/schemas';

/**
 * Editor IPC 使用 camelCase；领域持久化继续保留数据库字段名。
 * 转换集中在 Pending feature，避免 Host 或 Workspace 理解 pending 表结构。
 */
export function projectMarkdownEditorPendingRevisions(
  revisions: readonly PendingRevision[],
): MarkdownPendingRevisionDTO[] {
  return revisions.map((revision) => ({
    id: revision.id,
    revision: revision.revision,
    blockId: revision.target_block_id,
    newMarkdown: revision.new_markdown,
    source: revision.source,
    operation: revision.operation ?? null,
    metaJson: revision.meta_json,
    createdAt: revision.created_at,
    updatedAt: revision.updated_at,
  }));
}
