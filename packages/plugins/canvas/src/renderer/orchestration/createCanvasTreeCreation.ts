import type { CanvasRectangle } from '@plugin/canvas/shared';
import type { CanvasTreeCreationPlan } from '../features/layoutCommands';

/** 树键盘先显露真实本地草稿；不为相机导航创建持久卡片或撤销记录。 */
export function createCanvasTreeCreation(options: {
  readonly finish: () => Promise<boolean>;
  readonly plan: (kind: 'child' | 'sibling') => CanvasTreeCreationPlan | null;
  readonly create: (plan: CanvasTreeCreationPlan) => Promise<CanvasRectangle | undefined>;
  readonly reveal: (rectangle: CanvasRectangle) => void;
}) {
  return async (kind: 'child' | 'sibling') => {
    if (!(await options.finish())) return;
    const plan = options.plan(kind); if (!plan) return;
    const draft = await options.create(plan);
    if (draft) options.reveal(draft);
  };
}
