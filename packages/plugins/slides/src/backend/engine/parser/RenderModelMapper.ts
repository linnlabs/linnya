/**
 * RenderModelMapper
 *
 * 产出 slides Konva 层消费的 PresentationRenderModel。
 *
 * 关键约束：
 * - generated deck 走 spec-first，不先编 PPTX 再 parse 回来
 * - imported / patched deck 才使用 parser/canonical 作为主要事实来源
 */

import type { DeckSpec } from '@plugin/slides/shared';
import type { PresentationSourceKind } from '@plugin/slides/shared';
import type {
  CanonicalDeck,
  PresentationRenderModel,
  RenderNode,
  SvgGraphicResolvedAsset,
} from '@plugin/slides/shared';
import { mapCanonicalSlide } from './render-model/CanonicalRenderModelMapper.js';
import { mapGeneratedSlide } from './render-model/GeneratedRenderModelMapper.js';
import {
  resolveRenderDefaults,
} from './render-model/RenderModelShared.js';
import type { SlideSize } from './render-model/RenderModelShared.js';

export interface GeneratedRenderModelOptions {
  canEditSourceSelection?: boolean;
}

export class RenderModelMapper {
  /**
   * generated deck 使用 DeckSpec 直接生成 render model。
   * 这条链路不应依赖 PPTX parse，否则 table/chart/freeform 样式会在中间丢失。
   */
  fromGeneratedDeck(
    nodeId: string,
    versionNumber: number,
    title: string,
    deckSpec: DeckSpec,
    slideSize: SlideSize,
    options: GeneratedRenderModelOptions = {},
    svgAssets: ReadonlyMap<string, SvgGraphicResolvedAsset> = new Map(),
  ): PresentationRenderModel {
    const defaults = resolveRenderDefaults(deckSpec.theme);
    const slides = deckSpec.slides.map((entry, index) =>
      mapGeneratedSlide(entry, index, defaults, svgAssets),
    );

    return {
      presentationId: nodeId,
      title,
      version: versionNumber,
      sourceKind: 'generated',
      slideSize: {
        width: slideSize.width,
        height: slideSize.height,
        unit: 'in',
      },
      slides,
      capabilities: {
        hasSemanticRender: true,
        hasReferencePreview: false,
        hasHitTest: true,
        hasSelection: true,
        canEditSourceSelection: options.canEditSourceSelection === true
          && slides.some(slideHasSourceSpan),
      },
    };
  }

  /**
   * imported / patched deck 使用 canonical + parser 结果构造 render model。
   */
  fromCanonicalDeck(
    canonical: CanonicalDeck,
    deckSpec: DeckSpec,
    sourceKind: PresentationSourceKind,
  ): PresentationRenderModel {
    const defaults = resolveRenderDefaults(canonical.theme);
    const slideSpecs = new Map(
      deckSpec.slides.map((entry) => [entry.slideNumber, entry.spec]),
    );

    return {
      presentationId: canonical.nodeId,
      title: canonical.title,
      version: canonical.versionNumber,
      sourceKind,
      slideSize: {
        width: canonical.slideSize.width,
        height: canonical.slideSize.height,
        unit: 'in',
      },
      slides: canonical.slides.map((slide, index) =>
        mapCanonicalSlide(
          slide,
          index,
          slideSpecs.get(slide.number),
          defaults,
        ),
      ),
      capabilities: {
        hasSemanticRender: false,
        hasReferencePreview: false,
        hasHitTest: false,
        hasSelection: false,
      },
    };
  }
}

function slideHasSourceSpan(slide: PresentationRenderModel['slides'][number]): boolean {
  return slide.elements.some(nodeHasSourceSpan);
}

function nodeHasSourceSpan(node: RenderNode): boolean {
  if (node.sourceSpan) {
    return true;
  }
  return node.kind === 'group' && node.children.some(nodeHasSourceSpan);
}
