import type { ShellLaunchRuntimePolicyContext } from '../definitions/authorizedShellExecution';

export type ShellHardTimeoutResolution =
  | { readonly status: 'resolved'; readonly hardTimeoutMs: number }
  | { readonly status: 'rejected'; readonly code: 'hard_timeout_exceeds_host_limit' };

/**
 * Agent 只能在启动时缩短或延长本条命令的总寿命。默认值和最终上限属于 host 的固定
 * 产品事实，不能让 initial wait 或后续 process.wait 在运行中改写这个 timer。
 */
export function resolveShellHardTimeout(input: {
  readonly requestedHardTimeoutMs?: number;
  readonly runtime: ShellLaunchRuntimePolicyContext;
}): ShellHardTimeoutResolution {
  const hardTimeoutMs = input.requestedHardTimeoutMs ?? input.runtime.defaultHardTimeoutMs;
  if (hardTimeoutMs > input.runtime.maximumHardTimeoutMs) {
    return Object.freeze({
      status: 'rejected',
      code: 'hard_timeout_exceeds_host_limit',
    });
  }
  return Object.freeze({ status: 'resolved', hardTimeoutMs });
}
