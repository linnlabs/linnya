import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeTransientFetchError, NETWORK_FAILURE_MARKER } from '../functions/transientNetworkFailure.cjs';
import { retryTransientNetwork, runRegistryCommand } from './retryTransientNetwork.cjs';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

/** 前 failures 次请求直接断开连接（真实的传输错误），之后按 respond 应答。 */
async function flakyServer(failures: number, respond: (response: import('node:http').ServerResponse) => void): Promise<{ url: string; requests: () => number }> {
  let requests = 0;
  const server: Server = createServer((request, response) => {
    requests += 1;
    if (requests <= failures) {
      request.socket.destroy();
      return;
    }
    respond(response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/archive`, requests: () => requests };
}

function download(url: string, waits: number[]) {
  return retryTransientNetwork({
    label: '下载测试归档',
    describeTransient: describeTransientFetchError,
    wait: async ms => {
      waits.push(ms);
    },
    attempt: async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer()).toString('utf8');
    },
  });
}

describe('下载重试', () => {
  it('连接被断开两次后第三次成功：间隔递增，拿到完整内容', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const server = await flakyServer(2, response => response.end('archive-bytes'));
    const waits: number[] = [];

    await expect(download(server.url, waits)).resolves.toBe('archive-bytes');
    expect(server.requests()).toBe(3);
    expect(waits).toEqual([5_000, 15_000]);
  });

  it('HTTP 错误不重试，原样失败', async () => {
    const server = await flakyServer(0, response => {
      response.statusCode = 404;
      response.end();
    });
    const waits: number[] = [];

    await expect(download(server.url, waits)).rejects.toThrow('HTTP 404');
    expect(server.requests()).toBe(1);
    expect(waits).toEqual([]);
  });

  it('一直断线：重试两次后给出网络失败的结论，日志里留下网络失败标记', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const server = await flakyServer(Number.POSITIVE_INFINITY, () => {});

    const failure = await download(server.url, []).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/^下载测试归档：网络失败，重试 2 次后仍失败（.+）$/u);
    expect(server.requests()).toBe(3);
    const written = stderr.mock.calls.map(call => String(call[0])).join('');
    expect(written).toContain(`${NETWORK_FAILURE_MARKER} 下载测试归档：重试 2 次后仍失败`);
  });
});

describe('registry 命令重试', () => {
  function scratch(): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'registry-retry-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
  }

  /** 模拟 npm audit：前 failures 次打印给定输出并以 1 退出，之后通过。 */
  function fakeAudit(directory: string, failures: number, output: string): { command: string; args: string[] } {
    const script = path.join(directory, 'fake-audit.cjs');
    writeFileSync(
      script,
      `const fs = require('node:fs');
const counter = ${JSON.stringify(path.join(directory, 'count'))};
const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
fs.writeFileSync(counter, String(count));
if (count <= ${failures}) { process.stderr.write(${JSON.stringify(output)}); process.exit(1); }
process.stdout.write('found 0 vulnerabilities\\n');
`
    );
    return { command: process.execPath, args: [script] };
  }

  it('审计接口 TLS 握手中断（真实日志原文）按网络问题重试，随后通过', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const directory = scratch();
    const transportFailure = [
      'npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: Client network socket disconnected before secure TLS connection was established',
      'npm error audit endpoint returned an error',
      '',
    ].join('\n');
    const waits: number[] = [];

    await runRegistryCommand({ label: 'npm 审计生产依赖', cwd: directory, ...fakeAudit(directory, 1, transportFailure), wait: async ms => void waits.push(ms) });
    expect(waits).toEqual([5_000]);
  });

  it('审计查出漏洞不重试，失败结论指向上方输出', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const directory = scratch();
    const report = '# npm audit report\n\nexample  <1.2.3\nSeverity: high\n\n1 high severity vulnerability\n';
    const waits: number[] = [];

    await expect(
      runRegistryCommand({ label: 'npm 审计生产依赖', cwd: directory, ...fakeAudit(directory, 5, report), wait: async ms => void waits.push(ms) })
    ).rejects.toThrow('npm 审计生产依赖 未通过（退出码 1），原因见上方输出');
    expect(waits).toEqual([]);
  });

  it('证书错误不是临时故障，不重试', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const directory = scratch();
    const certificate = 'npm error request to https://registry.npmjs.org/zod failed, reason: unable to get local issuer certificate\n';
    const waits: number[] = [];

    await expect(
      runRegistryCommand({ label: 'npm 解析生产 package lock', cwd: directory, ...fakeAudit(directory, 5, certificate), wait: async ms => void waits.push(ms) })
    ).rejects.toThrow('未通过');
    expect(waits).toEqual([]);
  });
});
