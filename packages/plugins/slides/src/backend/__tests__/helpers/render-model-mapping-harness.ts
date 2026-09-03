import { RenderModelMapper } from '../../engine/parser/RenderModelMapper.js';
import type {
  DeckSpec,
  RenderNode,
  SlideRenderModel,
  StructuredElement,
  StructuredSlideSpec,
} from '@plugin/slides/shared';

const mapper = new RenderModelMapper();
export const SLIDE_SIZE = { width: 10, height: 5.625 };
export const BOX = { x: 1, y: 1, w: 4, h: 2 };

export function renderDeck(deckSpec: DeckSpec) {
  return mapper.fromGeneratedDeck('test-1', 1, 'Test', deckSpec, SLIDE_SIZE);
}

/** 从 DeckSpec 快速获取 RenderModel 的第一个 slide。 */
export function renderSlide(elements: StructuredElement[], theme?: DeckSpec['theme']): SlideRenderModel {
  const deckSpec: DeckSpec = {
    title: 'Mapping Exhaustive Test',
    theme,
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements,
      } satisfies StructuredSlideSpec,
    }],
  };
  const model = renderDeck(deckSpec);
  return model.slides[0]!;
}

/** 获取指定 kind 的单个节点。 */
export function getNode<K extends RenderNode['kind']>(
  elements: StructuredElement[],
  kind: K,
  theme?: DeckSpec['theme'],
): Extract<RenderNode, { kind: K }> {
  const slide = renderSlide(elements, theme);
  const node = slide.elements.find((n) => n.kind === kind);
  if (!node) throw new Error(`未找到 kind=${kind} 的节点`);
  return node as Extract<RenderNode, { kind: K }>;
}
