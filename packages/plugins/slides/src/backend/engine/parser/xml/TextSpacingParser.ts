/**
 * TextSpacingParser
 *
 * 负责 OOXML 文本段间距 / 行距 / 字号 / 字体回退的解析。
 * M3 起行距保留 OOXML 原始语义：百分比是 multiple，磅值是 exactPt。
 */

import type { Element as XmlElement } from '@xmldom/xmldom';
import type { RenderLineSpacing } from '@plugin/slides/shared';
import { getAttr, getElementByTag } from './XmlNode.js';

/**
 * 解析段前 / 段后间距。
 *
 * OOXML 允许两种写法：
 * - `<a:spcPts val="600"/>`：固定 6 pt（值的单位 = 1/100 pt）
 * - `<a:spcPct val="50000"/>`：相对当前段最大字号的百分比，1/1000 %（即 50000 = 50%）
 *
 * 本函数统一返回 pt。`spcPct` 需要字号上下文才能换算，缺字号时安全降级（保持 undefined）。
 * 与段落行距保持同样的双语义解析能力，避免 imported PPT 内出现「行距支持百分比、段间距却被吃掉」的不一致。
 */
export function parseSpacingPoints(
  spacingElement: XmlElement | null,
  fontSizePt?: number,
): number | undefined {
  if (!spacingElement) {
    return undefined;
  }
  const pointsNode = getElementByTag(spacingElement, 'a:spcPts');
  if (pointsNode) {
    const value = Number(getAttr(pointsNode, 'val'));
    if (Number.isFinite(value)) {
      return value / 100;
    }
  }
  const percentNode = getElementByTag(spacingElement, 'a:spcPct');
  if (percentNode && fontSizePt != null && fontSizePt > 0) {
    const value = Number(getAttr(percentNode, 'val'));
    if (Number.isFinite(value) && value > 0) {
      return (value / 100000) * fontSizePt;
    }
  }
  return undefined;
}

/**
 * 解析行距并保留 OOXML 两类可辨识语义。
 *
 * - `a:spcPct`：1/1000 % 单位（100000 ⇒ 1.0 倍行高）
 * - `a:spcPts`：1/100 pt 单位，作为 fixed/exact line spacing 透传
 */
export function parseLineSpacing(
  paragraphProps: XmlElement | null,
): RenderLineSpacing | undefined {
  if (!paragraphProps) {
    return undefined;
  }
  const lineSpacing = getElementByTag(paragraphProps, 'a:lnSpc');
  if (!lineSpacing) {
    return undefined;
  }
  const percentNode = getElementByTag(lineSpacing, 'a:spcPct');
  if (percentNode) {
    const value = Number(getAttr(percentNode, 'val'));
    if (Number.isFinite(value) && value > 0) {
      return { kind: 'multiple', value: value / 100000 };
    }
  }
  const pointsNode = getElementByTag(lineSpacing, 'a:spcPts');
  if (pointsNode) {
    const value = Number(getAttr(pointsNode, 'val'));
    if (Number.isFinite(value) && value > 0) {
      return { kind: 'exactPt', value: value / 100 };
    }
  }
  return undefined;
}

/**
 * 从 run / 默认 run 的字体三元组（`a:latin` / `a:ea` / `a:cs`）中按优先级取 typeface。
 * 按 OOXML 规范：缺失时回退到 fallback（一般是 theme 的 minor / major font）。
 */
export function resolveRunFontFamily(
  runProps: XmlElement | null,
  fallback?: string,
): string | undefined {
  if (!runProps) {
    return fallback;
  }
  const fontNodes = ['a:latin', 'a:ea', 'a:cs'];
  for (const fontNode of fontNodes) {
    const font = getElementByTag(runProps, fontNode);
    const typeface = font ? getAttr(font, 'typeface') : null;
    if (typeface) {
      return typeface;
    }
  }
  return fallback;
}

/**
 * 从 `p:txBody` 中提取所有文本 run 和段落默认的字号，返回最大值（pt）。
 * OOXML 中 `a:rPr/@sz` 和 `a:defRPr/@sz` 的单位是百分之一磅（hundredths of a point）。
 *
 * 同时被 `parseShape`（取主字号）和 `parseSpacingPoints`（spcPct 换算上下文）依赖。
 */
export function extractMaxFontSizePt(txBody: XmlElement): number | undefined {
  let maxSzHundredths = -1;

  const rPrs = txBody.getElementsByTagName('a:rPr');
  for (let i = 0; i < rPrs.length; i++) {
    const sz = (rPrs.item(i) as XmlElement).getAttribute('sz');
    if (sz) {
      const v = Number(sz);
      if (Number.isFinite(v) && v > maxSzHundredths) maxSzHundredths = v;
    }
  }
  const defRPrs = txBody.getElementsByTagName('a:defRPr');
  for (let i = 0; i < defRPrs.length; i++) {
    const sz = (defRPrs.item(i) as XmlElement).getAttribute('sz');
    if (sz) {
      const v = Number(sz);
      if (Number.isFinite(v) && v > maxSzHundredths) maxSzHundredths = v;
    }
  }

  return maxSzHundredths > 0 ? maxSzHundredths / 100 : undefined;
}
