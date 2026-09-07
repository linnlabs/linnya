import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ConversationControlAuditResponseSchema,
  ConversationControlProgressFrameSchema,
  ConversationControlStopResponseSchema,
} from '@app/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedBenchmarkCase } from '../definitions/benchmarkCase';
import type { BenchmarkRunFacts } from '../definitions/benchmarkRun';
import { slidesConsultingReferenceCase } from '../cases/slidesConsultingReference';
import { createFileBenchmarkReportWriter } from './fileBenchmarkReportWriter';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

function benchmark(): ResolvedBenchmarkCase {
  return {
    definition: slidesConsultingReferenceCase,
    prompt: 'resolved prompt',
    inputs: { reference_image: '/tmp/reference.png' },
  };
}

function facts(): BenchmarkRunFacts {
  return {
    schemaVersion: 1,
    benchmark: {
      id: slidesConsultingReferenceCase.id,
      revision: slidesConsultingReferenceCase.revision,
      name: slidesConsultingReferenceCase.name,
      tags: slidesConsultingReferenceCase.tags,
      artifactExpectation: slidesConsultingReferenceCase.artifactExpectation,
    },
    configuration: {
      projectId: 'project-1',
      agentId: 'slides_agent',
      reasoningEffort: 'high',
      timeoutMs: 1000,
      inputs: { reference_image: '/tmp/reference.png' },
    },
    startedAt: Date.parse('2026-08-24T10:00:00.000Z'),
    finishedAt: Date.parse('2026-08-24T10:00:05.000Z'),
    durationMs: 5000,
    outcome: 'completed',
    statusFrames: [],
    interactionResponses: [],
    messages: { status: 'ready', count: 2, byType: { user: 1, final_answer: 1 } },
    audit: {
      status: 'unavailable',
      code: 'capability_unavailable',
      message: 'old App',
    },
    errors: [],
  };
}

