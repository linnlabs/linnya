import { canvasTextPrefix } from '@plugin/canvas/shared';
import { type CanvasSelectionContextSchema } from '@plugin/canvas/shared';
import type { z } from 'zod';
import { canvasText } from '../../localization';
import { type CanvasSelectionReferenceMetadata } from '../definitions/canvasSelectionReference';
export function buildCanvasSelectionReference(
  metadata: CanvasSelectionReferenceMetadata,
  context: z.infer<typeof CanvasSelectionContextSchema>
) {
  const count = context.elementIds.length;
  return {
    deduplicationKey: `${metadata.documentId}:${[...metadata.elementIds].sort().join(',')}`,
    label: count
      ? canvasText('canvas.reference.cards', {
          count:
            count === metadata.originalCount
              ? count
              : canvasText('canvas.reference.partial', {
                  count,
                  original: metadata.originalCount,
                }),
        })
      : canvasText('canvas.reference.deleted'),
    text: context.text,
    previewText: canvasTextPrefix(context.text, 500),
    uri: context.path,
    // 引用对象身份固定；部分删除的剩余数量只作展示，撤销恢复后仍须重新读取原选区。
    metadata: { ...metadata, sequence: context.sequence },
  };
}
