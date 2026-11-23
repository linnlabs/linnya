import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
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

function fixture(databasePath = ':memory:', buildTime?: number) {
  const db = new Database(databasePath);
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
  const publish = vi.fn();
  let wallClock = START;
  let timezone = 'UTC';
  let concurrency = 1;
  let modelAvailable = true;
  function owner(enabled = true, connection = db) {
    return createScheduledTasks({ store: createSqliteScheduledTasks(connection), schedulerEnabled: enabled, buildTime,
      now: () => wallClock, timezone: () => timezone,
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
      usage: () => null, storage: () => null, publish, notify: async event => { notifications.push(event); },
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
  return { db, eventStore, tasks, store, owner, create, transition, start, at, notifications, admitted, stopped, publish,
    setTimezone: (value: string) => { timezone = value; },
    clearFlow: () => facts.clear(),
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

  it('rebases eastbound travel without backfilling skipped wall times and immediately publishes the next run', async () => {
    const f = fixture();
    f.setTimezone('Europe/London');
    const id = await f.create('east', { schedule: { kind: 'daily', time: '09:00' } });
    await f.start();
    await f.at(2 * HOUR);
    expect((await f.tasks.list()).tasks[0].next_run_at).toBe(START + 9 * HOUR);
    f.publish.mockClear();
    f.setTimezone('Asia/Shanghai');
    await f.tasks.tick();
    expect(f.publish).toHaveBeenCalledOnce();
    expect(f.store.readRuns(id, 5)).toEqual([]);
    expect((await f.tasks.list()).tasks[0].next_run_at).toBe(START + DAY + HOUR);
    await f.at(DAY + HOUR);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_local: '2026-11-02T09:00', time_zone: 'Asia/Shanghai' }]);
    await f.tasks.lifecycle.stop();
  });

  it('keeps a westbound traveller’s local minute consumed after a restart', async () => {
    const f = fixture();
    f.setTimezone('Asia/Shanghai');
    const id = await f.create('west', { schedule: { kind: 'daily', time: '09:00' } });
    await f.start();
    await f.at(HOUR);
    f.transition(id, 'completed');
    await f.at(HOUR + 60_000);
    await f.tasks.lifecycle.stop();
    f.setTimezone('Europe/London');
    const restarted = f.owner();
    await f.start(restarted);
    expect((await restarted.list()).tasks[0].next_run_at).toBe(START + DAY + 9 * HOUR);
    await f.at(9 * HOUR, restarted);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_local: '2026-11-01T09:00', time_zone: 'Asia/Shanghai' }]);
    await f.at(DAY + 9 * HOUR, restarted);
    expect(f.admitted).toEqual(['west', 'west']);
    await restarted.lifecycle.stop();
  });

  it.each([['Asia/Kolkata', 45], ['Asia/Kathmandu', 30]] as const)('interprets hourly minute 15 in %s', async (timezone, utcMinute) => {
    const f = fixture();
    f.setTimezone(timezone);
    const id = await f.create('quarter-hour', { schedule: { kind: 'hourly', every_hours: 1, minute: 15 } });
    await f.start();
    const planned = utcMinute * 60_000;
    expect((await f.tasks.list()).tasks[0].next_run_at).toBe(START + planned);
    await f.at(planned);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_at: START + planned, planned_local: '2026-11-01T06:15', time_zone: timezone }]);
    await f.tasks.lifecycle.stop();
  });

  it('rebases a one-hour rollback without producing skipped rows or disturbing future run records', async () => {
    const f = fixture();
    const id = await f.create('rollback');
    await f.start();
    await f.at(HOUR);
    f.transition(id, 'completed');
    await f.at(HOUR + 60_000);
    const before = f.store.readRuns(id, 10);
    await f.at(60_000);
    // 记录原样保留；只有未读计时的起点晚于现在，压回现在（14 天未看从现在算）。
    expect(f.store.readRuns(id, 10)).toEqual(before.map(run => ({ ...run, unread_since_at: START + 60_000 })));
    expect((await f.tasks.list()).tasks[0].next_run_at).toBe(START + 2 * HOUR);
    await f.at(HOUR);
    expect(f.store.readRuns(id, 10)).toEqual(before.map(run => ({ ...run, unread_since_at: START + 60_000 })));
    await f.at(2 * HOUR);
    expect(f.admitted).toEqual(['rollback', 'rollback']);
    await f.tasks.lifecycle.stop();
  });

  it('allows manual work in 1997 and starts its unread timer only on recovery', async () => {
    const f = fixture(':memory:', START - DAY);
    const id = await f.create('invalid-clock');
    await f.start();
    const badClock = Date.parse('1997-01-01T01:00Z');
    await f.at(badClock - START);
    expect(await f.tasks.list()).toMatchObject({ clock_anomaly: { now: badClock, expected_after: START - DAY },
      tasks: [{ state: 'scheduled', next_run_at: null }] });
    expect(f.store.readRuns(id, 10)).toEqual([]);
    expect(f.tasks.preview({ kind: 'once', date: '1996-12-31', time: '09:00' })).toMatchObject({ ok: true });
    f.setModelAvailable(false);
    for (let i = 0; i < 3; i++) await f.tasks.runNow(id);
    expect(f.store.read(id)).toMatchObject({ enabled: true, consecutive_failures: 0 });
    expect(f.store.readRuns(id, 5).map(run => run.status)).toEqual(['interrupted', 'interrupted', 'interrupted']);
    f.setModelAvailable(true);
    expect((await f.tasks.runNow(id)).ok).toBe(true);
    f.transition(id, 'completed');
    await f.at(badClock - START + 15 * DAY);
    expect(f.store.read(id)).toMatchObject({ enabled: true });
    await f.at(3 * HOUR + 5 * 60_000);
    expect((await f.tasks.list()).clock_anomaly).toBeUndefined();
    expect(f.store.read(id)).toMatchObject({ enabled: true, consecutive_failures: 0 });
    expect(f.store.readRuns(id, 10).slice(0, 2)).toMatchObject([
      { trigger: 'catch_up', planned_at: START + 3 * HOUR }, { status: 'skipped', skipped_count: 2 },
    ]);
    expect(f.store.firstUnreadAt(id)).toBe(START + 3 * HOUR + 5 * 60_000);
    expect(f.notifications.filter(event => event.kind === 'auto_paused')).toEqual([]);
    await f.tasks.lifecycle.stop();
  });

  it('uses database evidence without a build timestamp and catches up a two-year forward jump once', async () => {
    const f = fixture();
    const id = await f.create('year-jump', { schedule: { kind: 'daily', time: '09:00' } });
    await f.start();
    await f.at(-2 * DAY);
    expect((await f.tasks.list()).clock_anomaly).toEqual({ now: START - 2 * DAY, expected_after: START - DAY });
    await f.at(731 * DAY + 10 * HOUR);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ trigger: 'catch_up', planned_at: START + 731 * DAY + 9 * HOUR },
      { status: 'skipped', skipped_count: 731 }]);
    expect(f.admitted).toEqual(['year-jump']);
    await f.tasks.lifecycle.stop();
  });

  it('recovers from a clock that ran years ahead instead of treating the corrected time as an anomaly', async () => {
    const f = fixture(':memory:', START - DAY);
    const id = await f.create('ahead-and-back', { schedule: { kind: 'daily', time: '09:00' } });
    await f.start();
    // 误把时钟调到两年后：库里留下两年后的检查、完成与查看时刻。
    const ahead = 731 * DAY + 10 * HOUR;
    await f.at(ahead);
    f.transition(id, 'completed');
    await f.at(ahead + 60_000);
    expect(f.store.firstUnreadAt(id)).toBe(START + ahead + 60_000);

    // 改回正确时间：不是异常，按回拨重定基准，第二天 9 点照常运行。
    await f.at(DAY + 8 * HOUR);
    expect((await f.tasks.list()).clock_anomaly).toBeUndefined();
    expect((await f.tasks.list()).tasks[0].next_run_at).toBe(START + DAY + 9 * HOUR);
    await f.at(DAY + 9 * HOUR);
    expect(f.admitted).toEqual(['ahead-and-back', 'ahead-and-back']);

    // 未来的未读起点按现在算：14 天没看仍会自动暂停，而不是等到两年后。
    expect(f.store.firstUnreadAt(id)).toBe(START + DAY + 8 * HOUR);
    f.transition(id, 'completed');
    await f.at(DAY + 8 * HOUR + 14 * DAY + 60_000);
    expect(f.store.read(id)).toMatchObject({ enabled: false, paused_reason: 'unviewed' });
    await f.tasks.lifecycle.stop();
  });

  it('admits the slot that became due during a check delayed by more than two minutes', async () => {
    const f = fixture();
    const id = await f.create('delayed');
    await f.at(HOUR - 60_000);
    await f.start();
    await f.at(HOUR + 3 * 60_000);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ trigger: 'catch_up', planned_at: START + HOUR, status: 'admitted' }]);
    await f.tasks.lifecycle.stop();
  });

  it.each([
    ['spring', '02:30', '2026-03-08T06:59Z', '2026-03-08T07:00Z', '2026-03-08T08:00Z'],
    ['fall', '01:30', '2026-11-01T05:29Z', '2026-11-01T05:30Z', '2026-11-01T06:30Z'],
  ])('admits exactly one New York %s DST occurrence', async (_season, time, before, due, after) => {
    const f = fixture();
    f.setTimezone('America/New_York');
    await f.at(Date.parse(before) - START);
    const id = await f.create('dst', { schedule: { kind: 'daily', time } });
    await f.start();
    await f.at(Date.parse(due) - START);
    f.transition(id, 'completed');
    await f.at(Date.parse(after) - START);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_at: Date.parse(due), status: 'completed' }]);
    await f.tasks.lifecycle.stop();
  });

  it('coalesces both sides of the repeated fall hour after sleep without suppressing admission', async () => {
    const f = fixture();
    f.setTimezone('America/New_York');
    await f.at(Date.parse('2026-11-01T05:29Z') - START);
    const id = await f.create('dst-hourly', { schedule: { kind: 'hourly', every_hours: 1, minute: 30 } });
    await f.start();
    await f.at(Date.parse('2026-11-01T06:32Z') - START);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ planned_at: Date.parse('2026-11-01T05:30Z'),
      planned_local: '2026-11-01T01:30', status: 'admitted' }]);
    await f.tasks.lifecycle.stop();
  });

  it('reconciles abandoned running and approval rows at startup and replans the durable queue', async () => {
    const f = fixture();
    const waiting = await f.create('approval', { schedule: { kind: 'daily', time: '10:00' } });
    const busy = await f.create('busy', { schedule: { kind: 'daily', time: '10:00' } });
    const queued = await f.create('queued', { schedule: { kind: 'daily', time: '01:00' } });
    await f.start();
    await f.tasks.runNow(waiting);
    f.transition(waiting, 'awaiting_approval');
    await f.tasks.runNow(busy);
    await f.at(HOUR);
    expect(f.store.readRuns(queued, 5)).toMatchObject([{ status: 'queued' }]);
    f.clearFlow();
    const restarted = f.owner();
    await f.at(HOUR + 3 * 60_000, restarted);
    await f.start(restarted);
    expect(f.store.readRuns(busy, 5)).toMatchObject([{ status: 'interrupted', reason: 'app_quit' }]);
    expect(f.store.readRuns(waiting, 5)).toMatchObject([{ status: 'interrupted', reason: 'app_quit' }]);
    expect(f.store.read(busy)?.consecutive_failures).toBe(0);
    expect(f.store.read(waiting)?.consecutive_failures).toBe(0);
    expect(f.store.readRuns(queued, 5)).toMatchObject([{ status: 'admitted', trigger: 'catch_up' }]);
    await restarted.tick();
    expect(f.notifications.filter(event => event.kind === 'awaiting_approval' && event.interrupted)).toHaveLength(1);
    await restarted.lifecycle.stop();
    await f.tasks.lifecycle.stop();
  });

  it('allows only one scheduler with a separate SQLite connection to start the shared occurrence', async () => {
    const directory = mkdtempSync(path.join(process.cwd(), '.scheduled-tasks-'));
    const databasePath = path.join(directory, 'workspace.sqlite');
    const f = fixture(databasePath);
    const secondConnection = new Database(databasePath);
    closers.push(() => secondConnection.close(), () => rmSync(directory, { recursive: true }));
    const second = f.owner(true, secondConnection);
    const id = await f.create('shared', { schedule: { kind: 'daily', time: '01:00' } });
    await Promise.all([f.start(), f.start(second)]);
    await Promise.all([f.at(HOUR), f.at(HOUR, second)]);
    expect(f.admitted).toEqual(['shared']);
    expect(f.store.readRuns(id, 5)).toMatchObject([{ status: 'admitted', planned_at: START + HOUR }]);
    await Promise.all([f.tasks.lifecycle.stop(), second.lifecycle.stop()]);
  });

  it('keeps active work when editing a schedule and replaces a queued calendar run', async () => {
    const f = fixture();
    const active = await f.create('active', { schedule: { kind: 'daily', time: '01:00' } });
    const queued = await f.create('old time', { schedule: { kind: 'daily', time: '02:00' } });
    await f.start();
    await f.at(HOUR);
    await f.at(2 * HOUR);
    expect(f.store.readRuns(queued, 5)).toMatchObject([{ status: 'queued' }]);
    const schedule = { kind: 'daily', time: '03:00' } as const;
    await f.tasks.update({ task_id: active, expected_revision: 0, schedule });
    await f.tasks.update({ task_id: queued, expected_revision: 0, schedule });
    expect(f.store.readRuns(active, 5)).toMatchObject([{ status: 'admitted' }]);
    expect(f.store.readRuns(queued, 5)).toMatchObject([{ status: 'superseded' }]);
    expect(f.stopped).toEqual([]);
    await f.at(3 * HOUR);
    expect(f.store.readRuns(queued, 5)).toMatchObject([{ status: 'queued', planned_at: START + 3 * HOUR }, { status: 'superseded' }]);
    f.transition(active, 'completed');
    await f.at(3 * HOUR + 60_000);
    expect(f.admitted).toEqual(['active', 'old time']);
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

  it('lets the existing approved execution resume before admitting a new task when a slot opens', async () => {
    const f = fixture();
    const a = await f.create('A');
    const b = await f.create('B');
    const c = await f.create('C');
    await f.start();
    await f.tasks.runNow(a);
    const waiting = f.transition(a, 'awaiting_approval');
    await f.tasks.runNow(b);
    await f.tasks.runNow(c);
    if (!waiting.conversation_id) throw new Error('Expected a waiting conversation');
    f.transition(a, 'running'); // Commands projects an accepted reply as processing.
    const resume = vi.fn();
    expect(f.tasks.deferApproval(waiting.conversation_id, resume)).toBe(true);
    await f.at(1_000);
    expect(resume).not.toHaveBeenCalled();
    expect((await f.tasks.list()).running_count).toBe(1);
    f.transition(b, 'completed');
    await f.at(2_000);
    expect(resume).toHaveBeenCalledOnce();
    expect(f.admitted).toEqual(['A', 'B']);
    f.transition(a, 'completed');
    await f.at(3_000);
    expect(f.admitted).toEqual(['A', 'B', 'C']);
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
