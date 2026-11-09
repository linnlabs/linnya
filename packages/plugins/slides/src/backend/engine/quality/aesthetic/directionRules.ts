/**
 * 方向贯彻检查：生成稿在 `theme.direction` 声明了背景、墨色、强调色与字体后，
 * 逐页对照实际页面是否还在这套方向里。
 *
 * 只对照声明与事实，不评价方向本身好坏：
 * - 背景：整页底色（满版形状优先于页面背景）离所有声明颜色都远 → 报告；满版照片不判。
 * - 字体：文字 run 声明的字体不在 fonts 里 → 报告；Office 本地化名称归一后再比。
 * - 颜色：彩色填充或文字的色相离所有声明彩色都远 → 复核；同色相的深浅不算偏离。
 * - 排除色相：底色、彩色填充或文字落进 imagePalette.excludedHues（OKLCH）→ 报告。
 * - 配色来源：有照片却没声明 imagePalette → 报告。手绘图和照片在这里分不开，全是手绘时由 Agent 声明 no_photos。
 */

import { hueDistance, rgbToOklch, toHex } from '@linnya/color-core';
import { hueRangeLabel, isColorExcluded, type HueRange } from '@linnya/color-core/palette';
import type { DirectionDeclaration } from '@plugin/slides/shared/designDirection';
import {
  assessFontDelivery,
  flattenSlideElements,
  type PresentationInfo,
  type SlideElementInfo,
  type SlideInfo,
} from '@plugin/slides/shared';
import { isNeutralColor, parseHex, rgbToHsl, type RgbColor } from '../colorUtils.js';
import type { AestheticLintIssue } from './types.js';

/** 满版判定：覆盖页面面积的比例。 */
const FULL_BLEED_COVERAGE = 0.95;
/** 背景与声明颜色的最大 CIE76 色差；超过即视为换了底色。 */
const BACKGROUND_DELTA_E_LIMIT = 12;
/** 彩色与声明彩色的最大色相差（度）；同色相的深浅都在这个范围内。 */
const PALETTE_HUE_LIMIT_DEG = 24;
/** 色相差超限但色差仍很小时（低饱和色色相不稳），仍算在调色板里。 */
const PALETTE_DELTA_E_LIMIT = 18;
/** 偏离色在全稿累计面积至少占一页的这个比例才报告，图标与小标记不算。 */
const OFF_PALETTE_MIN_AREA_RATIO = 0.01;
/** 图片至少占一页的这个比例才算照片，图标与小标记不算。 */
const PHOTO_MIN_AREA_RATIO = 0.05;
const MAX_OBSERVED = 6;

export function lintDirectionCarryThrough(
  info: PresentationInfo,
  direction: DirectionDeclaration | undefined,
): AestheticLintIssue[] {
  if (direction == null) return [];
  return [
    ...lintDirectionBackground(info, direction),
    ...lintDirectionFonts(info, direction),
    ...lintDirectionPalette(info, direction),
    ...lintDirectionExcludedHues(info, direction),
    ...lintDirectionImagePalette(info, direction),
  ];
}

// ─── 背景 ──────────────────────────────────────────────────────────────────

export function lintDirectionBackground(
  info: PresentationInfo,
  direction: DirectionDeclaration,
): AestheticLintIssue[] {
  const declared = [
    ...direction.palette.backgrounds,
    direction.palette.ink,
    ...direction.palette.accents,
  ];
  const declaredRgb = declared.map(parseHex).filter((rgb): rgb is RgbColor => rgb != null);
  const offSlides = new Map<string, number[]>();

  for (const slide of info.slides) {
    const background = resolveEffectiveBackground(slide, info.slideSize);
    if (background == null) continue;
    const matched = background.some((rgb) =>
      declaredRgb.some((candidate) => deltaE76(rgb, candidate) <= BACKGROUND_DELTA_E_LIMIT));
    if (matched) continue;
    const key = toUpperHex(background[0]!);
    offSlides.set(key, [...(offSlides.get(key) ?? []), slide.number]);
  }
  if (offSlides.size === 0) return [];

  const slides = [...offSlides.values()].flat().sort((left, right) => left - right);
  return [{
    code: 'direction_background_off',
    severity: 'warning',
    confidence: 'medium',
    slides,
    evidence: {
      kind: 'direction_carry_through',
      aspect: 'background',
      cardId: direction.cardId,
      declared: [...direction.palette.backgrounds],
      observed: [...offSlides.keys()].slice(0, MAX_OBSERVED),
      firstAffectedSlide: slides[0]!,
    },
  }];
}

