import {
  PPTX_DEFAULT_TEXT_INSET,
  type SlideElementInfo,
} from '@plugin/slides/shared';

export interface FinalTextLineOccupancy {
  readonly paragraphIndex: number;
  readonly lineIndex: number;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * 从最终 TextLayoutResult 还原每一条实际文字行的占位盒。
 * 只消费共享排版引擎已经决定的 slice 坐标，不拿整个文本框冒充文字区域。
 */
export function buildFinalTextLineOccupancies(
  element: SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> },
): FinalTextLineOccupancy[] {
  const layout = element.textLayout;
  if (!layout) return [];
  const padding = {
    top: element.textBody?.padding?.top ?? PPTX_DEFAULT_TEXT_INSET.top,
    left: element.textBody?.padding?.left ?? PPTX_DEFAULT_TEXT_INSET.left,
  };

  return layout.lines.flatMap((line, lineIndex) => {
    if (line.slices.length === 0 || line.height <= 0) return [];
    const left = Math.min(...line.slices.map((slice) => slice.x));
    const right = Math.max(...line.slices.map((slice) => slice.x + slice.width));
    if (right <= left) return [];
    return [{
      paragraphIndex: line.paragraphIndex,
      lineIndex,
      box: {
        x: element.position.x + padding.left + left,
        y: element.position.y + padding.top + line.y,
        w: right - left,
        h: line.height,
      },
    }];
  });
}
