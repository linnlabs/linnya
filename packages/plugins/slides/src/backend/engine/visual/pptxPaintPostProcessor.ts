import JSZip from 'jszip';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import type { GradientStop, Paint, StrokePaint } from '@plugin/slides/shared';
import type {
  PptxPaintPatchPlan,
  PptxShapePaintPatch,
} from './pptxPaintPatchPlan';

const OOXML_ANGLE_UNIT = 60_000;
const OOXML_PERCENT_UNIT = 100_000;
const POINT_TO_EMU = 12_700;

const parser = new DOMParser();
const serializer = new XMLSerializer();

export async function applyPptxPaintPatches(
  zip: JSZip,
  plan: PptxPaintPatchPlan | undefined,
): Promise<boolean> {
  if (!plan || plan.slides.length === 0) return false;

  let mutated = false;
  for (const slidePatch of plan.slides) {
    const path = `ppt/slides/slide${slidePatch.slideIndex + 1}.xml`;
    const file = zip.file(path);
    if (!file) {
      throw new Error(`PPTX Paint adapter 找不到 ${path}。`);
    }

    const doc = parser.parseFromString(await file.async('text'), 'application/xml');
    let slideMutated = false;
    if (slidePatch.background) {
      replaceSlideBackgroundPaint(doc, slidePatch.background);
      slideMutated = true;
    }
    for (const shapePatch of slidePatch.shapes) {
      replaceMarkedShapePaint(doc, shapePatch);
      slideMutated = true;
    }
    if (slideMutated) {
      zip.file(path, serializer.serializeToString(doc));
      mutated = true;
    }
  }
  return mutated;
}

function replaceSlideBackgroundPaint(doc: XmlDocument, paint: Paint): void {
  const commonSlideData = firstElement(doc, ['p:cSld', 'cSld']);
  if (!commonSlideData) throw new Error('PPTX Paint adapter: slide 缺少 p:cSld。');

  let background = findDirectChild(commonSlideData, ['p:bg', 'bg']);
  if (!background) {
    background = doc.createElement('p:bg');
    const shapeTree = findDirectChild(commonSlideData, ['p:spTree', 'spTree']);
    if (shapeTree) commonSlideData.insertBefore(background, shapeTree);
    else commonSlideData.appendChild(background);
  }

  let backgroundProperties = findDirectChild(background, ['p:bgPr', 'bgPr']);
  if (!backgroundProperties) {
    removeDirectChildren(background, ['p:bgRef', 'bgRef']);
    backgroundProperties = doc.createElement('p:bgPr');
    background.appendChild(backgroundProperties);
  }
  replacePaintChild(doc, backgroundProperties, paint);
}

function replaceMarkedShapePaint(doc: XmlDocument, patch: PptxShapePaintPatch): void {
  const candidates: XmlElement[] = [
    ...Array.from(doc.getElementsByTagName('p:sp')),
    ...Array.from(doc.getElementsByTagName('sp')),
    ...Array.from(doc.getElementsByTagName('p:cxnSp')),
    ...Array.from(doc.getElementsByTagName('cxnSp')),
  ];

  for (const shape of candidates) {
    const nonVisual = firstElement(shape, ['p:cNvPr', 'cNvPr']);
    if (nonVisual?.getAttribute('name') !== patch.marker) continue;
    const shapeProperties = firstElement(shape, ['p:spPr', 'spPr']);
    if (!shapeProperties) {
      throw new Error(`PPTX Paint adapter: marker ${patch.marker} 缺少 spPr。`);
    }

    if (patch.fill) replacePaintChild(doc, shapeProperties, patch.fill, patch.fillOpacity);
    if (patch.stroke) replaceStrokePaint(doc, shapeProperties, patch.stroke);
    nonVisual.setAttribute('name', `Shape ${nonVisual.getAttribute('id') ?? ''}`.trim());
    return;
  }

  throw new Error(`PPTX Paint adapter 找不到 shape marker ${patch.marker}。`);
}

function replacePaintChild(
  doc: XmlDocument,
  parent: XmlElement,
  paint: Paint,
  opacity?: number,
): void {
  removeDirectChildren(parent, [
    'a:noFill',
    'noFill',
    'a:solidFill',
    'solidFill',
    'a:gradFill',
    'gradFill',
    'a:pattFill',
    'pattFill',
    'a:blipFill',
    'blipFill',
  ]);
  const element = createPaintElement(doc, paint, opacity);
  const before = findDirectChild(parent, [
    'a:ln',
    'ln',
    'a:prstDash',
    'prstDash',
    'a:headEnd',
    'headEnd',
    'a:tailEnd',
    'tailEnd',
    'a:effectLst',
    'effectLst',
    'a:effectDag',
    'effectDag',
    'a:scene3d',
    'scene3d',
  ]);
  if (before) parent.insertBefore(element, before);
  else parent.appendChild(element);
}

