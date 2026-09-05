import { describe, expect, it } from 'vitest';
import { buildTextLineWindow, formatTextLineWindow } from './buildTextLineWindow';

describe('read_file 文本行窗口', () => {
  it('使用 1-based offset 与行数 limit，并输出可继续的带行号窗口', () => {
    const window = buildTextLineWindow({ text: 'alpha\nbeta\ngamma', offset: 2, limit: 1 });

    expect(window).toMatchObject({
      offset: 2,
      limit: 1,
      rawText: 'beta',
      lineCount: 1,
      totalLineCount: 3,
      hasMore: true,
      nextOffset: 3,
    });
    expect(formatTextLineWindow({ locator: 'workspace:/notes.md', window })).toBe(
      '2 | beta\n\n[read_file: 显示第 2-2 行，共 3 行；继续使用 offset=3]',
    );
  });

  it('把末尾换行后的空行计入编辑器行号', () => {
    const window = buildTextLineWindow({ text: 'alpha\n', offset: 1, limit: 2 });
    expect(window).toMatchObject({
      lines: ['alpha', ''],
      totalLineCount: 2,
      hasMore: false,
    });
    expect(formatTextLineWindow({ locator: 'file:///notes.md', window })).toBe(
      '1 | alpha\n2 | ',
    );
  });

  it('保留长单行，由既有 ToolOutputStore 接管超长 observation', () => {
    const text = 'x'.repeat(25_000);
    const window = buildTextLineWindow({ text, offset: 1, limit: 2_000 });
    expect(window.rawText).toBe(text);
    expect(window.totalLineCount).toBe(1);
  });

  it('空文件只接受 offset=1，非空文件拒绝越过末行', () => {
    expect(buildTextLineWindow({ text: '', offset: 1, limit: 2_000 })).toMatchObject({
      lineCount: 0,
      totalLineCount: 0,
      hasMore: false,
    });
    expect(() => buildTextLineWindow({ text: '', offset: 2, limit: 2_000 })).toThrow(
      '[READ_FILE_LINE_OUT_OF_RANGE]',
    );
    expect(() => buildTextLineWindow({ text: 'one', offset: 2, limit: 2_000 })).toThrow(
      '[READ_FILE_LINE_OUT_OF_RANGE]',
    );
  });
});
