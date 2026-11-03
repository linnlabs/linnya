import { CanvasCardIdSchema, type CanvasSelectionContextSchema } from '@plugin/canvas/shared';
import type { z } from 'zod';
import { type CanvasSelectionReferenceMetadata } from '../definitions/canvasSelectionReference';
export function buildCanvasSelectionReference(metadata: CanvasSelectionReferenceMetadata, context: z.infer<typeof CanvasSelectionContextSchema>) {
  const count = context.elementIds.length;
  if (!count) throw new Error('所选卡片已全部删除，请移除此引用');
  return {
    deduplicationKey: `${metadata.documentId}:${[...metadata.elementIds].sort().join(',')}`,
    label: `画布 · ${count === metadata.originalCount ? count : `${count}/${metadata.originalCount}`} 张卡`,
    text: context.text, previewText: context.text.slice(0, 500), uri: context.path,
    metadata: { ...metadata, elementIds: context.elementIds.map(id => CanvasCardIdSchema.parse(id)), sequence: context.sequence },
  };
}
