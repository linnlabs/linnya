import type { CanvasCard } from '../../../../shared';
import type { CanvasSceneMotionPlan } from '../definitions/canvasSceneMotion';

export function resolveCanvasDisplayCard(input: {
  readonly card: CanvasCard;
  readonly previous?: CanvasCard;
  readonly target?: CanvasCard;
  readonly origin?: CanvasCard;
  readonly motion: boolean;
  readonly editing: boolean;
  readonly plan?: CanvasSceneMotionPlan;
}) {
  const { card, previous, target, origin, plan } = input;
  const dragging = origin !== undefined && !card.locked;
  const continuing = input.motion && target?.x === card.x && target.y === card.y && !input.editing;
  const preserve = previous && (dragging || continuing || plan?.kind === 'move');
  const display = preserve ? { ...card, x: previous.x, y: previous.y } : plan ? { ...card } : card;
  return {
    display,
    keepMotion: continuing || plan !== undefined,
    origin: dragging && origin ? { ...card, x: origin.x, y: origin.y } : undefined,
  };
}

/** heightMode 只表示高度由谁维护，高度另行比较；改尺寸把 auto 记成 fixed 不改变正文。 */
const rasterData = (card: CanvasCard) =>
  JSON.stringify(card.data, (key, value: unknown) => (key === 'heightMode' ? undefined : value));

/** 染纸、类型或正文变了：旧采样的内容本身已过期，不只是排版宽度不同。 */
export function canvasCardContentChanged(previous: CanvasCard, next: CanvasCard): boolean {
  return (
    previous.color !== next.color ||
    previous.type !== next.type ||
    rasterData(previous) !== rasterData(next)
  );
}

/** 位置与逻辑来源不改变正文，尺寸/染纸/正文改变才撤销当前采样。 */
export function canvasCardRasterChanged(previous: CanvasCard, next: CanvasCard): boolean {
  return (
    previous.revision !== next.revision &&
    (previous.width !== next.width ||
      previous.height !== next.height ||
      canvasCardContentChanged(previous, next))
  );
}
