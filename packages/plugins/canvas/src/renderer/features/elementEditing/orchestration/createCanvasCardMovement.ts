import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { buildMoveCommands } from '../functions/buildSelectionCommands';
/** 相对微移先排队再读取修订，连续按键累加位移而非反复提交同一个旧版本。 */
export function createCanvasCardMovement(session: CanvasDocumentSession, finish: (ids: readonly CanvasCardId[]) => Promise<void>) {
  let pending: Promise<void> = Promise.resolve();
  return {
    move(ids: readonly CanvasCardId[], dx: number, dy: number): Promise<void> {
      const run = pending.then(async () => {
        try { const commands = buildMoveCommands(session.state.snapshot.value?.elements ?? [], ids, dx, dy); if (commands.length) await session.commit(commands); }
        finally { await finish(ids); }
      });
      pending = run.catch(() => undefined); return run;
    },
    flush: () => pending,
  };
}
