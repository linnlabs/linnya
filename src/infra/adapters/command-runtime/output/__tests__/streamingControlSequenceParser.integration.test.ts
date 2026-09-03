import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import { decodeCommandOutputStreams } from '../decodeCommandOutputStreams';
import { createStreamingControlSequenceParser } from '../functions/createStreamingControlSequenceParser';

function parseChunks(chunks: readonly string[]): {
  readonly text: string;
  readonly incompleteSequenceOmitted: boolean;
} {
  const parser = createStreamingControlSequenceParser();
  const text = chunks.map(chunk => parser.write(chunk)).join('');
  return { text, ...parser.finalize() };
}

function splitEveryCharacter(text: string): string[] {
  return Array.from(text);
}

function expectAllChunkings(
  input: string,
  expected: ReturnType<typeof parseChunks>,
): void {
  expect(parseChunks([input])).toEqual(expected);
  for (let split = 0; split <= input.length; split += 1) {
    expect(parseChunks([input.slice(0, split), input.slice(split)])).toEqual(expected);
  }

  let randomState = 0x6d2b79f5;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < input.length) {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      const end = Math.min(input.length, offset + 1 + (randomState % 7));
      chunks.push(input.slice(offset, end));
      offset = end;
    }
    expect(parseChunks(chunks)).toEqual(expected);
  }
}

