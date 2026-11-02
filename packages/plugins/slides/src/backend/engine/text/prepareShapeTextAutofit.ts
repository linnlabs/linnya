import type { DeckSpec, FreeformElement } from '@plugin/slides/shared';
import { resolveSlideSizeInches, visitRenderNodes } from '@plugin/slides/shared';
import { RenderModelMapper } from '../parser/RenderModelMapper';
import {
  applyTextLayoutToRenderModel,
  prewarmTextLayoutForRenderModel,
} from './renderModelTextLayout';
import type { ShapeTextAutofitLayouts } from './shapeTextAutofitPptx';

/** 保留组的完整边界，只剔除与形状文字无关的内容，避免加载图片、SVG 或公式。 */
function shapeMeasurementElement(element: FreeformElement): FreeformElement {
  if (element.type === 'group')
    return { ...element, children: element.children?.map(shapeMeasurementElement) };
  if (element.type === 'shape') return element;
  return { type: 'shape', geometry: 'rect', position: element.position };
}

/** Host 已装配正式字体能力；Worker 只接收标量结果，不加载字体或重新估算。 */
export async function prepareShapeTextAutofit(deck: DeckSpec): Promise<ShapeTextAutofitLayouts> {
  const measurementDeck: DeckSpec = {
    ...deck,
    slides: deck.slides.map(slide => ({
      ...slide,
      spec:
        slide.spec.type === 'freeform'
          ? { type: 'freeform', elements: slide.spec.elements.map(shapeMeasurementElement) }
          : { type: 'structured', elements: [] },
    })),
  };
  const model = new RenderModelMapper().fromGeneratedDeck(
    'shape-autofit',
    1,
    deck.title,
    measurementDeck,
    resolveSlideSizeInches(deck.layout)
  );
  const options = { prepareEditingMeasurements: false };
  await prewarmTextLayoutForRenderModel(model, undefined, options);
  applyTextLayoutToRenderModel(model, undefined, undefined, options);
  return model.slides.map(slide => {
    const layouts: { fontScale: number; lineSpacingReduction: number }[] = [];
    visitRenderNodes(slide.elements, ({ node }) => {
      if (node.kind !== 'shape' || !node.innerText) return;
      const text = node.innerText.paragraphs
        .map(paragraph => paragraph.runs.map(run => ('text' in run ? run.text : '')).join(''))
        .join('\n');
      if (text.length === 0) return;
      const layout = node.innerText.layout;
      if (!layout) throw new Error('Shape text layout is missing after finalization');
      layouts.push({
        fontScale: layout.appliedFontScale,
        lineSpacingReduction: layout.appliedLineSpacingReduction,
      });
    });
    return layouts;
  });
}
