/**
 * @file src/app-hosts/linnya/agent-registry/agents/review/task.ts
 * @description Review Agent Task（与 prompt 同目录收口）
 *
 * 说明：
 * - Review 需要额外注入 review_context/chunk_info/agent_knowledge
 * - 因此不能直接用 GenericAgentTask（Generic 不重写 buildMessages）
 * - 本实现与当前 agent profile task 语义对齐
 */

import { generateAiMessageId } from 'linnkit/contracts';
import * as contextManager from 'linnkit/context-manager';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../prompt.builder';
import { REVIEW_AGENT_PROMPT } from './prompt';
import type { AiMessage } from 'linnkit/contracts';
import { linnyaFenceRegistry } from 'src/app-hosts/linnya/context/agent/registerLinnyaFences';

function requireNonEmptyString(value: string | undefined, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[ReviewAgentTask] 缺少必填字段：${fieldName}`);
  }
  return value.trim();
}

function requireNumber(value: number | undefined, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`[ReviewAgentTask] 缺少必填字段：${fieldName}`);
  }
  return value;
}

export class ReviewAgentTask extends contextManager.agentTasks.BaseAgentTask {
  readonly name = 'ReviewAgentTask(Registry)';

  constructor() {
    super({ fenceRegistry: linnyaFenceRegistry });
  }

  protected getSystemPrompt(request: AgentInvokeRequest): string {
    const agentSystemPrompt = requireNonEmptyString(request.agent_system_prompt, 'agent_system_prompt');
    // agent_name 在旧实现里用于模板变量，这里 prompt 不需要，但仍保持校验一致性（避免 enricher 漏注入）
    requireNonEmptyString(request.agent_name, 'agent_name');

    return buildPrompt(REVIEW_AGENT_PROMPT, {
      agent_system_prompt: agentSystemPrompt,
      language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。'
    });
  }

  buildMessages(request: AgentInvokeRequest, history: AiMessage[]): AiMessage[] {
    const messages = super.buildMessages(request, history);
    const reviewContextContent = this.buildReviewContextContent(request);
    if (!reviewContextContent) return messages;

    const reviewContextMessage: AiMessage = {
      id: generateAiMessageId(),
      role: 'user',
      type: 'context_injection',
      content: reviewContextContent,
      timestamp: Date.now(),
      metadata: {
        fenceKind: 'review-context',
        fenceAttrs: {},
        fencePlacement: 'after-system',
        fragmentType: 'review_context',
        source: 'review',
      }
    };

    const systemPromptIndex = messages.findIndex(m => m.type === 'system_prompt');
    if (systemPromptIndex !== -1) {
      messages.splice(systemPromptIndex + 1, 0, reviewContextMessage);
    } else {
      messages.unshift(reviewContextMessage);
    }

    return messages;
  }

  private buildReviewContextContent(request: AgentInvokeRequest): string {
    const sections: string[] = [];

    const reviewBackground = typeof request.review_background === 'string' ? request.review_background.trim() : '';
    const reviewGoal = typeof request.review_goal === 'string' ? request.review_goal.trim() : '';

    if (reviewBackground || reviewGoal) {
      const contextLines: string[] = [];
      if (reviewBackground) {
        contextLines.push(`Background: ${reviewBackground}`);
      }
      if (reviewGoal) {
        contextLines.push(`Goal: ${reviewGoal}`);
      }
      sections.push(`<review_context>\n${contextLines.join('\n')}\n</review_context>`);
    }

    const chunkIndex = requireNumber(request.chunk_index, 'chunk_index');
    const totalChunks = requireNumber(request.total_chunks, 'total_chunks');
    sections.push(`<chunk_info>
You are reviewing chunk ${chunkIndex + 1} of ${totalChunks} total chunks.
Each chunk contains complete blocks from the document. Only create annotations for blocks in THIS chunk.
</chunk_info>`);

    const agentKnowledge = (request.agent_knowledge ?? '').toString().trim();
    if (agentKnowledge) {
      sections.push(`<agent_knowledge>\n${agentKnowledge}\n</agent_knowledge>`);
    }

    return sections.join('\n\n');
  }

  /**
   * 注意：
   * - 模型/能力偏好属于“角色配置”，必须内聚在 `agents/review/index.ts`；
   * - 这里不再覆盖 getPreferredModelCapability，避免出现“双来源”导致维护分叉。
   */
}
