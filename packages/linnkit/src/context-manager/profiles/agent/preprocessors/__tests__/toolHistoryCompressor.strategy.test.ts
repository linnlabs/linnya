import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../../../contracts';
import {
  ContextProviderError,
  TOOL_HISTORY_OVERFLOW_ERROR_CODE,
} from '../../../../shared/providers/base';
import { PREPROCESSOR_PRIORITY } from '../../../../shared/preprocessors/priority';
import { createDefaultAgentPreprocessorRegistry, PreprocessorPipeline } from '../index';
import { ToolHistoryCompressorPreprocessor } from '../toolHistoryCompressor';
import { ToolCallIdSchema } from '../../../../../contracts';

function createUserInput(id: string, timestamp: number): AiMessage {
  return {
    id,
    role: 'user',
    type: 'user_input',
    content: `用户请求 ${id}`,
    timestamp,
  };
}

function createToolGroup(runId: string, ordinal: number): AiMessage[] {
  const toolCallId = `tc_${runId}_${ordinal}`;
  const timestamp = ordinal * 100;
  return [
    {
      id: `a_${runId}_${ordinal}`,
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp,
      metadata: {
        tool_calls: [
          {
            id: ToolCallIdSchema.parse(toolCallId),
            type: 'function',
            function: {
              name: 'workspace_read',
              arguments: JSON.stringify({ path: `${runId}-${ordinal}.md` }),
            },
          },
        ],
      },
    },
    {
      id: `t_${runId}_${ordinal}`,
      role: 'tool',
      type: 'tool_output',
      content: `工具结果 ${runId}-${ordinal}`,
      timestamp: timestamp + 1,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        tool_name: 'workspace_read',
        data: { value: `工具结果 ${runId}-${ordinal}` },
      },
    },
  ];
}

function ids(messages: AiMessage[]): string[] {
  return messages.map(message => message.id);
}

function compressedCount(messages: AiMessage[]): number {
  return messages.filter(message => message.metadata?.isCompressedToolHistory === true).length;
}

