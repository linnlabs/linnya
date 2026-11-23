import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskCreateRequest, ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { getScheduledTaskSchemaProviders } from '../../../adapters/persistence/scheduled-tasks/schema-providers';
import { createSqliteScheduledTasks } from '../../../adapters/persistence/scheduled-tasks/sqliteScheduledTasks';
import { SQLiteEventStore } from '../../../adapters/persistence/event-store';
import { getConversationSchemaProviders } from '../../../adapters/persistence/event-store/schema-providers';
import { createScheduledTasks, type ScheduledExecutionFact } from '..';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse('2026-11-01T00:00:00Z');
const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

function fixture() {
  const db = new Database(':memory:');
  closers.push(() => db.close());
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY); INSERT INTO projects VALUES (\'project\')');
  for (const provider of [...getConversationSchemaProviders(), ...getScheduledTaskSchemaProviders()]) {
    for (const ddl of provider.getSchema()) db.exec(ddl);
  }
  const eventStore = new SQLiteEventStore(db, true);
  const store = createSqliteScheduledTasks(db);
  const notifications: ScheduledTaskNotification[] = [];
  const facts = new Map<string, ScheduledExecutionFact>();
  const admitted: string[] = [];
  const stopped: string[] = [];
  let wallClock = START;
  let concurrency = 1;
  let modelAvailable = true;
  function owner(enabled = true) {
    return createScheduledTasks({ store, schedulerEnabled: enabled, now: () => wallClock, timezone: () => 'UTC',
      projectExists: id => id === 'project', defaultModel: () => 'model', modelAvailable: () => modelAvailable,
      execution: {
        async start(task, run, _model, prepared) {
          const conversation = `conversation:${run.id}`;
          await eventStore.ensureConversation(conversation, [], 'project', 'agent');
          prepared(conversation);
          facts.set(run.id, { state: 'running', runId: run.id });
          admitted.push(task.name);
          return run.id;
        },
        async read(runs) { return new Map(runs.map(run => [run.id, facts.get(run.id) ?? { state: 'missing', runId: null }])); },
        async stop(_conversationId, runId) { stopped.push(runId); facts.set(runId, { state: 'interrupted', runId }); },
      },
      settings: { read: () => ({ max_concurrent_runs: concurrency }), write: settings => { concurrency = settings.max_concurrent_runs ?? concurrency; } },
      usage: () => null, storage: () => null, publish: () => {}, notify: async event => { notifications.push(event); },
      logError: (message, error) => { throw new Error(`${message}: ${String(error)}`); },
    });
  }
  const tasks = owner();
  async function create(name: string, overrides: Partial<ScheduledTaskCreateRequest> = {}) {
    const result = await tasks.create({ name, prompt: 'Do the scheduled work', project_id: 'project',
      agent: 'default', model_config_id: null, schedule: { kind: 'hourly', every_hours: 1, minute: 0 },
      missed_policy: 'run_latest', permission_level: 'standard', ...overrides });
    if (!result.ok) throw new Error(result.message);
    return result.task.id;
  }
  function transition(taskId: string, state: ScheduledExecutionFact['state']) {
    const run = store.pendingRuns().find(run => run.task_id === taskId && run.status === 'admitted');
    if (!run) throw new Error('Expected an admitted run');
    facts.set(run.id, { state, runId: run.id });
    return run;
  }
  async function start(current = tasks) { current.lifecycle.start(); await current.tick(); }
  async function at(offset: number, current = tasks) { wallClock = START + offset; await current.tick(); }
  return { db, eventStore, tasks, store, owner, create, transition, start, at, notifications, admitted, stopped,
    setModelAvailable: (value: boolean) => { modelAvailable = value; } };
}

