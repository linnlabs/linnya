import { describe, expect, it } from 'vitest';
import type { AiMessage } from '../../../contracts';
import {
  ContextManagerBase,
  type ContextManagerBaseConfig,
  type ContextManagerBaseOptions,
} from '../context-manager-base';
import { ContextProviderRegistry } from '../providers/registry';
import { ToolCallIdSchema } from '../../../contracts';

interface TestContextConfig extends ContextManagerBaseConfig {
  AVG_CHARS_PER_TOKEN: number;
  TOOL_CALL_OVERHEAD_TOKENS: number;
  TOKEN_ENCODING_NAME?: string;
}

const DEFAULT_CONFIG: TestContextConfig = {
  AVG_CHARS_PER_TOKEN: 2,
  TOOL_CALL_OVERHEAD_TOKENS: 10,
};

class TestContextManager extends ContextManagerBase<
  TestContextConfig,
  ContextProviderRegistry<TestContextConfig>
> {
  constructor(
    options: ContextManagerBaseOptions<
      TestContextConfig,
      ContextProviderRegistry<TestContextConfig>
    > = {}
  ) {
    super(options, {
      defaultConfig: DEFAULT_CONFIG,
      validateConfig: () => true,
      createRegistry: () => new ContextProviderRegistry<TestContextConfig>(),
      loggerName: 'TestContextManager',
      invalidConfigMessage: 'Invalid test config',
    });
  }

  estimate(message: AiMessage): number {
    return this.estimateTokens(message);
  }
}

function makeTextMessage(content: string): AiMessage {
  return {
    id: 'user_1',
    role: 'user',
    type: 'user_input',
    content,
    timestamp: 1,
  };
}

function makeToolCallMessage(): AiMessage {
  return {
    id: 'assistant_tool_calls',
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: 2,
    metadata: {
      tool_calls: [
        {
          id: ToolCallIdSchema.parse('call_1'),
          type: 'function',
          function: {
            name: 'search',
            arguments: '{}',
          },
        },
      ],
    },
  };
}

describe('ContextManagerBase token estimation', () => {
  it('uses avgCharsPerToken from config when no encoding is configured', () => {
    const manager = new TestContextManager({
      customConfig: {
        AVG_CHARS_PER_TOKEN: 3,
      },
    });

    // 中文备注：ContextManager 的消息估算包含基础 message overhead。
    expect(manager.estimate(makeTextMessage('123456789'))).toBe(8);
  });

  it('uses TOOL_CALL_OVERHEAD_TOKENS from config for tool call messages', () => {
    const lowOverheadManager = new TestContextManager({
      customConfig: {
        TOOL_CALL_OVERHEAD_TOKENS: 10,
      },
    });
    const highOverheadManager = new TestContextManager({
      customConfig: {
        TOOL_CALL_OVERHEAD_TOKENS: 70,
      },
    });

    expect(
      highOverheadManager.estimate(makeToolCallMessage()) -
        lowOverheadManager.estimate(makeToolCallMessage())
    ).toBe(60);
  });
});