/**
 * 整页看起来的底色。按绘制顺序叠加页面背景与满版纯色形状（带透明度混合）；
 * 满版照片、渐变形状或背景图让底色无法用一个颜色描述，返回 null 不判。
 * 页面背景是渐变时返回各色标，任意一个落在声明里即可。
 */
function resolveEffectiveBackground(
  slide: SlideInfo,
  slideSize: PresentationInfo['slideSize'],
): RgbColor[] | null {
  if (slide.backgroundImage === true) return null;
  let base = backgroundPaintColors(slide.backgroundPaint);
  const slideArea = slideSize.width * slideSize.height;
  const covering = flattenSlideElements(slide.elements)
    .map((element, order) => ({ element, order }))
    .filter(({ element }) => coversSlide(element, slideSize, slideArea))
    .sort((left, right) =>
      (left.element.zIndex ?? left.order) - (right.element.zIndex ?? right.order));

  for (const { element } of covering) {
    const opacity = element.opacity ?? 1;
    if (element.type === 'image' || element.type === 'svgGraphic') {
      if (opacity >= 0.6) return null;
      continue;
    }
    if (element.type !== 'shape') continue;
    const fill = parseHex(element.fill);
    if (fill == null) {
      const paint = element.shapeVisual?.paint;
      if (paint?.type === 'linear' || paint?.type === 'radial') {
        if (opacity >= 0.98) base = backgroundPaintColors(paint);
        else if (opacity >= 0.6) return null;
      }
      continue;
    }
    base = opacity >= 0.98 ? [fill] : base.map((color) => mixRgb(color, fill, opacity));
  }
  return base;
}

function coversSlide(
  element: SlideElementInfo,
  slideSize: PresentationInfo['slideSize'],
  slideArea: number,
): boolean {
  const box = element.position;
  if (box == null || slideArea <= 0) return false;
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(slideSize.width, box.x + box.w);
  const bottom = Math.min(slideSize.height, box.y + box.h);
  if (right <= left || bottom <= top) return false;
  return ((right - left) * (bottom - top)) / slideArea >= FULL_BLEED_COVERAGE;
}

function backgroundPaintColors(paint: SlideInfo['backgroundPaint']): RgbColor[] {
  const white = { r: 255, g: 255, b: 255 };
  if (paint == null || paint.type === 'none') return [white];
  if (paint.type === 'solid') return [parseHex(paint.color) ?? white];
  const stops = paint.stops.map((stop) => parseHex(stop.color)).filter((rgb): rgb is RgbColor => rgb != null);
  return stops.length > 0 ? stops : [white];
}

// ─── 字体 ──────────────────────────────────────────────────────────────────

export function lintDirectionFonts(
  info: PresentationInfo,
  direction: DirectionDeclaration,
): AestheticLintIssue[] {
  const declared = new Set(direction.fonts.map(canonicalFontKey));
  const undeclared = new Map<string, { family: string; slides: Set<number> }>();

  for (const slide of info.slides) {
    for (const element of flattenSlideElements(slide.elements)) {
      for (const run of collectRuns(element)) {
        const family = run.fontFamily?.trim();
        if (!family || !/\S/u.test(run.text)) continue;
        const key = canonicalFontKey(family);
        if (declared.has(key)) continue;
        const entry = undeclared.get(key) ?? { family, slides: new Set<number>() };
        entry.slides.add(slide.number);
        undeclared.set(key, entry);
      }
    }
  }
  if (undeclared.size === 0) return [];

  const slides = [...new Set([...undeclared.values()].flatMap((entry) => [...entry.slides]))]
    .sort((left, right) => left - right);
  return [{
    code: 'direction_font_undeclared',
    severity: 'warning',
    confidence: 'medium',
    slides,
    evidence: {
      kind: 'direction_carry_through',
      aspect: 'font',
      cardId: direction.cardId,
      declared: [...direction.fonts],
      observed: [...undeclared.values()].map((entry) => entry.family).slice(0, MAX_OBSERVED),
      firstAffectedSlide: slides[0]!,
    },
  }];
}

