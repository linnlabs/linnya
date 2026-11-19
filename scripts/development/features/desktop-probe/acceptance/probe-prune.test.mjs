import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import {
  archiveEntryName, DAY_MS, isArchiveExpired, isOrphanLockStale, judgeInstancePrune, lastUsedAt,
  processesReferencingRoot, SUPERVISOR_HANDOFF_MS,
} from '../functions/instancePrunePolicy.mjs';
import { parseProbeArgs } from '../functions/parseProbeArgs.mjs';
import { instanceRoot, listInstanceNames, withLifecycleLock, writeSession } from '../infrastructure/instanceStore.mjs';
import { readProcessTable } from '../infrastructure/processTree.mjs';
import { pruneBeforeUp, pruneProbeInstances } from '../orchestration/probePrune.mjs';

const now = Date.parse('2026-11-19T12:00:00Z');
const daysAgo = days => now - days * DAY_MS;

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'probe-prune-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(path, mtimeMs) {
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

/** 造一个实例目录：session、last-used 标记、artifacts 与一点实例数据。 */
function fixtureInstance(name, { idleDays, state = 'stopped', session = {}, artifacts = [], lockFile = true } = {}) {
  const directory = join(root, name);
  for (const folder of ['logs', 'artifacts', 'user-data', 'workspace']) mkdirSync(join(directory, folder), { recursive: true });
  writeFileSync(join(directory, 'workspace', 'workspace.sqlite'), 'data'.repeat(1024));
  for (const file of artifacts) writeFileSync(join(directory, 'artifacts', file), `screenshot ${file}`);
  writeFileSync(join(directory, 'last-used'), '');
  touch(join(directory, 'last-used'), daysAgo(idleDays));
  writeSession(directory, { state, root: directory, startedAt: daysAgo(idleDays + 0.1), ...session });
  if (lockFile) {
    writeFileSync(`${directory}.lock.sqlite`, '');
    touch(`${directory}.lock.sqlite`, daysAgo(idleDays));
  }
  return directory;
}

const run = options => pruneProbeInstances({ root, now, ...options });
const nameOf = entry => entry.name;
const reasonOf = (result, name) => result.kept.find(entry => entry.name === name)?.reason;
/** 当前测试进程自己的身份：存活、身份一致，用来冒充仍在运行的看管进程。 */
const livingIdentity = () => readProcessTable().get(process.pid);

test('已停止且闲置超过三天的实例被删除，较新的保留', async () => {
  const old = fixtureInstance('old', { idleDays: 4 });
  const recent = fixtureInstance('recent', { idleDays: 2 });
  const result = await run();
  assert.deepEqual(result.removed.map(nameOf), ['old']);
  assert.equal(result.removed[0].idleDays, 4);
  assert.ok(result.removed[0].bytes > 0);
  assert.equal(result.reclaimedBytes, result.removed[0].bytes);
  assert.equal(reasonOf(result, 'recent'), 'recent');
  assert.ok(!existsSync(old), '过期实例目录被删除');
  assert.ok(!existsSync(`${old}.lock.sqlite`), '同时删除它的锁文件');
  assert.ok(existsSync(join(recent, 'workspace', 'workspace.sqlite')), '较新实例的数据完整');
  assert.ok(existsSync(`${recent}.lock.sqlite`));
});

test('最后使用时间取标记、停止时间与启动时间中最晚的', async () => {
  // last-used 很旧，但 session 记录它昨天刚停止：不能当作闲置多日。
  const directory = fixtureInstance('lately-stopped', { idleDays: 9, session: { stoppedAt: daysAgo(1) } });
  const result = await run();
  assert.deepEqual(result.removed, []);
  assert.equal(reasonOf(result, 'lately-stopped'), 'recent');
  assert.ok(existsSync(directory));
  assert.equal(lastUsedAt({ lastUsedMtimeMs: 5, session: { stoppedAt: 9, startedAt: 7 }, directoryMtimeMs: 100 }), 9);
  assert.equal(lastUsedAt({ session: {}, directoryMtimeMs: 100 }), 100);
});

