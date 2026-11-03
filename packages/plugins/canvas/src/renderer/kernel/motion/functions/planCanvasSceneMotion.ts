import type {
  CanvasSceneMotionInput,
  CanvasSceneMotionPlan,
} from '../definitions/canvasSceneMotion';

/** 来源和编辑保护由调用方明确传入；纯规则只处理本批指定的逻辑卡片差异。 */
export function planCanvasSceneMotion(
  input: CanvasSceneMotionInput
): readonly CanvasSceneMotionPlan[] {
  const targets = new Map(input.after.map(card => [card.id, card]));
  const ids = [...new Set(input.animateIds)].filter(
    id => !input.protectedIds?.has(id) && (input.before.has(id) || targets.has(id))
  );
  // 阈值按去重后的实际目标计数，未知ID或编辑保护卡不能把小改误判为大批动画。
  const batch = input.batch === true || ids.length > 200;
  return ids.flatMap((id): CanvasSceneMotionPlan[] => {
    const previous = input.before.get(id),
      target = targets.get(id);
    if (!target) return [{ id, kind: 'remove', durationMs: batch ? 200 : 120 }];
    if (batch) return [{ id, kind: 'batch', durationMs: 200 }];
    if (!previous) return [{ id, kind: 'add', durationMs: 160 }];
    if (previous.x !== target.x || previous.y !== target.y)
      return [{ id, kind: 'move', durationMs: 220 }];
    return [];
  });
}
