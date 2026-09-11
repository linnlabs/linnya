import type { DeckSpec, StructuredElement, FreeformElement } from '@plugin/slides/shared';
import { resolveSlideSizeInches, PPTX_DEFAULT_TEXT_INSET } from '@plugin/slides/shared';
import { RenderModelMapper } from '../parser/RenderModelMapper';
import { applyTextLayoutToRenderModel, prewarmTextLayoutForRenderModel } from './renderModelTextLayout';

/**
 * 无横向约束的绝对定位文字不影响 Yoga 流；在落库/PPTX 之前用最终排版同源
 * 的字形测量替换临时估算盒。只筛选编译期有来源事实的文本，不改 imported 盒。
 */
export async function materializeIntrinsicTextBoxes(deck: DeckSpec): Promise<void> {
  const measurementDeck: DeckSpec = {
    ...deck,
    slides: deck.slides.map(slide => ({
      ...slide,
      spec: slide.spec.type === 'structured'
        ? { ...slide.spec, elements: slide.spec.elements.filter(isIntrinsicText) }
        : { ...slide.spec, elements: slide.spec.elements.filter(isIntrinsicText) },
    })),
  };
  if (measurementDeck.slides.every(slide => slide.spec.elements.length === 0)) return;
  const model = new RenderModelMapper().fromGeneratedDeck(
    'intrinsic-measurement', 1, deck.title, measurementDeck, resolveSlideSizeInches(deck.layout),
  );
  await prewarmTextLayoutForRenderModel(model);
  applyTextLayoutToRenderModel(model);
  for (const [slideIndex, slide] of measurementDeck.slides.entries()) {
    for (const [index, element] of slide.spec.elements.entries()) {
      const node = model.slides[slideIndex]?.elements[index];
      if (node?.kind !== 'text' || !node.layout) throw new Error('Intrinsic text layout is missing');
      const padding = node.padding ?? PPTX_DEFAULT_TEXT_INSET;
      const measuredWidth = Math.max(0, ...node.layout.lines.map(line => line.width)) + (padding.left ?? PPTX_DEFAULT_TEXT_INSET.left) + (padding.right ?? PPTX_DEFAULT_TEXT_INSET.right);
      // 向上量化到 OOXML EMU，避免十进制舍入重新制造字形级溢出。
      const width = Math.max(
        element._layoutConstraintEvidence?.declared.minWidthInches ?? 0,
        Math.ceil(measuredWidth * 914400) / 914400,
      );
      const previous = element.position;
      const evidence = element._layoutConstraintEvidence;
      const rightAnchored = evidence?.declared.rightInches != null && evidence.declared.leftInches == null;
      const bottomAnchored = evidence?.declared.bottomInches != null && evidence.declared.topInches == null;
      const position = {
        x: rightAnchored ? previous.x + previous.w - width : previous.x,
        y: bottomAnchored ? previous.y + previous.h - node.box.h : node.box.y,
        w: width,
        h: node.box.h,
      };
      element.position = position;
      if (evidence) {
        element._layoutConstraintEvidence = {
          ...evidence,
          finalBox: { ...position, unit: 'in' },
          intrinsicTextAdvanceSource: node.layout.advanceSource,
          computedRatios: {
            ...evidence.computedRatios,
            ...(evidence.declared.heightInches && { heightToDeclared: position.h / evidence.declared.heightInches }),
          },
        };
      }
    }
  }
}

function isIntrinsicText(element: StructuredElement | FreeformElement): boolean {
  return element.type === 'text' && element.textWrap === 'none'
    && element._layoutConstraintEvidence?.positionMode === 'absolute';
}
