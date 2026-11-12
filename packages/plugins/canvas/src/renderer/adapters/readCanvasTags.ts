import { CanvasTagsResultSchema, type CanvasTagsResult } from '@plugin/canvas/shared';
import { requestCanvasIpc } from './requestCanvasIpc';

/** 工作区现有标签与卡片上存的标签 ID 对应的当前名称。 */
export async function readCanvasTags(ids: readonly string[]): Promise<CanvasTagsResult> {
  return CanvasTagsResultSchema.parse(await requestCanvasIpc('canvas:tags', { ids }));
}
