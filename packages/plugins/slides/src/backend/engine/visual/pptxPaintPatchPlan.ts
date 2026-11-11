import type { Paint, ResolvedShapeGeometry, StrokePaint, TextEffects } from '@plugin/slides/shared';

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

/** 图片的形状遮罩：PptxGenJS 只会写 rect / ellipse，导出后把图片的 prstGeom 换成这份几何。 */
export interface PptxPictureGeometryPatch {
  marker: string;
  geometry: ResolvedShapeGeometry;
}

/** 文字效果：PptxGenJS 写不出渐变、空心和字符阴影，导出后改写该文本框里每个 `a:rPr`。 */
export interface PptxTextEffectsPatch {
  marker: string;
  effects: TextEffects;
}

export interface PptxSlidePaintPatch {
  slideIndex: number;
  background?: Paint;
  shapes: PptxShapePaintPatch[];
  pictures: PptxPictureGeometryPatch[];
  texts: PptxTextEffectsPatch[];
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

export function registerPptxPictureGeometry(
  context: PptxPaintCompileContext,
  geometry: ResolvedShapeGeometry,
): string {
  const slide = resolveSlidePatch(context);
  const marker = `${PAINT_MARKER_PREFIX}s${context.slideIndex + 1}-g${slide.pictures.length + 1}`;
  slide.pictures.push({ marker, geometry });
  return marker;
}

export function registerPptxTextEffects(
  context: PptxPaintCompileContext,
  effects: TextEffects,
): string {
  const slide = resolveSlidePatch(context);
  const marker = `${PAINT_MARKER_PREFIX}s${context.slideIndex + 1}-t${slide.texts.length + 1}`;
  slide.texts.push({ marker, effects });
  return marker;
}

/**
 * 带文字效果的文本框登记补丁并返回 objectName。行内公式文本框的 objectName 已被公式补丁占用，
 * 合同层已拒绝两者同用；这里再挡一次，避免 DeckSpec 绕过合同时静默丢效果。
 */
export function resolveTextEffectsObjectName(
  element: { content?: string | readonly object[]; style?: { effects?: TextEffects } },
  context: PptxPaintCompileContext | undefined,
): string | undefined {
  const effects = element.style?.effects;
  if (!effects) return undefined;
  if (Array.isArray(element.content) && element.content.some((run) => 'formula' in run)) {
    throw new Error('文字效果不能用在含行内公式的文本上。');
  }
  if (!context) throw new Error('文字效果导出需要 PPTX Paint 上下文。');
  return registerPptxTextEffects(context, effects);
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
    pictures: [],
    texts: [],
  };
  context.plan.slides.push(created);
  return created;
}
