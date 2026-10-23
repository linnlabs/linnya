import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import {
  admitMarkdownImageEvent,
  hydrateMarkdownImage,
  readPendingMarkdownImage,
  type MarkdownImageAttrs,
} from '@app/schemas';
import { parseMarkdownToBlockEvents } from '../../../../services/markdownRuntime';
import { applyAtomicPendingItems } from './atomicPendingRevisionApplier';
import { getParsedOperation } from './pendingOperation';
import { findRootBlockPosByIdInDoc } from './pendingRevisionHelpers';
import { isIgnorableBlockEvent } from './pendingMarkdownRuntime';
import type { ParsedPendingRevision } from './pendingRevisionTypes';

type ImagePlan =
  | { readonly kind: 'put'; readonly image: MarkdownImageAttrs }
  | { readonly kind: 'remove' }
  | { readonly kind: 'invalid'; readonly reason: string };
interface ImageItem {
  readonly parsed: ParsedPendingRevision;
  readonly plan: ImagePlan;
}

export async function partitionImagePendingRevisions(
  doc: ProseMirrorNode,
  revisions: readonly ParsedPendingRevision[]
) {
  const imageItems: ImageItem[] = [];
  const others: ParsedPendingRevision[] = [];
  for (const parsed of revisions) {
    if (getParsedOperation(parsed) === 'delete') {
      const pos = parsed.blockId ? findRootBlockPosByIdInDoc(doc, parsed.blockId) : null;
      if (pos !== null && doc.nodeAt(pos)?.firstChild?.type.name === 'imageBlock') {
        imageItems.push({ parsed, plan: { kind: 'remove' } });
        continue;
      }
    } else if (parsed.newMarkdown?.includes('![')) {
      try {
        const events = (await parseMarkdownToBlockEvents(parsed.newMarkdown)).filter(
          event => !isIgnorableBlockEvent(event)
        );
        const event = events.length === 1 ? events[0] : null;
        const input = event ? admitMarkdownImageEvent(event) : null;
        if (input) {
          const image = hydrateMarkdownImage(input, readPendingMarkdownImage(parsed.metadata));
          imageItems.push({ parsed, plan: { kind: 'put', image } });
          continue;
        }
      } catch (error) {
        // 旧客户端或损坏快照只使该修订失败，不能阻断整批预览或退回文本 diff。
        imageItems.push({
          parsed,
          plan: { kind: 'invalid', reason: error instanceof Error ? error.message : String(error) },
        });
        continue;
      }
    }
    others.push(parsed);
  }
  return { imageItems, others };
}

function applyImagePlan(tr: Transaction, pos: number, plan: ImagePlan) {
  if (plan.kind === 'invalid') return { success: false, reason: plan.reason };
  if (plan.kind === 'remove')
    return { success: true, diffStats: { insertCount: 0, deleteCount: 1 } };
  const root = tr.doc.nodeAt(pos);
  const current = root?.firstChild;
  const imageType = tr.doc.type.schema.nodes.imageBlock;
  if (!current || root?.type.name !== 'rootBlock' || !imageType)
    return { success: false, reason: '图片目标块不存在' };
  const next = imageType.create(plan.image);
  if (next.eq(current)) return { success: true };
  tr.replaceWith(pos + 1, pos + 1 + current.nodeSize, next);
  return {
    success: true,
    diffStats: { insertCount: 1, deleteCount: current.isAtom || current.content.size > 0 ? 1 : 0 },
  };
}

export function applyImagePendingItems(editor: Editor, items: readonly ImageItem[]) {
  return applyAtomicPendingItems(editor, items, applyImagePlan);
}
