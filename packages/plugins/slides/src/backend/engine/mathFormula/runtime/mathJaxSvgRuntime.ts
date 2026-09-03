import { createHash } from 'node:crypto';
import { MathJaxStix2Font } from '@mathjax/mathjax-stix2-font/js/svg.js';
import { LiteElement } from '@mathjax/src/js/adaptors/lite/Element.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { MathML } from '@mathjax/src/js/input/mathml.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import type {
  MathJaxSvgRuntimeProjection,
  MathJaxSvgRuntimeRequest,
} from '../definitions/mathJaxSvgRuntime';

const NO_LINE_BREAK_WIDTH = '100000em';
const ALT_TEXT_PLACEHOLDER = 'SLIDES_MATH_FORMULA_ALT_TEXT';

const formulaAdaptor = liteAdaptor();
RegisterHTMLHandler(formulaAdaptor);

/**
 * 这是 MathJax/STIX2 的唯一技术 adapter。它不理解 Slides source、canonical IR
 * 或领域错误，只把内部 MathML 同步排版为自包含路径 SVG。
 */
const formulaMathDocument = mathjax.document('', {
  InputJax: new MathML(),
  OutputJax: new SVG({
    fontCache: 'local',
    fontData: MathJaxStix2Font,
    displayOverflow: 'overflow',
    linebreaks: {
      inline: false,
      width: NO_LINE_BREAK_WIDTH,
    },
  }),
});

export function renderMathMlToSvg(request: MathJaxSvgRuntimeRequest): MathJaxSvgRuntimeProjection {
  const container = formulaMathDocument.convert(request.mathMl, {
    display: request.display,
    em: 16,
    ex: 8,
    containerWidth: Number.POSITIVE_INFINITY,
  });
  const svgNodes = formulaAdaptor.childNodes(container).filter(
    (node): node is LiteElement => node instanceof LiteElement && formulaAdaptor.kind(node) === 'svg',
  );
  if (svgNodes.length !== 1) {
    throw new Error(`MathJax 应只产生一个 SVG，实际为 ${svgNodes.length} 个。`);
  }
  const svgNode = svgNodes[0];
  if (!svgNode) throw new Error('MathJax 没有产生 SVG 根节点。');

  const contentViewBox = parseViewBox(formulaAdaptor.getAttribute(svgNode, 'viewBox'));
  const viewBox = {
    x: round(contentViewBox.x - request.paddingUnits),
    y: round(contentViewBox.y - request.paddingUnits),
    width: round(contentViewBox.width + request.paddingUnits * 2),
    height: round(contentViewBox.height + request.paddingUnits * 2),
  };
  formulaAdaptor.setAttribute(svgNode, 'viewBox', serializeViewBox(viewBox));
  formulaAdaptor.setAttribute(svgNode, 'width', `${round(viewBox.width / 1_000)}em`);
  formulaAdaptor.setAttribute(svgNode, 'height', `${round(viewBox.height / 1_000)}em`);
  formulaAdaptor.setAttribute(svgNode, 'role', 'img');
  // LiteAdaptor.outerHTML 会处理引号与 &，但不会转义 attribute 中的 “<”。
  // 先写入稳定占位，再在序列化结果中注入完整 XML 转义后的说明，避免双重转义。
  formulaAdaptor.setAttribute(svgNode, 'aria-label', ALT_TEXT_PLACEHOLDER);
  formulaAdaptor.removeAttribute(svgNode, 'style');
  formulaAdaptor.removeAttribute(svgNode, 'focusable');

  const stableId = createHash('sha256').update(request.mathMl).digest('hex').slice(0, 12);
  const canonicalSvg = formulaAdaptor.outerHTML(svgNode)
    .replace(
      `aria-label="${ALT_TEXT_PLACEHOLDER}"`,
      `aria-label="${escapeXmlAttribute(request.altText)}"`,
    )
    .replace(/currentColor/gu, request.color)
    .replace(/MJX-\d+-/gu, `MJX-${stableId}-`);

  return { canonicalSvg, viewBox, contentViewBox };
}

function parseViewBox(value: unknown): MathJaxSvgRuntimeProjection['viewBox'] {
  if (typeof value !== 'string') throw new Error('MathJax SVG 缺少 viewBox。');
  const values = value.trim().split(/\s+/u).map(Number);
  if (
    values.length !== 4
    || values.some((entry) => !Number.isFinite(entry))
    || (values[2] ?? 0) <= 0
    || (values[3] ?? 0) <= 0
  ) {
    throw new Error(`MathJax SVG viewBox 无效：${value}`);
  }
  const [x = 0, y = 0, width = 0, height = 0] = values;
  return { x, y, width, height };
}

function serializeViewBox(viewBox: MathJaxSvgRuntimeProjection['viewBox']): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
