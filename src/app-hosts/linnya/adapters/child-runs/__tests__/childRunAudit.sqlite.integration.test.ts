import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { audit, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import {
  CommandExecutionIdentitySchema,
  CommandExecutionTerminalV1Schema,
  CommandPermissionSnapshotV1Schema,
  ShellCommandProposalV1Schema,
} from '@app/schemas/commands';
import {
  createLinnyaAuditRuntime,
  flushLinnyaAudit,
  projectCommandExecutionAuditEnvelope,
  recordLlmResponseSummary,
  runWithLlmAuditContext,
} from 'src/domains/audit';
import { SQLiteEventStore, LinnyaEventStoreAdapter } from '../../persistence/event-store';
import { CONVERSATION_SCHEMAS } from '../../persistence/event-store/conversation.schema';
import { SQLiteRunRegistryStore } from '../../persistence/run-registry';
import { createEventStoreCommandExecutionAuditPort } from '../../persistence/command-execution-audit';

const conversationId = 'conversation-child-audit';
const rootId = RunIdSchema.parse('run-audit-root');
const childId = RunIdSchema.parse('run-audit-child');
const siblingId = RunIdSchema.parse('run-audit-sibling');
const nestedId = RunIdSchema.parse('run-audit-nested');
function parentOf(runId: string) {
  return runId === rootId ? undefined : runId === nestedId ? childId : rootId;
}

async function fixture() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY);');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  db.prepare(
    'INSERT INTO conversations(conversation_id,title,created_at,last_event_at) VALUES(?,?,?,?)'
  ).run(conversationId, 'child audit', 1, 1);
  const registryStore = new SQLiteRunRegistryStore(db);
  for (const runId of [rootId, childId, siblingId, nestedId]) {
    await registryStore.save({
      runId,
      conversationId,
      agentSpecId: 'test',
      status: 'running',
      startedAt: 1,
      updatedAt: 1,
      parentRunId: parentOf(runId),
    });
  }
  const store = new LinnyaEventStoreAdapter(db, new SQLiteEventStore(db));
  const sink = audit.createEventStoreAudit({ eventStore: store });
  const runtime = createLinnyaAuditRuntime({ level: 'response', sink });
  const supervisor = new runSupervisor.DefaultRunSupervisor({ registryStore });
  const commandAudit = createEventStoreCommandExecutionAuditPort({
    auditPort: runtime.auditPort,
    runs: supervisor,
  });
  return { db, registryStore, store, sink, runtime, commandAudit };
}

function proposalFor(runId: string) {
  const identity = CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: runId,
    origin_tool_call_id: `call-${runId}`,
    command_execution_id: 'command_execution_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a',
    owner_generation_id: 'command_owner_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
    created_at_ms: 1,
  });
  const permission = CommandPermissionSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  });
  return ShellCommandProposalV1Schema.parse({
    protocol_version: 1,
    kind: 'shell_command_proposal',
    identity,
    permission,
    command: 'printf audit',
    cwd: '/tmp',
  });
}

function recordResponse(attemptId: string) {
  recordLlmResponseSummary({
    attemptId,
    traceId: attemptId,
    modelId: 'test',
    endpointId: 'test',
    endpointModelId: 'test',
    capabilityId: 'text',
    apiSurface: 'chat',
    outcome: 'succeeded',
    usage: { provenance: 'provider_reported', inputTokens: 2, outputTokens: 3 },
  });
}

afterEach(() => {
  // 生产只有一个 runtime，测试结束关闭全局配置，避免影响其他用例。
  createLinnyaAuditRuntime({ level: 'off', sink: { emit() {} } });
});

