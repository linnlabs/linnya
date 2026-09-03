import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';
import type { runSupervisor } from 'linnkit/runtime-kernel';
import type { LlmInputMaterializerPort } from 'linnkit/ports';
import {
  bootstrapAgentRuntimeSingletons,
  resetAgentRuntimeSingletonsForTest,
} from '../agentRuntimeSingletons';
import { RunIdSchema } from 'linnkit/contracts';

type RunRecord = runSupervisor.RunRecord;

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  db.prepare(
    `
    INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
    VALUES (?, 'test', 1, 1)
  `
  ).run('conv-runtime-boot');
  return db;
}

function createRun(runId: string, status: RunRecord['status'], parentRunId?: string): RunRecord {
  return {
    runId: RunIdSchema.parse(runId),
    conversationId: 'conv-runtime-boot',
    ...(parentRunId ? { parentRunId: RunIdSchema.parse(parentRunId) } : {}),
    agentSpecId: parentRunId ? 'child-agent' : 'root-agent',
    status,
    currentNode: status === 'completed' ? 'answer' : 'tool',
    startedAt: 100,
    updatedAt: 200,
    metadata: { existing: runId },
  };
}

describe('agent runtime 启动恢复', () => {
  afterEach(() => {
    resetAgentRuntimeSingletonsForTest();
  });

  it('在开放新 run 前把 SQLite 中的 root/child 非终态 run 收口为 RUN_ABANDONED', async () => {
    const db = createDatabase();
    const registry = new SQLiteRunRegistryStore(db);
    const activeRuns: RunRecord[] = [
      createRun('run-pending', 'pending'),
      createRun('run-running', 'running'),
      createRun('run-awaiting', 'awaiting_user'),
      createRun('run-paused-child', 'paused', 'run-running'),
    ];
    for (const run of activeRuns) {
      await registry.save(run);
    }
    await registry.save(createRun('run-completed', 'completed'));
    await registry.save(createRun('run-cancelled', 'cancelled'));

    const { recoveredRuns } = await bootstrapAgentRuntimeSingletons({
      db,
      eventStore: new SQLiteEventStore(db),
    });

    expect(recoveredRuns.map(run => run.runId).sort()).toEqual(
      activeRuns.map(run => run.runId).sort()
    );
    for (const run of activeRuns) {
      await expect(registry.load(run.runId)).resolves.toMatchObject({
        status: 'failed',
        errorIfAny: {
          errorCode: 'RUN_ABANDONED',
          message: 'application restarted before run reached terminal status',
          recoverable: true,
        },
        metadata: {
          existing: run.runId,
          recovery: {
            reason: 'application restarted before run reached terminal status',
            recoveredAt: expect.any(Number),
          },
        },
      });
    }
    await expect(registry.load('run-completed')).resolves.toMatchObject({ status: 'completed' });
    await expect(registry.load('run-cancelled')).resolves.toMatchObject({ status: 'cancelled' });

    db.close();
  });

  it('保存当前 workspace 的物化器实例供 root 与 child runtime 共用', async () => {
    const db = createDatabase();
    const llmInputMaterializer: LlmInputMaterializerPort = {
      materialize: async () => [],
    };

    const { runtime } = await bootstrapAgentRuntimeSingletons({
      db,
      eventStore: new SQLiteEventStore(db),
      llmInputMaterializer,
    });

    expect(runtime.llmInputMaterializer).toBe(llmInputMaterializer);
    db.close();
  });
});