function collectRuns(element: SlideElementInfo) {
  const paragraphs = [
    ...(element.paragraphs ?? []),
    ...(element.tableInfo?.cells.flatMap((cell) => cell.paragraphs) ?? []),
  ];
  return paragraphs.flatMap((paragraph) => paragraph.runs);
}

/** 微软雅黑 / Microsoft YaHei 这类本地化名称归到同一个 key。 */
function canonicalFontKey(family: string): string {
  const officeFamily = assessFontDelivery(family, 'office').officeFamily;
  return (officeFamily ?? family).trim().toLocaleLowerCase('en-US');
}

// ─── 颜色 ──────────────────────────────────────────────────────────────────

export function lintDirectionPalette(
  info: PresentationInfo,
  direction: DirectionDeclaration,
): AestheticLintIssue[] {
  const declaredInk = [
    direction.palette.ink,
    ...(direction.palette.muted ? [direction.palette.muted] : []),
    ...direction.palette.accents,
    ...(direction.palette.chart ?? []),
  ];
  const paletteRgb = [...direction.palette.backgrounds, ...declaredInk]
    .map(parseHex).filter((rgb): rgb is RgbColor => rgb != null);
  const chromaticHues = paletteRgb
    .map(rgbToHsl)
    .filter((hsl) => !isNeutralColor(hsl))
    .map((hsl) => hsl.h);
  const offColors: ColorTally = new Map();

  for (const slide of info.slides) {
    for (const { rgb, area } of elementColors(slide)) {
      const hsl = rgbToHsl(rgb);
      if (isNeutralColor(hsl)) continue;
      const nearHue = chromaticHues.some((hue) => hueDistance(hue, hsl.h) <= PALETTE_HUE_LIMIT_DEG);
      const nearColor = paletteRgb.some((candidate) => deltaE76(rgb, candidate) <= PALETTE_DELTA_E_LIMIT);
      if (nearHue || nearColor) continue;
      tallyColor(offColors, rgb, slide.number, area);
    }
  }
  const ranked = rankColors(offColors, info);
  if (ranked.length === 0) return [];
  const slides = slidesOf(ranked);
  return [{
    code: 'direction_color_off_palette',
    severity: 'warning',
    confidence: 'medium',
    slides,
    evidence: {
      kind: 'direction_carry_through',
      aspect: 'color',
      cardId: direction.cardId,
      declared: declaredInk,
      observed: ranked.map(([hex]) => hex).slice(0, MAX_OBSERVED),
      firstAffectedSlide: slides[0]!,
    },
  }];
}

type ColorTally = Map<string, { slides: Set<number>; area: number }>;

function* elementColors(slide: SlideInfo): Generator<{ rgb: RgbColor; area: number }> {
  for (const element of flattenSlideElements(slide.elements)) {
    const area = element.position ? element.position.w * element.position.h : 0;
    for (const hex of [element.fill, element.textColor]) {
      const rgb = parseHex(hex);
      if (rgb != null) yield { rgb, area };
    }
  }
}

function tallyColor(tally: ColorTally, rgb: RgbColor, slideNumber: number, area: number): void {
  const key = toUpperHex(rgb);
  const entry = tally.get(key) ?? { slides: new Set<number>(), area: 0 };
  entry.slides.add(slideNumber);
  entry.area += area;
  tally.set(key, entry);
}

