import type { AnchoredSide } from '@linnya/renderer-ui';

/** 弹层与引用、与视口边缘各留的距离。 */
export const COMPOSER_REFERENCE_HOVER_GAP = 8;
/** 弹层默认朝上不挡输入区；上方放不下一屏预览且下方更宽时才朝下。 */
const PREFERRED_ROOM = 360;

/**
 * 打开时决定弹层在引用上方还是下方。只在打开那一刻判断一次：
 * 预览异步长高时如果重新判断，弹层会跳到另一侧盖住正停在引用上的鼠标。
 */
export function resolveComposerReferenceHoverSide(trigger: Pick<DOMRect, 'top' | 'bottom'>, viewportHeight: number): Extract<AnchoredSide, 'top' | 'bottom'> {
  const reserved = COMPOSER_REFERENCE_HOVER_GAP * 2;
  const above = trigger.top - reserved;
  const below = viewportHeight - trigger.bottom - reserved;
  return above >= Math.min(below, PREFERRED_ROOM) ? 'top' : 'bottom';
}
