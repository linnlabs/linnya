/// <reference lib="es2022.intl" />
import { VisualTextLayoutSchema, type VisualColor, type VisualRect, type VisualTextLayout, type VisualDocumentVector } from './definitions';
import { readVisualFontFacts } from './readVisualFontFacts';
import { compositeVisualColor, parseVisualColor, type VisualParsedColor } from './visualColor';

function readColor(value: string): VisualParsedColor {
  const color = parseVisualColor(value);
  if (!color) throw new Error(`visual_color_unsupported:${value}`);
  return color;
}
function rgb(value: string): VisualColor {
  const color = readColor(value);
  if (color.alpha !== 1) throw new Error(`visual_opaque_color_required:${value}`);
  return color.rgb;
}
/** 半透明底色按 source-over 叠到下层实际底色上，得到肉眼看到的颜色。 */
function background(element: Element, root: HTMLElement, paper: VisualColor): VisualColor {
  const under = () => (element === root || !element.parentElement ? paper : background(element.parentElement, root, paper));
  const value = getComputedStyle(element).backgroundColor;
  if (value === 'transparent') return under();
  const color = readColor(value);
  if (color.alpha === 1) return color.rgb;
  return color.alpha === 0 ? under() : compositeVisualColor(color, under());
}
/** 文字与图标色若半透明，同样叠到它所在位置的实际底色上。 */
function visibleColors(element: Element, root: HTMLElement, paper: VisualColor, color: string) {
  const under = background(element, root, paper);
  return { color: compositeVisualColor(readColor(color), under), background: under };
}
function localRect(rect: DOMRect, origin: DOMRect): VisualRect {
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
}
function union(rectangles: readonly VisualRect[]): VisualRect {
  const x = Math.min(...rectangles.map(rect => rect.x)), y = Math.min(...rectangles.map(rect => rect.y));
  return { x, y, width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y };
}
function readStyle(element: Element, root: HTMLElement, paper: VisualColor, computed: CSSStyleDeclaration, text: string) {
  const font = readVisualFontFacts(computed);
  let fontAvailable: boolean;
  try { fontAvailable = document.fonts.check(font.fontQuery, text); }
  catch (error) {
    // 记录真实查询输入，不换字体/拼猜测fallback；定位后再按CSS FontFaceSet合同修正。
    console.error('[canvas visual font-query]', JSON.stringify({ element: element.tagName, ...font }));
    throw error;
  }
  return { ...font, lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing, direction: computed.direction,
    fontFeatureSettings: computed.fontFeatureSettings, fontVariationSettings: computed.fontVariationSettings,
    transform: computed.transform, visibility: computed.visibility, ...visibleColors(element, root, paper, computed.color),
    fontAvailable };
}
function firstLine(listItem: HTMLElement, origin: DOMRect): VisualRect {
  const walker = document.createTreeWalker(listItem, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest('li') !== listItem) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0);
    if (rect) return localRect(rect, origin);
  }
  throw new Error('visual_marker_first_line_missing');
}
function collectMarkers(root: HTMLElement, origin: DOMRect, paper: VisualColor): VisualTextLayout['graphemes'] {
  return Array.from(root.querySelectorAll<HTMLLIElement>('li')).flatMap((item, index) => {
    const itemStyle = getComputedStyle(item), list = item.parentElement;
    if (itemStyle.listStyleType === 'none') return [];
    if (!list || list.tagName !== 'UL' || itemStyle.listStyleType !== 'disc' || itemStyle.listStylePosition !== 'outside' || itemStyle.direction !== 'ltr')
      throw new Error('visual_marker_geometry_not_qualified');
    const paddingInlineStart = Number.parseFloat(getComputedStyle(list).paddingInlineStart);
    if (!(paddingInlineStart > 0)) throw new Error('visual_marker_gutter_missing');
    const listItem = localRect(item.getBoundingClientRect(), origin), line = firstLine(item, origin);
    // 原生::marker没有DOM Range；用真实li/ul布局分配槽分型记录，绝不伪造逐字簇边界。
    const rect = { x: listItem.x - paddingInlineStart, y: line.y, width: paddingInlineStart, height: line.height };
    return [{ id: `marker:${index}`, text: '::marker(disc)', geometryKind: 'marker-gutter', rects: [rect],
      style: readStyle(item, root, paper, getComputedStyle(item, '::marker'), '•'),
      marker: { listItem, list: localRect(list.getBoundingClientRect(), origin), firstLine: line, paddingInlineStart, position: 'outside', listStyleType: 'disc' } }];
  });
}