test('运行中的实例不被删除，即使标记已超过闲置期', async () => {
  const identity = livingIdentity();
  const running = fixtureInstance('running', { idleDays: 10, state: 'ready', session: { supervisor: identity } });
  const failed = fixtureInstance('half-stopped', {
    idleDays: 10, state: 'failed', session: { electron: identity, failure: { code: 'STOP_FAILED' } },
  });
  const tracked = fixtureInstance('tracked-child', { idleDays: 10, session: { processes: [identity] } });
  const result = await run();
  assert.deepEqual(result.removed, []);
  for (const name of ['running', 'half-stopped', 'tracked-child']) assert.equal(reasonOf(result, name), 'running', name);
  for (const directory of [running, failed, tracked]) assert.ok(existsSync(join(directory, 'workspace', 'workspace.sqlite')));
});

test('身份不一致（进程号被复用）的登记进程不算存活，实例可以回收', async () => {
  const identity = livingIdentity();
  fixtureInstance('recycled-pid', {
    idleDays: 5, state: 'ready', session: { supervisor: { ...identity, startedAt: 'Mon Jan  1 00:00:00 2001' } },
  });
  const result = await run();
  assert.deepEqual(result.removed.map(nameOf), ['recycled-pid']);
});

test('命令行仍指向实例目录的进程说明实例在用，即使会话里没有登记', async () => {
  const directory = fixtureInstance('referenced', { idleDays: 6 });
  const entry = (pid, command) => [pid, { pid, parent: 1, group: pid, startedAt: 'x', command }];
  const table = new Map([
    entry(7001, `/Applications/Electron --user-data-dir=${directory}/user-data --inspect`),
    entry(7002, `${process.execPath} probeSupervisor.mjs ${root}/other`),
  ]);
  assert.deepEqual(processesReferencingRoot(table, directory, process.pid), [7001]);
  assert.deepEqual(processesReferencingRoot(new Map([entry(7003, `node probeSupervisor.mjs ${directory}`)]), directory, 1), [7003]);
  const result = await run({ readTable: () => table });
  assert.deepEqual(result.removed, []);
  assert.equal(reasonOf(result, 'referenced'), 'running');
  assert.ok(existsSync(directory));
});

test('持有生命周期锁的实例被保留，释放后可以回收', async () => {
  const directory = fixtureInstance('busy', { idleDays: 8 });
  let release;
  const holding = Promise.withResolvers();
  const holder = withLifecycleLock(directory, () => new Promise(resolve => {
    release = resolve;
    holding.resolve();
  }));
  await holding.promise;
  try {
    const result = await run();
    assert.deepEqual(result.removed, []);
    assert.equal(reasonOf(result, 'busy'), 'lock-held');
    assert.ok(existsSync(directory));
  } finally {
    release();
    await holder;
  }
  assert.deepEqual((await run()).removed.map(nameOf), ['busy']);
});

test('正在启动、尚未发布看管进程身份的实例不回收', () => {
  const base = { idleMs: 9 * DAY_MS, olderThanMs: 3 * DAY_MS, liveRecorded: [], referencing: [], now };
  const starting = { state: 'starting', startedAt: now - 1000 };
  assert.deepEqual(judgeInstancePrune({ ...base, session: starting }), { prune: false, reason: 'starting' });
  const stale = { state: 'starting', startedAt: now - SUPERVISOR_HANDOFF_MS - 1 };
  assert.deepEqual(judgeInstancePrune({ ...base, session: stale }), { prune: true, reason: 'stopped-idle' });
  assert.deepEqual(judgeInstancePrune({ ...base, session: null }), { prune: true, reason: 'stopped-idle' });
});

