import { type CanvasSelectionContextSchema } from '@plugin/canvas/shared';
import type { z } from 'zod';
import { type CanvasSelectionReferenceMetadata } from '../definitions/canvasSelectionReference';
export function buildCanvasSelectionReference(metadata: CanvasSelectionReferenceMetadata, context: z.infer<typeof CanvasSelectionContextSchema>) {
  const count = context.elementIds.length;
  return {
    deduplicationKey: `${metadata.documentId}:${[...metadata.elementIds].sort().join(',')}`,
    label: count ? `画布 · ${count === metadata.originalCount ? count : `${count}/${metadata.originalCount}`} 张卡` : '画布 · 已删除',
    text: context.text, previewText: context.text.slice(0, 500), uri: context.path,
    // 引用对象身份固定；部分删除的剩余数量只作展示，撤销恢复后仍须重新读取原选区。
    metadata: { ...metadata, sequence: context.sequence },
  };
}
