import type { Paint, StrokePaint } from '@plugin/slides/shared';

const PAINT_MARKER_PREFIX = 'linnya-paint:';

export interface PptxShapePaintPatch {
  marker: string;
  fill?: Paint;
  stroke?: {
    paint: StrokePaint;
    width: number;
    dash?: 'solid' | 'dash' | 'dot';
  };
  /** ShapeStyle.opacity 只作用于填充，保持现有 deck.js 语义。 */
  fillOpacity?: number;
}

export interface PptxSlidePaintPatch {
  slideIndex: number;
  background?: Paint;
  shapes: PptxShapePaintPatch[];
}

/**
 * 编译期 Paint 计划只存在于内存中；PPTX 对象名仅保存短 marker，
 * 不再承载渐变 JSON，避免对象名长度、编码和信息泄漏问题。
 */
export interface PptxPaintPatchPlan {
  slides: PptxSlidePaintPatch[];
}

export interface PptxPaintCompileContext {
  plan: PptxPaintPatchPlan;
  slideIndex: number;
}

export function createPptxPaintPatchPlan(): PptxPaintPatchPlan {
  return { slides: [] };
}

export function createPptxPaintCompileContext(
  plan: PptxPaintPatchPlan,
  slideIndex: number,
): PptxPaintCompileContext {
  return { plan, slideIndex };
}

export function registerPptxBackgroundPaint(
  context: PptxPaintCompileContext,
  paint: Paint,
): void {
  const slide = resolveSlidePatch(context);
  slide.background = paint;
}

export function registerPptxShapePaint(
  context: PptxPaintCompileContext,
  patch: Omit<PptxShapePaintPatch, 'marker'>,
): string {
  const slide = resolveSlidePatch(context);
  const marker = `${PAINT_MARKER_PREFIX}s${context.slideIndex + 1}-p${slide.shapes.length + 1}`;
  slide.shapes.push({ marker, ...patch });
  return marker;
}

export function isPptxPaintMarker(value: string): boolean {
  return value.startsWith(PAINT_MARKER_PREFIX);
}

function resolveSlidePatch(context: PptxPaintCompileContext): PptxSlidePaintPatch {
  const existing = context.plan.slides.find((slide) => slide.slideIndex === context.slideIndex);
  if (existing) return existing;
  const created: PptxSlidePaintPatch = {
    slideIndex: context.slideIndex,
    shapes: [],
  };
  context.plan.slides.push(created);
  return created;
}
