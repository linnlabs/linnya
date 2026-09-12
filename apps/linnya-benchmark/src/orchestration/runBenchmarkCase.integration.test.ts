import {
  ConversationControlAuditResponseSchema,
  ConversationControlMessagesResponseSchema,
  ConversationControlProgressFrameSchema,
  ConversationControlRespondResponseSchema,
  ConversationControlStopResponseSchema,
} from '@app/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedBenchmarkCase } from '../definitions/benchmarkCase';
import {
  BenchmarkConversationCliError,
  type BenchmarkConversationCliPort,
} from '../definitions/conversationCliPort';
import { slidesConsultingReferenceCase } from '../cases/slidesConsultingReference';
import { runBenchmarkCase } from './runBenchmarkCase';

function benchmark(): ResolvedBenchmarkCase {
  return {
    definition: { ...slidesConsultingReferenceCase, timeoutMs: 1000 },
    prompt: 'resolved prompt',
    inputs: { reference_image: '/tmp/reference.png' },
  };
}

function frame(sequence: number, status: 'running' | 'awaiting_user' | 'completed' | 'paused', settled = true) {
  return ConversationControlProgressFrameSchema.parse({
    schema_version: 1,
    frame: 'status',
    sequence,
    observed_at: 110 + sequence,
    snapshot: {
      conversation_id: 'conversation-1',
      run_id: 'run-1',
      turn_id: 'turn-1',
      execution_id: `execution-${sequence + 1}`,
      agent_id: 'slides_agent',
      status,
      started_at: 100,
      updated_at: 110 + sequence,
      terminal_at: status === 'completed' ? 110 + sequence : undefined,
      pause: status === 'paused' ? { settled, reason: 'execution_interrupted' } : undefined,
      pending_interaction: status === 'awaiting_user' ? {
        interaction_id: 'interaction-1',
        tool_name: 'ppt_plan',
      } : undefined,
      result_available: status === 'completed',
    },
  });
}

function commonCli(overrides: Partial<BenchmarkConversationCliPort>): BenchmarkConversationCliPort {
  return {
    async send() {
      return {
        conversation_id: 'conversation-1',
        user_message_id: 'message-1',
        turn_id: 'turn-1',
        run_id: 'run-1',
        execution_id: 'execution-1',
        agent_id: 'slides_agent',
        accepted_at: 100,
      };
    },
    async watchStatus() { return { frames: [frame(0, 'completed')], timedOut: false }; },
    async approve() {
      return ConversationControlRespondResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'respond',
        receipt: {
          conversation_id: 'conversation-1',
          interaction_id: 'interaction-1',
          turn_id: 'turn-1',
          run_id: 'run-1',
          execution_id: 'execution-2',
          agent_id: 'slides_agent',
          accepted_at: 120,
        },
      });
    },
    async stop() {
      return ConversationControlStopResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'stop',
        conversation_id: 'conversation-1',
        run_id: 'run-1',
        requested_reason: 'Benchmark timeout',
        outcome: 'cancelled',
        completed_at: 200,
      });
    },
    async result() {
      return {
        outcome: 'completed',
        completedAt: 150,
        resultStatus: 'unavailable' as const,
        reason: 'final_answer_missing',
      };
    },
    async messages() {
      return ConversationControlMessagesResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: 'conversation-1',
        status: 'preparing',
      });
    },
    async audit() {
      return ConversationControlAuditResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'audit',
        conversation_id: 'conversation-1',
        requested_run_id: 'run-1',
        generated_at: 160,
        completeness: {
          run_registry: 'complete',
          event_store: 'complete',
          telemetry: 'best_effort',
          telemetry_retention_days: 7,
        },
        source_window: { telemetry_events: 0, event_facts: 0 },
        runs: [],
        llm: {
          calls: 0,
          duration_ms: 0,
          provider_actual_calls: 0,
          estimate_calls: 0,
          missing_usage_calls: 0,
          actual_tokens: { input_tokens: 0, output_tokens: 0 },
          by_model: [],
        },
        tools: { calls: 0, failed_calls: 0, duration_ms: 0, by_tool: [] },
        workspace_documents: { observations: 0, observations_with_errors: 0,
          observations_with_warnings: 0, visible: { error: 0, warning: 0, info: 0 },
          truncated_count: 0, by_observation: [] },
        tool_pairing: {
          complete: true,
          paired: 0,
          decision_missing: 0,
          terminal_missing: 0,
          duplicate_terminal: 0,
          name_mismatches: 0,
          records: [],
        },
        commands: {
          executions: 0,
          terminal_observations: 0,
          nonzero_exit_executions: 0,
          runtime_failure_executions: 0,
          by_execution: [],
        },
        context_compaction: {
          observations: 0,
          attempts: 0,
          completed: 0,
          failed: 0,
          insufficient: 0,
          aborted: 0,
          skipped: 0,
          duration_ms: 0,
          provider_actual_calls: 0,
          estimate_calls: 0,
          missing_usage_calls: 0,
          actual_tokens: { input_tokens: 0, output_tokens: 0 },
          by_run: [],
        },
        run_lifecycle: { by_run: [] },
      });
    },
    ...overrides,
  };
}

