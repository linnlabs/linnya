import { describe, expect, it } from 'vitest';

import { noopTelemetry } from '../noopTelemetry';
import { TELEMETRY_EVENT_KINDS } from '../telemetryEvents';
import type { TelemetryEvent } from '../telemetryPort';

describe('TelemetryPort contract', () => {
  it('declares the stable telemetry event kinds', () => {
    expect(TELEMETRY_EVENT_KINDS).toEqual([
      'llm_call',
      'tool_call',
      'context_build',
      'context_compaction',
      'graph_node',
      'run_lifecycle',
    ]);
  });

  it('accepts context compaction audit facts without exposing summary content', () => {
    const event: TelemetryEvent = {
      kind: 'context_compaction',
      modelId: 'gpt-4.1',
      durationMs: 800,
      compactionIndex: 1,
      maxCompactionsPerRun: 12,
      generationAttempted: true,
      triggerRatio: 0.8,
      targetRatio: 0.5,
      beforeTokens: 85,
      inputBudgetTokens: 100,
      compactionInputTokens: 60,
      afterTokens: 45,
      replacedMessageCount: 8,
      replacedToolGroupCount: 3,
      keptToolGroupCount: 2,
      summaryOutputTokens: 12,
      outcome: 'completed',
      forcedPhaseRecovery: false,
      targetUnreachable: false,
      scope: { conversationId: 'conv-1', runId: 'run-1', turnId: 'turn-1' },
    };

    expect(() => noopTelemetry.emit(event)).not.toThrow();
    expect(event).not.toHaveProperty('content');
  });

  it('provides a noop telemetry sink that safely accepts events', async () => {
    const event: TelemetryEvent = {
      kind: 'llm_call',
      modelId: 'gpt-4.1',
      stream: true,
      durationMs: 120,
      scope: {
        conversationId: 'conv-1',
        runId: 'run-1',
      },
    };

    expect(() => noopTelemetry.emit(event)).not.toThrow();
    await expect(noopTelemetry.flush?.()).resolves.toBeUndefined();
  });

  it('accepts context_build events with build-time token estimates', () => {
    const event: TelemetryEvent = {
      kind: 'context_build',
      modelId: 'gpt-4.1',
      tokenEstimate: {
        localEstimateTokens: 10,
        calibratedEstimateTokens: 12,
        finalTokens: 12,
        source: 'local-estimate',
        confidence: 'estimate',
      },
      tokenComponents: [
        {
          componentId: '0:user-1',
          kind: 'user',
          tokens: 12,
          source: 'local-estimate',
          confidence: 'estimate',
          kept: true,
        },
      ],
      tokenLedgerEntry: {
        kind: 'context-component',
        id: 'context-ledger-1',
        components: [
          {
            componentId: '0:user-1',
            kind: 'user',
            tokens: 12,
            source: 'local-estimate',
            confidence: 'estimate',
            kept: true,
          },
        ],
        totalTokens: 12,
      },
      scope: {
        conversationId: 'conv-1',
        runId: 'run-1',
        turnId: 'turn-1',
      },
    };

    expect(() => noopTelemetry.emit(event)).not.toThrow();
  });
});