describe('scheduled tasks with a wall clock and real SQLite', () => {
  it('runs on a minute boundary; restart, clock rollback and the two-minute tolerance preserve the planned identity', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture();
    try {
      const id = await f.create('hourly', { missed_policy: 'skip' });
      await f.at(HOUR - 1_000);
      await f.start();
      await vi.advanceTimersByTimeAsync(999);
      expect(f.admitted).toEqual([]);
      const advance = f.at(HOUR + 119_000);
      await vi.advanceTimersByTimeAsync(1);
      await advance;
      expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_at: START + HOUR, trigger: 'schedule' }]);
      await f.tasks.lifecycle.stop();
      expect(f.store.readRuns(id, 5)).toMatchObject([{ status: 'interrupted', reason: 'app_quit' }]);
      const restarted = f.owner();
      await f.at(HOUR - 1, restarted);
      await f.start(restarted);
      await f.at(HOUR + 119_000, restarted);
      expect(f.admitted).toEqual(['hourly']);
      await restarted.lifecycle.stop();
    } finally { vi.useRealTimers(); }
  });

  it('catches up one occurrence per task, groups missed rows and combines the wake notification', async () => {
    const f = fixture();
    const a = await f.create('A');
    const b = await f.create('B');
    await f.start();
    await f.at(8 * DAY + HOUR + 121_000);
    for (const id of [a, b]) {
      const runs = f.store.readRuns(id, 5);
      expect(runs).toMatchObject([{ planned_at: START + 8 * DAY + HOUR, trigger: 'catch_up' },
        { status: 'skipped', skipped_count: 192 }]);
    }
    expect(f.notifications).toContainEqual({ kind: 'catch_up', task_count: 2 });
    expect(f.admitted).toHaveLength(1);
    await f.tasks.lifecycle.stop();
  });

  it('releases an approval slot, coalesces queue entries and prioritizes a manual run', async () => {
    const f = fixture();
    const a = await f.create('A');
    const b = await f.create('B', { schedule: { kind: 'daily', time: '10:00' } });
    const c = await f.create('C');
    const d = await f.create('D', { schedule: { kind: 'daily', time: '11:00' } });
    await f.start();
    await f.tasks.runNow(a);
    await f.tasks.runNow(b);
    f.transition(a, 'awaiting_approval');
    await f.at(1_000);
    expect((await f.tasks.list()).running_count).toBe(1);
    expect(f.admitted).toEqual(['A', 'B']);
    await f.at(HOUR);
    await f.at(2 * HOUR - 60_000);
    await f.at(2 * HOUR);
    expect(f.store.readRuns(a, 4).slice(0, 2)).toMatchObject([
      { status: 'skipped', reason: 'previous_awaiting_approval' }, { status: 'skipped', reason: 'previous_awaiting_approval' },
    ]);
    expect(f.store.readRuns(c, 4)).toMatchObject([{ status: 'queued' }, { status: 'superseded' }]);
    expect(f.notifications.filter(event => event.kind === 'awaiting_approval')).toHaveLength(1);
    await f.tasks.runNow(d);
    f.transition(b, 'completed');
    await f.at(2 * HOUR + 1_000);
    expect(f.admitted).toEqual(['A', 'B', 'D']);
    f.transition(d, 'completed');
    await f.at(2 * HOUR + 2_000);
    expect(f.admitted[f.admitted.length - 1]).toBe('C');
    await f.at(3 * HOUR);
    expect(f.store.readRuns(c, 1)).toMatchObject([{ status: 'skipped', reason: 'previous_still_running' }]);
    await f.tasks.lifecycle.stop();
  });

  it('pauses after model failures, finishes a one-time task and pauses an unread recurring task', async () => {
    const f = fixture();
    const a = await f.create('fail');
    const b = await f.create('one', { schedule: { kind: 'once', date: '2026-11-01', time: '04:00' } });
    const c = await f.create('unviewed', { schedule: { kind: 'daily', time: '05:00' } });
    await f.start();
    f.setModelAvailable(false);
    for (const hour of [1, 2, 3]) await f.at(hour * HOUR);
    expect(f.store.read(a)).toMatchObject({ enabled: false, consecutive_failures: 3, paused_reason: 'failures' });
    expect(f.store.readRuns(a, 1)).toMatchObject([{ status: 'failed', reason: 'model_unavailable' }]);
    f.setModelAvailable(true);
    await f.at(4 * HOUR);
    f.transition(b, 'completed');
    await f.at(4 * HOUR + 1_000);
    expect(f.store.read(b)).toMatchObject({ enabled: false, paused_reason: 'one_shot_done' });
    await f.at(5 * HOUR);
    f.transition(c, 'completed');
    await f.at(5 * HOUR + 1_000);
    await f.at(14 * DAY + 5 * HOUR + 1_000);
    expect(f.store.read(c)).toMatchObject({ enabled: false, paused_reason: 'unviewed' });
    expect(f.notifications).toContainEqual({ kind: 'auto_paused', task_id: c, task_name: 'unviewed', cause: 'unviewed' });
    await f.tasks.lifecycle.stop();
  });

  it('keeps manual runs available with the development scheduler disabled and ignores paused time', async () => {
    const f = fixture();
    const id = await f.create('manual');
    const disabled = f.owner(false);
    await f.start(disabled);
    await f.at(3 * HOUR, disabled);
    expect((await disabled.list()).scheduler_enabled).toBe(false);
    expect(f.store.readRuns(id, 5)).toEqual([]);
    await disabled.runNow(id);
    f.transition(id, 'completed');
    await f.at(3 * HOUR + 1_000, disabled);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ trigger: 'manual', status: 'completed' }]);
    await disabled.setEnabled(id, false);
    await disabled.lifecycle.stop();
    await f.at(9 * HOUR, f.tasks);
    await f.start();
    await f.tasks.setEnabled(id, true);
    await f.at(10 * HOUR);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_at: START + 10 * HOUR }, { trigger: 'manual' }]);
    await f.tasks.lifecycle.stop();
  });

  it('folds before paging, clears unread on open and cleans runs when their task or project is deleted', async () => {
    const f = fixture();
    const a = await f.create('A');
    await f.start();
    await f.at(HOUR);
    const first = f.transition(a, 'completed');
    await f.at(HOUR + 1_000);
    await f.eventStore.ensureConversation('ordinary', [], 'project', 'agent');
    await f.at(2 * HOUR);
    const second = f.transition(a, 'completed');
    await f.at(2 * HOUR + 1_000);
    f.db.prepare('UPDATE conversations SET last_event_at = CASE conversation_id WHEN ? THEN ? WHEN ? THEN ? ELSE ? END')
      .run(first.conversation_id, START + HOUR, second.conversation_id, START + 2 * HOUR, START + HOUR + 500);
    const page = await f.eventStore.listConversations({ projectId: 'project', limit: 1 });
    expect(page.conversations).toMatchObject([{ conversation_id: second.conversation_id, scheduled_task: { task_id: a, unread_count: 2 } }]);
    const final = await f.eventStore.listConversations({ projectId: 'project', limit: 1, cursor: page.nextCursor });
    expect(final).toMatchObject({ conversations: [{ conversation_id: 'ordinary' }], hasMore: false });
    if (second.conversation_id === null || first.conversation_id === null) throw new Error('Expected real conversation IDs');
    await f.tasks.markViewed(second.conversation_id);
    expect(f.store.runFacts(a).unread_count).toBe(1);
    f.db.prepare('DELETE FROM conversations WHERE conversation_id = ?').run(first.conversation_id);
    expect(f.store.readRunAt(a, first.planned_at)?.conversation_id).toBeNull();
    await f.tasks.runNow(a);
    const active = f.transition(a, 'running');
    expect(await f.tasks.delete({ task_id: a, stop_running: true })).toEqual({ ok: true, stopped_runs: 1 });
    expect(f.stopped).toContain(active.id);
    expect(f.store.readRuns(a, 10)).toEqual([]);
    expect(await f.eventStore.getConversationMetadata(second.conversation_id)).toBeTruthy();
    const b = await f.create('Project removal');
    await f.tasks.runNow(b);
    const projectRun = f.transition(b, 'running');
    await f.tasks.withProjectDeletion('project', async stop => { await stop(); f.db.exec("DELETE FROM projects WHERE id = 'project'"); });
    expect(f.stopped).toContain(projectRun.id);
    expect(f.store.read(b)).toBeUndefined();
    expect(f.store.readRuns(b, 5)).toEqual([]);
    await f.tasks.lifecycle.stop();
  });
});
