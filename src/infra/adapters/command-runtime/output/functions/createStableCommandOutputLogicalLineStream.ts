import {
  validateCommandOutputLogicalLineLimits,
  type CommandOutputLogicalLineLimits,
} from '../definitions/commandOutputLogicalLineLimits';
import {
  findCommandTextUtf16SafePrefixEnd,
  findCommandTextUtf16SafeSuffixStart,
} from './findCommandTextUtf16SafeBoundary';
import type {
  CommandOutputCurrentLogicalLineSnapshot,
} from '../../../../../domains/commands/definitions/commandOutputProjection';

const OMITTED_TEXT_MARKER = '[... output omitted ...]';

interface MutableCurrentLogicalLine {
  head: string;
  tail: string;
  totalCharacters: number;
  headClosed: boolean;
}

interface LogicalLineBudgets {
  readonly headCharacters: number;
  readonly maximumCharacters: number;
}

export interface StableCommandOutputTextDelta {
  /** 已经不可被后续 CR 撤回，可直接交给 append-only 下游的纯文本。 */
  readonly stableText: string;
  /** 本次提交的逻辑行中，有多少行因当前行预算而带有省略标记。 */
  readonly committedLinesWithOmissions: number;
  /** 被已提交逻辑行省略的 JavaScript UTF-16 单位总数。 */
  readonly committedOmittedCharacters: number;
}

export interface CommandOutputLogicalLineFinalization extends StableCommandOutputTextDelta {
  /** EOF 是否提交了最后一条没有 LF 的非空逻辑行。 */
  readonly currentLineCommitted: boolean;
}

export interface StableCommandOutputLogicalLineStream {
  /** 输入必须已经完成持续解码与控制序列清理，但仍保留 LF/CR。 */
  write(sanitizedText: string): StableCommandOutputTextDelta;
  /** 返回有界临时帧；调用者只能把它当快照，不能持久化为 replace-line 事件。 */
  snapshotCurrentLine(): CommandOutputCurrentLogicalLineSnapshot;
  /** finalize 幂等；EOF 不补换行，终结后继续 write 属于调用顺序错误。 */
  finalize(): CommandOutputLogicalLineFinalization;
}

function createCurrentLine(): MutableCurrentLogicalLine {
  return {
    head: '',
    tail: '',
    totalCharacters: 0,
    headClosed: false,
  };
}

function createBudgets(limits: CommandOutputLogicalLineLimits): LogicalLineBudgets {
  const headCharacters = Math.floor(limits.maxCharactersPerCurrentLine / 2);
  return {
    headCharacters,
    maximumCharacters: limits.maxCharactersPerCurrentLine,
  };
}

function resetCurrentLine(line: MutableCurrentLogicalLine): void {
  line.head = '';
  line.tail = '';
  line.totalCharacters = 0;
  line.headClosed = false;
}

function retainTail(text: string, maximumCharacters: number): string {
  return text.slice(findCommandTextUtf16SafeSuffixStart(text, maximumCharacters));
}

function appendCurrentLineText(
  line: MutableCurrentLogicalLine,
  text: string,
  budgets: LogicalLineBudgets,
): void {
  if (text.length === 0) return;
  line.totalCharacters += text.length;

  let tailInput = text;
  if (!line.headClosed) {
    const remainingHeadCharacters = budgets.headCharacters - line.head.length;
    const acceptedEnd = findCommandTextUtf16SafePrefixEnd(text, remainingHeadCharacters);
    line.head += text.slice(0, acceptedEnd);
    if (acceptedEnd === text.length) return;
    line.headClosed = true;
    tailInput = text.slice(acceptedEnd);
  }

  // head 为避开代理对可能少用一个单位；tail 必须接管这部分容量，否则刚好命中
  // 总预算的 Unicode 文本也会被误判为省略。
  const maximumTailCharacters = budgets.maximumCharacters - line.head.length;
  // 单个 parser delta 可能远大于当前行预算；先取 delta 尾部，避免拼出无界临时字符串。
  line.tail = tailInput.length > maximumTailCharacters
    ? retainTail(tailInput, maximumTailCharacters)
    : retainTail(line.tail + tailInput, maximumTailCharacters);
}

