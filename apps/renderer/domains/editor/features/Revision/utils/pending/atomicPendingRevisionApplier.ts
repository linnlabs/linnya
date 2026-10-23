import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { markPendingRevisionProjectionTransaction } from '../../../../core/transactions/editorTransactionMeta';
import { useRevisionStore } from '../../useRevisionStore';
import { getParsedOperation } from './pendingOperation';
import { findRootBlockPosByIdInDoc } from './pendingRevisionHelpers';
import type { ApplyDetail } from './pendingRevisionTypes';
import type { ParsedPendingRevision } from './pendingRevisionTypes';

interface AtomicPendingItem<Plan> {
  readonly parsed: ParsedPendingRevision;
  readonly plan: Plan;
}
interface AtomicPendingResult {
  readonly success: boolean;
  readonly reason?: string;
  readonly diffStats?: { insertCount: number; deleteCount: number };
}

/** 原子块共享修订登记与事务边界；内容规则由各自的计划和投影函数提供。 */
export function applyAtomicPendingItems<Plan>(
  editor: Editor,
  items: readonly AtomicPendingItem<Plan>[],
  applyPlan: (tr: Transaction, pos: number, plan: Plan) => AtomicPendingResult
): ApplyDetail[] {
  if (items.length === 0) return [];

  const store = useRevisionStore(editor);
  const tr = editor.state.tr;
  const results: ApplyDetail[] = [];
  const registrations: Array<{
    item: AtomicPendingItem<Plan>;
    diffStats: { insertCount: number; deleteCount: number };
  }> = [];

  for (const item of items) {
    const { parsed, plan } = item;
    const operation = getParsedOperation(parsed);
    const fail = (reason: string) =>
      results.push({ id: parsed.id, success: false, operation, blockId: parsed.blockId, reason });

    if (!parsed.blockId) {
      fail(`${operation} 操作缺少 blockId`);
      continue;
    }
    const pos = findRootBlockPosByIdInDoc(tr.doc, parsed.blockId);
    if (pos === null) {
      fail(`未找到 blockId=${parsed.blockId} 对应的 rootBlock，可能已被删除`);
      continue;
    }

    const result = applyPlan(tr, pos, plan);
    if (!result.success) {
      fail(result.reason ?? '原子块 Pending 应用失败');
      continue;
    }
    results.push({
      id: parsed.id,
      success: true,
      operation,
      blockId: parsed.blockId,
      ...(result.reason ? { reason: result.reason } : {}),
    });
    if (
      result.diffStats &&
      (result.diffStats.insertCount > 0 || result.diffStats.deleteCount > 0)
    ) {
      registrations.push({ item, diffStats: result.diffStats });
    }
  }

  markPendingRevisionProjectionTransaction(tr);
  if (tr.docChanged) editor.view.dispatch(tr);

  for (const { item, diffStats } of registrations) {
    const { parsed } = item;
    if (!parsed.blockId) continue;
    store.startRevision({
      blockId: parsed.blockId,
      revisionId: `ai-${parsed.id}`,
      operation: getParsedOperation(parsed),
      diffStats,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    });
  }
  return results;
}
