/**
 * FreeformCompiler
 *
 * 第二层编译器：将 FreeformSlideSpec 编译为 PPTX
 * 使用 PptxGenJS 生成原生 PowerPoint 对象，支持 text/shape/image/group
 */

import PptxGenJS from 'pptxgenjs';
import type {
  Box,
  DeckSpec,
  FreeformElement,
  FreeformGroupElement,
  FreeformImageElement,
  FreeformShapeElement,
  FreeformSlideSpec,
  FreeformTextElement,
  Paint,
  ThemeSpec,
} from '@plugin/slides/shared';
import {
  clamp,
  mapImageShadowToProps,
  mapPosition,
  mapShapeShadowToProps,
  mapTextParagraphLineSpacingToProps,
  mapTextParagraphStyleToProps,
  mapTextRunStyleToProps,
  resolveShapeTextLayout,
} from './visual/presentationVisualDefaults';
import { resolveImageAsset, toPptxImageSource } from './assets/imageAssetResolver';
import { PptxPackageSanitizer } from './pptx/PptxPackageSanitizer';
import {
  addPptxCustomGeometryShape,
  addPptxShapeText,
  resolvePptxShapeGeometry,
} from './shape/pptxShapeGeometryAdapter';
import { resolveGeneratedPptxTextLayoutOptions } from './text/textLayoutPptxOptions';
import {
  mapPaintToPptxFill,
  mapStrokePaintToPptxLine,
  requiresNativePptxPaintPatch,
} from './visual/pptxPaintCompileAdapter';
import {
  createPptxPaintCompileContext,
  createPptxPaintPatchPlan,
  registerPptxBackgroundPaint,
  registerPptxShapePaint,
  type PptxPaintCompileContext,
} from './visual/pptxPaintPatchPlan';
import { initializePptxDocument } from './pptx/initializePptxDocument';
import { buildSvgGraphicImageProps } from './svgGraphic/rendering/svgGraphicPptx';
import type { SvgGraphicCompileContext } from './types';
import {
  createFormulaPptxCompileContext,
  createFormulaPptxPatchPlan,
  type FormulaPptxCompileContext,
} from './mathFormula/pptx/formulaPptxPlan';

interface Transform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

const IDENTITY_TRANSFORM: Transform = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
};


export class FreeformCompiler {
  private readonly sanitizer = new PptxPackageSanitizer();

  private createPptx(): PptxGenJS {
    const ctor = (
      PptxGenJS as unknown as { default?: new () => PptxGenJS }
    ).default ?? (PptxGenJS as unknown as new () => PptxGenJS);
    return new ctor();
  }

  /** 编译单页到已有 pptx 实例 */
  compileSlide(
    pptx: unknown,
    spec: FreeformSlideSpec,
    _theme?: ThemeSpec,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
  ): void {
    const inst = pptx as PptxGenJS;
    const slide = inst.addSlide();

    if (spec.background) {
      if (spec.background.image) {
        slide.background = toPptxImageSource(resolveImageAsset(spec.background.image));
      } else {
        const paint = resolveBackgroundPaint(spec.background);
        if (paint) {
          slide.background = mapPaintToPptxFill(paint);
          if (paintContext && requiresNativePptxPaintPatch(paint)) {
            registerPptxBackgroundPaint(paintContext, paint);
          }
        }
      }
    }

    for (const el of spec.elements) {
      this.compileElement(
        slide,
        el,
        IDENTITY_TRANSFORM,
        paintContext,
        svgGraphicContext,
        formulaContext,
      );
    }

    if (spec.notes) {
      slide.addNotes(spec.notes);
    }
  }

