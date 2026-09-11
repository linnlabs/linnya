/**
 * StructuredCompiler
 *
 * 第一层编译器：将 StructuredSlideSpec 编译为 PPTX
 * 使用 PptxGenJS 生成原生 PowerPoint 对象
 */

import PptxGenJS from 'pptxgenjs';
import type {
  DeckSpec,
  Paint,
  StructuredElement,
  StructuredSlideSpec,
  TableCell as DomainTableCell,
  ThemeSpec,
} from '@plugin/slides/shared';
import { TABLE_DEFAULT_HEADER_FILL } from '@plugin/slides/shared';
import {
  buildTableColumnWidths,
  buildTableRowHeights,
  clamp,
  estimateTableDensity,
  mapImageShadowToProps,
  mapPosition,
  mapShapeShadowToProps,
  mapTextParagraphStyleToProps,
  resolveShapeTextLayout,
  stripHash,
} from './visual/presentationVisualDefaults';
import { resolveImageAsset, toPptxImageSource } from './assets/imageAssetResolver';
import { resolvePptxImageFitOptions } from './assets/imageSizing';
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
import { addNativeChart, type ChartPptxContext, type ChartPptxPatch } from './chart/chartPptx';
import { buildSvgGraphicImageProps } from './svgGraphic/rendering/svgGraphicPptx';
import type { SvgGraphicCompileContext } from './types';
import {
  createFormulaPptxCompileContext,
  createFormulaPptxPatchPlan,
  type FormulaPptxCompileContext,
} from './mathFormula/pptx/formulaPptxPlan';

// ─── 编译器 ─────────────────────────────────────────────────────────────────

export class StructuredCompiler {
  private readonly sanitizer = new PptxPackageSanitizer();

  private createPptx(): PptxGenJS {
    const ctor = (
      PptxGenJS as unknown as { default?: new () => PptxGenJS }
    ).default ?? (PptxGenJS as unknown as new () => PptxGenJS);
    return new ctor();
  }

  /** 编译单页 */
  compileSlide(
    pptx: unknown,
    spec: StructuredSlideSpec,
    theme?: ThemeSpec,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
    chartContext?: ChartPptxContext,
  ): void {
    const inst = pptx as PptxGenJS;
    const slide = inst.addSlide();

    // 背景
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

    // 元素
    for (const el of spec.elements) {
      this.compileElement(slide, el, inst, theme, paintContext, svgGraphicContext, formulaContext, chartContext);
    }

    // 演讲者备注
    if (spec.notes) {
      slide.addNotes(spec.notes);
    }
  }

  /** 编译完整 deck */
  async compileDeck(deckSpec: DeckSpec): Promise<Buffer> {
    const pptx = this.createPptx();
    initializePptxDocument(pptx, deckSpec);

    const paintPlan = createPptxPaintPatchPlan();
    const formulaPlan = createFormulaPptxPatchPlan();
    const chartPlan: ChartPptxPatch[] = [];
    for (let slideIndex = 0; slideIndex < deckSpec.slides.length; slideIndex++) {
      const entry = deckSpec.slides[slideIndex];
      if (entry.spec.type !== 'structured') {
        throw new Error(
          'Freeform slides are not supported by StructuredCompiler. Use DeckAssembler to validate deck composition.',
        );
      }
      this.compileSlide(
        pptx,
        entry.spec,
        deckSpec.theme,
        createPptxPaintCompileContext(paintPlan, slideIndex),
        undefined,
        createFormulaPptxCompileContext(formulaPlan, slideIndex),
        { plan: chartPlan, slideIndex },
      );
    }

    const result = await pptx.write({ outputType: 'nodebuffer' });
    return this.sanitizer.sanitize(Buffer.from(result as ArrayBuffer), {
      paintPlan,
      formulaPlan,
      chartPlan,
      declaredThemeFonts: deckSpec.theme?.fonts,
    });
  }

  // ─── 私有：元素分发 ───────────────────────────────────────────────────────