describe('file Benchmark report writer', () => {
  it('同时写入机器事实与未自动评分的人工审阅报告', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-benchmark-report-'));
    temporaryRoots.push(root);
    const location = await createFileBenchmarkReportWriter(root).write({
      benchmark: benchmark(),
      facts: facts(),
    });
    const savedFacts = JSON.parse(await readFile(location.factsFile, 'utf8'));
    const report = await readFile(location.reportFile, 'utf8');

    expect(savedFacts).toMatchObject({ outcome: 'completed', audit: { status: 'unavailable' } });
    expect(report).toContain('自动部分不生成质量总分');
    expect(report).toContain('## 3. 阶段耗时与状态轨迹');
    expect(report).toContain('## 6. LLM、Token 与缓存');
    expect(report).toContain('### 产物硬事实');
    expect(report).toContain('### 逐页复核');
    expect(report).toContain('| 维度 | 检查要点 | 评分（1–5） | 问题与证据 |');
    expect(report).toContain('是否通过：待审阅');
  });

  it('超时报告连续编号多段 watch，并展示终止、父子 Run 与工具耗时', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-benchmark-timeout-report-'));
    temporaryRoots.push(root);
    const base = facts();
    const observedBase = base.startedAt;
    const statusFrame = (observedAt: number, status: 'running' | 'awaiting_user') =>
      ConversationControlProgressFrameSchema.parse({
        schema_version: 1,
        frame: 'status',
        sequence: 0,
        observed_at: observedAt,
        snapshot: {
          conversation_id: 'conversation-1',
          run_id: 'run-1',
          turn_id: 'turn-1',
          execution_id: `execution-${observedAt}`,
          agent_id: 'slides_agent',
          status,
          current_node: status === 'running' ? 'llm' : 'wait_user',
          started_at: 100,
          updated_at: observedAt,
          result_available: false,
        },
      });
    const timeoutFacts: BenchmarkRunFacts = {
      ...base,
      outcome: 'cancelled',
      statusFrames: [
        statusFrame(observedBase + 110, 'awaiting_user'),
        statusFrame(observedBase + 120, 'running'),
      ],
      stop: ConversationControlStopResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'stop',
        conversation_id: 'conversation-1',
        run_id: 'run-1',
        requested_reason: 'Benchmark timeout',
        outcome: 'cancelled',
        completed_at: observedBase + 200,
      }),
      audit: {
        status: 'available',
        response: ConversationControlAuditResponseSchema.parse({
          schema_version: 1,
          ok: true,
          command: 'audit',
          conversation_id: 'conversation-1',
          requested_run_id: 'run-1',
          generated_at: observedBase + 200,
          completeness: {
            run_registry: 'complete',
            event_store: 'complete',
            telemetry: 'best_effort',
            telemetry_retention_days: 7,
          },
          source_window: { telemetry_events: 5, event_facts: 4 },
          runs: [
            {
              run_id: 'child-1',
              parent_run_id: 'run-1',
              agent_id: 'research_agent',
              status: 'completed',
              started_at: observedBase + 110,
              updated_at: observedBase + 160,
              iterations_used: 40,
            },
            {
              run_id: 'run-1',
              agent_id: 'slides_agent',
              status: 'cancelled',
              started_at: observedBase + 100,
              updated_at: observedBase + 200,
              iterations_used: 58,
            },
          ],
          llm: {
            calls: 1,
            duration_ms: 50,
            provider_actual_calls: 1,
            estimate_calls: 0,
            missing_usage_calls: 0,
            actual_tokens: {
              input_tokens: 100,
              output_tokens: 10,
              cache_read_tokens_reported: 50,
            },
            by_model: [],
          },
          tools: {
            calls: 3,
            failed_calls: 1,
            duration_ms: 100,
            by_tool: [
              {
                tool_name: 'subagent',
                calls: 1,
                failed_calls: 0,
                duration_ms: 75,
                error_codes: [],
              },
              {
                tool_name: 'write_file',
                calls: 1,
                failed_calls: 1,
                duration_ms: 5,
                error_codes: ['execution'],
              },
              {
                tool_name: 'shell',
                calls: 1,
                failed_calls: 0,
                duration_ms: 20,
                error_codes: [],
              },
            ],
          },
          tool_pairing: {
            complete: false,
            paired: 2,
            decision_missing: 0,
            terminal_missing: 1,
            duplicate_terminal: 0,
            name_mismatches: 0,
            records: [
              {
                run_id: 'run-1',
                tool_call_id: 'call-subagent',
                tool_name: 'subagent',
                pairing_status: 'paired',
                decision_count: 1,
                terminal_count: 1,
                terminal_status: 'success',
                name_consistent: true,
              },
              {
                run_id: 'run-1',
                tool_call_id: 'call-write',
                tool_name: 'write_file',
                pairing_status: 'paired',
                decision_count: 1,
                terminal_count: 1,
                terminal_status: 'error',
                name_consistent: true,
              },
              {
                run_id: 'run-1',
                tool_call_id: 'call-shell',
                tool_name: 'shell',
                pairing_status: 'terminal_missing',
                decision_count: 1,
                terminal_count: 0,
                name_consistent: true,
              },
            ],
          },
          commands: {
            executions: 1,
            terminal_observations: 1,
            nonzero_exit_executions: 1,
            runtime_failure_executions: 0,
            by_execution: [{
              run_id: 'run-1',
              tool_call_id: 'call-shell',
              command_execution_id: 'command-1',
              terminal_observations: 1,
              process_exit: {
                status: 'observed',
                exit_code: 70,
                signal: null,
              },
              emitted_at: observedBase + 145,
              outcome: 'execution_ended',
              termination_cause: 'natural_exit',
            }],
          },
          context_compaction: {
            observations: 2,
            attempts: 1,
            completed: 1,
            failed: 0,
            insufficient: 1,
            aborted: 0,
            skipped: 0,
            duration_ms: 900,
            compaction_input_tokens_reported: 60,
            summary_output_tokens_reported: 8,
            released_tokens_reported: 40,
            provider_actual_calls: 1,
            estimate_calls: 0,
            missing_usage_calls: 0,
            actual_tokens: {
              input_tokens: 60,
              output_tokens: 8,
              cache_read_tokens_reported: 50,
            },
            by_run: [{
              run_id: 'child-1',
              parent_run_id: 'run-1',
              observations: 2,
              attempts: 1,
              completed: 1,
              failed: 0,
              insufficient: 1,
              aborted: 0,
              skipped: 0,
              duration_ms: 900,
              max_compactions_per_run: 12,
              compaction_input_tokens_reported: 60,
              summary_output_tokens_reported: 8,
              released_tokens_reported: 40,
              provider_actual_calls: 1,
              estimate_calls: 0,
              missing_usage_calls: 0,
              actual_tokens: {
                input_tokens: 60,
                output_tokens: 8,
                cache_read_tokens_reported: 50,
              },
              events: [{
                emitted_at: observedBase + 150,
                model_id: 'gpt-5',
                compaction_index: 1,
                max_compactions_per_run: 12,
                generation_attempted: true,
                trigger_ratio: 0.8,
                target_ratio: 0.5,
                before_tokens: 100,
                input_budget_tokens: 120,
                compaction_input_tokens: 60,
                after_tokens: 60,
                replaced_message_count: 12,
                replaced_tool_group_count: 4,
                kept_tool_group_count: 2,
                summary_output_tokens: 8,
                compression_ratio: 0.133,
                usage: {
                  input_tokens: 60,
                  output_tokens: 8,
                  cache_read_tokens_reported: 50,
                  confidence: 'actual',
                },
                duration_ms: 900,
                outcome: 'completed',
                forced_phase_recovery: false,
              }, {
                emitted_at: observedBase + 155,
                model_id: 'gpt-5',
                compaction_index: 2,
                max_compactions_per_run: 12,
                generation_attempted: false,
                trigger_ratio: 0.8,
                target_ratio: 0.5,
                before_tokens: 121,
                input_budget_tokens: 120,
                replaced_message_count: 0,
                replaced_tool_group_count: 0,
                kept_tool_group_count: 2,
                duration_ms: 0,
                outcome: 'insufficient',
                forced_phase_recovery: false,
                error_code: 'llm.context.compaction_insufficient',
                failure_reason: 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
              }],
            }],
          },
          run_lifecycle: {
            by_run: [
              {
                run_id: 'child-1',
                parent_run_id: 'run-1',
                terminal_observations: 1,
                phase: 'completed',
                steps_used: 40,
                max_steps: 60,
                terminal_reason: 'completed',
                emitted_at: observedBase + 160,
              },
              {
                run_id: 'run-1',
                terminal_observations: 2,
                phase: 'cancelled',
                steps_used: 58,
                max_steps: 80,
                terminal_reason: 'cancelled',
                emitted_at: observedBase + 200,
              },
            ],
          },
        }),
      },
    };
    const location = await createFileBenchmarkReportWriter(root).write({
      benchmark: benchmark(),
      facts: timeoutFacts,
    });
    const report = await readFile(location.reportFile, 'utf8');

    expect(report).toContain('stop 原因：Benchmark timeout');
    expect(report).toContain('| 0 | 2026-08-24T10:00:00.110Z | awaiting_user | wait_user | — | — |  |');
    expect(report).toContain('| 1 | 2026-08-24T10:00:00.120Z | running | llm | — | — |  |');
    expect(report).toContain('| child-1 | run-1 | research_agent | completed | — | 40 | 40 / 60 | completed |');
    expect(report).toContain('## 7. 自动上下文压缩');
    expect(report).toContain('| child-1 | run-1 | 1 / 12 | 1 | 0 / 1 / 0 / 0 |');
    expect(report).toContain('| 1 / 12 | 是 | 80%→50% | 100 / 120 | 60 / 40.00% |');
    expect(report).toContain('| 2 / 12 | 否 | 80%→50% | 121 / 120 |');
    expect(report).toContain('8 / 0.133');
    expect(report).toContain('| subagent | 1 | 1 | 0 |');
    expect(report).toContain('### 调用配对完整度');
    expect(report).toContain('完整性：不完整；paired 2，decision missing 0，terminal missing 1');
    expect(report).toContain('| run-1 | root | call-shell | shell | terminal_missing | 1 / 0 | — | 是 |');
    expect(report).toContain('### Shell / Process 命令终态');
    expect(report).toContain('命令执行 1；durable 终态观测 1；非零退出 1；runtime failure 0');
    expect(report).toContain('| execution_ended | exit=70, signal=null | natural_exit |');
    expect(report).toContain('Usage 覆盖：actual 1 / estimate 0 / missing 0');
    expect(report).toContain('Provider actual 总输入 150（非缓存 100）');
    expect(report).toContain('Cache read 50；占 Provider 总输入 33.33%');
    expect(report).toContain('Provider actual 总输入 110（非缓存 60）');
    expect(report).toContain('占压缩 actual 总输入 45.45%');
    expect(report).not.toContain('83.33%');
  });
});
