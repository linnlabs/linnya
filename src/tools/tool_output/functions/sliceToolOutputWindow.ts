import { sliceTextByUnitsZhEn } from '../../../shared/utils/textUnits';
import {
  TOOL_OUTPUT_READ_MAX_LINES,
  TOOL_OUTPUT_READ_MAX_UNITS,
  type ToolOutputReadArgs,
} from '../definitions/toolOutputRead';

export interface ToolOutputTextWindow {
  readonly startOffset: number;
  readonly endOffsetExclusive: number;
  readonly totalChars: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly windowText: string;
  readonly nextOffset: number | null;
}

export interface ToolOutputWindowCandidate {
  /** 从公开 startOffset 开始读取的有界正文；允许为末尾 surrogate pair 多带一个 code unit。 */
  readonly text: string;
  readonly startOffset: number;
  readonly totalChars: number;
  readonly startLine: number;
  readonly totalLines: number;
}

/**
 * 在已经 seek 得到的有界候选正文上执行字符、行和文本单位三重预算。
 *
 * 该纯函数不读取文件，也不推算 startLine；磁盘 reader 必须从固定索引提供全局计量。
 */
export function sliceToolOutputWindowCandidate(
  candidate: ToolOutputWindowCandidate,
  args: Pick<ToolOutputReadArgs, 'offset' | 'limit'>,
): ToolOutputTextWindow {
  if (args.offset !== candidate.startOffset) {
    throw new Error('[tool_output_read] reader 候选窗口与请求 offset 不一致');
  }
  if (args.offset >= candidate.totalChars) {
    throw new Error(
      `[tool_output_read] offset=${args.offset} 超出正文范围（total_chars=${candidate.totalChars}）`,
    );
  }
  if (candidate.text.length === 0) {
    throw new Error('[tool_output_read] reader 没有返回可前进正文');
  }

  const requestedLocalEnd = Math.min(candidate.text.length, args.limit);
  const endByCharacters = keepUtf16Boundary(candidate.text, 0, requestedLocalEnd);
  const endByLines = findEndOffsetByLineLimit(
    candidate.text,
    0,
    TOOL_OUTPUT_READ_MAX_LINES,
  );
  const textWithinCharacterAndLineLimits = candidate.text.slice(
    0,
    Math.min(endByCharacters, endByLines),
  );
  const windowText = sliceTextByUnitsZhEn(
    textWithinCharacterAndLineLimits,
    TOOL_OUTPUT_READ_MAX_UNITS,
  );
  if (windowText.length === 0) {
    throw new Error('[tool_output_read] 当前窗口无法在读取预算内前进');
  }

  const endOffsetExclusive = args.offset + windowText.length;
  return {
    startOffset: args.offset,
    endOffsetExclusive,
    totalChars: candidate.totalChars,
    startLine: candidate.startLine,
    // 若窗口以换行结束，该换行属于当前末行，不把下一空行误报成已返回。
    endLine: candidate.startLine + countNewlines(windowText.slice(0, -1)),
    totalLines: candidate.totalLines,
    windowText,
    nextOffset: endOffsetExclusive < candidate.totalChars ? endOffsetExclusive : null,
  };
}

/**
 * 全字符串适配器只服务纯函数调用者；生产文件读取必须使用有界 candidate 入口。
 */
export function sliceToolOutputWindow(
  text: string,
  args: Pick<ToolOutputReadArgs, 'offset' | 'limit'>,
): ToolOutputTextWindow {
  assertReadableUtf16Offset(text, args.offset);
  const totalLines = countNewlines(text) + 1;
  const startLine = countNewlines(text.slice(0, args.offset)) + 1;
  return sliceToolOutputWindowCandidate({
    text: text.slice(args.offset, Math.min(text.length, args.offset + args.limit + 1)),
    startOffset: args.offset,
    totalChars: text.length,
    startLine,
    totalLines,
  }, args);
}

export function assertReadableUtf16Offset(text: string, offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= text.length) {
    throw new Error(
      `[tool_output_read] offset=${offset} 超出正文范围（total_chars=${text.length}）`,
    );
  }
  if (
    offset > 0
    && isHighSurrogate(text.charCodeAt(offset - 1))
    && isLowSurrogate(text.charCodeAt(offset))
  ) {
    throw new Error(`[tool_output_read] offset=${offset} 位于 Unicode 字符中间`);
  }
}

function findEndOffsetByLineLimit(text: string, startOffset: number, maxLines: number): number {
  let newlineCount = 0;
  for (let index = startOffset; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 0x0a) continue;
    newlineCount += 1;
    if (newlineCount === maxLines) return index + 1;
  }
  return text.length;
}

function keepUtf16Boundary(text: string, startOffset: number, endOffset: number): number {
  if (endOffset <= 0 || endOffset >= text.length) return endOffset;
  const splitsPair = isHighSurrogate(text.charCodeAt(endOffset - 1))
    && isLowSurrogate(text.charCodeAt(endOffset));
  if (!splitsPair) return endOffset;
  // limit=1 且首字符是代理对时必须多带一个 code unit，否则 cursor 永远无法前进。
  return endOffset - 1 === startOffset ? endOffset + 1 : endOffset - 1;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) count += 1;
  }
  return count;
}