function replaceStrokePaint(
  doc: XmlDocument,
  shapeProperties: XmlElement,
  stroke: NonNullable<PptxShapePaintPatch['stroke']>,
): void {
  let line = findDirectChild(shapeProperties, ['a:ln', 'ln']);
  if (!line) {
    line = doc.createElement('a:ln');
    shapeProperties.appendChild(line);
  }
  line.setAttribute('w', String(Math.round(stroke.width * POINT_TO_EMU)));
  replacePaintChild(doc, line, stroke.paint);

  removeDirectChildren(line, ['a:prstDash', 'prstDash']);
  if (stroke.dash && stroke.dash !== 'solid') {
    const dash = doc.createElement('a:prstDash');
    dash.setAttribute('val', stroke.dash === 'dot' ? 'dot' : 'dash');
    const join = findDirectChild(line, ['a:round', 'round', 'a:bevel', 'bevel', 'a:miter', 'miter']);
    if (join) line.insertBefore(dash, join);
    else line.appendChild(dash);
  }
}

function createPaintElement(
  doc: XmlDocument,
  paint: Paint | StrokePaint,
  opacity?: number,
): XmlElement {
  if (paint.type === 'none') return doc.createElement('a:noFill');
  if (paint.type === 'solid') {
    const solid = doc.createElement('a:solidFill');
    solid.appendChild(createColorElement(doc, paint.color, combineOpacity(paint.opacity, opacity)));
    return solid;
  }

  const gradient = doc.createElement('a:gradFill');
  gradient.setAttribute('rotWithShape', paint.rotateWithShape === false ? '0' : '1');
  const stopList = doc.createElement('a:gsLst');
  for (const stop of paint.stops) {
    stopList.appendChild(createGradientStopElement(doc, stop, opacity));
  }
  gradient.appendChild(stopList);

  if (paint.type === 'linear') {
    const linear = doc.createElement('a:lin');
    linear.setAttribute('ang', String(Math.round(paint.angle * OOXML_ANGLE_UNIT)));
    linear.setAttribute('scaled', '1');
    gradient.appendChild(linear);
  } else {
    const center = paint.center ?? { x: 0.5, y: 0.5 };
    const radius = paint.radius ?? { x: 0.5, y: 0.5 };
    const path = doc.createElement('a:path');
    path.setAttribute('path', 'circle');
    const fillToRect = doc.createElement('a:fillToRect');
    // fillToRect 的坐标相对 tileRect；固定为 tile 中心的单点，
    // 再由 tileRect 表达公开合同中的 center/radius，避免把半径静默丢掉。
    fillToRect.setAttribute('l', toOoxmlPercent(0.5));
    fillToRect.setAttribute('t', toOoxmlPercent(0.5));
    fillToRect.setAttribute('r', toOoxmlPercent(0.5));
    fillToRect.setAttribute('b', toOoxmlPercent(0.5));
    path.appendChild(fillToRect);
    gradient.appendChild(path);

    const tileRect = doc.createElement('a:tileRect');
    tileRect.setAttribute('l', toOoxmlPercent(center.x - radius.x));
    tileRect.setAttribute('t', toOoxmlPercent(center.y - radius.y));
    tileRect.setAttribute('r', toOoxmlPercent(1 - center.x - radius.x));
    tileRect.setAttribute('b', toOoxmlPercent(1 - center.y - radius.y));
    gradient.appendChild(tileRect);
  }
  return gradient;
}

function createGradientStopElement(
  doc: XmlDocument,
  stop: GradientStop,
  opacity?: number,
): XmlElement {
  const element = doc.createElement('a:gs');
  element.setAttribute('pos', toOoxmlPercent(stop.position));
  element.appendChild(createColorElement(doc, stop.color, combineOpacity(stop.opacity, opacity)));
  return element;
}

function createColorElement(doc: XmlDocument, color: string, opacity?: number): XmlElement {
  const element = doc.createElement('a:srgbClr');
  element.setAttribute('val', color.replace(/^#/, '').toUpperCase());
  if (opacity != null && opacity < 1) {
    const alpha = doc.createElement('a:alpha');
    alpha.setAttribute('val', toOoxmlPercent(opacity));
    element.appendChild(alpha);
  }
  return element;
}

function combineOpacity(own: number | undefined, parent: number | undefined): number | undefined {
  if (own == null) return parent;
  if (parent == null) return own;
  return own * parent;
}

function toOoxmlPercent(value: number): string {
  return String(Math.round(value * OOXML_PERCENT_UNIT));
}

function firstElement(root: XmlDocument | XmlElement, tagNames: string[]): XmlElement | null {
  for (const tagName of tagNames) {
    const element = root.getElementsByTagName(tagName).item(0);
    if (element) return element;
  }
  return null;
}

function findDirectChild(parent: XmlElement, tagNames: string[]): XmlElement | null {
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (isXmlElement(child) && tagNames.includes(child.tagName)) {
      return child;
    }
  }
  return null;
}

function removeDirectChildren(parent: XmlElement, tagNames: string[]): void {
  const matches: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (isXmlElement(child) && tagNames.includes(child.tagName)) {
      matches.push(child);
    }
  }
  for (const match of matches) parent.removeChild(match);
}

function isXmlElement(value: unknown): value is XmlElement {
  return typeof value === 'object'
    && value !== null
    && 'nodeType' in value
    && value.nodeType === 1
    && 'tagName' in value
    && typeof value.tagName === 'string';
}
