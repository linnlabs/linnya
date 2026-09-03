import type { CommandConstructionPolicy } from '../definitions/commandConstructionPolicy';

/** 组合根只接受已经冻结的正整数策略；单次 route/tool call 不能覆盖。 */
export function validateCommandConstructionPolicy(
  input: CommandConstructionPolicy,
): Readonly<CommandConstructionPolicy> {
  if (!Number.isSafeInteger(input.defaultHardTimeoutMs)
    || input.defaultHardTimeoutMs <= 0
    || !Number.isSafeInteger(input.maximumHardTimeoutMs)
    || input.maximumHardTimeoutMs < input.defaultHardTimeoutMs
    || !Number.isSafeInteger(input.maximumActiveExecutions)
    || input.maximumActiveExecutions <= 0) {
    throw new Error('Command production construction policy is invalid');
  }
  return Object.freeze({ ...input });
}
