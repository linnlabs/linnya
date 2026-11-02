import type { Document, Element } from '@xmldom/xmldom';
import type { ChartLayoutBox, ResolvedChartLayout } from '@plugin/slides/shared/chartLayout';
import { directChildren, getElementByTag } from '../parser/xml/XmlNode';

/** SDK 没有 legend layout API；只补布局节点，保留原生图例与可编辑数据。 */
export function applyChartPptxLayout(doc: Document, layout: ResolvedChartLayout): void {
  const plot = getElementByTag(doc, 'c:plotArea');
  if (!plot) throw new Error('Chart materialization: missing plot area');
  writeLayout(doc, plot, layout.plot, true);
  if (layout.legend) {
    const legend = getElementByTag(doc, 'c:legend');
    if (!legend) throw new Error('Chart materialization: missing legend');
    writeLayout(doc, legend, layout.legend.box, false);
    // plot 已经扣除图例占位，不能再让 Office 自动缩小一次。
    getElementByTag(legend, 'c:overlay')?.setAttribute('val', '1');
  }
}

function writeLayout(doc: Document, owner: Element, box: ChartLayoutBox, inner: boolean): void {
  const layout = doc.createElement('c:layout');
  const manual = doc.createElement('c:manualLayout');
  layout.appendChild(manual);
  const field = (tag: string, value: string | number) => {
    const node = doc.createElement(`c:${tag}`);
    node.setAttribute('val', String(value));
    manual.appendChild(node);
  };
  if (inner) field('layoutTarget', 'inner');
  field('xMode', 'edge'); field('yMode', 'edge');
  field('wMode', 'factor'); field('hMode', 'factor');
  for (const key of ['x', 'y', 'w', 'h'] as const) field(key, box[key]);
  const existing = directChildren(owner, 'c:layout')[0];
  if (existing) owner.replaceChild(layout, existing);
  else {
    const before = inner ? owner.firstChild
      : directChildren(owner, 'c:overlay')[0] ?? directChildren(owner, 'c:spPr')[0] ?? directChildren(owner, 'c:txPr')[0] ?? null;
    owner.insertBefore(layout, before);
  }
}
