import type Database from 'better-sqlite3';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { SQLiteRunRegistryStore } from '../run-registry';
import type { ToolResultReceiptPort } from '../../../application/run-resumption';

interface ReceiptRow {
  tool_name: string;
  result: string | null;
  atomic_owner: number;
}

/** 与领域 mutation 共用当前 SQLite 连接。不是按参数去重，key 是原 run + 原 tool call。 */
export class SqliteToolResultReceipts {
  constructor(private readonly db: Database.Database) {}

  read(runId: string, toolCallId: string, toolName: string): ReceiptRow | undefined {
    const row = this.db
      .prepare<
        [string, string],
        ReceiptRow
      >('SELECT tool_name, result, atomic_owner FROM agent_tool_results WHERE run_id = ? AND tool_call_id = ?')
      .get(runId, toolCallId);
    if (row && row.tool_name !== toolName)
      throw new graph.RunRecoveryBlockedError('Tool result identity mismatch');
    return row;
  }

  forExecution(runId: string, executionId: string): ToolResultReceiptPort {
    const runs = new SQLiteRunRegistryStore(this.db);
    const owned = (callId: string, toolName: string) => {
      runs.requireExecutionOwner(runId, executionId);
      const checkpoint = this.db
        .prepare<
          [string],
          { state_json: string }
        >('SELECT state_json FROM engine_checkpoints WHERE conversation_id = ?')
        .get(runId);
      const state = checkpoint && graph.parseEngineCheckpoint(JSON.parse(checkpoint.state_json));
      if (
        state?.local?.executingToolCallId !== callId ||
        !state.local.pendingToolCalls?.some(
          call => call.id === callId && call.function.name === toolName
        )
      ) {
        throw new graph.RunRecoveryBlockedError('Tool result has no committed execution intent');
      }
    };
    const save = (callId: string, toolName: string, result: string, atomic: boolean) => {
      owned(callId, toolName);
      const previous = this.read(runId, callId, toolName);
      if (previous?.result !== null && previous?.result !== undefined) {
        if (previous.result !== result)
          throw new graph.RunRecoveryBlockedError('Original tool result cannot be overwritten');
        return;
      }
      if (atomic && (!this.db.inTransaction || previous?.atomic_owner !== 1)) {
        throw new Error('Owner result must commit with its prepared mutation transaction');
      }
      this.db
        .prepare(
          `INSERT INTO agent_tool_results (run_id, tool_call_id, tool_name, result, atomic_owner)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, tool_call_id) DO UPDATE SET result = excluded.result`
        )
        .run(runId, callId, toolName, result, atomic ? 1 : 0);
    };
    return {
      prepare: (callId, toolName) => {
        owned(callId, toolName);
        this.db
          .prepare(
            `INSERT INTO agent_tool_results (run_id, tool_call_id, tool_name, atomic_owner)
          VALUES (?, ?, ?, 1) ON CONFLICT(run_id, tool_call_id) DO NOTHING`
          )
          .run(runId, callId, toolName);
      },
      commit: (callId, toolName, result) => save(callId, toolName, result, true),
      returned: (callId, toolName, result) => {
        try {
          this.db.transaction(() => save(callId, toolName, result, false))();
        } catch (cause) {
          throw new graph.RunRecoveryBlockedError(
            `Tool result could not be committed: ${cause instanceof Error ? cause.message : 'storage error'}`
          );
        }
      },
    };
  }
}
