import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  createPipeCommandTextSink,
  type OpenPipeCommandTextWriter,
} from '../../../src/app-hosts/linnya/adapters/commands/output';
import {
  TOOL_OUTPUT_BODY_FILE_NAME,
  ToolOutputBlobSourceSchema,
  type ToolOutputTextBlobWriter,
} from '../../../src/tools/tool_output/definitions/toolOutputBlob';
import { createToolOutputTextBlobWriter } from '../../../src/tools/tool_output/orchestration/createToolOutputTextBlobWriter';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../src/infra/adapters/command-runtime/output';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function sinkInput(openWriter: OpenPipeCommandTextWriter) {
  return {
    encoding: 'utf-8' as const,
    observation: createBoundedPipeCommandOutputObservation({
      maxEvents: 1_024,
      maxCharacters: 40_000,
    }),
    currentLogicalLineLimits: { maxCharactersPerCurrentLine: 20_000 },
    agentTextProjectionLimits: {
      maxCharactersPerStream: 20_000,
      maxLinesPerStream: 1_200,
    },
    openWriter,
  };
}

function memoryWriter(input: {
  readonly appended: string[];
  readonly appendGate?: Promise<void>;
  readonly failAppend?: boolean;
  readonly onAbort?: () => void;
}): ToolOutputTextBlobWriter {
  return {
    async append(text) {
      await input.appendGate;
      if (input.failAppend) throw new Error('injected append failure');
      input.appended.push(text);
    },
    async finalize() {
      return {
        blobId: randomUUID().replace(/-/gu, '').slice(0, 16),
        filePath: path.join(os.tmpdir(), randomUUID(), 'manifest.json'),
        stagingCleanup: 'complete',
      };
    },
    async abort() {
      input.onAbort?.();
    },
  };
}

async function runRealStore(root: string): Promise<void> {
  const sink = createPipeCommandTextSink(sinkInput(async channel => (
    createToolOutputTextBlobWriter({
      blobsDirectory: path.join(root, 'real-store', channel),
      source: ToolOutputBlobSourceSchema.parse({
        kind: 'tool_output_text',
        conversation_id: `text-sink-e2e-${randomUUID()}`,
        instance_id: 'default',
        tool_name: `shell.${channel}`,
      }),
    })
  )));
  sink.accept('stdout', Buffer.from('start\n10%\r100%\n\u001b[31mdone\u001b[0m'));
  sink.accept('stderr', Buffer.from('warn\nlast'));
  const settlement = await sink.settle({
    stdoutCompletion: 'complete',
    stderrCompletion: 'complete',
  });
  assert.equal(settlement.streams.stdout.blob.status, 'published');
  assert.equal(settlement.streams.stderr.blob.status, 'published');
  if (
    settlement.streams.stdout.blob.status !== 'published'
    || settlement.streams.stderr.blob.status !== 'published'
  ) throw new Error('real text streams were not published');
  assert.equal(
    await fsp.readFile(path.join(
      path.dirname(settlement.streams.stdout.blob.blob.filePath),
      TOOL_OUTPUT_BODY_FILE_NAME,
    ), 'utf16le'),
    'start\n100%\ndone',
  );
  assert.equal(
    await fsp.readFile(path.join(
      path.dirname(settlement.streams.stderr.blob.blob.filePath),
      TOOL_OUTPUT_BODY_FILE_NAME,
    ), 'utf16le'),
    'warn\nlast',
  );
}

async function runBoundedSlowSink(): Promise<void> {
  const gate = deferred<void>();
  const appended: string[] = [];
  const sink = createPipeCommandTextSink({
    ...sinkInput(async () => memoryWriter({ appended, appendGate: gate.promise })),
    limits: {
      maxPendingEvents: 4,
      maxPendingCharacters: 1_000,
    },
  });
  for (let index = 0; index < 20; index += 1) {
    sink.accept('stdout', Buffer.from(`line-${index}\n`));
  }
  assert.equal(sink.snapshot().stablePreview.stdout.total_lines, 21);
  gate.resolve();
  const settlement = await sink.settle({
    stdoutCompletion: 'complete',
    stderrCompletion: 'complete',
  });
  assert.equal(appended.length, 4);
  assert.deepEqual(settlement.streams.stdout.blob, {
    status: 'published',
    completeness: 'incomplete',
    blob: settlement.streams.stdout.blob.status === 'published'
      ? settlement.streams.stdout.blob.blob
      : undefined,
  });
}

async function runFailureIsolation(): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sink = createPipeCommandTextSink(sinkInput(async channel => (
    channel === 'stdout'
      ? memoryWriter({ appended: stdout, failAppend: true })
      : memoryWriter({ appended: stderr })
  )));
  sink.accept('stdout', Buffer.from('bad\n'));
  sink.accept('stderr', Buffer.from('good\n'));
  const settlement = await sink.settle({
    stdoutCompletion: 'complete',
    stderrCompletion: 'complete',
  });
  assert.deepEqual(settlement.streams.stdout.blob, {
    status: 'unavailable',
    failureCode: 'writer_append_failed',
  });
  assert.equal(settlement.streams.stderr.blob.status, 'published');
  assert.deepEqual(stderr, ['good\n']);
}

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-text-sink-e2e-中文-'));
let succeeded = false;
try {
  await runRealStore(root);
  await runBoundedSlowSink();
  await runFailureIsolation();
  succeeded = true;
  process.stdout.write(`${JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    scenarios: 3,
    status: 'passed',
  })}\n`);
} finally {
  if (succeeded) await fsp.rm(root, { recursive: true, force: true });
  else process.stderr.write(`preserved failed text sink E2E root: ${root}\n`);
}
