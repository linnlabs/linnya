/**
 * ShapeVisualParser
 *
 * 把 `p:spPr` / `p:blipFill` 中的视觉信息（fill / border / cornerRadius / shadow / shapeKind / image fit / rotation）
 * 提取为单位化、可直接喂给 canonical / render-model 的字段。
 *
 * 单位严格遵守 ai-ppt §4.4 / §4.5 单位契约：
 * - 长度统一英寸（颜色 hex / shadow 单位 pt / 旋转单位度）
 * - 不依赖 PptxReader 主类，所有函数纯函数
 */

import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import type {
  ResolvedPathShapeGeometry,
  ShapePathCommand,
  SlideElementShapeVisual,
} from '@plugin/slides/shared';
import type { Paint } from '@plugin/slides/shared';
import { emuToInches } from '@plugin/backend/textMeasurement';
import { directChildren, getAttr, getElementByTag } from './XmlNode.js';

const OOXML_ANGLE_UNIT = 60_000;
const OOXML_PERCENT_UNIT = 100_000;

/**
 * OOXML 中 `a:srgbClr@val` 是 6 位 hex（不带 `#`），把它归一成 `#XXXXXX`。
 * 其他颜色种类（schemeClr / sysClr / prstClr）当前 imported 路径无法精确解析，返回 undefined 让上层 fallback。
 */
export function readSrgbColor(parent: XmlElement | null): string | undefined {
  if (!parent) return undefined;
  const srgb = getElementByTag(parent, 'a:srgbClr');
  if (!srgb) return undefined;
  const val = getAttr(srgb, 'val');
  if (!val) return undefined;
  return `#${val.toUpperCase()}`;
}

/** 解析 DrawingML 原生 fill；未知颜色类型返回 undefined，避免伪造视觉事实。 */
export function parseOoxmlPaint(parent: XmlElement | null): Paint | undefined {
  if (!parent) return undefined;
  if (directChildren(parent, 'a:noFill').length > 0) return { type: 'none' };

  const solidFill = directChildren(parent, 'a:solidFill')[0];
  if (solidFill) {
    const color = readSrgbColor(solidFill);
    if (!color) return undefined;
    const opacity = readColorOpacity(solidFill);
    return {
      type: 'solid',
      color,
      ...(opacity == null ? {} : { opacity }),
    };
  }

  const gradientFill = directChildren(parent, 'a:gradFill')[0];
  if (!gradientFill) return undefined;
  const stops = parseGradientStops(gradientFill);
  if (stops.length < 2) return undefined;
  const rotateWithShape = getAttr(gradientFill, 'rotWithShape') !== '0';
  const linear = directChildren(gradientFill, 'a:lin')[0];
  if (linear) {
    const angle = Number(getAttr(linear, 'ang') ?? '0') / OOXML_ANGLE_UNIT;
    if (!Number.isFinite(angle)) return undefined;
    return { type: 'linear', angle, stops, rotateWithShape };
  }

  const path = directChildren(gradientFill, 'a:path')[0];
  if (!path) return undefined;
  const tileRect = directChildren(gradientFill, 'a:tileRect')[0];
  const tileLeft = tileRect ? readOoxmlPercent(tileRect, 'l', 0) : 0;
  const tileTop = tileRect ? readOoxmlPercent(tileRect, 't', 0) : 0;
  const tileRight = 1 - (tileRect ? readOoxmlPercent(tileRect, 'r', 0) : 0);
  const tileBottom = 1 - (tileRect ? readOoxmlPercent(tileRect, 'b', 0) : 0);
  const tileWidth = tileRight - tileLeft;
  const tileHeight = tileBottom - tileTop;
  if (tileWidth <= 0 || tileHeight <= 0) return undefined;

  const fillToRect = directChildren(path, 'a:fillToRect')[0];
  const focusLeft = fillToRect ? readOoxmlPercent(fillToRect, 'l', 0.5) : 0.5;
  const focusTop = fillToRect ? readOoxmlPercent(fillToRect, 't', 0.5) : 0.5;
  const focusRight = 1 - (fillToRect ? readOoxmlPercent(fillToRect, 'r', 0.5) : 0.5);
  const focusBottom = 1 - (fillToRect ? readOoxmlPercent(fillToRect, 'b', 0.5) : 0.5);
  const focusCenterX = (focusLeft + focusRight) / 2;
  const focusCenterY = (focusTop + focusBottom) / 2;
  return {
    type: 'radial',
    stops,
    center: {
      x: tileLeft + focusCenterX * tileWidth,
      y: tileTop + focusCenterY * tileHeight,
    },
    radius: { x: tileWidth / 2, y: tileHeight / 2 },
    rotateWithShape,
  };
}