  /** 编译完整 freeform deck */
  async compileDeck(deckSpec: DeckSpec): Promise<Buffer> {
    const pptx = this.createPptx();
    initializePptxDocument(pptx, deckSpec);

    const paintPlan = createPptxPaintPatchPlan();
    const formulaPlan = createFormulaPptxPatchPlan();
    for (let slideIndex = 0; slideIndex < deckSpec.slides.length; slideIndex++) {
      const entry = deckSpec.slides[slideIndex];
      if (entry.spec.type !== 'freeform') {
        throw new Error(
          'Structured slides are not supported by FreeformCompiler. Use DeckAssembler for mixed decks.',
        );
      }
      this.compileSlide(
        pptx,
        entry.spec,
        deckSpec.theme,
        createPptxPaintCompileContext(paintPlan, slideIndex),
        undefined,
        createFormulaPptxCompileContext(formulaPlan, slideIndex),
      );
    }

    const result = await pptx.write({ outputType: 'nodebuffer' });
    return this.sanitizer.sanitize(Buffer.from(result as ArrayBuffer), {
      paintPlan,
      formulaPlan,
      declaredThemeFonts: deckSpec.theme?.fonts,
    });
  }

  private compileElement(
    slide: PptxGenJS.Slide,
    el: FreeformElement,
    transform: Transform = IDENTITY_TRANSFORM,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
  ): void {
    switch (el.type) {
      case 'text':
        this.addText(slide, el, transform, formulaContext);
        break;
      case 'shape':
        this.addShape(slide, el, transform, paintContext);
        break;
      case 'image':
        this.addImage(slide, el, transform);
        break;
      case 'svgGraphic':
        if (!svgGraphicContext) {
          throw new Error('Freeform SVG Graphic compilation requires materialized content.');
        }
        slide.addImage(buildSvgGraphicImageProps(
          el,
          this.applyTransform(el.position, transform),
          svgGraphicContext,
        ));
        break;
      case 'formula':
        if (!formulaContext) {
          throw new Error('Freeform Formula compilation requires a formula context.');
        }
        this.addFormula(slide, el, transform, formulaContext);
        break;
      case 'group':
        this.addGroup(slide, el, transform, paintContext, svgGraphicContext, formulaContext);
        break;
    }
  }

  private addFormula(
    slide: PptxGenJS.Slide,
    el: Extract<FreeformElement, { type: 'formula' }>,
    transform: Transform,
    formulaContext: FormulaPptxCompileContext,
  ): void {
    const position = this.applyTransform(el.position, transform);
    const entry = formulaContext.register(el.source, position);
    slide.addText(entry.placeholderToken, {
      ...mapPosition(position),
      objectName: entry.objectName,
      fontFace: 'Cambria Math',
      fontSize: el.source.fontSize,
      color: el.source.color.slice(1),
      margin: 0,
    });
  }

  private addText(
    slide: PptxGenJS.Slide,
    el: FreeformTextElement,
    transform: Transform,
    formulaContext?: FormulaPptxCompileContext,
  ): void {
    const textStyle = mapTextParagraphStyleToProps(el.style);
    const pos = mapPosition(this.applyTransform(el.position, transform));

    if (typeof el.content === 'string') {
      slide.addText(el.content, {
        ...pos,
        ...textStyle,
        ...resolveGeneratedPptxTextLayoutOptions(
          el.position,
          'resize-shape',
          'plain-textbox',
          { wrap: el.textWrap },
        ),
      } as PptxGenJS.TextPropsOptions);
    } else if (Array.isArray(el.content)) {
      const {
        lineSpacing: _lineSpacing,
        lineSpacingMultiple: _lineSpacingMultiple,
        ...richTextBoxStyle
      } = textStyle;
      const paragraphLineSpacing = mapTextParagraphLineSpacingToProps(el.style);
      const hasFormula = el.content.some((run) => 'formula' in run);
      if (hasFormula && !formulaContext) {
        throw new Error('Inline Formula compilation requires a formula context.');
      }
      const textBox = hasFormula ? formulaContext?.createInlineTextBox(el.position) : undefined;
      const runs: PptxGenJS.TextProps[] = el.content.map((run, index) => {
        if ('text' in run) {
          return {
            text: run.text,
            options: {
              ...mapTextRunStyleToProps(run.style),
              ...(index === 0 ? paragraphLineSpacing : {}),
            } as PptxGenJS.TextPropsOptions,
          };
        }
        if (!textBox) throw new Error('Inline Formula text box context is missing.');
        const entry = textBox.register(run.formula);
        return {
          text: entry.placeholderToken,
          options: {
            fontFace: 'Cambria Math',
            fontSize: run.formula.fontSize,
            color: run.formula.color.slice(1),
            ...(index === 0 ? paragraphLineSpacing : {}),
          },
        };
      });
      slide.addText(runs, {
        ...pos,
        ...richTextBoxStyle,
        ...resolveGeneratedPptxTextLayoutOptions(
          el.position,
          'resize-shape',
          'plain-textbox',
          { wrap: el.textWrap },
        ),
        ...(textBox ? { objectName: textBox.objectName } : {}),
      } as PptxGenJS.TextPropsOptions);
    }
  }

