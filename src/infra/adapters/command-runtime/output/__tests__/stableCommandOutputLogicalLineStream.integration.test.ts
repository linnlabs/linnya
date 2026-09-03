import { describe, expect, it } from 'vitest';

import { createStableCommandOutputLogicalLineStream } from '../functions/createStableCommandOutputLogicalLineStream';

const DEFAULT_LIMITS = { maxCharactersPerCurrentLine: 100 } as const;

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff);
}

function projectChunks(chunks: readonly string[]): {
  readonly stableText: string;
  readonly committedLinesWithOmissions: number;
  readonly committedOmittedCharacters: number;
  readonly currentLineCommitted: boolean;
} {
  const stream = createStableCommandOutputLogicalLineStream(DEFAULT_LIMITS);
  let stableText = '';
  let committedLinesWithOmissions = 0;
  let committedOmittedCharacters = 0;
  for (const chunk of chunks) {
    const delta = stream.write(chunk);
    stableText += delta.stableText;
    committedLinesWithOmissions += delta.committedLinesWithOmissions;
    committedOmittedCharacters += delta.committedOmittedCharacters;
  }
  const finalization = stream.finalize();
  return {
    stableText: stableText + finalization.stableText,
    committedLinesWithOmissions:
      committedLinesWithOmissions + finalization.committedLinesWithOmissions,
    committedOmittedCharacters:
      committedOmittedCharacters + finalization.committedOmittedCharacters,
    currentLineCommitted: finalization.currentLineCommitted,
  };
}

