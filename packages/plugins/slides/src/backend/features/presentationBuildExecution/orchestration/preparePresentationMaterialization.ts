import type { DeckSpec } from '@plugin/slides/shared';
import type {
  DeckAssembleOptions,
  ImageSourceResolverPort,
  SvgGraphicAssetResolverPort,
  SvgGraphicFallbackRasterizerPort,
} from '@plugin/slides/backend-engine-core';
import { prefetchPptxImages } from '../../../engine/assets/imagePrefetch';
import { resolveImageSources } from '../../../engine/assets/imageSourceResolver';
import { resolveSvgGraphicAssets } from '../../../engine/assets/svgGraphicAssetResolver';
import { rasterizeSvgGraphicPptxFallbacks } from '../../../engine/svgGraphic/pptx/svgGraphicPptxPlan';
import { SvgGraphicMaterializationError } from '../../../engine/svgGraphic/definitions/svgGraphicMaterializationError';

import type { PresentationMaterializationInput } from '../definitions/presentationBuildExecution';

export interface PreparePresentationMaterializationPorts {
  readonly imageSourceResolver?: ImageSourceResolverPort;
  readonly svgGraphicAssetResolver?: SvgGraphicAssetResolverPort;
  readonly svgGraphicFallbackRasterizer?: SvgGraphicFallbackRasterizerPort;
}

/**
 * 把 Host I/O 与浏览器能力收敛为一次性的纯内存 DTO。
 * 作者 DeckSpec 始终先克隆，解析结果不会污染持久化源码事实。
 */
export async function preparePresentationMaterialization(
  deckSpec: DeckSpec,
  options: DeckAssembleOptions | undefined,
  ports: PreparePresentationMaterializationPorts,
): Promise<PresentationMaterializationInput> {
  const preparedDeckSpec = structuredClone(deckSpec);
  if (ports.imageSourceResolver) {
    await resolveImageSources(
      preparedDeckSpec,
      ports.imageSourceResolver,
      options?.assetContext,
    );
  }
  await prefetchPptxImages(preparedDeckSpec);

  const svgAssets = ports.svgGraphicAssetResolver
    ? await resolveSvgGraphicAssets(
      preparedDeckSpec,
      ports.svgGraphicAssetResolver,
      options?.assetContext,
    )
    : new Map();
  if (svgAssets.size > 0 && !ports.svgGraphicFallbackRasterizer) {
    throw new SvgGraphicMaterializationError(
      'slides.svg.render_failed',
      'SVG Graphic fallback rasterizer is unavailable.',
    );
  }
  const svgFallbacks = ports.svgGraphicFallbackRasterizer
    ? await rasterizeSvgGraphicPptxFallbacks(
      svgAssets,
      ports.svgGraphicFallbackRasterizer,
    )
    : [];

  return {
    deckSpec: preparedDeckSpec,
    svgAssets: [...svgAssets.values()],
    svgFallbacks,
  };
}
