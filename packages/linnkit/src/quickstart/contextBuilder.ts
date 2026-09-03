import type {
  GraphExecutorContextBuildInput,
  GraphExecutorContextBuildOutput,
  GraphExecutorContextBuilder,
} from '../runtime-kernel';
import type { LlmRequestMessage } from '../ports';
import type { RuntimeEvent } from '../contracts';
import type { DefinedAgent } from './types';
import { buildQuickstartContextTrace } from './functions/contextTrace';

function runtimeEventToMessage(event: RuntimeEvent): LlmRequestMessage | undefined {
  switch (event.type) {
    case 'user_input':
      return { role: 'user', content: event.content };
    case 'final_answer':
      return event.completion_reason === 'terminal'
        ? { role: 'assistant', content: event.content }
        : undefined;
    case 'tool_output':
      if (typeof event.tool_call_id === 'string') {
        return {
          role: 'tool',
          tool_call_id: event.tool_call_id,
          content: event.observation,
        };
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Quickstart 专用 context builder。
 *
 * 中文备注：
 * - 只覆盖 hello-agent 级别的 system + history + current user input；
 * - 生产 host 仍应接 `context-manager` 的 AgentMessageOrchestrator。
 */
export class QuickstartContextBuilder implements GraphExecutorContextBuilder {
  private readonly agent: DefinedAgent;

  constructor(agent: DefinedAgent) {
    this.agent = agent;
  }

  async build(input: GraphExecutorContextBuildInput): Promise<GraphExecutorContextBuildOutput> {
    const historyMessages = input.history
      .map(runtimeEventToMessage)
      .filter((message): message is LlmRequestMessage => message !== undefined);

    return {
      llmMessages: [
        { role: 'system', content: this.agent.systemPrompt },
        ...historyMessages,
        { role: 'user', content: input.request.query },
      ],
      contextTrace: buildQuickstartContextTrace({
        agentId: this.agent.spec.id,
        messageCount: historyMessages.length + 2,
        contextPolicy: this.agent.spec.contextPolicy,
      }),
    };
  }
}
