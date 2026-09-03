/**
 * GeometryParser
 *
 * 把 OOXML `a:xfrm` / `a:off` / `a:ext` / `a:chOff` / `a:chExt` 翻译成英寸单位的 `Box` 与 group transform。
 *
 * 与 `Box` 单位契约（ai-ppt §4.4）保持一致：所有输出长度均为英寸。
 * GroupTransform 在 `parseGroup` 内部传给所有子元素的 `parseXfrm`，按嵌套层次累计 offset / scale。
 */

import type { Element as XmlElement } from '@xmldom/xmldom';
import type { Box } from '@plugin/slides/shared';
import { emuToInches } from '@plugin/backend/textMeasurement';
import { getAttr, getElementByTag } from './XmlNode.js';

/**
 * group 上下文：把 group 内子元素的本地坐标 → slide 全局英寸坐标的换算所需的全部信息。
 *
 * - offsetX/Y: 父级 group 累计后的 EMU 起点
 * - scaleX/Y: 父级 group 累计后的缩放
 * - childOffsetX/Y: 父级 group 自己的 chOff（子元素本地坐标系原点）
 *
 * 全字段保留 EMU（直到 parseXfrm 最后一步才统一 emuToInches），避免中途精度损失。
 */
export interface GroupTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  childOffsetX: number;
  childOffsetY: number;
}

/** 从 `p:spPr` 中找出 `a:xfrm` 并转 Box（英寸）。 */
export function parsePosition(
  spPr: XmlElement | null,
  transform?: GroupTransform,
): Box | undefined {
  if (!spPr) return undefined;
  const xfrm = getElementByTag(spPr, 'a:xfrm');
  if (!xfrm) return undefined;
  return parseXfrm(xfrm, transform);
}

/**
 * 从 `a:xfrm` 中读 off/ext，按 group transform 折算后转英寸 Box。
 * `transform` 缺失 ⇒ 直接 EMU → inches；存在 ⇒ 先做 group 内坐标变换再转。
 */
export function parseXfrm(xfrm: XmlElement, transform?: GroupTransform): Box | undefined {
  const off = getElementByTag(xfrm, 'a:off');
  const ext = getElementByTag(xfrm, 'a:ext');
  if (!off || !ext) return undefined;

  const rawX = parseInt(getAttr(off, 'x') ?? '0', 10);
  const rawY = parseInt(getAttr(off, 'y') ?? '0', 10);
  const rawW = parseInt(getAttr(ext, 'cx') ?? '0', 10);
  const rawH = parseInt(getAttr(ext, 'cy') ?? '0', 10);

  const normalized = transform
    ? {
        x: transform.offsetX + (rawX - transform.childOffsetX) * transform.scaleX,
        y: transform.offsetY + (rawY - transform.childOffsetY) * transform.scaleY,
        w: rawW * transform.scaleX,
        h: rawH * transform.scaleY,
      }
    : {
        x: rawX,
        y: rawY,
        w: rawW,
        h: rawH,
      };

  return {
    x: emuToInches(normalized.x),
    y: emuToInches(normalized.y),
    w: emuToInches(normalized.w),
    h: emuToInches(normalized.h),
  };
}

/**
 * 由当前 group 的 `a:xfrm` 与父级 transform 累计出本 group 的子元素 transform。
 * 不存在父级 transform 时，等同于只走当前 group 的本地映射。
 */
export function buildGroupTransform(
  xfrm: XmlElement,
  parentTransform?: GroupTransform,
): GroupTransform {
  const off = getElementByTag(xfrm, 'a:off');
  const ext = getElementByTag(xfrm, 'a:ext');
  const chOff = getElementByTag(xfrm, 'a:chOff');
  const chExt = getElementByTag(xfrm, 'a:chExt');

  const rawOffX = parseInt(getAttr(off!, 'x') ?? '0', 10);
  const rawOffY = parseInt(getAttr(off!, 'y') ?? '0', 10);
  const rawExtX = parseInt(getAttr(ext!, 'cx') ?? '0', 10);
  const rawExtY = parseInt(getAttr(ext!, 'cy') ?? '0', 10);
  const rawChildOffX = parseInt(getAttr(chOff!, 'x') ?? '0', 10);
  const rawChildOffY = parseInt(getAttr(chOff!, 'y') ?? '0', 10);
  const rawChildExtX = parseInt(getAttr(chExt!, 'cx') ?? '1', 10);
  const rawChildExtY = parseInt(getAttr(chExt!, 'cy') ?? '1', 10);

  const localScaleX = rawChildExtX === 0 ? 1 : rawExtX / rawChildExtX;
  const localScaleY = rawChildExtY === 0 ? 1 : rawExtY / rawChildExtY;

  if (!parentTransform) {
    return {
      offsetX: rawOffX,
      offsetY: rawOffY,
      scaleX: localScaleX,
      scaleY: localScaleY,
      childOffsetX: rawChildOffX,
      childOffsetY: rawChildOffY,
    };
  }

  return {
    offsetX:
      parentTransform.offsetX
      + (rawOffX - parentTransform.childOffsetX) * parentTransform.scaleX,
    offsetY:
      parentTransform.offsetY
      + (rawOffY - parentTransform.childOffsetY) * parentTransform.scaleY,
    scaleX: parentTransform.scaleX * localScaleX,
    scaleY: parentTransform.scaleY * localScaleY,
    childOffsetX: rawChildOffX,
    childOffsetY: rawChildOffY,
  };
}
