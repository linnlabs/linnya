import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { downloadVerifiedArtifact } from './downloadVerifiedArtifact';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function destination(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-download-'));
  roots.push(root);
  return path.join(root, 'artifact.zip');
}

const sha512 = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('hex');
const URL_ = 'https://download.linnya.com/plugins/sample/sample-1.0.0.zip';

/** 按给定分块交付；onPull 在交付第 index 块前调用，可用于中途取消或注入错误。 */
function chunkedResponse(
  chunks: readonly Uint8Array[],
  options: { readonly headers?: Record<string, string>; readonly onPull?: (index: number) => void; readonly failAt?: number } = {},
): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      options.onPull?.(index);
      if (options.failAt === index) {
        controller.error(new TypeError('terminated'));
        return;
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Response(body, { headers: options.headers });
}

function bytes(length: number, fill = 7): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

function fetchReturning(response: Response | (() => Response), seen: { calls: number; init?: RequestInit } = { calls: 0 }) {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.calls += 1;
    seen.init = init;
    return typeof response === 'function' ? response() : response;
  }) as typeof fetch;
}

describe('流式下载与校验', () => {
  it('边下边算摘要并落盘；进度按时间节流，最后一次等于总字节数；拒绝重定向', async () => {
    const chunks = [bytes(1000, 1), bytes(1000, 2), bytes(500, 3)];
    const all = Buffer.concat(chunks);
    const target = destination();
    const progress: number[] = [];
    const clock = [0, 50, 150];
    const seen = { calls: 0 } as { calls: number; init?: RequestInit };
    const result = await downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse(chunks), seen),
      url: URL_, destinationPath: target, label: '插件包',
      expectedSha512: sha512(all), expectedSize: all.byteLength,
      onProgress: received => progress.push(received), now: () => clock.shift() ?? 999,
    });
    expect(result).toEqual({ sha512: sha512(all), size: 2500 });
    expect(fs.readFileSync(target).equals(all)).toBe(true);
    // 0ms 报 1000；50ms 不报；150ms 报 2500；结束时再报一次最终值。
    expect(progress).toEqual([1000, 2500, 2500]);
    expect(seen.init?.redirect).toBe('error');
  });

  it('字节数恰好等于声明大小通过；多一个字节立即中止并删除部分文件', async () => {
    const exact = bytes(4096);
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse([exact])), url: URL_, destinationPath: destination(), label: '插件包',
      expectedSha512: sha512(exact), expectedSize: 4096,
    })).resolves.toMatchObject({ size: 4096 });

    const target = destination();
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse([bytes(4096), bytes(1)])), url: URL_, destinationPath: target, label: '插件包',
      expectedSha512: sha512(exact), expectedSize: 4096,
    })).rejects.toMatchObject({ code: 'artifact-integrity' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('Content-Length 与声明不符时不读取内容就拒绝', async () => {
    let pulls = 0;
    const response = chunkedResponse([bytes(10)], { headers: { 'content-length': '11' }, onPull: () => { pulls += 1; } });
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(response), url: URL_, destinationPath: destination(), label: '插件包',
      expectedSha512: sha512(bytes(10)), expectedSize: 10,
    })).rejects.toMatchObject({ code: 'artifact-integrity' });
    // ReadableStream 构造时会预拉一次；拒绝后不再继续读取。
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it('正常结束但比声明少、或摘要不符：判定为包体不一致，不留文件', async () => {
    for (const [chunks, expectedSha] of [
      [[bytes(99)], sha512(bytes(99))],
      [[bytes(100)], 'f'.repeat(128)],
    ] as const) {
      const target = destination();
      await expect(downloadVerifiedArtifact({
        fetch: fetchReturning(chunkedResponse(chunks)), url: URL_, destinationPath: target, label: '插件包',
        expectedSha512: expectedSha, expectedSize: 100,
      })).rejects.toMatchObject({ code: 'artifact-integrity' });
      expect(fs.existsSync(target)).toBe(false);
    }
  });

  it('服务端拒绝归为服务不可用；连接失败或中途断开归为网络中断', async () => {
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(new Response('busy', { status: 503, statusText: 'Service Unavailable' })),
      url: URL_, destinationPath: destination(), label: '插件包', expectedSha512: 'a'.repeat(128), expectedSize: 4,
    })).rejects.toMatchObject({ code: 'source-unavailable' });

    await expect(downloadVerifiedArtifact({
      fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
      url: URL_, destinationPath: destination(), label: '插件包', expectedSha512: 'a'.repeat(128), expectedSize: 4,
    })).rejects.toMatchObject({ code: 'network' });

    const target = destination();
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse([bytes(10), bytes(10)], { failAt: 1 })),
      url: URL_, destinationPath: target, label: '插件包', expectedSha512: 'a'.repeat(128), expectedSize: 20,
    })).rejects.toMatchObject({ code: 'network' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('开始前已取消不发请求；下载中取消立即停止并删除部分文件', async () => {
    const seen = { calls: 0 };
    const before = new AbortController();
    before.abort();
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse([bytes(1)]), seen), url: URL_, destinationPath: destination(), label: '插件包',
      expectedSha512: 'a'.repeat(128), signal: before.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(seen.calls).toBe(0);

    const during = new AbortController();
    const target = destination();
    const chunks = [bytes(100), bytes(100), bytes(100)];
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse(chunks, { onPull: index => { if (index === 2) during.abort(); } })),
      url: URL_, destinationPath: target, label: '插件包',
      expectedSha512: sha512(Buffer.concat(chunks)), expectedSize: 300, signal: during.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('没有声明大小的来源按 maxBytes 截止', async () => {
    const target = destination();
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse([bytes(64), bytes(65)])), url: URL_, destinationPath: target, label: '插件包',
      expectedSha512: 'a'.repeat(128), maxBytes: 128,
    })).rejects.toMatchObject({ code: 'artifact-integrity' });
    expect(fs.existsSync(target)).toBe(false);

    const ok = bytes(128);
    await expect(downloadVerifiedArtifact({
      fetch: fetchReturning(chunkedResponse([ok])), url: URL_, destinationPath: destination(), label: '插件包',
      expectedSha512: sha512(ok), maxBytes: 128,
    })).resolves.toMatchObject({ size: 128 });
  });
});