describe('child command / response audit through real SQLite', () => {
  it('并发 root/child 命令、取消后的迟到 terminal 与重建 adapter 都使用持久父身份', async () => {
    const f = await fixture();
    try {
      await Promise.all(
        [rootId, childId, siblingId, nestedId].map(runId =>
          f.commandAudit.record({
            kind: 'proposal_created',
            occurred_at_ms: 2,
            proposal: proposalFor(runId),
          })
        )
      );
      const child = await f.registryStore.load(childId);
      if (!child) throw new Error('missing fixture child');
      await f.registryStore.save({ ...child, status: 'cancelled', updatedAt: 3 });
      // 新 supervisor 没有内存 handle，模拟恢复后的 command owner 回报。
      const restarted = createEventStoreCommandExecutionAuditPort({
        auditPort: f.runtime.auditPort,
        runs: new runSupervisor.DefaultRunSupervisor({
          registryStore: new SQLiteRunRegistryStore(f.db),
        }),
      });
      const terminal = CommandExecutionTerminalV1Schema.parse({
        protocol_version: 1,
        kind: 'command_execution_terminal',
        identity: proposalFor(childId).identity,
        settled_at_ms: 4,
        outcome: 'execution_ended',
        termination_cause: 'natural_exit',
        process_exit: { status: 'observed', exit_code: 0, signal: null },
        output_drain: { status: 'complete' },
        tree_cleanup: { status: 'succeeded' },
        resource_release: { status: 'succeeded' },
      });
      await restarted.record({ kind: 'execution_terminal', occurred_at_ms: 4, terminal });
      const rows = await f.store.range(conversationId);
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.event.parent_run_id).toBe(parentOf(row.event.run_id));
      }
      expect(rows.filter(row => row.event.run_id === childId)).toHaveLength(2);
      // producer 缺父身份仍被 SQLite 拒绝；本修复不放宽 EventStore 合同。
      await expect(
        f.sink.emit(
          projectCommandExecutionAuditEnvelope({
            event: { kind: 'proposal_created', occurred_at_ms: 5, proposal: proposalFor(childId) },
          })
        )
      ).rejects.toThrow('has parent run none');
      await expect(
        restarted.record({
          kind: 'proposal_created',
          occurred_at_ms: 5,
          proposal: proposalFor('unknown-run'),
        })
      ).rejects.toThrow('registered run');
    } finally {
      f.db.close();
    }
  });

  it('父子 response 各自享有预算；子取消/结束不会关闭父队列，同 run 标签不重置预算', async () => {
    const f = await fixture();
    try {
      await runWithLlmAuditContext({ conversationId, runId: rootId }, async () => {
        recordResponse('root-before');
        await Promise.all(
          [childId, siblingId].map(async runId => {
            await runWithLlmAuditContext(
              { conversationId, runId, parentRunId: rootId },
              async () => {
                for (let i = 0; i < 64; i++) recordResponse(`${runId}-${i}`);
                await runWithLlmAuditContext({ source: 'nested-same-run' }, async () =>
                  recordResponse('over-budget')
                );
                if (runId === childId) {
                  await runWithLlmAuditContext(
                    { conversationId, runId: nestedId, parentRunId: childId },
                    async () => recordResponse('nested')
                  );
                }
                await flushLinnyaAudit();
              }
            );
          })
        );
        recordResponse('root-after');
        const cancelled = new Error('cancelled');
        cancelled.name = 'AbortError';
        // 暂停/恢复相同 run 时建立新的执行作用域，不能沿用上一轮 flushed 状态。
        await expect(
          runWithLlmAuditContext(
            { conversationId, runId: childId, parentRunId: rootId },
            async () => {
              recordResponse('before-cancel');
              throw cancelled;
            }
          )
        ).rejects.toBe(cancelled);
        recordResponse('root-after-cancel');
      });
      const rows = await f.store.range(conversationId);
      expect(rows).toHaveLength(133);
      expect(rows.filter(row => row.event.run_id === rootId)).toHaveLength(3);
      expect(rows.filter(row => row.event.run_id === childId)).toHaveLength(65);
      expect(rows.filter(row => row.event.run_id === siblingId)).toHaveLength(64);
      expect(rows.every(row => row.event.parent_run_id === parentOf(row.event.run_id))).toBe(true);
    } finally {
      f.db.close();
    }
  });
});
