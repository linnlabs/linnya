import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';

import {
  assertHeartbeatStopped,
  waitFor,
  waitForHeartbeatProgress,
} from './processObservation.mjs';

const execFileAsync = promisify(execFile);
const fixturePath = fileURLToPath(new URL(
  '../fixtures/process-trees/production-agent-process-tree.sh',
  import.meta.url,
));

export const PRODUCTION_AGENT_PROCESS_TREE_ROLES = Object.freeze([
  'parent',
  'child',
  'grandchild',
]);

export function quoteZshArgument(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function identityPath(runRoot, role) {
  return path.join(runRoot, `${role}.json`);
}

function heartbeatPath(runRoot, role) {
  return path.join(runRoot, `${role}.heartbeat.log`);
}

async function readIdentity(runRoot, runToken, role) {
  let payload;
  try {
    payload = JSON.parse(await readFile(identityPath(runRoot, role), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (
    payload?.version !== 1
    || payload.runToken !== runToken
    || payload.role !== role
    || !Number.isSafeInteger(payload.pid)
    || payload.pid <= 0
    || !Number.isSafeInteger(payload.parentPid)
    || payload.parentPid <= 0
    || payload.parentPid === payload.pid
  ) {
    throw new Error(`${role} 进程树证据的版本、身份或 PID 无效`);
  }
  return payload;
}

export function createProductionAgentProcessTreeCommand({ evidenceDirectoryName, runToken }) {
  if (!/^[A-Za-z0-9_-]+$/u.test(evidenceDirectoryName)) {
    throw new Error('生产 Agent 进程树证据目录必须是安全的单层相对名称');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(runToken)) {
    throw new Error('生产 Agent 进程树 run token 只能包含字母、数字、下划线和连字符');
  }
  return [
    'mkdir',
    '-p',
    quoteZshArgument(evidenceDirectoryName),
    '&&',
    'exec',
    '/bin/sh',
    quoteZshArgument(fixturePath),
    quoteZshArgument(evidenceDirectoryName),
    quoteZshArgument(runToken),
    'parent',
  ].join(' ');
}

export async function readMacosProcessInstance(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`无法读取无效 PID：${pid}`);
  }
  let stdout;
  try {
    ({ stdout } = await execFileAsync('/bin/ps', [
      '-ww',
      '-o', 'pid=',
      '-o', 'ppid=',
      '-o', 'pgid=',
      '-o', 'lstart=',
      '-o', 'command=',
      '-p', String(pid),
    ], {
      env: { ...process.env, LC_ALL: 'C' },
    }));
  } catch (error) {
    if (error?.code === 1) return undefined;
    throw error;
  }
  // BSD ps 的 lstart 是固定 24 字符。命令行单独保留，不能并入启动时间的
  // 宽松空白解析，否则同秒 PID 复用时会失去本轮随机 token 这一层身份。
  const match = stdout.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+?)\s*$/u);
  if (!match) {
    throw new Error(`无法解析 PID ${pid} 的 macOS 进程事实：${JSON.stringify(stdout)}`);
  }
  const processId = Number(match[1]);
  const parentPid = Number(match[2]);
  const processGroupId = Number(match[3]);
  const startedAt = match[4].replace(/\s+/gu, ' ').trim();
  const command = match[5].trim();
  if (
    processId !== pid
    || !Number.isSafeInteger(parentPid)
    || parentPid < 0
    || !Number.isSafeInteger(processGroupId)
    || processGroupId <= 0
    || startedAt.length === 0
    || command.length === 0
  ) {
    throw new Error(`PID ${pid} 的 macOS 进程事实无效`);
  }
  return Object.freeze({ pid: processId, parentPid, processGroupId, startedAt, command });
}

export function isMacosProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function isSameMacosProcessInstanceAlive(instance) {
  const current = await readMacosProcessInstance(instance.pid);
  return current?.startedAt === instance.startedAt
    && current.command === instance.command;
}

export async function observeMacosProductionAgentProcessTree({
  runRoot,
  runToken,
  readProcessOutcome = () => undefined,
  timeoutMs = 5_000,
}) {
  if (process.platform !== 'darwin') {
    throw new Error('生产 Agent 进程树外部验真当前只支持 macOS');
  }
  const identities = await Promise.all(PRODUCTION_AGENT_PROCESS_TREE_ROLES.map(role => (
    waitFor(`${role} 发布进程身份`, async () => {
      const identity = await readIdentity(runRoot, runToken, role);
      if (identity) return identity;
      const outcome = readProcessOutcome();
      if (outcome) {
        throw new Error(`${role} 发布身份前命令已经结束：${outcome.kind ?? 'unknown'}`);
      }
      return undefined;
    }, timeoutMs)
  )));

  const [parent, child, grandchild] = identities;
  assert.equal(child.parentPid, parent.pid, 'child 必须由本轮 parent 直接创建');
  assert.equal(grandchild.parentPid, child.pid, 'grandchild 必须由本轮 child 直接创建');

  const instances = await Promise.all(identities.map(async identity => {
    const processInstance = await readMacosProcessInstance(identity.pid);
    if (!processInstance) {
      throw new Error(`${identity.role} 在冻结启动身份前退出`);
    }
    assert.equal(
      processInstance.parentPid,
      identity.parentPid,
      `${identity.role} 的操作系统父进程事实与 fixture 证据不一致`,
    );
    assert(
      processInstance.command.includes(fixturePath)
        && processInstance.command.includes(runToken)
        && processInstance.command.endsWith(` ${identity.role}`),
      `${identity.role} 的操作系统命令身份不属于本轮 fixture`,
    );
    await waitForHeartbeatProgress({
      heartbeatPath: heartbeatPath(runRoot, identity.role),
      expectedRunToken: runToken,
      expectedRole: identity.role,
      expectedPid: identity.pid,
    });
    return Object.freeze({
      ...processInstance,
      role: identity.role,
      heartbeatPath: heartbeatPath(runRoot, identity.role),
    });
  }));
  const processGroupIds = new Set(instances.map(instance => instance.processGroupId));
  assert.equal(processGroupIds.size, 1, 'parent/child/grandchild 必须属于同一个冻结进程组');
  const [processGroupId] = processGroupIds;
  const hostInstance = await readMacosProcessInstance(process.pid);
  assert(hostInstance, '无法读取外部测试 controller 的进程事实');
  assert.notEqual(processGroupId, hostInstance.processGroupId, '业务进程树不得与测试 controller 共用进程组');

  return Object.freeze({
    version: 1,
    runToken,
    processGroupId,
    instances: Object.freeze(instances),
  });
}

export async function assertMacosProductionAgentProcessTreeExited(
  observation,
  {
    timeoutMs = 5_000,
    heartbeatQuietMs = 200,
    verifyHeartbeatStopped = true,
  } = {},
) {
  await waitFor('生产 Agent 父子孙原始进程实例和进程组全部退出', async () => {
    const instanceAlive = await Promise.all(
      observation.instances.map(isSameMacosProcessInstanceAlive),
    );
    return instanceAlive.every(alive => !alive)
      && !isMacosProcessGroupAlive(observation.processGroupId);
  }, timeoutMs);
  if (verifyHeartbeatStopped) {
    await Promise.all(observation.instances.map(instance => assertHeartbeatStopped({
      heartbeatPath: instance.heartbeatPath,
      expectedRunToken: observation.runToken,
      expectedRole: instance.role,
      expectedPid: instance.pid,
      quietMs: heartbeatQuietMs,
    })));
  }
  return Object.freeze({
    processGroupId: observation.processGroupId,
    exitedProcessCount: observation.instances.length,
  });
}