  private compileElement(
    slide: PptxGenJS.Slide,
    el: StructuredElement,
    pptx: PptxGenJS,
    theme?: ThemeSpec,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
    chartContext?: ChartPptxContext,
  ): void {
    switch (el.type) {
      case 'title':
        this.addTitle(slide, el);
        break;
      case 'text':
        this.addText(slide, el, formulaContext);
        break;
      case 'bulletList':
        this.addBulletList(slide, el);
        break;
      case 'numberedList':
        this.addNumberedList(slide, el);
        break;
      case 'chart':
        addNativeChart(slide, el, theme, chartContext);
        break;
      case 'table':
        this.addTable(slide, el);
        break;
      case 'image':
        this.addImage(slide, el);
        break;
      case 'svgGraphic':
        if (!svgGraphicContext) {
          throw new Error('Structured SVG Graphic compilation requires materialized content.');
        }
        slide.addImage(buildSvgGraphicImageProps(el, el.position, svgGraphicContext));
        break;
      case 'formula':
        if (!formulaContext) {
          throw new Error('Structured Formula compilation requires a formula context.');
        }
        this.addFormula(slide, el, formulaContext);
        break;
      case 'shape':
        this.addShape(slide, el, paintContext);
        break;
    }
  }

  private addFormula(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'formula' }>,
    formulaContext: FormulaPptxCompileContext,
  ): void {
    const entry = formulaContext.register(el.source, el.position);
    slide.addText(entry.placeholderToken, {
      ...mapPosition(el.position),
      objectName: entry.objectName,
      fontFace: 'Cambria Math',
      fontSize: el.source.fontSize,
      color: el.source.color.slice(1),
      margin: 0,
    });
  }

  // ─── 私有：各元素编译 ─────────────────────────────────────────────────────

  private addTitle(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'title' }>,
  ): void {
    const opts: PptxGenJS.TextPropsOptions = {
      ...mapPosition(el.position),
      ...mapTextParagraphStyleToProps(el.style),
      ...resolveGeneratedPptxTextLayoutOptions(
        el.position,
        'resize-shape',
        'title-textbox',
        { wrap: el.textWrap },
      ),
    };
    // title 默认加粗、字号 24
    if (opts.bold == null) opts.bold = true;
    if (opts.fontSize == null) opts.fontSize = 24;
    slide.addText(el.content, opts);
  }

  private addText(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'text' }>,
    formulaContext?: FormulaPptxCompileContext,
  ): void {
    const baseOptions: PptxGenJS.TextPropsOptions = {
      ...mapPosition(el.position),
      ...mapTextParagraphStyleToProps(el.style),
      ...resolveGeneratedPptxTextLayoutOptions(
        el.position,
        'resize-shape',
        'plain-textbox',
        { wrap: el.textWrap },
      ),
    };
    if (typeof el.content === 'string') {
      slide.addText(el.content, baseOptions);
      return;
    }
    if (!formulaContext) {
      throw new Error('Inline Formula compilation requires a formula context.');
    }
    const textBox = formulaContext.createInlineTextBox(el.position);
    const runs: PptxGenJS.TextProps[] = el.content.map((run) => {
      if ('text' in run) {
        return { text: run.text, options: mapTextParagraphStyleToProps(run.style) };
      }
      const entry = textBox.register(run.formula);
      return {
        text: entry.placeholderToken,
        options: {
          fontFace: 'Cambria Math',
          fontSize: run.formula.fontSize,
          color: run.formula.color.slice(1),
        },
      };
    });
    slide.addText(runs, { ...baseOptions, objectName: textBox.objectName });
  }

  private addBulletList(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'bulletList' }>,
  ): void {
    const textProps: PptxGenJS.TextProps[] = el.items.map((item) => ({
      text: item.text,
      options: {
        bullet: true,
        indentLevel: item.level ?? 0,
        ...mapTextParagraphStyleToProps(el.style),
      } as PptxGenJS.TextPropsOptions,
    }));
    slide.addText(textProps, {
      ...mapPosition(el.position),
      ...resolveGeneratedPptxTextLayoutOptions(el.position, 'resize-shape', 'bullet-textbox'),
    } as PptxGenJS.TextPropsOptions);
  }

  private addNumberedList(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'numberedList' }>,
  ): void {
    const textProps: PptxGenJS.TextProps[] = el.items.map((item) => ({
      text: item.text,
      options: {
        bullet: { type: 'number' },
        indentLevel: item.level ?? 0,
        ...mapTextParagraphStyleToProps(el.style),
      } as PptxGenJS.TextPropsOptions,
    }));
    slide.addText(textProps, {
      ...mapPosition(el.position),
      ...resolveGeneratedPptxTextLayoutOptions(el.position, 'resize-shape', 'bullet-textbox'),
    } as PptxGenJS.TextPropsOptions);
  }

  private addTable(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'table' }>,
  ): void {
    const density = estimateTableDensity(el.headers, el.rows);
    const totalRows = el.rows.length + (el.headers?.length ? 1 : 0);
    const dense = density > 110 || totalRows >= 5 || el.position.h <= 1.9;
    const requestedFontSize = (
      el.options
      && typeof el.options === 'object'
      && 'fontSize' in el.options
      && typeof (el.options as { fontSize?: unknown }).fontSize === 'number'
    )
      ? (el.options as { fontSize: number }).fontSize
      : undefined;
    const baseFontSize = clamp(
      requestedFontSize ?? (dense ? 9.5 : 11),
      8.5,
      el.position.h <= 1.6 ? 9.5 : 11.5,
    );
    const rows: PptxGenJS.TableRow[] = [];

    // 表头行（B8：fill 走 TABLE_DEFAULT_HEADER_FILL 共享常量，与 render-model / 前端三端对齐）
    if (el.headers && el.headers.length > 0) {
      rows.push(
        el.headers.map((h) => ({
          text: h,
          options: {
            bold: true,
            fill: { color: stripHash(TABLE_DEFAULT_HEADER_FILL, 'table.headerFill') },
            fontSize: Math.min(baseFontSize + 0.5, 11.5),
            margin: dense ? 0.03 : 0.05,
            fit: 'shrink',
          },
        } as PptxGenJS.TableCell)),
      );
    }

    // 数据行
    for (const row of el.rows) {
      rows.push(row.map((cell) => this.mapTableCell(cell, { fontSize: baseFontSize, dense })));
    }

    // PptxGenJS 类型上 TableProps 未包含 fit（fit 在 TextPropsOptions）；运行时表格 opt 会下发到单元格文本体，库会读取 options.fit
    const tableOpts: PptxGenJS.TableProps & Pick<PptxGenJS.TextPropsOptions, 'fit'> = {
      ...mapPosition(el.position),
      fontSize: baseFontSize,
      margin: dense ? 0.03 : 0.05,
      fit: 'shrink',
      valign: 'middle',
      colW: buildTableColumnWidths(el.position.w, el.headers, el.rows),
      rowH: buildTableRowHeights(el.position.h, totalRows, dense),
      ...(el.options as PptxGenJS.TableProps | undefined),
      ...(el.border ? { border: mapTableBorderToPptx(el.border) } : {}),
    };

    slide.addTable(rows, tableOpts);
  }

  private mapTableCell(
    cell: DomainTableCell,
    defaults?: { fontSize: number; dense: boolean },
  ): PptxGenJS.TableCell {
    const opts: PptxGenJS.TableCellProps = {
      ...mapTextParagraphStyleToProps(cell.style),
      fontSize: cell.style?.fontSize ?? defaults?.fontSize,
      margin: defaults?.dense ? 0.03 : 0.05,
    };
    if (cell.fill) opts.fill = { color: stripHash(cell.fill, 'table.fill') };
    if (cell.colspan != null) opts.colspan = cell.colspan;
    if (cell.rowspan != null) opts.rowspan = cell.rowspan;
    return { text: cell.text, options: opts };
  }

  private addImage(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'image' }>,
  ): void {
    const asset = resolveImageAsset(el.src);
    const fitOptions = resolvePptxImageFitOptions(el.position, asset, el.fitMode);
    const imgOpts: PptxGenJS.ImageProps = {
      ...fitOptions,
      ...toPptxImageSource(asset),
    };
    if (el.alt) imgOpts.altText = el.alt;
    if (fitOptions.sizing) imgOpts.sizing = fitOptions.sizing;
    if (el.rounding != null || el.maskShape === 'circle') imgOpts.rounding = el.maskShape === 'circle' ? true : el.rounding;
    if (el.transparency != null) imgOpts.transparency = clamp(Math.round(el.transparency * 100), 0, 100);
    if (el.shadow) imgOpts.shadow = mapImageShadowToProps(el.shadow);
    if (el.rotate != null) imgOpts.rotate = el.rotate;
    if (el.flipH != null) imgOpts.flipH = el.flipH;
    if (el.flipV != null) imgOpts.flipV = el.flipV;
    slide.addImage(imgOpts);
  }

  private addShape(
    slide: PptxGenJS.Slide,
    el: Extract<StructuredElement, { type: 'shape' }>,
    paintContext?: PptxPaintCompileContext,
  ): void {
    const shapeOpts: PptxGenJS.ShapeProps = {
      ...mapPosition(el.position),
    };

    if (el.style) {
      const paint = resolveShapePaint(el.style);
      const strokePaint = el.style.border
        ? el.style.border.paint
          ?? (el.style.border.color ? { type: 'solid' as const, color: el.style.border.color } : undefined)
        : undefined;
      if (paint) shapeOpts.fill = mapPaintToPptxFill(paint, el.style.opacity);
      if (el.style.border && strokePaint) {
        shapeOpts.line = mapStrokePaintToPptxLine(
          strokePaint,
          el.style.border.width,
          el.style.border.dash,
        );
      }
      const patchFill = requiresNativePptxPaintPatch(paint) ? paint : undefined;
      const patchStroke = requiresNativePptxPaintPatch(strokePaint) ? strokePaint : undefined;
      if (paintContext && (patchFill || (el.style.border && patchStroke))) {
        shapeOpts.objectName = registerPptxShapePaint(paintContext, {
          fill: patchFill,
          fillOpacity: patchFill ? el.style.opacity : undefined,
          stroke: el.style.border && patchStroke
            ? {
                paint: patchStroke,
                width: el.style.border.width,
                dash: el.style.border.dash,
              }
            : undefined,
        });
      }
      if (el.style.borderRadius != null) shapeOpts.rectRadius = el.style.borderRadius;
      if (el.style.shadow) shapeOpts.shadow = mapShapeShadowToProps(el.style.shadow);
      if (el.style.rotate != null) shapeOpts.rotate = el.style.rotate;
      if (el.style.opacity != null) {
        const effectivePaint = paint ?? { type: 'solid' as const, color: '#FFFFFF' };
        shapeOpts.fill = mapPaintToPptxFill(effectivePaint, el.style.opacity);
        if (!el.style.border) {
          shapeOpts.line = {
            color: stripHash('#FFFFFF', 'line.color'),
            transparency: 100,
            width: 0,
          };
        }
      }
    }

    const geometry = resolvePptxShapeGeometry(el.geometry, el.position);
    const shapeName = geometry.shapeName;
    if (geometry.points) shapeOpts.points = geometry.points;
    const rotated = el.style?.rotate != null;

    if (el.text && shapeName !== ('line' as PptxGenJS.SHAPE_NAME)) {
      const textLayout = resolveShapeTextLayout(el.position, el.text, undefined, rotated);
      const textOptions: Omit<PptxGenJS.TextPropsOptions, 'shape'> = {
        ...shapeOpts,
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
      addPptxShapeText(slide, el.text, geometry, textOptions);
      return;
    }

    if (shapeName === 'custGeom') {
      addPptxCustomGeometryShape(slide, shapeOpts);
    } else {
      slide.addShape(shapeName, shapeOpts);
    }
  }
}

function mapTableBorderToPptx(
  border: NonNullable<Extract<StructuredElement, { type: 'table' }>['border']>,
): PptxGenJS.BorderProps {
  const paint = border.paint;
  if (!paint || paint.type !== 'solid') {
    throw new Error('Table.border 目前只支持纯色描边。');
  }
  return {
    color: stripHash(paint.color, 'table.border.color'),
    pt: border.width,
    type: border.dash === 'dash' ? 'dash' : 'solid',
  };
}

function resolveBackgroundPaint(
  background: NonNullable<StructuredSlideSpec['background']>,
): Paint | undefined {
  return background.paint
    ?? background.gradient
    ?? (background.color ? { type: 'solid', color: background.color } : undefined);
}

function resolveShapePaint(style: NonNullable<Extract<StructuredElement, { type: 'shape' }>['style']>): Paint | undefined {
  return style.paint
    ?? style.gradient
    ?? (style.fill ? { type: 'solid', color: style.fill } : undefined);
}
