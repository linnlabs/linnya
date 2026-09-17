import type { ComposerRunControl, InteractiveRunSnapshot } from '../definitions/interactiveRun';

/** 草稿保持发送意图；表单审批必须在表单提交，不能把恢复按钮当成自动同意。 */
export function resolveComposerRunControl(input: {
  hasDraft: boolean;
  run?: InteractiveRunSnapshot;
  extensionStreaming: boolean;
}): ComposerRunControl {
  if (input.hasDraft) return { action: 'send', disabled: false };
  // 扩展当前只提供 cancel，不能把不可恢复的取消伪装为暂停。
  if (input.extensionStreaming) return { action: 'pause', disabled: true };
  const run = input.run;
  if (!run) return { action: 'send', disabled: false };
  const hasControlIdentity = Boolean(run.runId && run.executionId);
  switch (run.status) {
    case 'paused':
      return { action: 'resume', disabled: !run.pause?.settled || !hasControlIdentity };
    case 'pausing':
    case 'awaiting_user':
      return { action: 'resume', disabled: true };
    case 'running':
    case 'starting':
      return { action: 'pause', disabled: !hasControlIdentity };
    case 'continuing':
    case 'submitting':
    case 'reconnecting':
    case 'cancelling':
      return { action: 'pause', disabled: true };
    case 'completed':
    case 'failed':
    case 'cancelled':
      return { action: 'send', disabled: false };
  }
}
