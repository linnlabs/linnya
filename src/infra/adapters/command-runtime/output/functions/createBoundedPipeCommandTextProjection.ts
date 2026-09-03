import type { CommandPipeOutputChannel } from '@app/schemas/commands';
import type {
  CommandOutputTextPreview,
  PipeCommandAgentTextProjection,
} from '../../../../../domains/commands/definitions/commandOutputProjection';
import {
  validateCommandTextProjectionLimits,
  type CommandTextProjectionLimits,
} from '../definitions/commandTextProjectionLimits';
import {
  findCommandTextUtf16SafePrefixEnd,
  findCommandTextUtf16SafeSuffixStart,
} from './findCommandTextUtf16SafeBoundary';

interface MutableTextStreamProjection {
  head: string;
  tail: string;
  headNewlines: number;
  totalChars: number;
  totalNewlines: number;
  headClosed: boolean;
  tailConnected: boolean;
}

interface StreamBudgets {
  readonly headCharacters: number;
  readonly headLines: number;
}

export interface BoundedPipeCommandTextProjection {
  /** 输入必须已经完成按流解码和控制序列清理；该模块只负责有界保留。 */
  append(channel: CommandPipeOutputChannel, stableText: string): void;
  /** 返回当前有界快照但不终结；initial wait / process poll 后仍可继续 append。 */
  snapshot(): PipeCommandAgentTextProjection;
  /** finalize 幂等；终结后继续 append 属于调用顺序错误。 */
  finalize(): PipeCommandAgentTextProjection;
}

export interface BoundedCommandTextProjection {
  append(stableText: string): void;
  snapshot(): CommandOutputTextPreview;
  finalize(): CommandOutputTextPreview;
}

function createStream(): MutableTextStreamProjection {
  return {
    head: '',
    tail: '',
    headNewlines: 0,
    totalChars: 0,
    totalNewlines: 0,
    headClosed: false,
    tailConnected: true,
  };
}

function createBudgets(limits: CommandTextProjectionLimits): StreamBudgets {
  // Agent 既需要开头上下文，也需要末尾错误；奇数余量留给 tail，避免尾部比开头更早丢失。
  return {
    headCharacters: Math.floor(limits.maxCharactersPerStream / 2),
    headLines: Math.floor(limits.maxLinesPerStream / 2),
  };
}

function countNewlines(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === '\n') count += 1;
  }
  return count;
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : countNewlines(text) + 1;
}

function prefixEndWithinLineBudget(text: string, remainingLines: number): number {
  if (remainingLines <= 0) {
    const newline = text.indexOf('\n');
    return newline === -1 ? text.length : newline;
  }
  let completedLines = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue;
    completedLines += 1;
    if (completedLines > remainingLines) return index;
  }
  return text.length;
}

function suffixStartWithinLineBudget(text: string, maximumLines: number): number {
  let encounteredNewlines = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== '\n') continue;
    encounteredNewlines += 1;
    if (encounteredNewlines === maximumLines) return index + 1;
  }
  return 0;
}

function trimTail(text: string, maximumCharacters: number, maximumLines: number): string {
  const characterStart = findCommandTextUtf16SafeSuffixStart(text, maximumCharacters);
  const characterBounded = text.slice(characterStart);
  const lineStart = suffixStartWithinLineBudget(characterBounded, maximumLines);
  return characterBounded.slice(lineStart);
}

function appendTail(
  stream: MutableTextStreamProjection,
  tailInput: string,
  limits: CommandTextProjectionLimits,
): void {
  const maximumTailCharacters = limits.maxCharactersPerStream - stream.head.length;
  const maximumTailLines = Math.max(
    1,
    limits.maxLinesPerStream - countLines(stream.head),
  );

  if (stream.tailConnected) {
    // 尚未真正省略内容时，head/tail 分界处的换行仍属于原文。先按完整连接文本判断，
    // 否则刚好命中行数阈值也会被错误截断一个字符。
    const connectedCharacterCount = stream.head.length + stream.tail.length + tailInput.length;
    if (connectedCharacterCount <= limits.maxCharactersPerStream) {
      const connectedCandidate = stream.tail + tailInput;
      if (countLines(stream.head + connectedCandidate) <= limits.maxLinesPerStream) {
        stream.tail = connectedCandidate;
        return;
      }
    }
    stream.tailConnected = false;
  }

  const inputExceedsTail = tailInput.length > maximumTailCharacters
    || countLines(tailInput) > maximumTailLines;
  // 单个 decoder/parser delta 可能远大于预览；先取其尾部，避免与旧 tail 组成更大的临时串。
  const candidate = inputExceedsTail
    ? trimTail(tailInput, maximumTailCharacters, maximumTailLines)
    : trimTail(stream.tail + tailInput, maximumTailCharacters, maximumTailLines);
  stream.tail = candidate;
}

