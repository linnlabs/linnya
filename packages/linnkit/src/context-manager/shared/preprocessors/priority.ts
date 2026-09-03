/**
 * Preprocessor 执行顺序。
 *
 * 中文说明：数字仍是 registry 的排序机制，但业务含义集中在这里命名，
 * 避免各 preprocessor 用 0/0.5/1/10/15 这种魔法数隐式耦合。
 */
export const PREPROCESSOR_PRIORITY = {
  toolHistoryCompression: 0,
  toolReplayProtocolGuard: 0.5,
  historyPurification: 1,
  currentTurnAssembly: 10,
  fenceLifetimeCleanup: 15,
} as const;

export type PreprocessorPriorityName = keyof typeof PREPROCESSOR_PRIORITY;
