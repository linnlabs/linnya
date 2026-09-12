import { PassThrough, Writable } from 'node:stream';

import type { JsonValue } from '@app/schemas';
import { describe, expect, it } from 'vitest';

import {
  APP_SERVER_RPC_SCHEMA_VERSION,
  APP_SERVER_RPC_MAX_PENDING_REQUESTS,
  createAppServerRpcPeer,
  encodeAppServerRpcFrame,
  type AppServerRpcHandler,
} from '..';
import { createAppServerRpcWriter } from '../functions/createAppServerRpcWriter';

describe('App Server RPC peer', () => {
  it('只调用双向注册方法，未知方法稳定失败且不破坏后续请求', async () => {
    const pair = createPeerPair(
      new Map([['desktop.echo', echoHandler]]),
      new Map([['backend.echo', echoHandler]]),
    );

    await expect(pair.desktop.request('backend.echo', { from: 'desktop' }))
      .resolves.toEqual({ from: 'desktop' });
    await expect(pair.backend.request('desktop.echo', { from: 'backend' }))
      .resolves.toEqual({ from: 'backend' });
    await expect(pair.desktop.request('backend.missing', null))
      .rejects.toThrow('method_not_registered');
    await expect(pair.desktop.request('backend.echo', 'still-alive'))
      .resolves.toBe('still-alive');

    pair.dispose();
  });

  it('AbortSignal 穿过 cancel 帧终止对端 handler，peer 仍可继续工作', async () => {
    let remoteSignal: AbortSignal | null = null;
    const cancellable: AppServerRpcHandler = (_payload, context) => {
      remoteSignal = context.signal;
      return new Promise<JsonValue>(() => undefined);
    };
    const pair = createPeerPair(
      new Map(),
      new Map([
        ['backend.wait', cancellable],
        ['backend.echo', echoHandler],
      ]),
    );
    const controller = new AbortController();
    const settlement = pair.desktop.request('backend.wait', null, {
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    await waitFor(() => remoteSignal !== null);

    controller.abort();
    await expect(settlement).rejects.toThrow('已取消');
    await waitFor(() => remoteSignal?.aborted === true);
    await expect(pair.desktop.request('backend.echo', 42)).resolves.toBe(42);

    pair.dispose();
  });

  it('同步 handler 错误作为业务失败返回，不污染 transport', async () => {
    const pair = createPeerPair(
      new Map(),
      new Map([
        ['backend.fail', () => { throw new Error('fixture handler failed'); }],
        ['backend.echo', echoHandler],
      ]),
    );

    await expect(pair.desktop.request('backend.fail', null))
      .rejects.toThrow('handler_failed: fixture handler failed');
    await expect(pair.desktop.request('backend.echo', true)).resolves.toBe(true);

    pair.dispose();
  });

  it('超过原 deadline 的迟到响应结算一次，后续业务存活，但重复响应仍拒绝', async () => {
    let lateRequestId = '';
    const pair = createPeerPair(new Map(), new Map([['backend.echo', (payload, context) => {
      if (payload === 'late') lateRequestId = context.requestId;
      return payload;
    }]]));
    // 对端已写回，但接收事件循环暂时没有消费响应，模拟进程负载下的真实管道延迟。
    pair.backendToDesktop.pause();
    void pair.desktop.completed.catch(() => undefined);
    try {
      await expect(pair.desktop.request('backend.echo', 'late', { timeoutMs: 10 }))
        .rejects.toThrow('超时');
      await new Promise(resolve => setTimeout(resolve, 40));
      pair.backendToDesktop.resume();
      await new Promise(resolve => setImmediate(resolve));
      await expect(pair.desktop.request('backend.echo', 'still-alive')).resolves.toBe('still-alive');
      pair.backendToDesktop.write(encodeAppServerRpcFrame({
        schema_version: APP_SERVER_RPC_SCHEMA_VERSION, kind: 'response',
        request_id: lateRequestId, ok: true, result: 'duplicate',
      }));
      await expect(pair.desktop.completed).rejects.toThrow('没有匹配 request');
    } finally {
      pair.dispose();
    }
  });

  it('取消后仍等待 terminal 的请求占用容量，接到回复才释放，不能无界积累墓碑', async () => {
    const pair = createPeerPair(new Map(), new Map([['backend.echo', echoHandler]]));
    pair.backendToDesktop.pause();
    const controller = new AbortController();
    const requests = Array.from({ length: APP_SERVER_RPC_MAX_PENDING_REQUESTS }, (_, index) =>
      pair.desktop.request('backend.echo', index, { signal: controller.signal }));
    const settled = Promise.allSettled(requests);
    try {
      // 确保请求已经送入对端，避免把取消前队列排序与本例容量规则混为一谈。
      await new Promise(resolve => setImmediate(resolve));
      controller.abort();
      expect((await settled).every(result => result.status === 'rejected')).toBe(true);
      await expect(pair.desktop.request('backend.echo', 'over-capacity', { timeoutMs: 10 })).rejects.toThrow('容量上限');
      pair.backendToDesktop.resume();
      await new Promise(resolve => setImmediate(resolve));
      await expect(pair.desktop.request('backend.echo', 'capacity-released')).resolves.toBe('capacity-released');
    } finally {
      pair.dispose();
    }
  });

  it('尚在 writer 队列的 request 被取消时，cancel 不能越过自己的 request', async () => {
    const input = new PassThrough();
    const output = new GatedWritable();
    let nextId = 0;
    const peer = createAppServerRpcPeer({
      input, output, handlers: new Map(), requestIdFactory: { create: () => `queued-${++nextId}` },
    });
    const first = peer.request('backend.echo', 1).catch(() => undefined);
    const controller = new AbortController();
    const second = peer.request('backend.echo', 2, { signal: controller.signal });
    const cancelled = expect(second).rejects.toThrow('已取消');
    try {
      controller.abort();
      await cancelled;
      output.releaseNextWrite();
      await waitFor(() => output.pendingWriteCount === 1);
      output.releaseNextWrite();
      await waitFor(() => output.pendingWriteCount === 1);
      output.releaseNextWrite();
      expect(output.frames.map(frame => {
        const value: unknown = JSON.parse(frame);
        return value;
      })).toEqual([
        expect.objectContaining({ kind: 'request', request_id: 'queued-1' }),
        expect.objectContaining({ kind: 'request', request_id: 'queued-2' }),
        expect.objectContaining({ kind: 'cancel', request_id: 'queued-2' }),
      ]);
    } finally {
      peer.dispose();
      input.destroy();
      output.destroy();
      await first;
    }
  });

  it('不接受没有 pending request 的孤立 response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const peer = createAppServerRpcPeer({ input, output, handlers: new Map() });
    const failure = peer.completed;

    input.write(encodeAppServerRpcFrame({
      schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
      kind: 'response',
      request_id: 'orphan',
      ok: true,
      result: null,
    }));

    await expect(failure).rejects.toThrow('没有匹配 request');
  });

  it('response 写失败时 transport fail closed，不把失败伪装成 handler 结果', async () => {
    const input = new PassThrough();
    const output = new FailingWritable();
    const peer = createAppServerRpcPeer({
      input,
      output,
      handlers: new Map([['backend.echo', echoHandler]]),
    });
    const failure = peer.completed;

    input.write(encodeAppServerRpcFrame(createRequest('write-failure')));

    await expect(failure).rejects.toThrow('fixture write failed');
  });
});

describe('App Server RPC writer', () => {
  it('当前写完成后优先发送 response/cancel，不让普通 request 队列饿死控制帧', async () => {
    const output = new GatedWritable();
    const writer = createAppServerRpcWriter({
      output,
      onFailure: () => undefined,
    });
    const first = writer.write(createRequest('request-1'), 'normal');
    const second = writer.write(createRequest('request-2'), 'normal');
    const cancel = writer.write({
      schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
      kind: 'cancel',
      request_id: 'request-1',
    }, 'urgent');
    await waitFor(() => output.pendingWriteCount === 1);

    output.releaseNextWrite();
    await first;
    await waitFor(() => output.pendingWriteCount === 1);
    output.releaseNextWrite();
    await cancel;
    await waitFor(() => output.pendingWriteCount === 1);
    output.releaseNextWrite();
    await second;

    expect(output.frames.map(frame => {
      const value: unknown = JSON.parse(frame);
      return value;
    }))
      .toEqual([
        expect.objectContaining({ kind: 'request', request_id: 'request-1' }),
        expect.objectContaining({ kind: 'cancel', request_id: 'request-1' }),
        expect.objectContaining({ kind: 'request', request_id: 'request-2' }),
      ]);
  });
});

const echoHandler: AppServerRpcHandler = payload => payload;

function createPeerPair(
  desktopHandlers: ReadonlyMap<string, AppServerRpcHandler>,
  backendHandlers: ReadonlyMap<string, AppServerRpcHandler>,
) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: desktopHandlers,
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: backendHandlers,
  });
  return {
    desktop,
    backend,
    backendToDesktop,
    dispose() {
      desktop.dispose();
      backend.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}

function createRequest(requestId: string) {
  return {
    schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
    kind: 'request' as const,
    request_id: requestId,
    method: 'test.echo',
    payload: null,
  };
}

class GatedWritable extends Writable {
  readonly frames: string[] = [];
  private readonly writes: Array<{
    readonly bytes: Buffer;
    readonly callback: (error?: Error | null) => void;
  }> = [];

  get pendingWriteCount(): number {
    return this.writes.length;
  }

  releaseNextWrite(): void {
    const write = this.writes.shift();
    if (!write) throw new Error('没有待释放的 RPC write');
    this.frames.push(write.bytes.toString('utf8'));
    write.callback();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writes.push({ bytes: Buffer.from(chunk), callback });
  }
}

class FailingWritable extends Writable {
  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback(new Error('fixture write failed'));
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待 App Server RPC 状态超时');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
