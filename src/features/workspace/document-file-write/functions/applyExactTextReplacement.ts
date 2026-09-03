export type ExactTextReplacementErrorCode =
  | 'OLD_STRING_EMPTY'
  | 'NO_CHANGE'
  | 'OLD_STRING_NOT_FOUND'
  | 'OLD_STRING_NOT_UNIQUE';

export interface ExactTextReplacementChange {
  readonly oldStartLine: number;
  readonly oldEndLine: number;
  readonly newStartLine: number;
  readonly newEndLine: number;
}

export interface ExactTextReplacementResult {
  readonly text: string;
  readonly count: number;
  readonly changes: readonly ExactTextReplacementChange[];
  readonly diff: string;
  readonly diffTruncated: boolean;
}

export class ExactTextReplacementError extends Error {
  constructor(
    readonly code: ExactTextReplacementErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ExactTextReplacementError';
  }
}

const MAX_DIFF_CHARS = 12_000;
const MAX_DIFF_CHANGES = 20;
const MAX_CANDIDATE_LINES = 5;

/**
 * 按执行瞬间的 current content 做精确替换。
 * 这里只提供确定性匹配和反馈，不做模糊替换或自动猜测。
 */
export function applyExactTextReplacement(params: {
  readonly source: string;
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll: boolean;
}): ExactTextReplacementResult {
  validateReplacementInput(params.oldString, params.newString);
  const matchOffsets = findMatchOffsets(params.source, params.oldString);
  if (matchOffsets.length === 0) {
    throw new ExactTextReplacementError(
      'OLD_STRING_NOT_FOUND',
      buildNotFoundMessage(params.source, params.oldString)
    );
  }
  if (!params.replaceAll && matchOffsets.length > 1) {
    throw new ExactTextReplacementError(
      'OLD_STRING_NOT_UNIQUE',
      `old_string is not unique in the current file content. Exact matches start at lines ${formatLineList(
        matchOffsets.map(offset => lineNumberAtOffset(params.source, offset))
      )}. Provide a larger string with more context or set replace_all=true.`
    );
  }

  const selectedOffsets = params.replaceAll ? matchOffsets : [matchOffsets[0]];
  const changes = buildChanges(params.source, params.oldString, params.newString, selectedOffsets);
  const text = params.replaceAll
    ? params.source.split(params.oldString).join(params.newString)
    : replaceAt(params.source, selectedOffsets[0], params.oldString.length, params.newString);
  const diffResult = buildCompactUnifiedDiff(params.oldString, params.newString, changes);
  return {
    text,
    count: selectedOffsets.length,
    changes,
    diff: diffResult.text,
    diffTruncated: diffResult.truncated,
  };
}

function validateReplacementInput(oldString: string, newString: string): void {
  if (oldString.length === 0) {
    throw new ExactTextReplacementError('OLD_STRING_EMPTY', 'old_string must not be empty.');
  }
  if (oldString === newString) {
    throw new ExactTextReplacementError(
      'NO_CHANGE',
      'No changes to make: old_string and new_string are exactly the same.'
    );
  }
}

function findMatchOffsets(source: string, oldString: string): number[] {
  const offsets: number[] = [];
  let offset = source.indexOf(oldString);
  while (offset !== -1) {
    offsets.push(offset);
    offset = source.indexOf(oldString, offset + oldString.length);
  }
  return offsets;
}

function replaceAt(source: string, offset: number, oldLength: number, newString: string): string {
  return `${source.slice(0, offset)}${newString}${source.slice(offset + oldLength)}`;
}

function buildChanges(
  source: string,
  oldString: string,
  newString: string,
  offsets: readonly number[]
): ExactTextReplacementChange[] {
  const oldLineDelta = countNewlines(oldString);
  const newLineDelta = countNewlines(newString);
  let accumulatedLineDelta = 0;
  return offsets.map(offset => {
    const oldStartLine = lineNumberAtOffset(source, offset);
    const newStartLine = oldStartLine + accumulatedLineDelta;
    accumulatedLineDelta += newLineDelta - oldLineDelta;
    return {
      oldStartLine,
      oldEndLine: oldStartLine + oldLineDelta,
      newStartLine,
      newEndLine: newStartLine + newLineDelta,
    };
  });
}

function buildCompactUnifiedDiff(
  oldString: string,
  newString: string,
  changes: readonly ExactTextReplacementChange[]
): { readonly text: string; readonly truncated: boolean } {
  const oldLines = oldString.split('\n');
  const newLines = newString.length === 0 ? [] : newString.split('\n');
  const visibleChanges = changes.slice(0, MAX_DIFF_CHANGES);
  const hunks = visibleChanges.map(change =>
    [
      `@@ -${change.oldStartLine},${oldLines.length} +${change.newStartLine},${newLines.length} @@`,
      ...oldLines.map(line => `-${line}`),
      ...newLines.map(line => `+${line}`),
    ].join('\n')
  );
  let text = hunks.join('\n');
  let truncated = changes.length > visibleChanges.length;
  if (text.length > MAX_DIFF_CHARS) {
    text = text.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }
  if (truncated) text = `${text}\n... diff truncated ...`;
  return { text, truncated };
}

function buildNotFoundMessage(source: string, oldString: string): string {
  const candidateLines = findCandidateLines(source, oldString);
  const candidateHint =
    candidateLines.length > 0
      ? ` Candidate lines containing the first stable old_string line: ${formatLineList(candidateLines)}.`
      : '';
  return `old_string was not found in the current file content.${candidateHint} Use read_file to reload the current content, then copy a larger exact block.`;
}

function findCandidateLines(source: string, oldString: string): number[] {
  const anchors = oldString
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length >= 4);
  const lines = source.split('\n');
  for (const anchor of anchors) {
    const result: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]?.includes(anchor)) result.push(index + 1);
      if (result.length >= MAX_CANDIDATE_LINES) break;
    }
    if (result.length > 0) return result;
  }
  return [];
}

function lineNumberAtOffset(source: string, offset: number): number {
  return countNewlines(source.slice(0, offset)) + 1;
}

function countNewlines(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === '\n') count += 1;
  }
  return count;
}

function formatLineList(lines: readonly number[]): string {
  return lines.join(', ');
}
