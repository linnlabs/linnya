import {
  PRESENTATION_EXPORT_ARTIFACTS,
  SLIDES_PLUGIN_ID,
  type PresentationExportRequest,
  type PresentationExportResult,
} from '@plugin/slides/shared';
import type { PresentationExportRuntimePorts } from '../definitions/presentationExportPorts';
import { buildPresentationImageArchive } from '../functions/buildPresentationImageArchive';
import { createPresentationExportRasterProfile } from '../functions/createPresentationExportRasterProfile';
import { rasterizePresentationCharts } from './rasterizePresentationCharts';

const PDF_RASTER_WIDTH_PX = 1920;

export class PresentationExportRuntime {
  constructor(private readonly ports: PresentationExportRuntimePorts) {}

  async export(request: PresentationExportRequest): Promise<PresentationExportResult> {
    const bytes = await this.buildArtifact(request);
    const artifact = PRESENTATION_EXPORT_ARTIFACTS[request.format];
    const committed = await this.ports.commitArtifact({
      pluginId: SLIDES_PLUGIN_ID,
      targetToken: request.targetToken,
      extension: artifact.extension,
      mediaType: artifact.mediaType,
      bytes,
    });
    return {
      format: request.format,
      fileName: committed.fileName,
      byteLength: committed.byteLength,
    };
  }

  private async buildArtifact(request: PresentationExportRequest): Promise<Uint8Array> {
    if (request.format === 'pptx') {
      if (request.chartMode === 'image') {
        const source = await this.ports.loadRasterSource(request.nodeId);
        const deckSpec = await rasterizePresentationCharts({
          source,
          rasterizePages: this.ports.rasterizePages,
        });
        return await this.ports.assembleDeck(request.nodeId, deckSpec);
      }
      return (await this.ports.loadNativePptx(request.nodeId)).buffer;
    }

    const source = await this.ports.loadRasterSource(request.nodeId);
    const slideNumbers = source.renderModel.slides.map((_slide, index) => index + 1);
    const widthPx = request.format === 'images' ? request.widthPx : PDF_RASTER_WIDTH_PX;
    const profile = createPresentationExportRasterProfile({
      id: `slides-export-${request.format}-${widthPx}`,
      slideSize: source.renderModel.slideSize,
      outputWidthPx: widthPx,
    });
    if (request.format === 'images') {
      this.ports.reportImageProgress({
        exportId: request.exportId,
        completedPages: 0,
        totalPages: slideNumbers.length,
      });
    }
    const rasterRequest = { source, slideNumbers, profile };
    const rasterized = request.format === 'images'
      ? await this.ports.rasterizePages(rasterRequest, {
          onPageCompleted: progress => {
            this.ports.reportImageProgress({
              exportId: request.exportId,
              ...progress,
            });
          },
        })
      : await this.ports.rasterizePages(rasterRequest);
    if (request.format === 'images') {
      return await buildPresentationImageArchive(rasterized.pages);
    }
    return await this.ports.renderRasterPdf({
      pageWidthInches: source.renderModel.slideSize.width,
      pageHeightInches: source.renderModel.slideSize.height,
      pages: rasterized.pages.map(page => page.bytes),
    });
  }
}
