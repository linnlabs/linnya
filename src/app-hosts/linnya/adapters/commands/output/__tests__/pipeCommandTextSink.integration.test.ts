import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { ProcessOutputCursorSchema } from '@app/schemas/commands';

import {
  TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  TOOL_OUTPUT_BODY_FILE_NAME,
  ToolOutputBlobSourceSchema,
  type ToolOutputTextBlobWriter,
} from '../../../../../../tools/tool_output/definitions/toolOutputBlob';
import {
  createToolOutputTextBlobWriter,
  type ToolOutputTextBlobWritableFile,
  type ToolOutputTextBlobWriterDependencies,
} from '../../../../../../tools/tool_output/orchestration/createToolOutputTextBlobWriter';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import { createPipeCommandTextSink } from '../orchestration/createPipeCommandTextSink';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createInput(openWriter: (channel: 'stdout' | 'stderr') => Promise<ToolOutputTextBlobWriter>) {
  return {
    encoding: 'utf-8' as const,
    observation: createBoundedPipeCommandOutputObservation({
      maxEvents: 1_024,
      maxCharacters: 4_000,
    }),
    currentLogicalLineLimits: { maxCharactersPerCurrentLine: 1_000 },
    agentTextProjectionLimits: {
      maxCharactersPerStream: 2_000,
      maxLinesPerStream: 200,
    },
    openWriter,
  };
}

class FailingWritableFile implements ToolOutputTextBlobWritableFile {
  constructor(
    private readonly file: FileHandle,
    private readonly failAtPosition: number | undefined,
  ) {}

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }> {
    if (this.failAtPosition !== undefined && position >= this.failAtPosition) {
      throw new Error('injected staging write failure');
    }
    return this.file.write(buffer, offset, length, position);
  }

  async truncate(length: number): Promise<void> {
    await this.file.truncate(length);
  }

  async sync(): Promise<void> {
    await this.file.sync();
  }

  async close(): Promise<void> {
    await this.file.close();
  }
}

async function createStoreWriters(
  dependencies?: ToolOutputTextBlobWriterDependencies,
) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-command-text-sink-'));
  temporaryRoots.push(root);
  const writers = new Map<'stdout' | 'stderr', ToolOutputTextBlobWriter>();
  const failures: unknown[] = [];
  return {
    root,
    writers,
    failures,
    async openWriter(channel: 'stdout' | 'stderr') {
      let writer: ToolOutputTextBlobWriter;
      try {
        writer = await createToolOutputTextBlobWriter({
          blobsDirectory: path.join(root, channel),
          source: ToolOutputBlobSourceSchema.parse({
            kind: 'tool_output_text',
            conversation_id: `text-sink-conversation-${randomUUID()}`,
            instance_id: 'default',
            tool_name: `shell.${channel}`,
          }),
        }, dependencies);
      } catch (error: unknown) {
        failures.push(error);
        throw error;
      }
      writers.set(channel, writer);
      return {
        async append(text: string) {
          try {
            await writer.append(text);
          } catch (error: unknown) {
            failures.push(error);
            throw error;
          }
        },
        async finalize() {
          try {
            return await writer.finalize();
          } catch (error: unknown) {
            failures.push(error);
            throw error;
          }
        },
        finalizeCommittedPrefix: () => writer.finalizeCommittedPrefix(),
        abort: () => writer.abort(),
      };
    },
  };
}

async function readPublishedText(manifestPath: string): Promise<string> {
  return fsp.readFile(path.join(path.dirname(manifestPath), TOOL_OUTPUT_BODY_FILE_NAME), 'utf16le');
}

function createMemoryWriter(input: {
  readonly appended: string[];
  readonly appendGate?: Promise<void>;
  readonly failAppend?: boolean;
  readonly failFinalize?: boolean;
  readonly failAbort?: boolean;
  readonly onAbort?: () => void;
}): ToolOutputTextBlobWriter {
  return {
    async append(text) {
      await input.appendGate;
      if (input.failAppend) throw new Error('injected append failure');
      input.appended.push(text);
    },
    async finalize() {
      if (input.failFinalize) throw new Error('injected finalize failure');
      return {
        blobId: randomUUID().replace(/-/gu, '').slice(0, 16),
        filePath: `/virtual/${randomUUID()}/manifest.json`,
        stagingCleanup: 'complete',
      };
    },
    async finalizeCommittedPrefix() {
      return { status: 'not_created', reason: 'no_committed_block' };
    },
    async abort() {
      input.onAbort?.();
      if (input.failAbort) throw new Error('injected abort failure');
    },
  };
}

