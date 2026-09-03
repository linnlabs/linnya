import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { Logger } from '../../../shared/logger';

const logger = new Logger('PluginRuntimeRunInvalidation');

export interface CancelActiveRunsForPluginRuntimeChangeOptions {
  readonly pluginId: string;
  readonly operation: string;
  readonly supervisor: Pick<runSupervisor.RunSupervisor, 'list' | 'cancel'>;
}

export interface CancelActiveRunsForPluginRuntimeChangeResult {
  readonly cancelledRunIds: readonly string[];
  readonly failedRunIds: readonly string[];
}

export async function cancelActiveRunsForPluginRuntimeChange(
  options: CancelActiveRunsForPluginRuntimeChangeOptions,
): Promise<CancelActiveRunsForPluginRuntimeChangeResult> {
  // 插件启停/卸载/升级会改变模型可见工具、agent、Skill 与 ToolContext decorator。
  // 已经开始的 run 持有旧请求与旧上下文，继续执行会把“旧世界观”带到新运行态里；
  // 因此这里统一取消当前活跃 run，让用户下一轮请求拿到最新插件状态。
  const activeRuns = await options.supervisor.list({
    status: ['pending', 'running', 'awaiting_user', 'paused'],
  });
  if (activeRuns.runs.length === 0) {
    return {
      cancelledRunIds: [],
      failedRunIds: [],
    };
  }

  const cancelledRunIds: string[] = [];
  const failedRunIds: string[] = [];
  const reason = `[plugin-runtime] 插件 ${options.pluginId} 正在执行 ${options.operation}，当前 agent run 已取消，请重新发起请求以使用最新插件状态。`;

  for (const run of activeRuns.runs) {
    try {
      await options.supervisor.cancel(run.runId, {
        reason,
        forceCleanup: true,
      });
      cancelledRunIds.push(run.runId);
    } catch (error) {
      failedRunIds.push(run.runId);
      logger.warn('[plugin-runtime] cancel active run failed:', {
        pluginId: options.pluginId,
        operation: options.operation,
        runId: run.runId,
        error,
      });
    }
  }

  return {
    cancelledRunIds,
    failedRunIds,
  };
}
