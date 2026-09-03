import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import type { CommandPipeOutputChannel } from '@app/schemas/commands';

import { decodeCommandOutputStreams } from '../../../src/infra/adapters/command-runtime/output/decodeCommandOutputStreams';
import type { CommandOutputTextEncoding } from '../../../packages/schemas/src/commands';

interface ChildOutput {
  readonly stdout: string;
  readonly stderr: string;
}

async function decodeRealChildOutput(input: {
  readonly encoding: CommandOutputTextEncoding;
  readonly stdoutBytes: readonly number[];
  readonly stderrBytes: readonly number[];
}): Promise<ChildOutput> {
  const childSource = `
const stdout = Buffer.from(JSON.parse(process.argv[1]));
const stderr = Buffer.from(JSON.parse(process.argv[2]));
let offset = 0;
function writeNext() {
  if (offset >= Math.max(stdout.length, stderr.length)) return;
  if (offset < stdout.length) process.stdout.write(stdout.subarray(offset, offset + 1));
  if (offset < stderr.length) process.stderr.write(stderr.subarray(offset, offset + 1));
  offset += 1;
  setImmediate(writeNext);
}
writeNext();
`;
  const child = spawn(process.execPath, [
    '-e',
    childSource,
    JSON.stringify(input.stdoutBytes),
    JSON.stringify(input.stderrBytes),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const decoders = decodeCommandOutputStreams(input.encoding);
  const output: Record<CommandPipeOutputChannel, string[]> = {
    stdout: [],
    stderr: [],
  };

  for (const [channel, stream] of [
    ['stdout', child.stdout],
    ['stderr', child.stderr],
  ] as const) {
    stream.on('data', (chunk: Buffer) => {
      output[channel].push(decoders.write(
        channel,
        new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      ));
    });
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0);
  output.stdout.push(decoders.finalize('stdout'));
  output.stderr.push(decoders.finalize('stderr'));
  return {
    stdout: output.stdout.join(''),
    stderr: output.stderr.join(''),
  };
}

async function main(): Promise<void> {
  const utf8 = await decodeRealChildOutput({
    encoding: 'utf-8',
    stdoutBytes: [...Buffer.from('标准输出🙂完成', 'utf8')],
    stderrBytes: [...Buffer.from('错误流界', 'utf8')],
  });
  assert.deepEqual(utf8, {
    stdout: '标准输出🙂完成',
    stderr: '错误流界',
  });

  const windows936 = await decodeRealChildOutput({
    encoding: 'windows-936',
    // “中文路径”固定 CP936 byte，避免测试用同一个 encoder 自证 decoder。
    stdoutBytes: [0xd6, 0xd0, 0xce, 0xc4, 0xc2, 0xb7, 0xbe, 0xb6],
    stderrBytes: [0xb4, 0xed, 0xce, 0xf3],
  });
  assert.deepEqual(windows936, {
    stdout: '中文路径',
    stderr: '错误',
  });

  const invalid = await decodeRealChildOutput({
    encoding: 'utf-8',
    stdoutBytes: [0x41, 0xff, 0x42],
    stderrBytes: [0xf0, 0x9f],
  });
  assert.deepEqual(invalid, {
    stdout: 'A\ufffdB',
    stderr: '\ufffd',
  });

  console.log(JSON.stringify({
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cases: 3,
  }));
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
