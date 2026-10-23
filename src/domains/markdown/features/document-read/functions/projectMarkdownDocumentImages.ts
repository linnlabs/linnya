import {
  MarkdownImageAttrsSchema,
  markdownImageReference,
  readPendingMarkdownImage,
} from '@app/schemas';
import type { MarkdownDocJson } from '../../normalization';
import {
  parsePendingMetadata,
  resolvePendingOperation,
  type MarkdownPendingRevisionLike,
} from '../../pending-revisions';

/** 图片清单与正文使用同一份基线/Pending；卫星表不能代表尚未接受的 current。 */
export function projectMarkdownDocumentImages(
  content: MarkdownDocJson,
  pendings: readonly MarkdownPendingRevisionLike[]
) {
  const byRoot = new Map(pendings.map(pending => [pending.target_block_id, pending]));
  return content.content.flatMap(root => {
    const pending = typeof root.attrs?.id === 'string' ? byRoot.get(root.attrs.id) : undefined;
    const metadata = pending ? parsePendingMetadata(pending.meta_json) : null;
    if (pending && resolvePendingOperation(pending, metadata) === 'delete') return [];
    const node = root.content?.[0];
    const image = pending
      ? readPendingMarkdownImage(metadata)
      : node?.type === 'imageBlock'
        ? MarkdownImageAttrsSchema.parse(node.attrs)
        : null;
    if (!image) return [];
    return [
      {
        blockId: image.id,
        locator: markdownImageReference(image.id),
        ...(image.alt ? { alt: image.alt } : {}),
        ...(image.caption ? { caption: image.caption } : {}),
        ...(image.width !== null && image.height !== null
          ? { width: image.width, height: image.height }
          : {}),
      },
    ];
  });
}
