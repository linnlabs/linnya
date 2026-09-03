import assert from 'node:assert/strict';
import process from 'node:process';

import { ProcessOutputCursorSchema } from '@app/schemas/commands';

import { createBoundedPipeCommandOutputObservation } from '../../../src/infra/adapters/command-runtime/output';

const EMPTY_LINES = {
  stdout: { text: '', omittedCharacters: 0 },
  stderr: { text: '', omittedCharacters: 0 },
} as const;

function cursor(value: number) {
  return ProcessOutputCursorSchema.parse(value);
}

function runReplayAndDualStream(): void {
  const observation = createBoundedPipeCommandOutputObservation({
    maxEvents: 20,
    maxCharacters: 100,
  });
  observation.accept({
    channel: 'stdout',
    stableText: '开始\n',
    currentLogicalLines: EMPTY_LINES,
  });
  observation.accept({
    channel: 'stderr',
    stableText: 'warn\n',
    currentLogicalLines: EMPTY_LINES,
  });
  const first = observation.read(cursor(0));
  assert.deepEqual(observation.read(cursor(0)), first);
  assert.equal(first.status, 'observed');
  if (first.status !== 'observed') throw new Error('expected output observation');
  assert.equal(first.observation.stdout, '开始\n');
  assert.equal(first.observation.stderr, 'warn\n');
}

async function runWaitAndClose(): Promise<void> {
  const observation = createBoundedPipeCommandOutputObservation({
    maxEvents: 20,
    maxCharacters: 100,
  });
  const changed = observation.waitForChange({
    afterCursor: cursor(0),
    waitTimeoutMs: 1_000,
  });
  observation.accept({
    channel: 'stdout',
    stableText: '',
    currentLogicalLines: {
      ...EMPTY_LINES,
      stdout: { text: '进度 50%', omittedCharacters: 0 },
    },
  });
  const running = await changed;
  assert.equal(running.status, 'observed');
  if (running.status !== 'observed') throw new Error('expected running observation');
  assert.equal(running.observation.currentLogicalLines.stdout.text, '进度 50%');

  const closing = observation.waitForChange({
    afterCursor: running.observation.nextCursor,
    waitTimeoutMs: 1_000,
  });
  observation.close({ trailingStableText: { stdout: '完成🙂', stderr: '' } });
  const closed = await closing;
  assert.equal(closed.status, 'observed');
  if (closed.status !== 'observed') throw new Error('expected closed observation');
  assert.equal(closed.observation.stdout, '完成🙂');
  assert.equal(closed.observation.outputPhase, 'closed');
}

function runBoundedOmission(): void {
  const observation = createBoundedPipeCommandOutputObservation({
    maxEvents: 3,
    maxCharacters: 6,
  });
  observation.accept({
    channel: 'stdout',
    stableText: 'A🙂B',
    currentLogicalLines: EMPTY_LINES,
  });
  observation.accept({
    channel: 'stderr',
    stableText: '错误',
    currentLogicalLines: EMPTY_LINES,
  });
  const result = observation.read(cursor(0));
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') throw new Error('expected bounded observation');
  assert.equal(result.observation.coverage, 'omitted');
  assert.equal(result.observation.stderr, '错误');
  assert.equal(result.observation.stdout, '');
}

async function main(): Promise<void> {
  runReplayAndDualStream();
  await runWaitAndClose();
  runBoundedOmission();
  process.stdout.write(`${JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    scenarios: 3,
    status: 'passed',
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
