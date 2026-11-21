import { performance } from 'node:perf_hooks';
import { ProjectConversationQueryOptionsSchema } from '@app/schemas';
import { DatabaseService } from '../../../src/electron-main/services/database';
import { createProjectLifecycle } from '../../../src/domains/projects';
import { createConversationActivityPorts } from '../../../src/app-hosts/linnya/adapters/persistence/run-registry';
import { queryProjectConversations } from '../../../src/app-hosts/linnya/application/project-conversations';

/** 不连用户数据库的适度规模观察；不以机器相关毫秒阈值替代正确性门禁。 */
async function measure(conversations: number, runsPerConversation: number) {
  const database = new DatabaseService(':memory:');
  database.initialize();
  const db = database.getDb();
  const project = createProjectLifecycle(db).create({ name: 'query benchmark' });
  const insertConversation = db.prepare('INSERT INTO conversations (conversation_id, project_id, title, created_at, last_event_at) VALUES (?, ?, ?, 1, 1)');
  const insertRun = db.prepare(`INSERT INTO runs (id, conversation_id, kind, status, agent_spec_id, start_ts, updated_ts, metadata_json) VALUES (?, ?, 'agent', 'completed', 'default', ?, ?, ?)`);
  const metadata = JSON.stringify({ lane: 'foreground', turnId: 'turn', executionId: 'execution', descriptor: 'x'.repeat(512) });
  db.transaction(() => {
    for (let index = 0; index < conversations; index += 1) {
      const id = `conversation-${index}`;
      insertConversation.run(id, project, id);
      for (let run = 0; run < runsPerConversation; run += 1) insertRun.run(`${id}-${run}`, id, run + 1, run + 1, metadata);
    }
  })();
  const source = createConversationActivityPorts(db, { readControlPending: () => [] });
  let recordsRead = 0;
  const ports = { ...source, runs: { async readCandidates(ids: readonly string[]) {
    const rows = await source.runs.readCandidates(ids); recordsRead += [...rows.values()].reduce((count, rows) => count + rows.length, 0); return rows;
  } } };
  const timings = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    recordsRead = 0;
    const start = performance.now();
    const result = await queryProjectConversations(db, { ...ProjectConversationQueryOptionsSchema.parse({}), project_id: project }, ports);
    timings.push({ elapsedMs: Math.round(performance.now() - start), recordsRead, rows: result.conversations.length });
  }
  database.close();
  return { conversations, runsPerConversation, totalRuns: conversations * runsPerConversation, timings };
}
console.log(JSON.stringify({ results: [await measure(500, 20), await measure(500, 200)] }));
