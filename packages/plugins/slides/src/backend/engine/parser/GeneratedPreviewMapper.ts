/**
 * GeneratedPreviewMapper
 *
 * generated 文稿的 DeckPreview 直接来自当前 revision 的 DeckSpec。
 * DeckPreview 只服务页面导航与 page context，不应为了得到这份轻量摘要而把同一
 * revision 的 PPTX 再解压、解析并重建 canonical tree。
 */

import type {
  DeckPreview,
  DeckSpec,
  FreeformElement,
  FreeformInlineRun,
  PreviewElement,
  SlideBox,
  StructuredElement,
} from '@plugin/slides/shared';
import { buildSlidesAuthoringRenderNodeId, resolveSlideSizeInches } from '@plugin/slides/shared';
import {
  applyFreeformTransform,
  buildFreeformGroupTransform,
  IDENTITY_FREEFORM_TRANSFORM,
  type FreeformTransform,
} from '../shared/freeformTransform.js';
import { resolveThemeFonts } from '../visual/presentationVisualDefaults.js';

export class GeneratedPreviewMapper {
  toPreview(input: {
    nodeId: string;
    versionNumber: number;
    title: string;
    deckSpec: DeckSpec;
  }): DeckPreview {
    const fonts = resolveThemeFonts(input.deckSpec.theme);
    const chart = input.deckSpec.theme?.chart;

    return {
      nodeId: input.nodeId,
      versionNumber: input.versionNumber,
      title: input.title,
      slideSize: resolveSlideSizeInches(input.deckSpec.layout),
      slides: input.deckSpec.slides.map((entry) => ({
        slideId: `s${entry.slideNumber}`,
        number: entry.slideNumber,
        layoutName: entry.spec.type,
        elements: entry.spec.type === 'structured'
          ? entry.spec.elements.map((element, index) =>
            mapStructuredElement(entry.slideNumber, element, index),
          )
          : entry.spec.elements.flatMap((element, index) =>
            mapFreeformElement(
              entry.slideNumber,
              element,
              index,
              IDENTITY_FREEFORM_TRANSFORM,
            ),
          ),
      })),
      theme: {
        colors: { ...(input.deckSpec.theme?.colors ?? {}) },
        fonts,
        chart: chart
          ? { palette: [chart.palette[0], ...chart.palette.slice(1)] }
          : undefined,
      },
      warnings: [],
    };
  }
}

function mapStructuredElement(
  slideNumber: number,
  element: StructuredElement,
  index: number,
): PreviewElement {
  const preview: PreviewElement = {
    elementId: resolveElementId(slideNumber, element, 'generated', index),
    type: mapElementType(element.type),
    position: copyBox(element.position),
  };

  switch (element.type) {
    case 'title':
    case 'text':
      return { ...preview, text: readInlineText(element.content) };
    case 'bulletList':
    case 'numberedList':
      return { ...preview, text: element.items.map(item => item.text).join('\n') };
    case 'shape':
      return { ...preview, text: element.text };
    case 'chart':
      return { ...preview, chartType: element.chartType };
    case 'table':
    case 'image':
    case 'svgGraphic':
    case 'formula':
      return preview;
  }
}

function mapFreeformElement(
  slideNumber: number,
  element: FreeformElement,
  zIndex: number,
  transform: FreeformTransform,
): PreviewElement[] {
  const position = applyFreeformTransform(element.position, transform);
  const preview: PreviewElement = {
    elementId: resolveElementId(slideNumber, element, 'freeform', zIndex),
    type: mapElementType(element.type),
    position: copyBox(position),
  };

  switch (element.type) {
    case 'text':
    case 'shape':
      return [{ ...preview, text: readInlineText(element.content) }];
    case 'image':
    case 'svgGraphic':
    case 'formula':
      return [preview];
    case 'group': {
      const childTransform = buildFreeformGroupTransform(element, transform);
      const children = element.children?.flatMap((child, childIndex) =>
        mapFreeformElement(
          slideNumber,
          child,
          zIndex * 100 + childIndex,
          childTransform,
        ),
      ) ?? [];
      return [preview, ...children];
    }
  }
}

function resolveElementId(
  slideNumber: number,
  element: StructuredElement | FreeformElement,
  source: 'generated' | 'freeform',
  index: number,
): string {
  return element._authoringRef
    ? buildSlidesAuthoringRenderNodeId(element._authoringRef)
    : `s${slideNumber}-${source}-${index}`;
}

function mapElementType(
  type: StructuredElement['type'] | FreeformElement['type'],
): PreviewElement['type'] {
  switch (type) {
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList':
      return 'text';
    case 'chart':
    case 'table':
    case 'image':
    case 'svgGraphic':
    case 'formula':
    case 'shape':
    case 'group':
      return type;
  }
}

function readInlineText(content: string | FreeformInlineRun[] | undefined): string | undefined {
  if (typeof content === 'string') {
    return content;
  }
  if (!content) {
    return undefined;
  }
  return content
    .map(run => 'text' in run ? run.text : '')
    .join('');
}

function copyBox(position: SlideBox): SlideBox {
  return { ...position };
}
