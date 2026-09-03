import { resolveSlideSizeInches } from '@plugin/slides/shared/deckSpec';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { resolveImageSources } from '../assets/imageSourceResolver';
import { resolveSvgGraphicAssets } from '../assets/svgGraphicAssetResolver';
import { RenderModelMapper } from '../parser/RenderModelMapper';
import {
  applyTextLayoutToRenderModel,
  prewarmTextLayoutForRenderModel,
} from '../text/renderModelTextLayout';
import type {
  DeckAssembleOptions,
  ImageSourceResolverPort,
  SlidesEngineRenderModelOptions,
  SlidesEngineVersionSnapshot,
  SvgGraphicAssetResolverPort,
} from '../types';

/**
 * 只从已编译的 generated DeckSpec 构造渲染模型。
 *
 * 该能力刻意不依赖 PPTX reader、assembler 或 mutation compiler，使只读宿主
 * 能复用生产渲染语义，而无需装配完整作者工具链。
 */
export class GeneratedPresentationRenderModelBuilder {
  private readonly renderModelMapper = new RenderModelMapper();

  constructor(
    private readonly imageSourceResolver?: ImageSourceResolverPort,
    private readonly svgGraphicAssetResolver?: SvgGraphicAssetResolverPort,
  ) {}

  async build(
    nodeId: string,
    version: SlidesEngineVersionSnapshot,
    assembleOptions?: DeckAssembleOptions,
    options: SlidesEngineRenderModelOptions = {}
  ): Promise<PresentationRenderModel> {
    if (version.sourceKind !== 'generated') {
      throw new Error('Generated render-model builder requires a generated presentation version');
    }
    // render-model 物化不得改写 repository 返回的版本快照。
    const materializedDeckSpec = structuredClone(version.deckSpec);
    if (this.imageSourceResolver) {
      await resolveImageSources(
        materializedDeckSpec,
        this.imageSourceResolver,
        assembleOptions?.assetContext
      );
    }
    const svgAssets = this.svgGraphicAssetResolver
      ? await resolveSvgGraphicAssets(
        materializedDeckSpec,
        this.svgGraphicAssetResolver,
        assembleOptions?.assetContext,
      )
      : new Map();
    const renderModel = this.renderModelMapper.fromGeneratedDeck(
      nodeId,
      version.versionNumber,
      version.title,
      materializedDeckSpec,
      resolveSlideSizeInches(materializedDeckSpec.layout),
      { canEditSourceSelection: options.canEditSourceSelection === true },
      svgAssets,
    );
    await prewarmTextLayoutForRenderModel(renderModel);
    return applyTextLayoutToRenderModel(renderModel);
  }
}
