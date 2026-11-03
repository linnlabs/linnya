import type { CanvasCard, CanvasCardId } from '../../../../shared';

/** 单卡的场景过渡意图；引擎自己读取当前display起点，不把逻辑目标当作动画起点。 */
export interface CanvasSceneMotionPlan {
  readonly id: CanvasCardId;
  readonly kind: 'add' | 'move' | 'remove' | 'batch';
  readonly durationMs: number;
}
export interface CanvasSceneMotionInput {
  readonly before: ReadonlyMap<CanvasCardId, CanvasCard>;
  readonly after: readonly CanvasCard[];
  readonly animateIds: readonly CanvasCardId[];
  readonly batch?: boolean;
  readonly protectedIds?: ReadonlySet<CanvasCardId>;
}
