/**
 * FreeformCompiler
 *
 * 第二层编译器：将 FreeformSlideSpec 编译为 PPTX
 * 使用 PptxGenJS 生成原生 PowerPoint 对象，支持 text/shape/image/group
 */

import PptxGenJS from 'pptxgenjs';
import type {
  Box,
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
  mapPosition,
  mapShapeShadowToProps,
  mapTextParagraphLineSpacingToProps,
  mapTextParagraphStyleToProps,
  mapTextRunStyleToProps,
  resolveShapeTextLayout,
} from './visual/presentationVisualDefaults';
import { resolveImageAsset, toPptxImageSource } from './assets/imageAssetResolver';
import { buildPptxImageProps } from './assets/pptxImageProps';
import { applyFreeformTransform, buildFreeformGroupTransform, IDENTITY_FREEFORM_TRANSFORM, type FreeformTransform } from './shared/freeformTransform';
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
  registerPptxBackgroundPaint,
  registerPptxShapePaint,
  type PptxPaintCompileContext,
} from './visual/pptxPaintPatchPlan';
import { buildSvgGraphicImageProps } from './svgGraphic/rendering/svgGraphicPptx';
import type { SvgGraphicCompileContext } from './types';
import {
  type FormulaPptxCompileContext,
} from './mathFormula/pptx/formulaPptxPlan';

import { registerShapeTextAutofit, type ShapeTextAutofitContext } from './text/shapeTextAutofitPptx';

export class FreeformPptxCompiler {

  /** 编译单页到已有 pptx 实例 */
  compileSlide(
    pptx: unknown,
    spec: FreeformSlideSpec,
    _theme?: ThemeSpec,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
    shapeTextContext?: ShapeTextAutofitContext,
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
        IDENTITY_FREEFORM_TRANSFORM,
        paintContext,
        svgGraphicContext,
        formulaContext,
        shapeTextContext,
      );
    }

    if (spec.notes) {
      slide.addNotes(spec.notes);
    }
  }

  private compileElement(
    slide: PptxGenJS.Slide,
    el: FreeformElement,
    transform: FreeformTransform = IDENTITY_FREEFORM_TRANSFORM,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
    shapeTextContext?: ShapeTextAutofitContext,
  ): void {
    switch (el.type) {
      case 'text':
        this.addText(slide, el, transform, formulaContext);
        break;
      case 'shape':
        this.addShape(slide, el, transform, paintContext, shapeTextContext);
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
        this.addGroup(slide, el, transform, paintContext, svgGraphicContext, formulaContext, shapeTextContext);
        break;
    }
  }

  private addFormula(
    slide: PptxGenJS.Slide,
    el: Extract<FreeformElement, { type: 'formula' }>,
    transform: FreeformTransform,
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
    transform: FreeformTransform,
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
          { wrap: el.textWrap, verticalAlign: el.style?.valign },
        ),
      } as PptxGenJS.TextPropsOptions);
    } else if (Array.isArray(el.content)) {
      // 富文本行距由首个 run 承载，避免 textbox 再叠加一次。
      const richTextBoxStyle = { ...textStyle };
      delete richTextBoxStyle.lineSpacing;
      delete richTextBoxStyle.lineSpacingMultiple;
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
          { wrap: el.textWrap, verticalAlign: el.style?.valign },
        ),
        ...(textBox ? { objectName: textBox.objectName } : {}),
      } as PptxGenJS.TextPropsOptions);
    }
  }

  private addShape(
    slide: PptxGenJS.Slide,
    el: FreeformShapeElement,
    transform: FreeformTransform,
    paintContext?: PptxPaintCompileContext,
    shapeTextContext?: ShapeTextAutofitContext,
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

    const shapeText = typeof el.content === 'string'
      ? el.content
      : el.content?.map((run) => run.text).join('') ?? '';
    if (shapeText.length > 0) {
      const rotated = el.style?.rotate != null;
      const textLayout = resolveShapeTextLayout(el.position, shapeText, el.style, rotated);
      const textOptions: Omit<PptxGenJS.TextPropsOptions, 'shape'> = {
        ...opts,
        ...mapTextParagraphStyleToProps(el.style),
        align: textLayout.align,
        fontSize: textLayout.fontSize,
        // 形状的纵向锚点由 resolveShapeTextLayout 决定，经同一布局合同写出。
        ...resolveGeneratedPptxTextLayoutOptions(
          el.position,
          'shrink-text',
          'shape-inner-text',
          { padding: textLayout.paddingInches, verticalAlign: textLayout.valign },
        ),
      };
      const content = typeof el.content === 'string'
        ? el.content
        : (el.content ?? []).map((run): PptxGenJS.TextProps => ({
          text: run.text,
          options: mapTextRunStyleToProps(run.style) as PptxGenJS.TextPropsOptions,
        }));
      if (shapeTextContext) {
        textOptions.objectName = registerShapeTextAutofit(
          shapeTextContext, opts.objectName,
        );
      }
      addPptxShapeText(slide, content, geometry, textOptions);
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
    transform: FreeformTransform,
  ): void {
    if (!el.src) return;
    slide.addImage(buildPptxImageProps({ ...el, src: el.src }, this.applyTransform(el.position, transform)));
  }

  private addGroup(
    slide: PptxGenJS.Slide,
    el: FreeformGroupElement,
    transform: FreeformTransform,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
    shapeTextContext?: ShapeTextAutofitContext,
  ): void {
    if (!el.children?.length) return;

    const groupTransform = buildFreeformGroupTransform(el, transform, quantizePptxBox);
    for (const child of el.children) {
      this.compileElement(
        slide,
        child,
        groupTransform,
        paintContext,
        svgGraphicContext,
        formulaContext,
        shapeTextContext,
      );
    }
  }

  private applyTransform(box: Box, transform: FreeformTransform): Box {
    return quantizePptxBox(applyFreeformTransform(box, transform));
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

/** 保留旧 PPTX 输出的量化时点；测量与 patch 路径继续使用完整精度。 */
function quantizePptxBox(box: Box): Box {
  const r3 = (value: number): number => Math.round(value * 1000) / 1000;
  return { x: r3(box.x), y: r3(box.y), w: r3(box.w), h: r3(box.h) };
}
