import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { SvgGraphicAdmissionError } from '@plugin/slides/shared/svgGraphic';

export function parseSvgGraphicDocument(source: string): XmlDocument {
  if (/<!DOCTYPE\b/i.test(source) || /<!ENTITY\b/i.test(source)) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.invalid_xml',
      'SVG 不允许 DOCTYPE 或自定义 entity。'
    );
  }
  if (/<\?(?!xml(?:\s|\?>))/i.test(source)) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.invalid_xml',
      'SVG 不允许 processing instruction。'
    );
  }

  try {
    return new DOMParser({
      onError(level, message) {
        throw new Error(`${level}: ${message}`);
      },
    }).parseFromString(source, 'image/svg+xml');
  } catch (error) {
    throw new SvgGraphicAdmissionError(
      'slides.svg.invalid_xml',
      `SVG XML 无法严格解析：${errorMessage(error)}`
    );
  }
}

export function serializeCanonicalSvgElement(element: XmlElement): string {
  const name = svgElementName(element);
  const attributes: Array<{ readonly name: string; readonly value: string }> = [];
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (attribute) attributes.push({ name: attribute.name, value: attribute.value.trim() });
  }
  attributes.sort((left, right) => compareAscii(left.name, right.name));
  if (name === 'svg') {
    attributes.sort((left, right) => {
      if (left.name === 'xmlns') return -1;
      if (right.name === 'xmlns') return 1;
      if (left.name === 'viewBox') return -1;
      if (right.name === 'viewBox') return 1;
      return compareAscii(left.name, right.name);
    });
  }

  const serializedAttributes = attributes
    .map(attribute => ` ${attribute.name}="${escapeXmlAttribute(attribute.value)}"`)
    .join('');
  const children: string[] = [];
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = element.childNodes.item(index);
    if (isXmlElement(child)) {
      children.push(serializeCanonicalSvgElement(child));
    } else if (child && child.nodeType === child.TEXT_NODE && child.nodeValue?.trim()) {
      children.push(escapeXmlText(child.nodeValue));
    }
  }
  if (children.length === 0) return `<${name}${serializedAttributes}/>`;
  return `<${name}${serializedAttributes}>${children.join('')}</${name}>`;
}

export function collectSvgElementNames(root: XmlElement): Readonly<Record<string, number>> {
  const names = new Map<string, number>();
  walkSvgElements(root, 1, element => {
    const name = svgElementName(element);
    names.set(name, (names.get(name) ?? 0) + 1);
  });
  return Object.fromEntries(
    [...names.entries()].sort(([left], [right]) => compareAscii(left, right))
  );
}

export function walkSvgElements(
  element: XmlElement,
  depth: number,
  visitor: (element: XmlElement, depth: number) => void
): void {
  visitor(element, depth);
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = element.childNodes.item(index);
    if (isXmlElement(child)) walkSvgElements(child, depth + 1, visitor);
  }
}

export function isXmlElement(node: XmlNode | null): node is XmlElement {
  return node !== null && node.nodeType === node.ELEMENT_NODE;
}

export function svgElementName(element: XmlElement): string {
  return element.localName || element.tagName.replace(/^.*:/, '');
}

export function svgUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function hashCanonicalSvg(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