test('回收前把 artifacts 移到 _artifacts 归档，实例其余数据全部删除', async () => {
  const directory = fixtureInstance('evidence', { idleDays: 5, artifacts: ['1-shot.png', '2-snapshot.json'] });
  const result = await run();
  const archive = result.removed[0].artifacts;
  assert.equal(archive, join(root, '_artifacts', 'evidence-2026-11-19'));
  assert.deepEqual(readdirSync(archive).sort(), ['1-shot.png', '2-snapshot.json']);
  assert.ok(!existsSync(directory));
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith('evidence')), []);
  assert.deepEqual(listInstanceNames(root), [], '_artifacts 不是实例');
  assert.equal(archiveEntryName('a', '2026-11-19', new Set(['a-2026-11-19', 'a-2026-11-19-2'])), 'a-2026-11-19-3');
  // 同一天再回收同名实例不覆盖已有归档。
  fixtureInstance('evidence', { idleDays: 5, artifacts: ['3-shot.png'] });
  const again = (await run()).removed[0].artifacts;
  assert.equal(again, join(root, '_artifacts', 'evidence-2026-11-19-2'));
  assert.deepEqual(readdirSync(archive).sort(), ['1-shot.png', '2-snapshot.json']);
});

test('没有 artifacts 的实例不创建归档目录', async () => {
  fixtureInstance('bare', { idleDays: 5 });
  const result = await run();
  assert.equal(result.removed[0].artifacts, null);
  assert.ok(!existsSync(join(root, '_artifacts')));
});

test('归档超过 30 天后清理，新归档与刚归档的保留', async () => {
  const archive = join(root, '_artifacts');
  for (const [name, age] of [['expired-2026-10-01', 40], ['kept-2026-11-01', 18]]) {
    mkdirSync(join(archive, name), { recursive: true });
    writeFileSync(join(archive, name, 'shot.png'), 'x');
    touch(join(archive, name), daysAgo(age));
  }
  fixtureInstance('fresh', { idleDays: 5, artifacts: ['a.png'] });
  const result = await run();
  assert.deepEqual(result.expiredArtifacts, ['expired-2026-10-01']);
  assert.deepEqual(readdirSync(archive).sort(), ['fresh-2026-11-19', 'kept-2026-11-01']);
  assert.ok(isArchiveExpired({ mtimeMs: daysAgo(31), now }));
  assert.ok(!isArchiveExpired({ mtimeMs: daysAgo(29), now }));
});

test('清理无主的锁文件：保留共享构建锁、有实例目录的、近期的和有人持锁的', async () => {
  const ancient = daysAgo(20);
  const lockFile = name => {
    writeFileSync(join(root, `${name}.lock.sqlite`), '');
    touch(join(root, `${name}.lock.sqlite`), ancient);
  };
  for (const name of ['ghost', 'build', 'held']) lockFile(name);
  fixtureInstance('alive', { idleDays: 1 });
  touch(`${join(root, 'alive')}.lock.sqlite`, ancient);
  writeFileSync(join(root, 'brand-new.lock.sqlite'), '');
  touch(join(root, 'brand-new.lock.sqlite'), now - 60_000);
  let release;
  const holding = Promise.withResolvers();
  const holder = withLifecycleLock(join(root, 'held'), () => new Promise(resolve => {
    release = resolve;
    holding.resolve();
  }));
  await holding.promise;
  try {
    const result = await run();
    assert.deepEqual(result.staleLocks, ['ghost']);
    assert.ok(!existsSync(join(root, 'ghost.lock.sqlite')));
    for (const kept of ['build', 'alive', 'brand-new', 'held']) assert.ok(existsSync(join(root, `${kept}.lock.sqlite`)), kept);
  } finally {
    release();
    await holder;
  }
  assert.ok(!isOrphanLockStale({ name: 'build', hasInstanceDirectory: false, mtimeMs: ancient, now }));
});

