import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import type JSZip from 'jszip';
import { directChildren, getElementByTag, getElements } from '../parser/xml/XmlNode';
import { stripHash } from '../visual/presentationVisualDefaults';
import type { ChartPptxPatch } from './chartPptx';
import { resolvePptxPartTarget } from '../pptx/pptxPartPath';

/** 原生 series/dPt 后处理：只补 SDK 缺少的细粒度样式，不重建图表或工作簿。 */
export async function applyChartPptxStyles(zip: JSZip, plan: readonly ChartPptxPatch[] = []): Promise<boolean> {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const read = async (path: string): Promise<Document> => {
    const file = zip.file(path);
    if (!file) throw new Error(`Chart materialization: missing ${path}`);
    return parser.parseFromString(await file.async('text'), 'application/xml');
  };
  for (const patch of plan) {
    const slidePath = `ppt/slides/slide${patch.slideIndex + 1}.xml`;
    const slide = await read(slidePath);
    const frames = getElements(slide, 'p:graphicFrame').filter(frame => getElementByTag(frame, 'p:cNvPr')?.getAttribute('name') === patch.marker);
    if (frames.length !== 1) throw new Error(`Chart materialization: expected one marker ${patch.marker}`);
    const id = getElementByTag(frames[0], 'c:chart')?.getAttribute('r:id');
    const rels = await read(`ppt/slides/_rels/slide${patch.slideIndex + 1}.xml.rels`);
    const relation = getElements(rels, 'Relationship').find(rel => rel.getAttribute('Id') === id);
    const target = relation?.getAttribute('Target');
    if (!target) throw new Error(`Chart materialization: missing relationship for ${patch.marker}`);
    const chartPath = resolvePptxPartTarget(slidePath, target);
    const chart = await read(chartPath);
    const series = getElements(chart, 'c:ser');
    if (series.length !== patch.series.length) throw new Error('Chart materialization: series cardinality changed');
    patch.series.forEach((entry, index) => {
      const candidates = series.filter(ser => child(ser, 'c:idx')?.getAttribute('val') === String(index));
      if (candidates.length !== 1) throw new Error(`Chart materialization: missing series ${index}`);
      const ser = candidates[0];
      const source = entry.source;
      const order = child(ser, 'c:order');
      if (order) order.setAttribute('val', String(entry.order));
      if (source.lineWidth != null || source.lineDash) {
        const props = child(ser, 'c:spPr');
        if (!props) throw new Error('Chart materialization: missing series shape properties');
        const line = ensure(chart, props, 'a:ln');
        if (source.lineWidth != null) line.setAttribute('w', String(Math.round(source.lineWidth * 12700)));
        if (source.lineDash) ensure(chart, line, 'a:prstDash').setAttribute('val', source.lineDash === 'dot' ? 'sysDot' : source.lineDash);
      }
      if (entry.type === 'line') {
        const marker = child(ser, 'c:marker');
        if (!marker) throw new Error('Chart materialization: missing line marker');
        if (source.marker) ensure(chart, marker, 'c:symbol').setAttribute('val', source.marker);
        // SDK 对组合图 marker 的颜色按全局 idx 取 palette，必须与当前系列颜色一致。
        const props = child(marker, 'c:spPr');
        if (props) for (const color of getElements(props, 'a:srgbClr')) color.setAttribute('val', entry.color);
      }
      source.pointColors?.forEach((color, i) => {
        if (color == null) return;
        let point = directChildren(ser, 'c:dPt').find(p => child(p, 'c:idx')?.getAttribute('val') === String(i));
        if (!point) {
          point = chart.createElement('c:dPt');
          ensure(chart, point, 'c:idx').setAttribute('val', String(i));
          const before = firstOf(ser, ['c:dLbls', 'c:trendline', 'c:errBars', 'c:cat', 'c:val']);
          ser.insertBefore(point, before);
        }
        const props = ensure(chart, point, 'c:spPr');
        const fill = ensure(chart, props, 'a:solidFill');
        ensure(chart, fill, 'a:srgbClr').setAttribute('val', stripHash(color, 'series.pointColors'));
      });
      if (source.showDataLabels != null || source.dataLabelFormat != null || patch.labelPosition || patch.labelContent) {
        let labels = child(ser, 'c:dLbls');
        if (!labels) {
          // 保留 SDK 生成的组级字号/颜色，再覆盖系列语义，不制造第二套默认样式。
          const groupLabels = getElements(chart, 'c:dLbls').find(l => l.parentNode === ser.parentNode);
          labels = chart.createElement('c:dLbls');
          if (groupLabels) for (let i = 0; i < groupLabels.childNodes.length; i++) {
            const node = groupLabels.childNodes.item(i);
            if (node) labels.appendChild(node.cloneNode(true));
          }
          ser.insertBefore(labels, firstOf(ser, ['c:trendline', 'c:errBars', 'c:cat', 'c:val']));
        }
        // 饼图逐点 dLbl 的优先级高于 dLbls；两层一起覆盖才不会导出后反转。
        for (const label of [labels, ...directChildren(labels, 'c:dLbl')]) {
          if (source.dataLabelFormat) {
            const format = ensureLabelField(chart, label, 'c:numFmt');
            format.setAttribute('formatCode', source.dataLabelFormat);
            format.setAttribute('sourceLinked', '0');
          }
          if (source.showDataLabels != null || patch.labelContent) {
            const content = patch.labelContent ?? 'value';
            const visible = source.showDataLabels ?? child(label, `c:${content === 'percentage' ? 'showPercent' : content === 'category' ? 'showCatName' : 'showVal'}`)?.getAttribute('val') === '1';
            for (const [field, active] of [['c:showVal', content === 'value'], ['c:showPercent', content === 'percentage'], ['c:showCatName', content === 'category']] as const) {
              ensureLabelField(chart, label, field).setAttribute('val', visible && active ? '1' : '0');
            }
          }
          if (patch.labelPosition) {
            const position = entry.type === 'line' && patch.labelPosition !== 'ctr'
              ? patch.labelPosition === 'outEnd' || patch.labelPosition === 't' ? 't' : 'b' : patch.labelPosition;
            ensureLabelField(chart, label, 'c:dLblPos').setAttribute('val', position);
          }
        }
      }
    });
    getElementByTag(frames[0], 'p:cNvPr')?.setAttribute('name', 'Chart');
    zip.file(chartPath, serializer.serializeToString(chart));
    zip.file(slidePath, serializer.serializeToString(slide));
  }
  return plan.length > 0;
}

/** CT_DLbl/CT_DLbls 的有序子节点；新增字段必须遵守 OOXML 顺序。 */
function ensureLabelField(doc: Document, parent: Element, tag: string): Element {
  const existing = child(parent, tag);
  if (existing) return existing;
  const order = ['c:numFmt', 'c:spPr', 'c:txPr', 'c:dLblPos', 'c:showLegendKey', 'c:showVal', 'c:showCatName', 'c:showSerName', 'c:showPercent', 'c:showBubbleSize', 'c:separator', 'c:showLeaderLines', 'c:leaderLines', 'c:extLst'];
  const element = doc.createElement(tag);
  parent.insertBefore(element, firstOf(parent, order.slice(order.indexOf(tag) + 1)));
  return element;
}

function child(parent: Element, tag: string): Element | undefined { return directChildren(parent, tag)[0]; }
function firstOf(parent: Element, tags: string[]): Element | null {
  for (const tag of tags) { const found = child(parent, tag); if (found) return found; }
  return null;
}
function ensure(doc: Document, parent: Element, tag: string): Element {
  const existing = child(parent, tag);
  if (existing) return existing;
  const element = doc.createElement(tag);
  parent.appendChild(element);
  return element;
}
