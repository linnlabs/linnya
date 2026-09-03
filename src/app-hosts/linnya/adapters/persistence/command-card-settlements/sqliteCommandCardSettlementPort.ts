import type Database from 'better-sqlite3';
import {
  CommandCardExecutionSettlementV1Schema,
  CommandExecutionTerminalV1Schema,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionTerminalV1,
  type CommandCardExecutionSettlementV1,
  type ShellToolTerminalSummary,
} from '@app/schemas/commands';
import type {
  CommandCardSettlementPort,
  CommandCardSettlementAuditMarkResult,
  CommandCardSettlementRecordInput,
  CommandCardSettlementRecordResult,
} from '../../../../../domains/commands';

interface SettlementRow {
  conversation_id: string;
  process_handle: string;
  command_execution_id: string;
  agent_run_id: string;
  owner_generation_id: string;
  started_at_ms: number;
  settled_at_ms: number;
  audit_status: 'complete' | 'incomplete';
  terminal_json: string;
}

function projectPublicSettlement(row: SettlementRow): CommandCardExecutionSettlementV1 {
  const terminal = CommandExecutionTerminalV1Schema.parse(JSON.parse(row.terminal_json));
  return CommandCardExecutionSettlementV1Schema.parse({
    protocol_version: 1,
    kind: 'command_card_execution_settlement',
    conversation_id: row.conversation_id,
    process_handle: row.process_handle,
    origin_tool_call_id: terminal.identity.origin_tool_call_id,
    started_at_ms: row.started_at_ms,
    settled_at_ms: row.settled_at_ms,
    audit_status: row.audit_status,
    terminal: projectTerminalSummary(terminal),
  });
}

function projectTerminalSummary(terminal: CommandExecutionTerminalV1): ShellToolTerminalSummary {
  if (terminal.outcome === 'runtime_failure') {
    return { outcome: 'runtime_failure', code: terminal.failure.code };
  }
  const exit = terminal.process_exit.status === 'observed'
    ? { exitCode: terminal.process_exit.exit_code, signal: terminal.process_exit.signal }
    : { exitCode: null, signal: null };
  if (terminal.termination_cause === 'natural_exit') return { outcome: 'exited', ...exit };
  return {
    outcome: 'terminated',
    reason: terminal.termination_cause === 'user_cancelled'
      ? 'cancelled'
      : terminal.termination_cause === 'hard_timeout'
        ? 'timed_out'
        : 'owner_ended',
    ...exit,
  };
}

function hasSameBinding(row: SettlementRow, binding: CommandExecutionOwnerBindingV1): boolean {
  return row.conversation_id === binding.identity.conversation_id
    && row.command_execution_id === binding.identity.command_execution_id
    && row.agent_run_id === binding.identity.agent_run_id
    && row.owner_generation_id === binding.identity.owner_generation_id;
}

/** 同 binding 的首个 owner terminal 是唯一事实；重复通知幂等，不同 binding 不可覆盖。 */
export class SqliteCommandCardSettlementPort implements CommandCardSettlementPort {
  constructor(private readonly db: Database.Database) {}

  async recordTerminal(input: CommandCardSettlementRecordInput): Promise<CommandCardSettlementRecordResult> {
    const identity = input.binding.identity;
    const existing = this.readRowByHandle(input.binding.process_handle);
    if (existing) {
      if (!hasSameBinding(existing, input.binding)) return { status: 'conflict' };
      if (input.auditStatus === 'incomplete' && existing.audit_status === 'complete') {
        this.db.prepare(`
          UPDATE conversation_command_card_settlements
          SET audit_status = 'incomplete'
          WHERE conversation_id = ? AND process_handle = ?
        `).run(identity.conversation_id, input.binding.process_handle);
      }
      const durable = this.readRow(identity.conversation_id, input.binding.process_handle);
      if (!durable) throw new Error('command card settlement update lost its durable row');
      return { status: 'already_recorded', settlement: projectPublicSettlement(durable) };
    }
    this.db.prepare(`
      INSERT INTO conversation_command_card_settlements (
        conversation_id, process_handle, command_execution_id, agent_run_id,
        owner_generation_id, started_at_ms, settled_at_ms, audit_status, terminal_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.conversation_id,
      input.binding.process_handle,
      identity.command_execution_id,
      identity.agent_run_id,
      identity.owner_generation_id,
      input.startedAtMs,
      input.terminal.settled_at_ms,
      input.auditStatus,
      JSON.stringify(input.terminal),
    );
    const recorded = this.readRow(identity.conversation_id, input.binding.process_handle);
    if (!recorded) throw new Error('command card settlement insert did not publish a row');
    return { status: 'recorded', settlement: projectPublicSettlement(recorded) };
  }

  async markAuditIncomplete(
    binding: CommandExecutionOwnerBindingV1,
  ): Promise<CommandCardSettlementAuditMarkResult> {
    const existing = this.readRowByHandle(binding.process_handle);
    if (!existing) return { status: 'terminal_not_recorded' };
    if (!hasSameBinding(existing, binding)) return { status: 'conflict' };

    this.db.prepare(`
      UPDATE conversation_command_card_settlements
      SET audit_status = 'incomplete'
      WHERE conversation_id = ? AND process_handle = ?
    `).run(binding.identity.conversation_id, binding.process_handle);
    const updated = this.readRow(binding.identity.conversation_id, binding.process_handle);
    if (!updated) throw new Error('command card audit status update lost its durable row');
    return { status: 'updated', settlement: projectPublicSettlement(updated) };
  }

  async listForConversation(conversationId: string): Promise<readonly CommandCardExecutionSettlementV1[]> {
    return this.db.prepare<unknown[], SettlementRow>(`
      SELECT * FROM conversation_command_card_settlements
      WHERE conversation_id = ? ORDER BY settled_at_ms ASC, process_handle ASC
    `).all(conversationId).map(projectPublicSettlement);
  }

  async deleteForConversation(conversationId: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM conversation_command_card_settlements WHERE conversation_id = ?',
    ).run(conversationId);
  }

  private readRow(conversationId: string, processHandle: string): SettlementRow | undefined {
    return this.db.prepare<unknown[], SettlementRow>(`
      SELECT * FROM conversation_command_card_settlements
      WHERE conversation_id = ? AND process_handle = ? LIMIT 1
    `).get(conversationId, processHandle);
  }

  private readRowByHandle(processHandle: string): SettlementRow | undefined {
    return this.db.prepare<unknown[], SettlementRow>(`
      SELECT * FROM conversation_command_card_settlements
      WHERE process_handle = ? LIMIT 1
    `).get(processHandle);
  }
}
