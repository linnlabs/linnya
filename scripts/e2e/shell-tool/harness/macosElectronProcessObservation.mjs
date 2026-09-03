import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readMacosProcessInstance } from './productionAgentProcessTree.mjs';

const execFileAsync = promisify(execFile);

export async function readMacosDescendantInstances(rootPid) {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=']);
  const records = stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/u);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]) }] : [];
  });
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (record.parentPid !== rootPid && !descendants.has(record.parentPid)) continue;
      if (descendants.has(record.pid)) continue;
      descendants.add(record.pid);
      changed = true;
    }
  }
  const instances = await Promise.all(Array.from(descendants, readMacosProcessInstance));
  return Object.freeze(instances.filter(Boolean));
}

export async function isSameMacosProcessInstanceAlive(instance) {
  const current = await readMacosProcessInstance(instance.pid);
  return current?.startedAt === instance.startedAt && current.command === instance.command;
}

/** LaunchServices 是 Dock/App 身份的权威来源；普通 CLI 进程不应出现在结果中。 */
export async function readMacosLaunchServicesApplicationRecords() {
  const { stdout } = await execFileAsync('/usr/bin/lsappinfo', ['list']);
  const records = new Map();
  for (const block of stdout.split(/(?=^\s*\d+\)\s)/mu)) {
    const pidMatch = block.match(/\bpid\s*=\s*(\d+)/u);
    if (!pidMatch) continue;
    const typeMatch = block.match(/\btype="([^"]+)"/u);
    const bundleIdMatch = block.match(/\bbundleID="([^"]+)"/u);
    const pid = Number(pidMatch[1]);
    records.set(pid, Object.freeze({
      pid,
      type: typeMatch?.[1] ?? 'unknown',
      bundleId: bundleIdMatch?.[1] ?? null,
    }));
  }
  return records;
}
