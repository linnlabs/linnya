import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import {
  RunDescriptorSchema,
  ChildRunLimitExceededError,
} from '../../../../application/run-resumption';
import { DEEP_WEB_SEARCH_DEFINITION } from '../../../../agent-registry/agents/deep_web_search';
import { runnableDefinitionToAgentSpec } from '../../../runtime/agentDefinitionToAgentSpec';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { RUN_DESCRIPTORS_SCHEMA } from '../../run-descriptors/schema-providers';
import { SQLiteEventStore } from '../../event-store';
import { SQLiteRunRegistryStore } from '../../run-registry';
import { SqliteRunDescriptorStore } from '../../run-descriptors';
import { SqliteRunAdmissionCommit } from '../sqliteRunAdmissionCommit';
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const incoming = { events: [], assetCommitsByEventId: new Map() };
const conversationId = 'limit-conversation';
function child(index: number, parent = 'parent-run') {
  const runId = RunIdSchema.parse(`child-${index}`);
  return {
    record: {
      runId,
      conversationId,
      status: 'running' as const,
      startedAt: 1,
      updatedAt: 1,
      metadata: { executionId: `attempt-${index}` },
    },
    descriptor: RunDescriptorSchema.parse({
      schemaVersion: 1,
      runId,
      conversationId,
      turnId: `turn-${index}`,
      createdAt: 1,
      child: { parentRunId: parent, parentToolCallId: `call-${index}`, subrunId: `sub-${index}` },
      agentSpec: runnableDefinitionToAgentSpec(DEEP_WEB_SEARCH_DEFINITION),
      request: { query: 'question', promptKey: 'deep_web_search', frozenSystemPrompt: 'frozen' },
      historyEventIds: [],
      incomingEventIds: [],
      runContext: { runId, traceId: 'trace', tags: {} },
      toolContextPatch: {},
      executorLocal: {},
      commandPermission: {
        status: 'unavailable',
        code: 'permission_settings_unavailable',
        reason: 'run_snapshot_missing',
      },
      compatibility: {
        hostVersion: 'test',
        frameworkVersion: 'test',
        agentConfiguration: {},
        models: {},
        plugins: [],
        skills: {},
      },
    }),
    incoming,
    maxCallsPerParentRun: 4,
  };
}
async function runtime() {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(
    'CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE assets (id TEXT PRIMARY KEY);'
  );
  for (const ddl of [...CONVERSATION_SCHEMAS, ...RUN_DESCRIPTORS_SCHEMA]) db.exec(ddl);
  await new SQLiteEventStore(db).ensureConversation(conversationId, [], undefined, 'agent');
  return {
    db,
    admission: new SqliteRunAdmissionCommit(db),
    descriptors: new SqliteRunDescriptorStore(db),
    runs: new SQLiteRunRegistryStore(db),
  };
}
describe('网页 child 持久限额', () => {
  it('并发申请只有四个落盘，第五个拒绝且不留下运行；失败不返还，另一父 run 独立计数', async () => {
    const r = await runtime();
    const outcomes = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(i => r.admission.start(child(i)))
    );
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(4);
    expect(outcomes[4]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ChildRunLimitExceededError),
    });
    expect(await r.descriptors.exists('child-5')).toBe(false);
    await r.runs.save({ ...child(1).record, status: 'failed', updatedAt: 2 });
    // 重建适配器后仍读取持久记录，不依赖某个 ToolContext 或内存计数。
    await expect(new SqliteRunAdmissionCommit(r.db).start(child(6))).rejects.toBeInstanceOf(
      ChildRunLimitExceededError
    );
    await r.admission.start(child(7, 'another-parent'));
    expect(r.descriptors.countChildrenInTransaction('parent-run', 'deep_web_search')).toBe(4);
  });
  it('同调用暂停恢复不再次扣额；额度已满仍能恢复原 child', async () => {
    const r = await runtime();
    for (const i of [1, 2, 3, 4]) await r.admission.start(child(i));
    const previous = { ...child(1).record, status: 'paused' as const, updatedAt: 2 };
    await r.runs.save(previous);
    await r.admission.resume({
      previous,
      next: { ...previous, status: 'running', updatedAt: 3 },
      incoming,
    });
    expect(r.descriptors.countChildrenInTransaction('parent-run', 'deep_web_search')).toBe(4);
    await expect(r.admission.start(child(5))).rejects.toBeInstanceOf(ChildRunLimitExceededError);
  });
});
