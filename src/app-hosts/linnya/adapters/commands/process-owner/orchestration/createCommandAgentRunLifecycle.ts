import type { CommandAgentRunLifecyclePort } from '../definitions/commandAgentRunLifecycle';
import type { LocalCommandOwnerPort } from './createLocalCommandExecutionOwner';

/**
 * 同步屏障必须先于异步等待建立，避免 Agent 已结束但迟到的 tool call 又启动进程。
 */
export function createCommandAgentRunLifecycle(
  owner: LocalCommandOwnerPort,
): CommandAgentRunLifecyclePort {
  return Object.freeze({
    async endAgentRun(input: Parameters<CommandAgentRunLifecyclePort['endAgentRun']>[0]) {
      owner.beginAgentRunStop(input);
      await owner.stopAgentRunAndWait(input);
      let released = false;
      return Object.freeze({
        release(): void {
          if (released) return;
          released = true;
          owner.releaseAgentRunStopBarrier(input);
        },
      });
    },
  });
}
