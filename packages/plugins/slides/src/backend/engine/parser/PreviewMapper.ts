/**
 * PreviewMapper
 *
 * 将 CanonicalDeck 映射为前端消费的 DeckPreview。
 * 负责 warnings 收集和 AssetRef 归一化。
 */

import type {
  CanonicalDeck,
  CanonicalElement,
  DeckPreview,
  PreviewElement,
  PreviewSlide,
  PreviewWarning,
} from '@plugin/slides/shared';
import { normalizeAssetRef } from '@plugin/slides/shared';

export class PreviewMapper {
  toPreview(canonical: CanonicalDeck): DeckPreview {
    const warnings: PreviewWarning[] = [];

    const slides: PreviewSlide[] = canonical.slides.map((slide) => ({
      slideId: slide.slideId,
      number: slide.number,
      layoutName: slide.layoutName,
      elements: flattenCanonicalElements(slide.elements).map((el) =>
        this.mapElement(el, slide.number, warnings),
      ),
    }));

    return {
      nodeId: canonical.nodeId,
      versionNumber: canonical.versionNumber,
      title: canonical.title,
      slideSize: { ...canonical.slideSize },
      slides,
      theme: {
        colors: { ...canonical.theme.colors },
        fonts: { ...canonical.theme.fonts },
        chart: canonical.theme.chart
          ? { palette: [canonical.theme.chart.palette[0], ...canonical.theme.chart.palette.slice(1)] }
          : undefined,
      },
      warnings,
    };
  }

  toParseErrorPreview(input: {
    nodeId: string;
    versionNumber: number;
    title: string;
    slideSize: { width: number; height: number };
    theme?: {
      colors?: Record<string, string>;
      fonts?: { major?: string; minor?: string };
      chart?: { palette?: readonly string[] };
    };
    message: string;
  }): DeckPreview {
    return {
      nodeId: input.nodeId,
      versionNumber: input.versionNumber,
      title: input.title,
      slideSize: { ...input.slideSize },
      slides: [],
      theme: {
        colors: { ...(input.theme?.colors ?? {}) },
        fonts: {
          major: input.theme?.fonts?.major ?? '',
          minor: input.theme?.fonts?.minor ?? '',
        },
        chart: input.theme?.chart?.palette && input.theme.chart.palette.length > 0
          ? { palette: [input.theme.chart.palette[0], ...input.theme.chart.palette.slice(1)] }
          : undefined,
      },
      warnings: [
        {
          slideNumber: 0,
          code: 'parse_error',
          message: input.message,
        },
      ],
    };
  }

  private mapElement(
    el: CanonicalElement,
    slideNumber: number,
    warnings: PreviewWarning[],
  ): PreviewElement {
    if (el.role === 'other') {
      warnings.push({
        slideNumber,
        elementId: el.elementId,
        code: 'unsupported_element',
        message: `Unsupported element: ${el.patchMeta.elementName ?? el.elementId}`,
      });
    }

    const imageRef = el.imageRef ? normalizeAssetRef(el.imageRef) : undefined;
    if (el.role === 'image' && el.imageRef && !imageRef) {
      warnings.push({
        slideNumber,
        elementId: el.elementId,
        code: 'missing_asset',
        message: `Cannot resolve image ref: ${el.imageRef}`,
      });
    }
    if (el.importFidelity?.status === 'raster-fallback') {
      warnings.push({
        slideNumber,
        elementId: el.elementId,
        code: 'fidelity_fallback',
        message: el.importFidelity.reason === 'unsupported_svg'
          ? 'The SVG picture uses its raster fallback because the vector content is unsupported.'
          : 'The SVG picture uses its raster fallback because the vector media is unavailable.',
      });
    }

    const result: PreviewElement = {
      elementId: el.elementId,
      type: el.role === 'title' || el.role === 'body' ? 'text' : el.role,
      text: el.text,
      position: el.position ? { ...el.position } : undefined,
      chartType: el.chartType,
      imageRef,
    };

    return result;
  }
}

function flattenCanonicalElements(
  elements: CanonicalElement[],
): CanonicalElement[] {
  const flattened: CanonicalElement[] = [];
  for (const element of elements) {
    flattened.push(element);
    if (element.children && element.children.length > 0) {
      flattened.push(...flattenCanonicalElements(element.children));
    }
  }
  return flattened;
}
