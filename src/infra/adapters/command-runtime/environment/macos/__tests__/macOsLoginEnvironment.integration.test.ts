import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createHostProcessEnvironment,
  createMacOsLoginProbeHelperEnvironment,
} from '../../functions';
import { createMacOsShellEnvironmentSnapshot } from '../createMacOsShellEnvironmentSnapshot';
import {
  parseMacOsLoginEnvironmentProbeOutput,
  probeMacOsLoginEnvironment,
} from '../probeMacOsLoginEnvironment';

const describeMacOs = process.platform === 'darwin' ? describe : describe.skip;
const temporaryRoots: string[] = [];

async function createHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-login-environment-'));
  temporaryRoots.push(root);
  return root;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`登录环境探针后代 ${pid} 未在清理期限内退出`);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('macOS login environment probe protocol', () => {
  it('只解析随机标记间的 NUL 记录，并拒绝重复名称或损坏记录', () => {
    const start = `START_${randomUUID()}`;
    const end = `END_${randomUUID()}`;
    const valid = Buffer.from([
      'profile noise',
      `${start}\0PATH=/login/bin:/usr/bin\0UNICODE=中文 值\0WITH_EQUALS=a=b=c\0${end}\0`,
      'late noise',
    ].join(''));
    expect(parseMacOsLoginEnvironmentProbeOutput(valid, start, end)?.entries).toEqual({
      PATH: '/login/bin:/usr/bin',
      UNICODE: '中文 值',
      WITH_EQUALS: 'a=b=c',
    });

    const duplicate = Buffer.from(`${start}\0PATH=/one\0PATH=/two\0${end}\0`);
    expect(parseMacOsLoginEnvironmentProbeOutput(duplicate, start, end)).toBeUndefined();
    const broken = Buffer.from(`${start}\0PATH=/one\0missing-separator\0${end}\0`);
    expect(parseMacOsLoginEnvironmentProbeOutput(broken, start, end)).toBeUndefined();
  });
});

describeMacOs('macOS login environment production owner', () => {
  it('隔离 profile 噪声和 stderr，并冻结 Finder 启动环境中缺失的登录 PATH', async () => {
    const home = await createHome();
    await mkdir(path.join(home, '登录 bin'), { recursive: true });
    await writeFile(path.join(home, '.zprofile'), [
      "export LOGIN_PROFILE_VALUE='中文 登录值'",
      "export PATH=\"$HOME/登录 bin:$PATH\"",
      "builtin printf 'zprofile-noise\\0BROKEN-OUTSIDE-PROTOCOL\\0'",
      "builtin print -u2 -- 'private-profile-stderr'",
      'cd /',
    ].join('\n'), 'utf8');
    await writeFile(path.join(home, '.zshrc'), [
      "export INTERACTIVE_PROFILE_VALUE='interactive-loaded'",
      "builtin print -r -- 'zshrc-noise'",
    ].join('\n'), 'utf8');
    const host = createHostProcessEnvironment({
      HOME: home,
      USER: process.env.USER ?? 'linnya-test',
      LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'linnya-test',
      PATH: '/finder-only/bin:/usr/bin:/bin',
      TERM: 'xterm-user-startup',
      HOST_ONLY_VALUE: 'preserved-from-app-start',
      LANG: 'en_US.UTF-8',
    });

    const result = await createMacOsShellEnvironmentSnapshot({
      host,
      revision: 'app-owner-real-login-profile',
    });

    expect(result.probe.status).toBe('succeeded');
    expect(result.snapshot.source).toBe('macos_login_shell');
    expect(result.snapshot.entries.PATH).toContain(`${home}/登录 bin`);
    expect(result.snapshot.entries.LOGIN_PROFILE_VALUE).toBe('中文 登录值');
    expect(result.snapshot.entries.INTERACTIVE_PROFILE_VALUE).toBe('interactive-loaded');
    expect(result.snapshot.entries.HOST_ONLY_VALUE).toBe('preserved-from-app-start');
    expect(result.snapshot.entries.TERM).toBe('xterm-user-startup');
    expect(result.snapshot.entries).not.toHaveProperty('SHLVL');
    expect(result.snapshot.entries).not.toHaveProperty('PWD');
    expect(JSON.stringify(result)).not.toContain('private-profile-stderr');
    expect(JSON.stringify(result)).not.toContain('zprofile-noise');
  }, 10_000);

  it('profile 卡住并启动后代时在期限内停止整棵进程树', async () => {
    const home = await createHome();
    await writeFile(path.join(home, '.zshrc'), [
      'builtin print -r -- $$ > "$HOME/root.pid"',
      "/bin/sh -c 'echo $$ > \"$HOME/child.pid\"; exec /bin/sleep 30' &",
      'wait',
    ].join('\n'), 'utf8');
    const host = createHostProcessEnvironment({
      HOME: home,
      USER: process.env.USER ?? 'linnya-test',
      LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'linnya-test',
      PATH: '/usr/bin:/bin',
    });

    const startedAt = Date.now();
    const result = await probeMacOsLoginEnvironment({
      helperEnvironment: createMacOsLoginProbeHelperEnvironment(host),
      timeoutMs: 1_000,
    });

    expect(result).toEqual({ status: 'failed', reason: 'timed_out' });
    expect(Date.now() - startedAt).toBeLessThan(6_000);
    const [rootPid, childPid] = await Promise.all([
      readFile(path.join(home, 'root.pid'), 'utf8').then(value => Number(value.trim())),
      readFile(path.join(home, 'child.pid'), 'utf8').then(value => Number(value.trim())),
    ]);
    expect(Number.isSafeInteger(rootPid) && rootPid > 0).toBe(true);
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    await Promise.all([waitForProcessExit(rootPid), waitForProcessExit(childPid)]);
  }, 10_000);

  it('探针无法启动时只使用冻结 host 候选且不补造 PATH', async () => {
    const host = createHostProcessEnvironment({ HOME: '/frozen/home', ONLY: 'host' });
    const result = await createMacOsShellEnvironmentSnapshot({
      host,
      revision: 'app-owner-probe-failed',
      launchOwnedPipeProcess: async () => {
        throw new Error('fixture launch failure must not be exposed');
      },
    });

    expect(result.probe).toEqual({ status: 'failed', reason: 'launch_failed' });
    expect(result.snapshot).toEqual({
      kind: 'shell_environment_snapshot',
      revision: 'app-owner-probe-failed',
      source: 'host_process',
      entries: { HOME: '/frozen/home', ONLY: 'host' },
    });
  });
});
