import type {
  DeckSpec,
  FreeformElement,
  SvgGraphicResolvedAsset,
} from '@plugin/slides/shared';
import type {
  SvgGraphicCompileContext,
  SvgGraphicFallbackRasterizerPort,
  SvgGraphicPptxPlacement,
} from '../../types';
import { readSvgGraphicFallbackPngSize } from './svgGraphicPng';
import { SvgGraphicMaterializationError } from '../definitions/svgGraphicMaterializationError';

export interface SvgGraphicPptxFallbackPlanEntry {
  readonly slideNumber: number;
  readonly objectName: string;
  readonly canonicalSvg: string;
  readonly contentHash: string;
  readonly fallbackPngBytes: Uint8Array;
}

export interface SvgGraphicPptxPlan {
  readonly fallbackEntries: readonly SvgGraphicPptxFallbackPlanEntry[];
  createCompileContext(
    slideNumber: number,
    assets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
  ): SvgGraphicCompileContext;
}

/** 已在 hidden renderer 中完成的 SVG fallback；可安全传给纯计算 Worker。 */
export interface SvgGraphicPptxRasterizedFallback {
  readonly assetId: string;
  readonly contentHash: string;
  readonly pngBytes: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
}

interface SvgGraphicOccurrence {
  readonly assetId: string;
  readonly placement: SvgGraphicPptxPlacement;
}

export async function createSvgGraphicPptxPlan(
  deckSpec: DeckSpec,
  assets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
  rasterizer: SvgGraphicFallbackRasterizerPort,
): Promise<SvgGraphicPptxPlan> {
  const rasterizedFallbacks = await rasterizeSvgGraphicPptxFallbacks(assets, rasterizer);
  return buildSvgGraphicPptxPlan(deckSpec, assets, rasterizedFallbacks);
}

/**
 * 只执行需要浏览器能力的 SVG -> PNG 阶段。
 * PPTX/ZIP Worker 复用该结果，不会反向持有 hidden renderer。
 */
export async function rasterizeSvgGraphicPptxFallbacks(
  assets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
  rasterizer: SvgGraphicFallbackRasterizerPort,
): Promise<readonly SvgGraphicPptxRasterizedFallback[]> {
  const fallbackByAssetId = new Map<string, SvgGraphicPptxRasterizedFallback>();
  try {
    await Promise.all([...assets.values()].map(async (asset) => {
      const result = await rasterizer.rasterizeSvgGraphic({
        canonicalSvg: asset.canonicalSvg,
        contentHash: asset.contentHash,
        viewBox: asset.viewBox,
      });
      const size = readSvgGraphicFallbackPngSize(result.pngBytes);
      if (size.widthPx !== result.widthPx || size.heightPx !== result.heightPx) {
        throw new Error('SVG Graphic fallback PNG dimensions do not match the rasterizer result.');
      }
      fallbackByAssetId.set(asset.assetId, {
        assetId: asset.assetId,
        contentHash: asset.contentHash,
        pngBytes: result.pngBytes,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
      });
    }));
  } catch (error) {
    throw new SvgGraphicMaterializationError(
      'slides.svg.render_failed',
      error instanceof Error
        ? `SVG Graphic fallback rendering failed: ${error.message}`
        : 'SVG Graphic fallback rendering failed.',
    );
  }

  return [...fallbackByAssetId.values()];
}

export function buildSvgGraphicPptxPlan(
  deckSpec: DeckSpec,
  assets: ReadonlyMap<string, SvgGraphicResolvedAsset>,
  rasterizedFallbacks: readonly SvgGraphicPptxRasterizedFallback[],
): SvgGraphicPptxPlan {
  const fallbackByAssetId = new Map(
    rasterizedFallbacks.map(fallback => [fallback.assetId, fallback]),
  );

  const occurrencesBySlide = new Map<number, readonly SvgGraphicOccurrence[]>();
  const fallbackEntries: SvgGraphicPptxFallbackPlanEntry[] = [];
  for (let slideIndex = 0; slideIndex < deckSpec.slides.length; slideIndex++) {
    const slide = deckSpec.slides[slideIndex];
    const packageSlideNumber = slideIndex + 1;
    const assetIds = collectSlideSvgGraphicAssetIds(slide.spec);
    const occurrences = assetIds.map((assetId, index): SvgGraphicOccurrence => {
      const asset = assets.get(assetId);
      const fallback = fallbackByAssetId.get(assetId);
      if (!asset || !fallback || fallback.contentHash !== asset.contentHash) {
        throw new Error('SVG Graphic PPTX plan requires resolved vector and fallback media.');
      }
      const placement = {
        objectName: `Linnya SVG Graphic ${packageSlideNumber}-${index + 1}`,
      };
      fallbackEntries.push({
        slideNumber: packageSlideNumber,
        objectName: placement.objectName,
        canonicalSvg: asset.canonicalSvg,
        contentHash: asset.contentHash,
        fallbackPngBytes: fallback.pngBytes,
      });
      return { assetId, placement };
    });
    occurrencesBySlide.set(packageSlideNumber, occurrences);
  }

  return {
    fallbackEntries,
    createCompileContext(slideNumber, resolvedAssets) {
      const occurrences = occurrencesBySlide.get(slideNumber) ?? [];
      let cursor = 0;
      return {
        assets: resolvedAssets,
        nextPlacement(assetId) {
          const occurrence = occurrences[cursor];
          if (!occurrence || occurrence.assetId !== assetId) {
            throw new Error('SVG Graphic compiler order diverged from the PPTX fallback plan.');
          }
          cursor += 1;
          return occurrence.placement;
        },
      };
    },
  };
}

function collectSlideSvgGraphicAssetIds(
  spec: DeckSpec['slides'][number]['spec'],
): string[] {
  if (spec.type === 'structured') {
    return spec.elements
      .filter(element => element.type === 'svgGraphic')
      .map(element => element.asset.assetId);
  }
  const assetIds: string[] = [];
  collectFreeformSvgGraphicAssetIds(spec.elements, assetIds);
  return assetIds;
}

function collectFreeformSvgGraphicAssetIds(
  elements: readonly FreeformElement[],
  assetIds: string[],
): void {
  for (const element of elements) {
    if (element.type === 'svgGraphic') {
      assetIds.push(element.asset.assetId);
    } else if (element.type === 'group' && element.children) {
      collectFreeformSvgGraphicAssetIds(element.children, assetIds);
    }
  }
}