describe('streaming command output control sequence parser', () => {
  it('删除完整 CSI/OSC 和 ESC 序列，不执行标题、链接或剪贴板 payload', () => {
    const input = [
      'A',
      '\u001b[31mred\u001b[0m',
      '\u001b]0;window title\u0007',
      '\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\',
      '\u001b]52;c;YWJj\u0007',
      '\u001b(0\u001b%G',
      'Z',
    ].join('');

    expect(parseChunks([input])).toEqual({
      text: 'AredlinkZ',
      incompleteSequenceOmitted: false,
    });
    expect(parseChunks(splitEveryCharacter(input))).toEqual(parseChunks([input]));
  });

  it('删除 DCS/SOS/PM/APC 字符串，只有 OSC 接受 BEL 结束', () => {
    const input = [
      'A',
      '\u001bPdevice\u0007still-device\u001b\\B',
      '\u001bXprivate\u001b\\C',
      '\u001b^message\u001b\\D',
      '\u001b_application\u001b\\E',
      '\u001b]title\u0007F',
    ].join('');

    expect(parseChunks(splitEveryCharacter(input))).toEqual({
      text: 'ABCDEF',
      incompleteSequenceOmitted: false,
    });
  });

  it('覆盖 8-bit CSI/OSC/DCS/SOS/PM/APC 与 C1 ST', () => {
    const input = [
      'A\u009b31mB\u009b0m',
      '\u009d0;title\u009cC',
      '\u0090payload\u009cD',
      '\u0098payload\u009cE',
      '\u009epayload\u009cF',
      '\u009fpayload\u009cG',
    ].join('');

    expect(parseChunks(splitEveryCharacter(input))).toEqual({
      text: 'ABCDEFG',
      incompleteSequenceOmitted: false,
    });
  });

  it('保留 tab/LF/CR，并把剩余 C0、DEL 和非语法 C1 转成可见文本', () => {
    const input = 'A\u0000\u0007\u0008\u007f\u0085B\t\n\rC';
    expect(parseChunks([input])).toEqual({
      text: 'A\\x00\\x07\\x08\\x7f\\x85B\t\n\rC',
      incompleteSequenceOmitted: false,
    });
  });

  it('CSI 内独立控制保持可见，CAN/SUB 取消当前控制序列', () => {
    const input = [
      'A\u001b[31\u0001mB',
      '\u001b[32\u0018C',
      '\u001b]payload\u001aD',
      '\u001b[33\u001b[0mE',
    ].join('');
    expect(parseChunks(splitEveryCharacter(input))).toEqual({
      text: 'A\\x01BCDE',
      incompleteSequenceOmitted: false,
    });
  });

  it('string 内非 ST 的 ESC 不泄漏 payload，连续 ESC 后仍可由 ST 收口', () => {
    const input = 'A\u001b]secret\u001bXstill-secret\u001b\u001b\\B';
    expect(parseChunks(splitEveryCharacter(input))).toEqual({
      text: 'AB',
      incompleteSequenceOmitted: false,
    });
  });

  it.each([
    {
      name: 'escape 遇非法 Unicode 后重处理正文',
      input: 'A\u001b🙂B',
      expected: { text: 'A🙂B', incompleteSequenceOmitted: false },
    },
    {
      name: 'escape intermediate 遇非法 Unicode 后重处理正文',
      input: 'A\u001b(🙂B',
      expected: { text: 'A🙂B', incompleteSequenceOmitted: false },
    },
    {
      name: 'CSI parameter 非法后忽略到 final',
      input: 'A\u001b[31🙂12;  mB',
      expected: { text: 'AB', incompleteSequenceOmitted: false },
    },
    {
      name: 'CSI intermediate 后出现 parameter 时忽略到 final',
      input: 'A\u001b[31 12;mB',
      expected: { text: 'AB', incompleteSequenceOmitted: false },
    },
    {
      name: 'CSI 内 8-bit OSC 重启新序列',
      input: 'A\u001b[31\u009dsecret\u009cB',
      expected: { text: 'AB', incompleteSequenceOmitted: false },
    },
    {
      name: 'OSC 内嵌 8-bit CSI 仍属于 payload',
      input: 'A\u001b]secret\u009b31mhidden\u0007B',
      expected: { text: 'AB', incompleteSequenceOmitted: false },
    },
    {
      name: 'CSI ignore 在 EOF 形成不完整事实',
      input: 'A\u001b[31🙂12;',
      expected: { text: 'A', incompleteSequenceOmitted: true },
    },
  ])('$name 的结果不依赖单切点或随机多分块', ({ input, expected }) => {
    expectAllChunkings(input, expected);
  });

  it('stdout/stderr 使用两个实例时，半个序列不会跨流消费', () => {
    const stdout = createStreamingControlSequenceParser();
    const stderr = createStreamingControlSequenceParser();

    expect(stdout.write('OUT\u001b]0;half')).toBe('OUT');
    expect(stderr.write('ERR\u001b[31')).toBe('ERR');
    expect(stdout.write('\u0007-A')).toBe('-A');
    expect(stderr.write('m-B')).toBe('-B');
    expect(stdout.finalize()).toEqual({ incompleteSequenceOmitted: false });
    expect(stderr.finalize()).toEqual({ incompleteSequenceOmitted: false });
  });

  it('CP936 decoder 与 parser 分层组合后仍不受 byte 分块影响', () => {
    const input = '中文\u001b[31m路径\u001b[0m\n完成';
    const bytes = iconv.encode(input, 'cp936');
    const decoder = decodeCommandOutputStreams('windows-936');
    const parser = createStreamingControlSequenceParser();
    const output: string[] = [];

    for (let index = 0; index < bytes.byteLength; index += 1) {
      output.push(parser.write(decoder.write('stdout', bytes.subarray(index, index + 1))));
    }
    output.push(parser.write(decoder.finalize('stdout')));

    expect(output.join('')).toBe('中文路径\n完成');
    expect(parser.finalize()).toEqual({ incompleteSequenceOmitted: false });
  });

  it.each([
    ['escape', 'A\u001b'],
    ['escape intermediate', 'A\u001b('],
    ['CSI parameter', 'A\u001b[31;'],
    ['CSI intermediate', 'A\u001b[31 '],
    ['OSC', 'A\u001b]0;title'],
    ['DCS string escape', 'A\u001bPpayload\u001b'],
  ])('EOF 丢弃未闭合的 %s，并返回明确的不完整事实', (_name, input) => {
    expect(parseChunks(splitEveryCharacter(input))).toEqual({
      text: 'A',
      incompleteSequenceOmitted: true,
    });
  });

  it('1 MiB 未终止 OSC 不缓存或回放 payload', () => {
    const parser = createStreamingControlSequenceParser();
    expect(parser.write('safe\n\u001b]0;')).toBe('safe\n');
    for (let index = 0; index < 1024; index += 1) {
      expect(parser.write('x'.repeat(1024))).toBe('');
    }
    expect(parser.finalize()).toEqual({ incompleteSequenceOmitted: true });
  });

  it('finalize 幂等，终结后拒绝迟到输出', () => {
    const parser = createStreamingControlSequenceParser();
    expect(parser.write('done')).toBe('done');
    const first = parser.finalize();
    expect(parser.finalize()).toBe(first);
    expect(() => parser.write('late')).toThrow(
      'cannot parse command output after control sequence finalization',
    );
  });
});
