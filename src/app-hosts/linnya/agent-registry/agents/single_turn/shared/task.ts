import { generateAiMessageId } from 'linnkit/contracts';
import * as contextManager from 'linnkit/context-manager';
import type { AiMessage } from 'linnkit/contracts';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';

/**
 * 单轮任务基类。
 *
 * 中文备注：
 * - 这些任务的业务语义是“一次请求直接拿文本结果”，不消费历史，也不暴露工具；
 * - 具体字段如何拼 user message 仍由各 task 自己实现，避免把产品字段堆进通用基类。
 */
export abstract class SingleTurnAgentTask extends contextManager.agentTasks.BaseAgentTask {
  protected abstract buildSystemPrompt(request: AgentInvokeRequest): string;
  protected abstract buildUserMessage(request: AgentInvokeRequest): string;

  protected getSystemPrompt(request: AgentInvokeRequest): string {
    return this.buildSystemPrompt(request);
  }

  buildMessages(request: AgentInvokeRequest, _history: AiMessage[]): AiMessage[] {
    const now = Date.now();
    const systemPrompt = this.buildSystemPrompt(request).trim();
    const userMessage = this.buildUserMessage(request);
    const messages: AiMessage[] = [];

    if (systemPrompt) {
      messages.push({
        id: generateAiMessageId(),
        role: 'system',
        type: 'system_prompt',
        content: systemPrompt,
        timestamp: now,
      });
    }

    messages.push({
      id: generateAiMessageId(),
      role: 'user',
      type: 'user_input',
      content: userMessage,
      timestamp: now + 1,
    });

    return messages;
  }
}

export function stripThinkAndReasoning(rawResponse: string): string {
  return rawResponse
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*reasoning[:：]\s*/gim, '')
    .replace(/^\s*思考[:：]\s*/gim, '')
    .replace(/^\s*thought[:：]\s*/gim, '')
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

export function hideThinkTagChunk(chunk: string): string {
  if (chunk.includes('<think>') || chunk.includes('</think>')) {
    return '';
  }
  return chunk;
}
