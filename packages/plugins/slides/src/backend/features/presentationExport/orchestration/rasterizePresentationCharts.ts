import type {
  ChartRenderNode,
  DeckSpec,
  PresentationRenderModel,
  StructuredElement,
} from '@plugin/slides/shared';
import type {
  PresentationPageRasterRequest,
  PresentationPageRasterResult,
  PresentationPageRasterSource,
} from '../../presentationPageRasterization';
import type { PresentationExportRasterSource } from '../definitions/presentationExportPorts';
import { createPresentationExportRasterProfile } from '../functions/createPresentationExportRasterProfile';

const CHART_IMAGE_PIXELS_PER_INCH = 192;

export async function rasterizePresentationCharts(input: {
  readonly source: PresentationExportRasterSource;
  readonly rasterizePages: (
    request: PresentationPageRasterRequest,
  ) => Promise<PresentationPageRasterResult>;
}): Promise<DeckSpec> {
  if (input.source.renderModel.sourceKind !== 'generated') {
    throw new Error('Chart image export currently requires a generated presentation.');
  }

  const slides: DeckSpec['slides'] = [];
  for (const [slideIndex, entry] of input.source.deckSpec.slides.entries()) {
    if (entry.spec.type !== 'structured') {
      slides.push(entry);
      continue;
    }
    const renderSlide = input.source.renderModel.slides[slideIndex];
    if (!renderSlide) {
      throw new Error('Chart image export source is inconsistent.');
    }
    const elements: StructuredElement[] = [];
    for (const [elementIndex, element] of entry.spec.elements.entries()) {
      if (element.type !== 'chart') {
        elements.push(element);
        continue;
      }
      const chartNode = renderSlide.elements[elementIndex];
      if (!chartNode || chartNode.kind !== 'chart') {
        throw new Error('Chart image export source is inconsistent.');
      }
      const dataUri = await rasterizeChartNode({
        renderModel: input.source.renderModel,
        chartNode,
        rasterizePages: input.rasterizePages,
      });
      elements.push(createChartImageElement(element, dataUri));
    }
    slides.push({
      ...entry,
      spec: { ...entry.spec, elements },
    });
  }

  return { ...input.source.deckSpec, slides };
}

async function rasterizeChartNode(input: {
  readonly renderModel: PresentationRenderModel;
  readonly chartNode: ChartRenderNode;
  readonly rasterizePages: (
    request: PresentationPageRasterRequest,
  ) => Promise<PresentationPageRasterResult>;
}): Promise<string> {
  const slideSize = {
    width: input.chartNode.box.w,
    height: input.chartNode.box.h,
    unit: 'in' as const,
  };
  const outputWidthPx = Math.max(
    1,
    Math.round(slideSize.width * CHART_IMAGE_PIXELS_PER_INCH),
  );
  const chartNode = {
    ...input.chartNode,
    box: { x: 0, y: 0, w: slideSize.width, h: slideSize.height, unit: 'in' as const },
    zIndex: 0,
  };
  const source: PresentationPageRasterSource = {
    renderModel: {
      ...input.renderModel,
      slideSize,
      slides: [{
        slideId: `${input.chartNode.id}-export`,
        index: 0,
        layoutKey: 'blank',
        background: { paint: { type: 'none' } },
        elements: [chartNode],
      }],
    },
  };
  const rasterized = await input.rasterizePages({
    source,
    slideNumbers: [1],
    profile: createPresentationExportRasterProfile({
      id: `slides-export-chart-${input.chartNode.id}`,
      slideSize,
      outputWidthPx,
      transparentBackground: true,
    }),
  });
  const page = rasterized.pages[0];
  if (!page) {
    throw new Error('Chart image export returned no PNG page.');
  }
  return `data:image/png;base64,${Buffer.from(page.bytes).toString('base64')}`;
}

function createChartImageElement(
  element: Extract<StructuredElement, { type: 'chart' }>,
  dataUri: string,
): Extract<StructuredElement, { type: 'image' }> {
  return {
    type: 'image',
    src: { kind: 'data_uri', dataUri },
    position: element.position,
    fitMode: 'contain',
    ...copyElementMetadata(element),
  };
}

function copyElementMetadata(element: StructuredElement): {
  readonly _semanticNodeId?: string;
  readonly _semanticRole?: string;
  readonly _overlayId?: string;
  readonly _sourceSpan?: StructuredElement['_sourceSpan'];
} {
  return {
    ...(element._semanticNodeId ? { _semanticNodeId: element._semanticNodeId } : {}),
    ...(element._semanticRole ? { _semanticRole: element._semanticRole } : {}),
    ...(element._overlayId ? { _overlayId: element._overlayId } : {}),
    ...(element._sourceSpan ? { _sourceSpan: element._sourceSpan } : {}),
  };
}
