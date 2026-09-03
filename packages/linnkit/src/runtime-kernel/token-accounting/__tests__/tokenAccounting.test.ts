import { describe, expect, it } from 'vitest';

import type { CanonicalLlmUsage, TokenLedgerAggregate, TokenLedgerEntry } from '../../../contracts';
import {
  addLedgerAggregate,
  addUsageTotals,
  aggregateCanonicalUsage,
  aggregateTokenLedgerEntries,
  computeCost,
  createContextComponentLedgerEntry,
  createLlmUsageLedgerEntry,
  createRunTokenUsageAggregate,
} from '../functions';

function actualUsage(overrides: Partial<CanonicalLlmUsage> = {}): CanonicalLlmUsage {
  return {
    inputTokens: 100,
    outputTokens: 40,
    source: 'provider-response-usage',
    confidence: 'actual',
    ...overrides,
  };
}

describe('token accounting', () => {
  it('aggregates canonical usage without using totalTokens to infer missing fields', () => {
    const aggregate = aggregateCanonicalUsage([
      actualUsage({
        inputTokens: 80,
        outputTokens: 20,
        reasoningTokens: 5,
        cacheReadTokens: 10,
        totalTokens: 115,
      }),
      actualUsage({
        inputTokens: 30,
        outputTokens: 15,
        cacheWriteTokens: 7,
      }),
    ]);

    expect(aggregate).toEqual({
      inputTokens: 110,
      outputTokens: 35,
      reasoningTokens: 5,
      cacheReadTokens: 10,
      cacheWriteTokens: 7,
      totalTokens: undefined,
      usageCount: 2,
    });
  });

  it('keeps optional token components unknown when no provider reported them', () => {
    const aggregate = aggregateCanonicalUsage([
      actualUsage({ inputTokens: 10, outputTokens: 5 }),
      actualUsage({ inputTokens: 20, outputTokens: 8 }),
    ]);

    expect(aggregate).toEqual({
      inputTokens: 30,
      outputTokens: 13,
      reasoningTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      totalTokens: undefined,
      usageCount: 2,
    });
  });

  it('汇总图片输入分项但不把它重复加进 input、total 或费用', () => {
    const aggregate = aggregateCanonicalUsage([
      actualUsage({
        inputTokens: 100,
        imageInputTokens: 25,
        outputTokens: 20,
        totalTokens: 120,
      }),
      actualUsage({
        inputTokens: 40,
        imageInputTokens: 10,
        outputTokens: 5,
        totalTokens: 45,
      }),
    ]);

    expect(aggregate).toMatchObject({
      inputTokens: 140,
      imageInputTokens: 35,
      outputTokens: 25,
      totalTokens: 165,
    });
    expect(computeCost(
      actualUsage({
        inputTokens: 100,
        imageInputTokens: 25,
        outputTokens: 20,
        totalTokens: 120,
      }),
      {
        currency: 'USD',
        unit: 'per_1m_tokens',
        input: 10,
        output: 20,
      },
    )).toMatchObject({
      inputCost: 0.001,
      outputCost: 0.0004,
      totalCost: 0.0014,
    });
  });

  it('creates context component entries from explicit component tokens', () => {
    const entry = createContextComponentLedgerEntry({
      id: 'ledger-context-1',
      runId: 'run-1',
      components: [
        {
          componentId: 'msg-user-1',
          kind: 'user',
          tokens: 12,
          source: 'local-estimate',
          confidence: 'estimate',
          messageId: 'msg-1',
          kept: true,
        },
        {
          componentId: 'summary-1',
          kind: 'history-summary',
          tokens: 8,
          source: 'local-estimate',
          confidence: 'estimate',
          kept: true,
        },
      ],
    });

    expect(entry.totalTokens).toBe(20);
    expect(entry.components).toHaveLength(2);
  });

  it('keeps execution-time tool truncation estimates on context components', () => {
    const entry = createContextComponentLedgerEntry({
      id: 'ledger-context-tool-truncation',
      components: [
        {
          componentId: 'tool-output-1',
          kind: 'tool',
          tokens: 25,
          source: 'local-estimate',
          confidence: 'estimate',
          messageId: 'tool-msg-1',
          kept: true,
          truncatedAtExecution: true,
          originalTokensEstimate: 80,
          droppedTokensEstimate: 55,
        },
      ],
    });

    expect(entry.totalTokens).toBe(25);
    expect(entry.components[0]).toMatchObject({
      truncatedAtExecution: true,
      originalTokensEstimate: 80,
      droppedTokensEstimate: 55,
    });
  });

  it('aggregates ledger entries with cache tokens kept separate from ordinary input', () => {
    const entries: TokenLedgerEntry[] = [
      createLlmUsageLedgerEntry({
        id: 'ledger-llm-1',
        runId: 'run-1',
        modelId: 'gpt-4.1',
        usage: actualUsage({
          inputTokens: 90,
          outputTokens: 25,
          cacheReadTokens: 30,
          totalTokens: 145,
        }),
      }),
      createContextComponentLedgerEntry({
        id: 'ledger-context-1',
        runId: 'run-1',
        components: [
          {
            componentId: 'system-1',
            kind: 'system',
            tokens: 14,
            source: 'local-estimate',
            confidence: 'estimate',
          },
        ],
      }),
    ];

    expect(aggregateTokenLedgerEntries(entries)).toEqual({
      llmUsage: {
        inputTokens: 90,
        outputTokens: 25,
        reasoningTokens: undefined,
        cacheReadTokens: 30,
        cacheWriteTokens: undefined,
        totalTokens: 145,
        usageCount: 1,
      },
      contextTokens: 14,
      entryCount: 2,
      llmCallCount: 1,
      contextComponentCount: 1,
    });
  });

  it('keeps parent own usage separate from children totals', () => {
    const parentEntry = createLlmUsageLedgerEntry({
      id: 'parent-ledger',
      runId: 'parent-run',
      usage: actualUsage({ inputTokens: 10, outputTokens: 4 }),
    });
    const childAggregate: TokenLedgerAggregate = aggregateTokenLedgerEntries([
      createLlmUsageLedgerEntry({
        id: 'child-ledger',
        runId: 'child-run',
        parentRunId: 'parent-run',
        usage: actualUsage({ inputTokens: 50, outputTokens: 30 }),
      }),
    ]);

    expect(createRunTokenUsageAggregate({
      ownEntries: [parentEntry],
      childAggregates: [childAggregate],
    })).toEqual({
      own: {
        llmUsage: {
          inputTokens: 10,
          outputTokens: 4,
          reasoningTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          totalTokens: undefined,
          usageCount: 1,
        },
        contextTokens: 0,
        entryCount: 1,
        llmCallCount: 1,
        contextComponentCount: 0,
      },
      children: {
        llmUsage: {
          inputTokens: 50,
          outputTokens: 30,
          reasoningTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          totalTokens: undefined,
          usageCount: 1,
        },
        contextTokens: 0,
        entryCount: 1,
        llmCallCount: 1,
        contextComponentCount: 0,
      },
    });
  });

  it('exports pure aggregate adders so host collectors can merge without reimplementing accounting rules', () => {
    const left = aggregateTokenLedgerEntries([
      createLlmUsageLedgerEntry({
        id: 'left-ledger',
        runId: 'run-1',
        usage: actualUsage({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 }),
      }),
    ]);
    const right = aggregateTokenLedgerEntries([
      createLlmUsageLedgerEntry({
        id: 'right-ledger',
        runId: 'run-1',
        usage: actualUsage({ inputTokens: 20, outputTokens: 8, cacheWriteTokens: 3 }),
      }),
    ]);

    expect(addUsageTotals(left.llmUsage, right.llmUsage)).toEqual({
      inputTokens: 30,
      outputTokens: 12,
      reasoningTokens: undefined,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      totalTokens: undefined,
      usageCount: 2,
    });
    expect(addLedgerAggregate(left, right)).toMatchObject({
      llmCallCount: 2,
      entryCount: 2,
      llmUsage: {
        inputTokens: 30,
        outputTokens: 12,
      },
    });
  });

  it('computes token cost as a pure split by reported components', () => {
    const cost = computeCost(
      actualUsage({
        inputTokens: 1_000,
        outputTokens: 500,
        reasoningTokens: 250,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 100,
      }),
      {
        currency: 'USD',
        unit: 'per_1m_tokens',
        input: 10,
        output: 20,
        reasoning: 30,
        cacheRead: 1,
        cacheWrite: 5,
      },
    );

    expect(cost).toEqual({
      status: 'computed',
      currency: 'USD',
      inputCost: 0.01,
      outputCost: 0.01,
      reasoningCost: 0.0075,
      cacheReadCost: 0.002,
      cacheWriteCost: 0.0005,
      totalCost: 0.03,
    });
  });

  it('returns unknown when a reported nonzero component has no price', () => {
    expect(computeCost(
      actualUsage({
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
      }),
      {
        currency: 'USD',
        unit: 'per_1m_tokens',
        input: 1,
        output: 2,
      },
    )).toEqual({
      status: 'unknown',
      currency: 'USD',
      missingPriceComponents: ['reasoning'],
    });
  });

  it('does not require prices for unreported or explicit zero optional components', () => {
    const cost = computeCost(
      actualUsage({
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 0,
      }),
      {
        currency: 'USD',
        unit: 'per_1m_tokens',
        input: 1,
        output: 2,
      },
    );

    expect(cost).toEqual({
      status: 'computed',
      currency: 'USD',
      inputCost: 0.0001,
      outputCost: 0.00004,
      reasoningCost: 0,
      cacheReadCost: undefined,
      cacheWriteCost: undefined,
      totalCost: 0.00014000000000000001,
    });
  });

  it('returns unknown when pricing is missing instead of treating price as zero', () => {
    expect(computeCost(actualUsage({ inputTokens: 1, outputTokens: 1 }))).toEqual({
      status: 'unknown',
      missingPriceComponents: ['input', 'output'],
    });
  });
});
