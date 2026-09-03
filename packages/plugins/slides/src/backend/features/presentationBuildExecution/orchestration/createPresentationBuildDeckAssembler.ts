import type {
  DeckAssembleOptions,
  DeckAssemblerPort,
  ImageSourceResolverPort,
  SlidesEngineLogger,
  SvgGraphicAssetResolverPort,
  SvgGraphicFallbackRasterizerPort,
} from '@plugin/slides/backend-engine-core';
import type { DeckSpec } from '@plugin/slides/shared';

import type { PresentationMaterializationExecutionPort } from '../definitions/presentationBuildExecution';
import { preparePresentationMaterialization } from './preparePresentationMaterialization';

export function createPresentationBuildDeckAssembler(input: {
  readonly execution: PresentationMaterializationExecutionPort;
  readonly imageSourceResolver?: ImageSourceResolverPort;
  readonly svgGraphicAssetResolver?: SvgGraphicAssetResolverPort;
  readonly svgGraphicFallbackRasterizer?: SvgGraphicFallbackRasterizerPort;
  readonly logger?: SlidesEngineLogger;
}): DeckAssemblerPort {
  return Object.freeze({
    async assemble(deckSpec: DeckSpec, options?: DeckAssembleOptions) {
      const startedAt = Date.now();
      input.logger?.info('slides_materialization.prepare.start', {
        title: deckSpec.title,
        slideCount: deckSpec.slides.length,
      });
      const materialization = await preparePresentationMaterialization(
        deckSpec,
        options,
        {
          ...(input.imageSourceResolver
            ? { imageSourceResolver: input.imageSourceResolver }
            : {}),
          ...(input.svgGraphicAssetResolver
            ? { svgGraphicAssetResolver: input.svgGraphicAssetResolver }
            : {}),
          ...(input.svgGraphicFallbackRasterizer
            ? { svgGraphicFallbackRasterizer: input.svgGraphicFallbackRasterizer }
            : {}),
        },
      );
      input.logger?.info('slides_materialization.prepare.success', {
        title: deckSpec.title,
        slideCount: deckSpec.slides.length,
        svgAssetCount: materialization.svgAssets.length,
        durationMs: Date.now() - startedAt,
      });
      const result = await input.execution.materializePresentation(materialization);
      return Buffer.from(result);
    },
  });
}
