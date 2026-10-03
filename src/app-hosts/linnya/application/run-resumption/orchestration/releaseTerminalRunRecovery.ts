import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { RunDescriptorStore } from '../definitions/runDescriptor';
import { isTerminalRun, selectRunTree } from '../functions/runRecoveryRetention';

/** 根终态先落盘，随后释放恢复输入；中途退出时启动维护可幂等完成剩余释放。 */
export async function releaseTerminalRunRecovery(input: {
  runId: string;
  supervisor: Pick<runSupervisor.RunSupervisor, 'peek' | 'findByConversation' | 'cancel'>;
  /** 活跃 Host 必须经 Graph 释放进程内 local；启动回收才可只清持久断点。 */
  clearCheckpoint: (runId: string) => Promise<void>;
  descriptors: RunDescriptorStore;
}): Promise<void> {
  const root = await input.supervisor.peek(RunIdSchema.parse(input.runId));
  if (!root || !isTerminalRun(root))
    throw new Error('Recovery resources require a settled root run');
  const tree = selectRunTree(
    await input.supervisor.findByConversation(root.conversationId, { includeChildren: true }),
    root.runId
  );
  for (const run of tree) {
    if (!isTerminalRun(run)) {
      if (run.status !== 'paused' && run.status !== 'awaiting_user') {
        throw new Error(
          'Cannot release recovery resources while a child execution is still active'
        );
      }
      await input.supervisor.cancel(run.runId, {
        reason: 'parent run reached terminal status',
        forceCleanup: true,
      });
    }
  }
  // 最后删除根描述，使“根终态后、释放中途崩溃”的下次启动仍能发现这棵树。
  for (const run of tree.filter(run => run.runId !== root.runId)) {
    await input.clearCheckpoint(run.runId);
    await input.descriptors.remove(run.runId);
  }
  await input.clearCheckpoint(root.runId);
  await input.descriptors.remove(root.runId);
}
