import { toReadModelAgentId, type ConversationOrigin, type ProjectConversationSubagent } from '@app/schemas';
import type { ConversationRunAgentRow } from '../../../adapters/persistence/event-store';

export interface ConversationAgents {
  /** 回复过的 Agent，最近回复的在前；默认 Agent 为 null。 */
  readonly replied: (string | null)[];
  /** 派出的子 Agent，子运行多的在前。 */
  readonly subagents: ProjectConversationSubagent[];
}

/**
 * 把运行事实归成“谁回复了、派出了谁”。内部 Agent（标题生成等）不算；
 * 未记录 Agent 的运行与默认 Agent 一样记为 null，按读取合同的统一写法合并。
 */
export function groupConversationAgents(
  rows: readonly ConversationRunAgentRow[],
  internalAgentIds: ReadonlySet<string>,
): Map<string, ConversationAgents> {
  const replied = new Map<string, Map<string | null, number>>();
  const subagents = new Map<string, Map<string | null, number>>();
  for (const row of rows) {
    if (row.agentSpecId !== null && internalAgentIds.has(row.agentSpecId)) continue;
    const agentId = toReadModelAgentId(row.agentSpecId);
    const target = row.isRoot ? replied : subagents;
    const perAgent = target.get(row.conversationId) ?? new Map<string | null, number>();
    target.set(row.conversationId, perAgent);
    perAgent.set(agentId, row.isRoot
      ? Math.max(perAgent.get(agentId) ?? 0, row.lastStartedAt)
      : (perAgent.get(agentId) ?? 0) + row.runCount);
  }
  const result = new Map<string, ConversationAgents>();
  for (const conversationId of new Set([...replied.keys(), ...subagents.keys()])) {
    result.set(conversationId, {
      replied: [...(replied.get(conversationId) ?? [])]
        .sort((left, right) => right[1] - left[1])
        .map(([agentId]) => agentId),
      subagents: [...(subagents.get(conversationId) ?? [])]
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .map(([agentId, runCount]) => ({ agent_id: agentId, run_count: runCount })),
    });
  }
  return result;
}

/**
 * 对话里回复过的 Agent（列表与筛选用）。Linnya CLI 创建的对话里只有没有模型的 Host 工具运行，
 * 这些运行的 Agent 都记成默认 Agent，但没有任何 Agent 回复过；若照常统计会显示成“Linnya Agent”，
 * 所以这类对话不报回复者，由 `origin` 表达“是 Linnya CLI 在用”。
 */
export function selectRepliedAgents(
  origin: ConversationOrigin | undefined,
  agents: ConversationAgents | undefined,
): (string | null)[] {
  return origin === undefined ? agents?.replied ?? [] : [];
}
