import type { MarkdownPendingRevisionDTO } from '@app/schemas';
import type { CanonicalPendingSession } from '../definitions/revision';
import type { PendingRevisionDTO as ProjectionPendingRevision } from '../utils/pending/pendingRevisionTypes';
import { parsePendingMeta } from '../utils/pending/pendingMeta';

function operationOf(dto: MarkdownPendingRevisionDTO) {
  return parsePendingMeta(dto.metaJson, dto.operation).operation ?? 'update';
}

export function projectCanonicalPending(dto: MarkdownPendingRevisionDTO): CanonicalPendingSession {
  return { pendingId: dto.id, revision: dto.revision, blockId: dto.blockId,
    operation: operationOf(dto), revisionId: `ai-${dto.id}-${dto.revision}`,
    createdAt: dto.createdAt, projection: 'deferred' };
}

/** 将严格数据库 DTO 转成显示引擎输入；版本身份只在此处生成，显示引擎不重新定义 Pending。 */
export function mapWorkspacePendingToProjection(dto: MarkdownPendingRevisionDTO): ProjectionPendingRevision {
  return { id: `${dto.id}-${dto.revision}`, conversationId: '', blockId: dto.blockId,
    operation: operationOf(dto), originalMarkdown: null, newMarkdown: dto.newMarkdown,
    createdAt: dto.createdAt, metaJson: dto.metaJson };
}
