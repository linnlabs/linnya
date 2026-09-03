import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  createDiagnosticLogFileSink,
  createDiagnosticLogEnvelope,
  createDiagnosticLogWriter,
  projectDiagnosticLogEntry,
  readDiagnosticLogEnvelope,
  type DiagnosticLogInput,
  type DiagnosticLogRecord,
  type DiagnosticLogSink,
} from '../index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function input(
  level: DiagnosticLogInput['level'],
  message: string,
  data?: unknown,
  receivedAt: Date = new Date(2026, 6, 31, 12, 0, 0),
): DiagnosticLogInput {
  return { receivedAt, level, module: 'diagnostic-test', message, data };
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}

describe('诊断日志生产合同', () => {
  it('把超大、超深、循环和二进制 metadata 投影成一条严格有界记录', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let depth = 0; depth < 20; depth += 1) deep = { child: deep };
    const error = new Error('outer');
    Object.defineProperty(error, 'cause', { value: new Error('inner') });

    const record = projectDiagnosticLogEntry(input('ERROR', 'failure\nwith two lines', {
      huge: '汉字'.repeat(200_000),
      circular,
      deep,
      error,
      count: 42n,
      bytes: new Uint8Array(1024 * 1024),
    }), DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS);

    expect(record.utf8Bytes).toBeLessThanOrEqual(DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS.maxRecordBytes);
    expect(record.line).not.toContain('\n');
    expect(record.line).toContain('\\n');
    expect(record.line).toContain('[truncated]');
    expect(record.line).toContain('Uint8Array');
    expect(record.line).not.toContain('0,0,0,0');
  });

  it('队列拥塞时丢弃低等级摘要，并为较新的错误终态腾出固定容量', async () => {
    const gate = deferred();
    const written: DiagnosticLogRecord[] = [];
    const sink: DiagnosticLogSink = {
      async write(records) {
        await gate.promise;
        written.push(...records);
      },
    };
    const writer = createDiagnosticLogWriter({
      sink,
      writerLimits: {
        maxQueueEntries: 3,
        maxQueueBytes: 64 * 1024,
        maxBatchEntries: 3,
        maxBatchBytes: 64 * 1024,
        shutdownTimeoutMs: 500,
      },
    });

    expect(writer.write(input('DEBUG', 'debug-1')).accepted).toBe(true);
    expect(writer.write(input('INFO', 'info-1')).accepted).toBe(true);
    expect(writer.write(input('DEBUG', 'debug-2')).accepted).toBe(true);
    expect(writer.write(input('INFO', 'info-dropped'))).toEqual({ accepted: false, reason: 'queue_full' });
    expect(writer.write(input('ERROR', 'run-failed')).accepted).toBe(true);

    gate.resolve();
    const shutdown = await writer.shutdown();
    expect(shutdown.complete).toBe(true);
    expect(shutdown.status.dropped.queue).toBe(2);
    expect(written.some(record => record.line.includes('run-failed'))).toBe(true);
    expect(written.some(record => record.line.includes('info-dropped'))).toBe(false);
  });

  it('文件系统持续失败后只调用一次 sink，并使后续业务日志立即降级', async () => {
    const diskFull = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const sinkWrite = vi.fn(async () => {
      throw diskFull;
    });
    const onSinkDisabled = vi.fn();
    const writer = createDiagnosticLogWriter({
      sink: { write: sinkWrite },
      onSinkDisabled,
    });

    writer.write(input('INFO', 'before-full'));
    await vi.waitFor(() => expect(writer.getStatus().state).toBe('sink_disabled'));
    expect(writer.write(input('ERROR', 'after-full'))).toEqual({
      accepted: false,
      reason: 'sink_disabled',
    });
    expect(sinkWrite).toHaveBeenCalledTimes(1);
    expect(onSinkDisabled).toHaveBeenCalledOnce();
  });

  it('低一级摘要不能淘汰已排队的更高等级终态', async () => {
    const gate = deferred();
    const written: DiagnosticLogRecord[] = [];
    const writer = createDiagnosticLogWriter({
      sink: {
        async write(records) {
          await gate.promise;
          written.push(...records);
        },
      },
      writerLimits: {
        maxQueueEntries: 2,
        maxQueueBytes: 64 * 1024,
        maxBatchEntries: 2,
        maxBatchBytes: 64 * 1024,
        shutdownTimeoutMs: 500,
      },
    });
    writer.write(input('ERROR', 'failure-1'));
    writer.write(input('ERROR', 'failure-2'));

    expect(writer.write(input('WARN', 'warning-dropped'))).toEqual({
      accepted: false,
      reason: 'queue_full',
    });
    expect(writer.write(input('ERROR', 'failure-newest')).accepted).toBe(true);
    gate.resolve();
    await writer.shutdown();

    expect(written.some(record => record.line.includes('warning-dropped'))).toBe(false);
    expect(written.some(record => record.line.includes('failure-newest'))).toBe(true);
  });

  it('高等级终态优先淘汰低等级摘要，而不是误删较早终态', async () => {
    const gate = deferred();
    const written: DiagnosticLogRecord[] = [];
    const writer = createDiagnosticLogWriter({
      sink: {
        async write(records) {
          await gate.promise;
          written.push(...records);
        },
      },
      writerLimits: {
        maxQueueEntries: 3,
        maxQueueBytes: 64 * 1024,
        maxBatchEntries: 3,
        maxBatchBytes: 64 * 1024,
        shutdownTimeoutMs: 500,
      },
    });
    writer.write(input('ERROR', 'failure-earlier'));
    writer.write(input('INFO', 'replaceable-info'));
    writer.write(input('WARN', 'warning-earlier'));

    expect(writer.write(input('ERROR', 'failure-newest')).accepted).toBe(true);
    gate.resolve();
    await writer.shutdown();

    expect(written.some(record => record.line.includes('failure-earlier'))).toBe(true);
    expect(written.some(record => record.line.includes('failure-newest'))).toBe(true);
    expect(written.some(record => record.line.includes('replaceable-info'))).toBe(false);
  });

  it('worker 边界只接收完整且仍满足单条容量的有界记录', () => {
    const record = projectDiagnosticLogEntry(
      input('WARN', 'worker-summary'),
      DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
    );
    expect(readDiagnosticLogEnvelope(createDiagnosticLogEnvelope(record))?.record).toEqual(record);
    expect(readDiagnosticLogEnvelope({
      type: 'diagnostic_log',
      version: 1,
      record: { ...record, line: `${record.line}\ninjected` },
    })).toBeUndefined();
    expect(readDiagnosticLogEnvelope({
      type: 'diagnostic_log',
      version: 1,
      record: { ...record, utf8Bytes: record.utf8Bytes + 1 },
    })).toBeUndefined();
  });

  it('sink 永久阻塞时在退出预算内返回不完整，而不是拖住 App', async () => {
    const gate = deferred();
    const writer = createDiagnosticLogWriter({
      sink: { async write() { await gate.promise; } },
    });
    writer.write(input('INFO', 'blocked-write'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const startedAt = performance.now();
    const shutdown = await writer.shutdown(30);
    const elapsedMs = performance.now() - startedAt;

    expect(shutdown.complete).toBe(false);
    expect(elapsedMs).toBeLessThan(250);
    gate.resolve();
  });

  it('真实文件 sink 跨午夜换文件、按大小轮转，并只治理 backend 日志', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-diagnostic-log-'));
    temporaryDirectories.push(directory);
    const baseFilePath = path.join(directory, 'backend-2026-07-31.log');
    const unrelatedPath = path.join(directory, 'qdrant.log');
    await writeFile(unrelatedPath, 'external-owner\n', 'utf8');

    const sink = createDiagnosticLogFileSink({
      baseFilePath,
      limits: { maxFileBytes: 180, maxDirectoryBytes: 360, maxFiles: 2 },
    });
    const records = [
      projectDiagnosticLogEntry(input('INFO', 'A'.repeat(60), undefined, new Date(2026, 6, 31, 23, 59)), DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS),
      projectDiagnosticLogEntry(input('INFO', 'B'.repeat(60), undefined, new Date(2026, 6, 31, 23, 59)), DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS),
      projectDiagnosticLogEntry(input('INFO', 'C'.repeat(60), undefined, new Date(2026, 7, 1, 0, 1)), DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS),
      projectDiagnosticLogEntry(input('ERROR', 'D'.repeat(60), undefined, new Date(2026, 7, 1, 0, 2)), DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS),
    ];
    for (const record of records) await sink.write([record]);

    const names = await readdir(directory);
    const backendNames = names.filter(name => name.startsWith('backend-'));
    expect(backendNames).toHaveLength(2);
    expect(backendNames.some(name => name.includes('2026-08-01'))).toBe(true);
    expect(await readFile(unrelatedPath, 'utf8')).toBe('external-owner\n');
    for (const name of backendNames) {
      expect((await stat(path.join(directory, name))).size).toBeLessThanOrEqual(180);
    }
  });

});
