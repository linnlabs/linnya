import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAY_MS, DEFAULT_PRUNE_DAYS, isOrphanLockStale, judgeInstancePrune, lastUsedAt,
  processesReferencingRoot, recordedProcesses,
} from '../functions/instancePrunePolicy.mjs';
import { archiveInstanceArtifacts, directoryBytes, expireArchivedArtifacts } from '../infrastructure/instanceArchive.mjs';
import {
  instancesRoot, isInstanceName, listInstanceNames, readSession, withLifecycleLock,
} from '../infrastructure/instanceStore.mjs';
import { readProcessTable, sameProcess } from '../infrastructure/processTree.mjs';

const days = ms => Math.round((ms / DAY_MS) * 10) / 10;

function readSessionOrNull(directory) {
  try {
    return readSession(directory);
  } catch {
    // session.json 总是原子写入；读不出来时按“没有登记进程”处理，仍由命令行归属检查兜底。
    return null;
  }
}

function idleMsOf(directory, session, now) {
  return now - lastUsedAt({
    lastUsedMtimeMs: statSync(join(directory, 'last-used'), { throwIfNoEntry: false })?.mtimeMs,
    session,
    directoryMtimeMs: statSync(directory).mtimeMs,
  });
}

function removeLockFiles(directory) {
  for (const suffix of ['.lock.sqlite', '.lock.sqlite-journal']) rmSync(`${directory}${suffix}`, { force: true });
}

/** 一个已超过闲置期的候选实例：取得生命周期锁后再核对进程，确认已停止才回收。 */
async function pruneCandidate(name, context) {
  const directory = join(context.root, name);
  try {
    return await withLifecycleLock(directory, async () => {
      const session = readSessionOrNull(directory);
      const idleMs = idleMsOf(directory, session, context.now);
      // 进程表在持锁后读取：此时没有人能启动或停止这个实例，登记的身份与实际进程一致。
      const table = context.readTable();
      const verdict = judgeInstancePrune({
        idleMs, olderThanMs: context.olderThanMs, session, now: context.now,
        liveRecorded: recordedProcesses(session).filter(entry => sameProcess(entry, table)),
        referencing: processesReferencingRoot(table, directory, process.pid),
      });
      if (!verdict.prune) return { kept: { name, reason: verdict.reason, idleDays: days(idleMs) } };
      const bytes = directoryBytes(directory);
      if (context.dryRun) return { removed: { name, idleDays: days(idleMs), bytes, artifacts: null } };
      // 先保留证据再删除；归档失败就不删这个实例，截图丢了比多占一点磁盘更糟。
      const artifacts = archiveInstanceArtifacts(context.root, name, directory, context.now);
      rmSync(directory, { recursive: true, force: true });
      removeLockFiles(directory);
      return { removed: { name, idleDays: days(idleMs), bytes, artifacts } };
    }, { timeoutMs: 0 });
  } catch (error) {
    if (error.code === 'BUSY') {
      return { kept: { name, reason: 'lock-held', idleDays: days(idleMsOf(directory, readSessionOrNull(directory), context.now)) } };
    }
    return { error: { name, message: error.message } };
  }
}

async function pruneInstances(context) {
  const outcome = { removed: [], kept: [], errors: [] };
  for (const name of listInstanceNames(context.root)) {
    const directory = join(context.root, name);
    let result;
    try {
      const idleMs = idleMsOf(directory, readSessionOrNull(directory), context.now);
      if (context.exclude.has(name)) result = { kept: { name, reason: 'target', idleDays: days(idleMs) } };
      // 没超过闲置期的实例不取锁、不读进程表：日常使用中的实例不会被这条路径碰到。
      else if (idleMs <= context.olderThanMs) result = { kept: { name, reason: 'recent', idleDays: days(idleMs) } };
      else result = await pruneCandidate(name, context);
    } catch (error) {
      // 目录在扫描途中被别的命令删除，等同于已经不存在。
      if (error.code === 'ENOENT') continue;
      result = { error: { name, message: error.message } };
    }
    if (result.removed) outcome.removed.push(result.removed);
    if (result.kept) outcome.kept.push(result.kept);
    if (result.error) outcome.errors.push(result.error);
  }
  return outcome;
}

/** 没有实例目录、也没人持锁的 `*.lock.sqlite`（例如 `stop --clean` 之后留下的）。 */
async function pruneOrphanLocks(context) {
  const staleLocks = [];
  const errors = [];
  for (const entry of readdirSync(context.root, { withFileTypes: true })) {
    const name = /^(.+)\.lock\.sqlite$/.exec(entry.name)?.[1];
    if (!name || !entry.isFile() || !isInstanceName(name)) continue;
    const path = join(context.root, entry.name);
    const mtimeMs = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
    if (mtimeMs === undefined || !isOrphanLockStale({
      name, hasInstanceDirectory: existsSync(join(context.root, name)), mtimeMs, now: context.now,
    })) continue;
    try {
      // 取得锁说明没有持锁者；持锁时删除文件会让后来者在新文件上再次加锁，所以先持锁再删。
      await withLifecycleLock(join(context.root, name), async () => {
        if (!context.dryRun) rmSync(path, { force: true });
      }, { timeoutMs: 0 });
      staleLocks.push(name);
    } catch (error) {
      if (error.code !== 'BUSY') errors.push({ name, message: error.message });
    }
  }
  return { staleLocks, errors };
}

/**
 * 回收当前 worktree 的探针实例：已停止、闲置超过 `olderThanDays` 的实例整体删除，
 * 删除前把 artifacts 归档到 `_artifacts/`；归档超过 30 天的清理；清掉无主的锁文件。
 * 运行中、持锁、命令行仍指向实例目录的实例一律保留。`dryRun` 只报告不改动。
 */
export async function pruneProbeInstances({
  root = instancesRoot, olderThanDays = DEFAULT_PRUNE_DAYS, dryRun = false, exclude = [],
  now = Date.now(), readTable = readProcessTable,
} = {}) {
  const result = {
    dryRun, root, olderThanDays, removed: [], kept: [], expiredArtifacts: [], staleLocks: [], reclaimedBytes: 0, errors: [],
  };
  if (!existsSync(root)) return result;
  const context = { root, olderThanMs: olderThanDays * DAY_MS, dryRun, exclude: new Set(exclude), now, readTable };
  result.expiredArtifacts = expireArchivedArtifacts(root, now, { apply: !dryRun });
  const instances = await pruneInstances(context);
  const locks = await pruneOrphanLocks(context);
  result.removed = instances.removed;
  result.kept = instances.kept;
  result.staleLocks = locks.staleLocks;
  result.errors = [...instances.errors, ...locks.errors];
  result.reclaimedBytes = instances.removed.reduce((total, entry) => total + entry.bytes, 0);
  return result;
}

/**
 * `probe up` 开头顺带回收：不能因为回收出问题而让 `up` 失败，也不动正在启动的这个实例。
 * 没有任何变化时返回 undefined，`up` 的输出保持原样。
 */
export async function pruneBeforeUp(name, options = {}) {
  try {
    const result = await pruneProbeInstances({ exclude: [name], ...options });
    if (!result.removed.length && !result.expiredArtifacts.length && !result.staleLocks.length && !result.errors.length) {
      return undefined;
    }
    return {
      removed: result.removed.map(entry => entry.name),
      reclaimedBytes: result.reclaimedBytes,
      expiredArtifacts: result.expiredArtifacts.length,
      staleLocks: result.staleLocks.length,
      ...(result.errors.length && { errors: result.errors }),
    };
  } catch (error) {
    return { errors: [{ message: error.message }] };
  }
}
