import { withdrawCanvasReviewGroup } from './withdrawCanvasReviewGroup';
import { resolveCanvasReviewApproval } from './resolveCanvasReviewApproval';
import { watch } from 'vue';
import type { CanvasElementId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasAgentReviewOptions, CanvasAgentReviewPort } from '../definitions/agentReview';
import { chooseCanvasReviewGroup } from '../functions/projectCanvasReviewTargets';
import {
  canvasReviewFailureMessage,
  projectCanvasWithdrawalSummary,
} from '../functions/projectCanvasReviewOutcome';
import { createCanvasAgentReviewState } from '../store/createCanvasAgentReviewState';
import { canvasText } from '../../localization';

export function createCanvasAgentReview(
  session: CanvasDocumentSession,
  port: CanvasAgentReviewPort,
  options: CanvasAgentReviewOptions = {}
) {
  const state = createCanvasAgentReviewState();
  let generation = 0,
    disposed = false;
  const documentId = () => {
    const id = session.state.snapshot.value?.documentId;
    if (!id) throw new Error(canvasText('canvas.error.notOpen'));
    return id;
  };
  const fail = (error: unknown) => state.fail(canvasReviewFailureMessage(error));
  async function refresh() {
    if (disposed || !session.state.snapshot.value) return;
    const token = ++generation,
      id = documentId();
    const groups = await port.groups(id, session.viewId);
    if (!disposed && token === generation && id === session.state.snapshot.value?.documentId)
      state.install(
        groups,
        chooseCanvasReviewGroup(state.groups.value, groups, state.activeGroupId.value)
      );
  }
  const run = async (action: () => Promise<void>, preparesContent = false) => {
    if (state.busy.value || disposed) return;
    state.start();
    try {
      if (preparesContent && options.beforeMutation && !(await options.beforeMutation())) {
        state.fail(canvasText('canvas.review.draftUnsaved'));
        return;
      }
      if (disposed) {
        state.finish();
        return;
      }
      await action();
      await refresh();
      state.finish();
    } catch (error) {
      fail(error);
    }
  };
  const stop = watch(
    () => session.state.snapshot.value?.documentId,
    id => {
      if (id) void refresh().catch(fail);
    }
  );
  const unsubscribe = port.subscribe(session.state.snapshot.value?.documentId ?? '', () => {
    void refresh().catch(fail);
  });
  return {
    state,
    refresh,
    select: state.select,
    focus: state.focus,
    withdraw: (groupId: string, elementIds?: readonly CanvasElementId[]) =>
      run(
        () =>
          withdrawCanvasReviewGroup({
            session,
            port,
            state,
            documentId: documentId(),
            groupId,
            elementIds,
          }),
        true
      ),
    redoWithdrawal: () => {
      const withdrawal = state.withdrawal.value;
      if (!withdrawal?.canRedo) return Promise.resolve();
      return run(async () => {
        const result = await session.undo('undo', { expectedActionId: withdrawal.actionId });
        state.redone();
        if (result.commit.results.some(row => row.status === 'skipped' || row.reason !== null))
          state.withdrawn({
            ...projectCanvasWithdrawalSummary(
              result.commit,
              session.state.snapshot.value?.elements ?? []
            ),
            mode: 'redo',
            canRedo: false,
          });
      }, true);
    },
    approve: (pendingId: string, decision: 'allow' | 'deny') =>
      run(
        () =>
          resolveCanvasReviewApproval({
            session,
            port,
            documentId: documentId(),
            pendingId,
            decision,
          }),
        decision === 'allow'
      ),
    complete: (groupId: string) =>
      run(async () => {
        await port.complete(documentId(), groupId);
      }),
    review: (elementId: CanvasElementId, groupId?: string) =>
      run(async () => {
        await port.review(documentId(), elementId, groupId);
      }),
    dispose() {
      disposed = true;
      generation += 1;
      stop();
      unsubscribe();
    },
  };
}
