import Database from 'better-sqlite3';
import { PromptKeys } from '@app/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEnvelope } from 'linnkit/contracts';
import type { AgentInvocationRequest, AuditPort } from 'linnkit/ports';
import { childRuns, graph, runSupervisor } from 'linnkit/runtime-kernel';

import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';
import { LinnyaRegisteredChildRunLifecycle } from '../childRunLifecycle';
import { RegisteredChildRunInvoker } from '../registeredSubagentInvoker';
import { RunIdSchema, ToolCallIdSchema } from 'linnkit/contracts';

interface Latch {
  promise: Promise<void>;
  release(): void;
}

interface PersistedRunLifecycleRow {
  status: string;
  current_node: string | null;
  iterations_used: number | null;
  error_json: string | null;
  metadata_json: string | null;
}

function createLatch(): Latch {
  let release = (): void => {
    throw new Error('latch was released before initialization');
  };
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

function createRegistry(): {
  db: Database.Database;
  registryStore: SQLiteRunRegistryStore;
} {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY);
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  db.prepare(
    `
    INSERT INTO conversations (conversation_id, title, created_at, last_event_at)
    VALUES (?, 'child cancellation', 1, 1)
  `
  ).run('conversation-child-cancellation');
  return { db, registryStore: new SQLiteRunRegistryStore(db) };
}

function readLifecycleRow(db: Database.Database, runId: string): PersistedRunLifecycleRow {
  const row = db
    .prepare(
      `
    SELECT status, current_node, iterations_used, error_json, metadata_json
    FROM runs
    WHERE id = ?
  `
    )
    .get(runId) as PersistedRunLifecycleRow | undefined;
  if (!row) {
    throw new Error(`missing persisted run ${runId}`);
  }
  return row;
}

describe('registered child cancellation SQLite lifecycle', () => {
  it('外部取消后由 child settlement 补全真实进度，并保留第一次取消事实', async () => {
    const conversationId = 'conversation-child-cancellation';
    const parentRunId = RunIdSchema.parse('run-parent-cancellation');
    const childRunId = RunIdSchema.parse('run-child-cancellation');
    const executionStarted = createLatch();
    const abortObserved = createLatch();
    const releaseSettlement = createLatch();
    const auditEnvelopes: AuditEnvelope[] = [];
    const auditPort: AuditPort = {
      emit: vi.fn((envelope: AuditEnvelope) => {
        auditEnvelopes.push(envelope);
      }),
    };
    const { db, registryStore } = createRegistry();

    try {
      await registryStore.save({
        runId: RunIdSchema.parse(parentRunId),
        conversationId,
        agentSpecId: 'parent-agent',
        status: 'running',
        startedAt: 1,
        updatedAt: 1,
      });
      const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
        registryStore,
        auditPort,
      });
      const childRunInvoker: Pick<childRuns.ChildRunInvoker, 'invoke'> = {
        invoke: vi.fn(async (params: childRuns.ChildRunInvokeConfig) => {
          const signal = params.abortSignal;
          if (!signal) {
            throw new Error('registered child must receive its lifecycle abort signal');
          }
          executionStarted.release();
          await new Promise<void>(resolve => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          abortObserved.release();
          await releaseSettlement.promise;
          return {
            runId: childRunId,
            parentRunId,
            subrunId: childRunId,
            success: false,
            cancelled: true,
            error: 'child executor observed abort',
            events: [],
            stepCount: 7,
          };
        }),
      };
      const invoker = new RegisteredChildRunInvoker({
        agentResolver: {
          resolveByPromptKey: () => ({
            agentDefinition: {
              id: 'child-agent',
              promptKey: PromptKeys.DEFAULT,
              defaultMode: 'agent',
              description: 'SQLite cancellation test child',
            },
            agentConfig: {
              id: 'child-agent',
              promptKey: PromptKeys.DEFAULT,
            },
          }),
        },
        childRunInvoker,
        lifecycle: new LinnyaRegisteredChildRunLifecycle({
          supervisor,
          eventStore: new graph.MemoryEventStore(),
          nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
          costCollector: {
            snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
          },
        }),
      });

      const invocation = invoker.invoke({
        promptKey: PromptKeys.DEFAULT,
        userMessage: '执行一个会被中途取消的子任务',
        parentToolContext: {
          conversationId,
          runId: RunIdSchema.parse(parentRunId),
          parentToolCallId: ToolCallIdSchema.parse('tool-call-child-cancellation'),
          createSubRunTracePublisher: () => ({ publish: vi.fn() }),
          conversationView: {
            getWorkingHistoryEvents: () => [],
            getPersistedHistoryEvents: () => [],
          },
        },
        tracePolicy: { subrunId: childRunId },
      });

      await executionStarted.promise;
      await supervisor.cancel(RunIdSchema.parse(childRunId), {
        reason: 'user stopped parent task',
        forceCleanup: false,
      });
      await abortObserved.promise;
      const rowBeforeSettlement = readLifecycleRow(db, childRunId);

      releaseSettlement.release();
      const result = await invocation;
      const rowAfterSettlement = readLifecycleRow(db, childRunId);
      const children = await supervisor.list({ parentRunId: RunIdSchema.parse(parentRunId) });
      const terminal = await supervisor.waitForTerminal(RunIdSchema.parse(childRunId));

      expect(result).toMatchObject({
        runId: childRunId,
        subrunId: childRunId,
        cancelled: true,
        stepCount: 7,
      });
      expect(rowBeforeSettlement).toMatchObject({
        status: 'cancelled',
        current_node: 'llm',
        iterations_used: null,
      });
      expect(JSON.parse(rowBeforeSettlement.error_json ?? 'null')).toMatchObject({
        errorCode: 'RUN_CANCELLED',
        message: 'user stopped parent task',
      });
      expect(rowAfterSettlement).toMatchObject({
        status: 'cancelled',
        current_node: 'cancelled',
        iterations_used: 7,
      });
      expect(JSON.parse(rowAfterSettlement.error_json ?? 'null')).toMatchObject({
        errorCode: 'RUN_CANCELLED',
        message: 'user stopped parent task',
      });
      expect(JSON.parse(rowAfterSettlement.metadata_json ?? 'null')).toMatchObject({
        cancel: {
          reason: 'user stopped parent task',
          forceCleanup: false,
        },
      });
      expect(children.runs).toEqual([
        expect.objectContaining({
          runId: childRunId,
          parentRunId,
          status: 'cancelled',
          currentNode: 'cancelled',
          iterationsUsed: 7,
        }),
      ]);
      expect(terminal).toMatchObject({
        runId: childRunId,
        status: 'cancelled',
        currentNode: 'cancelled',
        iterationsUsed: 7,
        error: {
          message: 'user stopped parent task',
        },
      });
      expect(auditEnvelopes.filter(envelope => envelope.action === 'run.cancel')).toHaveLength(1);
    } finally {
      releaseSettlement.release();
      db.close();
    }
  });
});
