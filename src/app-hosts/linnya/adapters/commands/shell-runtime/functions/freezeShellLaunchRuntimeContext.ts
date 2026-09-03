import {
  CommandLaunchEnvironmentV1Schema,
  CommandResolvedShellV1Schema,
} from '@app/schemas/commands';
import type {
  ShellLaunchRuntimePolicyContext,
} from '../../../../../../domains/commands';

/**
 * Shell 语义参与风险判断，环境与同一 revision 又参与最终启动，所以必须在审批前
 * 一次性校验并切断组合根的可变引用，不能批准后再读取另一份 runtime 状态。
 */
export function freezeShellLaunchRuntimeContext(
  value: ShellLaunchRuntimePolicyContext,
): ShellLaunchRuntimePolicyContext {
  if (!Number.isSafeInteger(value.defaultHardTimeoutMs) || value.defaultHardTimeoutMs <= 0) {
    throw new Error('shell hard timeout must be a positive safe integer');
  }
  if (
    !Number.isSafeInteger(value.maximumHardTimeoutMs)
    || value.maximumHardTimeoutMs <= 0
    || value.defaultHardTimeoutMs > value.maximumHardTimeoutMs
  ) {
    throw new Error('shell maximum hard timeout must include the default timeout');
  }
  const shell = CommandResolvedShellV1Schema.parse(value.shell);
  const environment = CommandLaunchEnvironmentV1Schema.parse(value.environment);
  Object.freeze(shell.argv_prefix);
  Object.freeze(shell);
  Object.freeze(environment.entries);
  Object.freeze(environment);
  return Object.freeze({
    shell,
    environment,
    defaultHardTimeoutMs: value.defaultHardTimeoutMs,
    maximumHardTimeoutMs: value.maximumHardTimeoutMs,
  });
}
