import JSZip from 'jszip';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import type { SlideBackgroundGradient } from '@plugin/slides/shared';

const GRADIENT_MARKER_PREFIX = 'linnya-gradient:';
const GRADIENT_SHAPE_NAME = 'Linnya Gradient Shape';
const OOXML_ANGLE_UNIT = 60_000;

const parser = new DOMParser();
const serializer = new XMLSerializer();

export function createGradientFillMarker(gradient: SlideBackgroundGradient): string {
  return `${GRADIENT_MARKER_PREFIX}${encodeURIComponent(JSON.stringify(gradient))}`;
}

export async function applyPptxGradientFills(zip: JSZip): Promise<boolean> {
  const slideFiles = Object.keys(zip.files).filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file));
  let mutated = false;

  for (const path of slideFiles) {
    const file = zip.file(path);
    if (!file) continue;

    const xml = await file.async('text');
    const doc = parser.parseFromString(xml, 'application/xml');
    const changed = applyGradientFillsToSlideDocument(doc);
    if (!changed) continue;

    zip.file(path, serializer.serializeToString(doc));
    mutated = true;
  }

  return mutated;
}

function applyGradientFillsToSlideDocument(doc: XmlDocument): boolean {
  const shapes = [
    ...Array.from(doc.getElementsByTagName('p:sp')),
    ...Array.from(doc.getElementsByTagName('sp')),
  ] as XmlElement[];
  let mutated = false;

  for (const shape of shapes) {
    const nonVisual = findDescendantElement(shape, ['p:cNvPr', 'cNvPr']);
    if (!nonVisual) continue;

    const marker = nonVisual.getAttribute('name') ?? '';
    const gradient = parseGradientFillMarker(marker);
    if (!gradient) continue;

    const shapeProperties = findDescendantElement(shape, ['p:spPr', 'spPr']);
    if (!shapeProperties) {
      throw new Error('PPTX gradient post-process failed: marked shape is missing spPr.');
    }

    replaceShapeFillWithGradient(doc, shapeProperties, gradient);
    nonVisual.setAttribute('name', GRADIENT_SHAPE_NAME);
    mutated = true;
  }

  return mutated;
}

function parseGradientFillMarker(name: string): SlideBackgroundGradient | null {
  if (!name.startsWith(GRADIENT_MARKER_PREFIX)) {
    return null;
  }
  const raw = name.slice(GRADIENT_MARKER_PREFIX.length);
  const decoded = JSON.parse(decodeURIComponent(raw)) as unknown;
  if (!isLinearGradient(decoded)) {
    throw new Error('PPTX gradient post-process failed: invalid gradient marker payload.');
  }
  return decoded;
}

function isLinearGradient(value: unknown): value is SlideBackgroundGradient {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as {
    type?: unknown;
    angle?: unknown;
    stops?: unknown;
  };
  if (candidate.type !== 'linear' || typeof candidate.angle !== 'number' || !Number.isFinite(candidate.angle)) {
    return false;
  }
  if (!Array.isArray(candidate.stops) || candidate.stops.length !== 2) {
    return false;
  }
  return candidate.stops.every((stop) => (
    stop != null
    && typeof stop === 'object'
    && !Array.isArray(stop)
    && typeof (stop as { color?: unknown }).color === 'string'
    && typeof (stop as { position?: unknown }).position === 'number'
    && Number.isFinite((stop as { position: number }).position)
  ));
}

function replaceShapeFillWithGradient(
  doc: XmlDocument,
  shapeProperties: XmlElement,
  gradient: SlideBackgroundGradient,
): void {
  if (gradient.type !== 'linear') {
    throw new Error('PPTX legacy gradient marker only supports linear gradients.');
  }
  removeFillChildren(shapeProperties);
  const gradientFill = doc.createElement('a:gradFill');
  gradientFill.setAttribute('rotWithShape', '1');

  const stopList = doc.createElement('a:gsLst');
  for (const stop of gradient.stops) {
    const gradientStop = doc.createElement('a:gs');
    gradientStop.setAttribute('pos', String(Math.round(stop.position * 100_000)));

    const color = doc.createElement('a:srgbClr');
    color.setAttribute('val', normalizeHexColor(stop.color));

    gradientStop.appendChild(color);
    stopList.appendChild(gradientStop);
  }

  const linear = doc.createElement('a:lin');
  linear.setAttribute('ang', String(Math.round(gradient.angle * OOXML_ANGLE_UNIT)));
  linear.setAttribute('scaled', '1');

  gradientFill.appendChild(stopList);
  gradientFill.appendChild(linear);
  shapeProperties.appendChild(gradientFill);
}

function removeFillChildren(shapeProperties: XmlElement): void {
  const toRemove: XmlElement[] = [];
  for (let i = 0; i < shapeProperties.childNodes.length; i++) {
    const child = shapeProperties.childNodes.item(i);
    if (!child || child.nodeType !== 1) continue;
    const element = child as XmlElement;
    if (
      element.tagName === 'a:noFill'
      || element.tagName === 'a:solidFill'
      || element.tagName === 'a:gradFill'
      || element.tagName === 'a:pattFill'
      || element.tagName === 'a:blipFill'
    ) {
      toRemove.push(element);
    }
  }
  for (const element of toRemove) {
    shapeProperties.removeChild(element);
  }
}

function findDescendantElement(
  element: XmlElement,
  tagNames: string[],
): XmlElement | null {
  for (const tagName of tagNames) {
    const matches = element.getElementsByTagName(tagName);
    if (matches.length > 0) {
      return matches.item(0) as XmlElement;
    }
  }
  return null;
}

function normalizeHexColor(color: string): string {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.slice(1).toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  throw new Error(`PPTX gradient post-process failed: unsupported gradient color "${color}".`);
}