describe('stable command output logical line stream', () => {
  it('LF 与同 chunk 或跨 chunk 的 CRLF 都只提交一个稳定换行', () => {
    expect(projectChunks(['a\nb\r\nc\r', '\nd'])).toEqual({
      stableText: 'a\nb\nc\nd',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: true,
    });
  });

  it('连续 bare CR 只保留最终进度帧，不向 append-only 下游泄漏替换动作', () => {
    const stream = createStableCommandOutputLogicalLineStream(DEFAULT_LIMITS);

    expect(stream.write('a\rb\rc')).toEqual({
      stableText: '',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
    });
    expect(stream.write('\n')).toEqual({
      stableText: 'c\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
    });
  });

  it('开头和连续 CR 不制造空帧，短帧可以整体覆盖较长帧', () => {
    expect(projectChunks(['\r\rlong progress\r\rshort\n'])).toEqual({
      stableText: 'short\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: false,
    });
    expect(projectChunks(['a\r\r\n'])).toEqual({
      stableText: 'a\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: false,
    });
  });

  it('EOF 前单独 CR 只回到行首，没有新正文时仍保留当前行且不补换行', () => {
    expect(projectChunks(['keep', '\r', '\r'])).toEqual({
      stableText: 'keep',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: true,
    });
  });

  it('LF 可以提交空逻辑行，EOF 不会在尾随 LF 后再虚构一行', () => {
    expect(projectChunks(['\nA\n\n'])).toEqual({
      stableText: '\nA\n\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: false,
    });
  });

  it('超长稳定行保留 Unicode 安全的 head/tail，并显式报告省略事实', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 10,
    });

    expect(stream.write('A🙂BCDEFGH🙂Z\n')).toEqual({
      stableText: 'A🙂BC[... output omitted ...]GH🙂Z\n',
      committedLinesWithOmissions: 1,
      committedOmittedCharacters: 3,
    });
    expect(stream.finalize().currentLineCommitted).toBe(false);
  });

  it.each([
    ['b🙂b\n'],
    ['b', '🙂b\n'],
    ['b🙂', 'b\n'],
  ])('Unicode 恰好命中当前行预算时不因内部 head/tail 分界误截断 %#', (...chunks) => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 4,
    });
    let stableText = '';
    for (const chunk of chunks) stableText += stream.write(chunk).stableText;

    expect(stableText).toBe('b🙂b\n');
    expect(stream.finalize()).toEqual({
      stableText: '',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: false,
    });
  });

  it('恰好命中预算的 Unicode 当前快照和 EOF 提交都保持完整', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 4,
    });
    stream.write('b🙂b');

    expect(stream.snapshotCurrentLine()).toEqual({
      text: 'b🙂b',
      omittedCharacters: 0,
    });
    expect(stream.finalize()).toEqual({
      stableText: 'b🙂b',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
      currentLineCommitted: true,
    });
  });

  it('超长进度帧被后续 CR 覆盖时，不把已淘汰帧记成最终文本损失', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 8,
    });
    stream.write(`${'x'.repeat(10_000)}\r`);

    expect(stream.write('done\n')).toEqual({
      stableText: 'done\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
    });
  });

  it('一次 write 内聚合多条稳定行及其省略计数，不按行制造事件', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 4,
    });

    expect(stream.write('12345\nok\nabcdef')).toEqual({
      stableText: '12[... output omitted ...]45\nok\n',
      committedLinesWithOmissions: 1,
      committedOmittedCharacters: 1,
    });
    expect(stream.finalize()).toEqual({
      stableText: 'ab[... output omitted ...]ef',
      committedLinesWithOmissions: 1,
      committedOmittedCharacters: 2,
      currentLineCommitted: true,
    });
  });

  it('运行中快照可以更新当前进度，但不会污染 append-only 稳定正文', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 8,
    });

    expect(stream.write('progress-10%\r').stableText).toBe('');
    expect(stream.snapshotCurrentLine()).toEqual({
      text: 'prog[... output omitted ...]-10%',
      omittedCharacters: 4,
    });
    expect(stream.write('done').stableText).toBe('');
    expect(stream.snapshotCurrentLine()).toEqual({
      text: 'done',
      omittedCharacters: 0,
    });
    expect(stream.finalize().stableText).toBe('done');
  });

  it('stdout/stderr 使用两个实例时，半个 CR 状态不会跨流消费', () => {
    const stdout = createStableCommandOutputLogicalLineStream(DEFAULT_LIMITS);
    const stderr = createStableCommandOutputLogicalLineStream(DEFAULT_LIMITS);
    stdout.write('old\r');

    expect(stderr.write('warning\n').stableText).toBe('warning\n');
    expect(stdout.write('new\n').stableText).toBe('new\n');
  });

  it('每个合法单切点都与整段输入得到相同结果', () => {
    const text = 'start🙂\rframe-2\r\nline-2\rreplace🙂\nfinal\r';
    const expected = projectChunks([text]);

    for (let split = 0; split <= text.length; split += 1) {
      if (!isUtf16Boundary(text, split)) continue;
      expect(projectChunks([text.slice(0, split), text.slice(split)])).toEqual(expected);
    }
  });

  it('固定 seed 随机分块不改变 CR/CRLF/Unicode 的最终稳定结果', () => {
    const text = `${'frame🙂\rnext\r'.repeat(80)}done\r\n${'line🙂\n'.repeat(40)}tail`;
    const expected = projectChunks([text]);
    let randomState = 0x67c0ffee;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const chunks: string[] = [];
      let offset = 0;
      while (offset < text.length) {
        randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
        let end = Math.min(text.length, offset + 1 + (randomState % 31));
        if (!isUtf16Boundary(text, end)) end += 1;
        chunks.push(text.slice(offset, end));
        offset = end;
      }
      expect(projectChunks(chunks)).toEqual(expected);
    }
  });

  it('数千个进度帧只提交最终帧，且当前行保留量不随历史帧增长', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 32,
    });
    for (let index = 0; index < 5_000; index += 1) {
      expect(stream.write(`${'x'.repeat(1_000)}-${index}\r`).stableText).toBe('');
    }

    expect(stream.write('complete\n')).toEqual({
      stableText: 'complete\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
    });
  });

  it('2 MiB 无换行输入只返回固定 head/tail 和准确省略数', () => {
    const stream = createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 20,
    });
    const text = `HEAD${'x'.repeat(2 * 1024 * 1024)}TAIL`;
    expect(stream.write(text).stableText).toBe('');

    const finalization = stream.finalize();
    expect(finalization.stableText).toBe(
      `HEAD${'x'.repeat(6)}[... output omitted ...]${'x'.repeat(6)}TAIL`,
    );
    expect(finalization.committedLinesWithOmissions).toBe(1);
    expect(finalization.committedOmittedCharacters).toBe(text.length - 20);
    expect(finalization.currentLineCommitted).toBe(true);
  });

  it('finalize 幂等，终结后的迟到文本被明确拒绝', () => {
    const stream = createStableCommandOutputLogicalLineStream(DEFAULT_LIMITS);
    stream.write('done\r');
    const first = stream.finalize();

    expect(stream.finalize()).toBe(first);
    expect(() => stream.write('late')).toThrow(
      'cannot write command output after logical line finalization',
    );
  });

  it.each([0, 3, 4.5, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝不能形成有界 head/tail 的当前行预算：%s',
    (maxCharactersPerCurrentLine) => {
      expect(() => createStableCommandOutputLogicalLineStream({
        maxCharactersPerCurrentLine,
      })).toThrow('must be a safe integer of at least 4');
    },
  );
});
