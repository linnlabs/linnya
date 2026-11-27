import { computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import type { Middleware } from '@floating-ui/dom';
import type { AnchoredAnchor, AnchoredPosition, AnchoredPositionOptions } from '../definitions/anchoredPosition';
import { fromFloatingPlacement, toFloatingPlacement } from './anchoredPlacement';

const DEFAULT_GAP = 8;
const DEFAULT_VIEWPORT_MARGIN = 8;

/**
 * 按锚点算 `position: fixed` 浮层的坐标。
 *
 * 为什么交给 Floating UI：它量浮层自身用布局尺寸（computed style / offsetWidth），不受入场缩放
 * （scale 0.96）影响，打开当帧就是最终位置；翻转、贴边收拢和限高也都由同一套规则处理。
 * 此前各处手写“放在按钮下方、放不下翻到上方、左右收进视口”，规则一样却各写一遍，边界修了这里漏了那里。
 *
 * 中间件顺序有讲究：先 offset 留出间距，再 flip 选一侧，再 shift 收进视口，最后 size 按落定的一侧限高。
 */
export async function computeAnchoredPosition(
  anchor: AnchoredAnchor,
  floating: HTMLElement,
  options: AnchoredPositionOptions = {},
): Promise<AnchoredPosition> {
  const side = options.side ?? 'bottom';
  const align = options.align ?? 'start';
  const margin = options.viewportMargin ?? DEFAULT_VIEWPORT_MARGIN;
  let width: number | undefined;
  let maxHeight: number | undefined;

  const middleware: Middleware[] = [offset({ mainAxis: options.gap ?? DEFAULT_GAP, alignmentAxis: options.alignOffset ?? 0 })];
  if (options.flip !== false) middleware.push(flip({ padding: margin }));
  // crossAxis：两侧都放不下时（菜单比上下剩余空间都高）整体推回视口，宁可压住锚点也不出屏。
  middleware.push(shift({ padding: margin, crossAxis: true }));
  if (options.matchAnchorWidth || options.fitViewportHeight) {
    middleware.push(size({
      padding: margin,
      // 尺寸要当场写到浮层上：Floating UI 发现浮层尺寸变了会按新尺寸再算一遍，右对齐和翻转才准。
      apply({ rects, availableHeight, elements }) {
        if (options.matchAnchorWidth) {
          width = rects.reference.width;
          elements.floating.style.width = `${width}px`;
        }
        if (options.fitViewportHeight) {
          maxHeight = Math.max(0, availableHeight);
          elements.floating.style.maxHeight = `${maxHeight}px`;
        }
      },
    }));
  }

  const result = await computePosition(anchor, floating, {
    strategy: 'fixed',
    placement: toFloatingPlacement(side, align),
    middleware,
  });
  const placed = fromFloatingPlacement(result.placement);
  return {
    top: result.y,
    left: result.x,
    side: placed.side,
    align: placed.align,
    ...(width === undefined ? {} : { width }),
    ...(maxHeight === undefined ? {} : { maxHeight }),
  };
}
