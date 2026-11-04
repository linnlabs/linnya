import { VISUAL_NEGATIVES, type VisualNegative, type VisualTextLayout } from './definitions';
import { evaluateVisualTextOracle } from './evaluateVisualTextOracle';

type Comparison = Parameters<typeof evaluateVisualTextOracle>[0];
export function visualTextEnvironment(layout: VisualTextLayout) {
  return JSON.stringify({ dpr: layout.dpr, width: layout.width,
    graphemes: layout.graphemes.map(grapheme => {
      // 色纸/主题允许角色色变化；字体、内容、实际字簇几何与DPR必须和反例资格完全一致。
      const { fontShorthand, fontFamily, fontSize, fontStyle, fontWeight, fontStretch, fontVariantNumeric, fontQuery, fontAvailable,
        lineHeight, letterSpacing, direction, fontFeatureSettings, fontVariationSettings, transform, visibility } = grapheme.style;
      return { text: grapheme.text, geometryKind: grapheme.geometryKind, rects: grapheme.rects,
        ...(grapheme.geometryKind === 'marker-gutter' ? { marker: grapheme.marker } : {}),
        style: { fontShorthand, fontFamily, fontSize, fontStyle, fontWeight, fontStretch, fontVariantNumeric, fontQuery, fontAvailable,
          lineHeight, letterSpacing, direction, fontFeatureSettings, fontVariationSettings, transform, visibility } };
    }) });
}

/** 反例必须由像素本身拒绝，不能借source/样式metadata不同就宣称检测到了缺字。 */
export async function verifyVisualTextNegatives(capture: (negative: VisualNegative) => Promise<Comparison>) {
  const reports = [];
  let referenceEnvironment: string | null = null;
  for (const negative of VISUAL_NEGATIVES) {
    const input = await capture(negative), current = visualTextEnvironment(input.layout.reference);
    const qualifiedEnvironment = referenceEnvironment === null || referenceEnvironment === current;
    if (referenceEnvironment === null) referenceEnvironment = current;
    const oracle = evaluateVisualTextOracle(input);
    reports.push({ negative, qualifiedEnvironment, rasterRejected: !oracle.raster.pass, pixiRejected: !oracle.pixi.pass, oracle });
  }
  return { pass: reports.length === VISUAL_NEGATIVES.length && reports.every(report => report.qualifiedEnvironment && report.rasterRejected && report.pixiRejected),
    referenceEnvironment, reports };
}
