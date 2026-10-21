/**
 * @file buildTextLineWindow.ts
 * @description `read_file` 普通文本的 1-based 行窗口与模型可见编号格式。
 */

export interface TextLineWindow {
  readonly offset: number;
  readonly limit: number;
  readonly lines: readonly string[];
  /** 未添加展示行号的原始窗口；citation 必须基于它计算。 */
  readonly rawText: string;
  readonly lineCount: number;
  readonly totalLineCount: number;
  readonly hasMore: boolean;
  readonly nextOffset?: number;
}

function splitTextLines(text: string): readonly string[] {
  if (text.length === 0) return [];
  return text.split(/\r\n|\n|\r/);
}

export function buildTextLineWindow(input: {
  readonly text: string;
  readonly offset: number;
  readonly limit: number;
}): TextLineWindow {
  const lines = splitTextLines(input.text);
  if (input.offset > Math.max(lines.length, 1)) {
    throw new Error(
      `[READ_FILE_LINE_OUT_OF_RANGE] offset=${input.offset} 超出文件总行数 ${lines.length}。`
    );
  }

  const selected = lines.slice(input.offset - 1, input.offset - 1 + input.limit);
  const lineCount = selected.length;
  const nextOffset = input.offset + lineCount;
  const hasMore = nextOffset <= lines.length;
  return Object.freeze({
    offset: input.offset,
    limit: input.limit,
    lines: Object.freeze(selected),
    rawText: selected.join('\n'),
    lineCount,
    totalLineCount: lines.length,
    hasMore,
    ...(hasMore ? { nextOffset } : {}),
  });
}

export function formatTextLineWindow(input: {
  readonly locator: string;
  readonly window: TextLineWindow;
  readonly text?: string;
  readonly supplement?: string;
}): string {
  const content = (() => {
    if (input.window.totalLineCount === 0) {
      return `[read_file: ${input.locator} 为空]`;
    }
    const visibleText = input.text ?? input.window.rawText;
    const visibleLines = visibleText.split('\n');
    const lastLine = input.window.offset + Math.max(visibleLines.length - 1, 0);
    const width = String(lastLine).length;
    return visibleLines
      .map((line, index) => `${String(input.window.offset + index).padStart(width, ' ')} | ${line}`)
      .join('\n');
  })();
  const sections = [content];
  if (input.window.nextOffset !== undefined) {
    const nextCall = JSON.stringify({
      locator: input.locator,
      offset: input.window.nextOffset,
      limit: input.window.limit,
    });
    sections.push(`[read_file: 本次源窗口为第 ${input.window.offset}-${input.window.offset + input.window.lineCount - 1} 行，共 ${input.window.totalLineCount} 行。读完本次返回后，文件下一页：read_file(${nextCall})]`);
  } else if (input.supplement) {
    // 普通无附录 EOF 输出不变；来源快照不能被误当成文件还有下一页。
    sections.push('[read_file: 源文件已读至末行；下方为来源附录，不属于源文件。]');
  }
  if (input.supplement) sections.push(input.supplement);
  return sections.join('\n\n');
}