describe('run Benchmark case', () => {
  it('settled paused 只结束一次观察，不请求完成结果、批准或取消，保留审计事实', async () => {
    const watchStatus = vi.fn(commonCli({}).watchStatus)
      .mockResolvedValueOnce({ frames: [frame(0, 'paused', false), frame(1, 'paused')], timedOut: false })
      .mockRejectedValue(new Error('must not rewatch a settled pause'));
    const stop = vi.fn(commonCli({}).stop);
    const approve = vi.fn(commonCli({}).approve);
    const result = vi.fn(commonCli({}).result);
    const facts = await runBenchmarkCase({ benchmark: benchmark(), projectId: 'project-1' }, {
      cli: commonCli({ watchStatus, stop, approve, result }),
      now: () => 100,
    });
    expect(facts.outcome).toBe('requires_recovery');
    expect(watchStatus).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(result).not.toHaveBeenCalled();
    expect(facts.statusFrames).toHaveLength(2);
    expect(facts.statusFrames.at(-1)?.snapshot?.pause).toEqual({ settled: true, reason: 'execution_interrupted' });
    expect(facts.messages?.status).toBe('preparing');
    expect(facts.audit.status).toBe('available');
    expect(facts.errors).toEqual([]);
  });

  it('尚未 settled 的暂停仍等待正式收口，不提前报告需恢复', async () => {
    const watchStatus = vi.fn(commonCli({}).watchStatus)
      .mockResolvedValueOnce({ frames: [frame(0, 'paused', false)], timedOut: false })
      .mockResolvedValueOnce({ frames: [frame(1, 'completed')], timedOut: false });
    const facts = await runBenchmarkCase({ benchmark: benchmark(), projectId: 'project-1' }, {
      cli: commonCli({ watchStatus }),
      now: () => 100,
    });
    expect(facts.outcome).toBe('completed');
    expect(watchStatus).toHaveBeenCalledTimes(2);
  });

  it('真实流程遇到 wait_user 时按 case 批准，再收集终态、消息和审计', async () => {
    let watches = 0;
    const approve = vi.fn(commonCli({}).approve);
    const cli = commonCli({
      async watchStatus() {
        watches += 1;
        return {
          frames: [watches === 1 ? frame(0, 'awaiting_user') : frame(0, 'completed')],
          timedOut: false,
        };
      },
      approve,
    });
    const facts = await runBenchmarkCase({
      benchmark: benchmark(),
      projectId: 'project-1',
    }, { cli, now: () => 100 });

    expect(facts.outcome).toBe('completed');
    expect(facts.receipt).toMatchObject({ conversation_id: 'conversation-1', run_id: 'run-1' });
    expect(facts.interactionResponses).toHaveLength(1);
    expect(approve).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      interactionId: 'interaction-1',
      projectId: 'project-1',
    });
    expect(facts.audit.status).toBe('available');
    expect(facts.errors).toEqual([]);
  });

  it('Runner 超时时终止 exact run，并把旧 App 不支持 audit 记为 unavailable', async () => {
    const stop = vi.fn(commonCli({}).stop);
    const cli = commonCli({
      async watchStatus() {
        return { frames: [frame(0, 'running')], timedOut: true };
      },
      stop,
      async audit() {
        throw new BenchmarkConversationCliError(
          'capability_unavailable',
          'audit unavailable',
          false,
          'audit',
        );
      },
    });
    const facts = await runBenchmarkCase({
      benchmark: benchmark(),
      projectId: 'project-1',
    }, { cli, now: () => 100 });

    expect(facts.outcome).toBe('cancelled');
    expect(stop).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      runId: 'run-1',
      reason: 'Benchmark timeout',
    });
    expect(facts.audit).toMatchObject({ status: 'unavailable', code: 'capability_unavailable' });
    expect(facts.errors).toEqual([]);
  });
});
