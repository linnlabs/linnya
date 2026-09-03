import * as contextManager from 'linnkit/context-manager';
import { PromptKeys } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type {
  AgentInvokeRequest,
  AgentUserQuote,
} from 'src/app-hosts/linnya/context/agent/contracts';
import type { AiMessage, ReasoningEffort, RuntimeResourceRef } from 'linnkit/contracts';

const { AGENT_CONSTANTS } = contextManager.agentConfig;

export interface BuildBaseAgentInvokeRequestInput {
  lastUserContent: string;
  currentUserEventId?: string;
  currentUserAttachments?: RuntimeResourceRef[];
  promptKey?: string;
  resolvedModelId?: string;
  imageGenerationModelId?: string;
  knowledgeBaseId?: string;
  maxSteps?: number;
  enableTools: boolean;
  availableTools?: string[];
  conversationHistory: AiMessage[];
  contextBefore?: string;
  contextAfter?: string;
  currentBlockContent?: string;
  documentFragment?: string;
  fences?: AgentInvokeRequest['fences'];
  currentParagraph?: string;
  documentTitle?: string;
  documentList?: string;
  projectMetadata?: AgentInvokeRequest['project_metadata'];
  documentMetadata?: AgentInvokeRequest['document_metadata'];
  userQuote?: AgentUserQuote;
  reasoningEffort?: ReasoningEffort | null;
}

/**
 * Host-layer request builder:
 * - converts flow/history-builder state into the product AgentInvokeRequest shape
 * - keeps the shape-mapping logic out of HistoryBuilder orchestration code
 */
export function buildBaseAgentInvokeRequest(
  input: BuildBaseAgentInvokeRequestInput,
): AgentInvokeRequest {
  return {
    query: input.lastUserContent,
    currentUserEventId: input.currentUserEventId,
    currentUserAttachments: input.currentUserAttachments,
    promptKey: input.promptKey || PromptKeys.DEFAULT,
    model_id: input.resolvedModelId,
    context_before: input.contextBefore || '',
    context_after: input.contextAfter || '',
    currentBlockContent: input.currentBlockContent || '',
    document_fragment: input.documentFragment || '',
    fences: input.fences,
    current_paragraph: input.currentParagraph || '',
    document_title: input.documentTitle || '',
    imageGenerationModelId: input.imageGenerationModelId,
    knowledgeBaseId: input.knowledgeBaseId,
    maxSteps: input.maxSteps ?? AGENT_CONSTANTS.DEFAULT_MAX_STEPS,
    enableTools: input.enableTools,
    availableTools: input.availableTools,
    conversationHistory: input.conversationHistory,
    project_metadata: input.projectMetadata,
    document_metadata: input.documentMetadata,
    document_list: input.documentList,
    user_quote: input.userQuote,
    reasoning_effort: input.reasoningEffort,
  };
}
