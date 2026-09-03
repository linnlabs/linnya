import { Buffer } from 'node:buffer';

import iconv from 'iconv-lite';
import { parseCommandOutputTextEncoding } from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import { decodeCommandOutputStreams } from '../decodeCommandOutputStreams';

function splitAtEveryByte(bytes: Uint8Array): Uint8Array[] {
  return Array.from(bytes, (_byte, index) => bytes.subarray(index, index + 1));
}

describe('command output stream decoders', () => {
  it('UTF-8 多字节字符跨任意 byte 分块仍能无损还原', () => {
    const decoders = decodeCommandOutputStreams('utf-8');
    const source = '开始🙂中间\n最终结果';
    const chunks = splitAtEveryByte(Buffer.from(source, 'utf8'));
    const decoded = chunks.map(chunk => decoders.write('stdout', chunk)).join('')
      + decoders.finalize('stdout');

    expect(decoded).toBe(source);
  });

  it('CP936 双字节中文跨 byte 分块仍能无损还原', () => {
    const decoders = decodeCommandOutputStreams('windows-936');
    const source = '中文路径 C:\\测试\\结果.txt';
    const chunks = splitAtEveryByte(iconv.encode(source, 'cp936'));
    const decoded = chunks.map(chunk => decoders.write('stdout', chunk)).join('')
      + decoders.finalize('stdout');

    expect(decoded).toBe(source);
  });

  it('stdout 与 stderr 的半个字符互不消费', () => {
    const decoders = decodeCommandOutputStreams('utf-8');
    const stdout = Buffer.from('🙂OUT', 'utf8');
    const stderr = Buffer.from('界ERR', 'utf8');

    const result = [
      decoders.write('stdout', stdout.subarray(0, 1)),
      decoders.write('stderr', stderr.subarray(0, 2)),
      decoders.write('stdout', stdout.subarray(1)),
      decoders.write('stderr', stderr.subarray(2)),
      decoders.finalize('stdout'),
      decoders.finalize('stderr'),
    ];

    expect(result).toEqual(['', '', '🙂OUT', '界ERR', '', '']);
  });

  it('EOF 将未完成 UTF-8 残片明确变成替换字符', () => {
    const decoders = decodeCommandOutputStreams('utf-8');
    expect(decoders.write('stderr', Uint8Array.from([0xf0, 0x9f]))).toBe('');
    expect(decoders.finalize('stderr')).toBe('\ufffd');
    expect(decoders.finalize('stderr')).toBe('');
  });

  it('非法 byte 只产生可见替换字符，后续合法文字仍继续解码', () => {
    const decoders = decodeCommandOutputStreams('utf-8');
    expect(decoders.write('stdout', Uint8Array.from([0x41, 0xff, 0x42]))).toBe('A\ufffdB');
    expect(decoders.write('stdout', Buffer.from('中文', 'utf8'))).toBe('中文');
    expect(decoders.finalize('stdout')).toBe('');
  });

  it('空块不改变状态，finalize 幂等且终结后拒绝继续写入', () => {
    const decoders = decodeCommandOutputStreams('utf-8');
    expect(decoders.write('stdout', new Uint8Array())).toBe('');
    expect(decoders.write('stdout', Buffer.from('done'))).toBe('done');
    expect(decoders.finalize('stdout')).toBe('');
    expect(decoders.finalize('stdout')).toBe('');
    expect(() => decoders.write('stdout', Buffer.from('late'))).toThrow(
      'cannot decode stdout after output stream finalization',
    );
  });

  it('运行时未知编码明确失败，不静默降级成 CP936', () => {
    expect(() => parseCommandOutputTextEncoding('unknown')).toThrow();
  });
});
