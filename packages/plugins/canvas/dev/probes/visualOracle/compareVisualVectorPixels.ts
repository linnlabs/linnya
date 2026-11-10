import { VISUAL_TEXT_LIMITS, type VisualImage, type VisualMonochromePixels, type VisualTextLayout } from './definitions';
import { qualifiesDocumentVector } from './documentVectorModel';
import { readVisualPixelRegion, visualPixelRegionFailures } from './visualPixelRegion';

/** 独立图形区域仍接受非空/覆盖/位置/颜色/结构检查，不能仅凭metadata相同通过。 */
export function compareVisualVectorPixels(input: { reference: VisualImage; actual: VisualImage; mask: Uint8Array;
  monochrome: VisualMonochromePixels; layout: VisualTextLayout }) {
  return input.layout.vectors.map(vector => {
    const qualified = qualifiesDocumentVector(vector);
    const facts = readVisualPixelRegion({ ...input, rect: vector.rect, dpr: input.layout.dpr,
      foreground: vector.paint.color, background: vector.paint.background, projectAlpha: qualified });
    return { id: vector.id, geometryKind: vector.geometryKind, qualified, ...facts,
      failures: [...(qualified ? [] : ['unqualified_document_vector']), ...visualPixelRegionFailures(facts, VISUAL_TEXT_LIMITS.graphemeResidualRatio)] };
  });
}
