import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  APP_SERVER_CONTROL_MAX_FRAME_BYTES,
  APP_SERVER_CONTROL_SCHEMA_VERSION,
  encodeAppServerControlFrame,
  parseAppServerChildControlFrame,
  runAppServerControlHost,
  type AppServerChildControlFrame,
} from '..';
import { createBoundedJsonLineDecoder } from '../../app-server-transport';

describe('App Server control host', () => {
  it('ready 后响应 ping，并在 shutdown 确认前等待业务 owner 收口', async () => {
    const parentInput = new PassThrough();
    const childOutput = new PassThrough();
    const frames: AppServerChildControlFrame[] = [];
    const decoder = createBoundedJsonLineDecoder({
      protocolName: 'App Server control protocol',
      maxFrameBytes: APP_SERVER_CONTROL_MAX_FRAME_BYTES,
      onValue: value => frames.push(parseAppServerChildControlFrame(value)),
      onFailure: error => { throw error; },
    });
    childOutput.on('data', chunk => decoder.push(chunk));
    const shutdownGate: { release(): void } = {
      release() {
        throw new Error('shutdown gate 尚未创建');
      },
    };
    const shutdown = vi.fn(() => new Promise<void>(resolve => {
      shutdownGate.release = resolve;
    }));
    const host = runAppServerControlHost({
      input: parentInput,
      output: childOutput,
      daemonEpoch: 'epoch-test',
      pid: 2468,
      lifecycle: { ready: Promise.resolve(createReadyFacts()), shutdown },
    });
    await waitFor(() => frames.length === 1);
    expect(frames[0]).toMatchObject({
      kind: 'ready',
      daemon_epoch: 'epoch-test',
      pid: 2468,
    });

    parentInput.write(encodeAppServerControlFrame({
      schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
      kind: 'request',
      request_id: 'ping-1',
      operation: 'ping',
    }));
    await waitFor(() => frames.length === 2);
    expect(frames[1]).toMatchObject({
      kind: 'response',
      request_id: 'ping-1',
      operation: 'ping',
    });

    parentInput.write(encodeAppServerControlFrame({
      schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
      kind: 'request',
      request_id: 'shutdown-1',
      operation: 'shutdown',
    }));
    await waitFor(() => shutdown.mock.calls.length === 1);
    expect(frames).toHaveLength(2);
    shutdownGate.release();
    await host.completed;
    await waitFor(() => frames.length === 3);
    expect(frames[2]).toMatchObject({
      kind: 'response',
      request_id: 'shutdown-1',
      operation: 'shutdown',
    });
  });

  it('stdin EOF 直接收口 owner，不等待另一个常驻心跳', async () => {
    const parentInput = new PassThrough();
    const childOutput = new PassThrough();
    const shutdown = vi.fn(async () => undefined);
    const host = runAppServerControlHost({
      input: parentInput,
      output: childOutput,
      lifecycle: { ready: Promise.resolve(createReadyFacts()), shutdown },
    });

    parentInput.end();
    await host.completed;
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('shutdown confirmation 写入被堵塞时不提前完成生命周期', async () => {
    const parentInput = new PassThrough();
    const childOutput = new GatedWritable();
    const host = runAppServerControlHost({
      input: parentInput,
      output: childOutput,
      daemonEpoch: 'epoch-backpressure',
      lifecycle: {
        ready: Promise.resolve(createReadyFacts()),
        shutdown: async () => undefined,
      },
    });
    childOutput.releaseNextWrite();
    await waitFor(() => childOutput.text.includes('"kind":"ready"'));

    parentInput.write(encodeAppServerControlFrame({
      schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
      kind: 'request',
      request_id: 'shutdown-backpressure',
      operation: 'shutdown',
    }));
    await waitFor(() => childOutput.pendingWriteCount === 1);
    let completed = false;
    void host.completed.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    childOutput.releaseNextWrite();
    await host.completed;
    expect(childOutput.text).toContain('"request_id":"shutdown-backpressure"');
  });

  it('在累积无换行数据越过单帧预算时 fail closed', () => {
    const onValue = vi.fn();
    const onFailure = vi.fn();
    const decoder = createBoundedJsonLineDecoder({
      protocolName: 'App Server control protocol',
      maxFrameBytes: 8,
      onValue,
      onFailure,
    });

    decoder.push('1234');
    decoder.push('5678');
    decoder.push('\n{}\n');

    expect(onValue).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('超过 8 bytes'),
    });
  });
});

class GatedWritable extends Writable {
  text = '';
  private readonly writes: Array<{
    readonly bytes: Buffer;
    readonly callback: (error?: Error | null) => void;
  }> = [];

  get pendingWriteCount(): number {
    return this.writes.length;
  }

  releaseNextWrite(): void {
    const write = this.writes.shift();
    if (!write) {
      setImmediate(() => this.releaseNextWrite());
      return;
    }
    this.text += write.bytes.toString('utf8');
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

function createReadyFacts() {
  return {
    applicationVersion: '0.0.38',
    apiPort: 3000,
    rendererSessionToken: 'a'.repeat(64),
    databaseReady: true as const,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待 App Server 控制帧超时');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
