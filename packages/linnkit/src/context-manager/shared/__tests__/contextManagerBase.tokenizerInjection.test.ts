import { describe, expect, it } from 'vitest';
import type { AiMessage } from '../../../contracts';
import type { TokenizerPort } from '../../../ports';
import { ContextManagerBase } from '../context-manager-base';
import { ContextProviderRegistry } from '../providers/registry';

interface TestConfig {
  AVG_CHARS_PER_TOKEN: number;
  TOOL_CALL_OVERHEAD_TOKENS?: number;
  TOKEN_ENCODING_NAME?: string;
}

class TestContextManager extends ContextManagerBase<TestConfig, ContextProviderRegistry<TestConfig>> {
  constructor(options: {
    customConfig?: Partial<TestConfig>;
    tokenizer?: TokenizerPort;
    tokenizerModelId?: string;
  } = {}) {
    super(options, {
      defaultConfig: {
        AVG_CHARS_PER_TOKEN: 2,
        TOOL_CALL_OVERHEAD_TOKENS: 10,
      },
      validateConfig: () => true,
      createRegistry: () => new ContextProviderRegistry<TestConfig>(),
      loggerName: 'TestContextManager',
      invalidConfigMessage: 'invalid test config',
    });
  }

  estimate(message: AiMessage): number {
    return this.estimateTokens(message);
  }
}

function userMessage(content: string): AiMessage {
  return {
    id: `msg_${content}`,
    role: 'user',
    type: 'user_input',
    content,
    timestamp: 1,
  };
}

describe('ContextManagerBase tokenizer injection', () => {
  it('uses host tokenizer when injected', () => {
    const seenModels: Array<string | undefined> = [];
    const manager = new TestContextManager({
      tokenizerModelId: 'claude-test',
      tokenizer: {
        estimateText: () => 0,
        estimateMessage: (_message, modelId) => {
          seenModels.push(modelId);
          return 1234;
        },
      },
      customConfig: {
        AVG_CHARS_PER_TOKEN: 999,
        TOOL_CALL_OVERHEAD_TOKENS: 999,
      },
    });

    expect(manager.estimate(userMessage('hello'))).toBe(1234);
    expect(seenModels).toEqual(['claude-test']);
  });

  it('updates tokenizer model id when a reused manager switches models', () => {
    const seenModels: Array<string | undefined> = [];
    const manager = new TestContextManager({
      tokenizerModelId: 'model-a',
      tokenizer: {
        estimateText: () => 0,
        estimateMessage: (_message, modelId) => {
          seenModels.push(modelId);
          return 1;
        },
      },
    });

    manager.estimate(userMessage('first'));
    manager.updateTokenizerModelId('model-b');
    manager.estimate(userMessage('second'));

    expect(seenModels).toEqual(['model-a', 'model-b']);
  });

  it('uses updated tokenEstimation config for the default tokenizer', () => {
    const manager = new TestContextManager({
      customConfig: {
        AVG_CHARS_PER_TOKEN: 3,
      },
    });

    expect(manager.estimate(userMessage('123456789'))).toBe(8);
    manager.updateConfig({ AVG_CHARS_PER_TOKEN: 9 });
    expect(manager.estimate(userMessage('123456789'))).toBe(6);
  });
});