/** 累计面积够大的颜色，面积大的在前。 */
function rankColors(tally: ColorTally, info: PresentationInfo) {
  const minArea = info.slideSize.width * info.slideSize.height * OFF_PALETTE_MIN_AREA_RATIO;
  return [...tally.entries()]
    .filter(([, entry]) => entry.area >= minArea)
    .sort((left, right) => right[1].area - left[1].area);
}

function slidesOf(ranked: ReturnType<typeof rankColors>): number[] {
  return [...new Set(ranked.flatMap(([, entry]) => [...entry.slides]))]
    .sort((left, right) => left - right);
}

// ─── 排除色相与配色来源 ────────────────────────────────────────────────────

export function lintDirectionExcludedHues(
  info: PresentationInfo,
  direction: DirectionDeclaration,
): AestheticLintIssue[] {
  const source = direction.imagePalette;
  const ranges: readonly HueRange[] = source != null && 'excludedHues' in source ? source.excludedHues : [];
  if (ranges.length === 0) return [];

  const excluded: ColorTally = new Map();
  const slideArea = info.slideSize.width * info.slideSize.height;
  const record = (rgb: RgbColor, slideNumber: number, area: number) => {
    if (isColorExcluded(rgbToOklch([rgb.r, rgb.g, rgb.b]), ranges)) tallyColor(excluded, rgb, slideNumber, area);
  };
  for (const slide of info.slides) {
    for (const rgb of resolveEffectiveBackground(slide, info.slideSize) ?? []) record(rgb, slide.number, slideArea);
    for (const { rgb, area } of elementColors(slide)) record(rgb, slide.number, area);
  }
  const ranked = rankColors(excluded, info);
  if (ranked.length === 0) return [];
  const slides = slidesOf(ranked);
  return [{
    code: 'direction_color_excluded_hue',
    severity: 'warning',
    confidence: 'medium',
    slides,
    evidence: {
      kind: 'direction_carry_through',
      aspect: 'excluded_hue',
      cardId: direction.cardId,
      declared: ranges.map(([from, to]) => hueRangeLabel(from, to)),
      observed: ranked.map(([hex]) => hex).slice(0, MAX_OBSERVED),
      firstAffectedSlide: slides[0]!,
    },
  }];
}

export function lintDirectionImagePalette(
  info: PresentationInfo,
  direction: DirectionDeclaration,
): AestheticLintIssue[] {
  if (direction.imagePalette != null) return [];
  const minArea = info.slideSize.width * info.slideSize.height * PHOTO_MIN_AREA_RATIO;
  const slides = info.slides
    .filter((slide) => slide.backgroundImage === true || flattenSlideElements(slide.elements).some((element) =>
      element.type === 'image' && element.position != null && element.position.w * element.position.h >= minArea))
    .map((slide) => slide.number);
  if (slides.length === 0) return [];
  return [{
    code: 'direction_image_palette_missing',
    severity: 'warning',
    confidence: 'medium',
    slides,
    evidence: {
      kind: 'direction_carry_through',
      aspect: 'image_palette',
      cardId: direction.cardId,
      declared: ['未声明 imagePalette'],
      observed: [`${slides.length} 页有照片`],
      firstAffectedSlide: slides[0]!,
    },
  }];
}

// ─── 颜色工具 ──────────────────────────────────────────────────────────────

function mixRgb(base: RgbColor, top: RgbColor, opacity: number): RgbColor {
  const alpha = Math.max(0, Math.min(1, opacity));
  return {
    r: base.r * (1 - alpha) + top.r * alpha,
    g: base.g * (1 - alpha) + top.g * alpha,
    b: base.b * (1 - alpha) + top.b * alpha,
  };
}

function toUpperHex(rgb: RgbColor): string {
  return toHex([rgb.r, rgb.g, rgb.b]).toUpperCase();
}

/** sRGB → CIE Lab（D65），用于 CIE76 色差。 */
function rgbToLab(rgb: RgbColor): [number, number, number] {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(rgb.r);
  const g = linear(rgb.g);
  const b = linear(rgb.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (value: number) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(left: RgbColor, right: RgbColor): number {
  const [l1, a1, b1] = rgbToLab(left);
  const [l2, a2, b2] = rgbToLab(right);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
