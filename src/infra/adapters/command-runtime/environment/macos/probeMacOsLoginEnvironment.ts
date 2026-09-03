import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type {
  LaunchOwnedPipeProcess,
  OwnedPipeProcess,
} from '../../../../../shared/process-runtime';
import { createMacOsProcessGroupOwnedPipeProcess } from '../../../local-process-runtime/macos';
import type {
  InternalHelperEnvironment,
  UserLoginEnvironmentCandidate,
} from '../definitions';
import { createUserLoginEnvironmentCandidate } from '../functions';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const PROBE_RUNTIME_ENTRY_NAMES = new Set(['_', 'OLDPWD', 'PWD', 'SHLVL']);

export type MacOsLoginEnvironmentProbeFailure =
  | 'launch_failed'
  | 'timed_out'
  | 'nonzero_exit'
  | 'output_limit_exceeded'
  | 'protocol_invalid'
  | 'stream_failed'
  | 'cleanup_failed';

export type MacOsLoginEnvironmentProbeResult =
  | {
      readonly status: 'succeeded';
      readonly candidate: UserLoginEnvironmentCandidate;
      readonly variableCount: number;
    }
  | {
      readonly status: 'failed';
      readonly reason: MacOsLoginEnvironmentProbeFailure;
    };

function quoteZsh(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function createProbeCommand(startMarker: string, endMarker: string): string {
  return [
    `builtin printf '%s\\0' ${quoteZsh(startMarker)}`,
    '/usr/bin/env -0',
    'linnya_probe_exit=$?',
    `builtin printf '%s\\0' ${quoteZsh(endMarker)}`,
    'exit $linnya_probe_exit',
  ].join('; ');
}

async function collectBounded(stream: Readable): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let exceeded = false;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteLength += chunk.byteLength;
    if (byteLength > MAX_STDOUT_BYTES) {
      // 超限后仍消费 pipe，不能因测试协议过大反向阻塞或改变 profile 的退出事实。
      exceeded = true;
      continue;
    }
    if (!exceeded) chunks.push(chunk);
  }
  return exceeded ? undefined : Buffer.concat(chunks, byteLength);
}

export function parseMacOsLoginEnvironmentProbeOutput(
  stdout: Buffer,
  startMarker: string,
  endMarker: string,
): UserLoginEnvironmentCandidate | undefined {
  const startFrame = Buffer.from(`${startMarker}\0`);
  const endFrame = Buffer.from(`${endMarker}\0`);
  const start = stdout.indexOf(startFrame);
  if (start < 0) return undefined;
  const bodyStart = start + startFrame.byteLength;
  const end = stdout.indexOf(endFrame, bodyStart);
  if (end < bodyStart) return undefined;

  const entries = new Map<string, string>();
  const body = stdout.subarray(bodyStart, end).toString('utf8');
  for (const record of body.split('\0')) {
    if (record.length === 0) continue;
    const separator = record.indexOf('=');
    if (separator <= 0) return undefined;
    const name = record.slice(0, separator);
    if (entries.has(name)) return undefined;
    entries.set(name, record.slice(separator + 1));
  }
  return createUserLoginEnvironmentCandidate({
    source: 'macos_login_shell',
    entries: Object.fromEntries(entries),
  });
}

function projectLoginCandidate(input: {
  readonly parsed: UserLoginEnvironmentCandidate;
  readonly helperEnvironment: InternalHelperEnvironment;
}): UserLoginEnvironmentCandidate {
  const entries = new Map<string, string>();
  for (const [name, value] of Object.entries(input.parsed.entries)) {
    if (PROBE_RUNTIME_ENTRY_NAMES.has(name)) continue;
    // 与 helper 种子完全相同的项属于探针启动条件，不是 profile 产生的登录环境差异。
    if (input.helperEnvironment.entries[name] === value) continue;
    entries.set(name, value);
  }
  return createUserLoginEnvironmentCandidate({
    source: 'macos_login_shell',
    entries: Object.fromEntries(entries),
  });
}

export async function probeMacOsLoginEnvironment(input: {
  readonly helperEnvironment: InternalHelperEnvironment;
  readonly launchOwnedPipeProcess?: LaunchOwnedPipeProcess;
  readonly timeoutMs?: number;
}): Promise<MacOsLoginEnvironmentProbeResult> {
  const token = randomUUID().split('-').join('');
  const startMarker = `LINNYA_LOGIN_ENV_START_${token}`;
  const endMarker = `LINNYA_LOGIN_ENV_END_${token}`;
  const abortController = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  let ownedProcess: OwnedPipeProcess;
  try {
    ownedProcess = await (
      input.launchOwnedPipeProcess ?? createMacOsProcessGroupOwnedPipeProcess
    )({
      executablePath: '/bin/zsh',
      argv: ['-ilc', createProbeCommand(startMarker, endMarker)],
      cwd: '/',
      environment: input.helperEnvironment.entries,
    }, { abortSignal: abortController.signal });
  } catch {
    clearTimeout(timer);
    return Object.freeze({
      status: 'failed',
      reason: abortController.signal.aborted ? 'timed_out' : 'launch_failed',
    });
  }

  // profile stderr 只用于判定 child 是否正常退出，不得进入日志、命令输出或异常正文。
  ownedProcess.stderr.resume();
  let stdout: Buffer | undefined;
  let streamFailed = false;
  try {
    stdout = await collectBounded(ownedProcess.stdout);
  } catch {
    streamFailed = true;
  }
  const rootExit = await ownedProcess.rootExit;
  clearTimeout(timer);
  const [treeCleanup, resourceRelease] = await Promise.all([
    ownedProcess.treeEmpty,
    ownedProcess.release(),
  ]);
  if (treeCleanup.status === 'failed' || resourceRelease.status === 'failed') {
    return Object.freeze({ status: 'failed', reason: 'cleanup_failed' });
  }
  if (abortController.signal.aborted) {
    return Object.freeze({ status: 'failed', reason: 'timed_out' });
  }
  if (streamFailed) return Object.freeze({ status: 'failed', reason: 'stream_failed' });
  if (rootExit.exitCode !== 0) {
    return Object.freeze({ status: 'failed', reason: 'nonzero_exit' });
  }
  if (!stdout) {
    return Object.freeze({ status: 'failed', reason: 'output_limit_exceeded' });
  }
  const parsed = parseMacOsLoginEnvironmentProbeOutput(stdout, startMarker, endMarker);
  if (!parsed) return Object.freeze({ status: 'failed', reason: 'protocol_invalid' });
  const candidate = projectLoginCandidate({
    parsed,
    helperEnvironment: input.helperEnvironment,
  });
  return Object.freeze({
    status: 'succeeded',
    candidate,
    variableCount: Object.keys(candidate.entries).length,
  });
}