test('dry-run 只报告将要做的事，不删除任何文件', async () => {
  const directory = fixtureInstance('would-go', { idleDays: 6, artifacts: ['a.png'] });
  writeFileSync(join(root, 'ghost.lock.sqlite'), '');
  touch(join(root, 'ghost.lock.sqlite'), daysAgo(30));
  mkdirSync(join(root, '_artifacts', 'stale-2026-09-01'), { recursive: true });
  touch(join(root, '_artifacts', 'stale-2026-09-01'), daysAgo(60));
  const result = await run({ dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.removed.map(nameOf), ['would-go']);
  assert.deepEqual(result.staleLocks, ['ghost']);
  assert.deepEqual(result.expiredArtifacts, ['stale-2026-09-01']);
  assert.ok(existsSync(join(directory, 'artifacts', 'a.png')));
  assert.ok(existsSync(join(root, 'ghost.lock.sqlite')));
  assert.ok(existsSync(join(root, '_artifacts', 'stale-2026-09-01')));
  assert.ok(!existsSync(join(root, '_artifacts', 'would-go-2026-11-19')));
});

test('--older-than 可调；0 天时仍只删已停止的实例', async () => {
  fixtureInstance('two-days', { idleDays: 2 });
  fixtureInstance('live', { idleDays: 0.01, state: 'ready', session: { supervisor: livingIdentity() } });
  assert.deepEqual((await run({ olderThanDays: 7 })).removed, []);
  const result = await run({ olderThanDays: 0 });
  assert.deepEqual(result.removed.map(nameOf), ['two-days']);
  assert.equal(reasonOf(result, 'live'), 'running');
});

test('up 的自动回收跳过正在启动的目标实例，且回收出错不会让 up 失败', async () => {
  const target = fixtureInstance('target', { idleDays: 30 });
  fixtureInstance('stale', { idleDays: 30 });
  const summary = await pruneBeforeUp('target', { root, now });
  assert.deepEqual(summary.removed, ['stale']);
  assert.equal(summary.expiredArtifacts, 0);
  assert.ok(existsSync(target), '目标实例即使很旧也不回收');
  assert.equal(await pruneBeforeUp('target', { root, now }), undefined, '没有变化时 up 的输出保持原样');
  const unread = await pruneBeforeUp('target', { root, now, readTable: () => { throw new Error('ps 不可用'); } });
  assert.equal(unread, undefined, '没有候选时不读进程表');
  fixtureInstance('stale-2', { idleDays: 30 });
  const broken = await pruneBeforeUp('target', { root, now, readTable: () => { throw new Error('ps 不可用'); } });
  assert.match(broken.errors[0].message, /ps 不可用/);
  assert.ok(existsSync(join(root, 'stale-2')), '无法确认进程状态时保留实例');
});

test('实例根目录不存在时回收什么也不做', async () => {
  const missing = join(root, 'never-created');
  const result = await pruneProbeInstances({ root: missing, now });
  assert.deepEqual([result.removed, result.kept, result.staleLocks, result.expiredArtifacts], [[], [], [], []]);
  assert.ok(!existsSync(missing));
});

test('prune 命令参数：--older-than 与 --dry-run，不接受 --name', () => {
  const parsed = parseProbeArgs(['prune', '--older-than', '7', '--dry-run']);
  assert.equal(parsed.command, 'prune');
  assert.equal(parsed.values['older-than'], '7');
  assert.equal(parsed.values['dry-run'], true);
  assert.equal(parsed.values.name, undefined);
  assert.throws(() => parseProbeArgs(['prune', '--name', 'x']), { code: 'USAGE' });
  assert.throws(() => parseProbeArgs(['prune', '--dry-runn']), { code: 'USAGE', hint: /--dry-run/ });
  assert.equal(instanceRoot('default').endsWith('/default'), true);
  assert.throws(() => instanceRoot('_artifacts'), { code: 'USAGE' });
});
