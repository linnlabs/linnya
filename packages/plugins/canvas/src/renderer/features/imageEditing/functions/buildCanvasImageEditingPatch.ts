import type { CanvasImageDraft } from '../definitions/canvasImageEditing';
import { fullCanvasImageCrop } from './canvasImageCrop';
/** 改可见范围时保留源图在世界坐标的比例/位置；替换新图以当前卡片框作为完整范围。 */
export function buildCanvasImageEditingPatch(draft: CanvasImageDraft) {
  const previous = draft.card.data.assetId === draft.data.assetId ? draft.card.data.crop ?? fullCanvasImageCrop : fullCanvasImageCrop;
  const next = draft.data.crop ?? fullCanvasImageCrop;
  const width = draft.card.width / previous.width, height = draft.card.height / previous.height;
  return { data: draft.data, x: draft.card.x + (next.x - previous.x) * width, y: draft.card.y + (next.y - previous.y) * height, width: width * next.width, height: height * next.height };
}
export function canvasImageReplacementData(draft: CanvasImageDraft, assetId: string) { return { ...draft.data, assetId, crop: null }; }
