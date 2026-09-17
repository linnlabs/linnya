import { projectFontUnitAdvances } from '@linnya/text-measurement-core';
import { PPTX_DEFAULT_TEXT_INSET, layoutTextNode, prepareTextLayout, resolveTextLayoutContractFromNode, resizeTextBoxForAutoFit } from '../../src/shared/textLayout';
import type { TextRenderNode } from '../../src/shared/renderModel';
import type { FontMetricsProvider, RunAdvanceProvider } from '../../src/shared/textLayout';

/** 浏览器 smoke 的确定性字体事实；真实系统字体 shaping 单独由平台集成测试验证。 */
export const previewFixtureAdvances: RunAdvanceProvider = { getClusterAdvances(clusters, style) {
  const fontUnits = { unitsPerEm: 1000, advances: clusters.map((_, index) => index % 3 === 0 ? 721 : 439) };
  return { fontUnits, source: 'harfbuzz', advances: projectFontUnitAdvances(fontUnits, style.fontSizePt, style.letterSpacingPt) };
} };
export const previewFixtureMetrics: FontMetricsProvider = {
  getMetrics: style => ({ ascent: 0.8 * (style.fontSizePt / 72), descent: 0.2 * (style.fontSizePt / 72), lineGap: 0 }),
  getMetricsInEm: () => ({ ascent: 0.8, descent: 0.2, lineGap: 0 }),
};
export function preparePreviewFixture(node: TextRenderNode, profile: 'plain-textbox' | 'shape-inner-text'): TextRenderNode {
  node = { ...node, padding: node.padding ?? PPTX_DEFAULT_TEXT_INSET };
  const preparedTextLayout = prepareTextLayout(node, 'generated', 'Arial', previewFixtureAdvances, previewFixtureMetrics, profile);
  const contract = resolveTextLayoutContractFromNode(node, { sourceKind: 'generated', profile });
  const layout = layoutTextNode({ paragraphs: node.paragraphs, defaultFontFamily: 'Arial', contract }, previewFixtureAdvances, previewFixtureMetrics);
  const box = contract.autoFitPolicy === 'resize-shape' && layout.requiredHeightInches !== undefined
    ? resizeTextBoxForAutoFit(node.box, layout.requiredHeightInches, contract.verticalAlign) : node.box;
  return { ...node, box, layout, preparedTextLayout };
}