function readVectorPaint(element: Element, root: HTMLElement, paper: VisualColor): VisualDocumentVector['paint'] {
  const style = getComputedStyle(element);
  return { fill: style.fill, stroke: style.stroke, ...visibleColors(element, root, paper, style.color),
    strokeWidth: style.strokeWidth, strokeLinecap: style.strokeLinecap, strokeLinejoin: style.strokeLinejoin,
    strokeDasharray: style.strokeDasharray, strokeDashoffset: style.strokeDashoffset, vectorEffect: style.vectorEffect,
    opacity: style.opacity, fillOpacity: style.fillOpacity, strokeOpacity: style.strokeOpacity,
    transform: style.transform, visibility: style.visibility, filter: style.filter, clipPath: style.clipPath, maskImage: style.maskImage };
}
function collectDocumentVectors(root: HTMLElement, origin: DOMRect, paper: VisualColor): VisualTextLayout['vectors'] {
  // 只读取正式标签图标；SVG viewport来自真实DOM，不把路径bbox或失败像素当排版槽。
  return Array.from(root.querySelectorAll<SVGSVGElement>('[data-document-reference-icon] > svg[data-icon="document"]')).map((svg, index) => {
    const viewBox = svg.viewBox.baseVal;
    return { id: `document-icon:${index}`, geometryKind: 'document-reference-icon', rect: localRect(svg.getBoundingClientRect(), origin),
      viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
      preserveAspectRatio: svg.getAttribute('preserveAspectRatio'), transform: svg.getAttribute('transform'),
      childNames: Array.from(svg.children, child => child.localName), paint: readVectorPaint(svg, root, paper),
      paths: Array.from(svg.querySelectorAll<SVGPathElement>(':scope > path'), path => ({ d: path.getAttribute('d'),
        transform: path.getAttribute('transform'), paint: readVectorPaint(path, root, paper) })) };
  });
}

/** 只读真实排版；UTF-16索引来自Segmenter，emoji/连字不按等宽格或码点重排。 */
export function collectVisualTextLayout(root: HTMLElement, paperCss: string): VisualTextLayout {
  if (!root.isConnected || document.fonts.status !== 'loaded') throw new Error('visual_layout_not_ready');
  const origin = root.getBoundingClientRect(), paper = rgb(paperCss), graphemes: VisualTextLayout['graphemes'] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let nodeIndex = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    // KaTeX的辅助MathML被CSS裁成1px；可见HTML字形和SVG仍由像素比较负责。
    if (!element || element.closest('.katex-mathml')) continue;
    const computed = getComputedStyle(element), text = node.textContent ?? '';
    const nodeId = nodeIndex++;
    for (const segment of segmenter.segment(text)) {
      const range = document.createRange(); range.setStart(node, segment.index); range.setEnd(node, segment.index + segment.segment.length);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => localRect(rect, origin));
      if (!rects.length) continue;
      graphemes.push({ id: `${nodeId}:${segment.index}`, text: segment.segment, geometryKind: 'range', rects,
        style: readStyle(element, root, paper, computed, segment.segment) });
    }
  }
  graphemes.push(...collectMarkers(root, origin, paper));
  const lines: VisualTextLayout['lines'] = [];
  for (const grapheme of graphemes) for (const rect of grapheme.rects) {
    // 相同行盒按真实y/height合并；上下标、RTL和重叠连字保留自己的实际盒，不伪造字宽。
    const line = lines.find(item => Math.abs(item.rect.y - rect.y) < 0.01 && Math.abs(item.rect.height - rect.height) < 0.01);
    if (line) { line.rect = union([line.rect, rect]); line.graphemeIds.push(grapheme.id); }
    else lines.push({ id: `line:${lines.length}`, rect: { ...rect }, graphemeIds: [grapheme.id] });
  }
  return VisualTextLayoutSchema.parse({ version: 4, dpr: devicePixelRatio, fontsStatus: document.fonts.status,
    width: origin.width, graphemes, lines, vectors: collectDocumentVectors(root, origin, paper) });
}
