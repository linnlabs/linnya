/**
 * DeckAssembler
 *
 * Deck 组装器：合并多层编译器的输出为最终 PPTX
 * 支持 structured + freeform 混合 deck
 */

import PptxGenJS from 'pptxgenjs';
import type { DeckSpec } from '@plugin/slides/shared';
import type {
  DeckAssembleOptions,
  FreeformCompilerPort,
  ImageSourceResolverPort,
  SlidesEngineLogger,
  StructuredCompilerPort,
  SvgGraphicAssetResolverPort,
  SvgGraphicFallbackRasterizerPort,
} from './types';
import { prefetchPptxImages } from './assets/imagePrefetch';
import { resolveImageSources } from './assets/imageSourceResolver';
import { resolveSvgGraphicAssets } from './assets/svgGraphicAssetResolver';
import { PptxPackageSanitizer } from './pptx/PptxPackageSanitizer';
import {
  createPptxPaintCompileContext,
  createPptxPaintPatchPlan,
} from './visual/pptxPaintPatchPlan';
import { initializePptxDocument } from './pptx/initializePptxDocument';
import { createSvgGraphicPptxPlan } from './svgGraphic/pptx/svgGraphicPptxPlan';
import { SvgGraphicMaterializationError } from './svgGraphic/definitions/svgGraphicMaterializationError';
import {
  createFormulaPptxCompileContext,
  createFormulaPptxPatchPlan,
} from './mathFormula/pptx/formulaPptxPlan';

const defaultLogger: SlidesEngineLogger = {
  info() {},
  warn() {},
};

export class DeckAssembler {
  private readonly sanitizer = new PptxPackageSanitizer();

  constructor(
    private readonly structuredCompiler: StructuredCompilerPort,
    private readonly freeformCompiler: FreeformCompilerPort,
    private readonly imageSourceResolver?: ImageSourceResolverPort,
    private readonly logger: SlidesEngineLogger = defaultLogger,
    private readonly svgGraphicAssetResolver?: SvgGraphicAssetResolverPort,
    private readonly svgGraphicFallbackRasterizer?: SvgGraphicFallbackRasterizerPort,
  ) {}

  private createPptx(): PptxGenJS {
    const ctor =
      (PptxGenJS as unknown as { default?: new () => PptxGenJS }).default ??
      (PptxGenJS as unknown as new () => PptxGenJS);
    return new ctor();
  }

  /** 组装完整 deck，支持 structured + freeform 混合 */
  async assemble(deckSpec: DeckSpec, options?: DeckAssembleOptions): Promise<Buffer> {
    // 图片解析与 PPTX 内联是本次编译的物化步骤，不能改写作者源引用。
    // 否则仓库会把 data URI 当成新的 deck.js 语义持久化，破坏修订可读性。
    const materializedDeckSpec = structuredClone(deckSpec);
    if (this.imageSourceResolver) {
      await resolveImageSources(
        materializedDeckSpec,
        this.imageSourceResolver,
        options?.assetContext
      );
    }
    const svgAssets = this.svgGraphicAssetResolver
      ? await resolveSvgGraphicAssets(
        materializedDeckSpec,
        this.svgGraphicAssetResolver,
        options?.assetContext,
      )
      : new Map();
    await prefetchPptxImages(materializedDeckSpec);

    const hasFreeform = materializedDeckSpec.slides.some(s => s.spec.type === 'freeform');
    const hasSvgGraphic = svgAssets.size > 0;
    const svgGraphicFallbackRasterizer = this.svgGraphicFallbackRasterizer;
    let svgGraphicPptxPlan: Awaited<ReturnType<typeof createSvgGraphicPptxPlan>> | undefined;
    if (hasSvgGraphic) {
      if (!svgGraphicFallbackRasterizer) {
        throw new SvgGraphicMaterializationError(
          'slides.svg.render_failed',
          'SVG Graphic fallback rasterizer is unavailable.',
        );
      }
      svgGraphicPptxPlan = await createSvgGraphicPptxPlan(
        materializedDeckSpec,
        svgAssets,
        svgGraphicFallbackRasterizer,
      );
    }
    const structuredSlideCount = materializedDeckSpec.slides.filter(
      slide => slide.spec.type === 'structured'
    ).length;
    const freeformSlideCount = materializedDeckSpec.slides.length - structuredSlideCount;

    this.logger.info('[assemble] Starting deck assembly', {
      title: materializedDeckSpec.title,
      slideCount: materializedDeckSpec.slides.length,
      layout: materializedDeckSpec.layout ?? '16x9',
      hasFreeform,
      structuredSlideCount,
      freeformSlideCount,
    });

    if (!hasFreeform && !hasSvgGraphic) {
      this.logger.info('[assemble] Using structured compiler fast path', {
        title: materializedDeckSpec.title,
        slideCount: materializedDeckSpec.slides.length,
      });
      const buffer = await this.structuredCompiler.compileDeck(materializedDeckSpec);
      this.logger.info('[assemble] Structured compiler completed', {
        title: materializedDeckSpec.title,
        bufferBytes: buffer.length,
      });
      return buffer;
    }

    // 混合 deck：用同一个 PptxGenJS 实例按顺序编译
    const pptx = this.createPptx();
    const paintPlan = createPptxPaintPatchPlan();
    const formulaPlan = createFormulaPptxPatchPlan();
    initializePptxDocument(pptx, materializedDeckSpec);

    for (let slideIndex = 0; slideIndex < materializedDeckSpec.slides.length; slideIndex++) {
      const entry = materializedDeckSpec.slides[slideIndex];
      const paintContext = createPptxPaintCompileContext(paintPlan, slideIndex);
      if (entry.spec.type === 'structured') {
        this.structuredCompiler.compileSlide(
          pptx,
          entry.spec,
          materializedDeckSpec.theme,
          paintContext,
          svgGraphicPptxPlan?.createCompileContext(slideIndex + 1, svgAssets),
          createFormulaPptxCompileContext(formulaPlan, slideIndex),
        );
      } else if (entry.spec.type === 'freeform') {
        this.freeformCompiler.compileSlide(
          pptx,
          entry.spec,
          materializedDeckSpec.theme,
          paintContext,
          svgGraphicPptxPlan?.createCompileContext(slideIndex + 1, svgAssets),
          createFormulaPptxCompileContext(formulaPlan, slideIndex),
        );
      }
    }

    this.logger.info('[assemble] Starting pptx.write() export for mixed/freeform deck', {
      title: materializedDeckSpec.title,
      slideCount: materializedDeckSpec.slides.length,
      structuredSlideCount,
      freeformSlideCount,
    });
    const result = await pptx.write({ outputType: 'nodebuffer' });
    const rawBuffer = Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBuffer);
    this.logger.info('[assemble] pptx.write() resolved', {
      title: materializedDeckSpec.title,
      resultType: Buffer.isBuffer(result)
        ? 'Buffer'
        : result instanceof Uint8Array
          ? 'Uint8Array'
          : result instanceof ArrayBuffer
            ? 'ArrayBuffer'
            : typeof result,
      rawBufferBytes: rawBuffer.length,
    });
    const sanitizedBuffer = await this.sanitizer.sanitize(rawBuffer, {
      paintPlan,
      declaredThemeFonts: materializedDeckSpec.theme?.fonts,
      svgGraphicFallbacks: svgGraphicPptxPlan?.fallbackEntries,
      formulaPlan,
    });
    this.logger.info('[assemble] Sanitized PPTX buffer ready', {
      title: materializedDeckSpec.title,
      sanitizedBufferBytes: sanitizedBuffer.length,
    });
    return sanitizedBuffer;
  }
}