  private addShape(
    slide: PptxGenJS.Slide,
    el: FreeformShapeElement,
    transform: Transform,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
  ): void {
    const position = this.applyTransform(el.position, transform);
    const geometry = resolvePptxShapeGeometry(el.geometry, position);
    const opts: PptxGenJS.ShapeProps = {
      ...mapPosition(position),
    };
    if (geometry.points) opts.points = geometry.points;

    const paint = el.style ? resolveShapePaint(el.style) : undefined;
    const strokePaint = el.style?.border
      ? el.style.border.paint
        ?? (el.style.border.color ? { type: 'solid' as const, color: el.style.border.color } : undefined)
      : undefined;
    if (paint) opts.fill = mapPaintToPptxFill(paint, el.style?.opacity);
    if (el.style?.border && strokePaint) {
      opts.line = mapStrokePaintToPptxLine(
        strokePaint,
        el.style.border.width,
        el.style.border.dash,
      );
    }
    const patchFill = requiresNativePptxPaintPatch(paint) ? paint : undefined;
    const patchStroke = requiresNativePptxPaintPatch(strokePaint) ? strokePaint : undefined;
    if (paintContext && (patchFill || (el.style?.border && patchStroke))) {
      opts.objectName = registerPptxShapePaint(paintContext, {
        fill: patchFill,
        fillOpacity: patchFill ? el.style?.opacity : undefined,
        stroke: el.style?.border && patchStroke
          ? {
              paint: patchStroke,
              width: el.style.border.width,
              dash: el.style.border.dash,
            }
          : undefined,
      });
    }
    if (el.style?.borderRadius != null) opts.rectRadius = el.style.borderRadius;
    if (el.style?.shadow) opts.shadow = mapShapeShadowToProps(el.style.shadow);
    if (el.style?.rotate != null) opts.rotate = el.style.rotate;
    if (el.style?.opacity != null) {
      const effectivePaint = paint ?? { type: 'solid' as const, color: '#FFFFFF' };
      opts.fill = mapPaintToPptxFill(effectivePaint, el.style.opacity);
      if (!el.style.border) {
        opts.line = {
          color: 'FFFFFF',
          transparency: 100,
          width: 0,
        };
      }
    }

    if (el.content && typeof el.content === 'string') {
      const rotated = el.style?.rotate != null;
      const textLayout = resolveShapeTextLayout(el.position, el.content, el.style, rotated);
      const textOptions: Omit<PptxGenJS.TextPropsOptions, 'shape'> = {
        ...opts,
        ...mapTextParagraphStyleToProps(el.style),
        align: textLayout.align,
        valign: textLayout.valign,
        fontSize: textLayout.fontSize,
        ...resolveGeneratedPptxTextLayoutOptions(
          el.position,
          'shrink-text',
          'shape-inner-text',
          { padding: textLayout.paddingInches },
        ),
      };
      addPptxShapeText(slide, el.content, geometry, textOptions);
    } else {
      if (geometry.shapeName === 'custGeom') {
        addPptxCustomGeometryShape(slide, opts);
      } else {
        slide.addShape(geometry.shapeName, opts);
      }
    }
  }

