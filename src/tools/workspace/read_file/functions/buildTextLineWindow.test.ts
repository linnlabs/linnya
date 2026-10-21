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
      '2 | beta\n\n[read_file: 本次源窗口为第 2-2 行，共 3 行。读完本次返回后，文件下一页：read_file({"locator":"workspace:/notes.md","offset":3,"limit":1})]',
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

  it('源窗口与 EOF 说明位于附录之前，附录不产生下一文件行号', () => {
    const window = buildTextLineWindow({ text: 'one\ntwo', offset: 1, limit: 1 });
    const first = formatTextLineWindow({
      locator: 'workspace:/notes.md', window, supplement: 'Citation Sources\nevidence',
    });
    expect(first.indexOf('文件下一页')).toBeLessThan(first.indexOf('Citation Sources'));
    expect(first).toContain('"offset":2');
    const last = formatTextLineWindow({
      locator: 'workspace:/notes.md',
      window: buildTextLineWindow({ text: 'one\ntwo', offset: 2, limit: 1 }),
      supplement: 'Citation Sources\nevidence',
    });
    expect(last.indexOf('源文件已读至末行')).toBeLessThan(last.indexOf('Citation Sources'));
    expect(last).not.toContain('"offset":3');
  });
});
