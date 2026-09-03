import { describe, expect, it } from 'vitest';

import {
  ShellToolResultDataSchema,
  ShellToolRuntimeResultSchema,
} from './commandToolDisplay';
import { CommandExecutionPresentationFactsV1Schema } from './commandPresentationFacts';

const DISPLAY = {
  mode: 'pipe',
  coverage: 'complete',
  outputPhase: 'open',
  textProjection: 'available',
} as const;

describe('command presentation facts contract', () => {
  it('拒绝结束早于真实启动的时间事实', () => {
    expect(CommandExecutionPresentationFactsV1Schema.safeParse({
      protocol_version: 1,
      kind: 'command_execution_presentation_facts',
      timing: {
        status: 'started',
        started_at_ms: 200,
        settled_at_ms: 199,
      },
    }).success).toBe(false);
  });

  it('旧 durable tool row 可以缺少展示事实，新 runtime 结果不可以', () => {
    const oldData = {
      status: 'running',
      presentationText: 'legacy output',
      processHandle: 'command_process_123e4567-e89b-42d3-a456-426614174000',
      nextCursor: 0,
      display: DISPLAY,
    };
    expect(ShellToolResultDataSchema.safeParse(oldData).success).toBe(true);
    expect(ShellToolRuntimeResultSchema.safeParse({
      ...oldData,
      observation: 'legacy output',
    }).success).toBe(false);
  });

  it('确定未启动只记录结束时间，不伪造开始时间', () => {
    expect(CommandExecutionPresentationFactsV1Schema.parse({
      protocol_version: 1,
      kind: 'command_execution_presentation_facts',
      timing: { status: 'not_started', settled_at_ms: 300 },
    })).toEqual({
      protocol_version: 1,
      kind: 'command_execution_presentation_facts',
      timing: { status: 'not_started', settled_at_ms: 300 },
    });
  });

  it('旧历史可缺少审计状态，新事实可明确标记审计不完整', () => {
    const legacy = CommandExecutionPresentationFactsV1Schema.parse({
      protocol_version: 1,
      kind: 'command_execution_presentation_facts',
      timing: { status: 'not_started', settled_at_ms: 300 },
    });
    expect(legacy.audit_status).toBeUndefined();
    expect(CommandExecutionPresentationFactsV1Schema.parse({
      ...legacy,
      audit_status: 'incomplete',
    }).audit_status).toBe('incomplete');
  });
});
