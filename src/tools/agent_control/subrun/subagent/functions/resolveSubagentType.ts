import type { PromptKey } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type { SubagentTypeContribution } from 'src/app-hosts/linnya/plugin-registry/types';

export interface ResolvedSubagentType {
  readonly type: string;
  readonly promptKey: PromptKey;
  readonly inheritTurns: number;
}

function toResolvedSubagentType(contribution: SubagentTypeContribution): ResolvedSubagentType {
  return {
    type: contribution.type,
    promptKey: contribution.promptKey,
    inheritTurns: contribution.inheritTurns ?? 0,
  };
}

/**
 * 只有调用方没有传 subagent_type 时才使用 general。
 * 显式但无效的值通常意味着插件未注册或模型使用了过期类型，静默降级会把错误伪装成成功。
 */
export function resolveSubagentType(
  rawType: string | undefined,
  registeredTypes: readonly SubagentTypeContribution[],
): ResolvedSubagentType {
  if (rawType === undefined) {
    const general = registeredTypes.find((item) => item.type === 'general');
    if (!general) {
      throw new Error('subagent: registry missing required general type');
    }
    return toResolvedSubagentType(general);
  }

  const match = registeredTypes.find((item) => item.type === rawType);
  if (!match) {
    const availableTypes = registeredTypes.map((item) => item.type).join(', ');
    throw new Error(
      `subagent: unknown subagent_type "${rawType}"; available types: ${availableTypes}`,
    );
  }

  return toResolvedSubagentType(match);
}
