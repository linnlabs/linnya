import type { MessageProcessingState } from '../base';
import type { ToolInteractionGroup } from '../../../../../shared/toolInteractionGroup';

export interface ProtectedToolRunWindow {
  minRunOrdinal: number | null;
  maxRunOrdinal: number | null;
  protectedRunCount: number;
  hasCurrentTurnToolGroup: boolean;
}

/**
 * 计算工作记忆里的工具 turn 保护窗口。
 *
 * 中文备注：
 * - 当前 turn 有工具组时，窗口是“当前 turn + 最近历史 turn”；
 * - 当前 turn 还没有工具组时，窗口只覆盖最近的历史工具 turn，与预处理器 keepLatestRuns=1 对齐。
 */
export function resolveProtectedToolRunWindow(params: {
  toolGroups: ToolInteractionGroup<MessageProcessingState>[];
  lastUserOriginalIndex: number | null;
  maxRecentToolRunsToKeep: number;
}): ProtectedToolRunWindow {
  const maxRecentToolRunsToKeep = Math.max(0, Math.floor(params.maxRecentToolRunsToKeep));
  const completeGroups = params.toolGroups.filter((group) => group.isComplete);
  if (maxRecentToolRunsToKeep <= 0 || completeGroups.length === 0) {
    return {
      minRunOrdinal: null,
      maxRunOrdinal: null,
      protectedRunCount: 0,
      hasCurrentTurnToolGroup: false,
    };
  }

  const maxRunOrdinal = completeGroups.reduce(
    (maxOrdinal, group) => Math.max(maxOrdinal, group.runOrdinal),
    0,
  );
  const lastUserOriginalIndex = params.lastUserOriginalIndex;
  const hasCurrentTurnToolGroup = lastUserOriginalIndex === null
    ? true
    : completeGroups.some((group) => group.startIndex > lastUserOriginalIndex);
  const protectedRunCount = hasCurrentTurnToolGroup
    ? maxRecentToolRunsToKeep
    : Math.max(1, maxRecentToolRunsToKeep - 1);
  const minRunOrdinal = Math.max(0, maxRunOrdinal - protectedRunCount + 1);

  return {
    minRunOrdinal,
    maxRunOrdinal,
    protectedRunCount,
    hasCurrentTurnToolGroup,
  };
}

export function isGroupInProtectedToolRunWindow(
  group: ToolInteractionGroup<MessageProcessingState>,
  window: ProtectedToolRunWindow,
): boolean {
  return window.minRunOrdinal !== null && group.runOrdinal >= window.minRunOrdinal;
}
