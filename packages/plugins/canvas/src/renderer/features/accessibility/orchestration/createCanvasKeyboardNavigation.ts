import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasNavigationDirection } from '../definitions/canvasKeyboard';
import { canvasKeyboardTarget } from '../functions/canvasKeyboardTarget';

export function createCanvasKeyboardNavigation(options: {
  readonly cards: () => readonly CanvasCard[]; readonly selection: () => readonly CanvasCardId[];
  readonly select: (ids: readonly CanvasCardId[]) => Promise<void>; readonly reveal: (id: CanvasCardId) => void;
}) {
  return (direction: CanvasNavigationDirection) => {
    const id = canvasKeyboardTarget(options.cards(), options.selection(), direction);
    if (!id) return null;
    // 同步决定是否消费Tab，异步保存前就须阻止默认跳焦；目标身份在此冻结。
    return async () => { await options.select([id]); if (options.selection().includes(id)) options.reveal(id); };
  };
}
