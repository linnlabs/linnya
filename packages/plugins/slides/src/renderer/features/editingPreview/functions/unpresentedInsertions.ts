import { visitRenderNodes } from '@plugin/slides/shared/renderModel';
import type { SlideRenderModel } from '../../../types/render';
import type { EditingInsertionPreview } from '../definitions/editingInsertionPreview';

/** push 可能先呈现新节点、后结算队列；正式节点一旦可见就不再叠加同一待保存对象。 */
export function unpresentedInsertions(entries: readonly EditingInsertionPreview[], slide: SlideRenderModel): readonly EditingInsertionPreview[] {
  const presented = new Set<string>();
  visitRenderNodes(slide.elements, ({ node }) => { if (node.authoringRef) presented.add(node.authoringRef.editKey); });
  return entries.filter(entry => !presented.has(entry.object.editKey));
}
