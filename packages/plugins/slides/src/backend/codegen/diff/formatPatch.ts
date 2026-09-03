export interface StructuredPatchLine {
  type: 'context' | 'remove' | 'add';
  content: string;
}

export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: StructuredPatchLine[];
}

export function addLineNumbers(content: string, startLine = 1): string {
  if (content.length === 0) {
    return '';
  }
  return content
    .split('\n')
    .map((line, index) => `${String(startLine + index).padStart(6, ' ')}\t${line}`)
    .join('\n');
}

export function buildStructuredPatch(previous: string, next: string): StructuredPatchHunk[] {
  if (previous === next) {
    return [];
  }

  const previousLines = splitLines(previous);
  const nextLines = splitLines(next);
  const commonPrefixLength = countCommonPrefix(previousLines, nextLines);
  const commonSuffixLength = countCommonSuffix(previousLines, nextLines, commonPrefixLength);

  const previousChangeStart = Math.max(0, commonPrefixLength - 1);
  const nextChangeStart = Math.max(0, commonPrefixLength - 1);
  const previousChangeEnd = Math.min(
    previousLines.length,
    previousLines.length - commonSuffixLength + (commonPrefixLength > 0 ? 1 : 0),
  );
  const nextChangeEnd = Math.min(
    nextLines.length,
    nextLines.length - commonSuffixLength + (commonPrefixLength > 0 ? 1 : 0),
  );

  const previousHunkLines = previousLines.slice(previousChangeStart, previousChangeEnd);
  const nextHunkLines = nextLines.slice(nextChangeStart, nextChangeEnd);
  const oldOnlyStart = commonPrefixLength - previousChangeStart;
  const oldOnlyEnd = previousHunkLines.length - (previousChangeEnd - (previousLines.length - commonSuffixLength));
  const newOnlyStart = commonPrefixLength - nextChangeStart;
  const newOnlyEnd = nextHunkLines.length - (nextChangeEnd - (nextLines.length - commonSuffixLength));
  const lines: StructuredPatchLine[] = [];

  for (let index = 0; index < oldOnlyStart; index++) {
    lines.push({ type: 'context', content: previousHunkLines[index] });
  }
  for (let index = oldOnlyStart; index < oldOnlyEnd; index++) {
    lines.push({ type: 'remove', content: previousHunkLines[index] });
  }
  for (let index = newOnlyStart; index < newOnlyEnd; index++) {
    lines.push({ type: 'add', content: nextHunkLines[index] });
  }
  for (let index = oldOnlyEnd; index < previousHunkLines.length; index++) {
    lines.push({ type: 'context', content: previousHunkLines[index] });
  }

  return [{
    oldStart: previousChangeStart + 1,
    oldLines: previousHunkLines.length,
    newStart: nextChangeStart + 1,
    newLines: nextHunkLines.length,
    lines,
  }];
}

function splitLines(source: string): string[] {
  return source.length === 0 ? [''] : source.split('\n');
}

function countCommonPrefix(previousLines: string[], nextLines: string[]): number {
  const sharedLength = Math.min(previousLines.length, nextLines.length);
  for (let index = 0; index < sharedLength; index++) {
    if (previousLines[index] !== nextLines[index]) {
      return index;
    }
  }
  return sharedLength;
}

function countCommonSuffix(previousLines: string[], nextLines: string[], prefixLength: number): number {
  const maxSuffixLength = Math.min(previousLines.length, nextLines.length) - prefixLength;
  for (let offset = 0; offset < maxSuffixLength; offset++) {
    const previousLine = previousLines[previousLines.length - offset - 1];
    const nextLine = nextLines[nextLines.length - offset - 1];
    if (previousLine !== nextLine) {
      return offset;
    }
  }
  return maxSuffixLength;
}
