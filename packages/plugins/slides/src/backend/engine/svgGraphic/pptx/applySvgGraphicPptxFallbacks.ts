import { createHash } from 'node:crypto';
import type JSZip from 'jszip';
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import { SvgGraphicMaterializationError } from '../definitions/svgGraphicMaterializationError';
import type { SvgGraphicPptxFallbackPlanEntry } from './svgGraphicPptxPlan';
import { resolvePptxPartTarget } from '../../pptx/pptxPartPath';

const parser = new DOMParser();

/** 用真实透明 PNG 替换 PptxGenJS 的固定占位图，并验证 SVG/PNG 双 relationship。 */
export async function applySvgGraphicPptxFallbacks(
  zip: JSZip,
  entries: readonly SvgGraphicPptxFallbackPlanEntry[] | undefined,
): Promise<boolean> {
  if (!entries || entries.length === 0) return false;

  await assertPngAndSvgContentTypes(zip);
  const assignedFallbackHashes = new Map<string, string>();
  for (const entry of entries) {
    await applyEntry(zip, entry, assignedFallbackHashes);
  }
  return true;
}

async function applyEntry(
  zip: JSZip,
  entry: SvgGraphicPptxFallbackPlanEntry,
  assignedFallbackHashes: Map<string, string>,
): Promise<void> {
  const slidePath = `ppt/slides/slide${entry.slideNumber}.xml`;
  const slideFile = zip.file(slidePath);
  const relsFile = zip.file(
    `ppt/slides/_rels/slide${entry.slideNumber}.xml.rels`,
  );
  if (!slideFile || !relsFile) {
    failEmbedding(`Missing slide package parts for ${entry.objectName}.`);
  }

  const slideDoc = parser.parseFromString(await slideFile.async('text'), 'application/xml');
  const picture = findPictureByName(slideDoc, entry.objectName);
  if (!picture) {
    failEmbedding(`Missing SVG picture ${entry.objectName}.`);
  }
  const fallbackRelationshipId = readEmbeddedRelationshipId(picture, 'blip');
  const svgRelationshipId = readEmbeddedRelationshipId(picture, 'svgBlip');
  if (
    !fallbackRelationshipId
    || !svgRelationshipId
    || fallbackRelationshipId === svgRelationshipId
  ) {
    failEmbedding(`SVG picture ${entry.objectName} does not contain distinct SVG and PNG relationships.`);
  }

  const relsDoc = parser.parseFromString(await relsFile.async('text'), 'application/xml');
  const relationships = readRelationshipTargets(relsDoc);
  const fallbackTarget = relationships.get(fallbackRelationshipId);
  const svgTarget = relationships.get(svgRelationshipId);
  if (!fallbackTarget || !svgTarget) {
    failEmbedding(`SVG picture ${entry.objectName} has unresolved media relationships.`);
  }

  const fallbackPath = resolvePptxPartTarget(slidePath, fallbackTarget);
  const svgPath = resolvePptxPartTarget(slidePath, svgTarget);
  const svgFile = zip.file(svgPath);
  if (!svgFile || !zip.file(fallbackPath)) {
    failEmbedding(`SVG picture ${entry.objectName} references missing media parts.`);
  }
  const embeddedSvg = await svgFile.async('text');
  if (
    embeddedSvg !== entry.canonicalSvg
    || sha256(Buffer.from(embeddedSvg, 'utf8')) !== entry.contentHash
  ) {
    failEmbedding(`SVG picture ${entry.objectName} does not contain the admitted canonical SVG.`);
  }

  const fallbackHash = sha256(entry.fallbackPngBytes);
  const previousHash = assignedFallbackHashes.get(fallbackPath);
  if (previousHash && previousHash !== fallbackHash) {
    failEmbedding(`SVG pictures share fallback part ${fallbackPath} with different raster content.`);
  }
  assignedFallbackHashes.set(fallbackPath, fallbackHash);
  zip.file(fallbackPath, entry.fallbackPngBytes);
}

async function assertPngAndSvgContentTypes(zip: JSZip): Promise<void> {
  const file = zip.file('[Content_Types].xml');
  if (!file) failEmbedding('PPTX package is missing [Content_Types].xml.');
  const doc = parser.parseFromString(await file.async('text'), 'application/xml');
  const defaults = elementsByLocalName(doc, 'Default');
  const mediaTypes = new Map<string, string>();
  for (const element of defaults) {
    const extension = element.getAttribute('Extension');
    const contentType = element.getAttribute('ContentType');
    if (extension && contentType) mediaTypes.set(extension.toLowerCase(), contentType);
  }
  if (mediaTypes.get('png') !== 'image/png' || mediaTypes.get('svg') !== 'image/svg+xml') {
    failEmbedding('PPTX package does not declare PNG and SVG media content types.');
  }
}

function findPictureByName(doc: XmlDocument, objectName: string): XmlElement | null {
  for (const picture of elementsByLocalName(doc, 'pic')) {
    const nonVisual = elementsByLocalName(picture, 'cNvPr')[0];
    if (nonVisual?.getAttribute('name') === objectName) return picture;
  }
  return null;
}

function readEmbeddedRelationshipId(
  picture: XmlElement,
  localName: 'blip' | 'svgBlip',
): string | null {
  const element = elementsByLocalName(picture, localName)[0];
  return element?.getAttribute('r:embed') || element?.getAttribute('embed') || null;
}

function readRelationshipTargets(doc: XmlDocument): Map<string, string> {
  const relationships = new Map<string, string>();
  for (const relationship of elementsByLocalName(doc, 'Relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) relationships.set(id, target);
  }
  return relationships;
}

function elementsByLocalName(
  parent: XmlDocument | XmlElement,
  localName: string,
): XmlElement[] {
  const result: XmlElement[] = [];
  const elements = parent.getElementsByTagName('*');
  for (let index = 0; index < elements.length; index++) {
    const element = elements.item(index);
    if (element && (element.localName === localName || element.tagName.split(':').pop() === localName)) {
      result.push(element);
    }
  }
  return result;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function failEmbedding(message: string): never {
  throw new SvgGraphicMaterializationError(
    'slides.svg.pptx_embedding_failed',
    message,
  );
}