describe('ToolHistoryCompressorPreprocessor strategy options', () => {
  it("defaults to strategy: 'per-run'", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor();
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });

    expect(ids(result.messages)).toEqual(ids(messages));
    expect(compressedCount(result.messages)).toBe(0);
  });

  it("strategy: 'per-pair' keeps the latest two global tool groups", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'per-pair',
      keepLatestToolPairs: 2,
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });
    const resultIds = ids(result.messages);

    expect(resultIds).not.toContain('a_r1_1');
    expect(resultIds).not.toContain('t_r1_1');
    expect(resultIds).toContain('a_r1_2');
    expect(resultIds).toContain('t_r1_2');
    expect(resultIds).toContain('a_r1_3');
    expect(resultIds).toContain('t_r1_3');
    expect(compressedCount(result.messages)).toBe(0);
    expect(result.appliedStrategies).toContain('tool_history_drop');
  });

  it("retentionMode: 'compress' keeps the previous summary replacement behavior", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'per-pair',
      retentionMode: 'compress',
      keepLatestToolPairs: 2,
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });
    const resultIds = ids(result.messages);

    expect(resultIds).not.toContain('a_r1_1');
    expect(resultIds).not.toContain('t_r1_1');
    expect(resultIds).toContain('a_r1_2');
    expect(resultIds).toContain('t_r1_2');
    expect(resultIds).toContain('a_r1_3');
    expect(resultIds).toContain('t_r1_3');
    expect(compressedCount(result.messages)).toBe(1);
    expect(result.appliedStrategies).toContain('tool_history_compression');
  });

  it("strategy: 'per-run' with keepLatestRuns: 1 keeps every group in the latest historical run", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'per-run',
      keepLatestRuns: 1,
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      ...createToolGroup('r1', 4),
      ...createToolGroup('r1', 5),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });
    const resultIds = ids(result.messages);

    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      expect(resultIds).toContain(`a_r1_${ordinal}`);
      expect(resultIds).toContain(`t_r1_${ordinal}`);
    }
    expect(compressedCount(result.messages)).toBe(0);
  });

  it("strategy: 'per-run' with keepLatestRuns: 2 keeps the latest two historical runs", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'per-run',
      keepLatestRuns: 2,
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      createUserInput('u_2', 2),
      ...createToolGroup('r2', 1),
      ...createToolGroup('r2', 2),
      ...createToolGroup('r2', 3),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });
    const resultIds = ids(result.messages);

    for (const id of [
      'a_r1_1',
      't_r1_1',
      'a_r1_2',
      't_r1_2',
      'a_r2_1',
      't_r2_1',
      'a_r2_2',
      't_r2_2',
      'a_r2_3',
      't_r2_3',
    ]) {
      expect(resultIds).toContain(id);
    }
    expect(compressedCount(result.messages)).toBe(0);
  });

  it("strategy: 'none' keeps tool groups unchanged when the safety cap is not exceeded", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'none',
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });

    expect(ids(result.messages)).toEqual(ids(messages));
    expect(compressedCount(result.messages)).toBe(0);
  });

  it("overflowStrategy: 'keep-latest' keeps the latest groups when per-run exceeds maxInteractionGroups", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'per-run',
      keepLatestRuns: 1,
      maxInteractionGroups: 3,
      overflowStrategy: 'keep-latest',
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      ...createToolGroup('r1', 4),
      ...createToolGroup('r1', 5),
      createUserInput('u_current', 999),
    ];

    const result = await preprocessor.process(messages, { debugMode: false });
    const resultIds = ids(result.messages);

    for (const id of ['a_r1_1', 't_r1_1', 'a_r1_2', 't_r1_2']) {
      expect(resultIds).not.toContain(id);
    }
    for (const id of ['a_r1_3', 't_r1_3', 'a_r1_4', 't_r1_4', 'a_r1_5', 't_r1_5']) {
      expect(resultIds).toContain(id);
    }
    expect(compressedCount(result.messages)).toBe(0);
    expect(result.appliedStrategies).toContain('tool_history_drop');
  });

  it("overflowStrategy: 'fail-fast' throws a typed ContextProviderError", async () => {
    const preprocessor = new ToolHistoryCompressorPreprocessor({
      strategy: 'per-run',
      keepLatestRuns: 1,
      maxInteractionGroups: 3,
      overflowStrategy: 'fail-fast',
    });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      ...createToolGroup('r1', 4),
      ...createToolGroup('r1', 5),
      createUserInput('u_current', 999),
    ];

    let caughtError: unknown;
    try {
      await preprocessor.process(messages, { debugMode: false });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ContextProviderError);
    if (!(caughtError instanceof ContextProviderError)) {
      throw new Error('expected ContextProviderError');
    }
    expect(caughtError.code).toBe(TOOL_HISTORY_OVERFLOW_ERROR_CODE);
    expect(caughtError.fatal).toBe(true);
  });

  it('passes toolHistory options through the default agent preprocessor registry', async () => {
    const registry = createDefaultAgentPreprocessorRegistry({
      toolHistory: {
        strategy: 'per-run',
        keepLatestRuns: 1,
      },
    });
    const pipeline = new PreprocessorPipeline(registry, { debugMode: false });
    const messages: AiMessage[] = [
      createUserInput('u_1', 1),
      ...createToolGroup('r1', 1),
      ...createToolGroup('r1', 2),
      ...createToolGroup('r1', 3),
      createUserInput('u_current', 999),
    ];

    const result = await pipeline.process(messages);

    expect(ids(result.messages)).toEqual(ids(messages));
  });

  it('keeps the default agent preprocessor order explicit', () => {
    const registry = createDefaultAgentPreprocessorRegistry();

    expect(
      registry.getAllPreprocessors().map(preprocessor => ({
        name: preprocessor.name,
        priority: preprocessor.priority,
      }))
    ).toEqual([
      {
        name: 'ToolHistoryCompressorPreprocessor',
        priority: PREPROCESSOR_PRIORITY.toolHistoryCompression,
      },
      {
        name: 'ToolReplayProtocolGuardPreprocessor',
        priority: PREPROCESSOR_PRIORITY.toolReplayProtocolGuard,
      },
      {
        name: 'HistoryPurificationPreprocessor',
        priority: PREPROCESSOR_PRIORITY.historyPurification,
      },
    ]);
  });
});
