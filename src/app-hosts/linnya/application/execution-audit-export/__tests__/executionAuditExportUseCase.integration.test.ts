import { describe, expect, it } from 'vitest';
import { createExecutionAuditExportUseCase } from '..';

describe('execution audit export use case', () => {
  it('按 root run 收入 child，并区分 actual、estimate 与 missing usage', async () => {
    const useCase = createExecutionAuditExportUseCase({
      runs: {
        async listByConversation() {
          return [
            {
              runId: 'root-1',
              agentSpecId: 'default_agent',
              status: 'completed',
              startedAt: 100,
              updatedAt: 300,
              iterationsUsed: 77,
            },
            {
              runId: 'child-1',
              parentRunId: 'root-1',
              agentSpecId: 'plugin_agent_fixture',
              status: 'completed',
              startedAt: 150,
              updatedAt: 250,
              iterationsUsed: 58,
            },
            {
              runId: 'root-2',
              agentSpecId: 'default_agent',
              status: 'completed',
              startedAt: 400,
              updatedAt: 500,
            },
          ];
        },
      },
      telemetry: {
        async listByConversation() {
          return [
            {
              kind: 'llm_call',
              runId: 'root-1',
              emittedAt: 110,
              durationMs: 20,
              modelId: 'model-a',
              usage: {
                inputTokens: 100,
                outputTokens: 20,
                totalTokens: 130,
                reasoningTokens: 10,
                cacheReadTokens: 80,
                confidence: 'actual',
              },
            },
            {
              kind: 'llm_call',
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 160,
              durationMs: 30,
              modelId: 'model-a',
              usage: { inputTokens: 90, outputTokens: 10, confidence: 'estimate' },
            },
            {
              kind: 'llm_call',
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 170,
              durationMs: 40,
              modelId: 'model-b',
            },
            {
              kind: 'tool_call',
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 180,
              durationMs: 50,
              toolName: 'slides_build',
              ok: false,
              errorCode: 'validation_error',
            },
            {
              kind: 'context_compaction',
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 190,
              durationMs: 900,
              modelId: 'model-a',
              compactionIndex: 1,
              maxCompactionsPerRun: 12,
              generationAttempted: true,
              triggerRatio: 0.8,
              targetRatio: 0.5,
              beforeTokens: 8_500,
              inputBudgetTokens: 10_000,
              compactionInputTokens: 6_000,
              afterTokens: 4_800,
              replacedMessageCount: 20,
              replacedToolGroupCount: 5,
              keptToolGroupCount: 2,
              summaryOutputTokens: 600,
              usage: {
                inputTokens: 6_100,
                outputTokens: 580,
                cacheReadTokens: 5_500,
                confidence: 'actual',
              },
              outcome: 'completed',
              forcedPhaseRecovery: false,
            },
            {
              kind: 'context_compaction',
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 195,
              durationMs: 0,
              modelId: 'model-a',
              compactionIndex: 2,
              maxCompactionsPerRun: 12,
              generationAttempted: false,
              triggerRatio: 0.8,
              targetRatio: 0.5,
              beforeTokens: 10_100,
              inputBudgetTokens: 10_000,
              replacedMessageCount: 0,
              replacedToolGroupCount: 0,
              keptToolGroupCount: 0,
              outcome: 'insufficient',
              forcedPhaseRecovery: false,
              errorCode: 'context_compaction_insufficient',
              failureReason: 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
            },
            {
              kind: 'run_lifecycle',
              runId: 'child-1',
              emittedAt: 200,
              phase: 'completed',
              stepsUsed: 58,
              maxSteps: 60,
              terminalReason: 'completed',
            },
            {
              kind: 'run_lifecycle',
              runId: 'root-1',
              emittedAt: 210,
              phase: 'completed',
              stepsUsed: 77,
              maxSteps: 80,
              terminalReason: 'step_budget_forced_completion',
            },
            // Port 不承诺顺序；即使较早的 wait_user 观测后返回，也必须保留时间上最新终态。
            {
              kind: 'run_lifecycle',
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 185,
              phase: 'completed',
              stepsUsed: 30,
              maxSteps: 60,
              terminalReason: 'awaiting_user',
            },
            {
              kind: 'tool_call',
              runId: 'root-2',
              emittedAt: 450,
              durationMs: 10,
              toolName: 'unrelated_tool',
              ok: true,
            },
          ];
        },
      },
      events: {
        async listByConversation() {
          return [
            {
              kind: 'tool_decision' as const,
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 175,
              toolCallId: 'call-slides',
              toolName: 'slides_build',
            },
            {
              kind: 'tool_terminal' as const,
              runId: 'child-1',
              parentRunId: 'root-1',
              emittedAt: 180,
              toolCallId: 'call-slides',
              toolName: 'slides_build',
              status: 'error' as const,
            },
            {
              kind: 'tool_decision' as const,
              runId: 'root-1',
              emittedAt: 181,
              toolCallId: 'call-pending',
              toolName: 'read_file',
            },
            {
              kind: 'tool_terminal' as const,
              runId: 'root-1',
              emittedAt: 183,
              toolCallId: 'call-orphan',
              toolName: 'process',
              status: 'success' as const,
            },
            {
              kind: 'command_terminal' as const,
              runId: 'root-1',
              emittedAt: 184,
              toolCallId: 'call-shell',
              commandExecutionId: 'command-1',
              outcome: 'execution_ended' as const,
              terminationCause: 'natural_exit' as const,
              processExit: { status: 'observed' as const, exitCode: 2, signal: null },
            },
            {
              kind: 'tool_terminal' as const,
              runId: 'root-2',
              emittedAt: 450,
              toolCallId: 'call-unrelated',
              toolName: 'unrelated_tool',
              status: 'success' as const,
            },
          ];
        },
      },
      now: () => 600,
    });

    await expect(useCase.export({
      conversationId: 'conversation-1',
      runId: 'root-1',
    })).resolves.toMatchObject({
      generatedAt: 600,
      runs: [{ runId: 'root-1' }, { runId: 'child-1', parentRunId: 'root-1' }],
      sourceWindow: {
        telemetryEvents: 9,
        earliestTelemetryAt: 110,
        latestTelemetryAt: 210,
        eventFacts: 5,
      },
      llm: {
        calls: 3,
        providerActualCalls: 1,
        estimateCalls: 1,
        missingUsageCalls: 1,
        actualTokens: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokensReported: 130,
          reasoningTokensReported: 10,
          cacheReadTokensReported: 80,
        },
      },
      tools: {
        calls: 1,
        failedCalls: 1,
        byTool: [{
          toolName: 'slides_build',
          errorCodes: ['validation_error'],
        }],
      },
      toolPairing: {
        complete: false,
        paired: 1,
        decisionMissing: 1,
        terminalMissing: 1,
        duplicateTerminal: 0,
        records: expect.arrayContaining([
          expect.objectContaining({
            toolCallId: 'call-pending',
            pairingStatus: 'terminal_missing',
          }),
          expect.objectContaining({
            toolCallId: 'call-orphan',
            pairingStatus: 'decision_missing',
          }),
        ]),
      },
      commands: {
        executions: 1,
        nonZeroExitExecutions: 1,
        byExecution: [{
          commandExecutionId: 'command-1',
          processExit: { status: 'observed', exitCode: 2, signal: null },
        }],
      },
      contextCompaction: {
        observations: 2,
        attempts: 1,
        completed: 1,
        insufficient: 1,
        missingUsageCalls: 0,
        durationMs: 900,
        compactionInputTokensReported: 6_000,
        summaryOutputTokensReported: 600,
        releasedTokensReported: 3_700,
        providerActualCalls: 1,
        actualTokens: {
          inputTokens: 6_100,
          outputTokens: 580,
          cacheReadTokensReported: 5_500,
        },
        byRun: [{
          runId: 'child-1',
          parentRunId: 'root-1',
          maxCompactionsPerRun: 12,
          completed: 1,
          insufficient: 1,
          attempts: 1,
          missingUsageCalls: 0,
        }],
      },
      runLifecycle: {
        byRun: [
          {
            runId: 'child-1',
            parentRunId: 'root-1',
            terminalObservations: 2,
            stepsUsed: 58,
            maxSteps: 60,
            terminalReason: 'completed',
            emittedAt: 200,
          },
          {
            runId: 'root-1',
            stepsUsed: 77,
            maxSteps: 80,
            terminalReason: 'step_budget_forced_completion',
          },
        ],
      },
    });
  });

  it('显式 run 不属于会话时返回 null', async () => {
    const useCase = createExecutionAuditExportUseCase({
      runs: { async listByConversation() { return []; } },
      telemetry: { async listByConversation() { return []; } },
      events: { async listByConversation() { return []; } },
      now: () => 1,
    });
    await expect(useCase.export({
      conversationId: 'conversation-1',
      runId: 'missing',
    })).resolves.toBeNull();
  });
});
