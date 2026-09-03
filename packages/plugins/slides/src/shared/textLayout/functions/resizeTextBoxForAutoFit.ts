import type { TextLayoutContract } from '../definitions/contract';

/**
 * 按 PowerPoint 的垂直锚点语义扩展 resize-shape 文本框。
 *
 * 文本框增高时，top 固定上边缘、middle 固定垂直中心、bottom 固定下边缘。
 * 这条规则必须在共享布局层收口，避免预览把新增高度一律追加到下方，
 * 而 PPTX 打开后又由 PowerPoint 按锚点向不同方向扩展。
 */
export function resizeTextBoxForAutoFit<TBox extends TextLayoutContract['box']>(
  box: TBox,
  requiredHeightInches: number,
  verticalAlign: TextLayoutContract['verticalAlign'],
): TBox {
  const heightDelta = requiredHeightInches - box.h;
  if (heightDelta <= 0) {
    return box;
  }

  const yShift = verticalAlign === 'middle'
    ? heightDelta / 2
    : verticalAlign === 'bottom'
      ? heightDelta
      : 0;

  return {
    ...box,
    y: round6(box.y - yShift),
    h: requiredHeightInches,
  };
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}
