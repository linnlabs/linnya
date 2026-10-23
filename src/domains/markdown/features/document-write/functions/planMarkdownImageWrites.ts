import { generateEditorBlockId } from 'src/shared/utils/idUtils';
import {
  MarkdownImageAttrsSchema,
  MarkdownImageInvalidError,
  hydrateMarkdownImage,
  readMarkdownImageReference,
  readPendingMarkdownImage,
  serializeMarkdownImage,
  type MarkdownImageAttrs,
} from '@app/schemas';
import type { MarkdownDocJson } from '../../normalization';
import { collectMarkdownImageSources } from '../../image-content';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';
import type { MarkdownBlockWriteStep } from '../definitions/markdownBlockWritePlan';

/** 先接纳整批，再分配出现位置身份；事务内不能写到一半才发现缺失图片。 */
export function planMarkdownImageWrites(params: {
  readonly target: MarkdownDocJson | null;
  readonly baseline: MarkdownDocJson;
  readonly pendings: readonly MarkdownPendingRevisionLike[];
  readonly steps: readonly MarkdownBlockWriteStep[];
  readonly admittedSources?: ReadonlyMap<string, MarkdownImageAttrs>;
}): ReadonlyMap<number, { readonly markdown: string; readonly image: MarkdownImageAttrs }> {
  const sources = new Map(collectMarkdownImageSources(params.baseline, params.pendings));
  for (const [id, source] of params.admittedSources ?? []) {
    if (sources.has(id)) throw new MarkdownImageInvalidError('新增图片身份与当前文档冲突。');
    sources.set(id, source);
  }
  const hydrated = new Map<number, MarkdownImageAttrs>();
  params.target?.content.forEach((root, index) => {
    const node = root.content?.[0];
    if (node?.type !== 'imageBlock') return;
    const input = MarkdownImageAttrsSchema.parse(node.attrs);
    const id = readMarkdownImageReference(input.src);
    hydrated.set(index, hydrateMarkdownImage(input, id ? (sources.get(id) ?? null) : null));
  });
  const result = new Map<number, { markdown: string; image: MarkdownImageAttrs }>();
  for (const step of params.steps) {
    if (step.kind !== 'insert' && step.kind !== 'update') continue;
    const source = hydrated.get(step.targetIndex);
    if (!source) continue;
    const rootId = step.kind === 'update' ? step.candidate.block.blockId : null;
    const original = params.baseline.content.find(root => root.attrs?.id === rootId)?.content?.[0];
    const pending = params.pendings.find(item => item.target_block_id === rootId);
    const current = readPendingMarkdownImage(
      pending?.meta_json ? JSON.parse(pending.meta_json) : null
    );
    // 只允许原位置保持身份。复制及重排是独立出现位置，接受/拒绝顺序不能制造重复 id。
    const sameOccurrence =
      (original?.type === 'imageBlock' && original.attrs?.id === source.id) ||
      current?.id === source.id;
    const image = { ...source, id: sameOccurrence ? source.id : generateEditorBlockId() };
    result.set(step.targetIndex, { image, markdown: serializeMarkdownImage(image) });
  }
  return result;
}
