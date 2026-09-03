import * as contextManager from '../../context-manager';
import type { AiMessage, RuntimeEvent } from '../../contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 中文备注：
 * - ReplayHarness 负责把“持久化事实事件 -> LLM 回放消息”这个协议边界显式化；
 * - 测试不再直接散落调用 eventConverter，而是通过统一夹具观察回放结果；
 * - 这样后续如果回放语义升级，测试入口可以保持稳定。
 */
export interface ReplayHarness {
  replay(): AiMessage[];
  getAssistantToolCallMessages(): AiMessage[];
  getToolOutputMessages(): AiMessage[];
}

export function createReplayHarness(events: RuntimeEvent[]): ReplayHarness {
  const replay = (): AiMessage[] => contextManager.agentUtils.convertEventsToAiMessages(events);

  return {
    replay,
    getAssistantToolCallMessages(): AiMessage[] {
      return replay().filter((message) => {
        if (message.role !== 'assistant' || message.type !== 'tool_calls') {
          return false;
        }
        if (!isRecord(message.metadata)) {
          return false;
        }
        return Array.isArray(message.metadata.tool_calls);
      });
    },
    getToolOutputMessages(): AiMessage[] {
      return replay().filter((message) => message.role === 'tool' && message.type === 'tool_output');
    },
  };
}
