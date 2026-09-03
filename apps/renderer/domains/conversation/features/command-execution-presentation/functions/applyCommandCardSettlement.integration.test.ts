import { describe, expect, it } from 'vitest';
import {
  CommandCardExecutionSettlementV1Schema,
  CommandProcessHandleSchema,
} from '@app/schemas/commands';
import type { ShellCommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';
import { applyCommandCardSettlement } from './applyCommandCardSettlement';

describe('command card durable settlement overlay', () => {
  it('只覆盖同 conversation 已筛选 handle 的终态和时间，保留命令、权限与输出', () => {
    const source: ShellCommandExecutionPresentationData = {
      kind: 'command_execution',
      source: 'shell',
      state: 'running',
      command: 'sleep 60',
      interactive: false,
      processHandle: CommandProcessHandleSchema.parse(
        'command_process_00000000-0000-4000-8000-000000000003',
      ),
      observation: 'original output',
      executionFacts: {
        protocol_version: 1,
        kind: 'command_execution_presentation_facts',
        timing: { status: 'started', started_at_ms: 100 },
        permission: {
          base_level: 'standard',
          effective_level: 'standard',
          source: 'global_setting',
          internal_data_access: 'denied',
        },
        audit_status: 'incomplete',
      },
      incomplete: false,
      incompleteReasons: [],
    };
    const settlement = CommandCardExecutionSettlementV1Schema.parse({
      protocol_version: 1,
      kind: 'command_card_execution_settlement',
      conversation_id: 'conversation-overlay',
      process_handle: source.processHandle,
      origin_tool_call_id: 'call-overlay',
      started_at_ms: 100,
      settled_at_ms: 200,
      audit_status: 'complete',
      terminal: {
        outcome: 'terminated',
        reason: 'cancelled',
        exitCode: null,
        signal: 'SIGTERM',
      },
    });
    expect(applyCommandCardSettlement(source, settlement)).toMatchObject({
      state: 'completed',
      command: 'sleep 60',
      observation: 'original output',
      terminal: { outcome: 'terminated', reason: 'cancelled' },
      executionFacts: {
        timing: { started_at_ms: 100, settled_at_ms: 200 },
        permission: { source: 'global_setting' },
        audit_status: 'incomplete',
      },
    });

    const durableAuditFailure = CommandCardExecutionSettlementV1Schema.parse({
      ...settlement,
      audit_status: 'incomplete',
    });
    const executionFacts = source.executionFacts;
    if (!executionFacts) throw new Error('test source requires execution facts');
    expect(applyCommandCardSettlement({
      ...source,
      executionFacts: {
        ...executionFacts,
        audit_status: 'complete',
      },
    }, durableAuditFailure).executionFacts?.audit_status).toBe('incomplete');
  });

  it('可用 origin_tool_call_id 为历史 loading 卡片关联已有 settlement', () => {
    const source: ShellCommandExecutionPresentationData = {
      kind: 'command_execution',
      source: 'shell',
      state: 'starting',
      toolCallId: 'call-history-loading',
      command: 'linnya-slides render --presentation deck-1',
      interactive: false,
      observation: '',
      incomplete: false,
      incompleteReasons: [],
    };
    const settlement = CommandCardExecutionSettlementV1Schema.parse({
      protocol_version: 1,
      kind: 'command_card_execution_settlement',
      conversation_id: 'conversation-overlay',
      process_handle: 'command_process_00000000-0000-4000-8000-000000000004',
      origin_tool_call_id: 'call-history-loading',
      started_at_ms: 100,
      settled_at_ms: 200,
      audit_status: 'complete',
      terminal: {
        outcome: 'terminated',
        reason: 'owner_ended',
        exitCode: null,
        signal: 'SIGTERM',
      },
    });

    expect(applyCommandCardSettlement(source, settlement)).toMatchObject({
      state: 'completed',
      terminal: { outcome: 'terminated', reason: 'owner_ended' },
    });
  });
});
