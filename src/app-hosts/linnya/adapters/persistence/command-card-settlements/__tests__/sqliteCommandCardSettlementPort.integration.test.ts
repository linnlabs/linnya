import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CommandExecutionTerminalV1Schema, parseCommandExecutionOwnerBinding } from '@app/schemas/commands';
import { COMMAND_CARD_SETTLEMENT_SCHEMAS } from '../commandCardSettlements.schema';
import { SqliteCommandCardSettlementPort } from '../sqliteCommandCardSettlementPort';

function binding(execution = '00000000-0000-4000-8000-000000000001') {
  return parseCommandExecutionOwnerBinding({
    protocol_version: 1,
    kind: 'command_execution_owner_binding',
    identity: {
      command_execution_id: `command_execution_${execution}`,
      conversation_id: 'conversation-settlement-test',
      agent_run_id: 'agent-run-settlement-test',
      origin_tool_call_id: 'origin-tool-settlement-test',
      owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000002',
      created_at_ms: 50,
    },
    process_handle: 'command_process_00000000-0000-4000-8000-000000000003',
    mode: 'pipe',
  });
}

function terminal(ownerBinding = binding()) {
  return CommandExecutionTerminalV1Schema.parse({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: ownerBinding.identity,
    settled_at_ms: 200,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
}

describe('SQLite command card settlement sidecar', () => {
  it('只允许同 binding 幂等写入，并由显式对话删除清空', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO conversations VALUES (?)').run('conversation-settlement-test');
    for (const ddl of COMMAND_CARD_SETTLEMENT_SCHEMAS) db.exec(ddl);
    const port = new SqliteCommandCardSettlementPort(db);
    const original = binding();
    const record = {
      binding: original,
      startedAtMs: 100,
      auditStatus: 'complete' as const,
      terminal: terminal(original),
    };

    await expect(port.markAuditIncomplete(original)).resolves.toEqual({
      status: 'terminal_not_recorded',
    });

    await expect(port.recordTerminal(record)).resolves.toMatchObject({
      status: 'recorded',
      settlement: { origin_tool_call_id: original.identity.origin_tool_call_id },
    });
    await expect(port.recordTerminal(record)).resolves.toMatchObject({ status: 'already_recorded' });
    const conflicting = binding('00000000-0000-4000-8000-000000000004');
    await expect(port.recordTerminal({
      binding: conflicting,
      startedAtMs: 100,
      auditStatus: 'complete',
      terminal: terminal(conflicting),
    })).resolves.toEqual({ status: 'conflict' });
    await expect(port.markAuditIncomplete(conflicting)).resolves.toEqual({ status: 'conflict' });
    await expect(port.markAuditIncomplete(original)).resolves.toMatchObject({
      status: 'updated',
      settlement: { audit_status: 'incomplete' },
    });
    // 审计不完整是不可逆事实；迟到的完整终态重放不能把它降回 complete。
    await expect(port.recordTerminal(record)).resolves.toMatchObject({
      status: 'already_recorded',
      settlement: { audit_status: 'incomplete' },
    });
    await expect(port.listForConversation('conversation-settlement-test')).resolves.toMatchObject([
      {
        process_handle: original.process_handle,
        origin_tool_call_id: original.identity.origin_tool_call_id,
        audit_status: 'incomplete',
        terminal: { outcome: 'exited', exitCode: 0 },
      },
    ]);
    await port.deleteForConversation('conversation-settlement-test');
    await expect(port.listForConversation('conversation-settlement-test')).resolves.toEqual([]);
    db.close();
  });
});
