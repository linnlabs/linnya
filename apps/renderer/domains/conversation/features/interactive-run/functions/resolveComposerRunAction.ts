import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';

export type ComposerRunAction = 'send' | 'pause' | 'continue' | 'cancel' | 'waiting';

/** 草稿拥有发送意图；空输入才是运行控制，审批绝不自动同意。 */
export function resolveComposerRunAction(input: {
  hasDraft: boolean;
  run?: InteractiveRunSnapshot;
  extensionStreaming: boolean;
}): ComposerRunAction {
  if (input.hasDraft) return 'send';
  const run = input.run;
  if (run?.status === 'reconnecting') return 'waiting';
  if (run?.status === 'pausing' || run?.status === 'continuing' || run?.status === 'cancelling')
    return 'waiting';
  if (run?.status === 'paused') return run.pause?.settled ? 'continue' : 'waiting';
  if (run?.status === 'running') return 'pause';
  if (run?.status === 'starting' || run?.status === 'submitting') return 'waiting';
  if (run?.status === 'awaiting_user' || input.extensionStreaming) return 'cancel';
  return 'send';
}
