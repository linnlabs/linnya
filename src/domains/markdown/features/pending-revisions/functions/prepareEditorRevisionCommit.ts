import type { MarkdownRevisionCommit } from '@app/schemas';
import { parseMarkdownDocJson, validateMarkdownDocJson, type MarkdownDocJson, type ProseMirrorJsonNode } from '../../normalization/runtime';
import type { PendingRevision } from '../definitions/pendingRevision';
import { isEmptyPendingPlaceholder, parsePendingMetadata, resolvePendingOperation } from './pendingRevisionApplyRules';

/** 通用 PM schema 可描述显示标记，但提交合同只能接收正文，不能把投影视图存成下一次基线。 */
function assertRevisionFreeBaseline(node: ProseMirrorJsonNode): void {
  if (node.marks?.some(mark => mark.type === 'revisionMark')) {
    throw new Error('提交正文仍包含修订显示标记，请重新同步文档后重试。');
  }
  node.content?.forEach(assertRevisionFreeBaseline);
}

export function prepareEditorRevisionCommit(request: MarkdownRevisionCommit, stored: MarkdownDocJson, pendings: PendingRevision[]) {
  const baseline = validateMarkdownDocJson(parseMarkdownDocJson(request.baseline));
  assertRevisionFreeBaseline(baseline);
  const decision = request.decision;
  const selected = decision ? pendings.filter(pending => !decision.blockId || pending.target_block_id === decision.blockId) : [];
  if (decision?.blockId && selected.length !== 1) throw new Error('待处理修订已不存在，请刷新后重试。');
  if (decision?.mode === 'accept') {
    const storedById = new Map(stored.content.map(root => [root.attrs?.id, root]));
    const draftById = new Map(baseline.content.map(root => [root.attrs?.id, root]));
    for (const pending of selected) {
      const before = storedById.get(pending.target_block_id), draft = draftById.get(pending.target_block_id);
      if (!before) throw new Error(`待处理修订的目标块不存在: ${pending.target_block_id}`);
      if (!draft || JSON.stringify(before.content) !== JSON.stringify(draft.content)) {
        throw new Error('本地编辑与待接受的修订在同一块重叠，请先保存本地编辑或处理冲突。');
      }
    }
  }
  return { baseline, selected, decision };
}

/** 部分处理会改变剩余意图：接受部分 insert 后块已成为正文，拒绝部分 delete 后也不能再整块删。 */
export function remainingRevisionMetadata(pending: PendingRevision, baseline: MarkdownDocJson, markdown: string) {
  const metadata = parsePendingMetadata(pending.meta_json);
  const previous = resolvePendingOperation(pending, metadata);
  const root = baseline.content.find(item => item.attrs?.id === pending.target_block_id);
  const operation = previous === 'insert' && isEmptyPendingPlaceholder(root) ? 'insert'
    : previous === 'delete' && markdown.length === 0 ? 'delete' : 'update';
  return { ...metadata, operation };
}

/** 部分操作的最后一步与块级决策保持相同结构语义，不能留下被取消的占位块。 */
export function finalizeResolvedRevisionBaseline(
  baseline: MarkdownDocJson,
  selected: readonly PendingRevision[],
  decision: MarkdownRevisionCommit['decision'],
): MarkdownDocJson {
  if (decision?.mode !== 'resolve' || decision.remainingMarkdown !== null) return baseline;
  const pending = selected[0];
  if (!pending) throw new Error('Missing resolved Pending');
  const operation = resolvePendingOperation(pending, parsePendingMetadata(pending.meta_json));
  if (operation === 'update') return baseline;
  return { ...baseline, content: baseline.content.filter(root => {
    if (root.attrs?.id !== pending.target_block_id) return true;
    return !isEmptyPendingPlaceholder(root);
  }) };
}

/** 本地输入保存到新增占位块后，该块已拥有正文；剩余提议必须转成 update，拒绝不能再整块删除。 */
export function promotePendingInserts(baseline: MarkdownDocJson, pendings: readonly PendingRevision[]) {
  const roots = new Map(baseline.content.map(root => [root.attrs?.id, root]));
  return pendings.flatMap(pending => {
    const metadata = parsePendingMetadata(pending.meta_json);
    const root = roots.get(pending.target_block_id);
    return resolvePendingOperation(pending, metadata) === 'insert' && root && !isEmptyPendingPlaceholder(root)
      ? [{ pending, metadata: { ...metadata, operation: 'update' as const } }] : [];
  });
}
