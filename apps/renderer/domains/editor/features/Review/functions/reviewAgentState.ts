import type { ReviewAgent, CustomReviewAgent } from '../definitions/reviewAgent';
import type { ReviewAgentRecord } from '../services/reviewAgentsService';
export function projectCustomReviewAgent(record: ReviewAgentRecord): CustomReviewAgent {
  return {
    id: record.id,
    name: record.name,
    systemPrompt: record.systemPrompt,
    knowledge: record.knowledge,
    isCustom: true,
  };
}
export function mergeCustomReviewAgents(
  current: ReviewAgent[],
  agents: CustomReviewAgent[]
): ReviewAgent[] {
  return [...current.filter(a => !a.isCustom), ...agents];
}
export function projectReviewAgentSelection(selected: string[], id: string): string[] {
  return selected.length >= 3 || selected.includes(id) ? selected : [...selected, id];
}
