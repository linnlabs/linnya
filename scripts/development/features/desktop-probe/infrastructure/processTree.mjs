import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export function readProcessTable() {
  const rows = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,lstart=,command='], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
  });
  const table = new Map();
  for (const line of rows.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    if (!match) continue;
    const [, pid, parent, group, startedAt, command] = match;
    table.set(Number(pid), { pid: Number(pid), parent: Number(parent), group: Number(group), startedAt, command });
  }
  return table;
}

export function sameProcess(expected, table) {
  if (!expected) return false;
  const actual = (table ?? readProcessTable()).get(expected.pid);
  return Boolean(actual && actual.startedAt === expected.startedAt && actual.command === expected.command);
}

export function observeTree(root, table = readProcessTable()) {
  const owned = new Map();
  if (!sameProcess(root, table)) return owned;
  owned.set(root.pid, root);
  for (const entry of owned.values()) {
    for (const process of table.values()) {
      if (process.parent === entry.pid) owned.set(process.pid, process);
    }
  }
  return owned;
}

export function readDescendantIdentities(pid) {
  const table = readProcessTable();
  const owned = observeTree(table.get(pid), table);
  owned.delete(pid);
  return [...owned.values()];
}

export async function waitForObservedExit(instances, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  let remaining = instances;
  while (remaining.length) {
    const table = readProcessTable();
    remaining = remaining.filter(entry => sameProcess(entry, table));
    if (!remaining.length || Date.now() >= end) break;
    await sleep(60);
  }
  return remaining;
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export function signalOwner(owner, signal) {
  if (sameProcess(owner)) sendSignal(owner.pid, signal);
}

export async function stopOwnedTree(root, observed, graceMs = 10_000) {
  const capture = () => {
    const table = readProcessTable();
    for (const [pid, entry] of observeTree(root, table)) observed.set(pid, entry);
    return [...observed.values()].filter(entry => sameProcess(entry, table));
  };
  const waitForExit = async timeout => {
    const end = Date.now() + timeout;
    let remaining = capture();
    while (remaining.length && Date.now() < end) {
      await sleep(60);
      remaining = capture();
    }
    return remaining;
  };

  const members = capture();
  if (members.some(entry => entry.pid === root?.pid)) {
    // 先通知 Electron owner，让它自行关闭数据库和 App Server。
    sendSignal(root.pid, 'SIGINT');
  }
  let remaining = await waitForExit(graceMs);
  for (const entry of remaining) signalOwner(entry, 'SIGTERM');
  if (remaining.length) remaining = await waitForExit(1500);
  for (const entry of remaining) signalOwner(entry, 'SIGKILL');
  if (remaining.length) remaining = await waitForExit(1500);
  return { observed: observed.size, remaining: remaining.map(entry => entry.pid) };
}
