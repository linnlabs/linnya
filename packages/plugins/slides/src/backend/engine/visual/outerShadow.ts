import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import { DEFAULT_SHADOW_OPACITY, toPptxHexColor, type ShapeShadow } from '@plugin/slides/shared';

const POINT_TO_EMU = 12_700;
const OOXML_ANGLE_UNIT = 60_000;
const OOXML_PERCENT_UNIT = 100_000;

/** 外阴影的极坐标形式：blur / distance 单位 pt，angle 为 0–359 的整数度，color 不带 #。 */
export interface ResolvedOuterShadow {
  readonly color: string;
  readonly blur: number;
  readonly distance: number;
  readonly angle: number;
  readonly opacity: number;
}

/**
 * 外阴影的唯一换算：DeckSpec 的直角偏移（pt）→ PPTX 使用的极坐标，并补上缺省不透明度。
 * PptxGenJS 属性（`mapShapeShadowToProps`）、`a:outerShdw` 补丁（`createOuterShadowEffectList`）
 * 都从这里取值，不各自再算一遍 dist / dir / alpha。
 */
export function resolveOuterShadow(shadow: ShapeShadow): ResolvedOuterShadow {
  const angle = Math.atan2(shadow.offsetY, shadow.offsetX) * (180 / Math.PI);
  return {
    color: toPptxHexColor(shadow.color, 'shadow.color'),
    blur: shadow.blur,
    distance: Math.hypot(shadow.offsetX, shadow.offsetY),
    angle: normalizePptxShadowAngle(angle),
    opacity: shadow.opacity ?? DEFAULT_SHADOW_OPACITY,
  };
}

/**
 * PptxGenJS 只收 0–359 的整数角度，越界一律换成 270°（向上）。偏移朝右上时 atan2 给负角，
 * 所以先折回 0–360 再取整；0 值靠仓库对 PptxGenJS 的补丁按原值写出（上游用 `||` 取默认）。
 */
export function normalizePptxShadowAngle(angle: number): number {
  const degrees = Math.round(((angle % 360) + 360) % 360);
  return degrees === 360 ? 0 : degrees;
}

export interface OuterShadowEffectListOptions {
  /** 写入 `a:outerShdw@algn`；缺省不写。 */
  readonly align?: 'tl';
}

/** 构造 `<a:effectLst><a:outerShdw/></a:effectLst>`，alpha 始终显式写出。 */
export function createOuterShadowEffectList(
  doc: XmlDocument,
  shadow: ShapeShadow,
  options: OuterShadowEffectListOptions = {},
): XmlElement {
  const resolved = resolveOuterShadow(shadow);
  const outerShadow = doc.createElement('a:outerShdw');
  outerShadow.setAttribute('blurRad', String(Math.round(resolved.blur * POINT_TO_EMU)));
  outerShadow.setAttribute('dist', String(Math.round(resolved.distance * POINT_TO_EMU)));
  outerShadow.setAttribute('dir', String(resolved.angle * OOXML_ANGLE_UNIT));
  if (options.align) outerShadow.setAttribute('algn', options.align);
  outerShadow.setAttribute('rotWithShape', '0');

  const color = doc.createElement('a:srgbClr');
  color.setAttribute('val', resolved.color);
  const alpha = doc.createElement('a:alpha');
  alpha.setAttribute('val', String(Math.round(resolved.opacity * OOXML_PERCENT_UNIT)));
  color.appendChild(alpha);
  outerShadow.appendChild(color);

  const effectList = doc.createElement('a:effectLst');
  effectList.appendChild(outerShadow);
  return effectList;
}
