import type { CanvasCardId, CanvasSynchronization } from '@plugin/canvas/shared';
export interface CanvasEvaluationCommitScope {
  readonly sequence: number;
  readonly cards: readonly { readonly id: CanvasCardId; readonly revision: number }[];
  readonly deletedCardIds: readonly CanvasCardId[];
}
/** 只用实际连续delta归属变更，不能把整份snapshot差异归到其中某一次提交。 */
export function readCanvasEvaluationCommitScopes(update: CanvasSynchronization): readonly CanvasEvaluationCommitScope[] {
  if (update.kind !== 'delta') return [];
  return update.commits.map(commit => {
    // add+arrange可以在同一事务多次改变同一卡；可见交集按最终版本唯一计数。
    const changes = [...new Map(commit.changes.map(change => [change.id, change])).values()];
    return { sequence: commit.sequence,
      cards: changes.flatMap(change => change.after && change.after.type !== 'edge' ? [{ id: change.after.id, revision: change.after.revision }] : []),
      deletedCardIds: changes.flatMap(change => !change.after && change.before && change.before.type !== 'edge' ? [change.before.id] : []),
    };
  });
}
