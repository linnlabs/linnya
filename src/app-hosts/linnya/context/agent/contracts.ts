import type * as contextManager from '@linnlabs/linnkit/context-manager';
import type { AiMessage, ReasoningEffort } from '@linnlabs/linnkit/contracts';
import type { UserQuoteData } from '@app/schemas';

type AgentProfileRequest = contextManager.agentContracts.AgentProfileRequest;

export interface AgentProjectMetadata {
  id?: string;
  name?: string;
  description?: string;
}

export interface AgentDocumentMetadata {
  id?: string;
  title?: string;
}

export type AgentUserQuote = UserQuoteData;

export interface AgentRecentRejection {
  suggestionText: string;
  userContinuedWith?: string;
}

export type AgentAutocompleteIntentKey =
  | 'continue_paragraph'
  | 'list_next_item'
  | 'bridge_to_suffix_delimiter'
  | 'rewrite_after_large_delete'
  | 'structure_editing';

export interface AgentAutocompleteBehaviorSummary {
  totalEvents: number;
  totalInsertedChars: number;
  totalDeletedChars: number;
  recentDeletedChars?: number;
  hasLargeRecentDelete?: boolean;
  typingSpeedCps?: number;
}

export interface AgentInvokeRequest extends AgentProfileRequest {
  model_id?: string;
  imageGenerationModelId?: string;
  context_before?: string;
  context_after?: string;
  currentBlockContent?: string;
  document_fragment?: string;
  current_paragraph?: string;
  document_title?: string;
  document_toc?: string;
  document_list?: string;
  knowledgeBaseId?: string;
  maxSteps?: number;
  enableTools?: boolean;
  conversationHistory?: AiMessage[];
  /** 用户选择的思考努力程度；null/undefined 表示走模型默认 */
  reasoning_effort?: ReasoningEffort | null;
  project_metadata?: AgentProjectMetadata;
  document_metadata?: AgentDocumentMetadata;
  user_quote?: AgentUserQuote;
  injected_context?: string;
  review_run_id?: string;
  agent_id?: string;
  chunk_index?: number;
  total_chunks?: number;
  review_background?: string;
  review_goal?: string;
  agent_name?: string;
  agent_system_prompt?: string;
  agent_knowledge?: string;
  completionLengthHint?: string;
  recentRejections?: AgentRecentRejection[];
  intentKey?: AgentAutocompleteIntentKey;
  intentConfidence?: number;
  intentConstraints?: string[];
  behaviorSummary?: AgentAutocompleteBehaviorSummary;
}