function appendText(
  stream: MutableTextStreamProjection,
  stableText: string,
  limits: CommandTextProjectionLimits,
  budgets: StreamBudgets,
): void {
  if (stableText.length === 0) return;
  stream.totalChars += stableText.length;
  stream.totalNewlines += countNewlines(stableText);

  let tailInput = stableText;
  if (!stream.headClosed) {
    const remainingCharacters = budgets.headCharacters - stream.head.length;
    const remainingLines = budgets.headLines - 1 - stream.headNewlines;
    const characterEnd = findCommandTextUtf16SafePrefixEnd(stableText, remainingCharacters);
    const lineEnd = prefixEndWithinLineBudget(stableText, remainingLines);
    const acceptedEnd = Math.min(characterEnd, lineEnd);
    const accepted = stableText.slice(0, acceptedEnd);
    stream.head += accepted;
    stream.headNewlines += countNewlines(accepted);
    if (acceptedEnd === stableText.length) return;
    stream.headClosed = true;
    tailInput = stableText.slice(acceptedEnd);
  }

  appendTail(stream, tailInput, limits);
}

function finalizeStream(stream: MutableTextStreamProjection): CommandOutputTextPreview {
  const retainedChars = stream.head.length + stream.tail.length;
  const omittedChars = stream.totalChars - retainedChars;
  const totalLines = stream.totalChars === 0 ? 0 : stream.totalNewlines + 1;
  if (omittedChars === 0) {
    return Object.freeze({
      status: 'complete',
      text: stream.head + stream.tail,
      total_chars: stream.totalChars,
      total_lines: totalLines,
    });
  }
  return Object.freeze({
    status: 'truncated',
    head: stream.head,
    tail: stream.tail,
    omitted_chars: omittedChars,
    total_chars: stream.totalChars,
    total_lines: totalLines,
  });
}

/**
 * 同步 append 只更新固定容量字符串，不等待磁盘、数据库或 renderer，因此未来可以安全挂在
 * raw session 的合法 output 准入点；完整文本 sink 仍由独立异步 port 负责。
 */
export function createBoundedPipeCommandTextProjection(
  rawLimits: CommandTextProjectionLimits,
): BoundedPipeCommandTextProjection {
  const limits = validateCommandTextProjectionLimits(rawLimits);
  const stdout = createBoundedCommandTextProjection(limits);
  const stderr = createBoundedCommandTextProjection(limits);
  let settled: PipeCommandAgentTextProjection | undefined;

  const projection: BoundedPipeCommandTextProjection = {
    append(channel, stableText) {
      if (settled) throw new Error('cannot append command text after projection finalization');
      (channel === 'stdout' ? stdout : stderr).append(stableText);
    },
    snapshot() {
      return settled ?? Object.freeze({
        mode: 'pipe',
        stdout: stdout.snapshot(),
        stderr: stderr.snapshot(),
      });
    },
    finalize() {
      settled ??= projection.snapshot();
      return settled;
    },
  };
  return Object.freeze(projection);
}

/**
 * 单文本流的公共有界保留规则。普通 pipe 为 stdout/stderr 各建一个实例，PTY 则只把
 * headless 屏幕已经稳定化的纯文本交进来，避免两种模式复制 Unicode 裁剪规则。
 */
export function createBoundedCommandTextProjection(
  rawLimits: CommandTextProjectionLimits,
): BoundedCommandTextProjection {
  const limits = validateCommandTextProjectionLimits(rawLimits);
  const budgets = createBudgets(limits);
  const stream = createStream();
  let settled: CommandOutputTextPreview | undefined;

  const projection: BoundedCommandTextProjection = {
    append(stableText) {
      if (settled) throw new Error('cannot append command text after projection finalization');
      appendText(stream, stableText, limits, budgets);
    },
    snapshot() {
      return settled ?? finalizeStream(stream);
    },
    finalize() {
      settled ??= projection.snapshot();
      return settled;
    },
  };
  return Object.freeze(projection);
}
