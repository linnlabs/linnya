import type { EditorMessageKey } from '../../../definitions/editorMessages';

export const BUILTIN_REVIEW_AGENT_IDS = ['logicCheck', 'structure', 'polish'] as const;

export type BuiltinReviewAgentId = typeof BUILTIN_REVIEW_AGENT_IDS[number];

export const BUILTIN_REVIEW_AGENT_NAME_KEYS = {
  logicCheck: 'editor.review.agent.logicCheck.name',
  structure: 'editor.review.agent.structure.name',
  polish: 'editor.review.agent.polish.name',
} as const satisfies Readonly<Record<BuiltinReviewAgentId, EditorMessageKey>>;

interface BaseReviewAgent {
  id: string;
  /**
   * 自定义角色必填，预置角色可省略（使用后端内置系统提示词）。
   */
  systemPrompt?: string;
  /**
   * 背景知识（自定义角色可选）
   */
  knowledge?: string;
}

export interface BuiltinReviewAgent extends BaseReviewAgent {
  id: BuiltinReviewAgentId;
  isCustom: false;
}

export interface CustomReviewAgent extends BaseReviewAgent {
  name: string;
  isCustom: true;
}

export type ReviewAgent = BuiltinReviewAgent | CustomReviewAgent;

export type ReviewAgentDraft = Pick<CustomReviewAgent, 'name' | 'systemPrompt' | 'knowledge'>;

export function isBuiltinReviewAgentId(agentId: string): agentId is BuiltinReviewAgentId {
  return BUILTIN_REVIEW_AGENT_IDS.includes(agentId as BuiltinReviewAgentId);
}
