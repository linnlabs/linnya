/**
 * 读取导出 PPTX 中每个文本框 / 表格单元格的纵向锚点。
 *
 * 只服务测试断言：既保留 OOXML 原始 `anchor`，也给出经正式 TextBodyParser
 * 重新导入后的 verticalAlign，便于检查导出与回环一致。
 */

import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { Element as XmlElement } from '@xmldom/xmldom';
import { extractTextBodyInfo } from '../../engine/parser/xml/TextBodyParser.js';
import { getElementByTag, getElements } from '../../engine/parser/xml/XmlNode.js';

export interface PptxTextBodyAnchor {
  /** 文本框内所有 `a:t` 拼接后的正文。 */
  text: string;
  /** `a:bodyPr@anchor` 原值；未写出时为 undefined。 */
  anchor: string | undefined;
  /** TextBodyParser 重新导入得到的纵向对齐。 */
  verticalAlign: 'top' | 'middle' | 'bottom' | undefined;
}

export interface PptxTableCellAnchor {
  text: string;
  /** `a:tcPr@anchor` 原值。 */
  anchor: string | undefined;
}

function joinText(element: XmlElement): string {
  return getElements(element, 'a:t').map((node) => node.textContent ?? '').join('');
}

function parseSlideXml(xml: string): XmlElement {
  return new DOMParser().parseFromString(xml, 'application/xml').documentElement as XmlElement;
}

export function readTextBodyAnchors(slideXml: string): PptxTextBodyAnchor[] {
  return getElements(parseSlideXml(slideXml), 'p:sp').flatMap((shape) => {
    const txBody = getElementByTag(shape, 'p:txBody');
    const bodyPr = txBody ? getElementByTag(txBody, 'a:bodyPr') : null;
    if (!txBody || !bodyPr) return [];
    return [{
      text: joinText(txBody),
      anchor: bodyPr.getAttribute('anchor') ?? undefined,
      verticalAlign: extractTextBodyInfo(txBody)?.verticalAlign,
    }];
  });
}

export function readTableCellAnchors(slideXml: string): PptxTableCellAnchor[] {
  return getElements(parseSlideXml(slideXml), 'a:tc').map((cell) => ({
    text: joinText(cell),
    anchor: getElementByTag(cell, 'a:tcPr')?.getAttribute('anchor') ?? undefined,
  }));
}

/** 按正文定位唯一文本框；找不到或不唯一都视为测试数据错误。 */
export function findTextBodyAnchor(
  anchors: readonly PptxTextBodyAnchor[],
  text: string,
): PptxTextBodyAnchor {
  const matches = anchors.filter((entry) => entry.text === text);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one text body "${text}", found ${matches.length}.`);
  }
  return matches[0]!;
}

export async function readPptxSlideXml(buffer: Buffer, slideNumber = 1): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file(`ppt/slides/slide${slideNumber}.xml`);
  if (entry == null) {
    throw new Error(`Expected slide XML entry for slide ${slideNumber}`);
  }
  return entry.async('text');
}
