import { describe, expect, it } from 'vitest';
import type { ExecutorLocalState } from '../types';
import {
  createContextCompactionGraphHarness as createHarness,
  readContextCompactionTelemetry as contextCompactionTelemetry,
  runContextCompactionTick as tickInput,
} from './graphAgentExecutorContextCompactionHarness';

describe('GraphAgentExecutor context compaction', () => {
  it('79% 不压缩，80% 先压缩再执行主调用', async () => {
    const below = createHarness({ builds: [{ promptTokens: 79 }] });
    await expect(tickInput(below)).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'done' },
    });
    expect(below.compactionCall).not.toHaveBeenCalled();
    expect(below.mainCall).toHaveBeenCalledOnce();

    const atThreshold = createHarness({ builds: [{ promptTokens: 80 }] });
    await expect(tickInput(atThreshold)).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'done' },
    });
    expect(atThreshold.order).toEqual([
      'start',
      'compaction-call',
      'durable-commit',
      'end',
      'summary-event',
      'main-call',
    ]);
    expect(contextCompactionTelemetry(atThreshold)).toContainEqual(expect.objectContaining({
      outcome: 'completed',
      generationAttempted: true,
    }));
  });

  it('压缩请求复用模型与有序工具，但禁用工具、重试和 fallback', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 80 }],
      toolNames: ['required_tool', 'second_tool'],
    });

    await tickInput(harness, {
      enableTools: true,
      availableTools: ['required_tool', 'second_tool'],
    });

    const [modelId, messages, options] = harness.compactionCall.mock.calls[0]!;
    expect(modelId).toBe('model');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toContain('PRIMARY PROMPT [tokens:80]');
    expect(messages[0]?.content).not.toContain('<system-reminder>');
    expect(messages[1]).toEqual({
      role: 'user',
      content: '<system-reminder>\nCOMPACTION CONTROL [tokens:3]\n</system-reminder>',
    });
    expect(options).toMatchObject({
      tool_choice: 'none',
      retry_policy: 'none',
      allow_model_fallback: false,
      max_tokens: 20,
    });
    expect(options.tools?.map(tool => tool.name)).toEqual([
      'required_tool',
      'second_tool',
    ]);
    expect(harness.publishedSummaries).toHaveLength(1);
  });

  it('压缩输出上限取 route 容量，不被主回答的较小预留截断', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 92 }],
      mainOutputLimitTokens: 5,
      routeMaxOutputTokens: 10,
    });

    await tickInput(harness);

    expect(harness.compactionCall.mock.calls[0]?.[2].max_tokens).toBe(10);
    expect(harness.mainCall.mock.calls[0]?.[2].max_tokens).toBe(5);
  });

  it('软阈值下压缩失败，报告 error 后继续原主调用', async () => {
    const harness = createHarness({ compactionFailure: new Error('provider down') });

    await expect(tickInput(harness)).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'done' },
    });
    expect(harness.order).toEqual(['start', 'compaction-call', 'error', 'main-call']);
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'failed',
      generationAttempted: true,
      errorCode: 'llm.context.compaction_failed',
      failureReason: 'CONTEXT_COMPACTION_GENERATION_FAILED',
    }));
  });

  it('失败的真实压缩调用也消耗 run-local attempt 上限', async () => {
    const harness = createHarness({
      compactionFailure: new Error('provider down'),
      maxCompactionsPerRun: 2,
    });

    const first = await tickInput(harness);
    expect(first.executorLocalPatch?.contextCompaction).toEqual({
      attemptCount: 1,
      committedCount: 0,
    });
    const firstState = first.executorLocalPatch?.contextCompaction;
    if (!firstState) throw new Error('第一次压缩 attempt 状态缺失。');
    const second = await tickInput(harness, {
      executorLocal: {
        stepCount: 1,
        contextCompaction: firstState,
      },
    });
    expect(second.executorLocalPatch?.contextCompaction).toEqual({
      attemptCount: 2,
      committedCount: 0,
    });
    const secondState = second.executorLocalPatch?.contextCompaction;
    if (!secondState) throw new Error('第二次压缩 attempt 状态缺失。');
    await tickInput(harness, {
      executorLocal: {
        stepCount: 2,
        contextCompaction: secondState,
      },
    });

    expect(harness.compactionCall).toHaveBeenCalledTimes(2);
    expect(contextCompactionTelemetry(harness)).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'failed', compactionIndex: 1 }),
      expect.objectContaining({ outcome: 'failed', compactionIndex: 2 }),
      expect.objectContaining({
        outcome: 'skipped',
        suppressedReason: 'max_compactions_reached',
      }),
    ]));
  });

  it('硬超限且压缩失败时不调用主模型', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 91 }],
      mainOutputLimitTokens: 30,
      compactionFailure: new Error('provider down'),
    });

    await expect(tickInput(harness)).rejects.toMatchObject({
      code: 'llm.context.compaction_failed',
      reason: 'CONTEXT_COMPACTION_GENERATION_FAILED',
    });
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(harness.order).toEqual(['start', 'compaction-call', 'error']);
  });

  it.each([
    [85, true, undefined],
    [91, false, 30],
  ] as const)('格式错误在 %s tokens 时不提交摘要，并按原 Prompt 容量结算', async (
    promptTokens,
    shouldContinue,
    mainOutputLimitTokens,
  ) => {
    const harness = createHarness({
      builds: [{ promptTokens }],
      invalidOutputReason: 'missing_next_action',
      ...(mainOutputLimitTokens !== undefined ? { mainOutputLimitTokens } : {}),
    });
    const result = tickInput(harness);

    if (shouldContinue) {
      await expect(result).resolves.toMatchObject({ decision: { kind: 'final_answer' } });
      expect(harness.mainCall).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({
        code: 'llm.context.compaction_failed',
        reason: 'CONTEXT_COMPACTION_INVALID_OUTPUT',
      });
      expect(harness.mainCall).not.toHaveBeenCalled();
    }
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'failed',
      generationAttempted: true,
    }));
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'failed',
      compactionInputTokens: expect.any(Number),
      canonicalUsage: expect.objectContaining({
        inputTokens: 11,
        cacheReadTokens: 7,
      }),
    }));
  });

  it('硬超限但没有完整可替换区段时结算 typed insufficient', async () => {
    const harness = createHarness({ builds: [{ promptTokens: 101, candidate: false }] });

    await expect(tickInput(harness)).rejects.toMatchObject({
      code: 'llm.context.compaction_insufficient',
      reason: 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
    });
    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'insufficient',
      errorCode: 'llm.context.compaction_insufficient',
      replacedMessageCount: 0,
    }));
  });

  it('仍有同段历史却未压到目标水位时不提交摘要，软触发继续原主调用', async () => {
    const harness = createHarness({
      builds: [{
        promptTokens: 85,
        rebuiltTokens: 60,
        replaceableRangeExhausted: false,
      }],
    });

    await expect(tickInput(harness)).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'done' },
    });
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'insufficient',
      failureReason: 'CONTEXT_COMPACTION_TARGET_NOT_REACHED',
    }));
  });

  it('连续可替换区段耗尽时允许高于目标但低于硬上限', async () => {
    const harness = createHarness({ builds: [{ promptTokens: 85, rebuiltTokens: 60 }] });

    await expect(tickInput(harness)).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'done' },
    });
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'completed',
      maxCompactionsPerRun: 12,
      afterTokens: 60,
      targetUnreachable: true,
    }));
  });

  it.each([85, 90])('连续区段耗尽但重建为 %s tokens 时不提交无收益摘要', async (
    rebuiltTokens,
  ) => {
    const harness = createHarness({
      builds: [{ promptTokens: 85, rebuiltTokens }],
    });

    await expect(tickInput(harness)).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'done' },
    });
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(harness.mainCall).toHaveBeenCalledOnce();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'insufficient',
      generationAttempted: true,
      failureReason: 'CONTEXT_COMPACTION_INEFFECTIVE',
      afterTokens: rebuiltTokens,
    }));
  });

  it('压缩后仍超硬上限时不提交摘要，也不调用主模型', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 91, rebuiltTokens: 91 }],
      mainOutputLimitTokens: 30,
    });

    await expect(tickInput(harness)).rejects.toMatchObject({
      code: 'llm.context.compaction_insufficient',
      reason: 'CONTEXT_COMPACTION_REBUILD_OVER_BUDGET',
    });
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(harness.mainCall).not.toHaveBeenCalled();
  });

  it('持久化提交失败时，不向 UI 发布摘要也不调用主模型', async () => {
    const harness = createHarness({ commitFailure: new Error('sqlite failed') });

    await expect(tickInput(harness)).rejects.toMatchObject({
      code: 'llm.context.compaction_failed',
      reason: 'CONTEXT_COMPACTION_COMMIT_FAILED',
    });
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(harness.order).toEqual([
      'start',
      'compaction-call',
      'durable-commit',
      'error',
    ]);
  });

  it('durable commit 后的 fan-out 失败不伪装成压缩回滚', async () => {
    const harness = createHarness({ publishFailure: new Error('realtime failed') });

    await expect(tickInput(harness)).rejects.toThrow('realtime failed');
    expect(harness.committedSummaries).toHaveLength(1);
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(harness.summarizationCallbacks.onSummarizationError).not.toHaveBeenCalled();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'completed',
    }));
  });

  it.each([
    [85, true],
    [101, false],
  ] as const)('缺少提交端口时在 %s tokens 按原 Prompt 容量结算', async (
    promptTokens,
    shouldContinue,
  ) => {
    const harness = createHarness({
      builds: [{ promptTokens }],
      omitCommitPort: true,
    });
    const result = tickInput(harness);

    if (shouldContinue) {
      await expect(result).resolves.toMatchObject({ decision: { kind: 'final_answer' } });
      expect(harness.mainCall).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({
        code: 'llm.context.compaction_failed',
        reason: 'CONTEXT_COMPACTION_COMMIT_FAILED',
      });
      expect(harness.mainCall).not.toHaveBeenCalled();
    }
    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(harness.summarizationCallbacks.onSummarizationStart).not.toHaveBeenCalled();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'failed',
      generationAttempted: false,
      failureReason: 'CONTEXT_COMPACTION_COMMIT_FAILED',
    }));
  });

  it.each([
    ['force_final_answer', 'forced_final_answer'],
    ['force_tools', 'forced_tools'],
  ] as const)('%s 在原 Prompt 合法时抑制非必要压缩', async (phase, reason) => {
    const harness = createHarness();
    const executorLocal: ExecutorLocalState = {
      stepCount: 79,
      maxSteps: 80,
      remainingSteps: 1,
      phase,
      finalStepPolicy: phase === 'force_tools' ? 'force_tools' : 'final_answer',
      finalStepForcedTools: phase === 'force_tools' ? ['required_tool'] : [],
      lastStepsHintThreshold: 2,
    };

    await expect(tickInput(harness, {
      executorLocal,
      forceFinalAnswer: phase === 'force_final_answer',
      enableTools: phase === 'force_tools',
      availableTools: phase === 'force_tools' ? ['required_tool'] : [],
    })).resolves.toMatchObject({ decision: { kind: 'final_answer' } });
    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(harness.mainCall).toHaveBeenCalledOnce();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'skipped',
      suppressedReason: reason,
    }));
  });

  it('force_final_answer 硬超限时保留普通 reminder，并重放同一收尾请求', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 91 }],
      mainOutputLimitTokens: 30,
    });
    const executorLocal: ExecutorLocalState = {
      stepCount: 80,
      maxSteps: 80,
      remainingSteps: 0,
      phase: 'force_final_answer',
      finalStepPolicy: 'final_answer',
    };

    await tickInput(harness, { executorLocal, forceFinalAnswer: true });

    const compactionMessages = harness.compactionCall.mock.calls[0]![1];
    const mainMessages = harness.mainCall.mock.calls[0]![1];
    const mainOptions = harness.mainCall.mock.calls[0]![2];
    expect(JSON.stringify(compactionMessages).match(/<system-reminder>/gu)).toHaveLength(2);
    expect(JSON.stringify(compactionMessages)).toContain('你已进入步数预算收尾阶段');
    expect(JSON.stringify(compactionMessages)).toContain('COMPACTION CONTROL');
    expect(compactionMessages[compactionMessages.length - 1]).toEqual({
      role: 'user',
      content: '<system-reminder>\nCOMPACTION CONTROL [tokens:3]\n</system-reminder>',
    });
    expect(JSON.stringify(mainMessages).match(/<system-reminder>/gu)).toHaveLength(1);
    expect(JSON.stringify(mainMessages)).toContain('你已进入步数预算收尾阶段');
    expect(mainOptions.tool_choice).toBe('none');
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'completed',
      forcedPhaseRecovery: true,
    }));
    expect(executorLocal).toMatchObject({ stepCount: 80, phase: 'force_final_answer' });
  });

  it('force_tools 硬超限后保持 forced tools、tool_choice 与收尾 reminder', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 91 }],
      toolNames: ['required_tool'],
      mainOutputLimitTokens: 30,
    });
    const executorLocal: ExecutorLocalState = {
      stepCount: 79,
      maxSteps: 80,
      remainingSteps: 1,
      phase: 'force_tools',
      finalStepPolicy: 'force_tools',
      finalStepForcedTools: ['required_tool'],
      lastStepsHintThreshold: 2,
    };

    await tickInput(harness, {
      executorLocal,
      enableTools: true,
      availableTools: ['required_tool'],
    });

    const compactionOptions = harness.compactionCall.mock.calls[0]![2];
    const mainMessages = harness.mainCall.mock.calls[0]![1];
    const mainOptions = harness.mainCall.mock.calls[0]![2];
    expect(compactionOptions.tool_choice).toBe('none');
    expect(mainOptions.tool_choice).toEqual({ type: 'tool', name: 'required_tool' });
    expect(mainOptions.tools?.map(tool => tool.name)).toEqual(['required_tool']);
    expect(JSON.stringify(mainMessages)).toContain('required_tool');
    expect(executorLocal.finalStepForcedTools).toEqual(['required_tool']);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'completed',
      forcedPhaseRecovery: true,
    }));
  });

  it('压缩请求自身超预算时不发送请求并结算 typed failure', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 101 }],
    });

    await expect(tickInput(harness)).rejects.toMatchObject({
      code: 'llm.context.compaction_failed',
      reason: 'CONTEXT_COMPACTION_GENERATION_FAILED',
    });
    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'failed',
      generationAttempted: false,
    }));
  });

  it('压缩请求在调用前被 admission 拒绝时不消耗模型 attempt', async () => {
    const harness = createHarness({
      builds: [{ promptTokens: 101 }],
      mainOutputLimitTokens: 5,
    });

    const result = await tickInput(harness);

    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(result.executorLocalPatch?.contextCompaction).toBeUndefined();
    expect(harness.mainCall).toHaveBeenCalledOnce();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'failed',
      generationAttempted: false,
    }));
  });

  it.each([
    [85, 'soft', true, undefined],
    [91, 'hard', false, 30],
  ] as const)('ratio >= 1 在 %s tokens（%s）时不提交摘要', async (
    promptTokens,
    _kind,
    shouldContinue,
    mainOutputLimitTokens,
  ) => {
    const harness = createHarness({
      builds: [{ promptTokens }],
      ineffectiveRatio: 1.05,
      ...(mainOutputLimitTokens !== undefined ? { mainOutputLimitTokens } : {}),
    });
    const result = tickInput(harness);

    if (shouldContinue) {
      await expect(result).resolves.toMatchObject({ decision: { kind: 'final_answer' } });
      expect(harness.mainCall).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({
        code: 'llm.context.compaction_insufficient',
        reason: 'CONTEXT_COMPACTION_INEFFECTIVE',
      });
      expect(harness.mainCall).not.toHaveBeenCalled();
    }
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'insufficient',
      compressionRatio: 1.05,
    }));
  });

  it.each([
    [85, 'max', 12, 'different-plan', 'max_compactions_reached', undefined],
    [101, 'max-hard', 12, 'different-plan', 'max_compactions_reached', 'CONTEXT_COMPACTION_LIMIT_REACHED'],
    [85, 'duplicate', 1, 'plan-a', 'duplicate_plan_fingerprint', undefined],
    [101, 'duplicate-hard', 1, 'plan-a', 'duplicate_plan_fingerprint', 'CONTEXT_COMPACTION_DUPLICATE_PLAN'],
  ] as const)('%s tokens 下 %s 计划不会再次采样', async (
    promptTokens,
    caseName,
    attemptCount,
    lastFingerprint,
    suppressedReason,
    hardFailureReason,
  ) => {
    const hard = promptTokens > 100;
    const harness = createHarness({
      builds: [{
        promptTokens,
        fingerprint: caseName.startsWith('duplicate') ? 'plan-a' : 'plan-b',
      }],
    });
    const result = tickInput(harness, {
      executorLocal: {
        stepCount: 20,
        phase: 'running',
        contextCompaction: {
          attemptCount,
          committedCount: caseName.startsWith('duplicate') ? 1 : 0,
          lastCommittedFingerprint: lastFingerprint,
        },
      },
    });

    if (hard) {
      await expect(result).rejects.toMatchObject({
        code: 'llm.context.compaction_insufficient',
        reason: hardFailureReason,
      });
      expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
        outcome: 'insufficient',
      }));
    } else {
      await expect(result).resolves.toMatchObject({ decision: { kind: 'final_answer' } });
      expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
        outcome: 'skipped',
        suppressedReason,
      }));
    }
    expect(harness.compactionCall).not.toHaveBeenCalled();
  });

  it('压缩中 abort 不提交摘要，也不进入主模型调用', async () => {
    const abortController = new AbortController();
    const harness = createHarness({ abortController });

    await expect(tickInput(harness, { signal: abortController.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'aborted',
    }));
    expect(harness.summarizationCallbacks.onSummarizationError).toHaveBeenCalledOnce();
  });

  it('压缩成功重建后 abort 必须在 durable commit 前终止', async () => {
    const abortController = new AbortController();
    const harness = createHarness({ abortController, abortAfterRebuild: true });

    await expect(tickInput(harness, { signal: abortController.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(harness.compactionCall).toHaveBeenCalledOnce();
    expect(harness.runtimeEventCommitPort).not.toHaveBeenCalled();
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(harness.order).toEqual(['start', 'compaction-call', 'error']);
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'aborted',
      compactionIndex: 1,
    }));
    expect(harness.summarizationCallbacks.onSummarizationEnd).not.toHaveBeenCalled();
    expect(harness.summarizationCallbacks.onSummarizationError).toHaveBeenCalledOnce();
  });

  it('Provider 直接返回 AbortError 时，即使外层 signal 未标记也必须终止', async () => {
    const harness = createHarness({
      compactionFailure: new DOMException('Provider aborted', 'AbortError'),
    });

    await expect(tickInput(harness)).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.publishedSummaries).toHaveLength(0);
    expect(harness.mainCall).not.toHaveBeenCalled();
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      outcome: 'aborted',
    }));
  });

  it('多次触发继承上一份摘要，summary_seq 单调且每次只发布一次', async () => {
    const harness = createHarness({
      builds: [
        { promptTokens: 85, fingerprint: 'plan-1', summarySeq: 1 },
        { promptTokens: 85, fingerprint: 'plan-2', summarySeq: 2 },
      ],
    });

    const first = await tickInput(harness);
    const firstSummary = harness.publishedSummaries[0]!;
    const second = await tickInput(harness, {
      history: [firstSummary],
      executorLocal: {
        stepCount: 35,
        contextCompaction: first.executorLocalPatch?.contextCompaction ?? {
          attemptCount: 0,
          committedCount: 0,
        },
      },
    });

    expect(second.executorLocalPatch?.contextCompaction).toEqual({
      attemptCount: 2,
      committedCount: 2,
      lastCommittedFingerprint: 'plan-2',
    });
    expect(harness.publishedSummaries.map(summary => summary.summary_seq)).toEqual([1, 2]);
    expect(new Set(harness.publishedSummaries.map(summary => summary.id)).size).toBe(2);
    expect(harness.publishedSummaries).toHaveLength(2);
    expect(harness.compactionCall).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(harness.compactionCall.mock.calls[1]![1])).toContain(
      firstSummary.content,
    );
    expect(harness.publishedSummaries[1]).toMatchObject({
      included_old_summary: true,
      replaced_message_ids: expect.arrayContaining([firstSummary.id]),
    });
  });

  it('compaction 不重置 Agent 步数预算', async () => {
    const harness = createHarness();
    const executorLocal: ExecutorLocalState = {
      stepCount: 79,
      maxSteps: 80,
      remainingSteps: 1,
      phase: 'running',
    };

    const result = await tickInput(harness, { executorLocal });

    expect(executorLocal).toEqual({
      stepCount: 79,
      maxSteps: 80,
      remainingSteps: 1,
      phase: 'running',
    });
    expect(result.executorLocalPatch).toEqual({
      contextCompaction: {
        attemptCount: 1,
        committedCount: 1,
        lastCommittedFingerprint: 'plan-1',
      },
    });
    expect(result.executorLocalPatch).not.toHaveProperty('stepCount');
    expect(result.executorLocalPatch).not.toHaveProperty('maxSteps');
  });

  it('同一个 run 的压缩与主调用都复用已锁定模型', async () => {
    const harness = createHarness({ builds: [{ promptTokens: 85 }] });

    await tickInput(harness, {
      executorLocal: {
        stepCount: 4,
        phase: 'running',
        runLockedModelId: 'locked-model',
      },
    });

    expect(harness.build).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'locked-model',
    }));
    expect(harness.applyCompaction).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'locked-model',
    }));
    expect(harness.compactionCall.mock.calls[0]?.[0]).toBe('locked-model');
    expect(harness.compactionCall.mock.calls[0]?.[2]).toMatchObject({
      allow_model_fallback: false,
    });
    expect(harness.mainCall.mock.calls[0]?.[0]).toBe('locked-model');
    expect(contextCompactionTelemetry(harness)).toContainEqual(expect.objectContaining({
      modelId: 'locked-model',
      outcome: 'completed',
    }));
  });

  it('摘要 commit 后主调用失败，durable 摘要仍供下一次 rebuild 复用且不重复发布', async () => {
    const harness = createHarness({
      builds: [
        { promptTokens: 85, fingerprint: 'plan-1', summarySeq: 1 },
        { promptTokens: 79, candidate: false },
      ],
      mainOutcomes: [new Error('primary failed'), 'resumed'],
    });

    await expect(tickInput(harness)).rejects.toThrow('primary failed');
    expect(harness.publishedSummaries).toHaveLength(1);
    expect(harness.runtimeEventCommitPort).toHaveBeenCalledOnce();
    const durableSummary = harness.publishedSummaries[0]!;

    await expect(tickInput(harness, { history: [durableSummary] })).resolves.toMatchObject({
      decision: { kind: 'final_answer', answer: 'resumed' },
    });
    expect(harness.build.mock.calls[1]![0].history).toEqual([durableSummary]);
    expect(harness.compactionCall).toHaveBeenCalledOnce();
    expect(harness.publishedSummaries).toEqual([durableSummary]);
  });
});
