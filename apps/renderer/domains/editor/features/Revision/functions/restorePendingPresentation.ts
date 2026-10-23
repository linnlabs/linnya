import type { Node } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { preserveInlinePresentation } from '@linnya/markdown-domain/editing';

/** 在登记投影账本之前恢复呈现，使预览、部分决策和后端整块接受遵守同一规则。 */
export function restorePendingPresentation(tr: Transaction, baselines: ReadonlyMap<string, Node>): void {
  tr.doc.forEach((projected, position) => {
    const baseline = baselines.get(projected.attrs.id);
    if (!baseline) return;
    const restored = preserveInlinePresentation(baseline, projected);
    // 只改 marks，不改变 nodeSize，后续 root 的位置仍然有效。
    if (!restored.eq(projected)) tr.replaceWith(position, position + projected.nodeSize, restored);
  });
}
