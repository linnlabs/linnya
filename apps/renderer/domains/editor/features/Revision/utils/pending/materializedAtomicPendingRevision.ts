import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { applyAtomicPendingItems } from './atomicPendingRevisionApplier';
import { executePendingPlanToTr, type PendingExecutionPlan } from './pendingExecutionPlan';
import { classifyPendingMarkdownTopLevelBlock } from './pendingMarkdownRuntime';
import { canResolvePendingMarkdownAsPlainTextFastPath } from './pendingPlainTextFastPath';
import { findRootBlockPosByIdInDoc, materializeAtomicContentBlock } from './pendingRevisionHelpers';
import { getParsedOperation } from './pendingOperation';
import type { ApplyDetail, ParsedPendingRevision } from './pendingRevisionTypes';

interface AtomicItem {
  readonly parsed: ParsedPendingRevision;
  readonly plan: Extract<PendingExecutionPlan, { kind: 'block-replace' | 'block-remove' }>;
}

/** 图表和图片已由各自准入处理；其余原子块统一物化，多块/未知类型在任何文档改动前失败。 */
export async function partitionMaterializedAtomicPendingRevisions(doc: ProseMirrorNode, revisions: readonly ParsedPendingRevision[]) {
  const items: AtomicItem[] = [];
  const others: ParsedPendingRevision[] = [];
  const failures: ApplyDetail[] = [];
  for (const parsed of revisions) {
    const operation = getParsedOperation(parsed);
    if (operation === 'delete') {
      const position = parsed.blockId ? findRootBlockPosByIdInDoc(doc, parsed.blockId) : null;
      const current = position === null ? null : doc.nodeAt(position)?.firstChild;
      if (current?.type.name === 'latexBlock' || current?.type.name === 'horizontalRuleBlock') {
        items.push({ parsed, plan: { kind: 'block-remove' } });
      } else others.push(parsed);
      continue;
    }
    const markdown = parsed.newMarkdown ?? '';
    if (canResolvePendingMarkdownAsPlainTextFastPath(markdown)) {
      others.push(parsed);
      continue;
    }
    try {
      const classification = await classifyPendingMarkdownTopLevelBlock(markdown, { operation, blockId: parsed.blockId ?? undefined });
      if (classification.status === 'atomic-block') {
        items.push({ parsed, plan: { kind: 'block-replace', contentBlock: materializeAtomicContentBlock(doc.type.schema, classification.event) } });
      } else if (classification.status === 'multiple-meaningful-blocks' || classification.status === 'unsupported-single-block') {
        throw new Error(classification.status === 'multiple-meaningful-blocks'
          ? `Pending 必须对应一个 rootBlock，实际为 ${classification.totalBlocks}`
          : `Pending 不支持的块类型：${classification.blockType}`);
      } else others.push(parsed);
    } catch (error) {
      failures.push({ id: parsed.id, blockId: parsed.blockId, operation, success: false,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { items, others, failures };
}

export function applyMaterializedAtomicPendingItems(editor: Editor, items: readonly AtomicItem[]) {
  return applyAtomicPendingItems(editor, items, (tr, blockPos, plan) =>
    executePendingPlanToTr({ tr, blockPos, plan, revisionId: 'atomic' }));
}
