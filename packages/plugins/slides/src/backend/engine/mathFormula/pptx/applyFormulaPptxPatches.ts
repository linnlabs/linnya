import JSZip from 'jszip';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import { MathFormulaCompileError } from '../definitions/MathFormulaCompileError';
import type { FormulaPptxPatchPlan, FormulaPptxPatchPlanEntry } from './formulaPptxPlan';

const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const A14_NS = 'http://schemas.microsoft.com/office/drawing/2010/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const parser = new DOMParser();
const serializer = new XMLSerializer();

export async function applyFormulaPptxPatches(
  zip: JSZip,
  plan: FormulaPptxPatchPlan | undefined,
): Promise<boolean> {
  if (!plan || plan.entries.length === 0) return false;
  const bySlide = groupBySlide(plan.entries);
  for (const [slideIndex, entries] of bySlide) {
    const path = `ppt/slides/slide${slideIndex + 1}.xml`;
    const file = zip.file(path);
    if (!file) fail(`公式所在页面不存在：${slideIndex + 1}。`);
    const doc = parser.parseFromString(await file.async('text'), 'application/xml');
    for (const markerEntries of groupByObjectName(entries).values()) {
      const first = markerEntries[0];
      if (!first) continue;
      if (first.mode === 'block') applyBlockEntry(doc, first);
      else applyInlineEntries(doc, markerEntries);
    }
    validateSlideFormulaProjection(doc, entries);
    zip.file(path, serializer.serializeToString(doc));
  }
  return true;
}

function applyBlockEntry(doc: XmlDocument, entry: FormulaPptxPatchPlanEntry): void {
  const matches = findShapesByName(doc, entry.objectName);
  if (matches.length !== 1) {
    fail(`公式 ${entry.formulaId} 的 shape marker 应命中 1 次，实际为 ${matches.length} 次。`);
  }
  const shape = matches[0];
  if (!shape) fail(`公式 ${entry.formulaId} 缺少 shape。`);
  const placeholderCount = countExactText(shape, entry.placeholderToken);
  if (placeholderCount !== 1) {
    fail(`公式 ${entry.formulaId} 的 placeholder 应命中 1 次，实际为 ${placeholderCount} 次。`);
  }
  const txBodies = directChildren(shape, 'p:txBody');
  if (txBodies.length !== 1) fail(`公式 ${entry.formulaId} 必须包含一个 p:txBody。`);
  const replacement = parseBlockReplacement(entry);
  const replacementShape = firstDescendant(replacement, 'p:sp');
  if (!replacementShape) fail(`公式 ${entry.formulaId} 的 replacement shape 无效。`);
  const replacementTxBody = directChildren(replacementShape, 'p:txBody')[0];
  if (!replacementTxBody) fail(`公式 ${entry.formulaId} 的 replacement txBody 无效。`);
  const currentTxBody = txBodies[0];
  if (!currentTxBody?.parentNode) fail(`公式 ${entry.formulaId} 的 txBody 无父节点。`);
  currentTxBody.parentNode.replaceChild(replacementTxBody.cloneNode(true), currentTxBody);

  const parent = shape.parentNode;
  if (!parent) fail(`公式 ${entry.formulaId} 的 shape 无父节点。`);
  const alternate = replacement.documentElement;
  if (!alternate) fail(`公式 ${entry.formulaId} 的 MCE 根节点无效。`);
  const choice = firstDescendant(alternate, 'mc:Choice');
  const templateShape = firstDescendant(alternate, 'p:sp');
  if (!choice || !templateShape) fail(`公式 ${entry.formulaId} 的 MCE wrapper 无效。`);
  choice.replaceChild(shape.cloneNode(true), templateShape);
  parent.replaceChild(alternate.cloneNode(true), shape);
}

function applyInlineEntries(
  doc: XmlDocument,
  entries: readonly FormulaPptxPatchPlanEntry[],
): void {
  const first = entries[0];
  if (!first) return;
  const matches = findShapesByName(doc, first.objectName);
  if (matches.length !== 1) {
    fail(`行内公式文本框 ${first.objectName} 的 marker 应命中 1 次，实际为 ${matches.length} 次。`);
  }
  const shape = matches[0];
  if (!shape) fail(`行内公式文本框 ${first.objectName} 缺少 shape。`);
  for (const entry of entries) {
    const runs = findRunsByExactText(shape, entry.placeholderToken);
    if (runs.length !== 1) {
      fail(`公式 ${entry.formulaId} 的 placeholder run 应命中 1 次，实际为 ${runs.length} 次。`);
    }
    const run = runs[0];
    if (!run?.parentNode) fail(`公式 ${entry.formulaId} 的 placeholder run 无父节点。`);
    const replacement = parseInlineReplacement(entry);
    const mathZone = replacement.documentElement;
    if (!mathZone) fail(`公式 ${entry.formulaId} 的 inline replacement 无效。`);
    run.parentNode.replaceChild(mathZone.cloneNode(true), run);
  }
  normalizeInlineParagraphProperties(shape);
  wrapShapeWithAlternateContent(shape, first.formulaId);
}

/**
 * PptxGenJS 会在部分 rich-text run 前重复写入段落属性；普通文本由 Office 宽容读取，
 * 但插入原生 math zone 后必须恢复为合法的 a:p 结构，避免 PowerPoint 修复文件。
 */
function normalizeInlineParagraphProperties(shape: XmlElement): void {
  const paragraphs = shape.getElementsByTagName('a:p');
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs.item(paragraphIndex);
    if (!paragraph) continue;
    const properties = directChildren(paragraph, 'a:pPr');
    for (const duplicate of properties.slice(1)) paragraph.removeChild(duplicate);
  }
}

