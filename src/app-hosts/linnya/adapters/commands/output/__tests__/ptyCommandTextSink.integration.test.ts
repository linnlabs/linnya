import { randomUUID } from 'node:crypto';

import { ProcessOutputCursorSchema } from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import {
  createBoundedPtyCommandOutputObservation,
  type PtyScreenProjectionFinalization,
  type PtyScreenProjectionSession,
  type PtyScreenProjectionSnapshot,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import {
  createPtyCommandTextSink,
  type PtyCommandTextSinkDependencies,
} from '../orchestration/createPtyCommandTextSink';

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function createObservation() {
  return createBoundedPtyCommandOutputObservation({
    maxSnapshots: 8,
    maxCharactersPerSnapshot: 2_000,
    maxLinesPerSnapshot: 200,
  });
}

function createMemoryWriter(input: {
  readonly appended: string[];
  readonly failAppend?: boolean;
  readonly committedPrefix?: { readonly characters: number; readonly lines: number };
}): ToolOutputTextBlobWriter {
  return {
    async append(text) {
      if (input.failAppend) throw new Error('injected append failure');
      input.appended.push(text);
    },
    async finalize() {
      return {
        blobId: randomUUID().replace(/-/gu, '').slice(0, 16),
        filePath: `/virtual/${randomUUID()}/manifest.json`,
        stagingCleanup: 'complete',
      };
    },
    async finalizeCommittedPrefix() {
      if (input.committedPrefix) {
        return {
          status: 'published',
          blob: {
            blobId: randomUUID().replace(/-/gu, '').slice(0, 16),
            filePath: `/virtual/${randomUUID()}/manifest.json`,
            stagingCleanup: 'complete',
          },
          persistedCharacters: input.committedPrefix.characters,
          persistedLines: input.committedPrefix.lines,
        };
      }
      return { status: 'not_created', reason: 'no_committed_block' };
    },
    async abort() {},
  };
}

function createInput(input: {
  readonly observation?: ReturnType<typeof createObservation>;
  readonly openWriter?: () => Promise<ToolOutputTextBlobWriter>;
}) {
  return {
    projection: {
      columns: 20,
      rows: 4,
      scrollbackLines: 8,
      agentTextProjectionLimits: {
        maxCharactersPerStream: 2_000,
        maxLinesPerStream: 200,
      },
    },
    observation: input.observation ?? createObservation(),
    openWriter: input.openWriter ?? (async () => createMemoryWriter({ appended: [] })),
  };
}

function fakeSnapshot(text: string): PtyScreenProjectionSnapshot {
  return Object.freeze({
    stableText: text,
    agentText: Object.freeze({
      mode: 'pty',
      terminal: Object.freeze({
        status: 'complete',
        text,
        total_chars: text.length,
        total_lines: text.length === 0 ? 0 : 1,
      }),
    }),
    screen: Object.freeze({
      mode: 'pty',
      scope: 'viewport',
      revision: 1,
      columns: 20,
      rows: 4,
      active_buffer: 'normal',
      total_buffer_lines: 4,
      window_start_line: 0,
      viewport_start_line: 0,
      scrollback_lines: 0,
      omitted_before_lines: 0,
      cursor: Object.freeze({ column: text.length, row: 0 }),
      lines: Object.freeze([]),
    }),
  });
}

function fakeFinalization(
  text: string,
  sourceCompletion: 'complete' | 'interrupted',
): PtyScreenProjectionFinalization {
  const snapshot = fakeSnapshot(text);
  return Object.freeze({ ...snapshot, sourceCompletion });
}

describe('PTY command text sink', () => {
  it('PTY observation 只保留有界屏幕版本，落后 cursor 明确 omitted', () => {
    const observation = createBoundedPtyCommandOutputObservation({
      maxSnapshots: 2,
      maxCharactersPerSnapshot: 20,
      maxLinesPerSnapshot: 4,
    });
    const accept = (text: string): void => {
      observation.accept({ stableScreenText: text, screen: fakeSnapshot(text).screen });
    };
    accept('first');
    accept('second');
    accept('third');

    const old = observation.read(ProcessOutputCursorSchema.parse(0));
    expect(old).toMatchObject({
      status: 'observed',
      observation: {
        mode: 'pty',
        coverage: 'omitted',
        terminal: { status: 'complete', text: 'third' },
      },
    });
    if (old.status !== 'observed') throw new Error('expected PTY observation');
    const current = observation.read(old.observation.nextCursor);
    expect(current).toMatchObject({
      status: 'observed',
      observation: { coverage: 'complete' },
    });
    if (current.status !== 'observed') throw new Error('expected PTY observation');
    expect('terminal' in current.observation).toBe(false);
  });

  it('真实 parser 只把最终稳定屏幕写入 ToolOutputStore，并提供非消费 terminal observation', async () => {
    const appended: string[] = [];
    const observation = createObservation();
    const sink = createPtyCommandTextSink(createInput({
      observation,
      openWriter: async () => createMemoryWriter({ appended }),
    }));

    sink.accept(Buffer.from('\x1b]0;PRIVATE\x07\x1b[31mred\x1b[0m\r\nplain'));
    const first = await observation.waitForChange({
      afterCursor: ProcessOutputCursorSchema.parse(0),
      waitTimeoutMs: 1_000,
    });
    expect(first).toMatchObject({
      status: 'observed',
      observation: {
        mode: 'pty',
        terminal: { status: 'complete', text: 'red\nplain' },
        outputPhase: 'open',
      },
    });
    if (first.status !== 'observed') throw new Error('expected PTY observation');
    expect(observation.read(ProcessOutputCursorSchema.parse(0))).toEqual(first);

    const settlement = await sink.settle({ sourceCompletion: 'complete' });
    expect(settlement.projection).toMatchObject({
      status: 'complete',
      stableText: 'red\nplain',
      screen: { mode: 'pty', scope: 'terminal_window' },
    });
    expect(settlement.blob).toMatchObject({ status: 'published', completeness: 'complete' });
    expect(appended).toEqual(['red\nplain']);
    expect(observation.read(first.observation.nextCursor)).toMatchObject({
      status: 'observed',
      observation: { mode: 'pty', outputPhase: 'closed' },
    });
  });

  it('慢 parser 不阻塞 accept；达到固定队列门后停止派生但仍可结算', async () => {
    const gate = deferred();
    const actions: string[] = [];
    const fake: PtyScreenProjectionSession = {
      async write(bytes) {
        actions.push(`write:${Buffer.from(bytes).toString('utf8')}`);
        await gate.promise;
      },
      async resize(columns, rows) {
        actions.push(`resize:${columns}x${rows}`);
      },
      async snapshot() {
        return fakeSnapshot('partial');
      },
      async finalize(sourceCompletion) {
        return fakeFinalization('partial', sourceCompletion);
      },
    };
    const dependencies: PtyCommandTextSinkDependencies = {
      createProjection: () => fake,
    };
    const sink = createPtyCommandTextSink({
      ...createInput({}),
      limits: { maxPendingEvents: 1, maxPendingBytes: 16 },
    }, dependencies);

    expect(() => sink.accept(Buffer.from('first'))).not.toThrow();
    expect(() => sink.accept(Buffer.from('second'))).not.toThrow();
    expect(() => sink.accept(Buffer.from('third'))).not.toThrow();
    gate.resolve();
    const settlement = await sink.settle({ sourceCompletion: 'complete' });

    expect(actions).toEqual(['write:first']);
    expect(settlement.projection.status).toBe('incomplete');
    expect(settlement.blob).toMatchObject({ status: 'published', completeness: 'incomplete' });
  });

  it('projection 失败只关闭派生层，writer 不打开且 observation 明确失败', async () => {
    let writerOpens = 0;
    let finalizeCalls = 0;
    const observation = createObservation();
    const fake: PtyScreenProjectionSession = {
      async write() {
        throw new Error('injected parser failure');
      },
      async resize() {},
      async snapshot() {
        return fakeSnapshot('unreachable');
      },
      async finalize(sourceCompletion) {
        finalizeCalls += 1;
        return fakeFinalization('must-not-recover', sourceCompletion);
      },
    };
    const sink = createPtyCommandTextSink({
      ...createInput({
        observation,
        openWriter: async () => {
          writerOpens += 1;
          return createMemoryWriter({ appended: [] });
        },
      }),
    }, { createProjection: () => fake });

    sink.accept(Buffer.from('still-owned-by-raw'));
    const settlement = await sink.settle({ sourceCompletion: 'complete' });

    expect(settlement.projection).toEqual({ status: 'failed' });
    expect(settlement.blob).toEqual({
      status: 'unavailable',
      failureCode: 'projection_failed',
    });
    expect(writerOpens).toBe(0);
    expect(finalizeCalls).toBe(1);
    expect(observation.read(ProcessOutputCursorSchema.parse(0))).toMatchObject({
      status: 'observed',
      observation: { outputPhase: 'closed', textProjection: 'failed' },
    });
  });

  it('ToolOutputStore 写失败不损坏最终屏幕和 Agent 预览', async () => {
    const sink = createPtyCommandTextSink(createInput({
      openWriter: async () => createMemoryWriter({ appended: [], failAppend: true }),
    }));
    sink.accept(Buffer.from('visible'));

    const settlement = await sink.settle({ sourceCompletion: 'complete' });

    expect(settlement.projection).toMatchObject({
      status: 'complete',
      stableText: 'visible',
      agentPreview: { terminal: { text: 'visible' } },
    });
    expect(settlement.blob).toEqual({
      status: 'unavailable',
      failureCode: 'writer_append_failed',
    });
  });

  it('PTY writer 中途失败时保留已提交前缀，不把全文误标为完整', async () => {
    const sink = createPtyCommandTextSink(createInput({
      openWriter: async () => createMemoryWriter({
        appended: [],
        failAppend: true,
        committedPrefix: { characters: 65_536, lines: 40 },
      }),
    }));
    sink.accept(Buffer.from('visible screen'));

    const settlement = await sink.settle({ sourceCompletion: 'complete' });

    expect(settlement.projection).toMatchObject({
      status: 'complete',
      stableText: 'visible screen',
    });
    expect(settlement.blob).toMatchObject({
      status: 'published',
      completeness: 'incomplete',
      persistedCharacters: 65_536,
      persistedLines: 40,
    });
  });
});