  private addImage(
    slide: PptxGenJS.Slide,
    el: FreeformImageElement,
    transform: Transform,
  ): void {
    if (!el.src) return;
    const asset = resolveImageAsset(el.src);
    const position = this.applyTransform(el.position, transform);
    const imgOpts: PptxGenJS.ImageProps = {
      ...mapPosition(position),
      ...toPptxImageSource(asset),
    };
    if (el.alt) imgOpts.altText = el.alt;
    imgOpts.sizing = {
      type: el.fitMode === 'crop' ? 'cover' : (el.fitMode ?? 'contain'),
      w: position.w,
      h: position.h,
    };
    if (el.rounding != null || el.maskShape === 'circle') imgOpts.rounding = el.maskShape === 'circle' ? true : el.rounding;
    if (el.transparency != null) imgOpts.transparency = clamp(Math.round(el.transparency * 100), 0, 100);
    if (el.shadow) imgOpts.shadow = mapImageShadowToProps(el.shadow);
    if (el.rotate != null) imgOpts.rotate = el.rotate;
    if (el.flipH != null) imgOpts.flipH = el.flipH;
    if (el.flipV != null) imgOpts.flipV = el.flipV;
    slide.addImage(imgOpts);
  }

  private addGroup(
    slide: PptxGenJS.Slide,
    el: FreeformGroupElement,
    transform: Transform,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
  ): void {
    if (!el.children?.length) return;

    const groupTransform = this.buildGroupTransform(el, transform);
    for (const child of el.children) {
      this.compileElement(
        slide,
        child,
        groupTransform,
        paintContext,
        svgGraphicContext,
        formulaContext,
      );
    }
  }

  private applyTransform(box: Box, transform: Transform): Box {
    return {
      x: r3(transform.offsetX + box.x * transform.scaleX),
      y: r3(transform.offsetY + box.y * transform.scaleY),
      w: r3(box.w * transform.scaleX),
      h: r3(box.h * transform.scaleY),
    };
  }

  private buildGroupTransform(group: FreeformGroupElement, parent: Transform): Transform {
    const groupBox = this.applyTransform(group.position, parent);
    const bounds = this.measureChildrenBounds(group.children);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
      return {
        offsetX: groupBox.x,
        offsetY: groupBox.y,
        scaleX: parent.scaleX,
        scaleY: parent.scaleY,
      };
    }

    return {
      offsetX: groupBox.x - bounds.x * (groupBox.w / bounds.w),
      offsetY: groupBox.y - bounds.y * (groupBox.h / bounds.h),
      scaleX: groupBox.w / bounds.w,
      scaleY: groupBox.h / bounds.h,
    };
  }

  private measureChildrenBounds(children?: FreeformElement[]): Box | null {
    if (!children?.length) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const child of children) {
      minX = Math.min(minX, child.position.x);
      minY = Math.min(minY, child.position.y);
      maxX = Math.max(maxX, child.position.x + child.position.w);
      maxY = Math.max(maxY, child.position.y + child.position.h);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return null;
    }

    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  }
}

function resolveBackgroundPaint(
  background: NonNullable<FreeformSlideSpec['background']>,
): Paint | undefined {
  return background.paint
    ?? background.gradient
    ?? (background.color ? { type: 'solid', color: background.color } : undefined);
}

function resolveShapePaint(style: NonNullable<FreeformShapeElement['style']>): Paint | undefined {
  return style.paint
    ?? style.gradient
    ?? (style.fill ? { type: 'solid', color: style.fill } : undefined);
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