function parseBlockReplacement(entry: FormulaPptxPatchPlanEntry): XmlDocument {
  const paragraphAlign = entry.source.align === 'left' ? 'l' : entry.source.align === 'right' ? 'r' : 'ctr';
  const xml = `<mc:AlternateContent xmlns:mc="${MC_NS}" xmlns:a14="${A14_NS}" xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}" xmlns:m="${MATH_NS}"><mc:Choice Requires="a14"><p:sp><p:nvSpPr/><p:spPr/><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" wrap="none" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${paragraphAlign}"/><a14:m>${entry.omml}</a14:m></a:p></p:txBody></p:sp></mc:Choice></mc:AlternateContent>`;
  return parser.parseFromString(xml, 'application/xml');
}

function parseInlineReplacement(entry: FormulaPptxPatchPlanEntry): XmlDocument {
  return parser.parseFromString(
    `<a14:m xmlns:a14="${A14_NS}" xmlns:m="${MATH_NS}">${entry.omml}</a14:m>`,
    'application/xml',
  );
}

function wrapShapeWithAlternateContent(shape: XmlElement, formulaId: string): void {
  const parent = shape.parentNode;
  if (!parent) fail(`公式 ${formulaId} 的 shape 无父节点。`);
  const wrapper = parser.parseFromString(
    `<mc:AlternateContent xmlns:mc="${MC_NS}" xmlns:a14="${A14_NS}" xmlns:p="${PRESENTATION_NS}"><mc:Choice Requires="a14"><p:sp/></mc:Choice></mc:AlternateContent>`,
    'application/xml',
  );
  const templateShape = firstDescendant(wrapper, 'p:sp');
  if (!templateShape) fail(`公式 ${formulaId} 的 MCE wrapper 无效。`);
  const wrapperRoot = wrapper.documentElement;
  if (!wrapperRoot) fail(`公式 ${formulaId} 的 MCE 根节点无效。`);
  templateShape.parentNode?.replaceChild(shape.cloneNode(true), templateShape);
  parent.replaceChild(wrapperRoot.cloneNode(true), shape);
}

function validateSlideFormulaProjection(doc: XmlDocument, entries: readonly FormulaPptxPatchPlanEntry[]): void {
  const mathZones = doc.getElementsByTagName('a14:m');
  if (mathZones.length < entries.length) fail('公式 PPTX patch 后缺少 a14:m。');
  for (const entry of entries) {
    if (countExactText(doc, entry.placeholderToken) !== 0) {
      fail(`公式 ${entry.formulaId} patch 后仍残留 placeholder。`);
    }
    const shapes = findShapesByName(doc, entry.objectName);
    if (shapes.length !== 1) fail(`公式 ${entry.formulaId} patch 后 marker 数量无效。`);
    const shape = shapes[0];
    if (!shape || shape.getElementsByTagName('a14:m').length < 1) {
      fail(`公式 ${entry.formulaId} 缺少 a14:m。`);
    }
    if (entry.mode === 'block' && shape.getElementsByTagName('m:oMathPara').length !== 1) {
      fail(`块公式 ${entry.formulaId} 没有且仅有一个 m:oMathPara。`);
    }
    if (entry.mode === 'inline' && shape.getElementsByTagName('m:oMath').length < 1) {
      fail(`行内公式 ${entry.formulaId} 缺少 m:oMath。`);
    }
    if (entry.mode === 'inline') {
      const paragraphs = shape.getElementsByTagName('a:p');
      for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs.item(index);
        if (paragraph && directChildren(paragraph, 'a:pPr').length > 1) {
          fail(`行内公式 ${entry.formulaId} 所在段落包含重复 a:pPr。`);
        }
      }
    }
  }
}

function findRunsByExactText(root: XmlElement, value: string): XmlElement[] {
  const result: XmlElement[] = [];
  const runs = root.getElementsByTagName('a:r');
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs.item(index);
    if (run && countExactText(run, value) === 1) result.push(run);
  }
  return result;
}

function findShapesByName(doc: XmlDocument, objectName: string): XmlElement[] {
  const result: XmlElement[] = [];
  const shapes = doc.getElementsByTagName('p:sp');
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes.item(index);
    if (!shape) continue;
    const properties = shape.getElementsByTagName('p:cNvPr');
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
      if (properties.item(propertyIndex)?.getAttribute('name') === objectName) result.push(shape);
    }
  }
  return result;
}

function countExactText(root: XmlDocument | XmlElement, value: string): number {
  const nodes = root.getElementsByTagName('a:t');
  let count = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes.item(index)?.textContent === value) count += 1;
  }
  return count;
}

function directChildren(parent: XmlElement, tagName: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && (child as XmlElement).tagName === tagName) result.push(child as XmlElement);
  }
  return result;
}

function firstDescendant(root: XmlDocument | XmlElement, tagName: string): XmlElement | null {
  return root.getElementsByTagName(tagName).item(0);
}

function groupBySlide(entries: readonly FormulaPptxPatchPlanEntry[]): Map<number, FormulaPptxPatchPlanEntry[]> {
  const result = new Map<number, FormulaPptxPatchPlanEntry[]>();
  for (const entry of entries) {
    const group = result.get(entry.slideIndex) ?? [];
    group.push(entry);
    result.set(entry.slideIndex, group);
  }
  return result;
}

function groupByObjectName(
  entries: readonly FormulaPptxPatchPlanEntry[],
): Map<string, FormulaPptxPatchPlanEntry[]> {
  const result = new Map<string, FormulaPptxPatchPlanEntry[]>();
  for (const entry of entries) {
    const group = result.get(entry.objectName) ?? [];
    group.push(entry);
    result.set(entry.objectName, group);
  }
  return result;
}

function fail(message: string): never {
  throw new MathFormulaCompileError('slides.formula.pptx_patch_failed', message);
}