export function parseSlideBackgroundPaint(doc: XmlDocument): Paint | undefined {
  const commonSlideData = getElementByTag(doc, 'p:cSld');
  if (!commonSlideData) return undefined;
  const background = directChildren(commonSlideData, 'p:bg')[0];
  if (!background) return undefined;
  const properties = directChildren(background, 'p:bgPr')[0];
  return properties ? parseOoxmlPaint(properties) : undefined;
}

function parseGradientStops(gradientFill: XmlElement): Array<{
  color: string;
  position: number;
  opacity?: number;
}> {
  const stopList = directChildren(gradientFill, 'a:gsLst')[0];
  if (!stopList) return [];
  const stops: Array<{ color: string; position: number; opacity?: number }> = [];
  for (const stop of directChildren(stopList, 'a:gs')) {
    const color = readSrgbColor(stop);
    const position = Number(getAttr(stop, 'pos') ?? '') / OOXML_PERCENT_UNIT;
    if (!color || !Number.isFinite(position)) continue;
    const opacity = readColorOpacity(stop);
    stops.push({
      color,
      position,
      ...(opacity == null ? {} : { opacity }),
    });
  }
  return stops;
}

function readColorOpacity(parent: XmlElement): number | undefined {
  const alpha = getElementByTag(parent, 'a:alpha');
  if (!alpha) return undefined;
  const value = Number(getAttr(alpha, 'val') ?? '');
  return Number.isFinite(value) ? value / OOXML_PERCENT_UNIT : undefined;
}

