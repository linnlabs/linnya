import { describe, expect, it } from 'vitest';

import { createBoundedPipeCommandTextProjection } from '../functions/createBoundedPipeCommandTextProjection';

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff);
}

describe('bounded pipe command text projection', () => {
  it('短输出按 stdout/stderr 分开保留，并记录稳定字符与行数', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 40,
      maxLinesPerStream: 10,
    });
    projection.append('stdout', 'hello\n');
    projection.append('stderr', 'warn');
    projection.append('stdout', 'world');

    expect(projection.finalize()).toEqual({
      mode: 'pipe',
      stdout: {
        status: 'complete',
        text: 'hello\nworld',
        total_chars: 11,
        total_lines: 2,
      },
      stderr: {
        status: 'complete',
        text: 'warn',
        total_chars: 4,
        total_lines: 1,
      },
    });
  });

  it('超长单行同时保留开头和错误尾部，且不会切开 emoji', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 10,
      maxLinesPerStream: 4,
    });
    projection.append('stderr', 'A🙂BCDEFGH🙂Z');

    expect(projection.finalize().stderr).toEqual({
      status: 'truncated',
      head: 'A🙂BC',
      tail: 'GH🙂Z',
      omitted_chars: 3,
      total_chars: 13,
      total_lines: 1,
    });
  });

  it.each([
    ['', 0],
    ['L1', 1],
    ['L1\nL2\nL3', 3],
    ['L1\nL2\nL3\nL4', 4],
    ['L1\nL2\nL3\n', 4],
    ['A\n\n\nB', 4],
  ])('不在行数预算边界前提前截断 %#', (text, totalLines) => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 100,
      maxLinesPerStream: 4,
    });
    for (const character of text) projection.append('stdout', character);

    expect(projection.finalize().stdout).toEqual({
      status: 'complete',
      text,
      total_chars: text.length,
      total_lines: totalLines,
    });
  });

  it('行预算保留最前和最后的真实行，不把中间省略冒充全文', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 100,
      maxLinesPerStream: 4,
    });
    projection.append('stdout', 'L1\nL2\nL3\nL4\nL5');

    expect(projection.finalize().stdout).toEqual({
      status: 'truncated',
      head: 'L1\nL2',
      tail: 'L4\nL5',
      omitted_chars: 4,
      total_chars: 14,
      total_lines: 5,
    });
  });

  it('同一稳定文本无论怎样切 chunk，最终双流 projection 都一致', () => {
    const stdout = 'start🙂\nline-2\nline-3\nline-4\nvisible-tail';
    const stderr = 'warn-1\nwarn-2🙂\nfinal-error';
    const expected = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 24,
      maxLinesPerStream: 4,
    });
    expected.append('stdout', stdout);
    expected.append('stderr', stderr);
    const expectedResult = expected.finalize();

    for (let split = 0; split <= stdout.length; split += 1) {
      const stderrSplit = Math.min(split, stderr.length);
      if (!isUtf16Boundary(stdout, split) || !isUtf16Boundary(stderr, stderrSplit)) continue;
      const candidate = createBoundedPipeCommandTextProjection({
        maxCharactersPerStream: 24,
        maxLinesPerStream: 4,
      });
      candidate.append('stdout', stdout.slice(0, split));
      candidate.append('stderr', stderr.slice(0, stderrSplit));
      candidate.append('stdout', stdout.slice(split));
      candidate.append('stderr', stderr.slice(stderrSplit));
      expect(candidate.finalize()).toEqual(expectedResult);
    }
  });

  it('随机合法 UTF-16 分块不改变字符和行数双预算结果', () => {
    const text = `${'head🙂\n'.repeat(20)}${'middle\n'.repeat(40)}${'tail🙂\n'.repeat(20)}`;
    const expected = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 101,
      maxLinesPerStream: 9,
    });
    expected.append('stdout', text);
    const expectedResult = expected.finalize().stdout;
    let randomState = 0x1f2e3d4c;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const projection = createBoundedPipeCommandTextProjection({
        maxCharactersPerStream: 101,
        maxLinesPerStream: 9,
      });
      let offset = 0;
      while (offset < text.length) {
        randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
        let end = Math.min(text.length, offset + 1 + (randomState % 31));
        if (!isUtf16Boundary(text, end)) end += 1;
        projection.append('stdout', text.slice(offset, end));
        offset = end;
      }
      expect(projection.finalize().stdout).toEqual(expectedResult);
    }
  });

  it('超大单个 delta 先裁剪再保留尾部，不让保留量随输入增长', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 200,
      maxLinesPerStream: 20,
    });
    const text = `${'x'.repeat(2 * 1024 * 1024)}\nFINAL`;
    projection.append('stdout', text);

    const result = projection.finalize().stdout;
    expect(result.status).toBe('truncated');
    if (result.status !== 'truncated') return;
    expect(result.head.length + result.tail.length).toBeLessThanOrEqual(200);
    expect(result.tail).toContain('FINAL');
    expect(result.total_chars).toBe(text.length);
    expect(result.omitted_chars).toBe(
      result.total_chars - result.head.length - result.tail.length,
    );
  });

  it('持续百万字符输出时只保留固定预算，累计规模仍准确', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 200,
      maxLinesPerStream: 20,
    });
    const chunk = `${'x'.repeat(9_999)}\n`;
    for (let index = 0; index < 100; index += 1) {
      projection.append('stdout', chunk);
    }

    const result = projection.finalize().stdout;
    expect(result.status).toBe('truncated');
    if (result.status !== 'truncated') return;
    expect(result.head.length + result.tail.length).toBeLessThanOrEqual(200);
    expect(result.total_chars).toBe(1_000_000);
    expect(result.total_lines).toBe(101);
    expect(result.omitted_chars).toBe(
      result.total_chars - result.head.length - result.tail.length,
    );
  });

  it('finalize 幂等，终结后的迟到文本被明确拒绝', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 20,
      maxLinesPerStream: 4,
    });
    projection.append('stdout', 'done');
    const first = projection.finalize();

    expect(projection.finalize()).toBe(first);
    expect(() => projection.append('stdout', 'late')).toThrow(
      'cannot append command text after projection finalization',
    );
  });

  it('运行中 snapshot 不终结 projection，后续稳定文本仍可继续追加', () => {
    const projection = createBoundedPipeCommandTextProjection({
      maxCharactersPerStream: 20,
      maxLinesPerStream: 4,
    });
    projection.append('stdout', 'first\n');

    expect(projection.snapshot().stdout).toEqual({
      status: 'complete',
      text: 'first\n',
      total_chars: 6,
      total_lines: 2,
    });
    projection.append('stdout', 'second');
    const finalization = projection.finalize();
    expect(finalization.stdout).toEqual({
      status: 'complete',
      text: 'first\nsecond',
      total_chars: 12,
      total_lines: 2,
    });
    expect(projection.snapshot()).toBe(finalization);
  });
});
