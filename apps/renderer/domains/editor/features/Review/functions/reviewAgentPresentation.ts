import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import {
  BUILTIN_REVIEW_AGENT_IDS,
  BUILTIN_REVIEW_AGENT_NAME_KEYS,
  isBuiltinReviewAgentId,
  type ReviewAgent,
} from '../definitions/reviewAgent';

export function createBuiltinReviewAgents(): ReviewAgent[] {
  return BUILTIN_REVIEW_AGENT_IDS.map((id) => ({
    id,
    knowledge: '',
    isCustom: false,
  }));
}

export function readReviewAgentName(agent: ReviewAgent, editorMessage: EditorMessageResolver): string {
  if (agent.isCustom) return agent.name;
  return editorMessage(BUILTIN_REVIEW_AGENT_NAME_KEYS[agent.id]);
}

export function resolveReviewAgentName(
  agentId: string,
  availableAgents: readonly ReviewAgent[],
  editorMessage: EditorMessageResolver,
  fallbackName?: string,
): string {
  const agent = availableAgents.find((candidate) => candidate.id === agentId);
  if (agent) return readReviewAgentName(agent, editorMessage);

  if (isBuiltinReviewAgentId(agentId)) {
    return editorMessage(BUILTIN_REVIEW_AGENT_NAME_KEYS[agentId]);
  }

  return fallbackName?.trim() || agentId;
}
