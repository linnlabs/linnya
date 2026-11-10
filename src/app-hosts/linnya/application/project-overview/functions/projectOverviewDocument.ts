import type { ProjectOverviewActor, ProjectOverviewDocument } from '@app/schemas';
import type { ActionActorKind, ActionLedgerDocumentSummary } from 'src/domains/action-ledger';
import type { WorkspaceProjectDocument } from 'src/features/workspace/vfs';

/**
 * 账本时间与节点时间不是同一时刻写下的（节点先更新，账本随后登记），
 * 相差在这个范围内视为同一次改动。
 */
export const LEDGER_EXPLAINS_CHANGE_TOLERANCE_MS = 2_000;

/** 主运行和子运行都是 Linnya 自己的 Agent。 */
export function toProjectOverviewActor(kind: ActionActorKind): ProjectOverviewActor {
  switch (kind) {
    case 'run':
    case 'subrun':
      return 'linnya_ai';
    case 'user':
      return 'user';
    case 'external':
      return 'external';
    case 'plugin':
      return 'plugin';
  }
}

/**
 * 合成一行。最近修改取账本与节点时间中较晚的一个；只有账本那条足以解释最近这次改动时才写“谁改的”，
 * 例如插件文档里用户自己的编辑还没有入账，此时只给时间。
 */
export function projectOverviewDocument(input: {
  readonly document: WorkspaceProjectDocument;
  readonly summary: ActionLedgerDocumentSummary | undefined;
  readonly conversationTitles: ReadonlyMap<string, string>;
  readonly pendingRevisionCount: number | null;
  readonly tags: readonly { readonly id: string; readonly name: string }[];
}): ProjectOverviewDocument {
  const { document, summary } = input;
  const ledgerAt = summary?.last.recordedAt ?? null;
  const lastModifiedAt = Math.max(document.updatedAt, ledgerAt ?? 0);
  const ledgerExplainsLast = ledgerAt !== null
    && ledgerAt >= document.updatedAt - LEDGER_EXPLAINS_CHANGE_TOLERANCE_MS;
  const creator = summary?.creator ?? null;
  const conversationId = creator?.conversationId ?? null;
  const conversationTitle = conversationId === null ? undefined : input.conversationTitles.get(conversationId);
  return {
    document_id: document.id,
    node_type: document.type,
    title: document.title,
    parent_id: document.parentId,
    location: [...document.location],
    created_at: document.createdAt,
    creator: creator === null
      ? null
      : {
          actor: toProjectOverviewActor(creator.actorKind),
          plugin_id: creator.pluginId,
          // 对话已删除或不再属于本项目时，不给出无法打开的对话。
          conversation_id: conversationTitle === undefined ? null : conversationId,
          conversation_title: conversationTitle ?? null,
        },
    last_modified_at: lastModifiedAt,
    last_modified_by: summary && ledgerExplainsLast
      ? { actor: toProjectOverviewActor(summary.last.actorKind), plugin_id: summary.last.pluginId }
      : null,
    pending_revision_count: input.pendingRevisionCount,
    tags: input.tags.map(tag => ({ id: tag.id, name: tag.name })),
  };
}
