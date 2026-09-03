import {
  type DeckAssembleOptions,
  type ExportedPresentationFile,
  type PptxReaderPort,
  type SlidesEngineRenderModelOptions,
  type SlidesEngineVersionSnapshot,
  type ImageSourceResolverPort,
  type SvgGraphicAssetResolverPort,
} from '../types';
import type {
  DeckSpec,
  DeckPreview,
  PresentationInfo,
  PresentationRenderModel,
} from '@plugin/slides/shared';
import { resolveSlideSizeInches } from '@plugin/slides/shared';
import { CanonicalBuilder } from '../parser/CanonicalBuilder';
import { PreviewMapper } from '../parser/PreviewMapper';
import { RenderModelMapper } from '../parser/RenderModelMapper';
import {
  applyTextLayoutToRenderModel,
  prewarmTextLayoutForRenderModel,
} from '../text/renderModelTextLayout';
import { GeneratedPresentationRenderModelBuilder } from './GeneratedPresentationRenderModelBuilder';

export class PptPresentationQueryService {
  private readonly canonicalBuilder = new CanonicalBuilder();
  private readonly previewMapper = new PreviewMapper();
  private readonly renderModelMapper = new RenderModelMapper();
  private readonly generatedRenderModelBuilder: GeneratedPresentationRenderModelBuilder;

  constructor(
    private readonly pptxReader: PptxReaderPort,
    imageSourceResolver?: ImageSourceResolverPort,
    svgGraphicAssetResolver?: SvgGraphicAssetResolverPort,
  ) {
    this.generatedRenderModelBuilder = new GeneratedPresentationRenderModelBuilder(
      imageSourceResolver,
      svgGraphicAssetResolver,
    );
  }

  async inspect(
    version: SlidesEngineVersionSnapshot,
  ): Promise<PresentationInfo> {
    const buffer = await this.resolvePresentationBuffer(version);
    const info = await this.pptxReader.parse(buffer);
    this.canonicalBuilder.enrichElementIds(info);
    return info;
  }

  async export(
    version: SlidesEngineVersionSnapshot,
  ): Promise<ExportedPresentationFile> {
    const buffer = await this.resolvePresentationBuffer(version);
    const safeTitle = version.title.replace(/[^\w\u4e00-\u9fff\s-]/g, '_');
    return { buffer, fileName: `${safeTitle}.pptx` };
  }

  async getPreview(
    nodeId: string,
    version: SlidesEngineVersionSnapshot,
  ): Promise<DeckPreview> {
    const buffer = await this.resolvePresentationBuffer(version);

    try {
      const info = await this.pptxReader.parse(buffer);
      const canonical = this.canonicalBuilder.build(
        nodeId,
        version.versionNumber,
        version.title,
        info,
      );
      return this.previewMapper.toPreview(canonical);
    } catch (error) {
      return this.previewMapper.toParseErrorPreview({
        nodeId,
        versionNumber: version.versionNumber,
        title: version.title,
        slideSize: this.resolvePreviewSlideSize(version.deckSpec),
        theme: {
          colors: version.deckSpec.theme?.colors,
          fonts: version.deckSpec.theme?.fonts,
          chart: version.deckSpec.theme?.chart,
        },
        message: error instanceof Error ? error.message : 'Failed to parse preview source PPTX',
      });
    }
  }

  async getRenderModel(
    nodeId: string,
    version: SlidesEngineVersionSnapshot,
    assembleOptions?: DeckAssembleOptions,
    options: SlidesEngineRenderModelOptions = {},
  ): Promise<PresentationRenderModel> {
    if (version.sourceKind === 'generated') {
      return this.generatedRenderModelBuilder.build(
        nodeId,
        version,
        assembleOptions,
        options,
      );
    }

    const buffer = await this.resolvePresentationBuffer(version);
    const info = await this.pptxReader.parse(buffer);
    const canonical = this.canonicalBuilder.build(
      nodeId,
      version.versionNumber,
      version.title,
      info,
    );

    const renderModel = this.renderModelMapper.fromCanonicalDeck(
      canonical,
      version.deckSpec,
      version.sourceKind,
    );
    await prewarmTextLayoutForRenderModel(renderModel);
    return applyTextLayoutToRenderModel(renderModel);
  }

  private resolvePresentationBuffer(
    version: SlidesEngineVersionSnapshot,
  ): Buffer {
    return version.pptxBuffer;
  }

  private resolvePreviewSlideSize(deckSpec: DeckSpec): { width: number; height: number } {
    return resolveSlideSizeInches(deckSpec.layout);
  }
}
