import type { SubagentTypeContribution } from 'src/app-hosts/linnya/plugin-registry/types';

/** 目录和执行共用同一准入规则；缺少调用者身份时只能访问未声明限制的类型。 */
export function filterSubagentTypes(
  types: readonly SubagentTypeContribution[],
  callerAgentId: string | undefined,
  availableSubagentTypes?: readonly string[]
): SubagentTypeContribution[] {
  return types.filter(
    type =>
      (availableSubagentTypes === undefined || availableSubagentTypes.includes(type.type)) &&
      (type.allowedCallerAgentIds === undefined ||
        (callerAgentId !== undefined && type.allowedCallerAgentIds.includes(callerAgentId)))
  );
}
