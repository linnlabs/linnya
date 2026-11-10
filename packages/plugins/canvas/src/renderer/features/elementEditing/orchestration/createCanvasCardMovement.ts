import type { CanvasCard, CanvasCardId, CanvasCommand } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { buildMoveCommands, buildPositionCommands } from '../functions/buildSelectionCommands';
/** 相对微移先排队再读取修订，连续按键累加位移而非反复提交同一个旧版本。 */
export function createCanvasCardMovement(
  session: CanvasDocumentSession,
  finish: (ids: readonly CanvasCardId[]) => Promise<void>
) {
  let pending: Promise<void> = Promise.resolve();
  const elements = () => session.state.snapshot.value?.elements ?? [];
  const enqueue = (ids: readonly CanvasCardId[], build: () => readonly CanvasCommand[]) => {
    const run = pending.then(async () => {
      try {
        const commands = build();
        if (commands.length) await session.commit(commands);
      } finally {
        await finish(ids);
      }
    });
    pending = run.catch(() => undefined);
    return run;
  };
  return {
    move(ids: readonly CanvasCardId[], dx: number, dy: number): Promise<void> {
      return enqueue(ids, () => buildMoveCommands(elements(), ids, dx, dy));
    },
    place(
      ids: readonly CanvasCardId[],
      positions: readonly Pick<CanvasCard, 'id' | 'x' | 'y'>[]
    ): Promise<void> {
      return enqueue(ids, () => buildPositionCommands(elements(), positions));
    },
    flush: () => pending,
  };
}
