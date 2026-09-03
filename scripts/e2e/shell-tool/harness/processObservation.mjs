import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout } from 'node:timers';

export const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

export async function waitFor(description, check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await wait(25);
  }
  throw new Error(`等待${description}超时（${timeoutMs}ms）`);
}

export async function readProcessTreeEvidence(evidencePath, expectedRunToken) {
  let raw;
  try {
    raw = await readFile(evidencePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }

  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    evidence?.version !== 1
    || evidence.runToken !== expectedRunToken
    || !Number.isSafeInteger(evidence.parentPid)
    || evidence.parentPid <= 0
    || !Number.isSafeInteger(evidence.childPid)
    || evidence.childPid <= 0
    || evidence.parentPid === evidence.childPid
  ) {
    throw new Error('父子进程证据的版本、身份或 PID 无效');
  }
  return evidence;
}

export async function waitForProcessTreeEvidence(
  evidencePath,
  expectedRunToken,
  readProcessOutcome,
  timeoutMs = 5_000,
) {
  return waitFor('父子进程发布外部证据', async () => {
    const evidence = await readProcessTreeEvidence(evidencePath, expectedRunToken);
    if (evidence) return evidence;
    const processOutcome = readProcessOutcome();
    if (processOutcome) {
      throw new Error(`父进程在发布完整证据前结束：${processOutcome.kind}`);
    }
    return undefined;
  }, timeoutMs);
}

export async function waitForProcessesExited(pids, timeoutMs = 5_000) {
  await waitFor('父子进程全部退出', () => (
    pids.every(pid => !isProcessAlive(pid))
  ), timeoutMs);
}

async function readHeartbeatEvents(heartbeatPath) {
  let raw;
  try {
    raw = await readFile(heartbeatPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return raw.trim().split('\n').filter(Boolean).map((line) => {
    const [runToken, role, rawPid, rawSequence, rawTimestamp] = line.split('\t');
    return {
      runToken,
      role,
      pid: Number(rawPid),
      sequence: Number(rawSequence),
      timestamp: Number(rawTimestamp),
    };
  });
}

export async function waitForHeartbeatProgress({
  heartbeatPath,
  expectedRunToken,
  expectedRole,
  expectedPid,
}) {
  return waitFor(`${expectedRole} 外部心跳连续增长`, async () => {
    const events = await readHeartbeatEvents(heartbeatPath);
    if (events.length < 2) return undefined;
    const valid = events.every(event => (
      event.runToken === expectedRunToken
      && event.role === expectedRole
      && event.pid === expectedPid
      && Number.isSafeInteger(event.sequence)
      && event.sequence > 0
      && Number.isSafeInteger(event.timestamp)
      && event.timestamp > 0
    ));
    if (!valid) throw new Error(`${expectedRole} 心跳身份或序号无效`);
    const previous = events.at(-2);
    const latest = events.at(-1);
    if (latest.sequence <= previous.sequence || latest.timestamp < previous.timestamp) {
      throw new Error(`${expectedRole} 心跳没有单调增长`);
    }
    return latest;
  });
}

export async function assertHeartbeatStopped({
  heartbeatPath,
  expectedRunToken,
  expectedRole,
  expectedPid,
  quietMs = 200,
}) {
  const before = await waitForHeartbeatProgress({
    heartbeatPath,
    expectedRunToken,
    expectedRole,
    expectedPid,
  });
  await wait(quietMs);
  const events = await readHeartbeatEvents(heartbeatPath);
  const after = events.at(-1);
  if (!after || after.sequence !== before.sequence) {
    throw new Error(
      `${expectedRole} 进程退出后心跳仍在增长：${before.sequence} -> ${after?.sequence ?? 'missing'}`,
    );
  }
}