function projectCurrentLine(
  line: MutableCurrentLogicalLine,
): CommandOutputCurrentLogicalLineSnapshot {
  const omittedCharacters = line.totalCharacters - line.head.length - line.tail.length;
  return Object.freeze({
    text: omittedCharacters === 0
      ? line.head + line.tail
      : line.head + OMITTED_TEXT_MARKER + line.tail,
    omittedCharacters,
  });
}

function commitCurrentLine(
  line: MutableCurrentLogicalLine,
  terminatedByLineFeed: boolean,
): StableCommandOutputTextDelta {
  const snapshot = projectCurrentLine(line);
  resetCurrentLine(line);
  return Object.freeze({
    stableText: snapshot.text + (terminatedByLineFeed ? '\n' : ''),
    committedLinesWithOmissions: snapshot.omittedCharacters > 0 ? 1 : 0,
    committedOmittedCharacters: snapshot.omittedCharacters,
  });
}

/**
 * 普通 pipe 的 CR 只表示“下一帧替换当前逻辑行”，不是终端光标协议。
 * 替换状态不会离开本模块；ToolOutputStore、Agent 与 UI 只收到不可撤回的稳定文本。
 */
export function createStableCommandOutputLogicalLineStream(
  rawLimits: CommandOutputLogicalLineLimits,
): StableCommandOutputLogicalLineStream {
  const limits = validateCommandOutputLogicalLineLimits(rawLimits);
  const budgets = createBudgets(limits);
  const currentLine = createCurrentLine();
  let pendingCarriageReturn = false;
  let finalization: CommandOutputLogicalLineFinalization | undefined;

  function appendText(text: string): void {
    if (text.length === 0) return;
    if (pendingCarriageReturn) {
      // CR 后真正出现新正文时才丢弃旧帧；这样 `abc\r` 在 EOF 时仍保留 abc。
      resetCurrentLine(currentLine);
      pendingCarriageReturn = false;
    }
    appendCurrentLineText(currentLine, text, budgets);
  }

  const stream: StableCommandOutputLogicalLineStream = {
    write(sanitizedText) {
      if (finalization) {
        throw new Error('cannot write command output after logical line finalization');
      }
      const committed: string[] = [];
      let committedLinesWithOmissions = 0;
      let committedOmittedCharacters = 0;
      let textStart = 0;

      function appendCommitted(delta: StableCommandOutputTextDelta): void {
        committed.push(delta.stableText);
        committedLinesWithOmissions += delta.committedLinesWithOmissions;
        committedOmittedCharacters += delta.committedOmittedCharacters;
      }

      for (let index = 0; index < sanitizedText.length; index += 1) {
        const character = sanitizedText.charAt(index);
        if (character !== '\r' && character !== '\n') continue;
        appendText(sanitizedText.slice(textStart, index));
        textStart = index + 1;

        if (character === '\r') {
          // 连续 CR 仍只是停在行首，不生成空帧，也不提前丢弃当前内容。
          pendingCarriageReturn = true;
          continue;
        }

        // LF 和跨 chunk 的 CRLF 都提交同一当前行；CR 本身不进入稳定文本。
        appendCommitted(commitCurrentLine(currentLine, true));
        pendingCarriageReturn = false;
      }
      appendText(sanitizedText.slice(textStart));

      return Object.freeze({
        stableText: committed.join(''),
        committedLinesWithOmissions,
        committedOmittedCharacters,
      });
    },
    snapshotCurrentLine() {
      return projectCurrentLine(currentLine);
    },
    finalize() {
      if (finalization) return finalization;
      const currentLineCommitted = currentLine.totalCharacters > 0;
      const delta = currentLineCommitted
        ? commitCurrentLine(currentLine, false)
        : {
            stableText: '',
            committedLinesWithOmissions: 0,
            committedOmittedCharacters: 0,
          };
      finalization = Object.freeze({
        ...delta,
        currentLineCommitted,
      });
      return finalization;
    },
  };

  return Object.freeze(stream);
}