describe('pipe command text sink', () => {
  it('复用同一文本投影提供可重试增量、CR 当前行和关闭观察', async () => {
    const sink = createPipeCommandTextSink(createInput(
      async () => createMemoryWriter({ appended: [] }),
    ));
    sink.accept('stdout', Buffer.from('stable\n10%\r'));
    const first = sink.observation.read(ProcessOutputCursorSchema.parse(0));
    expect(first).toMatchObject({
      status: 'observed',
      observation: {
        stdout: 'stable\n',
        currentLogicalLines: { stdout: { text: '10%' } },
        outputPhase: 'open',
      },
    });
    if (first.status !== 'observed') throw new Error('expected output observation');

    sink.accept('stdout', Buffer.from('20%\r'));
    expect(sink.observation.read(first.observation.nextCursor)).toMatchObject({
      status: 'observed',
      observation: {
        stdout: '',
        currentLogicalLines: { stdout: { text: '20%' } },
      },
    });

    const beforeClose = sink.observation.read(ProcessOutputCursorSchema.parse(0));
    if (beforeClose.status !== 'observed') throw new Error('expected output observation');
    await sink.settle({ stdoutCompletion: 'complete', stderrCompletion: 'complete' });
    expect(sink.observation.read(beforeClose.observation.nextCursor)).toMatchObject({
      status: 'observed',
      observation: { stdout: '20%', outputPhase: 'closed' },
    });
  });

  it('把双流稳定纯文本分别写入现有 ToolOutputStore，并保留 Agent 双流预览', async () => {
    const store = await createStoreWriters();
    const sink = createPipeCommandTextSink(createInput(store.openWriter));

    sink.accept('stdout', Buffer.from('start\n10%\r20%\r100%\n\u001b[31mdone\u001b[0m', 'utf8'));
    sink.accept('stderr', Buffer.from('warn\nlast', 'utf8'));
    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });

    expect(store.failures).toEqual([]);
    expect(settlement.agentPreview).toEqual({
      mode: 'pipe',
      stdout: {
        status: 'complete',
        text: 'start\n100%\ndone',
        total_chars: 15,
        total_lines: 3,
      },
      stderr: {
        status: 'complete',
        text: 'warn\nlast',
        total_chars: 9,
        total_lines: 2,
      },
    });
    expect(settlement.streams.stdout.blob.status).toBe('published');
    expect(settlement.streams.stderr.blob.status).toBe('published');
    if (
      settlement.streams.stdout.blob.status !== 'published'
      || settlement.streams.stderr.blob.status !== 'published'
    ) {
      throw new Error('expected both command text streams to publish');
    }
    await expect(readPublishedText(settlement.streams.stdout.blob.blob.filePath))
      .resolves.toBe('start\n100%\ndone');
    await expect(readPublishedText(settlement.streams.stderr.blob.blob.filePath))
      .resolves.toBe('warn\nlast');
  });

  it('启动前结束不打开 writer，也不发布空 ToolOutput blob', async () => {
    let openCount = 0;
    const sink = createPipeCommandTextSink(createInput(async () => {
      openCount += 1;
      return createMemoryWriter({ appended: [] });
    }));

    const settlement = await sink.settleBeforeSourceStart();

    expect(openCount).toBe(0);
    expect(settlement.agentPreview.stdout).toMatchObject({ status: 'complete', text: '' });
    expect(settlement.streams.stdout).toMatchObject({
      sourceCompletion: 'not_started',
      blob: { status: 'not_created', reason: 'source_not_started' },
    });
    expect(settlement.streams.stderr.blob).toEqual({
      status: 'not_created',
      reason: 'source_not_started',
    });
  });

  it('慢 writer 不阻塞同步 accept；队列满后预览继续，文本 artifact 明确不完整', async () => {
    const gate = deferred<void>();
    const appended: string[] = [];
    const sink = createPipeCommandTextSink({
      ...createInput(async () => createMemoryWriter({ appended, appendGate: gate.promise })),
      limits: {
        maxPendingEvents: 1,
        maxPendingCharacters: 20,
      },
    });

    sink.accept('stdout', Buffer.from('first\n'));
    sink.accept('stdout', Buffer.from('second\n'));
    sink.accept('stdout', Buffer.from('third\n'));
    expect(sink.snapshot().stablePreview.stdout).toMatchObject({
      status: 'complete',
      text: 'first\nsecond\nthird\n',
    });

    gate.resolve();
    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });

    expect(appended).toEqual(['first\n']);
    expect(settlement.streams.stdout.blob).toMatchObject({
      status: 'published',
      completeness: 'incomplete',
    });
  });

  it('一个流的持久化失败只熔断该流，另一流仍能发布', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let stdoutAborts = 0;
    const sink = createPipeCommandTextSink(createInput(async channel => (
      channel === 'stdout'
        ? createMemoryWriter({
            appended: stdout,
            failAppend: true,
            onAbort: () => { stdoutAborts += 1; },
          })
        : createMemoryWriter({ appended: stderr })
    )));

    sink.accept('stdout', Buffer.from('bad\n'));
    sink.accept('stderr', Buffer.from('good\n'));
    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });

    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['good\n']);
    expect(stdoutAborts).toBe(1);
    expect(settlement.streams.stdout.blob).toEqual({
      status: 'unavailable',
      failureCode: 'writer_append_failed',
    });
    expect(settlement.streams.stderr.blob).toMatchObject({
      status: 'published',
      completeness: 'complete',
    });
    expect(settlement.agentPreview.stdout).toMatchObject({ text: 'bad\n' });
  });

  it('真实 writer 中途失败时发布可读取前缀，并保持另一流完整', async () => {
    const store = await createStoreWriters({
      openStagingFile: async filePath => new FailingWritableFile(
        await fsp.open(filePath, 'wx'),
        path.basename(filePath) === TOOL_OUTPUT_BODY_FILE_NAME
          && filePath.includes(`${path.sep}stdout${path.sep}`)
          ? TOOL_OUTPUT_BLOCK_CHAR_CAPACITY * 2
          : undefined,
      ),
    });
    const sink = createPipeCommandTextSink({
      ...createInput(store.openWriter),
      currentLogicalLineLimits: { maxCharactersPerCurrentLine: 200_000 },
    });
    const stdout = `${'a'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY)}`
      + `${'b'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY)}\n`;
    const stderr = 'stderr remains complete\n';

    sink.accept('stdout', Buffer.from(stdout));
    sink.accept('stderr', Buffer.from(stderr));
    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });

    expect(settlement.streams.stdout.blob).toMatchObject({
      status: 'published',
      completeness: 'incomplete',
      persistedCharacters: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
      persistedLines: 1,
    });
    expect(settlement.streams.stderr.blob).toMatchObject({
      status: 'published',
      completeness: 'complete',
      persistedCharacters: stderr.length,
      persistedLines: 2,
    });
    if (settlement.streams.stdout.blob.status !== 'published') {
      throw new Error('expected stdout committed prefix');
    }
    await expect(readPublishedText(settlement.streams.stdout.blob.blob.filePath))
      .resolves.toBe('a'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY));
  });

  it('writer 打开或封存失败都只结束对应文本流', async () => {
    const openFailure = createPipeCommandTextSink(createInput(async channel => {
      if (channel === 'stdout') throw new Error('injected open failure');
      return createMemoryWriter({ appended: [] });
    }));
    openFailure.accept('stdout', Buffer.from('open fails\n'));
    openFailure.accept('stderr', Buffer.from('stderr survives\n'));
    const openSettlement = await openFailure.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });
    expect(openSettlement.streams.stdout).toMatchObject({
      blob: { status: 'unavailable', failureCode: 'writer_open_failed' },
      cleanup: 'not_required',
    });
    expect(openSettlement.streams.stderr.blob.status).toBe('published');

    const finalizeFailure = createPipeCommandTextSink(createInput(async channel => (
      channel === 'stdout'
        ? createMemoryWriter({ appended: [], failFinalize: true })
        : createMemoryWriter({ appended: [] })
    )));
    finalizeFailure.accept('stdout', Buffer.from('finalize fails\n'));
    finalizeFailure.accept('stderr', Buffer.from('stderr still survives\n'));
    const finalizeSettlement = await finalizeFailure.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });
    expect(finalizeSettlement.streams.stdout).toMatchObject({
      blob: { status: 'unavailable', failureCode: 'writer_finalize_failed' },
      cleanup: 'complete',
    });
    expect(finalizeSettlement.streams.stderr.blob.status).toBe('published');
  });

  it('stdout overload 只熔断 stdout；共享队列排空后 stderr 仍能发布', async () => {
    const gate = deferred<void>();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sink = createPipeCommandTextSink({
      ...createInput(async channel => createMemoryWriter({
        appended: channel === 'stdout' ? stdout : stderr,
        ...(channel === 'stdout' ? { appendGate: gate.promise } : {}),
      })),
      limits: {
        maxPendingEvents: 1,
        maxPendingCharacters: 100,
      },
    });
    sink.accept('stdout', Buffer.from('first\n'));
    sink.accept('stdout', Buffer.from('dropped\n'));
    gate.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    sink.accept('stderr', Buffer.from('error survives\n'));

    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });

    expect(stdout).toEqual(['first\n']);
    expect(stderr).toEqual(['error survives\n']);
    expect(settlement.streams.stdout.blob).toMatchObject({
      status: 'published',
      completeness: 'incomplete',
    });
    expect(settlement.streams.stderr.blob).toMatchObject({
      status: 'published',
      completeness: 'complete',
    });
  });

  it('文本投影异常只熔断文本层，不从同步 accept 冒出', async () => {
    const emptySnapshot = {
      stablePreview: {
        mode: 'pipe' as const,
        stdout: { status: 'complete' as const, text: '', total_chars: 0, total_lines: 0 },
        stderr: { status: 'complete' as const, text: '', total_chars: 0, total_lines: 0 },
      },
      currentLogicalLines: {
        stdout: { text: '', omittedCharacters: 0 },
        stderr: { text: '', omittedCharacters: 0 },
      },
    };
    const sink = createPipeCommandTextSink(
      createInput(async () => createMemoryWriter({ appended: [] })),
      {
        createProjectionSession: () => ({
          write() {
            throw new Error('injected projection failure');
          },
          snapshot: () => emptySnapshot,
          finalize() {
            throw new Error('failed projection cannot finalize');
          },
        }),
      },
    );

    expect(() => sink.accept('stdout', Buffer.from('raw survives'))).not.toThrow();
    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });
    expect(settlement.streams.stdout.projection).toEqual({ status: 'failed' });
    expect(settlement.streams.stdout.blob).toEqual({
      status: 'unavailable',
      failureCode: 'projection_failed',
    });
  });

  it('来源中断和逻辑行省略都会让已发布文本明确不完整', async () => {
    const sourceInterrupted = createPipeCommandTextSink(createInput(
      async () => createMemoryWriter({ appended: [] }),
    ));
    sourceInterrupted.accept('stdout', Buffer.from('prefix\n'));
    const interrupted = await sourceInterrupted.settle({
      stdoutCompletion: 'interrupted',
      stderrCompletion: 'complete',
    });
    expect(interrupted.streams.stdout.blob).toMatchObject({
      status: 'published',
      completeness: 'incomplete',
    });

    const omitted = createPipeCommandTextSink({
      ...createInput(async () => createMemoryWriter({ appended: [] })),
      currentLogicalLineLimits: { maxCharactersPerCurrentLine: 4 },
    });
    omitted.accept('stdout', Buffer.from('123456789'));
    const omittedSettlement = await omitted.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });
    expect(omittedSettlement.streams.stdout.projection).toMatchObject({
      status: 'complete',
      facts: { logicalLinesWithOmissions: 1 },
    });
    expect(omittedSettlement.streams.stdout.blob).toMatchObject({
      status: 'published',
      completeness: 'incomplete',
    });
  });

  it('abort 清理失败可观察，但不改写另一流结果', async () => {
    const sink = createPipeCommandTextSink(createInput(async channel => (
      channel === 'stdout'
        ? createMemoryWriter({ appended: [], failAppend: true, failAbort: true })
        : createMemoryWriter({ appended: [] })
    )));
    sink.accept('stdout', Buffer.from('bad\n'));
    sink.accept('stderr', Buffer.from('good\n'));

    const settlement = await sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });

    expect(settlement.streams.stdout.cleanup).toBe('failed');
    expect(settlement.streams.stderr.cleanup).toBe('complete');
    expect(settlement.streams.stderr.blob.status).toBe('published');
  });

  it('终态等待已接纳 writer 真实收口；重复 settle 幂等且不接受迟到 byte', async () => {
    const gate = deferred<void>();
    const sink = createPipeCommandTextSink(createInput(async () => createMemoryWriter({
      appended: [],
      appendGate: gate.promise,
    })));
    sink.accept('stdout', Buffer.from('pending\n'));

    const first = sink.settle({
      stdoutCompletion: 'complete',
      stderrCompletion: 'complete',
    });
    const second = sink.settle({
      stdoutCompletion: 'interrupted',
      stderrCompletion: 'interrupted',
    });
    expect(second).toBe(first);
    let settled = false;
    void first.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(() => sink.accept('stdout', Buffer.from('late'))).toThrow('settlement started');

    gate.resolve();
    await expect(first).resolves.toMatchObject({
      streams: {
        stdout: {
          sourceCompletion: 'complete',
          blob: { status: 'published', completeness: 'complete' },
        },
      },
    });
  });
});