function readOoxmlPercent(
  element: XmlElement,
  attribute: string,
  fallback: number,
): number {
  const value = Number(getAttr(element, attribute) ?? '') / OOXML_PERCENT_UNIT;
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 解析 `a:xfrm@rot` → 度。OOXML 用 60000 倍度（即 `rot=5400000` ⇒ 90°）。
 */
export function parseRotationDegrees(xfrm: XmlElement | null): number | undefined {
  if (!xfrm) return undefined;
  const rotRaw = getAttr(xfrm, 'rot');
  if (rotRaw == null) return undefined;
  const value = Number(rotRaw);
  if (!Number.isFinite(value) || value === 0) return undefined;
  return value / 60000;
}

/**
 * 从 `p:spPr` 中提取形状视觉属性（fill / border / cornerRadius / shadow / shapeKind）。
 * 单位严格按 ai-ppt §4.4 / §4.5 单位契约：
 * - border.width: pt（OOXML 内部 EMU → /12700 转 pt）
 * - cornerRadius: inches（按短边 × adj/100000 反推）
 * - shadow.{blur,offsetX,offsetY}: pt（OOXML EMU → /12700 转 pt，dir 60000-based 度极坐标转直角）
 *
 * 没有任何视觉负载（border / cornerRadius / shadow / shapeKind）时返回 visual=undefined，
 * 让调用方决定是否要保留 shapeKind。
 */
export function extractShapeVisual(spPr: XmlElement | null): {
  shapeKind?: string;
  fill?: string;
  visual?: SlideElementShapeVisual;
} {
  if (!spPr) return {};

  const prstGeom = getElementByTag(spPr, 'a:prstGeom');
  const shapeKind = prstGeom ? getAttr(prstGeom, 'prst') ?? undefined : undefined;
  const customGeometry = parseCustomGeometry(spPr);

  const paint = parseOoxmlPaint(spPr);
  const fill = paint?.type === 'solid' ? paint.color : undefined;

  const visual: SlideElementShapeVisual = {};
  if (shapeKind) visual.shapeKind = shapeKind;
  if (customGeometry) visual.geometry = customGeometry;
  if (paint) visual.paint = paint;

  const ln = getElementByTag(spPr, 'a:ln');
  if (ln) {
    const widthEmu = Number(getAttr(ln, 'w') ?? '0');
    const borderPaint = parseOoxmlPaint(ln);
    if (borderPaint && borderPaint.type !== 'radial' && Number.isFinite(widthEmu) && widthEmu > 0) {
      const dashEl = getElementByTag(ln, 'a:prstDash');
      const dashVal = dashEl ? getAttr(dashEl, 'val') : null;
      const dash: 'solid' | 'dash' | 'dot' | undefined =
        dashVal === 'dash' || dashVal === 'sysDash' || dashVal === 'lgDash'
          ? 'dash'
          : dashVal === 'dot' || dashVal === 'sysDot' || dashVal === 'lgDot'
            ? 'dot'
            : dashVal == null || dashVal === 'solid'
              ? 'solid'
              : undefined;
      visual.border = {
        paint: borderPaint,
        width: widthEmu / 12700,
        ...(dash ? { dash } : {}),
      };
    }
  }

  if (prstGeom && (shapeKind === 'roundRect' || shapeKind === 'round2SameRect')) {
    const avLst = getElementByTag(prstGeom, 'a:avLst');
    const gd = avLst ? getElementByTag(avLst, 'a:gd') : null;
    const adjRaw = gd ? Number(getAttr(gd, 'fmla')?.replace(/^val\s+/, '') ?? '') : Number.NaN;
    if (Number.isFinite(adjRaw) && adjRaw > 0 && spPr) {
      const xfrm = getElementByTag(spPr, 'a:xfrm');
      const ext = xfrm ? getElementByTag(xfrm, 'a:ext') : null;
      if (ext) {
        const wEmu = Number(getAttr(ext, 'cx') ?? '0');
        const hEmu = Number(getAttr(ext, 'cy') ?? '0');
        const shortEmu = Math.min(wEmu, hEmu);
        if (shortEmu > 0) {
          visual.cornerRadius = emuToInches(shortEmu) * (adjRaw / 100000);
        }
      }
    } else if (shapeKind === 'roundRect') {
      const xfrm = getElementByTag(spPr, 'a:xfrm');
      const ext = xfrm ? getElementByTag(xfrm, 'a:ext') : null;
      if (ext) {
        const wEmu = Number(getAttr(ext, 'cx') ?? '0');
        const hEmu = Number(getAttr(ext, 'cy') ?? '0');
        const shortEmu = Math.min(wEmu, hEmu);
        if (shortEmu > 0) {
          visual.cornerRadius = emuToInches(shortEmu) * (16667 / 100000);
        }
      }
    }
  }

  const effectLst = getElementByTag(spPr, 'a:effectLst');
  const outerShdw = effectLst ? getElementByTag(effectLst, 'a:outerShdw') : null;
  if (outerShdw) {
    const shadowColor = readSrgbColor(outerShdw) ?? '#000000';
    const blurRadEmu = Number(getAttr(outerShdw, 'blurRad') ?? '0');
    const distEmu = Number(getAttr(outerShdw, 'dist') ?? '0');
    const dirThousandths = Number(getAttr(outerShdw, 'dir') ?? '0');
    const alphaPct = (() => {
      const alphaEl = outerShdw.getElementsByTagName('a:alpha').item(0);
      if (!alphaEl) return undefined;
      const v = Number(getAttr(alphaEl, 'val') ?? '');
      return Number.isFinite(v) ? v / 100000 : undefined;
    })();

    const distPt = Number.isFinite(distEmu) ? distEmu / 12700 : 0;
    const blurPt = Number.isFinite(blurRadEmu) ? blurRadEmu / 12700 : 0;
    const angleDeg = Number.isFinite(dirThousandths) ? dirThousandths / 60000 : 0;
    const angleRad = (angleDeg * Math.PI) / 180;

    visual.shadow = {
      color: shadowColor,
      blur: blurPt,
      offsetX: distPt * Math.cos(angleRad),
      offsetY: distPt * Math.sin(angleRad),
      ...(alphaPct != null ? { opacity: alphaPct } : {}),
    };
  }

  const hasVisual =
    visual.shapeKind != null
    || visual.geometry != null
    || visual.paint != null
    || visual.border != null
    || visual.cornerRadius != null
    || visual.shadow != null;

  return {
    shapeKind,
    fill,
    visual: hasVisual ? visual : undefined,
  };
}

/** 回读 PptxGenJS / PowerPoint 写出的单 path custGeom。 */
export function parseCustomGeometry(spPr: XmlElement): ResolvedPathShapeGeometry | undefined {
  const customGeometry = getElementByTag(spPr, 'a:custGeom');
  const pathList = customGeometry ? directChildren(customGeometry, 'a:pathLst')[0] : undefined;
  const paths = pathList ? directChildren(pathList, 'a:path') : [];
  const path = paths.length === 1 ? paths[0] : undefined;
  if (!path) return undefined;
  const width = Number(getAttr(path, 'w') ?? '');
  const height = Number(getAttr(path, 'h') ?? '');
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }

  const commands: ShapePathCommand[] = [];
  for (const child of elementChildren(path)) {
    switch (child.tagName) {
      case 'a:moveTo': {
        const point = readPathPoint(child);
        if (!point) return undefined;
        commands.push({ type: 'moveTo', ...point });
        break;
      }
      case 'a:lnTo': {
        const point = readPathPoint(child);
        if (!point) return undefined;
        commands.push({ type: 'lineTo', ...point });
        break;
      }
      case 'a:quadBezTo': {
        const points = directChildren(child, 'a:pt').map(readPointElement);
        if (points.length !== 2 || points.some((point) => point == null)) return undefined;
        const [control, end] = points;
        if (!control || !end) return undefined;
        commands.push({ type: 'quadraticTo', x1: control.x, y1: control.y, x: end.x, y: end.y });
        break;
      }
      case 'a:cubicBezTo': {
        const points = directChildren(child, 'a:pt').map(readPointElement);
        if (points.length !== 3 || points.some((point) => point == null)) return undefined;
        const [control1, control2, end] = points;
        if (!control1 || !control2 || !end) return undefined;
        commands.push({
          type: 'cubicTo',
          x1: control1.x,
          y1: control1.y,
          x2: control2.x,
          y2: control2.y,
          x: end.x,
          y: end.y,
        });
        break;
      }
      case 'a:close':
        commands.push({ type: 'close' });
        break;
      default:
        return undefined;
    }
  }
  if (commands[0]?.type !== 'moveTo' || commands[commands.length - 1]?.type !== 'close') return undefined;
  return {
    type: 'path',
    viewBox: { width, height },
    commands,
    closed: true,
  };
}

function elementChildren(parent: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as XmlElement);
  }
  return children;
}

function readPathPoint(parent: XmlElement): { x: number; y: number } | undefined {
  const point = directChildren(parent, 'a:pt')[0];
  return point ? readPointElement(point) : undefined;
}

function readPointElement(point: XmlElement): { x: number; y: number } | undefined {
  const x = Number(getAttr(point, 'x') ?? '');
  const y = Number(getAttr(point, 'y') ?? '');
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/**
 * 从 `p:blipFill` 推断图片 fitMode。
 * - 含 `a:stretch`（OOXML 默认且最常见）→ 'stretch'（imported PPT 中的"撑满 frame"行为）
 * - 含 `a:tile` → 'fill'（铺贴退化）
 * - 兜底 'stretch'，与 OOXML 规范默认一致
 */
export function extractImageFitMode(
  blipFill: XmlElement | null,
): 'fill' | 'contain' | 'cover' | 'stretch' {
  if (!blipFill) return 'stretch';
  if (getElementByTag(blipFill, 'a:tile')) return 'fill';
  return 'stretch';
}
